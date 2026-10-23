"""
Live pipeline trace for POST /v1/query/stream.

Two audiences, decided per request on the SERVER:
  - everyone gets `stage` events: a stage name and its wall time. Generic
    across any database, so they disclose nothing a QueryResponse doesn't.
  - developers additionally get `log` events: the pipeline's own detail
    (generated SQL, refusal reasons, signal scores) and every `app.*` log
    record emitted while serving the request. These carry SQL and schema
    identifiers, the same things client_messages.py keeps out of
    non-success responses, so they are gated on DEV_TRACE_KEY, never on a
    role: an admin is still a user of the product, not its developer.

The sink lives in a ContextVar, so pipeline code just calls event()/log()
and pays nothing when no stream is listening (plain /v1/query, eval).
"""
from __future__ import annotations

import hmac
import logging
import time
from contextvars import ContextVar, Token
from typing import Any, Callable

from app.config import settings

Emit = Callable[[dict[str, Any]], None]
_sink: ContextVar[tuple[Emit, bool, float] | None] = ContextVar("trace_sink", default=None)


def dev_allowed(key: str | None) -> bool:
    """True only when DEV_TRACE_KEY is configured and `key` matches it."""
    secret = settings.DEV_TRACE_KEY
    return bool(secret and key and hmac.compare_digest(key.encode(), secret.encode()))


def bind(emit: Emit, dev: bool) -> Token:
    return _sink.set((emit, dev, time.perf_counter()))


def unbind(token: Token) -> None:
    _sink.reset(token)


def stage(name: str, ms: float) -> None:
    sink = _sink.get()
    if sink:
        sink[0]({"t": "stage", "stage": name, "ms": ms})


def log(msg: str, level: str = "INFO", **data: Any) -> None:
    """Developer-only detail line. Never reaches a non-developer stream."""
    sink = _sink.get()
    if not sink or not sink[1]:
        return
    sink[0]({
        "t": "log",
        "level": level,
        "src": "pipeline",
        "msg": msg,
        "at": round((time.perf_counter() - sink[2]) * 1000, 1),
        **({"data": data} if data else {}),
    })


class _StreamHandler(logging.Handler):
    """Forwards app.* log records to the developer stream of the request
    being served in this thread/context; a no-op everywhere else."""

    def emit(self, record: logging.LogRecord) -> None:
        sink = _sink.get()
        if not sink or not sink[1] or not record.name.startswith("app"):
            return
        try:
            sink[0]({
                "t": "log",
                "level": record.levelname,
                "src": record.name,
                "msg": record.getMessage(),
                "at": round((time.perf_counter() - sink[2]) * 1000, 1),
            })
        except Exception:  # a broken stream must never break the request
            pass


def install_log_forwarding() -> None:
    root = logging.getLogger()
    if not any(isinstance(h, _StreamHandler) for h in root.handlers):
        root.addHandler(_StreamHandler())
    # INFO is where the pipeline's decisions are logged; don't depend on
    # whoever configured the root logger first (pytest, uvicorn) to allow it.
    app_logger = logging.getLogger("app")
    if app_logger.getEffectiveLevel() > logging.INFO:
        app_logger.setLevel(logging.INFO)
