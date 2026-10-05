"""
POST /auth/login -- deliberately its own router, outside /v1 and never
included with require_auth as a dependency (see app/auth.py's docstring).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from app.api.auth_models import AuthProviders, GoogleLoginRequest, LoginRequest, LoginResponse, MeResponse
from app.auth import TOKEN_TTL_SECONDS, authenticate, create_token, require_auth
from app.config import settings
from app.http_guard import limit_login
from app.users import Principal, find_by_email

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


@router.get("/providers", response_model=AuthProviders)
def providers() -> AuthProviders:
    """Which sign-in methods to show. Public: the Google client ID is not a secret."""
    return AuthProviders(google_client_id=settings.GOOGLE_CLIENT_ID or None)


_GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}


def verify_google_credential(credential: str) -> dict:
    """Signature, audience (our client ID), expiry and issuer, via Google's
    published keys. Raises ValueError on anything invalid."""
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token

    claims = id_token.verify_oauth2_token(
        credential, google_requests.Request(), settings.GOOGLE_CLIENT_ID, clock_skew_in_seconds=10
    )
    if claims.get("iss") not in _GOOGLE_ISSUERS:
        raise ValueError("wrong issuer")
    return claims


@router.post("/google", response_model=LoginResponse, dependencies=[Depends(limit_login)])
def login_with_google(req: GoogleLoginRequest) -> LoginResponse:
    """Sign in with a Google account that an administrator has linked to an
    existing user. Never creates accounts: role and the student/faculty link
    drive Row Level Security, so they can't come from a Google profile."""
    if not settings.GOOGLE_CLIENT_ID or not settings.SECRET_KEY:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured.")
    try:
        claims = verify_google_credential(req.credential)
    except Exception as e:  # never echo token details to the client
        logger.info("Rejected Google credential: %s", type(e).__name__)
        raise HTTPException(status_code=401, detail="Google sign-in failed. Please try again.")
    email = claims.get("email")
    if not email or claims.get("email_verified") is not True:
        raise HTTPException(status_code=401, detail="Your Google account's email is not verified.")
    principal = find_by_email(email)
    if principal is None:
        logger.info("Google sign-in for unlinked email domain=%s", email.rsplit("@", 1)[-1])
        raise HTTPException(
            status_code=403,
            detail="No account is linked to this Google address. Ask an administrator to link it.",
        )
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
