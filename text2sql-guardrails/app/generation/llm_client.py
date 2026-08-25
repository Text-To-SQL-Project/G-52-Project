"""
Thin wrapper around the Anthropic Messages API. The client is constructed
lazily (only on first real call) so a missing/placeholder LLM_API_KEY does
not prevent the app from importing or starting -- it only fails when a
request actually needs the LLM.
"""
from __future__ import annotations

from functools import lru_cache

import anthropic

from app.config import settings


@lru_cache(maxsize=1)
def get_client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=settings.LLM_API_KEY)


# Running totals for prompt-cache verification (e.g. eval/runner.py's
# summary). Not thread-safe -- fine for this project's single-process,
# single-threaded eval/CLI usage.
_cache_creation_tokens = 0
_cache_read_tokens = 0


def get_cache_stats() -> dict:
    return {
        "cache_creation_input_tokens": _cache_creation_tokens,
        "cache_read_input_tokens": _cache_read_tokens,
    }


def complete(system: str, user: str, cache_system: bool = False) -> str:
    """Send a single-turn request and return the model's text output.

    cache_system=True marks `system` as an ephemeral prompt-cache breakpoint
    (a content block with cache_control), for callers whose system prompt is
    byte-identical across repeated calls -- e.g. the schema block in
    app.generation.generator, which doesn't change between questions or
    repeats. Anthropic requires ~1024+ tokens in the cached prefix for it to
    actually cache; shorter prefixes silently no-op (no error, no hit).
    """
    client = get_client()
    system_param = (
        [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]
        if cache_system
        else system
    )
    response = client.messages.create(
        model=settings.LLM_MODEL,
        max_tokens=settings.MAX_OUTPUT_TOKENS,
        system=system_param,
        messages=[{"role": "user", "content": user}],
    )

    if cache_system:
        global _cache_creation_tokens, _cache_read_tokens
        _cache_creation_tokens += getattr(response.usage, "cache_creation_input_tokens", 0) or 0
        _cache_read_tokens += getattr(response.usage, "cache_read_input_tokens", 0) or 0

    return "".join(block.text for block in response.content if block.type == "text")
