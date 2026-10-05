"""
Orchestrates schema retrieval + prompt building + the LLM call, and parses
the model's JSON response into a small internal result type. This is
step 2, "app.generation", in the pipeline order documented in
app/api/routes.py::run_query()'s docstring.
"""
from __future__ import annotations

from dataclasses import dataclass

import sqlglot
from sqlglot import exp

from app.generation.json_utils import parse_llm_json
from app.generation.llm_client import complete
from app.generation.prompt_builder import build_system_prompt, build_user_prompt
from app.schema.introspect import introspect_schema


@dataclass
class GenerationResult:
    refusal: bool
    refusal_kind: str | None  # "unsafe" | "ambiguous" | None (None iff not refusal)
    reason: str | None
    sql: str | None
    explanation: str
    tables_used: list[str]
    columns_used: list[str]


def generate_sql(
    question: str,
    row_scoped: bool = False,
    is_admin: bool = False,
    timeout: float | None = None,
    max_attempts: int | None = None,
    hedge_after: float | None = None,
) -> GenerationResult:
    """Call the LLM to translate `question` into SQL over the live schema.

    `row_scoped` tells the prompt that the database restricts results to
    the current user, so first-person questions are answerable. It MUST
    come from the authenticated principal and defaults to False, which is
    what keeps the eval prompt byte-identical to the one that produced the
    published baselines.

    `is_admin` authorizes generation of DDL/DML administrative statements.

    `timeout`/`max_attempts`/`hedge_after` bound the LLM call (see llm_client.complete);
    routes.py passes the app latency budget, eval passes neither.

    Raises on API failure or a response that doesn't parse as the expected
    JSON shape -- callers (routes.py) are responsible for turning that into
    an ERROR QueryResponse.
    """
    return _generate(
        question, extra_instructions=None, row_scoped=row_scoped, is_admin=is_admin,
        timeout=timeout, max_attempts=max_attempts, hedge_after=hedge_after,
    )


def generate_sql_variant(question: str) -> GenerationResult:
    """Like generate_sql, but asks for a deliberately different query
    strategy for the same question -- used by
    app.detection.multi_query to get an independent second opinion whose
    result set can be compared against the primary SQL's.

    Raises under the same conditions as generate_sql.
    """
    return _generate(
        question,
        extra_instructions=(
            "Solve this using a different JOIN structure, subquery, or "
            "aggregation approach than the most obvious one, while still "
            "correctly answering the same question."
        ),
    )


def _is_trivially_false(expr: exp.Expression) -> bool:
    if isinstance(expr, exp.Boolean) and expr.this is False:
        return True
    if isinstance(expr, exp.EQ):
        left, right = expr.left, expr.right
        if (
            isinstance(left, exp.Literal) and left.is_number
            and isinstance(right, exp.Literal) and right.is_number
        ):
            try:
                return float(left.this) != float(right.this)
            except ValueError:
                return False
    return False


def is_noop_sql(sql: str) -> bool:
    """Detect SQL that's syntactically valid but is really a disguised
    generation refusal -- the model declining to answer but still needing
    to emit *some* SQL to satisfy its own response format (observed live:
    "SELECT 1 WHERE FALSE LIMIT 1000;", "SELECT NULL WHERE FALSE;").

    Two patterns:
      1. A WHERE clause that's trivially always-false (the literal `FALSE`,
         or a comparison between two differing numeric literals like
         `1 = 0`) -- guarantees zero rows regardless of what's selected.
      2. No FROM clause at all, where every projected expression is a bare
         literal constant (NULL, a number, a string, a boolean) -- nothing
         real is being queried, e.g. "SELECT NULL", "SELECT 1, 'x'".

    Not exhaustive by design -- a model could still disguise a refusal in
    a form this doesn't catch. Targets the concrete patterns actually
    observed in eval runs; see eval/README.md.
    """
    try:
        stmt = sqlglot.parse_one(sql, dialect="postgres")
    except Exception:
        return False
    if not isinstance(stmt, exp.Select):
        return False

    where = stmt.args.get("where")
    if where is not None and _is_trivially_false(where.this):
        return True

    if stmt.args.get("from") is None:
        projections = [
            p.this if isinstance(p, exp.Alias) else p
            for p in stmt.expressions
        ]
        if projections and all(
            isinstance(p, (exp.Literal, exp.Boolean, exp.Null)) for p in projections
        ):
            return True

    return False


def _generate(
    question: str,
    extra_instructions: str | None,
    row_scoped: bool = False,
    is_admin: bool = False,
    timeout: float | None = None,
    max_attempts: int | None = None,
    hedge_after: float | None = None,
) -> GenerationResult:
    # omit_restricted: for non-admin users, the model never sees columns
    # the execution role cannot read. For admin, include all columns.
    schema = introspect_schema(
        include_samples=False, omit_restricted=not is_admin, include_row_estimates=False
    )
    system = build_system_prompt(
        schema,
        extra_instructions=extra_instructions,
        row_scoped=row_scoped,
        is_admin=is_admin,
    )
    user = build_user_prompt(question)

    raw = complete(
        system, user, cache_system=not is_admin,
        max_attempts=max_attempts, timeout=timeout, hedge_after=hedge_after,
    )
    data = parse_llm_json(raw)

    refusal = bool(data.get("refusal", False))
    refusal_kind = None
    if refusal:
        refusal_kind = data.get("refusal_kind")
        if refusal_kind not in ("unsafe", "ambiguous"):
            refusal_kind = "unsafe"

    # If the user is an administrator and the model reported an "unsafe" refusal,
    # re-prompt with explicit admin authorization override.
    if is_admin and refusal and refusal_kind == "unsafe":
        admin_prompt = (
            f"ADMINISTRATOR OVERRIDE: The requesting user is an authorized Database Administrator. "
            f"You MUST generate the requested PostgreSQL statement (DDL/DML allowed). Do not decline.\n\n"
            f"Request: {question}"
        )
        raw_admin = complete(
            system, admin_prompt, cache_system=False, max_attempts=max_attempts, timeout=timeout
        )
        data_admin = parse_llm_json(raw_admin)
        if data_admin.get("sql"):
            data = data_admin
            refusal = False
            refusal_kind = None

    return GenerationResult(
        refusal=refusal,
        refusal_kind=refusal_kind,
        reason=data.get("reason") if refusal else None,
        sql=None if refusal else data["sql"],
        explanation=data.get("explanation", ""),
        tables_used=data.get("tables_used", []),
        columns_used=data.get("columns_used", []),
    )
