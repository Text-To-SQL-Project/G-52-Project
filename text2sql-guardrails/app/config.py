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

    # LLM (wired in Phase 2)
    READONLY_DATABASE_URL: str = os.getenv("READONLY_DATABASE_URL", "")

    LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "anthropic")  # or "openai"
    LLM_MODEL: str = os.getenv("LLM_MODEL", "claude-sonnet-5")
    LLM_API_KEY: str = os.getenv("LLM_API_KEY", "")
    MAX_OUTPUT_TOKENS: int = int(os.getenv("MAX_OUTPUT_TOKENS", "1024"))
    # Toggle off for the back-translation ablation study.
    BACK_TRANSLATION_ENABLED: bool = os.getenv(
        "BACK_TRANSLATION_ENABLED", "true"
    ).strip().lower() in ("1", "true", "yes", "on")

    # Safety thresholds
    DEFAULT_ROW_LIMIT: int = int(os.getenv("DEFAULT_ROW_LIMIT", "1000"))
    MAX_SUBQUERY_DEPTH: int = int(os.getenv("MAX_SUBQUERY_DEPTH", "3"))
    STATEMENT_TIMEOUT_MS: int = int(os.getenv("STATEMENT_TIMEOUT_MS", "5000"))

    # CORS for the React dev server
    CORS_ORIGINS: list[str] = os.getenv(
        "CORS_ORIGINS", "http://localhost:3000,http://localhost:5173"
    ).split(",")


settings = Settings()
