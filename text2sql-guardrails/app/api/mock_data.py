"""
Mock responses that satisfy the API contract exactly.

These let the frontend build against real-shaped data before the LLM,
guardrail, and detection layers exist. Every field the UI reads is present.
Swap these out phase by phase as you implement app/generation, app/safety,
and app/detection — the contract (and therefore the frontend) never changes.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.api.models import (
    Clarification,
    Confidence,
    ConfidenceSignal,
    GuardrailReport,
    HistoryItem,
    HistoryResponse,
    QueryResponse,
    QueryStatus,
    ResultTable,
    SignalStatus,
    Warning,
    WarningLevel,
    ColumnInfo,
    SchemaResponse,
    TableInfo,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_id() -> str:
    return f"q_{uuid.uuid4().hex[:12]}"


# ---------------------------------------------------------------------------
# Destructive-question candidate — stands in for app.generation until it
# exists. Produces a real, syntactically valid destructive SQL string so
# that app.safety.guardrails.check_guardrails() (real sqlglot AST analysis)
# is the ONLY thing that decides BLOCKED vs not -- this function must never
# itself claim a statement is blocked.
# ---------------------------------------------------------------------------

_DESTRUCTIVE_SQL_TEMPLATES: dict[str, str] = {
    "drop": "DROP TABLE {table};",
    "truncate": "TRUNCATE TABLE {table};",
    "delete": "DELETE FROM {table};",
    "alter": "ALTER TABLE {table} DROP COLUMN id;",
}

# Real college_erp table names, used to make the candidate's SQL mention a
# table actually present in the question. Cosmetic only -- it does NOT
# affect correctness of guardrail blocking, which inspects statement
# *type*, not table existence.
_KNOWN_TABLES = [
    "students", "departments", "faculty", "attendance", "marks",
    "fee_payments", "subjects", "student_enrollments", "library_books",
    "placement_applications",
]


def _destructive_candidate(question: str) -> QueryResponse:
    q = question.lower()
    verb = next((w for w in ("drop", "truncate", "delete", "alter") if w in q), "delete")
    table = next(
        (t for t in _KNOWN_TABLES if t in q or t.rstrip("s") in q),
        "students",
    )
    sql = _DESTRUCTIVE_SQL_TEMPLATES[verb].format(table=table)
    return QueryResponse(
        query_id=_new_id(),
        status=QueryStatus.SUCCESS,  # candidate only; run_query() re-decides the real status
        question=question,
        timestamp=_now(),
        sql=sql,
        explanation=f"Generated a {verb.upper()} statement targeting '{table}'.",
        tables_used=[table],
        columns_used=[],
        guardrail=GuardrailReport(passed=True, checks_run=[]),  # placeholder; overwritten in routes.py
    )


# ---------------------------------------------------------------------------
# SUCCESS example — this is the payload that drives the main workspace screen
# ---------------------------------------------------------------------------

def mock_success(question: str) -> QueryResponse:
    return QueryResponse(
        query_id=_new_id(),
        status=QueryStatus.SUCCESS,
        question=question,
        timestamp=_now(),
        sql=(
            "SELECT d.department_name, "
            "COUNT(*) AS student_count\n"
            "FROM students s\n"
            "JOIN departments d ON s.department_id = d.department_id\n"
            "GROUP BY d.department_name\n"
            "ORDER BY student_count DESC\n"
            "LIMIT 5;"
        ),
        explanation=(
            "Joins students to their departments, counts enrolled students "
            "per department, and returns the five largest departments."
        ),
        tables_used=["students", "departments"],
        columns_used=[
            "departments.department_name",
            "students.department_id",
            "departments.department_id",
        ],
        results=ResultTable(
            columns=["department_name", "student_count"],
            rows=[
                ["Civil Engineering", 375],
                ["Mechanical Engineering", 372],
                ["Computer Science & Engineering", 311],
                ["Electronics & Communication Engineering", 294],
                ["Information Technology", 201],
            ],
            row_count=5,
            truncated=False,
        ),
        confidence=Confidence(
            score=0.92,
            label="High",
            calibrated=True,
            signals=[
                ConfidenceSignal(
                    key="sql_validity", label="SQL Validity", score=1.0,
                    status=SignalStatus.PASS, detail="Parses; valid Postgres dialect.",
                ),
                ConfidenceSignal(
                    key="schema_alignment", label="Schema Alignment", score=1.0,
                    status=SignalStatus.PASS, detail="All 2 tables, 3 columns exist.",
                ),
                ConfidenceSignal(
                    key="back_translation_match", label="Back-translation Match",
                    score=0.89, status=SignalStatus.PASS,
                    detail="Round-trip question matches intent (0.89 cos sim).",
                ),
                ConfidenceSignal(
                    key="result_sanity", label="Result Sanity", score=0.90,
                    status=SignalStatus.PASS, detail="5 rows, totals in plausible range.",
                ),
                ConfidenceSignal(
                    key="multi_query_agreement", label="Multi-query Agreement",
                    score=0.85, status=SignalStatus.WARN,
                    detail="2 of 3 variants agree on the result set.",
                ),
            ],
        ),
        execution_time_ms=241.0,
        guardrail=GuardrailReport(
            passed=True,
            blocked_reasons=[],
            injected_limit=None,
            checks_run=["ddl_block", "dml_block", "row_limit", "subquery_depth"],
        ),
        warnings=[
            Warning(
                level=WarningLevel.INFO,
                message="'largest' was interpreted as highest enrolled student count.",
                source="ambiguity",
            )
        ],
    )


# ---------------------------------------------------------------------------
# BLOCKED example — kept for reference (shows the BLOCKED response shape).
# No longer wired into route_mock(): real BLOCKED responses are now
# constructed in routes.py from app.safety.guardrails.check_guardrails()'s
# actual AST analysis of _destructive_candidate()'s SQL, not this canned one.
# ---------------------------------------------------------------------------

def mock_blocked(question: str) -> QueryResponse:
    return QueryResponse(
        query_id=_new_id(),
        status=QueryStatus.BLOCKED,
        question=question,
        timestamp=_now(),
        sql="DROP TABLE customers;",
        explanation="The generated statement would delete the customers table.",
        tables_used=["customers"],
        columns_used=[],
        results=None,
        confidence=None,
        execution_time_ms=None,
        guardrail=GuardrailReport(
            passed=False,
            blocked_reasons=["blocked statement: Drop"],
            injected_limit=None,
            checks_run=["ddl_block", "dml_block", "row_limit", "subquery_depth"],
        ),
        warnings=[
            Warning(
                level=WarningLevel.DANGER,
                message="Destructive operation blocked before execution.",
                source="guardrails",
            )
        ],
    )


# ---------------------------------------------------------------------------
# CLARIFICATION_NEEDED example — ambiguous question, model declines rather
# than guess (refusal_kind "ambiguous", not "unsafe" -- see mock_refused()
# below for the safety-refusal counterpart)
# ---------------------------------------------------------------------------

def mock_clarification(question: str) -> QueryResponse:
    reason = "'revenue' could mean gross or net revenue -- ambiguous without clarification."
    return QueryResponse(
        query_id=_new_id(),
        status=QueryStatus.CLARIFICATION_NEEDED,
        status_reason=reason,
        question=question,
        timestamp=_now(),
        guardrail=GuardrailReport(passed=True, checks_run=[]),
        clarification=Clarification(
            reason=reason,
            options=[
                "Gross revenue (before returns and discounts)",
                "Net revenue (after returns and discounts)",
            ],
        ),
    )


# ---------------------------------------------------------------------------
# REFUSED example — unsafe request, model declines flat (no clarification
# to offer, unlike the ambiguous case above)
# ---------------------------------------------------------------------------

def mock_refused(question: str) -> QueryResponse:
    reason = "This request asks for a destructive operation, which is not permitted."
    return QueryResponse(
        query_id=_new_id(),
        status=QueryStatus.REFUSED,
        status_reason=reason,
        question=question,
        timestamp=_now(),
        explanation=reason,
        guardrail=GuardrailReport(passed=True, checks_run=[]),
    )


# ---------------------------------------------------------------------------
# Router: cheap keyword routing so the stub feels alive during frontend dev
# ---------------------------------------------------------------------------

def route_mock(question: str) -> QueryResponse:
    q = question.lower()
    if any(w in q for w in ("drop", "delete", "truncate", "alter")):
        return _destructive_candidate(question)
    if "revenue" in q:
        return mock_clarification(question)
    return mock_success(question)


# ---------------------------------------------------------------------------
# /v1/schema mock
# ---------------------------------------------------------------------------

def mock_schema() -> SchemaResponse:
    tables = [
        TableInfo(
            name="customers",
            row_estimate=1200,
            columns=[
                ColumnInfo(name="id", data_type="integer", nullable=False,
                           is_primary_key=True),
                ColumnInfo(name="name", data_type="varchar", sample_values=["Acme Corp", "Globex"]),
                ColumnInfo(name="country", data_type="varchar", sample_values=["US", "IN", "DE"]),
            ],
        ),
        TableInfo(
            name="orders",
            row_estimate=8400,
            columns=[
                ColumnInfo(name="id", data_type="integer", nullable=False,
                           is_primary_key=True),
                ColumnInfo(name="customer_id", data_type="integer",
                           is_foreign_key=True, references="customers.id"),
                ColumnInfo(name="total", data_type="numeric", sample_values=["120.50", "89.00"]),
                ColumnInfo(name="created_at", data_type="timestamp"),
            ],
        ),
    ]
    total_cols = sum(len(t.columns) for t in tables)
    return SchemaResponse(
        database="sample_shop",
        tables=tables,
        total_tables=len(tables),
        total_columns=total_cols,
    )


# ---------------------------------------------------------------------------
# /v1/history mock
# ---------------------------------------------------------------------------

def mock_history(session_id: str | None) -> HistoryResponse:
    items = [
        HistoryItem(
            query_id=_new_id(),
            question="Which departments have the most students?",
            sql_preview="SELECT d.department_name, COUNT(*) ... LIMIT 5;",
            status=QueryStatus.SUCCESS,
            confidence_score=0.92,
            row_count=5,
            timestamp=_now(),
            user_feedback=True,
        ),
        HistoryItem(
            query_id=_new_id(),
            question="Which students have attendance below 75%?",
            sql_preview="SELECT student_id, ROUND(AVG(...), 1) AS attendance_pct ... HAVING ...;",
            status=QueryStatus.SUCCESS,
            confidence_score=0.81,
            row_count=42,
            timestamp=_now(),
            user_feedback=None,
        ),
        HistoryItem(
            query_id=_new_id(),
            question="Delete all attendance records",
            sql_preview="DELETE FROM attendance;",
            status=QueryStatus.BLOCKED,
            confidence_score=None,
            row_count=None,
            timestamp=_now(),
            user_feedback=None,
        ),
    ]
    return HistoryResponse(session_id=session_id, items=items, total=len(items))
