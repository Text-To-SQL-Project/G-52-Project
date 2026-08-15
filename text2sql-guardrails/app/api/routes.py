"""
The three endpoints from the build plan, stubbed with mock data.

    POST /v1/query    -> QueryResponse
    GET  /v1/schema   -> SchemaResponse
    GET  /v1/history  -> HistoryResponse

Each handler has a TODO marking where the real pipeline plugs in. The
contract stays fixed as you replace the mocks, so the frontend never breaks.
"""
from __future__ import annotations

from fastapi import APIRouter, Query

from app.api import mock_data
from app.api.models import (
    GuardrailReport,
    HistoryResponse,
    QueryRequest,
    QueryResponse,
    QueryStatus,
    SchemaResponse,
    Warning,
    WarningLevel,
)
from app.detection.schema_align import check_schema_alignment
from app.safety.guardrails import check_guardrails

router = APIRouter(prefix="/v1", tags=["text2sql"])


@router.post("/query", response_model=QueryResponse)
def run_query(req: QueryRequest) -> QueryResponse:
    """Translate a natural-language question to SQL, run it safely, and
    return results + calibrated confidence.

    TODO (replace the mock, in this order):
      1. app.schema.retriever  -> pick relevant tables
      2. app.generation        -> LLM produces sql + metadata
      3. app.safety.guardrails -> static AST checks (may BLOCK here)      [REAL]
      4. app.detection (pre)   -> back-translation, schema alignment      [schema alignment REAL]
      5. app.safety.sandbox    -> read-only execution
      6. app.detection (post)  -> result sanity, multi-query
      7. app.detection.confidence -> fuse + calibrate
    """
    if req.sql_override:
        # Power-user path: user edited SQL in the UI. Still runs through
        # guardrails below -- an override is exactly the case guardrails
        # exist for.
        candidate = mock_data.mock_success(req.question)
        candidate.sql = req.sql_override
    else:
        candidate = mock_data.route_mock(req.question)

    if candidate.status == QueryStatus.CLARIFICATION_NEEDED or candidate.sql is None:
        return candidate

    # 3. app.safety.guardrails -- real AST checks, may BLOCK here.
    result = check_guardrails(candidate.sql)
    if not result.passed:
        return QueryResponse(
            query_id=candidate.query_id,
            status=QueryStatus.BLOCKED,
            question=candidate.question,
            timestamp=candidate.timestamp,
            sql=candidate.sql,
            explanation=candidate.explanation,
            tables_used=candidate.tables_used,
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
    candidate.sql = result.safe_sql
    candidate.guardrail = GuardrailReport(
        passed=True,
        blocked_reasons=[],
        injected_limit=result.injected_limit,
        checks_run=result.checks_run,
    )

    # 4. app.detection (pre) -- schema alignment, replaces the mock signal.
    alignment_signal = check_schema_alignment(candidate.sql)
    if candidate.confidence is not None:
        candidate.confidence.signals = [
            alignment_signal if s.key == "schema_alignment" else s
            for s in candidate.confidence.signals
        ]

    # 5-7 (sandbox execution, post-detection, confidence fusion) still TODO.
    return candidate


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
