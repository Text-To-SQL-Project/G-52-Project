"""POST /auth/google, GET /auth/providers and the admin email-linking API.
Google's token verification and the database are stubbed (no network, no DB)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import app.api.auth_routes as auth_routes
import app.api.user_routes as user_routes
import app.http_guard as guard
from app.auth import read_token_subject, require_auth
from app.config import settings
from app.main import app
from app.users import EmailTaken
from tests.principals import TEST_ADMIN, TEST_STUDENT

CRED = {"credential": "x" * 40}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(guard, "_limiter", guard.SlidingWindowLimiter())
    monkeypatch.setattr(settings, "SECRET_KEY", "k" * 40)
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "123-abc.apps.googleusercontent.com")
    return TestClient(app)


def claims(**over):
    return {"iss": "https://accounts.google.com", "email": "Student.One@college.edu", "email_verified": True, **over}


def test_providers_exposes_client_id_only_when_configured(client, monkeypatch):
    assert client.get("/auth/providers").json() == {"google_client_id": "123-abc.apps.googleusercontent.com"}
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "")
    assert client.get("/auth/providers").json() == {"google_client_id": None}
    assert client.post("/auth/google", json=CRED).status_code == 503


def test_linked_verified_account_gets_a_session(client, monkeypatch):
    monkeypatch.setattr(auth_routes, "verify_google_credential", lambda c: claims())
    looked_up = []
    monkeypatch.setattr(auth_routes, "find_by_email", lambda e: looked_up.append(e) or TEST_STUDENT)
    r = client.post("/auth/google", json=CRED)
    assert r.status_code == 200
    assert read_token_subject(r.json()["token"]) == TEST_STUDENT.user_id
    assert r.json()["role"] == "student"
    assert looked_up == ["Student.One@college.edu"]


@pytest.mark.parametrize("verify,found,code,msg", [
    (ValueError("bad signature"), TEST_STUDENT, 401, "Google sign-in failed"),
    (claims(email_verified=False), TEST_STUDENT, 401, "not verified"),
    (claims(email_verified="true"), TEST_STUDENT, 401, "not verified"),  # only a real boolean counts
    (claims(), None, 403, "No account is linked"),  # never auto-creates
])
def test_rejections(client, monkeypatch, verify, found, code, msg):
    def fake_verify(c):
        if isinstance(verify, Exception):
            raise verify
        return verify
    monkeypatch.setattr(auth_routes, "verify_google_credential", fake_verify)
    monkeypatch.setattr(auth_routes, "find_by_email", lambda e: found)
    r = client.post("/auth/google", json=CRED)
    assert r.status_code == code and msg in r.json()["detail"]
    assert "bad signature" not in r.text  # verifier details stay server-side


def test_google_login_shares_the_login_rate_limit(client, monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_LOGIN_PER_MIN", 2)
    monkeypatch.setattr(auth_routes, "verify_google_credential", lambda c: claims())
    monkeypatch.setattr(auth_routes, "find_by_email", lambda e: None)
    codes = [client.post("/auth/google", json=CRED).status_code for _ in range(3)]
    assert codes == [403, 403, 429]


def test_admin_links_emails(client, monkeypatch):
    rows = [{"user_id": 7, "username": "student1", "role": "student", "email": None, "is_active": True}]
    calls = []

    def fake_set(uid, email):
        if email == "taken@x.edu":
            raise EmailTaken
        calls.append((uid, email))
        return uid == 7

    monkeypatch.setattr(user_routes, "list_users", lambda: rows)
    monkeypatch.setattr(user_routes, "set_email", fake_set)
    app.dependency_overrides[require_auth] = lambda: TEST_ADMIN
    try:
        assert client.get("/v1/admin/users").json()[0]["username"] == "student1"
        assert client.patch("/v1/admin/users/7", json={"email": " A@College.EDU "}).status_code == 200
        assert calls == [(7, "a@college.edu")]  # trimmed + lowercased
        assert client.patch("/v1/admin/users/7", json={"email": ""}).status_code == 200
        assert calls[-1] == (7, None)  # empty unlinks
        assert client.patch("/v1/admin/users/7", json={"email": "not-an-email"}).status_code == 422
        assert client.patch("/v1/admin/users/7", json={"email": "taken@x.edu"}).status_code == 409
        assert client.patch("/v1/admin/users/99", json={"email": "z@x.edu"}).status_code == 404
        app.dependency_overrides[require_auth] = lambda: TEST_STUDENT
        assert client.get("/v1/admin/users").status_code == 403
    finally:
        app.dependency_overrides.clear()
