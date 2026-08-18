"""
Builds the system + user prompt sent to the LLM: the live schema (so it only
references real tables/columns) plus the few-shot examples from
app.generation.few_shot, asking for a single JSON object back.
"""
from __future__ import annotations

from app.api.models import SchemaResponse
from app.generation.few_shot import FEW_SHOT_EXAMPLES

_RESPONSE_SHAPE = (
    '{"sql": "<a single read-only SELECT statement>", '
    '"explanation": "<one or two plain-English sentences>", '
    '"tables_used": ["table1", ...], '
    '"columns_used": ["table1.column1", ...]}'
)


def build_system_prompt(schema: SchemaResponse) -> str:
    lines = [
        "You are a PostgreSQL expert that translates a natural-language "
        "question into a single read-only SQL query, using ONLY the tables "
        "and columns listed below -- never invent a table or column name.",
        "",
        "Rules:",
        "- Output a single SELECT statement only (no DDL, no DML, no "
        "multiple statements).",
        "- Always include a LIMIT clause.",
        "- Respond with ONLY a JSON object, no prose, no markdown fences, "
        f"matching exactly this shape: {_RESPONSE_SHAPE}",
        "",
        f"Database: {schema.database}",
        "Tables:",
    ]
    for table in schema.tables:
        columns = ", ".join(f"{c.name} ({c.data_type})" for c in table.columns)
        lines.append(f"- {table.name}({columns})")
    return "\n".join(lines)


def build_user_prompt(question: str) -> str:
    examples = "\n\n".join(
        f'Question: {ex["question"]}\nSQL: {ex["sql"]}' for ex in FEW_SHOT_EXAMPLES
    )
    return f"Examples:\n\n{examples}\n\nQuestion: {question}"
