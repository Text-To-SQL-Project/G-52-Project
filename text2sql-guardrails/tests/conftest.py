"""
Shared test setup.

Most of this suite is hermetic, but five tests drive
app.api.routes.run_query() end to end, and the ERROR-path case genuinely
executes SQL in order to produce a real database error to redact. Those
reach get_readonly_engine().
"""
from __future__ import annotations

import os

import pytest

from app.config import settings
from app.db import get_readonly_engine

# Set when the privilege-escalating fallback below actually fired. Read by
# the guard fixture; also asserted directly by tests/test_eval_isolation.py.
INSECURE_FALLBACK_ACTIVE = False

_ISOLATION_MARKER = "isolation"


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        f"{_ISOLATION_MARKER}: proves per-user row isolation. MUST run on a "
        "genuinely constrained DB role; refuses to run if the insecure "
        "read-only fallback in conftest is active.",
    )


@pytest.fixture(scope="session", autouse=True)
def _insecure_readonly_fallback_for_tests():
    """TEST-ONLY privilege escalation. Named to be alarming on purpose.

    app/db.py::get_readonly_engine() FAILS CLOSED rather than falling back
    to DATABASE_URL, because that fallback silently ran generated SQL as
    the owning superuser in production. This fixture reinstates a fallback
    for the test session only, so the five end-to-end tests can run on a
    machine where the constrained role was never provisioned.

    It is a real privilege escalation. When it fires, generated SQL in
    tests executes as whatever DATABASE_URL is, which on a dev host is
    typically a superuser. Anything that depends on role separation is
    therefore meaningless while it is active -- which is exactly why
    tests marked `isolation` refuse to run at all in that state (see
    _reject_isolation_tests_on_a_privileged_connection below).

    To avoid it entirely, set READONLY_DATABASE_URL, or
    READONLY_TEST_DATABASE_URL, to a non-owner, non-BYPASSRLS role. Both
    instances now have `readonly_app` (seed/27_readonly_role.sql), so the
    normal case is that this fixture does nothing at all.
    """
    global INSECURE_FALLBACK_ACTIVE

    if (settings.READONLY_DATABASE_URL or "").strip():
        return  # properly configured; nothing to do

    override = os.getenv("READONLY_TEST_DATABASE_URL")
    if override:
        settings.READONLY_DATABASE_URL = override
        get_readonly_engine.cache_clear()
        return  # an explicit test role, not an escalation

    settings.READONLY_DATABASE_URL = settings.DATABASE_URL
    get_readonly_engine.cache_clear()
    INSECURE_FALLBACK_ACTIVE = True
    import warnings
    warnings.warn(
        "INSECURE TEST FALLBACK ACTIVE: generated SQL in this test session "
        "executes as DATABASE_URL's role, which is usually a superuser. "
        "Role separation and Row Level Security prove nothing in this run. "
        "Set READONLY_DATABASE_URL to a constrained role (readonly_app).",
        RuntimeWarning,
        stacklevel=2,
    )


@pytest.fixture(autouse=True)
def _reject_isolation_tests_on_a_privileged_connection(request):
    """A comment cannot stop misuse; this can.

    An isolation test that silently acquired superuser would pass while
    proving the opposite of what it claims -- a green suite asserting that
    row isolation holds, on a connection no policy can filter. That is a
    worse outcome than no test at all, so the marker hard-fails instead.
    """
    if request.node.get_closest_marker(_ISOLATION_MARKER) is None:
        return
    if INSECURE_FALLBACK_ACTIVE:
        pytest.fail(
            "Isolation test refused: the insecure read-only fallback is "
            "active, so this connection is privileged and Row Level "
            "Security cannot filter it. A pass here would be meaningless. "
            "Set READONLY_DATABASE_URL to a non-owner, non-BYPASSRLS role "
            "(readonly_app) and re-run.",
            pytrace=False,
        )
