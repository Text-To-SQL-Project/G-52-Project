"""
Refuses to start the API on a configuration that has quietly disabled a
security layer.

The mirror image of eval/db_guard.py. That one aborts when eval's role
WOULD be filtered by Row Level Security; this one aborts when the app's
query-execution role would NOT be. Same reasoning in both directions: a
role misconfiguration produces no error and no wrong answer, it just
removes a defence, so it has to be turned into a crash or it will not be
noticed.

What is checked, at startup, before the first request:

  1. READONLY_DATABASE_URL is set at all. Enforced in app/db.py by
     construction; re-run here so the failure arrives at boot rather than
     on the first query.
  2. The role it resolves to is NOT a superuser and does NOT hold
     BYPASSRLS. Either attribute makes Row Level Security a no-op for
     every policy Phase 2 will write, and superuser additionally defeats
     the SELECT-only grant.
  3. The role does not OWN the tables it queries. Owners bypass RLS unless
     the table sets FORCE ROW LEVEL SECURITY, so an owning role is a
     policy bypass waiting to happen. Reported as a warning rather than a
     hard failure, because it is only load-bearing once policies exist.

Deliberately not checked here: write privileges. `GRANT SELECT`-only is
verified by the guardrail tests, and probing it at boot would mean
attempting a write.
"""
from __future__ import annotations

import logging

from sqlalchemy import Engine, text

from app.config import settings
from app.db import ReadOnlyEngineNotConfigured, get_readonly_engine

logger = logging.getLogger(__name__)


class StartupCheckError(RuntimeError):
    """A security-relevant configuration check failed at boot."""


def role_is_constrained(*, is_superuser: bool, has_bypassrls: bool) -> bool:
    """The decision, separated from the I/O that feeds it, so it can be
    tested without a database -- no test in this project needs one, and a
    check only exercised when Docker happens to be up is a check that rots.

    A role is fit to execute generated SQL only if it holds neither
    exemption. There is no partial credit: either attribute alone makes
    every future RLS policy a no-op.
    """
    return not is_superuser and not has_bypassrls


def describe_runtime_role(engine: Engine) -> dict:
    """Identify the role generated SQL will execute as."""
    with engine.connect() as conn:
        row = conn.execute(text("""
            SELECT current_user                AS role,
                   current_database()          AS database,
                   r.rolsuper                  AS is_superuser,
                   r.rolbypassrls              AS has_bypassrls
              FROM pg_roles r
             WHERE r.rolname = current_user
        """)).mappings().one()
        return dict(row)


def _owned_tables(engine: Engine, schema: str) -> list[str]:
    with engine.connect() as conn:
        return [
            r[0] for r in conn.execute(text("""
                SELECT c.relname
                  FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = :schema
                   AND c.relkind = 'r'
                   AND pg_get_userbyid(c.relowner) = current_user
                 ORDER BY c.relname
            """), {"schema": schema}).all()
        ]


def check_readonly_role(*, schema: str | None = None) -> dict:
    """Run the boot checks. Returns the role description for the log.

    Raises StartupCheckError on anything that removes a security layer.
    """
    schema = schema or settings.DB_SCHEMA

    try:
        engine = get_readonly_engine()
    except ReadOnlyEngineNotConfigured as e:
        raise StartupCheckError(str(e)) from e

    if str(engine.url).startswith("sqlite"):
        # No roles and no RLS; the SQLite path is a local smoke test only.
        logger.warning(
            "Read-only engine is SQLite: role separation and Row Level "
            "Security are both unavailable. Do not use this configuration "
            "for anything but a local smoke test."
        )
        return {"role": "sqlite", "database": str(engine.url.database),
                "is_superuser": False, "has_bypassrls": False}

    info = describe_runtime_role(engine)

    if not role_is_constrained(is_superuser=info["is_superuser"],
                               has_bypassrls=info["has_bypassrls"]):
        reasons = []
        if info["is_superuser"]:
            reasons.append("is a SUPERUSER (bypasses RLS and every GRANT)")
        if info["has_bypassrls"]:
            reasons.append("holds BYPASSRLS (every RLS policy becomes a no-op)")
        raise StartupCheckError(
            "\n"
            "=================================================================\n"
            " STARTUP ABORTED: the role that executes generated SQL is not\n"
            " constrained, so a security layer is silently disabled.\n"
            "=================================================================\n"
            f"  READONLY_DATABASE_URL role : {info['role']}\n"
            f"  database                   : {info['database']}\n"
            f"  superuser                  : {info['is_superuser']}\n"
            f"  BYPASSRLS                  : {info['has_bypassrls']}\n"
            "\n"
            f"  This role {'; and '.join(reasons)}.\n"
            "\n"
            " Generated SQL must execute as a SELECT-only, non-owner role.\n"
            " Point READONLY_DATABASE_URL at readonly_app (see seed/\n"
            " 27_readonly_role.sql), not at DATABASE_URL's role.\n"
            "================================================================="
        )

    owned = _owned_tables(engine, schema)
    if owned:
        shown = ", ".join(owned[:5]) + (f", ... (+{len(owned) - 5} more)" if len(owned) > 5 else "")
        logger.warning(
            "Read-only role %r OWNS %d table(s) in schema %r (%s). Table owners "
            "bypass Row Level Security unless the table sets FORCE ROW LEVEL "
            "SECURITY. This is not yet a problem because no policies exist, but "
            "it will silently defeat every policy Phase 2 adds.",
            info["role"], len(owned), schema, shown,
        )

    return info


def run_startup_checks() -> None:
    """Called from app/main.py's lifespan. Logs what it verified, so the
    boot log records which role the process actually got rather than which
    one the configuration intended."""
    info = check_readonly_role()
    logger.info(
        "Startup check OK: generated SQL executes as role=%r on database=%r "
        "(superuser=%s, bypassrls=%s)",
        info["role"], info["database"], info["is_superuser"], info["has_bypassrls"],
    )
