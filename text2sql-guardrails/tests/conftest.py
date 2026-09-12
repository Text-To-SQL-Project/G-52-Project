"""
Shared test setup.

Most of this suite is hermetic, but four tests in test_safety.py and one in
test_llm_provider_contract.py drive app.api.routes.run_query() end to end,
and the ERROR-path case genuinely executes SQL in order to produce a real
database error to redact. Those reach get_readonly_engine().
"""
from __future__ import annotations

import os

import pytest

from app.config import settings
from app.db import get_readonly_engine


@pytest.fixture(scope="session", autouse=True)
def _readonly_url_for_tests():
    """Give the test session a read-only URL if the environment has none.

    app/db.py::get_readonly_engine() now FAILS CLOSED rather than falling
    back to DATABASE_URL, because that fallback silently ran generated SQL
    as the owning superuser in production. That fix is deliberate and is
    covered by its own unit test.

    This fixture is a TEST-ONLY bridge, not a reinstatement of that
    fallback. It exists because the instance the suite runs against on a
    developer host may not have the constrained role provisioned -- that
    role is created by seed/27_readonly_role.sql, which only runs for the
    docker-compose database.

    Set READONLY_TEST_DATABASE_URL to a genuinely constrained role to
    exercise the production shape. Without it the affected tests still
    verify what they are about (that no schema identifier escapes into an
    ERROR response) but do so on a privileged connection, so they prove
    nothing about role separation. Phase 2's isolation tests must NOT rely
    on this bridge: they need a real non-owner, non-BYPASSRLS role, since
    role separation is precisely what they exist to prove.
    """
    if not (settings.READONLY_DATABASE_URL or "").strip():
        settings.READONLY_DATABASE_URL = (
            os.getenv("READONLY_TEST_DATABASE_URL") or settings.DATABASE_URL
        )
        get_readonly_engine.cache_clear()
    yield
