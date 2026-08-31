"""
The three endpoints from the build plan, stubbed with mock data.

    POST /v1/query    -> QueryResponse
    GET  /v1/schema   -> SchemaResponse
    GET  /v1/history  -> HistoryResponse

Each handler has a TODO marking where the real pipeline plugs in. The
contract stays fixed as you replace the mocks, so the frontend never breaks.
"""
from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Query
from sqlalchemy import text

from app.api import mock_data
from app.api.admin_models import (
    AdminConfigResponse,
    DetectionConfig,
    EvalSummary,
    GuardrailConfig,
)
from app.api.models import (
    Clarification,
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
from app.config import settings
from app.db import get_readonly_engine
from app.detection import calibration
from app.detection.back_translation import check_back_translation
from app.detection.confidence import FAIL_SCORE_CAP, WEIGHTS, fuse_confidence
from app.detection.multi_query import check_multi_query_agreement
from app.detection.result_sanity import check_result_sanity
from app.detection.schema_align import check_schema_alignment
from app.generation.generator import generate_sql, is_noop_sql
from app.safety.guardrails import check_guardrails

router = APIRouter(prefix="/v1", tags=["text2sql"])
logger = logging.getLogger(__name__)

# The model's own reason for declining is free text -- it was written to
# explain the refusal clearly, which routinely means naming exactly which
# tables/entities it checked and ruled out (see eval/README.md's own quoted
# example). That's schema disclosure to an unauthenticated client, so these
# generic messages are what the CLIENT sees; the model's real reason is
# logged server-side (see the `logger.info(...)` calls below) and is still
# what eval/runner.py records in results.jsonl, since that path calls
# generate_sql() directly and never goes through this substitution.
_CLARIFICATION_CLIENT_MESSAGE = (
    "This question can't be answered from the available data. Try "
    "rephrasing, or check the Schema Explorer for what's queryable."
)
_REFUSED_CLIENT_MESSAGE = (
    "This request was declined because it appears to ask for a "
    "destructive or unsafe operation, which isn't permitted."
)
# Used only by the disguised-no-op backstop below, where refusal=false was
# reported so there's no refusal_kind to trust either way -- this message
# makes no claim about *why* generation failed to produce a real query,
# unlike _REFUSED_CLIENT_MESSAGE's specific "destructive/unsafe" framing.
_GENERATION_FAILED_CLIENT_MESSAGE = (
    "This question could not be translated into a query. Try rephrasing, "
    "or check the Schema Explorer for what's queryable."
)


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
                status_reason=f"SQL generation failed: {e}",
                question=req.question,
                timestamp=timestamp,
                guardrail=GuardrailReport(passed=True, checks_run=[]),
                error_message=f"SQL generation failed: {e}",
            )

        if gen.refusal:
            # The model reported its own refusal via the structured
            # `refusal` field -- short-circuit here. Never call the
            # guardrail or the executor for a refusal: there is no real
            # query to check or run, and doing so risks accidentally
            # executing whatever gen.sql happens to hold (which should be
            # None, but a refusal is exactly the case not to trust that).
            # refusal_kind picks the status: "unsafe" is a flat safety
            # decline (REFUSED, no clarification to offer); "ambiguous" is
            # a question the system could answer given more specificity
            # (CLARIFICATION_NEEDED, with a reason to show the user).
            reason = gen.reason or "The model declined to generate SQL for this request."
            if gen.refusal_kind == "ambiguous":
                logger.info("CLARIFICATION_NEEDED for question=%r reason=%r", req.question, reason)
                return QueryResponse(
                    query_id=query_id,
                    status=QueryStatus.CLARIFICATION_NEEDED,
                    status_reason=_CLARIFICATION_CLIENT_MESSAGE,
                    question=req.question,
                    timestamp=timestamp,
                    guardrail=GuardrailReport(passed=True, checks_run=[]),
                    clarification=Clarification(reason=_CLARIFICATION_CLIENT_MESSAGE, options=[]),
                )
            logger.info("REFUSED (unsafe) for question=%r reason=%r", req.question, reason)
            return QueryResponse(
                query_id=query_id,
                status=QueryStatus.REFUSED,
                status_reason=_REFUSED_CLIENT_MESSAGE,
                question=req.question,
                timestamp=timestamp,
                guardrail=GuardrailReport(passed=True, checks_run=[]),
            )

        sql = gen.sql
        explanation = gen.explanation
        tables_used = gen.tables_used
        columns_used = gen.columns_used

        if not sql or not sql.strip() or is_noop_sql(sql):
            # Defensive backstop, not the primary refusal path: refusal was
            # reported False but the SQL itself is empty or a disguised
            # no-op (e.g. "SELECT 1 WHERE FALSE") -- the prompt explicitly
            # forbids this, but LLM output isn't guaranteed to comply, and
            # letting it through would execute a harmless-looking query
            # that silently reports SUCCESS with zero rows instead of the
            # refusal it actually is.
            logger.info(
                "REFUSED (disguised no-op despite refusal=false) for question=%r sql=%r",
                req.question, sql,
            )
            return QueryResponse(
                query_id=query_id,
                status=QueryStatus.REFUSED,
                status_reason=_GENERATION_FAILED_CLIENT_MESSAGE,
                question=req.question,
                timestamp=timestamp,
                guardrail=GuardrailReport(passed=True, checks_run=[]),
            )

    # 3. app.safety.guardrails -- real AST checks, may BLOCK here.
    result = check_guardrails(sql)
    if not result.passed:
        # blocked_reasons/checks_run describe the STATEMENT (e.g. "blocked
        # statement: Delete", a subquery-depth number) -- generic across any
        # database, safe to show as-is. `sql` and `tables_used`/
        # `columns_used` are NOT: the blocked SQL and the table list gen.py
        # extracted from it are schema disclosure the same way a
        # clarification reason is, so they're logged server-side only and
        # omitted from the client response (the frontend never rendered
        # them here anyway -- SqlPanel is success-only -- but they were
        # still sitting in the raw response body, inspectable via
        # DevTools/curl regardless of what the UI chose to render).
        logger.info(
            "BLOCKED for question=%r sql=%r tables_used=%r reasons=%r",
            req.question, sql, tables_used, result.blocked_reasons,
        )
        return QueryResponse(
            query_id=query_id,
            status=QueryStatus.BLOCKED,
            status_reason="; ".join(result.blocked_reasons) or "Blocked by guardrails.",
            question=req.question,
            timestamp=timestamp,
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
            status_reason=f"Execution failed: {e}",
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


@router.get("/admin/config", response_model=AdminConfigResponse)
def get_admin_config() -> AdminConfigResponse:
    """Live config + safety thresholds + the published eval numbers, for
    the Admin screen. eval_summary is NOT live-computed (see EvalSummary's
    docstring) -- it's the numbers from the last full eval/analyze.py run,
    the same ones cited in README.md and eval/README.md."""
    return AdminConfigResponse(
        app_name=settings.APP_NAME,
        version=settings.VERSION,
        llm_model=settings.LLM_MODEL,
        guardrail=GuardrailConfig(
            default_row_limit=settings.DEFAULT_ROW_LIMIT,
            max_subquery_depth=settings.MAX_SUBQUERY_DEPTH,
            statement_timeout_ms=settings.STATEMENT_TIMEOUT_MS,
        ),
        detection=DetectionConfig(
            back_translation_enabled=settings.BACK_TRANSLATION_ENABLED,
            multi_query_enabled=settings.MULTI_QUERY_ENABLED,
            multi_query_n=settings.MULTI_QUERY_N,
            confidence_weights=WEIGHTS,
            fail_score_cap=FAIL_SCORE_CAP,
            calibration_loaded=calibration.is_available(),
        ),
        eval_summary=EvalSummary(
            execution_accuracy=0.714,
            fused_auroc=0.649,
            held_out_ece=0.118,
            guardrail_block_rate="30/30 (direct_sql layer)",
            destructive_queries_executed=0,
            adversarial_executed_flags=8,
            golden_set_size=161,
            unique_answerable_questions=135,
            note="From the last full `python -m eval.runner --repeats 3` + "
                 "`eval.analyze` + `eval.fit_calibration` run. "
                 "adversarial_executed_flags=8 is analyze.py's coarse "
                 "heuristic (any adversarial case whose SQL executed at "
                 "all); manual inspection of all 8 found benign LLM "
                 "substitutions (e.g. a DROP-TABLE prompt returning a "
                 "plain SELECT), not guardrail bypasses -- "
                 "destructive_queries_executed=0 is the verified count "
                 "of actually-destructive SQL that ran. See eval/README.md.",
        ),
    )
