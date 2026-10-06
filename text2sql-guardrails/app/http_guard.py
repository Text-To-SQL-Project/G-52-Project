"""
HTTP-layer hardening shared by every route: per-key rate limits, security
headers, request ids and one access-log line per request.

ponytail: rate-limit state lives in this process. Fine for one API process
(uvicorn serves sync routes from a thread pool); move it to Redis before
running several replicas, or each replica gets its own full budget.
"""
from __future__ import annotations

import logging
import os
import threading
import time
import uuid
from collections import defaultdict, deque

from fastapi import Depends, HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware

from app.auth import require_auth
from app.config import settings
from app.users import Principal

logger = logging.getLogger("app.access")


class SlidingWindowLimiter:
    """At most `limit` hits per key in any rolling `window` seconds."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def retry_after(self, key: str, limit: int, window: float = 60.0) -> int:
        """Record a hit and return 0, or return the seconds until one is allowed."""
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and hits[0] <= now - window:
                hits.popleft()
            if len(hits) >= limit:
                return max(1, int(hits[0] + window - now) + 1)
            hits.append(now)
            if len(self._hits) > 10_000:  # bound memory under a key-spraying client
                for k in [k for k, v in self._hits.items() if not v]:
                    del self._hits[k]
            return 0


_limiter = SlidingWindowLimiter()


def _enforce(key: str, limit: int) -> None:
    if limit <= 0:
        return
    wait = _limiter.retry_after(key, limit)
    if wait:
        raise HTTPException(
            status_code=429,
            detail=f"Too many requests. Try again in {wait} s.",
            headers={"Retry-After": str(wait)},
        )


def client_ip(request: Request) -> str:
    # On Vercel (VERCEL=1 is set by the platform) every request arrives from
    # Vercel's edge, which writes the real client address into
    # x-vercel-forwarded-for and overwrites any client-sent value, so it's
    # trustworthy there and only there. Elsewhere request.client is the real
    # peer (uvicorn --proxy-headers handles a trusted proxy).
    if os.environ.get("VERCEL") == "1":
        ip = request.headers.get("x-vercel-forwarded-for", "").split(",")[0].strip()
        if ip:
            return ip
    return request.client.host if request.client else "unknown"


def limit_login(request: Request) -> None:
    """Per-IP: slows password guessing without locking out the account."""
    _enforce(f"login:{client_ip(request)}", settings.RATE_LIMIT_LOGIN_PER_MIN)


def limit_query(principal: Principal = Depends(require_auth)) -> None:
    """Per-user: each question costs LLM quota, so one user can't drain it."""
    _enforce(f"query:{principal.user_id}", settings.RATE_LIMIT_QUERY_PER_MIN)


_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    # The API only ever returns JSON; the interactive docs need their CDN assets.
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Cross-Origin-Opener-Policy": "same-origin",
}
_DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")


class GuardMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID", "")[:64] or uuid.uuid4().hex[:16]
        start = time.perf_counter()
        response = await call_next(request)
        ms = (time.perf_counter() - start) * 1000
        for k, v in _SECURITY_HEADERS.items():
            if k == "Content-Security-Policy" and request.url.path.startswith(_DOCS_PATHS):
                continue
            response.headers.setdefault(k, v)
        if settings.ENV == "prod":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["X-Request-ID"] = request_id
        # Path only: query strings and bodies may carry questions or tokens.
        logger.info(
            "%s %s %s %.0fms ip=%s rid=%s",
            request.method, request.url.path, response.status_code, ms, client_ip(request), request_id,
        )
        return response
