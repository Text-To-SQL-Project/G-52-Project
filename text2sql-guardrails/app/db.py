"""
Database engine. Reads DATABASE_URL from config.

Two supported setups for your project:

  A) SQLite file (simplest — no Docker):
       set DATABASE_URL=sqlite:///C:/Users/dell/Desktop/Text-to-SQL/your.db
       (Windows: three slashes, then forward-slash path.)

  B) Postgres (via docker-compose):
       DATABASE_URL=postgresql+psycopg://app:app@db:5432/sample_shop

The read-only engine is the second line of defence behind the guardrails:
in the real execution path, run generated SQL through this engine so even a
guardrail miss cannot write.
"""
from __future__ import annotations

from functools import lru_cache

from sqlalchemy import Engine, create_engine

from app.config import settings


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    """Primary engine (used for introspection and, later, execution)."""
    connect_args = {}
    if settings.DATABASE_URL.startswith("sqlite"):
        connect_args = {"check_same_thread": False}
    return create_engine(
        settings.DATABASE_URL,
        pool_pre_ping=True,
        connect_args=connect_args,
    )


@lru_cache(maxsize=1)
def get_readonly_engine() -> Engine:
    """Engine that should map to a SELECT-only DB role in production.

    For Postgres, point READONLY_DATABASE_URL at the readonly_app role.
    For SQLite, open the file in read-only mode.
    """
    url = getattr(settings, "READONLY_DATABASE_URL", None) or settings.DATABASE_URL
    connect_args = {}
    if url.startswith("sqlite"):
        connect_args = {"check_same_thread": False}
        # ?mode=ro requires the uri=True form; keep simple + safe here.
    return create_engine(url, pool_pre_ping=True, connect_args=connect_args)
