"""Unit tests for app.safety.guardrails -- pure AST logic, no DB, no FastAPI
TestClient needed.

The two schema_align tests below are the exception: check_schema_alignment
calls introspect_schema(), which opens a live connection to whatever DB
DATABASE_URL points at (college_erp in this project) -- they need that DB
reachable to pass, unlike the guardrails tests above.

The schema-disclosure regression tests at the bottom also need that DB
(to introspect the real identifier list to check against) plus, for the
BLOCKED/ERROR cases, to actually execute against it.
"""
from __future__ import annotations

import re

from app.api.models import QueryRequest, SignalStatus
from app.api.routes import run_query
from tests.principals import TEST_STUDENT
from app.config import settings
from app.detection.schema_align import check_schema_alignment
from app.generation.generator import GenerationResult
from app.safety.guardrails import check_guardrails
from app.schema.introspect import introspect_schema


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


# ---------------------------------------------------------------------------
# Schema-disclosure regression tests
#
# See app/api/routes.py's _CLARIFICATION_CLIENT_MESSAGE /
# _REFUSED_CLIENT_MESSAGE / _GENERATION_ERROR_CLIENT_MESSAGE /
# _EXECUTION_ERROR_CLIENT_MESSAGE constants and their surrounding comments
# for the full rationale. These tests check the actual SERIALIZED response
# body against every real table/column name in the live schema, so this
# fails loudly if a future change reintroduces a schema-bearing field (or
# adds a new one with the same problem) -- it doesn't rely on remembering
# to keep this list of fields in sync by hand.
# ---------------------------------------------------------------------------

def _live_identifiers() -> set[str]:
    """Every table and column name in the live college_erp schema,
    lowercased. Needs the real DB, same as the schema_align tests above."""
    schema = introspect_schema(include_samples=False)
    names: set[str] = set()
    for table in schema.tables:
        names.add(table.name.lower())
        for col in table.columns:
            names.add(col.name.lower())
    return names


def _leaked_identifiers(response, identifiers: set[str]) -> list[str]:
    """Recursively collect every string VALUE in the serialized response
    (deliberately excluding the top-level `question` field, which just
    echoes the caller's own input back -- echoing what the user already
    typed isn't disclosure, and the task's own example question ("Which
    Doctor has attendance above 70%") contains a real table name
    ("attendance") for exactly this reason) and check each against the
    identifier set, word-boundary matched so e.g. "id" doesn't false-
    positive inside "guardrail" or a UUID. Checking VALUES only (not JSON
    key names) matters too: `status` is both a QueryResponse field name
    AND a real column name in several tables (students.status,
    attendance.status, ...) -- flagging the key would be a false
    positive on every single response, success included."""
    data = response.model_dump(mode="json")
    data.pop("question", None)

    values: list[str] = []

    def collect(node) -> None:
        if isinstance(node, str):
            values.append(node)
        elif isinstance(node, dict):
            for v in node.values():
                collect(v)
        elif isinstance(node, list):
            for item in node:
                collect(item)

    collect(data)

    haystack = " ".join(values).lower()
    return [
        ident for ident in identifiers
        if re.search(rf"\b{re.escape(ident)}\b", haystack)
    ]


IDENTIFIERS = _live_identifiers()


def test_clarification_needed_response_has_no_schema_identifiers(monkeypatch):
    def fake_generate_sql(question, row_scoped=False, **kwargs):
        return GenerationResult(
            refusal=True,
            refusal_kind="ambiguous",
            reason=(
                "The students table and attendance table have no 'doctor' "
                "or medical-staff column, only faculty and student records."
            ),
            sql=None,
            explanation="",
            tables_used=[],
            columns_used=[],
        )

    monkeypatch.setattr("app.api.routes.generate_sql", fake_generate_sql)
    resp = run_query(QueryRequest(question="Which Doctor has attendance above 70%"), TEST_STUDENT)
    assert resp.status == "clarification"
    leaked = _leaked_identifiers(resp, IDENTIFIERS)
    assert not leaked, f"schema identifiers leaked in CLARIFICATION_NEEDED response: {leaked}"


def test_refused_response_has_no_schema_identifiers(monkeypatch):
    def fake_generate_sql(question, row_scoped=False, **kwargs):
        return GenerationResult(
            refusal=True,
            refusal_kind="unsafe",
            reason="This would delete rows from the attendance and marks tables, which is not permitted.",
            sql=None,
            explanation="",
            tables_used=[],
            columns_used=[],
        )

    monkeypatch.setattr("app.api.routes.generate_sql", fake_generate_sql)
    resp = run_query(QueryRequest(question="Delete all attendance records"), TEST_STUDENT)
    assert resp.status == "refused"
    leaked = _leaked_identifiers(resp, IDENTIFIERS)
    assert not leaked, f"schema identifiers leaked in REFUSED response: {leaked}"


def test_blocked_response_has_no_schema_identifiers():
    resp = run_query(QueryRequest(
        question="test",
        sql_override="DELETE FROM attendance WHERE student_id = 1;",
    ), TEST_STUDENT)
    assert resp.status == "blocked"
    leaked = _leaked_identifiers(resp, IDENTIFIERS)
    assert not leaked, f"schema identifiers leaked in BLOCKED response: {leaked}"


def test_error_response_has_no_schema_identifiers():
    resp = run_query(QueryRequest(
        question="test",
        sql_override="SELECT nonexistent_column_xyz FROM students;",
    ), TEST_STUDENT)
    assert resp.status == "error"
    leaked = _leaked_identifiers(resp, IDENTIFIERS)
    assert not leaked, f"schema identifiers leaked in ERROR response: {leaked}"
