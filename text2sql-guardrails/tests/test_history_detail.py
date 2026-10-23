"""History detail: the stored answer snapshot and GET /v1/history/{query_id}.
No database: the reader is stubbed."""
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

import app.api.routes as routes
from app.api.models import GuardrailReport, QueryResponse, QueryStatus, ResultTable
from tests.principals import TEST_ADMIN, TEST_STUDENT


def _resp(n_rows: int) -> QueryResponse:
    return QueryResponse(
        query_id="q1", status=QueryStatus.SUCCESS, question="my marks?", sql="SELECT 1",
        results=ResultTable(columns=["a"], rows=[[i] for i in range(n_rows)], row_count=n_rows, truncated=False),
        confidence_ticket="single-use-secret", timestamp=datetime.now(timezone.utc),
        guardrail=GuardrailReport(passed=True),
    )


def test_snapshot_caps_rows_and_drops_the_ticket():
    snap = routes._history_snapshot(_resp(500))
    assert len(snap["results"]["rows"]) == 200
    assert snap["results"]["truncated"] is True and snap["results"]["row_count"] == 200
    assert "confidence_ticket" not in snap
    assert QueryResponse(**snap).question == "my marks?"  # round-trips for the endpoint


def test_small_result_is_kept_whole():
    snap = routes._history_snapshot(_resp(3))
    assert snap["results"]["rows"] == [[0], [1], [2]] and snap["results"]["truncated"] is False


def test_detail_is_owner_or_admin_only(monkeypatch):
    stored = routes._history_snapshot(_resp(3))
    calls = []

    def fake_read(qid, *, user_id, is_admin):
        calls.append((qid, user_id, is_admin))
        return stored if qid == "q1" else None

    monkeypatch.setattr(routes, "read_history_detail", fake_read)
    assert routes.get_history_detail("q1", TEST_STUDENT).query_id == "q1"
    assert calls[-1] == ("q1", TEST_STUDENT.user_id, False)  # ownership enforced in the query
    routes.get_history_detail("q1", TEST_ADMIN)
    assert calls[-1][2] is True
    with pytest.raises(HTTPException) as e:
        routes.get_history_detail("someone-elses", TEST_STUDENT)
    assert e.value.status_code == 404
