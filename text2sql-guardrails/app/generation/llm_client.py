"""
Provider-agnostic LLM client. Dispatches on settings.LLM_PROVIDER:

  - "anthropic" (default): native Anthropic Messages API, via the
    `anthropic` SDK. Behavior is UNCHANGED from before this abstraction
    existed -- same client construction, same request shape, same
    cache_control handling, same response extraction -- so Anthropic-run
    results (eval/results.jsonl, the published baseline) stay exactly
    reproducible.
  - "gemini" / "groq": both expose an OpenAI-compatible chat-completions
    endpoint, so one client (the `openai` SDK pointed at the provider's
    base_url, per _PROVIDER_BASE_URLS below) covers both rather than
    writing bespoke integrations per provider. `LLM_API_KEY` holds
    whichever provider's key is active; there's no per-provider key
    variable, matching the existing single-key convention.

Every provider path is wrapped in the same retry-with-backoff and RPM
throttle (see _with_backoff / _RpmThrottle) so rate-limit handling isn't
duplicated per provider.

cache_system=True (Anthropic prompt caching, see complete()'s docstring)
has no equivalent on the OpenAI-compatible path for Gemini/Groq -- it's
silently a no-op there, not an error; see complete()'s docstring.
"""
from __future__ import annotations

import json
import logging
import random
import threading
import time
from collections import deque
from functools import lru_cache

import anthropic
import openai

from app.config import settings

logger = logging.getLogger(__name__)

_PROVIDER_BASE_URLS = {
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai/",
    "groq": "https://api.groq.com/openai/v1",
}

_MAX_RETRIES = 5
_BACKOFF_BASE_SECONDS = 1.0
_BACKOFF_MAX_SECONDS = 60.0

# Deliberately ONE retry layer, not two stacked ambiguously: both SDKs have
# their own built-in retry (it fired on a transient 503 from Gemini and
# then hung with no timeout configured -- the bug this module now fixes),
# separate from _with_backoff below. max_retries=0 on both client
# constructors disables the SDK's internal retry entirely, so every
# _with_backoff attempt is EXACTLY one HTTP request -- the combined
# worst-case for one complete() call is therefore _MAX_RETRIES (5) HTTP
# requests, not an SDK-retries-times-backoff-retries product that would be
# harder to reason about (and, as observed, could compound into a hang).


@lru_cache(maxsize=1)
def get_client() -> anthropic.Anthropic:
    """Kept for backward compatibility with anything importing this name
    directly (e.g. existing tests) -- always the Anthropic client,
    regardless of LLM_PROVIDER, since only the Anthropic path uses it."""
    return anthropic.Anthropic(
        api_key=settings.LLM_API_KEY,
        timeout=settings.LLM_TIMEOUT_SECONDS,
        max_retries=0,
    )


@lru_cache(maxsize=None)
def _get_openai_compatible_client(provider: str) -> openai.OpenAI:
    base_url = _PROVIDER_BASE_URLS.get(provider)
    if base_url is None:
        raise ValueError(
            f"Unknown LLM_PROVIDER {provider!r}. Supported: 'anthropic', "
            f"{', '.join(repr(p) for p in _PROVIDER_BASE_URLS)}."
        )
    return openai.OpenAI(
        api_key=settings.LLM_API_KEY,
        base_url=base_url,
        timeout=settings.LLM_TIMEOUT_SECONDS,
        max_retries=0,
    )


def _is_retryable(e: Exception) -> bool:
    """Rate limits (429) and transient server errors (5xx, incl. the 503
    that exposed the hang this module fixes) and connection/timeout errors
    (incl. our own configured LLM_TIMEOUT_SECONDS firing) are retried --
    a blip that's likely to clear. A 4xx that isn't a rate limit (bad
    request, auth failure, model-not-found, credit exhaustion) is NOT --
    retrying can't fix any of those, so it propagates immediately instead
    of wasting attempts."""
    if isinstance(e, (anthropic.RateLimitError, openai.RateLimitError)):
        return True
    status = getattr(e, "status_code", None)
    if isinstance(status, int) and 500 <= status < 600:
        return True
    # Covers APITimeoutError (both SDKs subclass it from APIConnectionError).
    if isinstance(e, (anthropic.APIConnectionError, openai.APIConnectionError)):
        return True
    return False


class _RpmThrottle:
    """Sliding-window requests-per-minute limiter shared across every call
    this process makes, regardless of provider. LLM_RPM_LIMIT=0 (the
    default) disables it entirely -- no sleep, no window tracking, so the
    Anthropic default path's timing is exactly what it was before this
    existed. Thread-safe (a lock around the deque) even though this
    project's eval/CLI usage is single-threaded, since the API server
    itself may serve concurrent requests.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._call_times: deque[float] = deque()

    def wait(self) -> None:
        limit = settings.LLM_RPM_LIMIT
        if limit <= 0:
            return
        with self._lock:
            now = time.monotonic()
            window_start = now - 60.0
            while self._call_times and self._call_times[0] < window_start:
                self._call_times.popleft()
            if len(self._call_times) >= limit:
                sleep_for = 60.0 - (now - self._call_times[0])
                if sleep_for > 0:
                    logger.info(
                        "LLM_RPM_LIMIT=%d reached, self-throttling for %.1fs", limit, sleep_for
                    )
                    time.sleep(sleep_for)
                now = time.monotonic()
                window_start = now - 60.0
                while self._call_times and self._call_times[0] < window_start:
                    self._call_times.popleft()
            self._call_times.append(now)


_throttle = _RpmThrottle()


def _log_rate_limit_headers(headers) -> None:
    """One-line capture of whatever x-ratelimit-* headers the provider
    sent back, so the actual limits/remaining-quota this key gets are in
    the log instead of inferred from documentation -- see both _call()
    closures below, which fetch raw responses (not the parsed object)
    specifically so these headers are reachable at all."""
    rl = {k: v for k, v in headers.items() if k.lower().startswith("x-ratelimit")}
    if rl:
        logger.info("Rate-limit headers: %s", rl)


def _with_backoff(fn):
    """Retries `fn` on a retryable error (see _is_retryable) up to
    _MAX_RETRIES total attempts -- 5 HTTP requests, worst case, per
    complete() call (see the module-level comment on retry layering for
    why that's an exact bound, not just "bounded"). Exponential backoff
    from _BACKOFF_BASE_SECONDS, capped at _BACKOFF_MAX_SECONDS, plus up to
    1s of jitter so multiple callers (e.g. concurrent API requests) don't
    retry in lockstep. A non-retryable error propagates immediately on
    its first occurrence, no wasted attempts.

    Logs wall-clock latency for EVERY attempt, success or failure -- the
    only way to see the actual latency distribution (including how long a
    timeout takes to fire) instead of guessing at it from aggregate
    request counts."""
    for attempt in range(_MAX_RETRIES):
        _throttle.wait()
        start = time.monotonic()
        try:
            result = fn()
            logger.info(
                "LLM call succeeded (attempt %d/%d) in %.2fs",
                attempt + 1, _MAX_RETRIES, time.monotonic() - start,
            )
            return result
        except Exception as e:
            elapsed = time.monotonic() - start
            if not _is_retryable(e):
                logger.info(
                    "LLM call failed non-retryably (attempt %d/%d) after %.2fs: %s",
                    attempt + 1, _MAX_RETRIES, elapsed, e,
                )
                raise
            if attempt == _MAX_RETRIES - 1:
                logger.info(
                    "LLM call failed (attempt %d/%d, retries exhausted) after %.2fs: %s",
                    attempt + 1, _MAX_RETRIES, elapsed, e,
                )
                raise
            delay = min(_BACKOFF_MAX_SECONDS, _BACKOFF_BASE_SECONDS * (2**attempt)) + random.uniform(0, 1)
            logger.warning(
                "Retryable LLM error (attempt %d/%d) after %.2fs: %s -- retrying in %.1fs",
                attempt + 1, _MAX_RETRIES, elapsed, e, delay,
            )
            time.sleep(delay)
    raise AssertionError("unreachable")  # loop always returns or raises


# Running totals for prompt-cache verification (e.g. eval/runner.py's
# summary). Anthropic-only -- stays at zero for other providers, since
# cache_system is a no-op there. Not thread-safe -- fine for this
# project's single-process, single-threaded eval/CLI usage.
_cache_creation_tokens = 0
_cache_read_tokens = 0


def get_cache_stats() -> dict:
    return {
        "cache_creation_input_tokens": _cache_creation_tokens,
        "cache_read_input_tokens": _cache_read_tokens,
    }


# Usage from the MOST RECENT successful complete() call, normalized across
# providers (Anthropic's usage.input_tokens/output_tokens vs. the
# OpenAI-compatible usage.prompt_tokens/completion_tokens) -- measured
# cost, not the tiktoken-approximated estimate used before real usage data
# existed. Deliberately only updated on a SUCCESSFUL return: a call that
# exhausts _with_backoff's retries raises before reaching the assignment,
# so a failed call correctly contributes nothing here rather than
# re-reporting the previous call's usage -- a rejected request (429/503/
# timeout) was never billed, so it should never be counted. Callers that
# need per-call attribution (e.g. eval/runner.py, tagging each result
# record with the tokens ITS calls used) must read this immediately after
# each complete() call, before the next one overwrites it -- see
# eval/runner.py's _counting_complete wrapper.
_last_usage = {"prompt_tokens": 0, "completion_tokens": 0}


def get_last_usage() -> dict:
    return dict(_last_usage)


# What LLM_MODEL actually resolved to on the MOST RECENT successful call --
# matters most for a floating "latest"-style alias (e.g. gemini-flash-lite-
# latest), which can silently repoint at a different underlying model at
# any time with no other way to detect it after the fact. None if the
# provider's response never exposed a resolved-model field at all (see
# _extract_resolved_model's docstring) -- callers should fall back to the
# models-list `version` metadata field + retrieval date in that case, and
# eval/README.md documents when that fallback is actually needed.
_last_resolved_model: str | None = None


def get_last_resolved_model() -> str | None:
    return _last_resolved_model


def _extract_resolved_model(raw, parsed) -> str | None:
    """Gemini's NATIVE API reports a `modelVersion` field showing exactly
    what a floating alias resolved to; the standard OpenAI chat-completions
    schema instead has a plain `model` field for the same purpose. Try the
    raw JSON body for `modelVersion` first (in case Gemini's OpenAI-
    compatible shim passes it through as a non-standard extra field), then
    `model` from that same raw body, then fall back to whatever the SDK's
    typed response model already parsed into `.model` (`parsed` -- the
    SAME object the caller already obtained via raw.parse(), passed in
    rather than re-parsed here, since re-reading the response body a
    second time is not guaranteed safe). Returns None, not an exception,
    if none of these are present -- this is a best-effort provenance
    capture, not something callers should depend on always succeeding.
    """
    try:
        body = json.loads(raw.text)
        if isinstance(body, dict):
            if body.get("modelVersion"):
                return body["modelVersion"]
            if body.get("model"):
                return body["model"]
    except Exception:
        pass
    return getattr(parsed, "model", None)


def _complete_anthropic(system: str, user: str, cache_system: bool) -> str:
    client = get_client()
    system_param = (
        [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]
        if cache_system
        else system
    )

    def _call():
        raw = client.messages.with_raw_response.create(
            model=settings.LLM_MODEL,
            max_tokens=settings.MAX_OUTPUT_TOKENS,
            system=system_param,
            messages=[{"role": "user", "content": user}],
        )
        _log_rate_limit_headers(raw.headers)
        return raw.parse()

    response = _with_backoff(_call)

    if cache_system:
        global _cache_creation_tokens, _cache_read_tokens
        _cache_creation_tokens += getattr(response.usage, "cache_creation_input_tokens", 0) or 0
        _cache_read_tokens += getattr(response.usage, "cache_read_input_tokens", 0) or 0

    global _last_usage, _last_resolved_model
    _last_usage = {
        "prompt_tokens": getattr(response.usage, "input_tokens", 0) or 0,
        "completion_tokens": getattr(response.usage, "output_tokens", 0) or 0,
    }
    _last_resolved_model = getattr(response, "model", None)

    return "".join(block.text for block in response.content if block.type == "text")


def _complete_openai_compatible(system: str, user: str) -> str:
    client = _get_openai_compatible_client(settings.LLM_PROVIDER)

    def _call():
        raw = client.chat.completions.with_raw_response.create(
            model=settings.LLM_MODEL,
            max_tokens=settings.MAX_OUTPUT_TOKENS,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
        _log_rate_limit_headers(raw.headers)
        parsed = raw.parse()
        global _last_resolved_model
        _last_resolved_model = _extract_resolved_model(raw, parsed)
        return parsed

    response = _with_backoff(_call)

    global _last_usage
    usage = getattr(response, "usage", None)
    _last_usage = {
        "prompt_tokens": getattr(usage, "prompt_tokens", 0) or 0 if usage else 0,
        "completion_tokens": getattr(usage, "completion_tokens", 0) or 0 if usage else 0,
    }

    return response.choices[0].message.content or ""


def complete(system: str, user: str, cache_system: bool = False) -> str:
    """Send a single-turn request and return the model's text output.

    cache_system=True marks `system` as an ephemeral prompt-cache breakpoint
    on the Anthropic path (a content block with cache_control), for callers
    whose system prompt is byte-identical across repeated calls -- e.g. the
    schema block in app.generation.generator, which doesn't change between
    questions or repeats. Anthropic requires ~1024+ tokens in the cached
    prefix for it to actually cache; shorter prefixes silently no-op (no
    error, no hit). On the Gemini/Groq path this flag is accepted but has
    no effect -- neither's OpenAI-compatible surface exposes prompt
    caching, so there's nothing to set; this is a silent no-op, not an
    error, so callers don't need a provider-specific branch.
    """
    provider = settings.LLM_PROVIDER
    if provider == "anthropic":
        return _complete_anthropic(system, user, cache_system)
    if provider in _PROVIDER_BASE_URLS:
        return _complete_openai_compatible(system, user)
    raise ValueError(
        f"Unknown LLM_PROVIDER {provider!r}. Supported: 'anthropic', "
        f"{', '.join(repr(p) for p in _PROVIDER_BASE_URLS)}."
    )


__all__ = ["complete", "get_client", "get_cache_stats", "get_last_usage", "get_last_resolved_model"]
