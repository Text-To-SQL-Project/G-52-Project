"""
Orchestrates schema retrieval + prompt building + the LLM call, and parses
the model's JSON response into a small internal result type. This is the
"app.generation" step from routes.py's pipeline TODO.
"""
from __future__ import annotations

from dataclasses import dataclass

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
