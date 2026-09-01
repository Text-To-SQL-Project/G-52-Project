"""
Minimal auth, deliberately scoped (Task 4): one shared operator password,
read from OPERATOR_PASSWORD -- no users table, no registration, no
password reset, no roles, no per-user anything. A successful login gets a
signed, time-limited session token; a FastAPI dependency validates it on
every gated route.

Stdlib-only signing (hmac + hashlib), not a JWT library: the token carries
exactly one claim (an expiry) and needs no algorithm negotiation, issuer,
audience, or any of the rest of the JWT surface -- a dependency for that
would be scope creep for what this is.

Explicitly out of scope, per Task 4: multiple users, roles, per-user
history, OAuth, refresh tokens, rate limiting.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import time

from fastapi import Header, HTTPException

from app.config import settings

logger = logging.getLogger(__name__)

TOKEN_TTL_SECONDS = 12 * 60 * 60  # 12 hours


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _b64decode(data: str) -> bytes:
    padded = data + "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(padded)


def _sign(payload: bytes) -> str:
    digest = hmac.new(settings.SECRET_KEY.encode(), payload, hashlib.sha256).digest()
    return _b64encode(digest)


def create_token() -> str:
    """Issue a signed token good for TOKEN_TTL_SECONDS from now. Carries
    only an expiry -- there's no user identity to embed (one shared
    password, not per-user accounts)."""
    payload = json.dumps({"exp": int(time.time()) + TOKEN_TTL_SECONDS}).encode()
    return f"{_b64encode(payload)}.{_sign(payload)}"


def _token_is_valid(token: str) -> bool:
    try:
        payload_b64, signature = token.split(".", 1)
        payload = _b64decode(payload_b64)
    except Exception:
        return False
    if not hmac.compare_digest(signature, _sign(payload)):
        return False
    try:
        exp = json.loads(payload)["exp"]
    except (json.JSONDecodeError, KeyError, TypeError):
        return False
    return int(exp) > int(time.time())


def check_password(password: str) -> bool:
    """Constant-time comparison against OPERATOR_PASSWORD -- avoids a
    timing side-channel on how many leading characters matched."""
    if not settings.OPERATOR_PASSWORD:
        return False
    return hmac.compare_digest(password, settings.OPERATOR_PASSWORD)


def require_auth(authorization: str | None = Header(default=None)) -> None:
    """FastAPI dependency gating every /v1/ route (see app/main.py, applied
    at include_router() so no individual route can forget it) except
    POST /auth/login itself, which lives outside the /v1 prefix entirely
    for exactly that reason -- you can't authenticate against a route that
    requires you to already be authenticated.

    Deliberately raises the IDENTICAL 401 for "no Authorization header",
    "malformed header", and "signature/expiry invalid" -- same reasoning
    as check_password() above: never tell the caller which specific thing
    about their credential was wrong.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.removeprefix("Bearer ").strip()
    if not token or not _token_is_valid(token):
        raise HTTPException(status_code=401, detail="Not authenticated")
