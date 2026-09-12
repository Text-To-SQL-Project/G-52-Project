"""Unit tests for app.auth -- pure logic, no DB, no LLM, no HTTP client.

app.users.load_principal and find_by_username are the only database
touchpoints in the auth path, and both are monkeypatched here so the suite
stays hermetic like every other test in this project.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

import app.auth as auth
import app.users as users
from app.config import settings
from app.users import Principal

ALICE = Principal(user_id=1, username="alice", role="student", student_id=32, faculty_id=None)
ADMIN = Principal(user_id=2, username="root", role="admin", student_id=None, faculty_id=None)


@pytest.fixture(autouse=True)
def _configured(monkeypatch):
    """A known signing key, and a directory of one active user.

    Replaces the old OPERATOR_PASSWORD fixture: there is no shared password
    any more, so the thing that has to be configured is the HMAC key and
    the user store.
    """
    monkeypatch.setattr(settings, "SECRET_KEY", "test-secret-key-do-not-use-in-prod")
    monkeypatch.setattr(settings, "AUTH_PRINCIPAL_CACHE_SECONDS", 0)

    directory = {1: ALICE, 2: ADMIN}
    monkeypatch.setattr(auth, "load_principal", lambda uid: directory.get(uid))
    return directory


# --- password hashing ------------------------------------------------------

def test_hash_is_argon2id_with_the_pinned_parameters():
    """These exact numbers are cited in the paper; a library-default change
    must not move them silently."""
    encoded = auth.hash_password("correct-horse-battery-staple")
    assert encoded.startswith("$argon2id$")
    assert "m=65536,t=3,p=4" in encoded


def test_argon2_parameters_report_matches_the_hasher():
    p = auth.argon2_parameters()
    assert p["algorithm"] == "argon2id"
    assert (p["time_cost"], p["memory_cost_kib"], p["parallelism"]) == (3, 65536, 4)
    assert (p["hash_len_bytes"], p["salt_len_bytes"]) == (32, 16)


def test_verify_accepts_the_right_password_and_rejects_others():
    encoded = auth.hash_password("s3cret")
    assert auth.verify_password(encoded, "s3cret") is True
    assert auth.verify_password(encoded, "S3cret") is False
    assert auth.verify_password(encoded, "") is False


def test_verify_rejects_a_malformed_stored_hash_instead_of_raising():
    """A corrupt row is a failed login, not a 500."""
    assert auth.verify_password("not-a-phc-string", "anything") is False


def test_two_hashes_of_one_password_differ():
    """Per-hash random salt."""
    assert auth.hash_password("same") != auth.hash_password("same")


# --- authenticate ----------------------------------------------------------

def test_authenticate_returns_the_principal_on_success(monkeypatch):
    encoded = auth.hash_password("pw")
    monkeypatch.setattr(auth, "find_by_username", lambda u: (ALICE, encoded) if u == "alice" else None)
    assert auth.authenticate("alice", "pw") == ALICE


def test_authenticate_rejects_a_wrong_password(monkeypatch):
    encoded = auth.hash_password("pw")
    monkeypatch.setattr(auth, "find_by_username", lambda u: (ALICE, encoded))
    assert auth.authenticate("alice", "nope") is None


def test_authenticate_rejects_an_unknown_user_without_leaking_which(monkeypatch):
    """Unknown username and wrong password must both return a bare None --
    the route turns both into the same 401."""
    monkeypatch.setattr(auth, "find_by_username", lambda u: None)
    assert auth.authenticate("nobody", "pw") is None


def test_unknown_username_still_pays_the_hashing_cost(monkeypatch):
    """Otherwise response time is a username oracle: the miss path would
    return in the time of one indexed SELECT while a hit pays for a full
    Argon2 verify."""
    calls = []
    monkeypatch.setattr(auth, "find_by_username", lambda u: None)
    real_verify = auth.verify_password
    monkeypatch.setattr(auth, "verify_password",
                        lambda h, p: (calls.append(h), real_verify(h, p))[1])
    auth.authenticate("nobody", "pw")
    assert calls == [auth._DUMMY_HASH]


# --- tokens ----------------------------------------------------------------

def test_token_carries_the_subject_and_nothing_authorising():
    """Role and is_active must NOT be in the payload -- a claim in a token
    is frozen at issue time, and this one gates row visibility from
    Phase 2 onward."""
    import base64
    import json
    token = auth.create_token(ALICE.user_id)
    payload_b64 = token.split(".", 1)[0]
    claims = json.loads(base64.urlsafe_b64decode(payload_b64 + "=" * (-len(payload_b64) % 4)))
    assert set(claims) == {"sub", "exp"}
    assert claims["sub"] == ALICE.user_id


def test_create_token_round_trips_through_require_auth():
    token = auth.create_token(ALICE.user_id)
    assert auth.require_auth(authorization=f"Bearer {token}") == ALICE


def test_require_auth_rejects_missing_header():
    with pytest.raises(HTTPException) as exc_info:
        auth.require_auth(authorization=None)
    assert exc_info.value.status_code == 401


def test_require_auth_rejects_malformed_header():
    with pytest.raises(HTTPException) as exc_info:
        auth.require_auth(authorization="not-a-bearer-token")
    assert exc_info.value.status_code == 401


def test_require_auth_rejects_garbage_token():
    with pytest.raises(HTTPException) as exc_info:
        auth.require_auth(authorization="Bearer complete.garbage")
    assert exc_info.value.status_code == 401


def test_require_auth_rejects_tampered_payload():
    """Flip the payload without re-signing -- must fail even though the
    token is otherwise well-formed (two dot-separated base64 segments)."""
    token = auth.create_token(ALICE.user_id)
    payload_b64, signature = token.split(".", 1)
    tampered = auth._b64encode(auth._b64decode(payload_b64) + b"x") + "." + signature
    with pytest.raises(HTTPException) as exc_info:
        auth.require_auth(authorization=f"Bearer {tampered}")
    assert exc_info.value.status_code == 401


def test_require_auth_rejects_expired_token(monkeypatch):
    monkeypatch.setattr(auth, "TOKEN_TTL_SECONDS", -1)
    expired_token = auth.create_token(ALICE.user_id)
    with pytest.raises(HTTPException) as exc_info:
        auth.require_auth(authorization=f"Bearer {expired_token}")
    assert exc_info.value.status_code == 401


def test_require_auth_rejects_token_signed_with_a_different_secret(monkeypatch):
    token = auth.create_token(ALICE.user_id)
    monkeypatch.setattr(settings, "SECRET_KEY", "a-completely-different-key")
    with pytest.raises(HTTPException) as exc_info:
        auth.require_auth(authorization=f"Bearer {token}")
    assert exc_info.value.status_code == 401


def test_missing_and_invalid_token_get_the_identical_error_detail():
    """Never leak *which* thing about the credential was wrong."""
    with pytest.raises(HTTPException) as missing:
        auth.require_auth(authorization=None)
    with pytest.raises(HTTPException) as invalid:
        auth.require_auth(authorization="Bearer garbage")
    assert missing.value.detail == invalid.value.detail
    assert missing.value.status_code == invalid.value.status_code


# --- the per-request re-read ----------------------------------------------

def test_deactivated_user_is_rejected_immediately_despite_a_valid_token(monkeypatch):
    """The whole point of not putting is_active in the token. The token is
    structurally perfect and unexpired; the user is simply gone."""
    token = auth.create_token(ALICE.user_id)
    assert auth.require_auth(authorization=f"Bearer {token}") == ALICE

    monkeypatch.setattr(auth, "load_principal", lambda uid: None)  # deactivated
    with pytest.raises(HTTPException) as exc_info:
        auth.require_auth(authorization=f"Bearer {token}")
    assert exc_info.value.status_code == 401


def test_role_change_takes_effect_on_the_next_request(monkeypatch):
    """A demotion must not wait out the 12-hour token lifetime."""
    token = auth.create_token(ADMIN.user_id)
    assert auth.require_auth(authorization=f"Bearer {token}").is_admin is True

    demoted = Principal(user_id=2, username="root", role="student",
                        student_id=32, faculty_id=None)
    monkeypatch.setattr(auth, "load_principal", lambda uid: demoted)
    assert auth.require_auth(authorization=f"Bearer {token}").is_admin is False


def test_deleted_user_with_a_valid_token_is_indistinguishable_from_a_forgery(monkeypatch):
    monkeypatch.setattr(auth, "load_principal", lambda uid: None)
    token = auth.create_token(ALICE.user_id)
    with pytest.raises(HTTPException) as gone:
        auth.require_auth(authorization=f"Bearer {token}")
    with pytest.raises(HTTPException) as forged:
        auth.require_auth(authorization="Bearer garbage")
    assert gone.value.detail == forged.value.detail
    assert gone.value.status_code == forged.value.status_code


# --- admin gate ------------------------------------------------------------

def test_require_admin_allows_an_admin():
    assert auth.require_admin(principal=ADMIN) == ADMIN


def test_require_admin_rejects_a_non_admin_with_403_not_401():
    """403, not 401: the caller authenticated fine, they are just not
    allowed here. Returning 401 would send a legitimate user off to
    re-enter correct credentials forever."""
    with pytest.raises(HTTPException) as exc_info:
        auth.require_admin(principal=ALICE)
    assert exc_info.value.status_code == 403


# --- principal cache -------------------------------------------------------

def test_cache_ttl_is_the_revocation_window(monkeypatch):
    """Caching is off by default; when enabled, the TTL is exactly how long
    a deactivated user keeps working. Documented by test so nobody raises it
    thinking it is only a performance knob."""
    monkeypatch.setattr(settings, "AUTH_PRINCIPAL_CACHE_SECONDS", 30)
    users.invalidate_principal()
    calls = {"n": 0}

    class _Row:
        user_id, username, role = 1, "alice", "student"
        student_id, faculty_id, is_active = 32, None, True

    def fake_conn(*_a, **_k):
        calls["n"] += 1
        raise AssertionError("should not reach the database on a cache hit")

    users._cache[1] = (__import__("time").monotonic() + 30, ALICE)
    monkeypatch.setattr(users, "get_engine", fake_conn)
    assert users.load_principal(1) == ALICE
    assert calls["n"] == 0

    users.invalidate_principal(1)
    assert 1 not in users._cache
