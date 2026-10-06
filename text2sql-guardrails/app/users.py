"""
Data access for app.users. Separated from app/auth.py so the token and
hashing logic there stays unit-testable without a database, which is how
every other test in this project is written.

Reads go through get_engine() (the owning role), never
get_readonly_engine(). The read-only role is what generated SQL executes
as, so anything it can reach is reachable by a sufficiently creative
generated query, and a credentials table is the last thing that should be
in that set. 29_users.sql revokes it explicitly; this is the other half of
the same decision.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from dataclasses import dataclass

from sqlalchemy import text

from app.config import settings
from app.db import get_engine

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Principal:
    """The authenticated caller, as resolved for THIS request.

    Deliberately not a mirror of the token payload. Only `user_id` comes
    from the token; role, is_active and the ERP links are read from the
    database on every request -- see app/auth.py::require_auth() for why
    that tradeoff is made in this direction.
    """
    user_id: int
    username: str
    role: str
    student_id: int | None
    faculty_id: int | None

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    def erp_identity(self) -> int | None:
        """The ERP row this principal is scoped to, whichever kind it is.
        Phase 2's RLS session variable comes from here."""
        return self.student_id if self.role == "student" else self.faculty_id


_SELECT_PRINCIPAL = (
    "SELECT user_id, username, role, student_id, faculty_id, is_active "
    "FROM app.users WHERE {predicate}"
)


def _row_to_principal(row) -> Principal:
    return Principal(
        user_id=row.user_id,
        username=row.username,
        role=row.role,
        student_id=row.student_id,
        faculty_id=row.faculty_id,
    )


# ---------------------------------------------------------------------------
# Per-request principal cache.
#
# require_auth() resolves role and is_active from the database on every
# request rather than trusting the token, so a demotion or a deactivation
# takes effect on the next call instead of whenever a 12-hour token happens
# to expire. That correctness is the point; this cache exists only to bound
# what it costs, and its TTL is the exact window during which a deactivated
# user can still act.
#
# Default 0 -- no caching, every request re-reads. See the Phase 1 report
# for the measured cost; on this workload the lookup is dwarfed by the LLM
# call it precedes, so paying it is the honest default. Raise
# AUTH_PRINCIPAL_CACHE_SECONDS only if a measurement says you need to, and
# treat whatever you set as your revocation latency.
# ---------------------------------------------------------------------------
_cache: dict[int, tuple[float, Principal | None]] = {}
_cache_lock = threading.Lock()


def invalidate_principal(user_id: int | None = None) -> None:
    """Drop cached principals. Called after any write that changes a user's
    role or active status; pass None to clear everything."""
    with _cache_lock:
        if user_id is None:
            _cache.clear()
        else:
            _cache.pop(user_id, None)


def load_principal(user_id: int) -> Principal | None:
    """Resolve a user_id to a Principal, or None if the user does not exist
    or is deactivated.

    Returning None for a deactivated user (rather than a Principal with a
    flag) means a caller cannot forget to check it -- the only way to get a
    Principal out of this function is to be an active user.
    """
    ttl = max(0, int(getattr(settings, "AUTH_PRINCIPAL_CACHE_SECONDS", 0)))
    now = time.monotonic()

    if ttl:
        with _cache_lock:
            hit = _cache.get(user_id)
            if hit is not None and hit[0] > now:
                return hit[1]

    with get_engine().connect() as conn:
        row = conn.execute(
            text(_SELECT_PRINCIPAL.format(predicate="user_id = :uid")),
            {"uid": user_id},
        ).one_or_none()

    principal = _row_to_principal(row) if (row is not None and row.is_active) else None

    if ttl:
        with _cache_lock:
            # Negative results are cached too, for the same TTL: a token for
            # a deleted or deactivated user would otherwise hit the database
            # on every request, which is the cheapest denial-of-service in
            # the app.
            _cache[user_id] = (now + ttl, principal)

    return principal


def find_by_username(username: str) -> tuple[Principal, str] | None:
    """Look up an ACTIVE user and their password hash, for the login path.

    Returns None for both "no such user" and "user is deactivated" so the
    caller cannot accidentally distinguish them in a response. The timing
    side of that guarantee is handled in app/auth.py::authenticate(), which
    verifies against a dummy hash when this returns None.
    """
    with get_engine().connect() as conn:
        row = conn.execute(
            text(
                "SELECT user_id, username, role, student_id, faculty_id, "
                "is_active, password_hash FROM app.users WHERE username = :u"
            ),
            {"u": username},
        ).one_or_none()

    if row is None or not row.is_active:
        return None
    return _row_to_principal(row), row.password_hash


def update_password_hash(user_id: int, new_hash: str) -> None:
    """Persist a rehash after an Argon2 parameter change (see
    app/auth.py::authenticate)."""
    with get_engine().begin() as conn:
        conn.execute(
            text("UPDATE app.users SET password_hash = :h WHERE user_id = :uid"),
            {"h": new_hash, "uid": user_id},
        )
    invalidate_principal(user_id)


# ---------------------------------------------------------------------------
# Google sign-in: email is how a Google account finds its existing user.
# ---------------------------------------------------------------------------

def find_by_email(email: str) -> Principal | None:
    """ACTIVE user whose linked email matches (case-insensitive), else None."""
    with get_engine().connect() as conn:
        row = conn.execute(
            text(_SELECT_PRINCIPAL.format(predicate="lower(email) = lower(:e)")),
            {"e": email},
        ).one_or_none()
    if row is None or not row.is_active:
        return None
    return _row_to_principal(row)


def list_users() -> list[dict]:
    with get_engine().connect() as conn:
        rows = conn.execute(text(
            "SELECT user_id, username, role, email, is_active FROM app.users ORDER BY role, username"
        )).mappings().all()
    return [dict(r) for r in rows]


class EmailTaken(Exception):
    pass


def set_email(user_id: int, email: str | None) -> bool:
    """Link (or with None, unlink) an email. Returns False for an unknown user."""
    from sqlalchemy.exc import IntegrityError

    released: list[int] = []
    try:
        with get_engine().begin() as conn:
            if email:
                # An auto-created guest (open Google sign-up) may already hold
                # this address. Linking it to a real account takes it over: the
                # guest is unlinked and deactivated in the same transaction.
                released = [r[0] for r in conn.execute(
                    text(
                        "UPDATE app.users SET email = NULL, is_active = false "
                        "WHERE lower(email) = lower(:e) AND role = 'guest' AND user_id <> :u "
                        "AND EXISTS (SELECT 1 FROM app.users WHERE user_id = :u) "
                        "RETURNING user_id"
                    ),
                    {"e": email, "u": user_id},
                )]
            n = conn.execute(
                text("UPDATE app.users SET email = :e WHERE user_id = :u"),
                {"e": email.lower() if email else None, "u": user_id},
            ).rowcount
    except IntegrityError as e:
        raise EmailTaken from e
    for uid in (user_id, *released):
        invalidate_principal(uid)
    return n == 1


def email_exists(email: str) -> bool:
    """Any user (active or not) already owns this email."""
    with get_engine().connect() as conn:
        return conn.execute(
            text("SELECT 1 FROM app.users WHERE lower(email) = lower(:e)"), {"e": email}
        ).first() is not None


def create_guest(email: str, password_hash: str) -> Principal | None:
    """New 'guest' user for an unlinked Google account. Username comes from
    the email's local part, made unique with a numeric suffix. password_hash
    is a hash of a random secret nobody knows, so the account can only sign
    in through Google. Returns None if the email was taken concurrently."""
    from sqlalchemy.exc import IntegrityError

    base = re.sub(r"[^a-z0-9._-]", "", email.split("@", 1)[0].lower())[:32] or "user"
    with get_engine().connect() as conn:
        taken = {r[0] for r in conn.execute(
            text("SELECT username FROM app.users WHERE username = :b OR username LIKE :p"),
            {"b": base, "p": base + "%"},
        )}
    username = base if base not in taken else next(
        f"{base}{i}" for i in range(2, 10_000) if f"{base}{i}" not in taken
    )
    try:
        with get_engine().begin() as conn:
            row = conn.execute(
                text(
                    "INSERT INTO app.users (username, password_hash, role, email) "
                    "VALUES (:u, :h, 'guest', lower(:e)) "
                    "RETURNING user_id, username, role, student_id, faculty_id, is_active"
                ),
                {"u": username, "h": password_hash, "e": email},
            ).one()
    except IntegrityError:
        return None  # same email or username created by a parallel request
    logger.info("Created guest user_id=%s via Google sign-up", row.user_id)
    return _row_to_principal(row)
