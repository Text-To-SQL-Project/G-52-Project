"""
The three endpoints from the build plan, stubbed with mock data.

    POST /v1/query    -> QueryResponse
    GET  /v1/schema   -> SchemaResponse
    GET  /v1/history  -> HistoryResponse

Each handler has a TODO marking where the real pipeline plugs in. The
contract stays fixed as you replace the mocks, so the frontend never breaks.
"""
from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Query
from sqlalchemy import text

from app.api import mock_data
from app.api.models import (
    ConfidenceSignal,
    GuardrailReport,
    HistoryResponse,
    QueryRequest,
    QueryResponse,
    QueryStatus,
    ResultTable,
    SchemaResponse,
    SignalStatus,
    Warning,
    WarningLevel,
)
from app.db import get_readonly_engine
from app.detection.back_translation import check_back_translation
from app.detection.confidence import fuse_confidence
from app.detection.multi_query import check_multi_query_agreement
from app.detection.result_sanity import check_result_sanity
from app.detection.schema_align import check_schema_alignment
from app.generation.generator import generate_sql
from app.safety.guardrails import check_guardrails

router = APIRouter(prefix="/v1", tags=["text2sql"])


def _new_id() -> str:
    return f"q_{uuid.uuid4().hex[:12]}"


@router.post("/query", response_model=QueryResponse)
def run_query(req: QueryRequest) -> QueryResponse:
    """Translate a natural-language question to SQL, run it safely, and
    return results + calibrated confidence.

    Pipeline (replaces the mock, in this order):
      1. app.schema.retriever  -> pick relevant tables               [not yet -- full schema used]
      2. app.generation        -> LLM produces sql + metadata        [REAL]
      3. app.safety.guardrails -> static AST checks (may BLOCK here) [REAL]
      4. app.detection (pre)   -> back-translation, schema alignment [REAL]
      5. app.safety.sandbox    -> read-only execution                [REAL, inline -- no sandbox module yet]
      6. app.detection (post)  -> result sanity, multi-query         [REAL]
      7. app.detection.confidence -> fuse + calibrate                [fusion REAL; calibration is Phase 5]
    """
    query_id = _new_id()
    timestamp = datetime.now(timezone.utc)

    # 1-2. schema retrieval + generation.
    if req.sql_override:
        # Power-user path: user edited SQL in the UI. No LLM call, but it
        # still runs through guardrails below -- an override is exactly the
        # case guardrails exist for.
        sql = req.sql_override
        explanation = "User-provided SQL override."
        tables_used: list[str] = []
        columns_used: list[str] = []
    else:
        try:
            gen = generate_sql(req.question)
        except Exception as e:
            return QueryResponse(
                query_id=query_id,
                status=QueryStatus.ERROR,
                question=req.question,
                timestamp=timestamp,
                guardrail=GuardrailReport(passed=True, checks_run=[]),
                error_message=f"SQL generation failed: {e}",
            )
        sql = gen.sql
        explanation = gen.explanation
        tables_used = gen.tables_used
        columns_used = gen.columns_used

    # 3. app.safety.guardrails -- real AST checks, may BLOCK here.
    result = check_guardrails(sql)
    if not result.passed:
        return QueryResponse(
            query_id=query_id,
            status=QueryStatus.BLOCKED,
            question=req.question,
            timestamp=timestamp,
            sql=sql,
            explanation=explanation,
            tables_used=tables_used,
            columns_used=[],
            results=None,
            confidence=None,
            execution_time_ms=None,
            guardrail=GuardrailReport(
                passed=False,
                blocked_reasons=result.blocked_reasons,
                injected_limit=None,
                checks_run=result.checks_run,
            ),
            warnings=[
                Warning(
                    level=WarningLevel.DANGER,
                    message="Destructive or unsafe operation blocked before execution.",
                    source="guardrails",
                )
            ],
        )

    # Guardrails passed: use the (possibly LIMIT-injected) safe SQL downstream.
    safe_sql = result.safe_sql
    guardrail_report = GuardrailReport(
        passed=True,
        blocked_reasons=[],
        injected_limit=result.injected_limit,
        checks_run=result.checks_run,
    )

    # 4. app.detection (pre) -- schema alignment + back-translation are
    # computed here. result_sanity and multi_query_agreement start as
    # placeholders and get replaced with the real signals after execution
    # below (both need the executed rows).
    alignment_signal = check_schema_alignment(safe_sql)
    back_translation_signal = check_back_translation(req.question, safe_sql)
    signals = [
        ConfidenceSignal(
            key="sql_validity", label="SQL Validity", score=1.0,
            status=SignalStatus.PASS, detail="Parses via sqlglot; passed guardrail AST checks.",
        ),
        alignment_signal,
        back_translation_signal,
        ConfidenceSignal(
            key="result_sanity", label="Result Sanity", score=0.5,
            status=SignalStatus.WARN, detail="pending execution",
        ),
        ConfidenceSignal(
            key="multi_query_agreement", label="Multi-query Agreement",
            score=0.5, status=SignalStatus.WARN, detail="pending execution",
        ),
    ]

    # 5. app.safety.sandbox -- real read-only execution (inline; no
    # dedicated sandbox module yet).
    engine = get_readonly_engine()
    start = time.perf_counter()
    try:
        with engine.connect() as conn:
            cursor = conn.execute(text(safe_sql))
            result_columns = list(cursor.keys())
            result_rows = [list(row) for row in cursor.fetchall()]
    except Exception as e:
        return QueryResponse(
            query_id=query_id,
            status=QueryStatus.ERROR,
            question=req.question,
            timestamp=timestamp,
            sql=safe_sql,
            explanation=explanation,
            tables_used=tables_used,
            columns_used=columns_used,
            results=None,
            confidence=None,
            execution_time_ms=None,
            guardrail=guardrail_report,
            warnings=[],
            error_message=f"Execution failed: {e}",
        )
    execution_time_ms = round((time.perf_counter() - start) * 1000, 2)

    # 6. app.detection (post) -- result sanity + multi-query agreement,
    # both real; both need the rows so they can only run here, after
    # execution.
    result_sanity_signal = check_result_sanity(safe_sql, result_columns, result_rows, req.question)
    multi_query_signal = check_multi_query_agreement(req.question, safe_sql, result_rows)
    signals = [
        result_sanity_signal if s.key == "result_sanity"
        else multi_query_signal if s.key == "multi_query_agreement"
        else s
        for s in signals
    ]

    # 7. app.detection.confidence -- fuse the five real signals into one
    # overall score (weighted mean + hard fail-override; see
    # app/detection/confidence.py). Not a calibrated probability -- see
    # Confidence.calibrated / fuse_confidence's own comment.
    return QueryResponse(
        query_id=query_id,
        status=QueryStatus.SUCCESS,
        question=req.question,
        timestamp=timestamp,
        sql=safe_sql,
        explanation=explanation,
        tables_used=tables_used,
        columns_used=columns_used,
        results=ResultTable(
            columns=result_columns,
            rows=result_rows,
            row_count=len(result_rows),
            truncated=False,
        ),
        confidence=fuse_confidence(signals),
        execution_time_ms=execution_time_ms,
        guardrail=guardrail_report,
        warnings=[],
    )


@router.get("/schema", response_model=SchemaResponse)
def get_schema() -> SchemaResponse:
    """Return the LIVE database schema for the Schema Explorer screen.

    Uses real SQLAlchemy introspection against whatever DB is connected
    (your SQLite file or Postgres). Falls back to mock data only if no DB
    is reachable yet, so the stub still runs before you connect your data.
    """
    try:
        from app.schema.introspect import introspect_schema
        return introspect_schema()
    except Exception:
        return mock_data.mock_schema()


@router.get("/history", response_model=HistoryResponse)
def get_history(
    session_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> HistoryResponse:
    """Return past queries for the History screen.

    TODO: replace with a real query-log table read.
    """
    resp = mock_data.mock_history(session_id)
    resp.items = resp.items[:limit]
    return resp
