"""
Database engines. Reads URLs from config.

Three connections, deliberately distinct, because they sit at different
privilege levels and conflating any two of them removes a security layer
without producing a visible symptom:

  get_engine()          owning role. Introspection, query history, user
                        accounts. Generated SQL must never run through it.
  get_readonly_engine() the role GENERATED SQL executes as. SELECT-only,
                        non-owner, and from Phase 2 subject to Row Level
                        Security. Required, never defaulted -- see below.
  get_eval_engine()     eval/ only. Must BYPASS RLS so gold/predicted row
                        comparisons stay reproducible.

Postgres via docker-compose is the supported setup:
    DATABASE_URL=postgresql+psycopg://app:app@db:5432/college_erp
SQLite is still accepted by get_engine() for a no-Docker smoke test
(Windows: three slashes, then a forward-slash path).
"""
from __future__ import annotations

from functools import lru_cache

from sqlalchemy import Engine, create_engine

from app.config import settings


class ReadOnlyEngineNotConfigured(RuntimeError):
    """READONLY_DATABASE_URL is required and was not set."""


_READONLY_MISSING_MESSAGE = """READONLY_DATABASE_URL is not set.

This is the connection generated SQL executes as, and it must be a
SELECT-only, non-owner role. It is intentionally NOT defaulted: the
previous fallback to DATABASE_URL ran generated SQL as the owning
superuser, which silently disabled read-only enforcement and would
silently disable Row Level Security too.

  docker compose      : already set in docker-compose.yml, nothing to do
  host / bare uvicorn : set it in .env, for example
    READONLY_DATABASE_URL=postgresql+psycopg://readonly_app:readonly_app@localhost:5433/college_erp

Do not point it at DATABASE_URL's role. See .env.example, and
app/startup_checks.py, which additionally verifies that whatever this
resolves to is actually a constrained role."""


def _driver_url(url: str) -> str:
    """Hosted Postgres (Neon, Vercel's Postgres integration, Heroku-style
    configs) hands out postgres:// or driverless postgresql:// URLs, which
    SQLAlchemy reads as "use psycopg2" -- not installed here. Pin psycopg 3."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    """Primary engine: introspection, query history, user accounts.

    This is the owning role. Generated SQL must never run through it.
    """
    connect_args = {}
    if settings.DATABASE_URL.startswith("sqlite"):
        connect_args = {"check_same_thread": False}
    return create_engine(
        _driver_url(settings.DATABASE_URL),
        pool_pre_ping=True,
        connect_args=connect_args,
    )


@lru_cache(maxsize=1)
def get_readonly_engine() -> Engine:
    """Engine that runs generated SQL. Must map to a SELECT-only DB role.

    FAILS CLOSED. This used to fall back to DATABASE_URL when
    READONLY_DATABASE_URL was unset, which looks harmless and is not:
    DATABASE_URL is the owning/superuser role, so the fallback executed
    generated SQL with full privileges. Read-only enforcement -- the
    second line of defence behind the guardrails, so that even a guardrail
    miss cannot write -- simply was not there, and from Phase 2 onward Row
    Level Security would not be either, since owners and superusers bypass
    policies unconditionally.

    That combination is invisible at runtime. Every query still returns
    the right answer; two security layers are just absent. Inside
    docker-compose the variable is always set, so the gap only opened when
    the API was run on the host, which is exactly the ad-hoc setup where
    nobody is checking.

    Refusing to construct the engine turns a silent downgrade into a
    startup failure that names the missing variable.
    """
    url = (getattr(settings, "READONLY_DATABASE_URL", "") or "").strip()
    if not url:
        raise ReadOnlyEngineNotConfigured(_READONLY_MISSING_MESSAGE)
    connect_args = {}
    if url.startswith("sqlite"):
        connect_args = {"check_same_thread": False}
        # ?mode=ro requires the uri=True form; keep simple + safe here.
    return create_engine(_driver_url(url), pool_pre_ping=True, connect_args=connect_args)


@lru_cache(maxsize=1)
def get_eval_engine() -> Engine:
    """Engine for eval/ only. Deliberately NOT the engine that runs user SQL.

    eval/ compares gold against predicted row sets, so it has to see every
    row in the table. Once Row Level Security lands, a connection that is
    subject to a policy does not error -- it silently returns fewer rows,
    execution_match() quietly starts disagreeing, and the published
    baselines become unreproducible with nothing in the output to say why.

    So the fallback chain here stops at DATABASE_URL (the owning/superuser
    role, which is also the connection that produced the existing
    results.jsonl) and never reaches READONLY_DATABASE_URL, no matter what
    the environment sets. Falling back to the app's query-execution role is
    exactly the failure this function exists to make impossible.

    A URL alone is not a guarantee, though -- DATABASE_URL could itself be
    pointed at a restricted role. eval/db_guard.py::assert_bypasses_rls()
    interrogates the live connection and aborts the run if the role it
    actually got would be filtered.
    """
    url = getattr(settings, "EVAL_DATABASE_URL", "") or settings.DATABASE_URL
    connect_args = {}
    if url.startswith("sqlite"):
        connect_args = {"check_same_thread": False}
    return create_engine(_driver_url(url), pool_pre_ping=True, connect_args=connect_args)
