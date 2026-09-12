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

HONEST LIMIT, stated here because it must not read as a guarantee:
an attacker who knows this check exists can defeat it by restoring the
value before the statement ends. Anything the query can read, it can put
back. This reliably catches careless tampering -- which is the realistic
model-generated and non-targeted prompt-injection case -- and it catches
attack shapes nobody has enumerated yet, which the denylist cannot. It is
a mitigation, not a control. The control would be removing the mutable
setting from the trust path entirely; see section 11 for the two designs
that would do that and what they cost.
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
