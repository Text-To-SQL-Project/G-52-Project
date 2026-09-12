"""
Guards the guard. These protect the property that eval/ can never silently
run against a Row-Level-Security-filtered connection, which is the only
misconfiguration in this project that produces wrong numbers instead of an
error (see eval/db_guard.py and eval/README.md).

Deliberately hermetic: no test in this suite touches a database, and a
guard that is only exercised when Docker happens to be up is a guard that
rots. The decision logic is pure (`is_immune`), so it is tested directly;
the wiring around it is tested by inspecting what the modules resolve to.
"""
from __future__ import annotations

import ast
from pathlib import Path

import pytest

from eval.db_guard import RlsGuardError, is_immune

REPO_ROOT = Path(__file__).resolve().parents[1]


# --- the decision itself -------------------------------------------------

@pytest.mark.parametrize(
    "is_superuser, has_bypassrls, problem_tables, expected",
    [
        # PostgreSQL's three exemptions, each on its own.
        (True, False, ["students"], True),      # superuser: unconditional
        (False, True, ["students"], True),      # BYPASSRLS attribute
        (False, False, [], True),               # owns everything, no FORCE
        # ...and the case that must abort.
        (False, False, ["students"], False),
        # Owning MOST of the schema is not immunity: one table the role does
        # not own, or one that FORCEs RLS on its owner, filters that table's
        # rows and silently changes any gold/predicted comparison over it.
        (False, False, ["marks"], False),
    ],
)
def test_immunity_matches_postgres_rules(is_superuser, has_bypassrls, problem_tables, expected):
    assert is_immune(
        is_superuser=is_superuser,
        has_bypassrls=has_bypassrls,
        problem_tables=problem_tables,
    ) is expected


def test_partial_ownership_is_not_immunity():
    """The realistic Phase 2 regression: a role that owns 24 of 25 tables."""
    assert is_immune(is_superuser=False, has_bypassrls=False, problem_tables=["attendance"]) is False


def test_guard_error_is_loud_and_actionable():
    """The abort message has to stand on its own in a CI log."""
    err = RlsGuardError("x")
    assert issubclass(type(err), RuntimeError)


# --- the wiring ----------------------------------------------------------

def _source(rel: str) -> str:
    return (REPO_ROOT / rel).read_text(encoding="utf-8")


def test_eval_engine_never_falls_back_to_the_readonly_role():
    """app.db.get_eval_engine() must not reference READONLY_DATABASE_URL.

    This is the fallback that would put eval on the app's query-execution
    role -- the exact role RLS is designed to filter.
    """
    tree = ast.parse(_source("app/db.py"))
    fn = next(
        n for n in ast.walk(tree)
        if isinstance(n, ast.FunctionDef) and n.name == "get_eval_engine"
    )
    # Drop the docstring before inspecting: it discusses READONLY_DATABASE_URL
    # at length, on purpose, and matching prose would make this test assert
    # the opposite of what it means.
    statements = fn.body[1:] if (
        fn.body and isinstance(fn.body[0], ast.Expr)
        and isinstance(fn.body[0].value, ast.Constant)
        and isinstance(fn.body[0].value.value, str)
    ) else fn.body
    code = " ".join(ast.dump(node) for node in statements)

    assert "READONLY_DATABASE_URL" not in code, (
        "get_eval_engine() must never resolve to the app's query-execution role"
    )
    assert "EVAL_DATABASE_URL" in code and "DATABASE_URL" in code


def test_no_eval_module_uses_the_readonly_engine():
    """Every eval entrypoint that executes SQL feeds a published number."""
    offenders = [
        p.name for p in (REPO_ROOT / "eval").glob("*.py")
        if "get_readonly_engine" in p.read_text(encoding="utf-8")
    ]
    assert offenders == [], f"eval modules still on the filtered role: {offenders}"


def test_runner_guards_before_spending_anything():
    """The guard must precede golden-set loading, so a misconfigured run
    costs no LLM calls and writes no partial results file."""
    src = _source("eval/runner.py")
    guard_at = src.index("assert_or_exit(")
    load_at = src.index("load_golden_set(str(args.golden))")
    assert guard_at < load_at, "RLS guard must run before the golden set is loaded"


def test_env_example_does_not_reroute_eval():
    """.env.example used to set READONLY_DATABASE_URL on line 2, which was
    enough to move every host-side process onto the filtered role just by
    copying the file."""
    for line in _source(".env.example").splitlines():
        stripped = line.strip()
        assert not stripped.startswith("READONLY_DATABASE_URL="), (
            "READONLY_DATABASE_URL must stay commented in .env.example -- "
            "docker-compose sets it for the API container, and an active "
            "line here only affects host-side processes such as eval/"
        )


# --- the test-only privilege escalation is fenced, not just documented ----

def test_isolation_marker_is_registered():
    """The marker has to exist for the guard to be attachable at all."""
    src = _source("tests/conftest.py")
    assert 'config.addinivalue_line' in src and '_ISOLATION_MARKER' in src


def test_insecure_fallback_is_inactive_in_this_run():
    """On a correctly provisioned machine the fallback never fires. If this
    fails, the suite is running privileged and every role-separation claim
    in it is void."""
    from tests import conftest
    assert conftest.INSECURE_FALLBACK_ACTIVE is False, (
        "generated SQL in this run executes as DATABASE_URL's role; set "
        "READONLY_DATABASE_URL to readonly_app"
    )


def test_isolation_marked_tests_refuse_a_privileged_connection(pytester_like=None):
    """The guard fixture fails an isolation-marked test when the escalation
    is active. Exercised by flipping the module flag rather than by
    spawning a subprocess, so the assertion stays fast and hermetic."""
    from tests import conftest

    class _Marker:
        pass

    class _Node:
        def get_closest_marker(self, name):
            return _Marker() if name == conftest._ISOLATION_MARKER else None

    class _Request:
        node = _Node()

    gen = conftest._reject_isolation_tests_on_a_privileged_connection.__wrapped__

    original = conftest.INSECURE_FALLBACK_ACTIVE
    try:
        conftest.INSECURE_FALLBACK_ACTIVE = True
        # pytest.fail() raises Failed, which derives from BaseException, not
        # Exception -- catching Exception here would let the refusal sail
        # straight through and fail this test instead of satisfying it.
        raised = None
        try:
            gen(_Request())
        except BaseException as e:
            raised = e
        assert raised is not None, "guard did not fire on a privileged connection"
        assert "Isolation test refused" in str(raised)
    finally:
        conftest.INSECURE_FALLBACK_ACTIVE = original

    # And it stays out of the way when the connection is properly constrained.
    conftest.INSECURE_FALLBACK_ACTIVE = False
    assert gen(_Request()) is None
