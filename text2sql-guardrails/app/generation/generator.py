"""
Orchestrates schema retrieval + prompt building + the LLM call, and parses
the model's JSON response into a small internal result type. This is the
"app.generation" step from routes.py's pipeline TODO.
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
    sql: str
    explanation: str
    tables_used: list[str]
    columns_used: list[str]


def generate_sql(question: str) -> GenerationResult:
    """Call the LLM to translate `question` into SQL over the live schema.

    Raises on API failure or a response that doesn't parse as the expected
    JSON shape -- callers (routes.py) are responsible for turning that into
    an ERROR QueryResponse.
    """
    return _generate(question, extra_instructions=None)


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


def _generate(question: str, extra_instructions: str | None) -> GenerationResult:
    schema = introspect_schema(include_samples=False)
    system = build_system_prompt(schema, extra_instructions=extra_instructions)
    user = build_user_prompt(question)

    raw = complete(system, user)
    data = parse_llm_json(raw)

    return GenerationResult(
        sql=data["sql"],
        explanation=data.get("explanation", ""),
        tables_used=data.get("tables_used", []),
        columns_used=data.get("columns_used", []),
    )
