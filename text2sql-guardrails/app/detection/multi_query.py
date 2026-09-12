"""
Multi-query agreement detector: asks the LLM to solve the same question a
second (and optionally further) time using a deliberately different JOIN or
aggregation strategy, then compares RESULT SETS (not SQL text -- different
SQL can be semantically equivalent) against the primary query's results.
Disagreement is a strong hallucination signal that neither schema_align nor
back_translation can catch on their own.

Off by default (MULTI_QUERY_ENABLED=false): it multiplies LLM API calls (an
extra generation + execution per variant), so it's meant for evaluation
runs, not every request.

Feeds the 'multi_query_agreement' entry in Confidence.signals, replacing
the fixed mock value. Runs after execution (it needs the primary rows).
"""
from __future__ import annotations

from sqlalchemy import text

from app.api.models import ConfidenceSignal, SignalStatus
from app.config import settings
from app.db import get_readonly_engine
from app.safety.session_scope import apply_scope
from app.generation.generator import generate_sql_variant
from app.safety.guardrails import check_guardrails


def _neutral(detail: str) -> ConfidenceSignal:
    return ConfidenceSignal(
        key="multi_query_agreement",
        label="Multi-query Agreement",
        score=0.5,
        status=SignalStatus.WARN,
        detail=detail,
    )


def _canonicalize(rows: list[list]) -> list[tuple[str, ...]]:
    """Sort rows and stringify every value so row-order differences and
    type differences (e.g. Decimal('208') vs 208) don't cause a false
    disagreement between two otherwise-equivalent result sets."""
    return sorted(tuple(str(v) for v in row) for row in rows)


def check_multi_query_agreement(
    question: str,
    primary_sql: str,
    primary_rows: list[list],
    principal=None,
) -> ConfidenceSignal:
    """Never raises -- any generation/guardrail/execution failure on a
    variant is recorded as a disagreement for that variant rather than
    propagating, and an unexpected top-level failure degrades to WARN."""
    try:
        if not settings.MULTI_QUERY_ENABLED:
            return _neutral("Multi-query check disabled (MULTI_QUERY_ENABLED=false).")

        n_variants = max(0, settings.MULTI_QUERY_N - 1)
        if n_variants == 0:
            return _neutral("MULTI_QUERY_N <= 1 -- no variants to compare.")

        primary_canon = _canonicalize(primary_rows)
        engine = get_readonly_engine()

        agree = 0
        notes: list[str] = []

        for i in range(1, n_variants + 1):
            try:
                variant = generate_sql_variant(question)
            except Exception as e:
                notes.append(f"variant {i}: generation failed ({e})")
                continue

            guard = check_guardrails(variant.sql)
            if not guard.passed:
                notes.append(
                    f"variant {i}: discarded by guardrails "
                    f"({'; '.join(guard.blocked_reasons)})"
                )
                continue

            try:
                # Each variant runs in its own scoped transaction.
                #
                # The scope matters from Phase 2 onward: the principal is
                # bound with set_config(..., is_local => true), so a variant
                # executed on an unscoped connection would carry no identity
                # at all, see zero rows under every RLS policy, and register
                # a guaranteed disagreement against the primary -- a
                # fabricated signal rather than a measurement.
                #
                # A separate short transaction per variant, rather than
                # reusing the caller's: variant GENERATION is an LLM call,
                # and holding the request's read transaction open across
                # network round trips would pin a pooled connection and an
                # MVCC snapshot for seconds at a time. Correctness here does
                # not need the same transaction, only the same scope.
                #
                # principal=None keeps the old unscoped path for callers
                # outside the request path (eval/), which run as a role that
                # bypasses RLS and are unaffected either way.
                with engine.begin() as conn:
                    if principal is not None:
                        apply_scope(conn, principal)
                    cursor = conn.execute(text(guard.safe_sql))
                    variant_rows = [list(row) for row in cursor.fetchall()]
            except Exception as e:
                notes.append(f"variant {i}: execution failed ({e})")
                continue

            if _canonicalize(variant_rows) == primary_canon:
                agree += 1
                notes.append(f"variant {i}: result set matches")
            else:
                notes.append(
                    f"variant {i}: result set differs "
                    f"({len(variant_rows)} rows vs {len(primary_rows)})"
                )

        score = agree / n_variants
        if score == 1.0:
            status = SignalStatus.PASS
        elif score == 0.0:
            status = SignalStatus.FAIL
        else:
            status = SignalStatus.WARN

        return ConfidenceSignal(
            key="multi_query_agreement",
            label="Multi-query Agreement",
            score=round(score, 2),
            status=status,
            detail=f"{agree}/{n_variants} variant(s) agree. " + "; ".join(notes),
        )
    except Exception as e:
        return _neutral(f"Multi-query check could not run: {e}")
