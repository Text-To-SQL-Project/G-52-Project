"""
Models for POST /auth/login. Deliberately outside app/api/models.py (the
fixed core query/schema/history contract) and outside the /v1 prefix
entirely -- see app/auth.py's require_auth() docstring for why login
can't live behind the same dependency it grants access to.
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    password: str


class LoginResponse(BaseModel):
    token: str
    expires_in: int = Field(..., description="Seconds until the token expires.")
