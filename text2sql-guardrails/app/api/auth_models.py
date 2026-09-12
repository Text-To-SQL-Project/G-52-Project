"""
Models for POST /auth/login. Deliberately outside app/api/models.py (the
fixed core query/schema/history contract) and outside the /v1 prefix
entirely -- see app/auth.py's require_auth() docstring for why login
can't live behind the same dependency it grants access to.
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=1)


class LoginResponse(BaseModel):
    token: str
    expires_in: int = Field(..., description="Seconds until the token expires.")
    # Returned so the client can render the current user and decide whether
    # to show the Admin tab, WITHOUT inferring either from the token. The
    # token carries neither; both are re-read server-side on every request
    # (see app/auth.py). These fields are a display convenience and are
    # never treated as an authorisation input -- hiding a tab is
    # presentation, the API enforces access independently.
    username: str
    role: str


class MeResponse(BaseModel):
    """GET /v1/auth/me -- the caller's identity as the server currently
    sees it, so a client that has been open across a role change can
    refresh without logging out."""
    user_id: int
    username: str
    role: str
    student_id: int | None = None
    faculty_id: int | None = None
