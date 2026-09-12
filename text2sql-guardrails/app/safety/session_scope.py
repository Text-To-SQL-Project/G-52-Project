"""
Binds the authenticated principal to the database session that executes
generated SQL, and checks afterwards that the binding survived.

This is layer 2 of the three described in eval/FINDINGS.md section 10.
Read that section before changing anything here; the short version is:

  Row Level Security policies read a session variable to decide which rows
  a query may see. `set_config()` is an ordinary VOLATILE function, so
  generated SQL can rewrite that variable from inside a plain SELECT --
  nine of ten attack shapes tested bypassed a policy that way. Layer 1
  (app/safety/guardrails.py) denylists the function. This module sets the
  variable transaction-locally and verifies it is unchanged before the
  results are allowed out.

SUPERSEDED, AND DELIBERATELY KEPT. As of the backend-keyed session map
(seed/30_session_map.sql, findings section 12) the RLS policies no longer
read these GUCs at all -- they resolve identity from (pid, backend_start),
neither of which is settable from SQL. The denylist in
app/safety/guardrails.py and the re-assertion below are therefore
REDUNDANT-BY-DESIGN rather than load-bearing.

They stay for two reasons. Defence in depth is this project's actual
argument, and removing a layer the moment another one works would
undercut it in exactly the way the paper criticises elsewhere. And they
are cheap: a denylist lookup during parsing, and one extra round trip on a
connection already in hand.

What they still do: the GUCs remain bound and re-asserted, so if a policy
is ever written against current_setting() by mistake -- the natural thing
to reach for, and what every tutorial shows -- the old attack surface does
not silently reopen. Drift becomes a caught anomaly rather than a breach.

The original honest limit still applies to THESE TWO LAYERS in isolation:
an attacker who knows about the re-assertion can defeat it by restoring
the value before the statement ends, because anything the query can read
it can put back. That is precisely why they are no longer the control.
"""
from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.users import Principal

logger = logging.getLogger(__name__)

# Set transaction-locally on the connection that runs the user's SQL, and
# read by the RLS policies. Names are prefixed `app.` so they land in the
# custom-GUC namespace PostgreSQL reserves for exactly this.
GUC_ROLE = "app.role"
GUC_STUDENT_ID = "app.student_id"
GUC_FACULTY_ID = "app.faculty_id"
SCOPE_GUCS = (GUC_ROLE, GUC_STUDENT_ID, GUC_FACULTY_ID)


class ScopeTamperingError(RuntimeError):
    """The session scope changed during execution of the user's SQL.

    Treated as a security event, never as a query error: the results from
    that statement are discarded rather than returned, because the rows
    that came back were selected under a policy evaluated against an
    identity the caller was not entitled to.
    """


def scope_values(principal: Principal) -> dict[str, str]:
    """The values to bind for this principal.

    Empty string rather than NULL for the inapplicable id: `set_config`
    takes text, and `current_setting(name, true)` returns an empty string
    for an unset custom GUC. Policies therefore see one consistent
    "absent" representation instead of having to distinguish unset from
    NULL from empty.
    """
    return {
        GUC_ROLE: principal.role,
        GUC_STUDENT_ID: "" if principal.student_id is None else str(principal.student_id),
        GUC_FACULTY_ID: "" if principal.faculty_id is None else str(principal.faculty_id),
    }


def apply_scope(conn: Connection, principal: Principal) -> dict[str, str]:
    """Bind the principal to `conn` for the current transaction.

    `set_config(..., true)` is transaction-local, so COMMIT or ROLLBACK
    resets it with no cleanup code to forget -- which is what keeps a
    pooled connection from carrying one user's identity into the next
    user's request. The value goes through a bind parameter, never string
    interpolation; a `SET` statement cannot be parameterised, which is one
    of several reasons this is not a `SET`.

    Returns the values bound, for the caller to re-assert later.
    """
    expected = scope_values(principal)
    for name, value in expected.items():
        conn.execute(text("SELECT set_config(:n, :v, true)"), {"n": name, "v": value})
    return expected


def assert_scope_intact(conn: Connection, expected: dict[str, str]) -> None:
    """Verify the scope still holds. Raises ScopeTamperingError if not.

    Must run on the SAME connection and inside the SAME transaction as the
    user's statement -- a transaction-local setting does not exist anywhere
    else -- and before the rows are handed to the caller.
    """
    row = conn.execute(
        text(
            "SELECT current_setting(:r, true) AS role_v, "
            "       current_setting(:s, true) AS student_v, "
            "       current_setting(:f, true) AS faculty_v"
        ),
        {"r": GUC_ROLE, "s": GUC_STUDENT_ID, "f": GUC_FACULTY_ID},
    ).mappings().one()

    actual = {
        GUC_ROLE: row["role_v"] or "",
        GUC_STUDENT_ID: row["student_v"] or "",
        GUC_FACULTY_ID: row["faculty_v"] or "",
    }
    drifted = {k: (expected[k], actual[k]) for k in expected if expected[k] != actual[k]}
    if drifted:
        raise ScopeTamperingError(
            "session scope changed during execution: "
            + "; ".join(f"{k} expected {e!r} got {a!r}" for k, (e, a) in drifted.items())
        )


# ---------------------------------------------------------------------------
# Application-side row check.
#
# A second, independent check on the subset of results most likely to be
# exfiltrating: if the result set projects an identity column, every value
# in it must be the principal's own.
#
# WHAT THIS COVERS: any result with a column literally named student_id or
# faculty_id. That includes the shapes an exfiltration attempt most often
# takes, because getting somebody else's rows out is usually the point and
# the id is usually in them -- `SELECT * FROM marks`, `SELECT student_id,
# score FROM ...`, `GROUP BY student_id`.
#
# WHAT THIS DOES NOT COVER, and it is a lot:
#   - aggregates that drop the id: SELECT avg(score) FROM marks
#   - COUNT(*), which leaks a cardinality without any identity column
#   - aliased identity columns: SELECT student_id AS sid
#   - computed or concatenated identity: SELECT 'S'||student_id
#   - any projection of someone else's data that simply omits their id,
#     e.g. SELECT first_name, score FROM students JOIN marks USING (...)
#
# So it is genuinely partial and must never be described as row-level
# enforcement. RLS is the enforcement. This is a tripwire over the most
# common exfiltration shape, cheap enough to run on every result.
# ---------------------------------------------------------------------------

_IDENTITY_COLUMNS = {
    "student_id": lambda p: p.student_id,
    "faculty_id": lambda p: p.faculty_id,
}


def check_rows_match_principal(
    columns: list[str],
    rows: list[list],
    principal: Principal,
) -> list[str]:
    """Return a list of violations; empty means nothing suspicious found.

    Admins are exempt: they are entitled to every row, so an identity
    column holding somebody else's id is the expected case, not a finding.
    A principal with no ERP identity at all is likewise skipped rather than
    compared against None.
    """
    if principal.is_admin:
        return []

    violations: list[str] = []
    for idx, col in enumerate(columns):
        key = (col or "").strip().lower()
        getter = _IDENTITY_COLUMNS.get(key)
        if getter is None:
            continue
        own = getter(principal)
        if own is None:
            # This principal has no id of that kind. A student seeing a
            # faculty_id column is not by itself a violation -- the column
            # may legitimately appear via a shared reference join -- so
            # there is nothing to compare and the column is skipped.
            continue
        for row in rows:
            if idx >= len(row):
                continue
            value = row[idx]
            if value is None:
                continue
            try:
                if int(value) != int(own):
                    violations.append(
                        f"column {col!r} contained {value!r}, "
                        f"principal owns {own!r}"
                    )
                    break  # one violation per column is enough to discard
            except (TypeError, ValueError):
                # Not comparable as an id (a formatted or joined value).
                # Out of scope for this check rather than a violation.
                break
    return violations


# ---------------------------------------------------------------------------
# The backend-keyed session map: the actual control.
#
# Identity is resolved by the database from two values a query cannot
# forge -- its own backend pid and that backend's start time -- looked up
# in app.session_map, which the executing role may read and may never
# write. See seed/30_session_map.sql for the schema, the accessor
# functions, and the reasoning behind the composite key.
#
# Every failure path here raises. There is no degraded mode: a request that
# cannot establish its identity must not execute, because executing
# unscoped is the exact outcome this mechanism exists to prevent.
# ---------------------------------------------------------------------------

# How long a mapping stays valid. Deliberately short: this is a backstop
# for a failed post-request DELETE, not a session lifetime. A request that
# somehow outlives it fails closed (zero rows) rather than running on a
# stale identity.
SESSION_MAP_TTL_SECONDS = 120


class SessionBindingError(RuntimeError):
    """Identity could not be bound to this backend. Always fatal to the
    request -- never downgraded to "continue without a scope"."""


def read_backend_identity(conn: Connection) -> tuple[int, object]:
    """The (pid, backend_start) of the backend `conn` is talking to.

    Both come from the server, never the client. pg_backend_pid() is the
    connection's own pid, and backend_start is read from pg_stat_activity
    for that same pid -- a backend can always see its own row there.
    """
    row = conn.execute(
        text(
            "SELECT pg_backend_pid() AS pid, "
            "       (SELECT a.backend_start FROM pg_stat_activity a "
            "         WHERE a.pid = pg_backend_pid()) AS backend_start"
        )
    ).mappings().one_or_none()

    if row is None or row["pid"] is None or row["backend_start"] is None:
        # Fail closed. Without backend_start the mapping would have to be
        # keyed on pid alone, and a recycled pid would then hand a stale
        # identity to an unrelated backend.
        raise SessionBindingError(
            "could not read this backend's identity (pid/backend_start unavailable)"
        )
    return int(row["pid"]), row["backend_start"]


def bind_session(
    privileged_engine,
    *,
    pid: int,
    backend_start,
    principal: Principal,
    ttl_seconds: int = SESSION_MAP_TTL_SECONDS,
) -> None:
    """Write this backend's identity, from the PRIVILEGED connection.

    A separate, committed transaction on a different connection, because
    the read-only role cannot write the map -- that inability is the whole
    point -- and because the reading session must see the row as committed
    data. The app's default READ COMMITTED isolation means the query
    statement, which starts after this commit returns, sees it.

    ON CONFLICT covers a previous request on this same physical connection
    having failed to clean up: identical (pid, backend_start), so the row
    is replaced rather than duplicated or stale.
    """
    try:
        with privileged_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO app.session_map "
                    "  (pid, backend_start, user_id, role, student_id, faculty_id, expires_at) "
                    "VALUES (:pid, :bs, :uid, :role, :sid, :fid, "
                    "        now() + make_interval(secs => :ttl)) "
                    "ON CONFLICT (pid, backend_start) DO UPDATE SET "
                    "  user_id = EXCLUDED.user_id, role = EXCLUDED.role, "
                    "  student_id = EXCLUDED.student_id, faculty_id = EXCLUDED.faculty_id, "
                    "  created_at = now(), expires_at = EXCLUDED.expires_at"
                ),
                {
                    "pid": pid,
                    "bs": backend_start,
                    "uid": principal.user_id,
                    "role": principal.role,
                    "sid": principal.student_id,
                    "fid": principal.faculty_id,
                    "ttl": ttl_seconds,
                },
            )
    except Exception as e:
        # Fail closed. No mapping means the policies would return zero rows,
        # but the caller must not proceed and then report that emptiness as
        # a legitimate result.
        raise SessionBindingError(f"could not bind session identity: {e}") from e


def release_session(privileged_engine, *, pid: int, backend_start) -> None:
    """Delete this backend's mapping. Best-effort by design.

    A failure here is NOT fatal, and is swallowed after logging, because
    the composite key makes a leftover row harmless. The row can only ever
    match the very backend it was written for. If this application reuses
    that backend, the next request overwrites it via ON CONFLICT before
    running anything. If the backend dies, no future backend can match the
    key: a new process gets a new start time even on a recycled pid. And
    expires_at removes it regardless.

    So the worst case of a failed delete is a row nobody else can reach,
    which then expires on its own.
    """
    try:
        with privileged_engine.begin() as conn:
            conn.execute(
                text("DELETE FROM app.session_map WHERE pid = :pid AND backend_start = :bs"),
                {"pid": pid, "bs": backend_start},
            )
    except Exception as e:
        logger.warning(
            "Failed to release session map row for pid=%s (harmless: the row is "
            "keyed to this backend alone and expires in %ss): %s",
            pid, SESSION_MAP_TTL_SECONDS, e,
        )


def purge_expired_sessions(privileged_engine) -> int:
    """TTL backstop sweep. Returns the number of rows removed."""
    try:
        with privileged_engine.begin() as conn:
            result = conn.execute(
                text("DELETE FROM app.session_map WHERE expires_at <= now()")
            )
            return result.rowcount or 0
    except Exception as e:
        logger.warning("Session map purge failed: %s", e)
        return 0
