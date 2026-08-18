"""
Thin wrapper around the Anthropic Messages API. The client is constructed
lazily (only on first real call) so a missing/placeholder LLM_API_KEY does
not prevent the app from importing or starting -- it only fails when a
request actually needs the LLM.
"""
from __future__ import annotations

from functools import lru_cache

import anthropic

from app.config import settings


@lru_cache(maxsize=1)
def get_client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=settings.LLM_API_KEY)


def complete(system: str, user: str) -> str:
    """Send a single-turn request and return the model's text output."""
    client = get_client()
    response = client.messages.create(
        model=settings.LLM_MODEL,
        max_tokens=settings.MAX_OUTPUT_TOKENS,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    return "".join(block.text for block in response.content if block.type == "text")
