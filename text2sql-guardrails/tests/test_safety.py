"""Unit tests for app.safety.guardrails -- pure AST logic, no DB, no FastAPI
TestClient needed."""
from __future__ import annotations

from app.config import settings
from app.safety.guardrails import check_guardrails


def test_select_with_existing_limit_passes_without_reinjecting():
    result = check_guardrails("SELECT id FROM students LIMIT 10;")
    assert result.passed
    assert result.blocked_reasons == []
    assert result.injected_limit is None
    assert "LIMIT 10" in result.safe_sql


def test_select_without_limit_passes_and_injects_configured_limit():
    result = check_guardrails("SELECT id FROM students;")
    assert result.passed
    assert result.injected_limit == settings.DEFAULT_ROW_LIMIT
    assert f"LIMIT {settings.DEFAULT_ROW_LIMIT}" in result.safe_sql


def test_drop_table_is_blocked():
    result = check_guardrails("DROP TABLE students;")
    assert not result.passed
    assert any("Drop" in r for r in result.blocked_reasons)
    assert "ddl_block" in result.checks_run


def test_delete_is_blocked():
    result = check_guardrails("DELETE FROM students WHERE id = 1;")
    assert not result.passed
    assert any("Delete" in r for r in result.blocked_reasons)
    assert "dml_block" in result.checks_run


def test_subquery_depth_exceeding_max_is_blocked():
    nested = "SELECT * FROM students"
    for _ in range(settings.MAX_SUBQUERY_DEPTH + 1):
        nested = f"SELECT * FROM ({nested}) t"
    result = check_guardrails(nested + ";")
    assert not result.passed
    assert any("subquery nesting depth" in r for r in result.blocked_reasons)


def test_unparseable_sql_is_blocked_gracefully():
    result = check_guardrails("this is not sql at all (((")
    assert not result.passed
    assert result.blocked_reasons
    assert result.checks_run == []
