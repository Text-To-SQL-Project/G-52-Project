"""Unit tests for app.safety.guardrails -- pure AST logic, no DB, no FastAPI
TestClient needed.

The two schema_align tests below are the exception: check_schema_alignment
calls introspect_schema(), which opens a live connection to whatever DB
DATABASE_URL points at (college_erp in this project) -- they need that DB
reachable to pass, unlike the guardrails tests above.
"""
from __future__ import annotations

from app.api.models import SignalStatus
from app.config import settings
from app.detection.schema_align import check_schema_alignment
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


def test_schema_alignment_valid_cte_passes():
    """A CTE alias (WITH x AS (...)) must not be flagged as a missing
    physical table -- regression test for that false positive."""
    sql = (
        "WITH active_students AS ("
        "SELECT student_id, first_name, department_id FROM students "
        "WHERE status = 'ACTIVE'"
        ") SELECT first_name FROM active_students LIMIT 10;"
    )
    signal = check_schema_alignment(sql)
    assert signal.status == SignalStatus.PASS
    assert signal.score == 1.0
    assert "active_students" not in (signal.detail or "")


def test_schema_alignment_invented_table_still_fails():
    """A genuinely nonexistent table (no CTE involved) must still be
    caught -- confirms the CTE fix didn't broaden into ignoring real
    missing-table cases."""
    sql = "SELECT * FROM totally_fake_table_xyz LIMIT 10;"
    signal = check_schema_alignment(sql)
    assert signal.status == SignalStatus.FAIL
    assert signal.score == 0.0
    assert "totally_fake_table_xyz" in signal.detail
