"""
Builds the system + user prompt sent to the LLM: the live schema (so it only
references real tables/columns) plus the few-shot examples from
app.generation.few_shot, asking for a single JSON object back.
"""
from __future__ import annotations

from app.api.models import SchemaResponse
from app.generation.few_shot import FEW_SHOT_EXAMPLES

_RESPONSE_SHAPE = (
    '{"refusal": <true if you are declining this request, else false>, '
    '"refusal_kind": "<if refusal is true, exactly \\"unsafe\\" (a '
    'destructive/DDL/permission request -- DELETE, DROP, UPDATE, etc.) or '
    '\\"ambiguous\\" (underspecified, subjective, or unanswerable from '
    'this schema); else null>", '
    '"reason": "<if refusal is true, one plain-English sentence explaining '
    'why; else null>", '
    '"sql": "<a single read-only SELECT statement if refusal is false, '
    'else null -- NEVER a placeholder or always-false SELECT>", '
    '"explanation": "<one or two plain-English sentences describing the '
    'SQL; empty string if refusal is true>", '
    '"tables_used": ["table1", ...], '
    '"columns_used": ["table1.column1", ...]}'
)


def build_system_prompt(schema: SchemaResponse, extra_instructions: str | None = None) -> str:
    lines = [
        "You are a PostgreSQL expert that translates a natural-language "
        "question into a single read-only SQL query, using ONLY the tables "
        "and columns listed below -- never invent a table or column name.",
        "",
        "Rules:",
        "- Output a single SELECT statement only (no DDL, no DML, no "
        "multiple statements).",
        # Some columns are withheld from the schema below because the
        # executing role has no privilege on them (see
        # app/schema/introspect.py::RESTRICTED_COLUMNS). A wildcard expands
        # to include them and the statement is then refused at execution,
        # which reaches the user as a generic error and looks like a bug.
        # Listing columns explicitly avoids that entirely.
        "- Never use SELECT * -- list the columns you need explicitly, "
        "choosing only from the columns listed below.",
        "- Do NOT add a LIMIT clause unless the question explicitly asks "
        "for a top-N or a specific number of rows. The system enforces "
        "its own row cap.",
        "- If the question cannot be answered from the schema below, or "
        "asks for a destructive/unsafe operation (DELETE, DROP, UPDATE, "
        "etc.), you MUST decline: set \"refusal\": true, \"sql\": null, "
        "and \"refusal_kind\" to \"unsafe\" for a destructive/DDL/"
        "permission request, or \"ambiguous\" for anything underspecified, "
        "subjective, or unanswerable from this schema. Do NOT invent a "
        "placeholder query (e.g. a SELECT that trivially returns nothing, "
        "or an unrelated substitute query) to avoid answering -- an "
        "explicit refusal is required, not a disguised one.",
        "- Respond with ONLY a JSON object, no prose, no markdown fences, "
        f"matching exactly this shape: {_RESPONSE_SHAPE}",
    ]
    if extra_instructions:
        lines.append(f"- {extra_instructions}")
    lines += [
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
