"""
Real persistence for the History screen, backed by app.query_history --
deliberately in a dedicated `app` schema, not `college_erp` (see
seed/28_query_history.sql's comment): it must never show up in
introspect_schema()'s results, or it would leak into the Schema Explorer
and the LLM's own generation prompt as a "queryable" table.

write_history_row() is called once per POST /v1/query request at EVERY
return point in app.api.routes.run_query() -- not just on SUCCESS. It
stores the REAL sql/reason (needed for a future authenticated admin view,
see Task 4's scope), and is best-effort: any failure is logged and
swallowed, never raised, so a history-write hiccup can't break the actual
query response.

read_history() backs GET /v1/history. It re-derives the same generic,
schema-free client message app.api.client_messages defines for
QueryResponse -- a history card must not show more than the original
response did, even though the real value is sitting right there in the
row.
"""
from __future__ import annotations

import logging
import re

from sqlalchemy import text

from app.api import client_messages
from app.api.models import HistoryItem, QueryStatus
from app.db import get_engine

logger = logging.getLogger(__name__)

_PREVIEW_MAX_LEN = 200

# Status -> what a history card shows in place of the real (possibly
# schema-bearing) stored reason. BLOCKED is deliberately absent: its
# blocked_reasons text was audited in app/api/routes.py and confirmed
# schema-safe (SQL statement type/depth, never a table/column name), so
# the real stored value is shown as-is, same as QueryResponse.status_reason
# already does for BLOCKED today.
_GENERIC_REASON_BY_STATUS = {
    QueryStatus.CLARIFICATION_NEEDED: client_messages.CLARIFICATION_CLIENT_MESSAGE,
    QueryStatus.REFUSED: client_messages.REFUSED_CLIENT_MESSAGE,
    QueryStatus.ERROR: client_messages.EXECUTION_ERROR_CLIENT_MESSAGE,
}


def _truncate(sql: str) -> str:
    one_line = re.sub(r"\s+", " ", sql).strip()
    if len(one_line) <= _PREVIEW_MAX_LEN:
        return one_line
    return one_line[:_PREVIEW_MAX_LEN].rstrip() + " ..."


def write_history_row(
    *,
    query_id: str,
    session_id: str | None,
    question: str,
    status: QueryStatus,
    sql: str | None,
    status_reason: str | None,
    confidence_score: float | None = None,
    row_count: int | None = None,
) -> None:
    if not session_id:
        # No session to group this under -- nothing meaningful to write.
        return
    try:
        engine = get_engine()
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO app.query_history "
                    "(query_id, session_id, question, sql_preview, status, "
                    "status_reason, confidence_score, row_count) "
                    "VALUES (:query_id, :session_id, :question, :sql_preview, "
                    ":status, :status_reason, :confidence_score, :row_count)"
                ),
                {
                    "query_id": query_id,
                    "session_id": session_id,
                    "question": question,
                    "sql_preview": _truncate(sql) if sql else None,
                    "status": status.value,
                    "status_reason": status_reason,
                    "confidence_score": confidence_score,
                    "row_count": row_count,
                },
            )
    except Exception as e:
        # Best-effort: never let a history-write failure break the query
        # response the user is actually waiting on.
        logger.error("Failed to write history row for query_id=%r: %s", query_id, e)


def read_history(session_id: str | None, limit: int = 50) -> list[HistoryItem]:
    if not session_id:
        return []
    engine = get_engine()
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT query_id, question, sql_preview, status, status_reason, "
                "confidence_score, row_count, created_at "
                "FROM app.query_history "
                "WHERE session_id = :session_id "
                "ORDER BY created_at DESC "
                "LIMIT :limit"
            ),
            {"session_id": session_id, "limit": limit},
        ).fetchall()

    items = []
    for r in rows:
        status = QueryStatus(r.status)
        if status == QueryStatus.SUCCESS:
            sql_preview, status_reason = r.sql_preview, None
        elif status == QueryStatus.BLOCKED:
            sql_preview, status_reason = None, r.status_reason
        else:
            sql_preview, status_reason = None, _GENERIC_REASON_BY_STATUS.get(status)
        items.append(
            HistoryItem(
                query_id=r.query_id,
                question=r.question,
                sql_preview=sql_preview,
                status=status,
                status_reason=status_reason,
                confidence_score=r.confidence_score,
                row_count=r.row_count,
                timestamp=r.created_at,
                user_feedback=None,
            )
        )
    return items


def read_blocked_queries(limit: int = 50) -> list[dict]:
    """The REAL, unredacted SQL for recent BLOCKED queries, across ALL
    sessions -- deliberately the one place that bypasses read_history()'s
    redaction. Callers (app/api/routes.py's admin-only endpoint) MUST sit
    behind require_auth; this function has no auth of its own, same as
    every other function in this module -- the boundary is the route, not
    the query. See Task 4's scope: "re-expose the blocked SQL -- but ONLY
    in the Admin screen, behind the auth dependency, never in the
    Workspace response body" -- this is what makes that possible without
    touching Task 1's fix to the actual query-response path."""
    engine = get_engine()
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT query_id, question, sql_preview, status_reason, created_at "
                "FROM app.query_history "
                "WHERE status = 'blocked' "
                "ORDER BY created_at DESC "
                "LIMIT :limit"
            ),
            {"limit": limit},
        ).fetchall()
    return [
        {
            "query_id": r.query_id,
            "question": r.question,
            "sql": r.sql_preview,
            "blocked_reason": r.status_reason,
            "timestamp": r.created_at,
        }
        for r in rows
    ]
