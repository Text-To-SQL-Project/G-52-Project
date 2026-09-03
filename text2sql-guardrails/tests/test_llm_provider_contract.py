"""One test per LLM provider asserting the structured-output contract
(refusal/refusal_kind/sql/explanation/tables_used/columns_used) survives
that provider's typical raw-text SHAPE, via app.generation.json_utils'
defensive parsing (see that module's docstring for why: Anthropic reliably
returns bare JSON; Gemini/Groq don't always).

No network calls, no API keys -- app.generation.generator.complete is
monkeypatched to return each provider's characteristic raw text directly,
matching the mocking convention already used in tests/test_safety.py."""
from __future__ import annotations

import logging

import openai
import pytest

from app.api.models import QueryRequest
from app.api.routes import run_query
from app.generation.generator import generate_sql
from app.generation.json_utils import parse_llm_json

_CONTRACT_JSON = (
    '{"refusal": false, "refusal_kind": null, "reason": null, '
    '"sql": "SELECT student_id FROM students WHERE status = \'ACTIVE\';", '
    '"explanation": "Active students.", '
    '"tables_used": ["students"], "columns_used": ["students.student_id"]}'
)


def test_anthropic_style_bare_json_response(monkeypatch):
    """Anthropic reliably returns exactly the requested JSON, nothing
    else -- the fast path (plain json.loads) must handle this, unchanged
    from before the provider abstraction existed."""
    monkeypatch.setattr("app.generation.generator.complete", lambda *a, **k: _CONTRACT_JSON)
    result = generate_sql("Which students are active?")
    assert result.refusal is False
    assert result.sql == "SELECT student_id FROM students WHERE status = 'ACTIVE';"
    assert result.tables_used == ["students"]


def test_gemini_style_fenced_json_with_preamble(monkeypatch):
    """Gemini's chat-completions surface has been observed to prose-wrap
    JSON even when asked not to -- a sentence before a ```json fence."""
    raw = f"Sure, here's the query:\n\n```json\n{_CONTRACT_JSON}\n```"
    monkeypatch.setattr("app.generation.generator.complete", lambda *a, **k: raw)
    result = generate_sql("Which students are active?")
    assert result.refusal is False
    assert result.sql == "SELECT student_id FROM students WHERE status = 'ACTIVE';"


def test_groq_style_fenced_json_with_trailing_commentary(monkeypatch):
    """Groq-hosted chat models have been observed to append a trailing
    sentence after a fenced JSON block despite an "ONLY a JSON object"
    instruction."""
    raw = f"```json\n{_CONTRACT_JSON}\n```\nLet me know if you need anything else!"
    monkeypatch.setattr("app.generation.generator.complete", lambda *a, **k: raw)
    result = generate_sql("Which students are active?")
    assert result.refusal is False
    assert result.sql == "SELECT student_id FROM students WHERE status = 'ACTIVE';"


def test_unfenced_json_with_surrounding_prose_still_parses(monkeypatch):
    """No fence at all, just stray text around the object -- the
    brace-matching last resort must still find it."""
    raw = f"Here you go: {_CONTRACT_JSON} Hope that helps."
    monkeypatch.setattr("app.generation.generator.complete", lambda *a, **k: raw)
    result = generate_sql("Which students are active?")
    assert result.refusal is False
    assert result.sql == "SELECT student_id FROM students WHERE status = 'ACTIVE';"


def test_genuinely_invalid_response_still_raises(monkeypatch):
    """Regression guard: the defensive fallbacks must not silently swallow
    a response that truly isn't JSON anywhere -- routes.py depends on this
    raising so it can turn it into an ERROR QueryResponse."""
    monkeypatch.setattr(
        "app.generation.generator.complete", lambda *a, **k: "I cannot help with that."
    )
    with pytest.raises(Exception):
        generate_sql("Which students are active?")


def test_timeout_after_retries_exhausted_surfaces_as_generic_error(monkeypatch, caplog):
    """A hung/timed-out LLM request (the bug fixed alongside this test --
    app.generation.llm_client's _with_backoff now retries a timeout a
    bounded number of times, then raises) must surface through the SAME
    generic-message-to-client / real-detail-to-log path as every other
    generation failure -- not a special case, not a leak of the raw
    timeout exception text to the client."""

    def fake_generate_sql(question):
        # What generate_sql() actually raises once _with_backoff's retries
        # are exhausted on a persistent timeout -- the underlying SDK
        # exception, unwrapped, same as any other generation-failure path.
        raise openai.APITimeoutError(request=None)

    monkeypatch.setattr("app.api.routes.generate_sql", fake_generate_sql)
    with caplog.at_level(logging.ERROR):
        resp = run_query(QueryRequest(question="Which students are active?"))

    assert resp.status == "error"
    assert resp.status_reason == (
        "The system hit an internal error while generating SQL for this "
        "question. Please try again."
    )
    assert "timed out" not in resp.status_reason.lower()
    assert any("timed out" in record.message.lower() for record in caplog.records), (
        "the real timeout detail must still reach the server log"
    )


def test_parse_llm_json_directly_for_each_shape():
    """Direct unit coverage of the parsing fallback chain itself, not just
    through generate_sql()."""
    assert parse_llm_json(_CONTRACT_JSON)["sql"].startswith("SELECT")
    assert parse_llm_json(f"```json\n{_CONTRACT_JSON}\n```")["sql"].startswith("SELECT")
    assert parse_llm_json(f"blah blah\n```\n{_CONTRACT_JSON}\n```\nblah")["sql"].startswith("SELECT")
    assert parse_llm_json(f"prefix {_CONTRACT_JSON} suffix")["sql"].startswith("SELECT")
