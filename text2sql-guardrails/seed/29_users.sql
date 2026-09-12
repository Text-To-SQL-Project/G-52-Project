-- Per-user accounts (Phase 1), replacing the single shared operator
-- password.
--
-- In the `app` schema, not `college_erp`, for the same reason
-- 28_query_history.sql gives: introspect_schema() lists tables via
-- SQLAlchemy's Inspector against current_schema(), which 01_search_path.sql
-- pins to college_erp. A table here therefore cannot surface in the Schema
-- Explorer or reach the LLM's generation prompt as something queryable.
-- Credentials are emphatically not domain data.
SET search_path TO college_erp;

CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.users (
    user_id       BIGSERIAL PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    -- Argon2id PHC string: algorithm, version and parameters travel inside
    -- the encoded hash, so a future parameter change can be verified
    -- against and rehashed without a migration. ~97 chars at the current
    -- settings; TEXT rather than a guessed VARCHAR length.
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('student', 'faculty', 'admin')),
    -- Exactly one of these is populated, enforced below.
    student_id    INT REFERENCES college_erp.students(student_id) ON DELETE RESTRICT,
    faculty_id    INT REFERENCES college_erp.faculty(faculty_id)  ON DELETE RESTRICT,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- The constraint Phase 2 depends on. RLS policies will read student_id
    -- or faculty_id to decide which rows a session may see; a 'student' row
    -- with a NULL student_id would match no rows under one policy shape and
    -- every row under another, and which of those you get would depend on
    -- how carefully each individual policy was written. Making the state
    -- unrepresentable here is cheaper and far more reliable than defending
    -- against it in nine separate policies.
    CONSTRAINT role_link_exclusive CHECK (
        (role = 'student' AND student_id IS NOT NULL AND faculty_id IS NULL)
     OR (role = 'faculty' AND faculty_id IS NOT NULL AND student_id IS NULL)
     OR (role = 'admin'   AND student_id IS NULL     AND faculty_id IS NULL)
    )
);

-- One account per ERP identity. Without these, two student logins could
-- point at the same student_id, which would make "whose rows are these"
-- ambiguous exactly where Phase 2 needs it to be definite.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_student
    ON app.users (student_id) WHERE student_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_faculty
    ON app.users (faculty_id) WHERE faculty_id IS NOT NULL;

-- Login path: username lookups are the hot read.
CREATE INDEX IF NOT EXISTS idx_users_username_active
    ON app.users (username) WHERE is_active;

-- ---------------------------------------------------------------------------
-- query_history gains an owner.
--
-- NULLABLE, and deliberately NOT backfilled. Every existing row was produced
-- under the shared operator password, so no user actually owns it. Assigning
-- one would fabricate audit data in the very table the Admin screen presents
-- as an audit trail -- a worse outcome than an honest NULL. app/history.py
-- shows these legacy rows to admins only, labelled as pre-accounts.
--
-- session_id stays. It still groups one browser's queries, which is a
-- different question from who ran them, and user + session together is more
-- useful for support than either alone.
-- ---------------------------------------------------------------------------
ALTER TABLE app.query_history
    ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES app.users(user_id);

CREATE INDEX IF NOT EXISTS idx_query_history_user
    ON app.query_history (user_id, created_at DESC);

-- readonly_app must NOT be able to read credentials. It is the role generated
-- SQL executes as, so anything it can reach is reachable by a sufficiently
-- creative generated query. It is granted nothing on app.users here, and the
-- app schema's default privileges are not widened.
REVOKE ALL ON app.users FROM PUBLIC;
