"""
POST /auth/login -- deliberately its own router, outside /v1 and never
included with require_auth as a dependency (see app/auth.py's docstring).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from app.api.auth_models import LoginRequest, LoginResponse, MeResponse
from app.auth import TOKEN_TTL_SECONDS, authenticate, create_token, require_auth
from app.config import settings
from app.http_guard import limit_login
from app.users import Principal

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)


@router.post("/login", response_model=LoginResponse, dependencies=[Depends(limit_login)])
def login(req: LoginRequest) -> LoginResponse:
    if not settings.SECRET_KEY:
        # A server misconfiguration, not a credential problem. An empty
        # HMAC key would still "work" while making every token trivially
        # forgeable, so refuse rather than issue one.
        logger.error("Login attempted but SECRET_KEY is not set.")
        raise HTTPException(status_code=500, detail="Authentication is not configured.")

    principal = authenticate(req.username, req.password)
    if principal is None:
        # ONE response for unknown username, wrong password and
        # deactivated account. authenticate() also equalises the timing of
        # all three, so neither the body nor the latency is a username
        # oracle.
        logger.info("Failed login attempt for username=%r", req.username)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    return LoginResponse(
        token=create_token(principal.user_id),
        expires_in=TOKEN_TTL_SECONDS,
        username=principal.username,
        role=principal.role,
    )


@router.get("/me", response_model=MeResponse)
def me(principal: Principal = Depends(require_auth)) -> MeResponse:
    """The caller as the SERVER sees them right now, not as their token
    claims. Because role and is_active are re-read per request, a client
    left open across a role change can call this to resync instead of
    showing stale permissions until the token expires.

    Gated by its own require_auth rather than the router-level dependency,
    since this router is intentionally ungated for the login route.
    """
    return MeResponse(
        user_id=principal.user_id,
        username=principal.username,
        role=principal.role,
        student_id=principal.student_id,
        faculty_id=principal.faculty_id,
    )
