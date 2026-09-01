"""
Generic, schema-free messages shown to the client for every non-SUCCESS
QueryStatus. Centralized here (not just in routes.py) because app/history.py
needs the exact same text when serving a stored non-SUCCESS row through
GET /v1/history -- a history card must not show the real reason/SQL any
more than the original POST /v1/query response did.

The real reason/SQL for every case is still captured -- logged server-side
(see app/api/routes.py's logger.info/error calls) and stored as-is in
app.query_history (see app/history.py) for a future authenticated admin
view. What's shared here is only ever what an unauthenticated client sees.
"""
from __future__ import annotations

CLARIFICATION_CLIENT_MESSAGE = (
    "This question can't be answered from the available data. Try "
    "rephrasing, or check the Schema Explorer for what's queryable."
)
REFUSED_CLIENT_MESSAGE = (
    "This request was declined because it appears to ask for a "
    "destructive or unsafe operation, which isn't permitted."
)
# Used only by the disguised-no-op backstop, where refusal=false was
# reported so there's no refusal_kind to trust either way -- this message
# makes no claim about *why* generation failed to produce a real query,
# unlike REFUSED_CLIENT_MESSAGE's specific "destructive/unsafe" framing.
GENERATION_FAILED_CLIENT_MESSAGE = (
    "This question could not be translated into a query. Try rephrasing, "
    "or check the Schema Explorer for what's queryable."
)
GENERATION_ERROR_CLIENT_MESSAGE = (
    "The system hit an internal error while generating SQL for this "
    "question. Please try again."
)
EXECUTION_ERROR_CLIENT_MESSAGE = (
    "The system hit an internal error while running this query. Please "
    "try again or rephrase the question."
)
