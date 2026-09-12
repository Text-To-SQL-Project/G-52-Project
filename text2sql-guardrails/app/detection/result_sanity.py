"""
Result-sanity detector: inspects the RESULT SET after execution for signs
the query was subtly wrong even though it ran without error -- e.g. a bad
JOIN that silently nulls out a column, or a WHERE clause that matched
nothing. Purely deterministic (no LLM call), so it's free and fast.

Feeds the 'result_sanity' entry in Confidence.signals, replacing the fixed
mock value. Runs after execution (it needs the rows), unlike
schema_align/back_translation which run pre-execution.
"""
from __future__ import annotations

from decimal import Decimal

import sqlglot
from sqlglot import exp

from app.api.models import ConfidenceSignal, SignalStatus

_AGG_FUNCS = (exp.Sum, exp.Avg, exp.Count, exp.Min, exp.Max)

# Penalty subtracted from a starting score of 1.0 per issue found. Kept as a
# module-level dict so it's easy to tune (and to cite in the paper) without
# touching the check logic itself.
PENALTIES: dict[str, float] = {
    "empty_result": 0.20,
    "all_null_column": 0.50,
    "null_aggregate": 0.60,
    "all_zero_numeric": 0.15,
    "row_cap_hit": 0.10,
    "duplicate_agg_rows": 0.20,
}

# Issues at this severity force status to FAIL regardless of score.
_FAIL_ISSUES = {"all_null_column", "null_aggregate"}

# Checks whose evidence is "the result set is small or empty". Under
# per-user Row Level Security that is no longer evidence of a bad query --
# it is what a correctly scoped query looks like for a user who owns few
# rows. All three are skipped when the request is row-scoped.
#
#   empty_result     a student with no marks yet
#   all_null_column  a LEFT JOIN onto a table this user can see no rows of
#   null_aggregate   AVG over a set the policy filtered to empty
#
# The latter two are in _FAIL_ISSUES, so leaving them enabled would force
# status=FAIL and, via FAIL_SCORE_CAP in app/detection/confidence.py, clamp
# the fused score to 0.40 for a query that was correct and correctly
# scoped. The confidence system would be punishing the security model for
# working.
#
# The remaining three checks stay on, because filtering does not cause what
# they detect: RLS does not turn values into zeros (all_zero_numeric), does
# not manufacture fan-out duplicates (duplicate_agg_rows), and makes hitting
# the row cap strictly less likely rather than more (row_cap_hit).
_ROW_COUNT_SENSITIVE = {"empty_result", "all_null_column", "null_aggregate"}

# If the question contains one of these, an empty result is plausibly
# expected rather than a bug, so the empty_result check is skipped.
_EMPTY_OK_HINTS = ("if any", "if there are", "if there is", "optional")


def _parse(sql: str) -> exp.Expression | None:
    try:
        return sqlglot.parse_one(sql, dialect="postgres")
    except Exception:
        return None


def _extract_limit(stmt: exp.Expression | None) -> int | None:
    if stmt is None:
        return None
    try:
        limit_node = stmt.args.get("limit")
        if limit_node is None:
            return None
        return int(limit_node.expression.this)
    except Exception:
        return None


def _has_aggregate(stmt: exp.Expression | None) -> bool:
    if stmt is None or not isinstance(stmt, exp.Select):
        return False
    try:
        return any(sel.find(_AGG_FUNCS) is not None for sel in stmt.selects)
    except Exception:
        return False


def _has_group_by(stmt: exp.Expression | None) -> bool:
    if stmt is None:
        return False
    try:
        return stmt.args.get("group") is not None
    except Exception:
        return False


def check_result_sanity(
    sql: str,
    columns: list[str],
    rows: list[list],
    question: str = "",
    row_scoped: bool = False,
) -> ConfidenceSignal:
    """Never raises -- each check is independently guarded so a malformed
    SQL string or an unexpected value type degrades that one check rather
    than the whole signal.

    `row_scoped` says this request ran under a per-user RLS policy, so the
    result set is a subset of the table by design. It MUST come from the
    authenticated principal and never be inferred from the data -- deducing
    it from "the result looks small" would let an attacker suppress the
    detector by crafting a small result. app/api/routes.py passes
    `not principal.is_admin`; eval/ leaves it False, which is why published
    baselines are unaffected by any of this.
    """
    stmt = _parse(sql)
    has_agg = _has_aggregate(stmt)
    has_group = _has_group_by(stmt)
    n_rows = len(rows)

    issues: list[tuple[str, str]] = []

    # 1. Empty result set.
    if n_rows == 0:
        q = question.lower()
        if not any(hint in q for hint in _EMPTY_OK_HINTS):
            issues.append((
                "empty_result",
                "Result set is empty (0 rows) -- the WHERE clause or a JOIN "
                "may have excluded everything.",
            ))

    if n_rows > 0:
        # 3. Single-row aggregate (no GROUP BY) returning NULL -- e.g. AVG
        # over an empty set. Checked before the generic all-NULL-column
        # check below so the more specific/severe reason wins for this row.
        null_agg_cols: set[int] = set()
        if n_rows == 1 and has_agg and not has_group:
            row0 = rows[0]
            for idx, val in enumerate(row0):
                if val is None:
                    null_agg_cols.add(idx)
            if null_agg_cols:
                col_names = ", ".join(columns[i] for i in sorted(null_agg_cols))
                issues.append((
                    "null_aggregate",
                    f"Aggregate column(s) [{col_names}] returned NULL for the "
                    "single result row -- likely an aggregate (AVG/SUM/...) "
                    "over zero matching rows.",
                ))

        # 2. A column that is 100% NULL across all rows (classic bad-JOIN
        # symptom). Skips columns already explained by the null_aggregate
        # check above to avoid double-penalizing the same root cause.
        for idx, col in enumerate(columns):
            if idx in null_agg_cols:
                continue
            values = [row[idx] for row in rows]
            if all(v is None for v in values):
                issues.append((
                    "all_null_column",
                    f"Column '{col}' is 100% NULL across all {n_rows} row(s) "
                    "-- classic symptom of a bad JOIN.",
                ))

        # 4. Numeric columns that are entirely zero.
        for idx, col in enumerate(columns):
            values = [row[idx] for row in rows]
            numeric_values = [
                v for v in values
                if isinstance(v, (int, float, Decimal)) and not isinstance(v, bool)
            ]
            if len(numeric_values) == len(values) and all(v == 0 for v in numeric_values):
                issues.append((
                    "all_zero_numeric",
                    f"Column '{col}' is entirely 0 across all {n_rows} row(s).",
                ))

        # 6. Duplicate output rows when the SQL aggregated with GROUP BY --
        # possible fan-out from a many-to-many join. Note: this can also
        # false-positive when the GROUP BY key isn't part of the output
        # columns and two distinct groups coincidentally produce the same
        # aggregate value(s) -- kept as a soft (WARN-tier) penalty because
        # of that.
        if has_agg and has_group:
            seen: dict[tuple, int] = {}
            for row in rows:
                key = tuple(row)
                seen[key] = seen.get(key, 0) + 1
            dup_count = sum(1 for c in seen.values() if c > 1)
            if dup_count:
                issues.append((
                    "duplicate_agg_rows",
                    f"{dup_count} duplicate row value(s) found in a GROUP BY "
                    "aggregate result -- possible fan-out from a many-to-many join.",
                ))

    # 5. Result hit the row cap exactly -- may be silently truncated.
    cap = _extract_limit(stmt)
    if cap is not None and n_rows == cap:
        issues.append((
            "row_cap_hit",
            f"Result set exactly hits the row cap ({cap}) -- more matching "
            "rows may exist beyond it.",
        ))

    if row_scoped:
        # Drop the findings that filtering can manufacture. Kept as a
        # post-filter rather than guarding each check at its source so the
        # check bodies stay readable and the suppressed set stays visible
        # in one place.
        suppressed = sorted({k for k, _ in issues if k in _ROW_COUNT_SENSITIVE})
        issues = [(k, r) for k, r in issues if k not in _ROW_COUNT_SENSITIVE]

        if not issues:
            # Nothing left to report -- and "no anomalies" would be an
            # unearned PASS, because the checks most likely to have caught a
            # problem are exactly the ones that could not run. Report the
            # signal as unmeasured instead.
            #
            # "disabled" in the detail is the project-wide convention that
            # app/detection/confidence.py::_is_disabled() reads: such a
            # signal is excluded from the weighted mean AND from the
            # fail-override, rather than dragging the average toward a
            # placeholder. Same mechanism BACK_TRANSLATION_ENABLED=false
            # already uses.
            note = (
                f" Suppressed under row scoping: {', '.join(suppressed)}."
                if suppressed else ""
            )
            return ConfidenceSignal(
                key="result_sanity",
                label="Result Sanity",
                score=0.5,
                status=SignalStatus.WARN,
                detail=(
                    "Result-sanity checks disabled for this request: access is "
                    "row-scoped, so an empty or sparse result is expected rather "
                    "than anomalous and cannot be distinguished from a genuine "
                    f"fault.{note}"
                ),
            )

    if not issues:
        return ConfidenceSignal(
            key="result_sanity",
            label="Result Sanity",
            score=1.0,
            status=SignalStatus.PASS,
            detail=f"{n_rows} row(s), no anomalies detected.",
        )

    penalty = sum(PENALTIES.get(key, 0.0) for key, _ in issues)
    score = max(0.0, min(1.0, 1.0 - penalty))
    status = (
        SignalStatus.FAIL
        if any(key in _FAIL_ISSUES for key, _ in issues)
        else SignalStatus.WARN
    )
    detail = "; ".join(reason for _, reason in issues)

    return ConfidenceSignal(
        key="result_sanity",
        label="Result Sanity",
        score=round(score, 2),
        status=status,
        detail=detail,
    )
