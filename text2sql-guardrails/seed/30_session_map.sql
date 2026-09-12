-- Backend-keyed session identity: the structural control behind Row Level
-- Security in this project. Read eval/FINDINGS.md sections 10-12 first.
--
-- WHY THIS EXISTS AT ALL
--
-- The textbook RLS pattern puts the caller's identity in a session GUC and
-- has policies read it with current_setting(). Generated SQL can rewrite
-- that GUC from inside a plain SELECT -- set_config() is an ordinary
-- VOLATILE function, and nine of ten attack shapes tested bypassed a live
-- policy that way. Using current_user instead is worse, because `role` is
-- itself a writable GUC.
--
-- This table replaces the mutable setting with two values a query cannot
-- forge: its own backend pid, and that backend's start time. Neither is
-- settable from SQL. readonly_app is granted SELECT and nothing else, so a
-- generated query can read the mapping but can never write one.
--
-- WHY (pid, backend_start) AND NOT pid ALONE
--
-- Operating systems recycle process ids. A stale row left behind for pid
-- 12345 would silently grant that identity to whichever unrelated backend
-- next receives pid 12345 -- a wrong-user data leak arriving through
-- normal operation rather than an attack. backend_start disambiguates:
-- two backends may share a pid over time, but not a pid AND a start
-- timestamp. The composite is the primary key so a stale row cannot even
-- collide with a live one.
--
-- expires_at is a second, independent backstop for the same failure: even
-- a row whose (pid, backend_start) somehow matched is ignored once stale.
-- Cleanup is post-request DELETE first, TTL second.

SET search_path TO college_erp;

CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.session_map (
    pid           int         NOT NULL,
    backend_start timestamptz NOT NULL,
    user_id       bigint      NOT NULL,
    role          text        NOT NULL CHECK (role IN ('student', 'faculty', 'admin')),
    student_id    int,
    faculty_id    int,
    created_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    PRIMARY KEY (pid, backend_start)
);

CREATE INDEX IF NOT EXISTS idx_session_map_expiry ON app.session_map (expires_at);

-- The generated query may READ the mapping and nothing else. No INSERT,
-- UPDATE or DELETE: the whole design rests on the executing role being
-- unable to write a row that would grant it another identity.
REVOKE ALL ON app.session_map FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO readonly_app;
GRANT SELECT ON app.session_map TO readonly_app;

-- ---------------------------------------------------------------------------
-- Identity accessors.
--
-- Policies call these rather than repeating the join, so the freshness and
-- backend_start checks live in exactly one place and cannot be got subtly
-- wrong on the eleventh table.
--
-- STABLE, not IMMUTABLE: evaluated once per statement (PostgreSQL folds the
-- call into an InitPlan, measured at loops=1 against a 150k-row table) but
-- never cached across statements.
--
-- SECURITY INVOKER, not DEFINER: the caller already has SELECT on
-- session_map, so there is nothing to elevate, and INVOKER keeps the
-- function from becoming a privilege-escalation surface of its own.
--
-- Each returns NULL when there is no valid mapping. That is what makes the
-- whole design fail closed: a policy written as
--   USING (student_id = app.current_student_id())
-- evaluates to NULL, not TRUE, when identity is unknown -- and a NULL
-- policy result excludes the row. No mapping therefore yields ZERO rows,
-- never all rows, by SQL's own semantics rather than by remembering to
-- write a guard.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.current_session()
RETURNS app.session_map
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
    SELECT s.*
      FROM app.session_map s
     WHERE s.pid = pg_backend_pid()
       AND s.backend_start = (
             SELECT a.backend_start
               FROM pg_stat_activity a
              WHERE a.pid = pg_backend_pid()
           )
       AND s.expires_at > now()
$$;

CREATE OR REPLACE FUNCTION app.current_role_name()
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER
AS $$ SELECT (app.current_session()).role $$;

CREATE OR REPLACE FUNCTION app.current_student_id()
RETURNS int LANGUAGE sql STABLE SECURITY INVOKER
AS $$ SELECT (app.current_session()).student_id $$;

CREATE OR REPLACE FUNCTION app.current_faculty_id()
RETURNS int LANGUAGE sql STABLE SECURITY INVOKER
AS $$ SELECT (app.current_session()).faculty_id $$;

CREATE OR REPLACE FUNCTION app.current_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
AS $$ SELECT COALESCE((app.current_session()).role = 'admin', false) $$;

GRANT EXECUTE ON FUNCTION app.current_session()      TO readonly_app;
GRANT EXECUTE ON FUNCTION app.current_role_name()    TO readonly_app;
GRANT EXECUTE ON FUNCTION app.current_student_id()   TO readonly_app;
GRANT EXECUTE ON FUNCTION app.current_faculty_id()   TO readonly_app;
GRANT EXECUTE ON FUNCTION app.current_is_admin()     TO readonly_app;
