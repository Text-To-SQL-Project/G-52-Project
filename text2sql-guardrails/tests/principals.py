"""
Explicit test principals.

app.api.routes.run_query() takes a Principal with NO default, on purpose.
A default would let the five schema-disclosure tests below keep compiling
while silently no longer exercising the real signature -- and those are
precisely the tests that prove no schema identifier escapes in a
CLARIFICATION, REFUSED, BLOCKED or ERROR response. They should break loudly
when the contract changes, then be updated deliberately.

These are plain in-memory objects. Nothing here reads the database, so the
suite stays hermetic; the ids do not correspond to seeded rows and are not
meant to.
"""
from __future__ import annotations

from app.users import Principal

TEST_STUDENT = Principal(
    user_id=9001,
    username="test-student",
    role="student",
    student_id=32,
    faculty_id=None,
)

TEST_FACULTY = Principal(
    user_id=9002,
    username="test-faculty",
    role="faculty",
    student_id=None,
    faculty_id=25,
)

TEST_ADMIN = Principal(
    user_id=9003,
    username="test-admin",
    role="admin",
    student_id=None,
    faculty_id=None,
)
