"""
Static SQL guardrails: AST-level checks that run on generated SQL before it
is ever executed. Pure logic -- no DB connection, no LLM call, no I/O. This
is step 3, the "may BLOCK here" step, in the pipeline order documented in
app/api/routes.py::run_query()'s docstring -- done for real via sqlglot
instead of keyword string-matching on the question text.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError

from app.config import settings

logger = logging.getLogger(__name__)

# Statement types that are never allowed, regardless of read/write intent.
_DDL_BLOCK_TYPES = (exp.Drop, exp.Create, exp.Alter, exp.TruncateTable)
# Statement types that mutate data.
_DML_BLOCK_TYPES = (exp.Insert, exp.Update, exp.Delete, exp.Merge)


@dataclass
class GuardrailResult:
    """Internal result type. GuardrailReport (the API contract) has no
    safe_sql field by design, so routes.py reads safe_sql from here and
    only copies the reportable fields into GuardrailReport."""
    passed: bool
    safe_sql: str
    blocked_reasons: list[str] = field(default_factory=list)
    injected_limit: int | None = None
    checks_run: list[str] = field(default_factory=list)


def check_guardrails(sql: str) -> GuardrailResult:
    """Run static AST checks on a single candidate SQL statement.

    Checks (in order, matching the checks_run vocabulary already baked into
    the API contract / mock data): ddl_block, dml_block, row_limit,
    subquery_depth.
    """
    try:
        statements = [s for s in sqlglot.parse(sql, dialect="postgres") if s is not None]
    except ParseError as e:
        # sqlglot's ParseError message routinely echoes a snippet of the
        # offending SQL (table/column names included) to show where parsing
        # failed -- that's schema disclosure the same way a raw LLM refusal
        # reason is, so the detail is logged server-side only; the reason
        # returned here (and shown to the client via GuardrailReport) stays
        # generic. See app/api/routes.py's matching client-message pattern.
        logger.info("SQL failed to parse: %s", e)
        return GuardrailResult(
            passed=False,
            safe_sql=sql,
            blocked_reasons=["failed to parse SQL"],
            checks_run=[],
        )

    if len(statements) == 0:
        # Distinct from the multi-statement case below: an empty/blank SQL
        # string usually means generation itself produced nothing (e.g. the
        # LLM judged the question unanswerable), not a malformed statement.
        return GuardrailResult(
            passed=False,
            safe_sql=sql,
            blocked_reasons=["no SQL statement was generated (question may be unanswerable)"],
            checks_run=[],
        )

    if len(statements) > 1:
        # Stacked/multiple statements are a classic injection vector and we
        # can't reason about "the" query if there's more than one.
        return GuardrailResult(
            passed=False,
            safe_sql=sql,
            blocked_reasons=[f"multiple SQL statements are not allowed (found {len(statements)})"],
            checks_run=[],
        )

    stmt = statements[0]
    checks_run: list[str] = []
    blocked_reasons: list[str] = []

    # --- ddl_block -----------------------------------------------------
    checks_run.append("ddl_block")
    if isinstance(stmt, _DDL_BLOCK_TYPES):
        blocked_reasons.append(f"blocked statement: {type(stmt).__name__}")

    # --- dml_block -------------------------------------------------------
    checks_run.append("dml_block")
    if isinstance(stmt, _DML_BLOCK_TYPES):
        blocked_reasons.append(f"blocked statement: {type(stmt).__name__}")
    elif not blocked_reasons and not isinstance(stmt, exp.Query):
        # Catch-all for anything that isn't DDL/DML we already caught above
        # but also isn't a read-only SELECT/UNION/WITH (exp.Query) -- e.g.
        # GRANT, CALL, COPY. Folded into the dml_block gate rather than a
        # 5th check name, to keep checks_run's vocabulary fixed at the 4
        # values already baked into the API contract/mock data.
        blocked_reasons.append(
            f"blocked statement: {type(stmt).__name__} is not a read-only query"
        )

    # --- row_limit ---------------------------------------------------
    checks_run.append("row_limit")
    injected_limit: int | None = None
    safe_stmt = stmt
    if not blocked_reasons and isinstance(stmt, exp.Query):
        if stmt.args.get("limit") is None:
            injected_limit = settings.DEFAULT_ROW_LIMIT
            safe_stmt = stmt.limit(injected_limit)  # returns a new node; does not mutate stmt

    # --- subquery_depth ------------------------------------------------
    checks_run.append("subquery_depth")
    if not blocked_reasons:
        max_depth = 0
        for sq in stmt.find_all(exp.Subquery):
            depth = 0
            node: exp.Expression | None = sq
            while node is not None:
                if isinstance(node, exp.Subquery):
                    depth += 1
                node = node.parent
            max_depth = max(max_depth, depth)
        if max_depth > settings.MAX_SUBQUERY_DEPTH:
            blocked_reasons.append(
                f"subquery nesting depth {max_depth} exceeds max {settings.MAX_SUBQUERY_DEPTH}"
            )

    passed = not blocked_reasons
    safe_sql = (safe_stmt.sql(dialect="postgres") + ";") if passed else sql

    return GuardrailResult(
        passed=passed,
        safe_sql=safe_sql,
        blocked_reasons=blocked_reasons,
        injected_limit=injected_limit if passed else None,
        checks_run=checks_run,
    )
