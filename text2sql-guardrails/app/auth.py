"""
Per-user authentication (Phase 1), replacing the single shared operator
password of Task 4. Real accounts in app.users, Argon2id password hashing,
and a signed session token that carries a user id and nothing else.

Stdlib-only signing (hmac + hashlib) is kept from the previous design. The
token still carries two claims and needs no algorithm negotiation, issuer,
audience, or the rest of the JWT surface; adding a JWT dependency to gain
that would be scope creep now just as it was then.

Two properties are worth stating plainly, because both are deliberate
departures from the obvious implementation and both belong in the writeup:

1. ROLE AND ACTIVE STATUS ARE NEVER TRUSTED FROM THE TOKEN. The payload
   holds `sub` (user id) and `exp`, full stop. Role, is_active and the ERP
   links are re-read from the database on every single request. Baking a
   role into a 12-hour token means a demotion does not take effect for up
   to 12 hours, and from Phase 2 onward that role also decides which rows
   Row Level Security will show -- an authorisation gap that widens into a
   data-exposure gap. A deactivated user holding a structurally valid token
   is rejected on their next request, not when the token expires.

2. ARGON2 PARAMETERS ARE PINNED HERE, NOT INHERITED. They currently equal
   argon2-cffi 25.1.0's defaults, but a library upgrade must not silently
   move numbers that are cited in a paper.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import time

from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Depends, Header, HTTPException

from app.config import settings
from app.users import Principal, find_by_username, load_principal, update_password_hash

logger = logging.getLogger(__name__)

TOKEN_TTL_SECONDS = 12 * 60 * 60  # 12 hours

# ---------------------------------------------------------------------------
# Argon2id parameters -- RFC 9106's second recommended option.
#
# RFC 9106 (Sept 2021) section 4 gives two recommended configurations. The
# first assumes 2 GiB of memory, which is not reasonable to demand of a
# request handler on a demo machine. The second is the one used here:
# Argon2id, t=3, m=64 MiB, p=4, 128-bit salt, 256-bit tag. It also satisfies
# the OWASP Password Storage Cheat Sheet minimum for Argon2id.
#
# Argon2id specifically, not Argon2i or Argon2d: it is the hybrid the RFC
# recommends for password hashing, resisting both side-channel and
# time-memory tradeoff attacks.
#
# Changing any of these is safe at runtime. The encoded PHC string records
# the parameters it was produced with, so authenticate() below detects an
# outdated hash and transparently rehashes on the user's next successful
# login. No migration, no forced password reset.
# ---------------------------------------------------------------------------
ARGON2_TYPE = Type.ID          # Argon2id
ARGON2_TIME_COST = 3           # t: passes
ARGON2_MEMORY_COST_KIB = 65536  # m: 64 MiB
ARGON2_PARALLELISM = 4         # p: lanes
ARGON2_HASH_LEN = 32           # 256-bit tag
ARGON2_SALT_LEN = 16           # 128-bit salt

_hasher = PasswordHasher(
    time_cost=ARGON2_TIME_COST,
    memory_cost=ARGON2_MEMORY_COST_KIB,
    parallelism=ARGON2_PARALLELISM,
    hash_len=ARGON2_HASH_LEN,
    salt_len=ARGON2_SALT_LEN,
    type=ARGON2_TYPE,
)

# Verified against when no user matches, so that a nonexistent username
# costs the same ~85ms as a real one. Without this, response time is a
# username oracle: the "user not found" path would return in the time of a
# single indexed SELECT while a real user pays for a full Argon2 verify.
_DUMMY_HASH = _hasher.hash("username-enumeration-timing-equaliser")


def argon2_parameters() -> dict[str, object]:
    """The parameter set in use, for the admin config endpoint and for
    citation. Reported rather than described so what the paper states and
    what the code does cannot drift apart."""
    return {
        "algorithm": "argon2id",
        "time_cost": ARGON2_TIME_COST,
        "memory_cost_kib": ARGON2_MEMORY_COST_KIB,
        "parallelism": ARGON2_PARALLELISM,
        "hash_len_bytes": ARGON2_HASH_LEN,
        "salt_len_bytes": ARGON2_SALT_LEN,
        "reference": "RFC 9106 second recommended option",
    }


# --- password hashing ------------------------------------------------------

def hash_password(password: str) -> str:
    """Encode a password as an Argon2id PHC string (algorithm, version,
    parameters and salt all travel inside it)."""
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    """Constant-time-ish verification, delegated to argon2-cffi. Never
    raises: a malformed stored hash is a rejected login, not a 500."""
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


# --- login -----------------------------------------------------------------

def authenticate(username: str, password: str) -> Principal | None:
    """Resolve credentials to a Principal, or None.

    One None for every failure mode -- unknown username, wrong password,
    deactivated account -- and the same wall-clock cost for each, so
    neither the response nor its timing distinguishes them.
    """
    found = find_by_username(username)

    if found is None:
        # Spend the same Argon2 work as a real verification would, then
        # fail. See _DUMMY_HASH.
        verify_password(_DUMMY_HASH, password)
        return None

    principal, stored_hash = found
    if not verify_password(stored_hash, password):
        return None

    # Parameters have moved since this hash was written: upgrade it now,
    # while the plaintext is in hand and already verified.
    try:
        if _hasher.check_needs_rehash(stored_hash):
            update_password_hash(principal.user_id, hash_password(password))
            logger.info("Rehashed password for user_id=%s at current Argon2 parameters.",
                        principal.user_id)
    except Exception:
        # A failed rehash must never fail an otherwise valid login.
        logger.exception("Rehash failed for user_id=%s; login still succeeds.",
                         principal.user_id)

    return principal


# --- tokens ----------------------------------------------------------------

def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _b64decode(data: str) -> bytes:
    padded = data + "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(padded)


def _sign(payload: bytes) -> str:
    digest = hmac.new(settings.SECRET_KEY.encode(), payload, hashlib.sha256).digest()
    return _b64encode(digest)


def create_token(user_id: int) -> str:
    """Issue a signed token good for TOKEN_TTL_SECONDS.

    Carries `sub` and `exp` and nothing else. Anything authorisation
    depends on -- role, is_active -- is deliberately absent, because a
    claim in a token is a claim frozen at issue time. See this module's
    docstring.
    """
    payload = json.dumps(
        {"sub": int(user_id), "exp": int(time.time()) + TOKEN_TTL_SECONDS}
    ).encode()
    return f"{_b64encode(payload)}.{_sign(payload)}"


def read_token_subject(token: str) -> int | None:
    """Verify signature and expiry, return the user id. None on any
    failure -- callers must not distinguish the reasons."""
    try:
        payload_b64, signature = token.split(".", 1)
        payload = _b64decode(payload_b64)
    except Exception:
        return None
    if not hmac.compare_digest(signature, _sign(payload)):
        return None
    try:
        claims = json.loads(payload)
        if int(claims["exp"]) <= int(time.time()):
            return None
        return int(claims["sub"])
    except (json.JSONDecodeError, KeyError, TypeError, ValueError):
        return None


# --- FastAPI dependencies --------------------------------------------------

_UNAUTHENTICATED = HTTPException(status_code=401, detail="Not authenticated")


def require_auth(authorization: str | None = Header(default=None)) -> Principal:
    """Gate every /v1 route and resolve the caller.

    Applied once at include_router() in app/main.py so no route can be
    added later and left unauthenticated by omission. Routes that need the
    caller's identity re-declare it as their own Depends(require_auth);
    FastAPI caches a dependency per request, so it still resolves once.

    Raises the IDENTICAL 401 for a missing header, a malformed header, a
    bad signature, an expired token, a deleted user and a deactivated user.
    That last pair matters: a valid token whose user has been switched off
    is indistinguishable from a forged one, from the client's side.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise _UNAUTHENTICATED
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise _UNAUTHENTICATED

    user_id = read_token_subject(token)
    if user_id is None:
        raise _UNAUTHENTICATED

    # The per-request read. Not an optimisation target: this is what makes
    # deactivation and demotion take effect now rather than in 12 hours.
    principal = load_principal(user_id)
    if principal is None:
        raise _UNAUTHENTICATED

    return principal


def require_admin(principal: Principal = Depends(require_auth)) -> Principal:
    """Admin-only routes. 403 rather than 401: the caller authenticated
    successfully, they are simply not allowed here, and pretending
    otherwise would be a lie a legitimate user has to debug."""
    if not principal.is_admin:
        raise HTTPException(status_code=403, detail="Administrator access required")
    return principal
