"""Central settings. Reads from environment (see .env.example)."""
from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()


class Settings:
    APP_NAME: str = "Text-to-SQL Guardrails API"
    VERSION: str = "0.1.0"

    # Database (used from Phase 2 onward; the stub runs without it)
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", "postgresql+psycopg://app:app@db:5432/sample_shop"
    )
    # Reserved for schema-qualified introspection/execution once
    # app/generation or app/safety/sandbox need it; introspect_schema()
    # currently relies on the connection's search_path instead.
    DB_SCHEMA: str = os.getenv("DB_SCHEMA", "public")

    # The role generated SQL executes as. Must be a NON-owner, NON-superuser
    # role once Row Level Security lands, or RLS is bypassed silently.
    READONLY_DATABASE_URL: str = os.getenv("READONLY_DATABASE_URL", "")

    # Eval's own connection, kept deliberately separate from both of the
    # above. eval/ compares gold and predicted row sets, so it must see
    # EVERY row: a filtered eval does not fail, it just quietly reports
    # different numbers, and the published baselines stop being
    # reproducible. Falls back to DATABASE_URL (owner/superuser) and NEVER
    # to READONLY_DATABASE_URL -- see app/db.py::get_eval_engine(), which
    # enforces that, and eval/db_guard.py, which refuses to run at all if
    # whatever this resolves to would be subject to RLS.
    EVAL_DATABASE_URL: str = os.getenv("EVAL_DATABASE_URL", "")

    LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "anthropic")  # "anthropic" | "gemini" | "groq"
    LLM_MODEL: str = os.getenv("LLM_MODEL", "claude-sonnet-5")
    LLM_API_KEY: str = os.getenv("LLM_API_KEY", "")
    MAX_OUTPUT_TOKENS: int = int(os.getenv("MAX_OUTPUT_TOKENS", "1024"))
    # 0 = unlimited (the historical default -- keeps the Anthropic path's
    # timing, and therefore nothing about its behavior, unchanged). Set to
    # e.g. 15 for Gemini's free-tier RPM cap or 30 for Groq's so eval runs
    # self-throttle with a sleep instead of hammering the provider into a
    # string of 429s. See app/generation/llm_client.py's _RpmThrottle.
    LLM_RPM_LIMIT: int = int(os.getenv("LLM_RPM_LIMIT", "0"))
    # Per-HTTP-request timeout passed to BOTH the Anthropic and the
    # OpenAI-compatible client -- without this, a hung upstream response
    # (observed live: a transient 503 from Gemini's endpoint, retried by
    # the openai SDK, then no response at all for minutes) blocks a
    # request thread indefinitely instead of failing into the existing
    # ERROR path. See llm_client.py's _with_backoff for how this composes
    # with retry count into a bounded worst case.
    LLM_TIMEOUT_SECONDS: int = int(os.getenv("LLM_TIMEOUT_SECONDS", "60"))
    # 0 = unlimited. A hard ceiling on real LLM calls for ONE eval.runner
    # invocation -- consumed there (see eval/runner.py's main loop), not
    # enforced by llm_client.py itself, since this is an eval-run cost/
    # quota control, not something the live API should ever cut a user off
    # for. Exists because a DAILY provider quota (not RPM/TPM, which
    # LLM_RPM_LIMIT already throttles for) can be exhausted mid-run with no
    # warning -- observed live: 2,128 pointless 429s once
    # gemini-3.5-flash-lite's 500/day cap hit, because nothing stopped the
    # runner from continuing to attempt (and retry, 5x each) every
    # remaining question regardless. Set below whatever the provider's
    # actual daily cap is, with margin, so the run stops cleanly with an
    # honest partial file instead of burning the rest of the day's already-
    # spent quota on calls that cannot succeed.
    LLM_DAILY_CALL_LIMIT: int = int(os.getenv("LLM_DAILY_CALL_LIMIT", "0"))
    # Toggle off for the back-translation ablation study.
    BACK_TRANSLATION_ENABLED: bool = os.getenv(
        "BACK_TRANSLATION_ENABLED", "true"
    ).strip().lower() in ("1", "true", "yes", "on")
    # Off by default -- multiplies LLM API calls (N-1 extra generations +
    # executions per request). Enable only for evaluation runs.
    MULTI_QUERY_ENABLED: bool = os.getenv(
        "MULTI_QUERY_ENABLED", "false"
    ).strip().lower() in ("1", "true", "yes", "on")
    MULTI_QUERY_N: int = int(os.getenv("MULTI_QUERY_N", "2"))

    # Safety thresholds
    DEFAULT_ROW_LIMIT: int = int(os.getenv("DEFAULT_ROW_LIMIT", "1000"))
    MAX_SUBQUERY_DEPTH: int = int(os.getenv("MAX_SUBQUERY_DEPTH", "3"))
    STATEMENT_TIMEOUT_MS: int = int(os.getenv("STATEMENT_TIMEOUT_MS", "5000"))

    # CORS for the React dev server
    CORS_ORIGINS: list[str] = os.getenv(
        "CORS_ORIGINS", "http://localhost:3000,http://localhost:5173"
    ).split(",")

    # Minimal auth (Task 4): one shared operator password, no users table,
    # no registration. Empty by default -- app/auth.py refuses ALL logins
    # (500, not 401 -- "not configured" is a different failure than "wrong
    # password") rather than silently accepting an empty password.
    OPERATOR_PASSWORD: str = os.getenv("OPERATOR_PASSWORD", "")
    # Signs the session token app/auth.py issues on successful login.
    # Empty is refused the same way as an empty OPERATOR_PASSWORD -- an
    # empty HMAC key would "work" but make every token trivially forgeable.
    SECRET_KEY: str = os.getenv("SECRET_KEY", "")


settings = Settings()
