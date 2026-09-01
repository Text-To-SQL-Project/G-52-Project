"""Unit tests for app.auth -- pure logic, no DB, no LLM, no HTTP client."""
from __future__ import annotations

import pytest
from fastapi import HTTPException

import app.auth as auth
from app.config import settings


@pytest.fixture(autouse=True)
def _configured(monkeypatch):
    """Every test gets a known-good OPERATOR_PASSWORD/SECRET_KEY unless it
    explicitly overrides one to test the unconfigured case."""
    monkeypatch.setattr(settings, "OPERATOR_PASSWORD", "correct-horse-battery-staple")
    monkeypatch.setattr(settings, "SECRET_KEY", "test-secret-key-do-not-use-in-prod")


def test_check_password_accepts_the_configured_password():
    assert auth.check_password("correct-horse-battery-staple") is True


def test_check_password_rejects_wrong_password():
    assert auth.check_password("wrong") is False


def test_check_password_rejects_everything_when_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "OPERATOR_PASSWORD", "")
    assert auth.check_password("") is False
    assert auth.check_password("anything") is False


def test_create_token_round_trips_through_require_auth():
    token = auth.create_token()
    # Should not raise.
    auth.require_auth(authorization=f"Bearer {token}")


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
    token = auth.create_token()
    payload_b64, signature = token.split(".", 1)
    tampered = auth._b64encode(auth._b64decode(payload_b64) + b"x") + "." + signature
    with pytest.raises(HTTPException) as exc_info:
        auth.require_auth(authorization=f"Bearer {tampered}")
    assert exc_info.value.status_code == 401


def test_require_auth_rejects_expired_token(monkeypatch):
    monkeypatch.setattr(auth, "TOKEN_TTL_SECONDS", -1)
    expired_token = auth.create_token()
    with pytest.raises(HTTPException) as exc_info:
        auth.require_auth(authorization=f"Bearer {expired_token}")
    assert exc_info.value.status_code == 401


def test_require_auth_rejects_token_signed_with_a_different_secret(monkeypatch):
    token = auth.create_token()
    monkeypatch.setattr(settings, "SECRET_KEY", "a-completely-different-key")
    with pytest.raises(HTTPException) as exc_info:
        auth.require_auth(authorization=f"Bearer {token}")
    assert exc_info.value.status_code == 401


def test_missing_and_invalid_token_get_the_identical_error_detail():
    """Task 4: never leak *which* thing about the credential was wrong."""
    with pytest.raises(HTTPException) as missing:
        auth.require_auth(authorization=None)
    with pytest.raises(HTTPException) as invalid:
        auth.require_auth(authorization="Bearer garbage")
    assert missing.value.detail == invalid.value.detail
    assert missing.value.status_code == invalid.value.status_code
