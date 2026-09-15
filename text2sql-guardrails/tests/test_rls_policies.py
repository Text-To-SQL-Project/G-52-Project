"""
W3: the Row Level Security policies themselves.

Two rules govern every assertion here, both learned the hard way (findings
section 10):

  1. ASSERT ON ROW IDENTITY, NEVER ROW COUNT. An earlier probe compared
     count(*) between two students who happened to own the same number of
     rows, and a total data leak read as "no leak". The live data makes
     that trap concrete: student1 and student2 each have exactly 79
     attendance rows. A count-based test would pass while they swapped
     records.

  2. TEST THE ATTACK IN EVERY SHAPE. A suite that only covers the shape
     already known to work proves only that one shape is handled.

These need a genuinely constrained role and carry the isolation marker, so
they refuse outright if the insecure test fallback is active.
"""
from __future__ import annotations

import re

import pytest
from sqlalchemy import text

from app.db import get_engine, get_readonly_engine
from app.safety.session_scope import bind_session, read_backend_identity, release_session
from app.users import Principal

pytestmark = pytest.mark.isolation

# The seeded accounts, from scripts/seed_users.py's deterministic selection.
STUDENT_A = Principal(user_id=2, username="student1", role="student", student_id=32, faculty_id=None)
STUDENT_B = Principal(user_id=3, username="student2", role="student", student_id=87, faculty_id=None)
FACULTY = Principal(user_id=5, username="faculty1", role="faculty", student_id=None, faculty_id=25)
ADMIN = Principal(user_id=1, username="admin", role="admin", student_id=None, faculty_id=None)

SCOPED_TABLES = [
    "students", "attendance", "marks", "fee_payments", "library_transactions",
    "placement_applications", "student_enrollments", "student_section_mapping",
    "placement_offers", "faculty", "faculty_subject_assignments",
]
# Tables where a STUDENT principal must never see another student's row.
# Named from the student's side on purpose: marks and student_section_mapping
# additionally admit the faculty member who teaches the row (see the faculty
# scope tests below), so they are not own-rows-only in general -- but they are
# still own-rows-only for a student, which is what these parametrised tests
# assert.
STUDENT_OWN_ROWS_ONLY = [
    "attendance", "marks", "fee_payments", "library_transactions",
    "placement_applications", "student_enrollments", "student_section_mapping",
]

# Closed to faculty entirely: no teaching relation grants them. fee_payments
# and library_transactions are financial, the placement pair is a student's
# job search, and student_enrollments is closed for a separate reason
# recorded in seed/31_rls_policies.sql -- an institution-wide aggregate must
# fail loudly rather than return a silently partial count.
CLOSED_TO_FACULTY = [
    "fee_payments", "library_transactions", "placement_applications",
    "placement_offers", "student_enrollments",
]


def run_as(principal: Principal | None, sql: str):
    """Execute `sql` through the same binding the request path uses."""
    priv, ro = get_engine(), get_readonly_engine()
    with ro.begin() as conn:
        pid, bs = read_backend_identity(conn)
        try:
            if principal is not None:
                bind_session(priv, pid=pid, backend_start=bs, principal=principal)
            return [tuple(r) for r in conn.execute(text(sql)).fetchall()]
        finally:
            release_session(priv, pid=pid, backend_start=bs)


def ids_as(principal, sql):
    return {r[0] for r in run_as(principal, sql)}


# --- the catalog itself ----------------------------------------------------

def test_every_scoped_table_has_rls_enabled():
    rows = run_as(ADMIN, """
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'college_erp' AND c.relrowsecurity
    """)
    enabled = {r[0] for r in rows}
    missing = set(SCOPED_TABLES) - enabled
    assert not missing, f"tables without RLS: {sorted(missing)}"


def test_no_policy_reads_a_mutable_session_variable():
    """The regression that would be invisible until exploited. One policy
    written with current_setting() reopens the section-10 attack for that
    table alone."""
    rows = run_as(ADMIN, """
        SELECT tablename, policyname FROM pg_policies
         WHERE schemaname = 'college_erp' AND qual ILIKE '%current_setting%'
    """)
    assert rows == [], f"policies using a mutable GUC: {rows}"


@pytest.mark.parametrize("table", SCOPED_TABLES)
def test_each_policy_resolves_identity_through_the_accessors(table):
    rows = run_as(ADMIN, f"""
        SELECT qual FROM pg_policies
         WHERE schemaname = 'college_erp' AND tablename = '{table}'
    """)
    assert rows, f"{table} has no policy"
    qual = rows[0][0].lower()
    assert any(a in qual for a in (
        "current_student_id", "current_faculty_id",
        "current_faculty_department", "current_is_admin", "current_role_name",
    )), f"{table} policy does not use the session-map accessors: {qual}"


# --- the core property -----------------------------------------------------

@pytest.mark.parametrize("table", STUDENT_OWN_ROWS_ONLY)
def test_student_sees_only_their_own_rows(table):
    """Row identity, not count."""
    owners = {r[0] for r in run_as(STUDENT_A, f"SELECT DISTINCT student_id FROM {table}")}
    assert owners <= {STUDENT_A.student_id}, f"{table} exposed student_ids {owners}"


@pytest.mark.parametrize("table", STUDENT_OWN_ROWS_ONLY)
def test_two_students_never_see_each_others_rows(table):
    a = {r[0] for r in run_as(STUDENT_A, f"SELECT DISTINCT student_id FROM {table}")}
    b = {r[0] for r in run_as(STUDENT_B, f"SELECT DISTINCT student_id FROM {table}")}
    assert a.isdisjoint(b), f"{table}: overlap between principals {a & b}"


def test_counts_alone_would_have_missed_this():
    """Documents why rule 1 exists. Both students own exactly 79
    attendance rows in the seeded data, so a count comparison is blind to
    a complete swap."""
    a = run_as(STUDENT_A, "SELECT count(*) FROM attendance")[0][0]
    b = run_as(STUDENT_B, "SELECT count(*) FROM attendance")[0][0]
    assert a == b, "precondition for this test; the identity assertions above are the real check"


def test_student_sees_exactly_their_own_student_row():
    assert ids_as(STUDENT_A, "SELECT student_id FROM students") == {STUDENT_A.student_id}
    assert ids_as(STUDENT_B, "SELECT student_id FROM students") == {STUDENT_B.student_id}


def test_placement_offers_scope_through_the_owning_application():
    """No student_id column; reached via EXISTS against a table that is
    itself policy-filtered."""
    rows = run_as(STUDENT_A, """
        SELECT DISTINCT pa.student_id
          FROM placement_offers po JOIN placement_applications pa
            ON pa.application_id = po.application_id
    """)
    owners = {r[0] for r in rows}
    assert owners <= {STUDENT_A.student_id}, f"offers leaked: {owners}"


# --- the attack matrix, now against real policies --------------------------

VICTIM = STUDENT_B.student_id

EXFILTRATION_SHAPES = {
    "direct": f"SELECT DISTINCT student_id FROM marks WHERE student_id = {VICTIM}",
    "or_predicate": f"SELECT DISTINCT student_id FROM marks WHERE student_id = {VICTIM} OR 1=1",
    "inner_join": f"SELECT DISTINCT m.student_id FROM marks m JOIN students s USING (student_id)",
    "left_join": f"SELECT DISTINCT m.student_id FROM students s LEFT JOIN marks m USING (student_id)",
    "subquery": f"SELECT DISTINCT student_id FROM marks WHERE student_id IN (SELECT student_id FROM students)",
    "correlated": "SELECT DISTINCT m.student_id FROM marks m WHERE EXISTS (SELECT 1 FROM students s WHERE s.student_id = m.student_id)",
    "cte": "WITH t AS (SELECT * FROM marks) SELECT DISTINCT student_id FROM t",
    "cte_materialized": "WITH t AS MATERIALIZED (SELECT * FROM marks) SELECT DISTINCT student_id FROM t",
    "union": "SELECT DISTINCT student_id FROM marks UNION SELECT DISTINCT student_id FROM attendance",
    "lateral": "SELECT DISTINCT l.student_id FROM students s, LATERAL (SELECT student_id FROM marks m WHERE m.student_id = s.student_id) l",
    "window": "SELECT DISTINCT student_id FROM (SELECT student_id, row_number() OVER () FROM marks) z",
    "self_join": "SELECT DISTINCT a.student_id FROM marks a JOIN marks b ON a.student_id <> b.student_id",
    "not_exists": "SELECT DISTINCT student_id FROM marks m WHERE NOT EXISTS (SELECT 1 FROM students s WHERE s.student_id = -1)",
}


@pytest.mark.parametrize("shape", sorted(EXFILTRATION_SHAPES))
def test_no_query_shape_reaches_another_students_rows(shape):
    owners = {r[0] for r in run_as(STUDENT_A, EXFILTRATION_SHAPES[shape])}
    assert owners <= {STUDENT_A.student_id}, f"{shape} exposed {owners}"


def test_aggregates_cannot_exfiltrate_values():
    """string_agg is the sharpest probe: it carries values out, not just a
    cardinality, so a leak is unmistakable."""
    rows = run_as(STUDENT_A, "SELECT string_agg(DISTINCT student_id::text, ',') FROM marks")
    got = rows[0][0] or ""
    leaked = {int(x) for x in got.split(",") if x.strip()} - {STUDENT_A.student_id}
    assert not leaked, f"string_agg leaked {leaked}"


def test_set_config_attack_is_inert_against_the_policies():
    """The attack that defeated the GUC design. pid and backend_start are
    not settable from SQL, so it has nothing to act on."""
    priv, ro = get_engine(), get_readonly_engine()
    with ro.begin() as conn:
        pid, bs = read_backend_identity(conn)
        try:
            bind_session(priv, pid=pid, backend_start=bs, principal=STUDENT_A)
            conn.execute(text("SELECT set_config('app.student_id','87',true)"))
            conn.execute(text("SELECT set_config('app.role','admin',true)"))
            owners = {r[0] for r in conn.execute(
                text("SELECT DISTINCT student_id FROM marks")).fetchall()}
        finally:
            release_session(priv, pid=pid, backend_start=bs)
    assert owners <= {STUDENT_A.student_id}, f"GUC tampering changed visibility: {owners}"


# --- fail closed, and the other roles --------------------------------------

@pytest.mark.parametrize("table", SCOPED_TABLES)
def test_unbound_session_sees_nothing_anywhere(table):
    """No mapping must mean zero rows, never all rows -- on every table,
    not just the ones somebody remembered."""
    rows = run_as(None, f"SELECT count(*) FROM {table}")
    assert rows[0][0] == 0, f"{table} returned rows to an unbound session"


def test_admin_sees_everything():
    assert run_as(ADMIN, "SELECT count(*) FROM students")[0][0] == 2000
    assert run_as(ADMIN, "SELECT count(*) FROM marks")[0][0] == 40000


def test_faculty_sees_their_department_not_the_whole_school():
    """students is the one table deliberately scoped by DEPARTMENT rather
    than by teaching relation -- a faculty member is entitled to know who is
    in their department. Asserted as identity: the visible set must be
    exactly the department roster, not merely smaller than the school."""
    visible = {r[0] for r in run_as(FACULTY, "SELECT student_id FROM students")}
    assert visible == _department_student_ids(), (
        f"students exposed {len(visible)} rows; department roster is "
        f"{len(_department_student_ids())}")


# test_faculty_does_not_see_student_financial_or_library_records was removed
# here, not weakened. It asserted count == 0 for fee_payments,
# library_transactions AND marks. marks is now scoped by the teaching
# relation, so that expectation is superseded; and the assertion style was
# the count-based kind this file's own rule warns against. Its coverage now
# lives in test_faculty_sees_nothing_in_closed_tables, which asserts the
# empty set as identity over a wider table list, and in the marks identity
# tests below it.


def test_reference_tables_stay_readable():
    """Fourteen shared tables carry no policy on purpose. Over-scoping them
    would break ordinary questions without protecting anything."""
    for table in ("departments", "programs", "subjects", "library_books"):
        assert run_as(STUDENT_A, f"SELECT count(*) FROM {table}")[0][0] > 0, table


def test_salary_is_unreachable_through_the_query_path():
    """RLS filters rows, not columns, so salary is removed from the
    read-only role's grants entirely -- for every role including admin."""
    with pytest.raises(Exception):
        run_as(ADMIN, "SELECT salary FROM faculty LIMIT 1")


# --- faculty scope: the teaching relation --------------------------------
#
# RULE, and the reason these tests are written the way they are: assert on
# ROW IDENTITY, never on row count. The department relation and the teaching
# relation differ by an order of magnitude on the seeded data -- 5,352 marks
# versus 467 -- but a policy accidentally written against the wrong one still
# returns "some rows, fewer than admin", which is what a count assertion
# checks. Only identity distinguishes the two relations.


def _faculty_offerings():
    """Offerings faculty1 teaches, computed unfiltered as admin."""
    return {r[0] for r in run_as(
        ADMIN,
        "SELECT offering_id FROM faculty_subject_assignments "
        f"WHERE faculty_id = {FACULTY.faculty_id}")}


def _taught_student_ids():
    """Students faculty1 has assessed in an offering they teach."""
    return {r[0] for r in run_as(
        ADMIN,
        "SELECT DISTINCT m.student_id FROM marks m "
        "JOIN exams e ON e.exam_id = m.exam_id "
        "JOIN faculty_subject_assignments fsa ON fsa.offering_id = e.offering_id "
        f"WHERE fsa.faculty_id = {FACULTY.faculty_id}")}


def _department_student_ids():
    """Students in faculty1's department -- the relation NOT used for marks."""
    return {r[0] for r in run_as(
        ADMIN,
        "SELECT student_id FROM students WHERE department_id = "
        f"(SELECT department_id FROM faculty WHERE faculty_id = {FACULTY.faculty_id})")}


def test_faculty_marks_are_exactly_their_taught_offerings():
    """Identity, not count: every visible mark belongs to an offering they
    teach, and every such mark is visible."""
    visible = {r[0] for r in run_as(
        FACULTY,
        "SELECT DISTINCT e.offering_id FROM marks m "
        "JOIN exams e ON e.exam_id = m.exam_id")}
    assert visible == _faculty_offerings(), (
        f"marks visible under offerings {visible}, teaches {_faculty_offerings()}")


def test_faculty_marks_are_not_the_department_relation():
    """The test that a count assertion would pass and this one fails.

    If rls_marks were rewritten against students.department_id it would still
    return a plausible subset. This pins the difference: there exist marks in
    faculty1's department, for students they teach nothing of, and those marks
    must not be visible."""
    dept_only = {r[0] for r in run_as(
        ADMIN,
        "SELECT m.marks_id FROM marks m "
        "JOIN students s ON s.student_id = m.student_id "
        "WHERE s.department_id = (SELECT department_id FROM faculty "
        f"WHERE faculty_id = {FACULTY.faculty_id}) "
        "AND NOT EXISTS (SELECT 1 FROM exams e "
        "JOIN faculty_subject_assignments fsa ON fsa.offering_id = e.offering_id "
        f"WHERE e.exam_id = m.exam_id AND fsa.faculty_id = {FACULTY.faculty_id})")}
    assert dept_only, "precondition: seeded data must contain department-but-not-taught marks"
    visible = {r[0] for r in run_as(FACULTY, "SELECT marks_id FROM marks")}
    assert visible.isdisjoint(dept_only), (
        f"marks policy is following the DEPARTMENT relation; leaked {len(visible & dept_only)} rows")


def test_faculty_section_mapping_is_exactly_taught_students():
    visible = {r[0] for r in run_as(
        FACULTY, "SELECT DISTINCT student_id FROM student_section_mapping")}
    assert visible == _taught_student_ids(), (
        f"section mapping exposed {len(visible)} students, teaches {len(_taught_student_ids())}")


def test_faculty_section_mapping_excludes_untaught_department_students():
    untaught = _department_student_ids() - _taught_student_ids()
    assert untaught, "precondition: seeded data must contain untaught department students"
    visible = {r[0] for r in run_as(
        FACULTY, "SELECT DISTINCT student_id FROM student_section_mapping")}
    assert visible.isdisjoint(untaught), (
        f"section mapping followed the department relation; leaked {len(visible & untaught)}")


@pytest.mark.parametrize("table", CLOSED_TO_FACULTY)
def test_faculty_sees_nothing_in_closed_tables(table):
    """Empty set asserted as identity, so a future faculty branch that admits
    even one row fails here rather than passing a non-zero count check."""
    rows = run_as(FACULTY, f"SELECT * FROM {table}")
    assert rows == [], f"{table} is meant to be closed to faculty; got {len(rows)} rows"


def test_faculty_enrollment_aggregate_is_empty_not_partial():
    """The decision recorded in seed/31_rls_policies.sql, pinned as a test.

    A faculty member asking an institution-wide enrolment aggregate gets zero
    rows, NOT a smaller plausible number. If someone later adds a scoped
    faculty branch here, this fails and forces them to re-read the reasoning."""
    sql = ("SELECT ay.year_name, count(*) FROM student_enrollments se "
           "JOIN semesters sm ON sm.semester_id = se.semester_id "
           "JOIN academic_years ay ON ay.academic_year_id = sm.academic_year_id "
           "GROUP BY ay.year_name")
    assert run_as(FACULTY, sql) == [], "enrollment aggregate must be empty for faculty, not partial"
    assert run_as(ADMIN, sql), "precondition: admin must see the aggregate"


def test_faculty_branches_did_not_widen_student_scope():
    """Regression: adding faculty branches must not change what a student sees."""
    for table in ("marks", "student_section_mapping"):
        owners = {r[0] for r in run_as(
            STUDENT_A, f"SELECT DISTINCT student_id FROM {table}")}
        assert owners <= {STUDENT_A.student_id}, f"{table} widened for students: {owners}"


# --- the accessors must stay hoisted ---------------------------------------

# Scalar accessors only. The set-returning ones
# (current_faculty_offerings, current_faculty_taught_students) already sit
# in the FROM of a subquery and are hoisted as a hashed SubPlan, so they are
# correctly NOT wrapped.
_SCALAR_ACCESSORS = [
    "current_is_admin",
    "current_student_id",
    "current_faculty_id",
    "current_role_name",
    "current_faculty_department",
]


def test_every_policy_hoists_its_accessors():
    """Every scalar accessor call must sit inside a subquery.

    WHY THIS TEST EXISTS, and why it asserts on plan shape rather than on
    source text. The accessors are STABLE, and STABLE does NOT mean hoisted
    -- it licenses the planner to treat the value as fixed within one
    statement and nothing more. A bare call in a qual is re-invoked once PER
    ROW. Only a subquery becomes an InitPlan evaluated once.

    Unwrapped, `SELECT count(*) FROM marks` took 7,712 ms; wrapped, 22 ms.
    On attendance's 150,000 rows the unwrapped form took 54 seconds.

    The failure this guards is silent: one missed `(SELECT ...)` among 26
    hand-edited sites returns the SAME ROWS with the SAME isolation, just
    345x slower. No test of correctness can see it, and nothing in the
    application surfaces it until a table grows.

    PostgreSQL rewrites a hoisted call into `(SubPlan N)` or `$N` in the
    stored qual, so a surviving bare `app.current_<scalar>(` in pg_policies
    is exactly the unwrapped case.
    """
    rows = run_as(ADMIN, """
        SELECT tablename, policyname, qual
          FROM pg_policies
         WHERE schemaname = 'college_erp'
         ORDER BY tablename
    """)
    assert rows, "no policies found -- the guard would pass vacuously"

    offenders = []
    for table, policy, qual in rows:
        for fn in _SCALAR_ACCESSORS:
            for m in re.finditer(rf"app\.{fn}\s*\(", qual or ""):
                # A hoisted call deparses as "( SELECT app.fn() AS fn)", so
                # the call is immediately preceded by "SELECT ". Anything
                # else -- "(student_id = app.fn())" -- is a bare per-row
                # call. Checking mere SUBSTRING PRESENCE would match the
                # wrapped form too and pass vacuously; that mistake was made
                # once while writing this guard.
                before = (qual or "")[:m.start()]
                if not before.rstrip().endswith("SELECT"):
                    offenders.append(f"{table}.{policy}: bare app.{fn}()")
    assert not offenders, (
        "policy accessor(s) not hoisted -- these are re-invoked per row and "
        "will be ~345x slower on a scan, with no functional symptom:\n  "
        + "\n  ".join(offenders))


def test_hoisting_guard_would_catch_an_unwrapped_policy():
    """The guard above must be able to fail.

    Builds a deliberately-unwrapped policy on a scratch table and asserts
    the same predicate the guard uses flags it. Without this, a guard that
    silently matched nothing would pass forever -- the exact shape recorded
    in FINDINGS section 9 as instance 6, where assert_bypasses_rls() was a
    no-op for a day while its tests stayed green.
    """
    priv = get_engine()
    with priv.begin() as c:
        c.exec_driver_sql("DROP TABLE IF EXISTS college_erp.hoist_guard_probe")
        c.exec_driver_sql(
            "CREATE TABLE college_erp.hoist_guard_probe (student_id int)")
        c.exec_driver_sql(
            "ALTER TABLE college_erp.hoist_guard_probe ENABLE ROW LEVEL SECURITY")
        # deliberately NOT wrapped
        c.exec_driver_sql(
            "CREATE POLICY p ON college_erp.hoist_guard_probe FOR SELECT "
            "USING (student_id = app.current_student_id())")
    try:
        qual = run_as(ADMIN, """
            SELECT qual FROM pg_policies
             WHERE schemaname = 'college_erp'
               AND tablename = 'hoist_guard_probe'
        """)[0][0]
        flagged = [
            m for m in re.finditer(r"app\.current_student_id\s*\(", qual)
            if not qual[:m.start()].rstrip().endswith("SELECT")
        ]
        assert flagged, (
            "the guard's predicate did not flag a deliberately unwrapped "
            "policy -- the guard cannot fail and is therefore worthless. "
            f"qual was: {qual}"
        )

        # ...and the same predicate must NOT flag the wrapped form, or the
        # guard would be unsatisfiable rather than merely useless.
        with priv.begin() as c:
            c.exec_driver_sql("DROP POLICY p ON college_erp.hoist_guard_probe")
            c.exec_driver_sql(
                "CREATE POLICY p ON college_erp.hoist_guard_probe FOR SELECT "
                "USING (student_id = (SELECT app.current_student_id()))")
        qual2 = run_as(ADMIN, """
            SELECT qual FROM pg_policies
             WHERE schemaname = 'college_erp'
               AND tablename = 'hoist_guard_probe'
        """)[0][0]
        still = [
            m for m in re.finditer(r"app\.current_student_id\s*\(", qual2)
            if not qual2[:m.start()].rstrip().endswith("SELECT")
        ]
        assert not still, f"guard flags the correctly-wrapped form: {qual2}"
    finally:
        with priv.begin() as c:
            c.exec_driver_sql("DROP TABLE IF EXISTS college_erp.hoist_guard_probe")
