"""app/llm_pool.py + /v1/admin/llm-pool with the LiteLLM proxy mocked."""
from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

import app.llm_pool as pool
from app.auth import require_auth
from app.config import settings
from app.generation import llm_client
from app.main import app
from tests.principals import TEST_ADMIN, TEST_STUDENT

MODEL_INFO = {"data": [
    {"model_name": "pool", "litellm_params": {"model": "groq/llama-3.3-70b"},
     "model_info": {"id": "m1", "label": "Groq fast", "key_hint": "abcd"}},
    {"model_name": "other-group", "litellm_params": {"model": "openai/gpt-x"}, "model_info": {"id": "m9"}},
]}


@pytest.fixture
def proxy(monkeypatch):
    """Fake proxy: records calls, serves MODEL_INFO."""
    calls = []

    def fake(method, url, headers=None, timeout=None, **kw):
        calls.append((method, url.split("4000", 1)[1], kw.get("json"), headers))
        if url.endswith("/model/info"):
            return httpx.Response(200, json=MODEL_INFO)
        if url.endswith("/health"):
            return httpx.Response(200, json={
                "healthy_endpoints": [{"model": "groq/llama-3.3-70b", "model_info": {"id": "m1"}}],
                "unhealthy_endpoints": [{"model": "openai/x", "model_id": "m2", "error": "AuthenticationError: bad key\nstack..."}],
            })
        return httpx.Response(200, json={})

    monkeypatch.setattr(settings, "LITELLM_URL", "http://proxy:4000")
    monkeypatch.setattr(settings, "LITELLM_MASTER_KEY", "sk-master")
    monkeypatch.setattr(settings, "LITELLM_MODEL_GROUP", "pool")
    monkeypatch.setattr(pool.httpx, "request", fake)
    monkeypatch.setattr(pool, "_ready_cache", (0.0, False))
    return calls


@pytest.fixture
def as_admin():
    app.dependency_overrides[require_auth] = lambda: TEST_ADMIN
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_lists_only_our_group_and_never_keys(proxy):
    deps = pool.list_deployments()
    assert [d["id"] for d in deps] == ["m1"]
    assert deps[0] == {**deps[0], "provider": "groq", "model": "llama-3.3-70b", "key_hint": "abcd"}
    assert "api_key" not in deps[0]
    assert proxy[0][3]["Authorization"] == "Bearer sk-master"


def test_add_sends_full_key_to_proxy_but_stores_only_a_hint(proxy):
    pool.add_deployment(provider="groq", model="llama-3.3-70b", api_key="gsk_secret_9876", api_base=None, label="x")
    _, path, body, _ = next(c for c in proxy if c[1] == "/model/new")
    assert body["litellm_params"] == {"model": "groq/llama-3.3-70b", "api_key": "gsk_secret_9876"}
    assert body["model_info"]["key_hint"] == "9876"
    assert pool._ready_cache[1] is True  # change reflected immediately


def test_app_uses_pool_only_when_it_has_keys(proxy, monkeypatch):
    monkeypatch.setattr(settings, "APP_LLM_PROVIDER", "auto")
    monkeypatch.setattr(settings, "LLM_PROVIDER", "gemini")
    assert pool.refresh_ready() is True and pool.app_provider() == "litellm"
    monkeypatch.setattr(pool, "_ready_cache", (1e18, False))  # fresh "empty pool" answer
    assert pool.app_provider() == "gemini"
    monkeypatch.setattr(settings, "LITELLM_URL", "")
    assert pool.app_provider() == "gemini"  # unconfigured: never even asks


def test_unreachable_proxy_is_a_clean_error(monkeypatch, proxy):
    def down(*a, **k):
        raise httpx.ConnectError("refused")
    monkeypatch.setattr(pool.httpx, "request", down)
    with pytest.raises(pool.PoolError, match="unreachable"):
        pool.list_deployments()
    assert pool.refresh_ready() is False


def test_provider_override_is_scoped_and_eval_keeps_env_provider(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "gemini")
    assert llm_client.effective_provider() == "gemini"
    with llm_client.use_provider("litellm"):
        assert llm_client.effective_provider() == "litellm"
        assert llm_client.wait_for_background_room() is True  # env RPM cap doesn't apply to the pool
    assert llm_client.effective_provider() == "gemini"


def test_admin_api(proxy, as_admin):
    r = as_admin.get("/v1/admin/llm-pool")
    assert r.status_code == 200 and r.json()["reachable"] is True
    assert r.json()["deployments"][0]["label"] == "Groq fast"

    bad = as_admin.post("/v1/admin/llm-pool", json={"provider": "evilcorp", "model": "m", "api_key": "12345678"})
    assert bad.status_code == 422
    ok = as_admin.post("/v1/admin/llm-pool", json={"provider": "groq", "model": "llama-3.3-70b", "api_key": "gsk_12345678"})
    assert ok.status_code == 201
    assert "gsk_12345678" not in ok.text

    assert as_admin.delete("/v1/admin/llm-pool/m1").status_code == 200
    assert as_admin.delete("/v1/admin/llm-pool/..%2Fadmin").status_code in (404, 422)

    h = as_admin.post("/v1/admin/llm-pool/health").json()
    assert h["healthy"] == ["m1"]
    assert h["unhealthy"] == [{"id": "m2", "error": "AuthenticationError: bad key"}]


def test_non_admin_is_refused(proxy):
    app.dependency_overrides[require_auth] = lambda: TEST_STUDENT
    try:
        assert TestClient(app).get("/v1/admin/llm-pool").status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_health_accepts_proxy_503_and_maps_entries_by_model(proxy, monkeypatch):
    """Real proxy behaviour: 503 when any key is down, endpoints keyed by model, not id."""
    real = pool.httpx.request

    def fake(method, url, **kw):
        if url.endswith("/health"):
            return httpx.Response(503, json={"healthy_endpoints": [], "unhealthy_endpoints": [{
                "model": "groq/llama-3.3-70b",
                "error": 'litellm.BadRequestError: GroqException - {"error":{"message":"Invalid API Key"}}\ntrace',
            }]})
        return real(method, url, **kw)

    monkeypatch.setattr(pool.httpx, "request", fake)
    assert pool.health() == {"healthy": [], "unhealthy": [{"id": "m1", "error": "BadRequestError: GroqException: Invalid API Key"}]}


def test_failing_pool_falls_back_to_env_provider(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "gemini")
    seen = []

    def fake_openai(system, user, max_attempts=None, timeout=None):
        seen.append(llm_client.effective_provider())
        if seen[-1] == "litellm":
            raise RuntimeError("every key in the pool is invalid")
        return "SELECT 1"

    monkeypatch.setattr(llm_client, "_complete_openai_compatible", fake_openai)
    with llm_client.use_provider("litellm"):
        assert llm_client.complete("sys", "q") == "SELECT 1"
    assert seen == ["litellm", "gemini"]
    assert pool.app_provider() == "gemini"  # breaker open: next queries skip the pool
    monkeypatch.setattr(pool, "_down_until", 0.0)
