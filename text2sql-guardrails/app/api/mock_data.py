"""
Degrade-gracefully fallbacks for GET /v1/schema and GET /v1/history --
used ONLY if the real path (introspect_schema() / app.history.read_history())
raises, e.g. the DB is unreachable. Everything else that used to live here
(mock SUCCESS/BLOCKED/CLARIFICATION_NEEDED/REFUSED responses and the
keyword router that picked between them) was the original Phase-1 stub for
POST /v1/query, fully superseded once app.generation/app.safety/
app.detection were built for real -- deleted as confirmed-dead code (zero
callers anywhere outside this file) rather than left to rot.

mock_schema()'s fake table names ("customers"/"orders") predate the
project's pivot to the real college_erp schema and are stale -- if this
fallback ever actually fires, the Schema Explorer would show the wrong
schema entirely. Left as a known issue, not fixed here.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.api.models import (
    ColumnInfo,
    HistoryItem,
    HistoryResponse,
    QueryStatus,
    SchemaResponse,
    TableInfo,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_id() -> str:
    return f"q_{uuid.uuid4().hex[:12]}"


# ---------------------------------------------------------------------------
# /v1/schema fallback
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
# /v1/history fallback
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
