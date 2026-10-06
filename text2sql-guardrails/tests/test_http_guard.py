"""app/http_guard.py and the ENV=prod startup gate. No DB, no LLM."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import app.api.auth_routes as auth_routes
import app.http_guard as guard
from app.config import settings
from app.main import app
from app.startup_checks import StartupCheckError, check_production_config
from tests.principals import TEST_STUDENT


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(guard, "_limiter", guard.SlidingWindowLimiter())  # fresh budget per test
    return TestClient(app)  # no `with`: skip lifespan (DB startup checks)


def test_sliding_window_counts_per_key():
    lim = guard.SlidingWindowLimiter()
    assert [lim.retry_after("a", 2) for _ in range(3)][:2] == [0, 0]
    assert lim.retry_after("a", 2) > 0
    assert lim.retry_after("b", 2) == 0  # other keys keep their own budget


def test_login_is_rate_limited_per_ip(client, monkeypatch):
    monkeypatch.setattr(settings, "SECRET_KEY", "x" * 32)
    monkeypatch.setattr(settings, "RATE_LIMIT_LOGIN_PER_MIN", 3)
    monkeypatch.setattr(auth_routes, "authenticate", lambda u, p: None)
    codes = [client.post("/auth/login", json={"username": "u", "password": "p"}).status_code for _ in range(4)]
    assert codes == [401, 401, 401, 429]
    r = client.post("/auth/login", json={"username": "u", "password": "p"})
    assert int(r.headers["Retry-After"]) > 0
    assert "Too many requests" in r.json()["detail"]


def test_security_headers_and_request_id(client):
    r = client.get("/health", headers={"X-Request-ID": "abc123"})
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Content-Security-Policy"].startswith("default-src 'none'")
    assert r.headers["X-Request-ID"] == "abc123"
    assert "Strict-Transport-Security" not in r.headers  # dev: no HSTS on plain http
    assert "Content-Security-Policy" not in client.get("/docs").headers  # Swagger UI needs its CDN


def test_oversized_question_is_rejected_before_any_work(client, monkeypatch):
    app.dependency_overrides[guard.require_auth] = lambda: TEST_STUDENT
    try:
        r = client.post("/v1/query", json={"question": "x" * 2001})
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 422


def test_prod_refuses_weak_config(monkeypatch):
    monkeypatch.setattr(settings, "SECRET_KEY", "short")
    monkeypatch.setattr(settings, "ENV", "dev")
    check_production_config()  # dev: warning only
    monkeypatch.setattr(settings, "ENV", "prod")
    with pytest.raises(StartupCheckError, match="SECRET_KEY"):
        check_production_config()
    monkeypatch.setattr(settings, "SECRET_KEY", "k" * 40)
    check_production_config()


def test_client_ip_trusts_vercel_header_only_on_vercel(monkeypatch):
    from starlette.requests import Request

    def req(headers):
        return Request({"type": "http", "headers": [(k.encode(), v.encode()) for k, v in headers.items()],
                        "client": ("10.0.0.1", 1234)})

    spoofed = {"x-vercel-forwarded-for": "6.6.6.6"}
    monkeypatch.delenv("VERCEL", raising=False)
    assert guard.client_ip(req(spoofed)) == "10.0.0.1"  # off Vercel the header is client-controlled
    monkeypatch.setenv("VERCEL", "1")
    assert guard.client_ip(req({"x-vercel-forwarded-for": "203.0.113.7"})) == "203.0.113.7"
    assert guard.client_ip(req({})) == "10.0.0.1"
