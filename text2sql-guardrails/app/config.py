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
    # Applied per transaction on the read-only execution path (routes.py).
    STATEMENT_TIMEOUT_MS: int = int(os.getenv("STATEMENT_TIMEOUT_MS", "2500"))

    # Latency budget for the interactive app (target: answer < 3 s). These
    # apply to /v1/query only; eval/ keeps LLM_TIMEOUT_SECONDS and the
    # default retry count so published runs stay reproducible.
    APP_LLM_TIMEOUT_SECONDS: float = float(os.getenv("APP_LLM_TIMEOUT_SECONDS", "10"))
    APP_LLM_MAX_ATTEMPTS: int = int(os.getenv("APP_LLM_MAX_ATTEMPTS", "2"))
    # Fire a duplicate generation request if the first is slower than this;
    # first answer wins. 0 disables (e.g. on a tight free-tier RPM quota).
    APP_LLM_HEDGE_SECONDS: float = float(os.getenv("APP_LLM_HEDGE_SECONDS", "2.5"))
    # Structure-only schema reflection is cached this long (generation and
    # schema_align both need it on every question). Admin DDL clears it.
    SCHEMA_CACHE_SECONDS: int = int(os.getenv("SCHEMA_CACHE_SECONDS", "300"))

    # CORS for the React dev server
    CORS_ORIGINS: list[str] = os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173",
    ).split(",")

    # Bootstrap admin password (Phase 1). No longer a shared login for
    # everyone -- accounts now live in app.users and authenticate
    # individually. This seeds the FIRST admin account only, so there is a
    # way in before any user exists; see seed/30_seed_users.sql. Empty means
    # no bootstrap admin is created.
    OPERATOR_PASSWORD: str = os.getenv("OPERATOR_PASSWORD", "")

    # How long a resolved Principal may be reused before role and
    # is_active are re-read from the database.
    #
    # 0 = never cache, re-read on every request. That is the default and
    # the recommended setting: this lookup is a single indexed primary-key
    # SELECT, which is negligible next to the multi-second LLM call it
    # precedes on the only hot path.
    #
    # Whatever you set here IS your revocation latency. A deactivated user
    # keeps working for up to this many seconds, and from Phase 2 a
    # demoted user keeps their old row visibility for the same window.
    # Treat it as a security parameter, not a performance knob.
    AUTH_PRINCIPAL_CACHE_SECONDS: int = int(os.getenv("AUTH_PRINCIPAL_CACHE_SECONDS", "0"))
    # Signs the session token app/auth.py issues on successful login.
    # Empty is refused the same way as an empty OPERATOR_PASSWORD -- an
    # empty HMAC key would "work" but make every token trivially forgeable.
    SECRET_KEY: str = os.getenv("SECRET_KEY", "")

    # "prod" turns on the strict checks in app/startup_checks.py and
    # app/main.py (no localhost CORS wildcard, HSTS, 32+ char SECRET_KEY).
    ENV: str = os.getenv("ENV", "dev").strip().lower()

    # Admin-managed key pool: a LiteLLM proxy (docker-compose service
    # `litellm`) holds every provider key and routes by latency with
    # failover. Empty URL = pool disabled.
    LITELLM_URL: str = os.getenv("LITELLM_URL", "").strip()
    LITELLM_MASTER_KEY: str = os.getenv("LITELLM_MASTER_KEY", "")
    LITELLM_MODEL_GROUP: str = os.getenv("LITELLM_MODEL_GROUP", "pool")
    # Which provider /v1/query uses. "auto" = the pool when it has at least
    # one key, else LLM_PROVIDER. eval/ always uses LLM_PROVIDER.
    APP_LLM_PROVIDER: str = os.getenv("APP_LLM_PROVIDER", "auto").strip().lower()

    # Google sign-in: the OAuth 2.0 "Web application" client ID from Google
    # Cloud Console. Public by design (it ships to the browser); empty hides
    # the button and disables POST /auth/google.
    GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    # Open sign-up: an unlinked, verified Google account gets a new 'guest'
    # user (no student/faculty link, so RLS hides every personal row; see
    # seed/34_guest_role.sql). false = only admin-linked emails may sign in.
    GOOGLE_OPEN_SIGNUP: bool = os.getenv("GOOGLE_OPEN_SIGNUP", "true").strip().lower() == "true"
    # Sliding 60 s windows (app/http_guard.py). 0 disables.
    RATE_LIMIT_LOGIN_PER_MIN: int = int(os.getenv("RATE_LIMIT_LOGIN_PER_MIN", "10"))
    RATE_LIMIT_QUERY_PER_MIN: int = int(os.getenv("RATE_LIMIT_QUERY_PER_MIN", "30"))


settings = Settings()
