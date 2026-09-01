"""
POST /auth/login -- deliberately its own router, outside /v1 and never
included with require_auth as a dependency (see app/auth.py's docstring).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.api.auth_models import LoginRequest, LoginResponse
from app.auth import TOKEN_TTL_SECONDS, check_password, create_token
from app.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)


@router.post("/login", response_model=LoginResponse)
def login(req: LoginRequest) -> LoginResponse:
    if not settings.OPERATOR_PASSWORD:
        # Distinct from "wrong password" on purpose: this is a server
        # misconfiguration, not a client credential problem, and saying so
        # doesn't leak anything about what the (nonexistent) real password
        # might be.
        logger.error("Login attempted but OPERATOR_PASSWORD is not set.")
        raise HTTPException(status_code=500, detail="Authentication is not configured.")
    if not check_password(req.password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return LoginResponse(token=create_token(), expires_in=TOKEN_TTL_SECONDS)
