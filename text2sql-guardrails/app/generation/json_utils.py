"""Shared JSON-extraction helper for parsing structured LLM responses.

Anthropic (this project's original/default provider) reliably returns
exactly the requested JSON object with nothing else, so the fast path
below (plain json.loads) has always been sufficient for it. The other
providers (Gemini, Groq -- see app.generation.llm_client) don't all enforce
"JSON only" as consistently: a preamble ("Here's the SQL:") before a
```json fence, or trailing prose after one, is a real observed pattern on
at least one of them, not a hypothetical -- see
app.generation.llm_client's module docstring. The fallbacks below exist
for that; they never change behavior for a response the fast path already
parses (Anthropic's, unchanged)."""
from __future__ import annotations

import json
import re

# A fenced ```json ... ``` or ``` ... ``` block, anywhere in the text, not
# just wrapping the whole string -- catches a preamble before the fence.
_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)


def parse_llm_json(raw: str) -> dict:
    """Parse a JSON object out of raw LLM text. Tries, in order:
      1. The whole (stripped) text as-is -- the common case for a provider
         that honors "respond with ONLY a JSON object" (Anthropic, always
         has).
      2. A ```json ... ``` or ``` ... ``` fence anywhere in the text (not
         just at the start) -- tolerates a preamble before it or prose
         after it.
      3. The first top-level {...} object found by brace-matching -- a
         last resort for a response with no fence at all but stray text
         around the JSON.
    Raises json.JSONDecodeError (same as before) if none of these produce
    valid JSON, so existing callers' try/except-and-turn-into-ERROR
    handling is unchanged.
    """
    text = raw.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    fence_match = _FENCE_RE.search(text)
    if fence_match:
        try:
            return json.loads(fence_match.group(1).strip())
        except json.JSONDecodeError:
            pass

    brace_start = text.find("{")
    if brace_start != -1:
        depth = 0
        for i in range(brace_start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[brace_start : i + 1])
                    except json.JSONDecodeError:
                        break

    # Nothing worked -- raise the same exception type callers already
    # handle, using the original text for a useful error message.
    return json.loads(text)
