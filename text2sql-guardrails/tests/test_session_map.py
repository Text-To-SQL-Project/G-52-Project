"""
The backend-keyed session map: the structural control behind RLS.

These tests need a real PostgreSQL and a genuinely constrained role, so
they carry the `isolation` marker and will refuse to run if the insecure
test fallback in conftest is active. A pass on a privileged connection
would prove nothing, which is the whole reason that marker exists.

The probe schema below is created and dropped per module. It exists
because the real policies do not land until W3, and these properties --
pid reuse, fail-closed on unknown identity, safety of a failed delete --
have to be proven against a live policy, not asserted about one.
"""
from __future__ import annotations

import datetime as dt

import pytest
from sqlalchemy import text

from app.db import get_engine, get_readonly_engine
from app.safety.session_scope import (
    SessionBindingError,
    bind_session,
    read_backend_identity,
    release_session,
)
from app.users import Principal

pytestmark = pytest.mark.isolation

STUDENT_A = Principal(user_id=901, username="a", role="student", student_id=32, faculty_id=None)
STUDENT_B = Principal(user_id=902, username="b", role="student", student_id=87, faculty_id=None)

# Unequal row counts, deliberately. A probe where both principals own the
# same number of rows once let a total data leak read as "no leak" because
# the assertion compared cardinality. See findings section 10.
A_IDS, B_IDS = {1, 2}, {3, 4, 5}


@pytest.fixture(scope="module", autouse=True)
def probe_schema():
    priv = get_engine()
    with priv.begin() as c:
        c.execute(text("DROP SCHEMA IF EXISTS maptest CASCADE"))
        c.execute(text("CREATE SCHEMA maptest"))
        c.execute(text("CREATE TABLE maptest.marks (id int, student_id int, score int)"))
        c.execute(text(
            "INSERT INTO maptest.marks VALUES "
            "(1,32,10),(2,32,20),(3,87,91),(4,87,92),(5,87,93),(6,3,50)"
        ))
        c.execute(text("GRANT USAGE ON SCHEMA maptest TO readonly_app"))
        c.execute(text("GRANT SELECT ON maptest.marks TO readonly_app"))
        c.execute(text("ALTER TABLE maptest.marks ENABLE ROW LEVEL SECURITY"))
        # The policy shape W3 will use: identity from the map, never a GUC.
        c.execute(text(
            "CREATE POLICY p ON maptest.marks FOR SELECT "
            "USING (app.current_is_admin() OR student_id = app.current_student_id())"
        ))
    yield
    with priv.begin() as c:
        c.execute(text("DROP SCHEMA IF EXISTS maptest CASCADE"))


def _visible_ids(bind_as: Principal | None) -> set[int]:
    """Run the probe query as `bind_as`, or with no mapping at all."""
    priv, ro = get_engine(), get_readonly_engine()
    with ro.begin() as conn:
        pid, backend_start = read_backend_identity(conn)
        try:
            if bind_as is not None:
                bind_session(priv, pid=pid, backend_start=backend_start, principal=bind_as)
            rows = conn.execute(text("SELECT id FROM maptest.marks")).scalars().all()
        finally:
            release_session(priv, pid=pid, backend_start=backend_start)
    return set(rows)


# --- the control works -----------------------------------------------------

def test_each_principal_sees_only_their_own_rows():
    assert _visible_ids(STUDENT_A) == A_IDS
    assert _visible_ids(STUDENT_B) == B_IDS


def test_no_mapping_yields_zero_rows_not_all_rows():
    """The fail-closed property, and the reason the accessors return NULL
    rather than a sentinel: `student_id = NULL` is NULL, not TRUE, so the
    policy excludes every row without anyone having to remember a guard."""
    assert _visible_ids(None) == set()


def test_set_config_cannot_influence_the_map_based_policy():
    """The attack that defeated the GUC design is inert here. pid and
    backend_start are not settable from SQL."""
    priv, ro = get_engine(), get_readonly_engine()
    with ro.begin() as conn:
        pid, backend_start = read_backend_identity(conn)
        try:
            bind_session(priv, pid=pid, backend_start=backend_start, principal=STUDENT_A)
            conn.execute(text("SELECT set_config('app.student_id','87',true)"))
            conn.execute(text("SELECT set_config('app.role','admin',true)"))
            seen = set(conn.execute(text("SELECT id FROM maptest.marks")).scalars().all())
        finally:
            release_session(priv, pid=pid, backend_start=backend_start)
    assert seen == A_IDS, f"GUC tampering changed visibility: {seen}"


def test_the_executing_role_cannot_write_the_map():
    """If it could, it could grant itself any identity and the control
    would be decorative."""
    ro = get_readonly_engine()
    for sql in (
        "INSERT INTO app.session_map (pid, backend_start, user_id, role, expires_at) "
        "VALUES (1, now(), 1, 'admin', now() + interval '1 hour')",
        "UPDATE app.session_map SET role = 'admin'",
        "DELETE FROM app.session_map",
    ):
        with ro.connect() as conn:
            with pytest.raises(Exception):
                conn.execute(text(sql))
            conn.rollback()


# --- pid reuse -------------------------------------------------------------

def test_recycled_pid_with_a_stale_row_is_rejected():
    """THE failure mode this composite key exists for.

    Simulates the operating system handing our backend a pid that a
    previous, unrelated process used: a row exists for this exact pid, but
    carries a different backend_start. Keying on pid alone would hand this
    backend that stale identity. The composite key must not match it.
    """
    priv, ro = get_engine(), get_readonly_engine()
    with ro.begin() as conn:
        pid, backend_start = read_backend_identity(conn)
        stale_start = backend_start - dt.timedelta(days=1)
        try:
            # A stale row for the SAME pid, a DIFFERENT backend, granting
            # student B's identity.
            bind_session(priv, pid=pid, backend_start=stale_start, principal=STUDENT_B)
            seen = set(conn.execute(text("SELECT id FROM maptest.marks")).scalars().all())
            assert seen == set(), (
                f"stale row for a recycled pid granted an identity: saw {seen}"
            )

            # And with the correct row present, the stale one must not add to it.
            bind_session(priv, pid=pid, backend_start=backend_start, principal=STUDENT_A)
            seen = set(conn.execute(text("SELECT id FROM maptest.marks")).scalars().all())
            assert seen == A_IDS, f"stale row contaminated a live session: {seen}"
        finally:
            release_session(priv, pid=pid, backend_start=stale_start)
            release_session(priv, pid=pid, backend_start=backend_start)


def test_a_failed_delete_leaves_nothing_another_backend_can_use():
    """Proves the claim in release_session()'s docstring.

    A leftover row is reachable only by the exact backend it was written
    for. Simulated by writing a row for a pid/backend_start pair that is
    not ours and never deleting it, then confirming our own session is
    unaffected -- and that binding our real identity afterwards still
    yields only our rows.
    """
    priv, ro = get_engine(), get_readonly_engine()
    orphan_pid, orphan_start = 999_999, dt.datetime.now(dt.timezone.utc)
    bind_session(priv, pid=orphan_pid, backend_start=orphan_start, principal=STUDENT_B)
    try:
        assert _visible_ids(STUDENT_A) == A_IDS
        assert _visible_ids(None) == set()
        with priv.connect() as c:
            still_there = c.execute(
                text("SELECT count(*) FROM app.session_map WHERE pid = :p"),
                {"p": orphan_pid},
            ).scalar()
        assert still_there == 1, "precondition: the orphan row should still exist"
    finally:
        release_session(priv, pid=orphan_pid, backend_start=orphan_start)


def test_expired_mapping_stops_granting_identity():
    """The TTL backstop, independent of the composite key."""
    priv, ro = get_engine(), get_readonly_engine()
    with ro.begin() as conn:
        pid, backend_start = read_backend_identity(conn)
        try:
            bind_session(
                priv, pid=pid, backend_start=backend_start,
                principal=STUDENT_A, ttl_seconds=-1,   # already expired
            )
            seen = set(conn.execute(text("SELECT id FROM maptest.marks")).scalars().all())
            assert seen == set(), f"expired mapping still granted identity: {seen}"
        finally:
            release_session(priv, pid=pid, backend_start=backend_start)


# --- fail closed -----------------------------------------------------------

def test_bind_failure_raises_rather_than_continuing():
    """An unwritable map must abort the request, never let it run
    unscoped. A broken engine stands in for a database that refuses the
    write."""
    class _Broken:
        def begin(self):
            raise RuntimeError("simulated outage")

    with pytest.raises(SessionBindingError):
        bind_session(_Broken(), pid=1, backend_start=dt.datetime.now(dt.timezone.utc),
                     principal=STUDENT_A)


def test_unreadable_backend_identity_raises():
    """Without backend_start the mapping would fall back to pid alone,
    which is the recycled-pid hole. It must refuse instead."""
    class _Conn:
        def execute(self, *_a, **_k):
            class _R:
                def mappings(self_inner):
                    class _M:
                        def one_or_none(self_m):
                            return {"pid": 123, "backend_start": None}
                    return _M()
            return _R()

    with pytest.raises(SessionBindingError):
        read_backend_identity(_Conn())


# --- the eval guard, end to end -------------------------------------------

def test_eval_guard_actually_aborts_on_a_constrained_role():
    """Behavioural, not structural.

    The existing guard tests exercise is_immune() directly and inspect
    source text. Both passed while assert_bypasses_rls() was returning
    early for EVERY connection, because it called
    is_immune(..., problem_tables=[]) as a shorthand for "superuser or
    bypassrls" -- and an empty problem list means ownership-based immunity,
    so the call was unconditionally True.

    The guard was therefore a no-op from d1a89eb until it was fixed. That
    is a fifth instance of this project's recurring pattern: a check that
    passed for the wrong reason, caught only by asking what it DOES rather
    than what it says. This test asks what it does.
    """
    from eval.db_guard import RlsGuardError, assert_bypasses_rls

    constrained = get_readonly_engine()   # readonly_app: no superuser, no BYPASSRLS
    with pytest.raises(RlsGuardError) as exc:
        assert_bypasses_rls(constrained)
    assert "readonly_app" in str(exc.value)


def test_eval_guard_admits_the_real_eval_connection():
    """The other direction: the fix must not have made it refuse
    everything, which would be equally useless and far more visible."""
    from app.db import get_eval_engine
    from eval.db_guard import assert_bypasses_rls

    info = assert_bypasses_rls(get_eval_engine())
    assert info["is_superuser"] or info["has_bypassrls"]
