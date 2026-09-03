"""Unit tests for app.generation.llm_client's measured (not estimated)
token-usage tracking -- get_last_usage() after a real complete() call --
and its resolved-model provenance capture -- get_last_resolved_model().
No network calls: the underlying SDK client is monkeypatched to a fake
object shaped like the real with_raw_response.create() -> .parse() path,
so these exercise the actual complete()/get_last_usage() code, not a
reimplementation of it."""
from __future__ import annotations

import json
from types import SimpleNamespace

from app.generation import llm_client


class _FakeRawResponse:
    def __init__(self, parsed, raw_body: dict | None = None):
        self.headers = {}
        self._parsed = parsed
        self.text = json.dumps(raw_body or {})

    def parse(self):
        return self._parsed


class _FakeCompletions:
    def __init__(self, parsed, raw_body: dict | None = None):
        self._parsed = parsed
        self._raw_body = raw_body

    class _WithRawResponse:
        def __init__(self, outer):
            self._outer = outer

        def create(self, **kwargs):
            return _FakeRawResponse(self._outer._parsed, self._outer._raw_body)

    @property
    def with_raw_response(self):
        return self._WithRawResponse(self)


class _FakeChat:
    def __init__(self, parsed, raw_body: dict | None = None):
        self.completions = _FakeCompletions(parsed, raw_body)


class _FakeOpenAICompatibleClient:
    def __init__(self, parsed, raw_body: dict | None = None):
        self.chat = _FakeChat(parsed, raw_body)


def _fake_chat_completion(content: str, prompt_tokens: int, completion_tokens: int):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage=SimpleNamespace(prompt_tokens=prompt_tokens, completion_tokens=completion_tokens),
    )


def test_get_last_usage_reflects_a_successful_openai_compatible_call(monkeypatch):
    monkeypatch.setattr(llm_client.settings, "LLM_PROVIDER", "gemini")
    parsed = _fake_chat_completion('{"ok": true}', prompt_tokens=123, completion_tokens=45)
    fake_client = _FakeOpenAICompatibleClient(parsed)
    monkeypatch.setattr(llm_client, "_get_openai_compatible_client", lambda provider: fake_client)

    text = llm_client.complete("system prompt", "user prompt")

    assert text == '{"ok": true}'
    assert llm_client.get_last_usage() == {"prompt_tokens": 123, "completion_tokens": 45}


def test_get_last_usage_handles_missing_usage_field_gracefully(monkeypatch):
    """Some OpenAI-compatible responses may omit `usage` entirely -- must
    not raise, must report zeros rather than stale data."""
    monkeypatch.setattr(llm_client.settings, "LLM_PROVIDER", "gemini")
    parsed = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content="no usage here"))],
        usage=None,
    )
    fake_client = _FakeOpenAICompatibleClient(parsed)
    monkeypatch.setattr(llm_client, "_get_openai_compatible_client", lambda provider: fake_client)

    llm_client.complete("system prompt", "user prompt")

    assert llm_client.get_last_usage() == {"prompt_tokens": 0, "completion_tokens": 0}


def test_last_usage_unchanged_after_a_failed_call(monkeypatch):
    """A rejected/failed request was never billed -- get_last_usage() must
    keep reporting the last SUCCESSFUL call's usage, not silently zero out
    or carry over a bogus value, when a later call raises."""
    monkeypatch.setattr(llm_client.settings, "LLM_PROVIDER", "gemini")
    parsed = _fake_chat_completion('{"ok": true}', prompt_tokens=77, completion_tokens=11)
    fake_client = _FakeOpenAICompatibleClient(parsed)
    monkeypatch.setattr(llm_client, "_get_openai_compatible_client", lambda provider: fake_client)
    llm_client.complete("system", "user")
    assert llm_client.get_last_usage() == {"prompt_tokens": 77, "completion_tokens": 11}

    class _RaisingClient:
        class _Chat:
            class _Completions:
                class _WithRawResponse:
                    def create(self, **kwargs):
                        raise RuntimeError("simulated non-retryable failure")

                with_raw_response = _WithRawResponse()

            completions = _Completions()

        chat = _Chat()

    monkeypatch.setattr(llm_client, "_get_openai_compatible_client", lambda provider: _RaisingClient())
    try:
        llm_client.complete("system", "user")
    except RuntimeError:
        pass

    assert llm_client.get_last_usage() == {"prompt_tokens": 77, "completion_tokens": 11}


def test_resolved_model_prefers_raw_body_modelversion_field(monkeypatch):
    """Gemini's native modelVersion field, if present in the raw JSON body,
    is preferred over the standard OpenAI `model` field -- it's the more
    specific of the two when both are present."""
    monkeypatch.setattr(llm_client.settings, "LLM_PROVIDER", "gemini")
    parsed = _fake_chat_completion('{"ok": true}', prompt_tokens=1, completion_tokens=1)
    parsed.model = "gemini-flash-lite-latest"
    fake_client = _FakeOpenAICompatibleClient(
        parsed, raw_body={"model": "gemini-flash-lite-latest", "modelVersion": "gemini-2.5-flash-lite-002"}
    )
    monkeypatch.setattr(llm_client, "_get_openai_compatible_client", lambda provider: fake_client)

    llm_client.complete("system", "user")

    assert llm_client.get_last_resolved_model() == "gemini-2.5-flash-lite-002"


def test_resolved_model_falls_back_to_parsed_model_field(monkeypatch):
    """If the raw body has neither modelVersion nor model (or isn't valid
    JSON), fall back to whatever the SDK's typed response parsed into
    `.model` -- never raise, never silently keep a stale value from a
    previous call."""
    monkeypatch.setattr(llm_client.settings, "LLM_PROVIDER", "gemini")
    parsed = _fake_chat_completion('{"ok": true}', prompt_tokens=1, completion_tokens=1)
    parsed.model = "gemini-flash-lite-latest"
    fake_client = _FakeOpenAICompatibleClient(parsed, raw_body={})
    monkeypatch.setattr(llm_client, "_get_openai_compatible_client", lambda provider: fake_client)

    llm_client.complete("system", "user")

    assert llm_client.get_last_resolved_model() == "gemini-flash-lite-latest"


def test_resolved_model_none_when_nothing_available(monkeypatch):
    monkeypatch.setattr(llm_client.settings, "LLM_PROVIDER", "gemini")
    parsed = _fake_chat_completion('{"ok": true}', prompt_tokens=1, completion_tokens=1)
    fake_client = _FakeOpenAICompatibleClient(parsed, raw_body={})
    monkeypatch.setattr(llm_client, "_get_openai_compatible_client", lambda provider: fake_client)

    llm_client.complete("system", "user")

    assert llm_client.get_last_resolved_model() is None
