"""Shared JSON-extraction helper for parsing structured LLM responses."""
from __future__ import annotations

import json


def parse_llm_json(raw: str) -> dict:
    """Parse a JSON object out of raw LLM text, tolerating a ```json ... ```
    or ``` ... ``` fence the model may have wrapped it in."""
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
        text = text.strip()
    return json.loads(text)
