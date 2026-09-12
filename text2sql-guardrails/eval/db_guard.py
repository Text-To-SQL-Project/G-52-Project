"""
Refuses to let an eval run start on a connection that Row Level Security
would filter.

Why this exists as a hard abort rather than a warning
-----------------------------------------------------
Every other way this project can be misconfigured fails loudly: a bad
LLM key 401s, a bad DATABASE_URL refuses to connect, a malformed golden
set raises. RLS is the one exception. A connection subject to a policy
does not error -- it returns fewer rows. eval/metrics.py::execution_match()
then compares a filtered predicted set against a filtered gold set,
disagreements appear where there were none, and results.jsonl is written
with numbers that look completely plausible and are not reproducible
against the published baselines (execution accuracy 0.714 permissive /
0.415 strict, guardrail block rate 1.000).

Nothing in the output would say why. That is the entire problem: silent
numbers drift in the one artifact the paper rests on. So this turns it
into a crash before a single LLM call is spent.

What counts as immune
---------------------
PostgreSQL exempts three kinds of role from RLS:

  1. superusers, unconditionally;
  2. roles with the BYPASSRLS attribute;
  3. the table's OWNER -- but only while that table does not have
     FORCE ROW LEVEL SECURITY set, which exists precisely to subject the
     owner to its own policies.

Anything else is subject to policy and must not run an eval. Note that
(3) is per-table, so owning 24 of 25 tables is not immunity; the check
below requires the role to clear the bar for every table in the schema.

This is deliberately strict about a database that has no policies yet.
A role that is not structurally immune passes trivially today and starts
filtering the moment Phase 2 enables the first policy -- which would put
the failure a long way from its cause. Better to reject the connection
now, while the fix is one environment variable.
"""
from __future__ import annotations

import sys

from sqlalchemy import Engine, text

from app.config import settings


class RlsGuardError(RuntimeError):
    """Raised when the eval connection would be subject to RLS."""


def describe_connection(engine: Engine) -> dict:
    """Identify the role and the server, for the run log.

    The server identity matters as much as the role: eval and the API
    deliberately run against two different PostgreSQL instances (see
    eval/README.md), and `system_identifier` is the only thing that tells
    them apart unambiguously -- host and port can be forwarded, database
    names are identical, and the data is the same on both.
    """
    with engine.connect() as conn:
        row = conn.execute(text("""
            SELECT current_user                                AS role,
                   current_database()                          AS database,
                   r.rolsuper                                  AS is_superuser,
                   r.rolbypassrls                              AS has_bypassrls,
                   current_setting('port')                     AS port,
                   (SELECT system_identifier FROM pg_control_system())::text
                                                               AS system_identifier
              FROM pg_roles r
             WHERE r.rolname = current_user
        """)).mappings().one()
        return dict(row)


def _tables_that_would_filter(engine: Engine, schema: str) -> list[str]:
    """Tables in `schema` whose RLS would apply to the current role.

    A table is a problem when the current role is not its owner, or is its
    owner but the table carries FORCE ROW LEVEL SECURITY. Checked against
    every table rather than only those with policies today, so enabling a
    policy later cannot silently change the answer.
    """
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT c.relname                     AS table_name,
                   pg_get_userbyid(c.relowner)   AS owner,
                   c.relrowsecurity              AS rls_enabled,
                   c.relforcerowsecurity         AS rls_forced
              FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = :schema
               AND c.relkind = 'r'
             ORDER BY c.relname
        """), {"schema": schema}).mappings().all()

    current = describe_connection(engine)["role"]
    problems = []
    for r in rows:
        owns = r["owner"] == current
        if not owns or r["rls_forced"]:
            problems.append(r["table_name"])
    return problems


def is_immune(*, is_superuser: bool, has_bypassrls: bool, problem_tables: list[str]) -> bool:
    """The decision itself, separated from the I/O that feeds it.

    Pure so it can be tested without a database -- no existing test in this
    project needs one, and a guard that only gets exercised when Docker
    happens to be up is a guard that rots. The three exemptions map 1:1 to
    PostgreSQL's own rules; `problem_tables` is empty exactly when the role
    owns every table in the schema and none of them force RLS on their
    owner.
    """
    return bool(is_superuser) or bool(has_bypassrls) or not problem_tables


def assert_bypasses_rls(engine: Engine, *, schema: str | None = None) -> dict:
    """Abort unless `engine`'s role is immune to Row Level Security.

    Returns the connection description on success so the caller can print
    it into the run log. Raises RlsGuardError otherwise -- callers that are
    command-line entrypoints should catch it and exit non-zero with the
    message, which is written to be actionable on its own.
    """
    schema = schema or settings.DB_SCHEMA

    if str(engine.url).startswith("sqlite"):
        # SQLite has no RLS and no roles; there is nothing to bypass.
        return {"role": "sqlite", "database": str(engine.url.database), "is_superuser": True,
                "has_bypassrls": True, "port": "n/a", "system_identifier": "n/a"}

    info = describe_connection(engine)

    if is_immune(is_superuser=info["is_superuser"],
                 has_bypassrls=info["has_bypassrls"],
                 problem_tables=[]):
        return info

    filtered = _tables_that_would_filter(engine, schema)
    if is_immune(is_superuser=info["is_superuser"],
                 has_bypassrls=info["has_bypassrls"],
                 problem_tables=filtered):
        return info

    shown = ", ".join(filtered[:5]) + (f", ... (+{len(filtered) - 5} more)" if len(filtered) > 5 else "")
    raise RlsGuardError(
        "\n"
        "=================================================================\n"
        " EVAL ABORTED: this connection would be subject to Row Level\n"
        " Security, so the run would silently produce filtered results.\n"
        "=================================================================\n"
        f"  role               : {info['role']}\n"
        f"  database           : {info['database']} (port {info['port']})\n"
        f"  system_identifier  : {info['system_identifier']}\n"
        f"  superuser          : {info['is_superuser']}\n"
        f"  BYPASSRLS          : {info['has_bypassrls']}\n"
        f"  not owned / forced : {shown}\n"
        "\n"
        " An eval run compares gold against predicted ROW SETS. A filtered\n"
        " connection does not fail -- it quietly reports different numbers\n"
        " and the published baselines stop being reproducible.\n"
        "\n"
        " Fix: point EVAL_DATABASE_URL at a role that is a superuser, has\n"
        " BYPASSRLS, or owns every table in the schema without FORCE ROW\n"
        " LEVEL SECURITY. Do NOT reuse READONLY_DATABASE_URL -- that is the\n"
        " role user queries execute as, and it is meant to be filtered.\n"
        " See eval/README.md, 'Which database eval runs against'.\n"
        "================================================================="
    )


def assert_or_exit(engine: Engine, *, label: str = "eval") -> dict:
    """assert_bypasses_rls() for command-line entrypoints.

    Prints the resolved role and server on success -- worth having in the
    log of every run, since 'which database produced this file' is
    otherwise unrecoverable after the fact -- and exits 2 on failure.
    """
    try:
        info = assert_bypasses_rls(engine)
    except RlsGuardError as e:
        print(str(e), file=sys.stderr)
        raise SystemExit(2)
    print(
        f"[{label}] RLS guard OK: role={info['role']} db={info['database']} "
        f"port={info['port']} system_identifier={info['system_identifier']} "
        f"superuser={info['is_superuser']} bypassrls={info['has_bypassrls']}"
    )
    return info
