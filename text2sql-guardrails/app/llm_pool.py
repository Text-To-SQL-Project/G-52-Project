"""
Admin-managed AI key pool, backed by a LiteLLM proxy (docker-compose
service `litellm`).

The proxy owns the keys (encrypted at rest with LITELLM_SALT_KEY in its own
database), routes each request to the fastest healthy deployment, retries
and cools down failing ones. This module only:
  - decides whether the interactive app uses the pool (app_provider),
  - relays admin add/list/delete/health calls to the proxy's admin API,
  - keeps app-observed latency per deployment for the Admin screen.

Provider keys never come back out: the proxy doesn't return them and this
module only ever stores a 4-character hint in the deployment's model_info.
"""
from __future__ import annotations

import re
import threading
import time

import httpx

from app.config import settings

_READY_TTL_SECONDS = 30
_ready_cache: tuple[float, bool] = (0.0, False)
# Circuit breaker: after the pool fails a request, app queries skip it for
# the proxy's own cooldown window instead of paying the failure again.
_COOLDOWN_SECONDS = 30
_down_until = 0.0
_stats_lock = threading.Lock()
_stats: dict[str, dict] = {}  # model_id -> {requests, avg_ms, last_ms, last_at}


class PoolError(RuntimeError):
    """The proxy is unreachable or rejected an admin call. Message is safe to show."""


def configured() -> bool:
    return bool(settings.LITELLM_URL and settings.LITELLM_MASTER_KEY)


def _request(method: str, path: str, *, timeout: float = 5.0, ok_statuses: tuple[int, ...] = (), **kw) -> dict:
    if not configured():
        raise PoolError("Key pool is not configured (set LITELLM_URL and LITELLM_MASTER_KEY).")
    try:
        r = httpx.request(
            method,
            settings.LITELLM_URL.rstrip("/") + path,
            headers={"Authorization": f"Bearer {settings.LITELLM_MASTER_KEY}"},
            timeout=timeout,
            **kw,
        )
    except httpx.HTTPError as e:
        raise PoolError(f"Key pool service unreachable: {type(e).__name__}") from e
    if r.status_code >= 400 and r.status_code not in ok_statuses:
        try:
            detail = r.json().get("error", {}).get("message") or r.json().get("detail") or r.text
        except ValueError:
            detail = r.text
        raise PoolError(f"Key pool rejected the request ({r.status_code}): {str(detail)[:300]}")
    return r.json() if r.content else {}


def list_deployments() -> list[dict]:
    """Deployments in our model group, shaped for the Admin screen."""
    data = _request("GET", "/model/info").get("data", [])
    out = []
    for d in data:
        if d.get("model_name") != settings.LITELLM_MODEL_GROUP:
            continue
        info = d.get("model_info") or {}
        params = d.get("litellm_params") or {}
        provider, _, model = (params.get("model") or "").partition("/")
        mid = info.get("id", "")
        with _stats_lock:
            st = dict(_stats.get(mid, {}))
        out.append({
            "id": mid,
            "provider": provider,
            "model": model,
            "label": info.get("label") or "",
            "key_hint": info.get("key_hint") or "",
            "api_base": params.get("api_base"),
            "requests": st.get("requests", 0),
            "avg_latency_ms": st.get("avg_ms"),
            "last_used_at": st.get("last_at"),
        })
    return out


def add_deployment(*, provider: str, model: str, api_key: str, api_base: str | None, label: str) -> None:
    params = {"model": f"{provider}/{model}", "api_key": api_key}
    if api_base:
        params["api_base"] = api_base
    _request("POST", "/model/new", json={
        "model_name": settings.LITELLM_MODEL_GROUP,
        "litellm_params": params,
        "model_info": {"label": label, "key_hint": api_key[-4:] if len(api_key) >= 8 else ""},
    })
    _invalidate_ready()


def delete_deployment(model_id: str) -> None:
    _request("POST", "/model/delete", json={"id": model_id})
    with _stats_lock:
        _stats.pop(model_id, None)
    _invalidate_ready()


def health() -> dict:
    """Asks the proxy to send one tiny request through every deployment.
    Costs one call per key, so it's an explicit admin action."""
    # The proxy answers 503 (with the full report) when any key is unhealthy.
    data = _request(
        "GET", "/health", params={"model": settings.LITELLM_MODEL_GROUP}, timeout=60.0, ok_statuses=(503,)
    )
    # Endpoints carry provider/model (+ api_base), not our deployment id: map back.
    by_target: dict[tuple, list[str]] = {}
    for d in list_deployments():
        by_target.setdefault((f"{d['provider']}/{d['model']}", d["api_base"]), []).append(d["id"])

    def ids(e: dict) -> list[str]:
        explicit = (e.get("model_info") or {}).get("id") or e.get("model_id")
        return [explicit] if explicit else by_target.get((e.get("model", ""), e.get("api_base")), [])

    return {
        "healthy": [i for e in data.get("healthy_endpoints", []) for i in ids(e)],
        "unhealthy": [
            {"id": i, "error": _short_error(e.get("error"))}
            for e in data.get("unhealthy_endpoints", []) for i in ids(e)
        ],
    }


def _short_error(err) -> str:
    """'litellm.BadRequestError: GroqException - {"error":{"message":"Invalid API Key"...'
    -> 'BadRequestError: Invalid API Key'."""
    text = str(err or "unknown error").split("\n")[0]
    m = re.search(r'"message"\s*:\s*"([^"]+)"', text)
    head = text.split(" - ")[0].replace("litellm.", "")
    return (f"{head}: {m.group(1)}" if m else text)[:300]


def _invalidate_ready() -> None:
    refresh_ready()  # admin just changed the pool: reflect it immediately


_refreshing = threading.Lock()


def refresh_ready() -> bool:
    global _ready_cache
    try:
        ok = configured() and bool(list_deployments())
    except PoolError:
        ok = False
    _ready_cache = (time.monotonic(), ok)
    return ok


def ready() -> bool:
    """Pool reachable and holding at least one deployment. Never blocks the
    query path: a stale answer is served while a background thread
    re-checks (app.main warms it at startup)."""
    checked_at, ok = _ready_cache
    if not configured():
        return False
    if time.monotonic() - checked_at >= _READY_TTL_SECONDS and _refreshing.acquire(blocking=False):
        def run() -> None:
            try:
                refresh_ready()
            finally:
                _refreshing.release()
        threading.Thread(target=run, daemon=True, name="pool-ready").start()
    return ok


def mark_failed() -> None:
    global _down_until
    _down_until = time.monotonic() + _COOLDOWN_SECONDS


def app_provider() -> str:
    """Provider for the interactive /v1/query path (see APP_LLM_PROVIDER)."""
    choice = settings.APP_LLM_PROVIDER
    if choice == "auto":
        pool_ok = time.monotonic() >= _down_until and ready()
        return "litellm" if pool_ok else settings.LLM_PROVIDER
    return choice or settings.LLM_PROVIDER


def observe(model_id: str | None, headers) -> None:
    """Record proxy-reported latency for the deployment that served a call."""
    if not model_id:
        return
    try:
        ms = float(headers.get("x-litellm-response-duration-ms") or 0) or None
    except (TypeError, ValueError):
        ms = None
    with _stats_lock:
        st = _stats.setdefault(model_id, {"requests": 0, "avg_ms": None})
        st["requests"] += 1
        st["last_at"] = time.time()
        if ms is not None:
            st["last_ms"] = ms
            st["avg_ms"] = ms if st["avg_ms"] is None else round(0.8 * st["avg_ms"] + 0.2 * ms, 1)
