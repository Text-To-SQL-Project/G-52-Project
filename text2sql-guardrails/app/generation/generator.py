"""
Orchestrates schema retrieval + prompt building + the LLM call, and parses
the model's JSON response into a small internal result type. This is the
"app.generation" step from routes.py's pipeline TODO.
"""
from __future__ import annotations

import json
from dataclasses import dataclass

from app.generation.llm_client import complete
from app.generation.prompt_builder import build_system_prompt, build_user_prompt
from app.schema.introspect import introspect_schema


@dataclass
class GenerationResult:
    sql: str
    explanation: str
    tables_used: list[str]
    columns_used: list[str]


def _parse_response(raw: str) -> dict:
    text = raw.strip()
    if text.startswith("```"):
        # Strip a ```json ... ``` or ``` ... ``` fence if the model added one.
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
        text = text.strip()
    return json.loads(text)


def generate_sql(question: str) -> GenerationResult:
    """Call the LLM to translate `question` into SQL over the live schema.

    Raises on API failure or a response that doesn't parse as the expected
    JSON shape -- callers (routes.py) are responsible for turning that into
    an ERROR QueryResponse.
    """
    schema = introspect_schema(include_samples=False)
    system = build_system_prompt(schema)
    user = build_user_prompt(question)

    raw = complete(system, user)
    data = _parse_response(raw)

    return GenerationResult(
        sql=data["sql"],
        explanation=data.get("explanation", ""),
        tables_used=data.get("tables_used", []),
        columns_used=data.get("columns_used", []),
    )
