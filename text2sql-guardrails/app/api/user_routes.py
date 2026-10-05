"""
Admin: link Google sign-in emails to existing users.

    GET   /v1/admin/users              users with their linked email
    PATCH /v1/admin/users/{user_id}    {"email": "a@b.com" | null}
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.auth import require_admin
from app.users import EmailTaken, Principal, list_users, set_email

router = APIRouter(prefix="/v1/admin/users", tags=["admin"], dependencies=[Depends(require_admin)])
logger = logging.getLogger(__name__)


class UserRow(BaseModel):
    user_id: int
    username: str
    role: str
    email: Optional[str] = None
    is_active: bool


class SetEmail(BaseModel):
    email: Optional[str] = Field(None, max_length=254)

    @field_validator("email")
    @classmethod
    def plausible_email(cls, v: Optional[str]) -> Optional[str]:
        v = (v or "").strip()
        if not v:
            return None
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", v):
            raise ValueError("not a valid email address")
        return v.lower()


@router.get("", response_model=list[UserRow])
def get_users() -> list[UserRow]:
    return [UserRow(**u) for u in list_users()]


@router.patch("/{user_id}", response_model=list[UserRow])
def link_email(user_id: int, req: SetEmail, principal: Principal = Depends(require_admin)) -> list[UserRow]:
    try:
        found = set_email(user_id, req.email)
    except EmailTaken:
        raise HTTPException(status_code=409, detail="That email is already linked to another user.")
    if not found:
        raise HTTPException(status_code=404, detail="No such user.")
    logger.info("EMAIL %s for user_id=%s by admin user_id=%s",
                "linked" if req.email else "unlinked", user_id, principal.user_id)
    return get_users()
