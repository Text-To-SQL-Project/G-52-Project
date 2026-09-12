"""
Layers 1 and 2 of the RLS identity defence (eval/FINDINGS.md sections 10
and 11).

The attack matrix below is the whole point of this file. Nine of these ten
shapes were shown to bypass a live RLS policy before layer 1 existed, and
the tenth is included precisely because it did NOT leak in that probe --
a single negative result is not evidence a shape is safe, and a suite that
only tested the shape already known to work would be another instance of a
check passing for the wrong reason.
"""
from __future__ import annotations

import pytest
from sqlalchemy import text

from app.db import get_readonly_engine
from app.safety.guardrails import check_guardrails
from app.safety.session_scope import (
    GUC_ROLE,
    GUC_STUDENT_ID,
    ScopeTamperingError,
    apply_scope,
    assert_scope_intact,
    check_rows_match_principal,
    scope_values,
)
from app.users import Principal

STUDENT = Principal(user_id=2, username="student1", role="student", student_id=32, faculty_id=None)
FACULTY = Principal(user_id=5, username="faculty1", role="faculty", student_id=None, faculty_id=25)
ADMIN = Principal(user_id=1, username="admin", role="admin", student_id=None, faculty_id=None)


# --- layer 1: the denylist -------------------------------------------------

ATTACK_SHAPES = {
    "target_list_subquery": "SELECT id FROM (SELECT set_config('app.student_id','87',true), id FROM marks) z",
    "cte": "WITH t AS (SELECT set_config('app.student_id','87',true)) SELECT m.id FROM marks m, t",
    "cte_materialized": "WITH t AS MATERIALIZED (SELECT set_config('app.student_id','87',true)) SELECT m.id FROM marks m, t",
    "scalar_subquery": "SELECT id, (SELECT set_config('app.student_id','87',true)) FROM marks",
    "where_clause": "SELECT id FROM marks WHERE set_config('app.student_id','87',true) IS NOT NULL",
    "lateral": "SELECT m.id FROM marks m, LATERAL (SELECT set_config('app.student_id','87',true)) l",
    "window_order_by": "SELECT id, row_number() OVER (ORDER BY set_config('app.student_id','87',true)) FROM marks",
    "union_arm": "SELECT id FROM marks UNION SELECT id FROM marks WHERE set_config('app.student_id','87',true) IS NOT NULL",
    "top_level_order_by": "SELECT id FROM marks ORDER BY set_config('app.student_id','87',true)",
    "case_expression": "SELECT id FROM marks WHERE CASE WHEN set_config('app.student_id','87',true) IS NOT NULL THEN true ELSE true END",
    # Did not leak in the original probe. Kept because that proves nothing.
    "exists": "SELECT id FROM marks WHERE EXISTS (SELECT set_config('app.student_id','87',true))",
}

EVASION_SHAPES = {
    "pg_catalog_qualified": "SELECT pg_catalog.set_config('app.student_id','87',true), id FROM marks",
    "uppercase": "SELECT SET_CONFIG('app.student_id','87',true), id FROM marks",
    "mixed_case": "SELECT Set_Config('app.student_id','87',true), id FROM marks",
    "quoted_identifier": 'SELECT "set_config"(\'app.student_id\',\'87\',true), id FROM marks',
    "reads_the_value_back": "SELECT current_setting('app.student_id'), id FROM marks",
}


@pytest.mark.parametrize("label", sorted(ATTACK_SHAPES))
def test_every_attack_shape_is_blocked(label):
    result = check_guardrails(ATTACK_SHAPES[label])
    assert not result.passed, f"{label} was allowed through"
    assert any("set_config" in r for r in result.blocked_reasons)


@pytest.mark.parametrize("label", sorted(EVASION_SHAPES))
def test_name_evasions_are_blocked(label):
    assert not check_guardrails(EVASION_SHAPES[label]).passed


def test_blocking_stays_inside_the_frozen_checks_run_vocabulary():
    """checks_run's four values are baked into the API contract and the
    mock data. The new rule folds into dml_block rather than adding a
    fifth name."""
    result = check_guardrails(ATTACK_SHAPES["target_list_subquery"])
    assert set(result.checks_run) <= {"ddl_block", "dml_block", "row_limit", "subquery_depth"}


LEGITIMATE = {
    "plain": "SELECT id FROM marks",
    "aggregate": "SELECT student_id, avg(score) FROM marks GROUP BY student_id",
    "join_and_cte": "WITH t AS (SELECT student_id FROM students) SELECT m.id FROM marks m JOIN t ON t.student_id = m.student_id",
    "window": "SELECT id, row_number() OVER (ORDER BY score DESC) FROM marks",
    "in_subquery": "SELECT id FROM marks WHERE student_id IN (SELECT student_id FROM students WHERE status='ACTIVE')",
}


@pytest.mark.parametrize("label", sorted(LEGITIMATE))
def test_legitimate_analytics_sql_is_not_caught(label):
    """A denylist that blocks real queries is worse than none: it would
    push the demo toward loosening it."""
    assert check_guardrails(LEGITIMATE[label]).passed


# --- layer 2: the session scope -------------------------------------------

def test_scope_values_use_empty_string_not_none():
    """current_setting(name, true) returns '' for an unset custom GUC, so
    policies see one consistent 'absent' representation."""
    v = scope_values(STUDENT)
    assert v[GUC_STUDENT_ID] == "32"
    assert v["app.faculty_id"] == ""
    assert v[GUC_ROLE] == "student"


def test_scope_binds_inside_the_transaction():
    eng = get_readonly_engine()
    with eng.begin() as conn:
        apply_scope(conn, STUDENT)
        got = conn.execute(
            text("SELECT current_setting('app.student_id', true)")
        ).scalar()
        assert got == "32"


def test_scope_does_not_survive_onto_the_next_checkout():
    """The pooled-connection leak this design exists to prevent: one
    user's identity must not be visible to the next user's request."""
    eng = get_readonly_engine()
    with eng.begin() as conn:
        apply_scope(conn, STUDENT)
    with eng.connect() as conn:
        leaked = conn.execute(
            text("SELECT current_setting('app.student_id', true)")
        ).scalar()
    assert leaked in ("", None), f"scope leaked across checkout: {leaked!r}"


def test_intact_scope_raises_nothing():
    eng = get_readonly_engine()
    with eng.begin() as conn:
        expected = apply_scope(conn, STUDENT)
        conn.execute(text("SELECT 1"))
        assert_scope_intact(conn, expected)


def test_tampering_is_detected():
    """Simulates layer 1 having been bypassed: the value is rewritten
    inside the transaction, exactly as a leaking query would."""
    eng = get_readonly_engine()
    with eng.begin() as conn:
        expected = apply_scope(conn, STUDENT)
        conn.execute(text("SELECT set_config('app.student_id', '87', true)"))
        with pytest.raises(ScopeTamperingError) as exc:
            assert_scope_intact(conn, expected)
    assert "app.student_id" in str(exc.value)


def test_role_tampering_is_detected():
    eng = get_readonly_engine()
    with eng.begin() as conn:
        expected = apply_scope(conn, STUDENT)
        conn.execute(text("SELECT set_config('app.role', 'admin', true)"))
        with pytest.raises(ScopeTamperingError):
            assert_scope_intact(conn, expected)


# --- the application-side row check ---------------------------------------

def test_row_check_passes_when_every_row_is_the_principals():
    assert check_rows_match_principal(["student_id", "score"], [[32, 55], [32, 61]], STUDENT) == []


def test_row_check_catches_another_students_row():
    v = check_rows_match_principal(["student_id", "score"], [[32, 55], [87, 99]], STUDENT)
    assert len(v) == 1 and "87" in v[0]


def test_row_check_handles_faculty_identity():
    assert check_rows_match_principal(["faculty_id"], [[25]], FACULTY) == []
    assert check_rows_match_principal(["faculty_id"], [[26]], FACULTY) != []


def test_admin_is_exempt():
    """An admin seeing other people's ids is the expected case."""
    assert check_rows_match_principal(["student_id"], [[87], [3]], ADMIN) == []


@pytest.mark.parametrize(
    "columns, rows, why",
    [
        (["avg"], [[72.5]], "aggregate drops the identity column"),
        (["count"], [[400]], "COUNT(*) leaks cardinality with no id"),
        (["sid"], [[87]], "aliased identity column"),
        (["label"], [["S87"]], "computed/concatenated identity"),
        (["first_name", "score"], [["Someone", 91]], "projection omits the id"),
    ],
)
def test_row_check_documented_blind_spots(columns, rows, why):
    """These are NOT bugs. They are the stated limits of a partial check,
    asserted so the limits stay visible and cannot be quietly assumed away.
    RLS is the enforcement; this is a tripwire over the common shape."""
    assert check_rows_match_principal(columns, rows, STUDENT) == [], why


def test_nulls_are_not_violations():
    assert check_rows_match_principal(["student_id"], [[None], [32]], STUDENT) == []
