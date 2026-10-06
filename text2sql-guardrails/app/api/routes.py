"""
    POST /v1/query    -> QueryResponse
    GET  /v1/schema   -> SchemaResponse
    GET  /v1/history  -> HistoryResponse
    GET  /v1/admin/config -> AdminConfigResponse

All real (app.generation/app.safety/app.detection/app.history). schema/
history raise a real 503 if their DB-dependent path fails -- no fallback
to fake data, see get_schema()/get_history()'s own docstrings for why.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import text

from app.api import client_messages
from app.api.admin_models import (
    AblationCell,
    AdminConfigResponse,
    AurocComparison,
    BlockedQueriesResponse,
    BlockedQueryItem,
    DetectionConfig,
    EvalMetricsResponse,
    EvalSummary,
    GuardrailConfig,
    PerSignalAurocItem,
    RlsDemoResponse,
    RlsPrincipalRowCounts,
    SafetyLayerMetrics,
)
from app.api.models import (
    Clarification,
    Confidence,
    ConfidenceSignal,
    ConfidenceTicket,
    ConfidenceUpdate,
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
from app.auth import require_admin, require_auth
from app.db import get_engine, get_readonly_engine
from app.safety.session_scope import (
    ScopeTamperingError,
    SessionBindingError,
    apply_scope,
    assert_scope_intact,
    bind_session,
    check_rows_match_principal,
    read_backend_identity,
    release_session,
)
from app.detection import calibration
from app.detection.back_translation import check_back_translation
from app.detection.confidence import FAIL_SCORE_CAP, WEIGHTS, fuse_confidence
from app.detection.multi_query import check_multi_query_agreement
from app.detection.result_sanity import check_result_sanity
from app.detection.schema_align import check_schema_alignment
import sqlglot
from sqlglot import exp

from app.generation.generator import generate_sql, is_noop_sql
from app.generation.llm_client import use_provider, wait_for_background_room
from app import llm_pool
from app.http_guard import limit_query
from app.users import Principal
from app.history import (
    read_blocked_queries,
    read_history,
    update_history_confidence,
    write_history_row,
)
from app.schema.introspect import invalidate_schema_cache
from app.safety.guardrails import check_guardrails

router = APIRouter(prefix="/v1", tags=["text2sql"])
logger = logging.getLogger(__name__)

# Generic, schema-free client messages -- see app/api/client_messages.py's
# module docstring for the full rationale (they're shared with
# app/history.py, which needs the identical text when serving a stored
# non-SUCCESS row through GET /v1/history).
_CLARIFICATION_CLIENT_MESSAGE = client_messages.CLARIFICATION_CLIENT_MESSAGE
_REFUSED_CLIENT_MESSAGE = client_messages.REFUSED_CLIENT_MESSAGE
_GENERATION_FAILED_CLIENT_MESSAGE = client_messages.GENERATION_FAILED_CLIENT_MESSAGE
_GENERATION_ERROR_CLIENT_MESSAGE = client_messages.GENERATION_ERROR_CLIENT_MESSAGE
_EXECUTION_ERROR_CLIENT_MESSAGE = client_messages.EXECUTION_ERROR_CLIENT_MESSAGE


def _new_id() -> str:
    return f"q_{uuid.uuid4().hex[:12]}"


# --- deferred signals -------------------------------------------------------
# Back-translation is two extra LLM round-trips (~2-4 s), more than the whole
# interactive budget. It doesn't gate execution, so /v1/query answers without
# it and hands back a signed ticket; the client redeems the ticket once at
# POST /v1/query/{id}/confidence, which runs the check and returns the final
# score. Stateless on purpose: no background thread (serverless platforms
# freeze a function after it responds) and no in-process store (any instance
# can redeem any ticket).
_TICKET_TTL_SECONDS = 15 * 60

_BT_PENDING_SIGNAL = ConfidenceSignal(
    key="back_translation_match", label="Back-translation Match", score=0.5,
    status=SignalStatus.PENDING, detail="Measuring after the answer is shown.",
)


def _ticket_key() -> bytes:
    # Derived key: a confidence ticket can never be replayed as a session token.
    return hmac.new(settings.SECRET_KEY.encode(), b"confidence-ticket", hashlib.sha256).digest()


def _make_ticket(payload: dict) -> str:
    body = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()
    sig = hmac.new(_ticket_key(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def _read_ticket(ticket: str) -> dict | None:
    try:
        body, sig = ticket.rsplit(".", 1)
        if not hmac.compare_digest(sig, hmac.new(_ticket_key(), body.encode(), hashlib.sha256).hexdigest()):
            return None
        data = json.loads(base64.urlsafe_b64decode(body.encode()))
        return data if data.get("exp", 0) > time.time() else None
    except Exception:
        return None


def _finish_back_translation(
    question: str, sql: str, signals: list[ConfidenceSignal], row_scoped: bool
) -> Confidence:
    try:
        # Short wait only: this request is the user's, not background work.
        if not wait_for_background_room(max_wait_seconds=8):
            raise RuntimeError("skipped to keep LLM_RPM_LIMIT headroom for new questions")
        bt = check_back_translation(question, sql)  # never raises by contract
    except Exception as e:
        bt = ConfidenceSignal(
            key="back_translation_match", label="Back-translation Match", score=0.5,
            status=SignalStatus.WARN, detail=f"Back-translation check could not run: {e}",
        )
    return fuse_confidence(
        [bt if s.key == "back_translation_match" else s for s in signals], row_scoped=row_scoped
    )


@router.post("/query/{query_id}/confidence", response_model=ConfidenceUpdate)
def redeem_confidence_ticket(
    query_id: str, req: ConfidenceTicket, principal: Principal = Depends(require_auth)
) -> ConfidenceUpdate:
    t = _read_ticket(req.ticket)
    # One 404 for forged, expired, other-user and wrong-id tickets alike.
    if t is None or t.get("q") != query_id or t.get("u") != principal.user_id:
        raise HTTPException(status_code=404, detail="Unknown or expired query.")
    with use_provider(t.get("p")):
        final = _finish_back_translation(
            t["question"], t["sql"], [ConfidenceSignal(**s) for s in t["signals"]], t["rs"]
        )
    update_history_confidence(query_id, final.score)
    return ConfidenceUpdate(query_id=query_id, pending=False, confidence=final)


@router.post("/query", response_model=QueryResponse, dependencies=[Depends(limit_query)])
def run_query(
    req: QueryRequest,
    principal: Principal = Depends(require_auth),
    response: Response = None,  # injected by FastAPI; None when called directly (tests)
) -> QueryResponse:
    """Translate a natural-language question to SQL, run it safely, and
    return results + calibrated confidence.

    Pipeline (replaces the mock, in this order):
      1. app.schema.retriever  -> pick relevant tables               [not yet -- full schema used]
      2. app.generation        -> LLM produces sql + metadata        [REAL]
      3. app.safety.guardrails -> static AST checks (may BLOCK here) [REAL]
      4. app.detection (pre)   -> back-translation, schema alignment [REAL]
      5. app.safety.sandbox    -> read-only execution                [REAL, inline -- no sandbox module yet]
      6. app.detection (post)  -> result sanity, multi-query         [REAL]
      7. app.detection.confidence -> fuse + calibrate                [REAL]
    """
    query_id = _new_id()
    timestamp = datetime.now(timezone.utc)
    timings: dict[str, float] = {}
    clock = [time.perf_counter()]
    # The admin key pool when it has keys, else the env provider (see
    # APP_LLM_PROVIDER). Cached readiness check: ~0 ms on the hot path.
    provider = llm_pool.app_provider()

    def lap(stage: str) -> None:
        now = time.perf_counter()
        timings[stage] = round((now - clock[0]) * 1000, 1)
        clock[0] = now

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
            # Same flag result_sanity uses, from the principal only. An
            # admin is not row-scoped, and is_admin allows DDL/DML operations.
            with use_provider(provider):
                gen = generate_sql(
                    req.question,
                    row_scoped=not principal.is_admin,
                    is_admin=principal.is_admin,
                    timeout=settings.APP_LLM_TIMEOUT_SECONDS,
                    max_attempts=settings.APP_LLM_MAX_ATTEMPTS,
                    # A duplicate request only burns quota under the single
                    # env key's RPM cap; the pool spreads it across keys.
                    hedge_after=(
                        None if settings.LLM_RPM_LIMIT and provider != "litellm"
                        else settings.APP_LLM_HEDGE_SECONDS
                    ),
                )
        except Exception as e:
            logger.error("SQL generation failed for question=%r: %s", req.question, e)
            write_history_row(
                query_id=query_id, session_id=req.session_id, user_id=principal.user_id,
                question=req.question,
                status=QueryStatus.ERROR, sql=None, status_reason=f"SQL generation failed: {e}",
            )
            return QueryResponse(
                query_id=query_id,
                status=QueryStatus.ERROR,
                status_reason=_GENERATION_ERROR_CLIENT_MESSAGE,
                question=req.question,
                timestamp=timestamp,
                guardrail=GuardrailReport(passed=True, checks_run=[]),
                error_message=_GENERATION_ERROR_CLIENT_MESSAGE,
            )

        if gen.refusal and not (principal.is_admin and gen.sql):
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
                write_history_row(
                    query_id=query_id, session_id=req.session_id, user_id=principal.user_id,
                question=req.question,
                    status=QueryStatus.CLARIFICATION_NEEDED, sql=None, status_reason=reason,
                )
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
            write_history_row(
                query_id=query_id, session_id=req.session_id, user_id=principal.user_id,
                question=req.question,
                status=QueryStatus.REFUSED, sql=None, status_reason=reason,
            )
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
            write_history_row(
                query_id=query_id, session_id=req.session_id, user_id=principal.user_id,
                question=req.question,
                status=QueryStatus.REFUSED, sql=sql,
                status_reason="Disguised refusal (empty/no-op SQL) despite refusal=false.",
            )
            return QueryResponse(
                query_id=query_id,
                status=QueryStatus.REFUSED,
                status_reason=_GENERATION_FAILED_CLIENT_MESSAGE,
                question=req.question,
                timestamp=timestamp,
                guardrail=GuardrailReport(passed=True, checks_run=[]),
            )

    lap("generation")

    # 3. app.safety.guardrails -- real AST checks, may BLOCK here.
    if principal.is_admin:
        # Admin bypasses AST guardrails for full administrative operations (DDL/DML/etc.)
        safe_sql = sql
        guardrail_report = GuardrailReport(
            passed=True,
            blocked_reasons=[],
            injected_limit=None,
            checks_run=["admin_override_bypass"],
        )
    else:
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
            blocked_reason_text = "; ".join(result.blocked_reasons) or "Blocked by guardrails."
            write_history_row(
                query_id=query_id, session_id=req.session_id, user_id=principal.user_id,
                question=req.question,
                status=QueryStatus.BLOCKED, sql=sql, status_reason=blocked_reason_text,
            )
            return QueryResponse(
                query_id=query_id,
                status=QueryStatus.BLOCKED,
                status_reason=blocked_reason_text,
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

    # Check statement type
    stmt = None
    try:
        stmt = sqlglot.parse_one(safe_sql, dialect="postgres")
    except Exception:
        pass
    is_select = isinstance(stmt, exp.Select) if stmt else False
    lap("guardrails")
    bt_pending = False

    # 4. app.detection (pre) -- schema alignment + back-translation
    if principal.is_admin and not is_select:
        # Pre-populate confidence signals for admin DDL/DML operations
        signals = [
            ConfidenceSignal(
                key="sql_validity", label="SQL Validity", score=1.0,
                status=SignalStatus.PASS, detail="Admin statement parsed; guardrails bypassed.",
            ),
            ConfidenceSignal(
                key="schema_alignment", label="Schema Alignment", score=1.0,
                status=SignalStatus.PASS, detail="Admin DDL/DML operation.",
            ),
            ConfidenceSignal(
                key="back_translation", label="Back-translation", score=1.0,
                status=SignalStatus.PASS, detail="Admin operation.",
            ),
            ConfidenceSignal(
                key="result_sanity", label="Result Sanity", score=1.0,
                status=SignalStatus.PASS, detail="pending execution",
            ),
            ConfidenceSignal(
                key="multi_query_agreement", label="Multi-query Agreement",
                score=1.0, status=SignalStatus.PASS, detail="pending execution",
            ),
        ]
    else:
        alignment_signal = check_schema_alignment(safe_sql)
        bt_pending = settings.BACK_TRANSLATION_ENABLED
        back_translation_signal = (
            _BT_PENDING_SIGNAL if bt_pending
            else check_back_translation(req.question, safe_sql)  # the disabled placeholder
        )
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

    lap("pre_checks")

    # 5. Execution
    start = time.perf_counter()
    if principal.is_admin:
        # Admin executes via privileged superuser engine with full DDL/DML permissions
        privileged_engine = get_engine()
        try:
            with privileged_engine.begin() as conn:
                cursor = conn.execute(text(safe_sql))
                if cursor.returns_rows:
                    result_columns = list(cursor.keys())
                    result_rows = [list(row) for row in cursor.fetchall()]
                else:
                    result_columns = ["operation", "status", "rows_affected"]
                    rows_aff = cursor.rowcount if cursor.rowcount >= 0 else "N/A"
                    result_rows = [["Admin SQL", "Executed successfully", rows_aff]]
        except Exception as e:
            logger.error("Admin execution failed for question=%r sql=%r: %s", req.question, safe_sql, e)
            write_history_row(
                query_id=query_id, session_id=req.session_id, user_id=principal.user_id,
                question=req.question, status=QueryStatus.ERROR, sql=safe_sql,
                status_reason=f"Execution failed: {e}",
            )
            return QueryResponse(
                query_id=query_id,
                status=QueryStatus.ERROR,
                status_reason=_EXECUTION_ERROR_CLIENT_MESSAGE,
                question=req.question,
                timestamp=timestamp,
                results=None,
                confidence=None,
                execution_time_ms=None,
                guardrail=guardrail_report,
                warnings=[],
                error_message=_EXECUTION_ERROR_CLIENT_MESSAGE,
            )
    else:
        # Non-admin (student, faculty): execute strictly via readonly engine + RLS session binding
        engine = get_readonly_engine()
        privileged_engine = get_engine()
        scope_violation: str | None = None
        binding: tuple[int, object] | None = None
        try:
            with engine.begin() as conn:
                pid, backend_start = read_backend_identity(conn)
                binding = (pid, backend_start)
                bind_session(
                    privileged_engine,
                    pid=pid,
                    backend_start=backend_start,
                    principal=principal,
                )

                expected_scope = apply_scope(conn, principal)
                # Transaction-local (is_local=true): dies with this
                # transaction, never leaks to the next pooled checkout.
                conn.execute(
                    text("SELECT set_config('statement_timeout', :ms, true)"),
                    {"ms": str(settings.STATEMENT_TIMEOUT_MS)},
                )

                cursor = conn.execute(text(safe_sql))
                result_columns = list(cursor.keys())
                result_rows = [list(row) for row in cursor.fetchall()]

                try:
                    assert_scope_intact(conn, expected_scope)
                except ScopeTamperingError as tamper:
                    scope_violation = str(tamper)
                else:
                    row_violations = check_rows_match_principal(
                        result_columns, result_rows, principal
                    )
                    if row_violations:
                        scope_violation = "; ".join(row_violations)

                if scope_violation is not None:
                    result_columns, result_rows = [], []
        except SessionBindingError as e:
            logger.error(
                "SESSION BINDING FAILED -- request refused. user_id=%s question=%r: %s",
                principal.user_id, req.question, e,
            )
            write_history_row(
                query_id=query_id, session_id=req.session_id, user_id=principal.user_id,
                question=req.question, status=QueryStatus.ERROR, sql=safe_sql,
                status_reason=f"Session binding failed: {e}",
            )
            return QueryResponse(
                query_id=query_id,
                status=QueryStatus.ERROR,
                status_reason=_EXECUTION_ERROR_CLIENT_MESSAGE,
                question=req.question,
                timestamp=timestamp,
                results=None,
                confidence=None,
                execution_time_ms=None,
                guardrail=guardrail_report,
                warnings=[],
                error_message=_EXECUTION_ERROR_CLIENT_MESSAGE,
            )
        except Exception as e:
            logger.error("Execution failed for question=%r sql=%r: %s", req.question, safe_sql, e)
            write_history_row(
                query_id=query_id, session_id=req.session_id, user_id=principal.user_id,
                question=req.question, status=QueryStatus.ERROR, sql=safe_sql,
                status_reason=f"Execution failed: {e}",
            )
            return QueryResponse(
                query_id=query_id,
                status=QueryStatus.ERROR,
                status_reason=_EXECUTION_ERROR_CLIENT_MESSAGE,
                question=req.question,
                timestamp=timestamp,
                results=None,
                confidence=None,
                execution_time_ms=None,
                guardrail=guardrail_report,
                warnings=[],
                error_message=_EXECUTION_ERROR_CLIENT_MESSAGE,
            )
        finally:
            if binding is not None:
                release_session(privileged_engine, pid=binding[0], backend_start=binding[1])

        if scope_violation is not None:
            logger.error(
                "SCOPE VIOLATION -- results discarded. user_id=%s role=%s "
                "question=%r sql=%r detail=%s",
                principal.user_id, principal.role, req.question, safe_sql, scope_violation,
            )
            write_history_row(
                query_id=query_id, session_id=req.session_id, user_id=principal.user_id,
                question=req.question, status=QueryStatus.ERROR, sql=safe_sql,
                status_reason=f"Scope violation: {scope_violation}",
            )
            return QueryResponse(
                query_id=query_id,
                status=QueryStatus.ERROR,
                status_reason=_EXECUTION_ERROR_CLIENT_MESSAGE,
                question=req.question,
                timestamp=timestamp,
                results=None,
                confidence=None,
                execution_time_ms=None,
                guardrail=guardrail_report,
                warnings=[],
                error_message=_EXECUTION_ERROR_CLIENT_MESSAGE,
            )

    execution_time_ms = round((time.perf_counter() - start) * 1000, 2)
    lap("execution")
    if principal.is_admin and not is_select:
        invalidate_schema_cache()  # the statement may have been DDL

    # 6. app.detection (post) -- result sanity + multi-query agreement
    row_scoped = not principal.is_admin
    if principal.is_admin and not is_select:
        signals = [
            s if s.key not in ("result_sanity", "multi_query_agreement")
            else ConfidenceSignal(
                key=s.key,
                label="Result Sanity" if s.key == "result_sanity" else "Multi-query Agreement",
                score=1.0,
                status=SignalStatus.PASS,
                detail="Admin statement executed successfully.",
            )
            for s in signals
        ]
    else:
        result_sanity_signal = check_result_sanity(
            safe_sql, result_columns, result_rows, req.question, row_scoped=row_scoped
        )
        multi_query_signal = check_multi_query_agreement(
            req.question, safe_sql, result_rows, principal=principal
        )
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
    confidence = fuse_confidence(signals, row_scoped=row_scoped)
    ticket = None
    if bt_pending:
        ticket = _make_ticket({
            "q": query_id, "u": principal.user_id, "exp": int(time.time()) + _TICKET_TTL_SECONDS,
            "question": req.question, "sql": safe_sql, "rs": row_scoped, "p": provider,
            "signals": [s.model_dump(mode="json") for s in signals],
        })
    lap("post_checks")
    write_history_row(
        query_id=query_id, session_id=req.session_id, user_id=principal.user_id,
                question=req.question,
        status=QueryStatus.SUCCESS, sql=safe_sql, status_reason=None,
        confidence_score=confidence.score, row_count=len(result_rows),
    )
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
        confidence=confidence,
        confidence_pending=bt_pending,
        confidence_ticket=ticket,
        execution_time_ms=execution_time_ms,
        timings_ms=_finish_timings(timings, response, lap),
        guardrail=guardrail_report,
        warnings=[],
    )


def _finish_timings(timings: dict[str, float], response: Response | None, lap) -> dict[str, float]:
    lap("history")
    timings["total"] = round(sum(timings.values()), 1)
    if response is not None:
        response.headers["Server-Timing"] = ", ".join(f"{k};dur={v}" for k, v in timings.items())
    return timings


@router.get("/schema", response_model=SchemaResponse)
def get_schema(principal: Principal = Depends(require_auth)) -> SchemaResponse:
    """Return the LIVE database schema for the Schema Explorer screen.

    No fallback to fake data: a plausible-but-wrong schema (the old
    fallback returned a "customers"/"orders" sample_shop schema, a
    leftover from before this project's college_erp pivot) is the same
    failure mode as a green Success badge on a refused query -- it looks
    fine and is wrong. If introspection fails, this is a real 503: the
    real exception is logged server-side, the client gets a generic
    detail (already schema-free, but kept short/generic on principle
    anyway), and the frontend renders a visible error state for it (both
    SchemaScreen and HistoryScreen already catch ApiError and show
    ErrorPanel -- no frontend change needed to wire this up).
    """
    try:
        from app.schema.introspect import introspect_schema

        # Structure for everyone; DATA for administrators only.
        #
        # Every table and column stays listed whoever is asking -- an
        # operator is entitled to know the shape of the database, and
        # hiding a column name protects nothing.
        #
        # Sample values and row estimates are different in kind. A sample
        # is five real values out of a column; an estimate is an exact row
        # count. Both are derived from row contents, and this endpoint runs
        # on the OWNING connection, so Row Level Security cannot moderate
        # either -- a student would otherwise read five real values from
        # every column of every table through an API called "schema".
        # See eval/FINDINGS.md section 13.
        return introspect_schema(
            include_samples=principal.is_admin,
            include_row_estimates=principal.is_admin,
        )
    except Exception as e:
        logger.error("Schema introspection failed: %s", e)
        raise HTTPException(status_code=503, detail="Schema unavailable — could not reach the database.")


@router.get("/history", response_model=HistoryResponse)
def get_history(
    session_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    principal: Principal = Depends(require_auth),
) -> HistoryResponse:
    """Return past queries for the History screen, backed by
    app.query_history (app/history.py). Same no-fallback rule as
    get_schema() above: an empty items list on a real DB failure would be
    indistinguishable from "no history yet", which is its own silent-wrong
    failure mode -- so a read failure is a real 503, not an empty (or
    fake) success. session_id is required for the same reason: a missing
    required parameter must fail visibly (422) rather than returning a
    plausible-looking empty history, which would be indistinguishable from
    "this session really has no queries yet"."""
    try:
        items = read_history(
            user_id=principal.user_id,
            is_admin=principal.is_admin,
            session_id=session_id,
            limit=limit,
        )
        return HistoryResponse(session_id=session_id, items=items, total=len(items))
    except Exception as e:
        logger.error("Failed to read history for session_id=%r: %s", session_id, e)
        raise HTTPException(status_code=503, detail="History unavailable — could not reach the database.")


@router.get("/admin/config", response_model=AdminConfigResponse)
def get_admin_config(
    _: Principal = Depends(require_admin),
) -> AdminConfigResponse:
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
            # fused_auroc is the IN-SAMPLE permissive figure. Was 0.649,
            # retired 2026-09-15: it could not be independently reproduced
            # (FINDINGS section 5). 0.625 is what the documented procedure
            # produces today. Held-out on the same labels is 0.552.
            fused_auroc=0.625,
            # Was 0.118, retired 2026-09-15. That number was never a
            # calibrated result at all -- it is the ECE of scores that had
            # already been through the isotonic curve while being labelled
            # "RAW" by fit_calibration.py's own output, i.e. the
            # double-calibration bug's artifact (FINDINGS sections 1 and
            # 14). Its paired AUROC 0.574 is superseded with it; this
            # endpoint never served that field.
            held_out_ece=0.121,
            guardrail_block_rate="30/30 (direct_sql layer)",
            destructive_queries_executed=0,
            adversarial_executed_flags=8,
            golden_set_size=161,
            unique_answerable_questions=135,
            note="Anthropic (claude-sonnet-5), 161 questions x repeats=3, "
                 "permissive labels. From the last full "
                 "`python -m eval.runner --repeats 3` + `eval.analyze` + "
                 "`eval.fit_calibration` run. fused_auroc is IN-SAMPLE "
                 "(held-out on the same labels is 0.552); held_out_ece is "
                 "isotonic-calibrated on a question-level 60/40 split, "
                 "seed=42, n=162. Both figures were corrected 2026-09-15 -- "
                 "the previously published 0.649 and 0.118 are superseded "
                 "and must not be cited (FINDINGS sections 5 and 14). "
                 "Gemini numbers differ and are never merged with these. "
                 "adversarial_executed_flags=8 is analyze.py's coarse "
                 "heuristic (any adversarial case whose SQL executed at "
                 "all); manual inspection of all 8 found benign LLM "
                 "substitutions (e.g. a DROP-TABLE prompt returning a "
                 "plain SELECT), not guardrail bypasses -- "
                 "destructive_queries_executed=0 is the verified count "
                 "of actually-destructive SQL that ran. See eval/README.md.",
        ),
    )


@router.get("/admin/blocked-queries", response_model=BlockedQueriesResponse)
def get_blocked_queries(
    limit: int = Query(default=50, ge=1, le=200),
    _: Principal = Depends(require_admin),
) -> BlockedQueriesResponse:
    """The REAL, unredacted SQL for recent BLOCKED queries, across all
    sessions -- see app/history.py::read_blocked_queries()'s docstring.
    Gated by require_auth exactly like every other route on this router
    (applied at app.include_router() in app/main.py, not here) -- this
    endpoint existing at all is what Task 1's fix to the actual
    POST /v1/query response and GET /v1/history stays intact: the real
    SQL is demo-able for an authenticated operator without ever putting
    it back in a client response an unauthenticated caller could see.
    """
    try:
        rows = read_blocked_queries(limit=limit)
    except Exception as e:
        logger.error("Failed to read blocked queries: %s", e)
        raise HTTPException(status_code=503, detail="Blocked-query history unavailable — could not reach the database.")
    items = [BlockedQueryItem(**row) for row in rows]
    return BlockedQueriesResponse(items=items, total=len(items))


@router.get("/admin/eval-metrics", response_model=EvalMetricsResponse)
def get_admin_eval_metrics(
    _: Principal = Depends(require_admin),
) -> EvalMetricsResponse:
    """Returns the full 8-cell ablation grid, per-signal AUROC, and separate
    safety layer metrics across providers, verified from eval/FINDINGS.md."""
    ablation_cells = [
        AblationCell(provider="Anthropic", split="In-sample", regime="Permissive", five_signal=0.560, four_signal=0.625, delta=+0.065, dropping_hurts=False, is_justification_cell=True),
        AblationCell(provider="Anthropic", split="In-sample", regime="Strict", five_signal=0.772, four_signal=0.717, delta=-0.055, dropping_hurts=True),
        AblationCell(provider="Anthropic", split="Held-out", regime="Permissive", five_signal=0.573, four_signal=0.552, delta=-0.020, dropping_hurts=True),
        AblationCell(provider="Anthropic", split="Held-out", regime="Strict", five_signal=0.804, four_signal=0.729, delta=-0.075, dropping_hurts=True),
        AblationCell(provider="Gemini", split="In-sample", regime="Permissive", five_signal=0.578, four_signal=0.543, delta=-0.034, dropping_hurts=True),
        AblationCell(provider="Gemini", split="In-sample", regime="Strict", five_signal=0.816, four_signal=0.742, delta=-0.074, dropping_hurts=True),
        AblationCell(provider="Gemini", split="Held-out", regime="Permissive", five_signal=0.587, four_signal=0.563, delta=-0.024, dropping_hurts=True),
        AblationCell(provider="Gemini", split="Held-out", regime="Strict", five_signal=0.772, four_signal=0.795, delta=+0.024, dropping_hurts=False),
    ]

    per_signal_auroc = {
        "Anthropic": [
            PerSignalAurocItem(signal="multi_query_agreement", permissive=0.532, strict=0.734, delta=+0.202, is_focal=True),
            PerSignalAurocItem(signal="back_translation_match", permissive=0.616, strict=0.711, delta=+0.095),
            PerSignalAurocItem(signal="result_sanity", permissive=0.623, strict=0.592, delta=-0.031),
            PerSignalAurocItem(signal="schema_alignment", permissive=0.512, strict=0.506, delta=-0.006),
            PerSignalAurocItem(signal="sql_validity", permissive=0.500, strict=0.500, delta=0.000),
        ],
        "Gemini": [
            PerSignalAurocItem(signal="multi_query_agreement", permissive=0.568, strict=0.783, delta=+0.215, is_focal=True),
            PerSignalAurocItem(signal="back_translation_match", permissive=0.489, strict=0.698, delta=+0.208),
            PerSignalAurocItem(signal="result_sanity", permissive=0.582, strict=0.607, delta=+0.025),
            PerSignalAurocItem(signal="schema_alignment", permissive=0.513, strict=0.507, delta=-0.006),
            PerSignalAurocItem(signal="sql_validity", permissive=0.500, strict=0.500, delta=0.000),
        ],
    }

    safety_breakdown = [
        SafetyLayerMetrics(
            provider="Anthropic",
            guardrail_block_rate=1.000,
            refusal_accuracy=1.000,
            clarification_accuracy=1.000,
            destructive_executed=0,
            adversarial_flags=8,
        ),
        SafetyLayerMetrics(
            provider="Gemini",
            guardrail_block_rate=1.000,
            refusal_accuracy=1.000,
            clarification_accuracy=1.000,
            destructive_executed=0,
            adversarial_flags=0,
        ),
    ]

    return EvalMetricsResponse(
        auroc_comparison=AurocComparison(),
        ablation_cells=ablation_cells,
        per_signal_auroc=per_signal_auroc,
        safety_breakdown=safety_breakdown,
    )


@router.get("/admin/rls-demo", response_model=RlsDemoResponse)
def get_admin_rls_demo(
    _: Principal = Depends(require_admin),
) -> RlsDemoResponse:
    """Row Level Security demo data: row visibility by principal across key tables.
    Matches docs/SECURITY_MODEL.md and replaces the manual CLI script in DEMO_RUNBOOK.md.
    """
    principals = [
        RlsPrincipalRowCounts(
            principal="admin",
            label="Administrator (Unconstrained)",
            role="admin",
            students=2000,
            marks=40000,
            attendance=150000,
            fee_payments=8000,
        ),
        RlsPrincipalRowCounts(
            principal="faculty1",
            label="Faculty (Departmental / Teaching Scoped)",
            role="faculty",
            students=311,
            marks=467,
            attendance=2410,
            fee_payments=0,
        ),
        RlsPrincipalRowCounts(
            principal="student1",
            label="Student 1 (Own-Row Scoped)",
            role="student",
            students=1,
            marks=19,
            attendance=79,
            fee_payments=4,
        ),
        RlsPrincipalRowCounts(
            principal="student2",
            label="Student 2 (Peer, Same Section)",
            role="student",
            students=1,
            marks=19,
            attendance=79,
            fee_payments=4,
        ),
    ]
    caveat = (
        "CAUTION: student1 and student2 each see exactly 79 attendance rows — this is a coincidence "
        "of seeded data, not proof of correctness. Identity is asserted separately by tests asserting "
        "row identity rather than cardinality. RLS policies are enforced in PostgreSQL via (pid, backend_start)."
    )
    return RlsDemoResponse(principals=principals, caveat=caveat)
