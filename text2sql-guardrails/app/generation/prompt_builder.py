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


# Added to the rule list ONLY when the request runs under per-user Row
# Level Security. Two things about the wording are deliberate.
#
# It states the SHAPE of the scoping and never the VALUE. Putting "you are
# student 32" in the prompt would be worse than useless: it invites the
# model to write WHERE student_id = 32, which is a predicate the MODEL
# chose, duplicating enforcement in exactly the layer this project moved
# away from. If the model ever got the number wrong -- or a prompt
# injection changed it -- the query's predicate would disagree with the
# policy. RLS would still hold, but we would be generating SQL that
# ASSERTS an identity rather than SQL that INHERITS one.
#
# It also says what NOT to do, not merely what is true. "Results are
# filtered automatically" on its own invites the model to add the
# predicate anyway, helpfully.
_ROW_SCOPED_INSTRUCTION = (
    "Results are automatically restricted to the current user by the "
    "database itself, before you see them. A question phrased in the first "
    "person (\"my\", \"mine\", \"I\") is therefore ANSWERABLE and must NOT "
    "be refused as underspecified. Write the query with NO identity "
    "predicate: do not add a WHERE clause on student_id, faculty_id, or "
    "any other identifier to express \"my\", and never invent an id value. "
    "The database applies that restriction on its own."
)


def build_system_prompt(
    schema: SchemaResponse,
    extra_instructions: str | None = None,
    row_scoped: bool = False,
    is_admin: bool = False,
) -> str:
    if is_admin:
        lines = [
            "You are a PostgreSQL expert that translates a natural-language "
            "question into a PostgreSQL statement for an Administrator with "
            "full database permissions, using the tables and columns listed below.",
            "",
            "Rules:",
            "- As an administrator with full privileges, you are authorized to output "
            "any SQL statement requested by the user, including DDL (CREATE, ALTER, DROP, "
            "TRUNCATE) and DML (INSERT, UPDATE, DELETE) statements as well as SELECT queries.",
            "- Output a single PostgreSQL statement.",
            "- Do NOT refuse administrative or destructive requests (such as DROP TABLE, "
            "DELETE FROM, TRUNCATE, or UPDATE). You MUST generate the exact SQL requested "
            "with \"refusal\": false.",
            "- Only decline if the request is completely ambiguous, subjective, or underspecified: "
            "set \"refusal\": true, \"sql\": null, and \"refusal_kind\": \"ambiguous\".",
            "- Respond with ONLY a JSON object, no prose, no markdown fences, "
            f"matching exactly this shape: {_RESPONSE_SHAPE}",
        ]
    else:
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
    # Conditional, never unconditional. eval/ and admin requests carry
    # row_scoped=False and therefore get a BYTE-IDENTICAL prompt to the one
    # that produced results.jsonl and results_gemini.jsonl, so those
    # baselines stay comparable with no re-run. tests/test_possessive_scope.py
    # fails if this is ever hoisted out of the conditional.
    if row_scoped:
        lines.append(f"- {_ROW_SCOPED_INSTRUCTION}")
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
