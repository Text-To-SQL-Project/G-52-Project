"""
Back-translation hallucination detector: asks the LLM what question the
generated SQL answers, then asks a second time how semantically equivalent
that back-translated question is to the user's original question. Catches
drift that app.detection.schema_align cannot -- SQL can be perfectly valid
against the schema and still answer the wrong question.

Feeds the 'back_translation_match' entry in Confidence.signals, replacing
the fixed mock value. Runs after guardrails pass, alongside schema
alignment (both are pre-execution checks).
"""
from __future__ import annotations

from app.api.models import ConfidenceSignal, SignalStatus
from app.config import settings
from app.generation.json_utils import parse_llm_json
from app.generation.llm_client import complete

_BACK_TRANSLATE_SYSTEM = (
    "You are a SQL analyst. Given a SQL query, describe in one concise, "
    "plain-English question what it answers. Respond with ONLY the "
    "question text -- no preamble, no quotes, no markdown."
)

_COMPARE_SYSTEM = (
    "You compare two questions for semantic equivalence -- whether they "
    "would be answered by the same underlying data/query. Respond with "
    "ONLY a JSON object matching this shape, no prose, no markdown fences: "
    '{"score": <float 0.0-1.0>, "reason": "<one sentence>"}'
)


def check_back_translation(question: str, sql: str, row_scoped: bool = False) -> ConfidenceSignal:
    """Never raises -- any LLM/API/parse failure degrades to a WARN signal
    so it can't take down the request path.

    `row_scoped`: the SQL runs under row-level security bound to the asking
    user, so "my marks" is answered by SQL with no user filter at all -- the
    database adds it. Unless told, the comparison reads that SQL as
    "everyone's marks" and fails a correct answer (seen live: 0.30 for
    "What are my marks in each subject?")."""
    if not settings.BACK_TRANSLATION_ENABLED:
        return ConfidenceSignal(
            key="back_translation_match",
            label="Back-translation Match",
            score=0.5,
            status=SignalStatus.WARN,
            detail="Back-translation check disabled (BACK_TRANSLATION_ENABLED=false).",
        )

    try:
        # cache_system=True for consistency (these two system prompts are
        # also byte-identical on every call) -- but note neither is anywhere
        # near the ~1024 token minimum Anthropic requires to actually cache
        # a prefix, so no cache_read/cache_creation tokens are expected here
        # in practice. The real savings are in generate_sql's schema block.
        # max_attempts=2 (one retry): this check degrades to a neutral WARN
        # 0.5 on any failure, so a long retry chain buys a marginal rescue
        # chance at a large latency cost on the user-facing query path --
        # see complete()'s docstring. Generation, which cannot degrade,
        # keeps the full 5.
        back_translated = complete(
            _BACK_TRANSLATE_SYSTEM, sql, cache_system=True, max_attempts=2
        ).strip()

        compare_user = (
            f"Question A: {question}\n"
            f"Question B: {back_translated}\n\n"
            + (
                "Context: the SQL runs under row-level security that returns only the "
                "asking user's own rows, so Question B is implicitly limited to that "
                "user ('my ...'). Do not penalise a missing per-user filter.\n\n"
                if row_scoped else ""
            )
            + "How semantically equivalent are these two questions?"
        )
        raw = complete(_COMPARE_SYSTEM, compare_user, cache_system=True, max_attempts=2)
        data = parse_llm_json(raw)
        score = max(0.0, min(1.0, float(data["score"])))
        reason = str(data.get("reason", "")).strip()
    except Exception as e:
        return ConfidenceSignal(
            key="back_translation_match",
            label="Back-translation Match",
            score=0.5,
            status=SignalStatus.WARN,
            detail=f"Back-translation check could not run: {e}",
        )

    if score >= 0.80:
        status = SignalStatus.PASS
    elif score >= 0.55:
        status = SignalStatus.WARN
    else:
        status = SignalStatus.FAIL

    detail = f'SQL back-translates to: "{back_translated}".'
    if reason:
        detail += f" {reason}"

    return ConfidenceSignal(
        key="back_translation_match",
        label="Back-translation Match",
        score=round(score, 2),
        status=status,
        detail=detail,
    )
