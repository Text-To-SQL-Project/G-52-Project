"""POST /v1/query/stream: everyone gets stage progress and the final result;
only a request carrying the matching DEV_TRACE_KEY gets log lines (which
contain SQL / reasons the normal response deliberately withholds)."""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.auth import require_auth
from app.config import settings
from app.generation.generator import GenerationResult
from app.main import app
from tests.principals import TEST_STUDENT

SECRET_REASON = "the students table has no doctor column"


@pytest.fixture
def client(monkeypatch):
    def fake_generate_sql(question, row_scoped=False, **kwargs):
        return GenerationResult(
            refusal=True, refusal_kind="ambiguous", reason=SECRET_REASON,
            sql=None, explanation="", tables_used=[], columns_used=[],
        )

    monkeypatch.setattr("app.api.routes.generate_sql", fake_generate_sql)
    monkeypatch.setattr(settings, "DEV_TRACE_KEY", "k" * 24)
    app.dependency_overrides[require_auth] = lambda: TEST_STUDENT
    yield TestClient(app)
    app.dependency_overrides.pop(require_auth, None)


def _events(client, key=None):
    headers = {"X-Dev-Trace-Key": key} if key else {}
    r = client.post("/v1/query/stream", json={"question": "Which doctor has attendance above 70%"}, headers=headers)
    assert r.status_code == 200
    return [json.loads(line) for line in r.text.splitlines() if line.strip()]


@pytest.mark.parametrize("key", [None, "wrong-key-of-some-length"])
def test_users_get_progress_but_never_logs(client, key):
    ev = _events(client, key)
    assert ev[0] == {"t": "hello", "dev": False}
    assert ev[-1]["t"] == "result" and ev[-1]["data"]["status"] == "clarification"
    assert not [e for e in ev if e["t"] == "log"]
    assert SECRET_REASON not in json.dumps(ev)


def test_developer_key_streams_pipeline_and_server_logs(client):
    ev = _events(client, "k" * 24)
    assert ev[0] == {"t": "hello", "dev": True}
    logs = [e for e in ev if e["t"] == "log"]
    assert any(e["src"] == "pipeline" for e in logs)
    # The routes.py logger line for the refusal is forwarded, reason included.
    assert any(e["src"] == "app.api.routes" and SECRET_REASON in e["msg"] for e in logs)
    assert ev[-1]["t"] == "result"
