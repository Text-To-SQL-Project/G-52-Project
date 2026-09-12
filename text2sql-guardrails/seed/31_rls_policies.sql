-- W3: Row Level Security policies.
--
-- EVERY policy below resolves identity through the app.current_* accessors
-- from 30_session_map.sql, which read (pid, backend_start) from
-- app.session_map. NOT ONE reads current_setting(). That is the whole
-- point: a session GUC is writable from inside a plain SELECT (findings
-- section 10), and a backend's pid and start time are not (section 12).
--
-- If you add a table here, use the accessors. A single policy written the
-- old way would reopen the attack surface for that table alone and would
-- be invisible until exploited -- which is why tests/test_rls_policies.py
-- asserts, per table, that no policy expression contains current_setting.
--
-- FAIL-CLOSED BY CONSTRUCTION. The accessors return NULL when there is no
-- valid mapping, so `student_id = app.current_student_id()` evaluates to
-- NULL, not TRUE, and the row is excluded. An unbound session sees zero
-- rows everywhere, without a guard clause anyone could forget.
--
-- FORCE ROW LEVEL SECURITY is deliberately NOT set. `app` owns these
-- tables and is used only for introspection, history and the session map --
-- never to execute generated SQL. Generated SQL runs as readonly_app,
-- which owns nothing and is therefore subject to every policy here.

SET search_path TO college_erp;

-- ---------------------------------------------------------------------------
-- Helper: the querying faculty member's department.
--
-- SECURITY DEFINER on purpose, and it is the only one. It reads
-- college_erp.faculty, which itself carries a policy; without DEFINER the
-- students policy would trigger that policy while evaluating, which
-- PostgreSQL rejects as recursive. DEFINER runs it as the owner, which
-- bypasses RLS for this one lookup.
--
-- Safe to elevate because it takes no arguments, returns a single integer
-- derived solely from the session map, and exposes nothing a caller could
-- steer. search_path is pinned so the elevated body cannot be redirected
-- at a different `faculty` table by a caller-controlled search_path.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.current_faculty_department()
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = college_erp, pg_temp
AS $$
    SELECT f.department_id
      FROM college_erp.faculty f
     WHERE f.faculty_id = app.current_faculty_id()
$$;

GRANT EXECUTE ON FUNCTION app.current_faculty_department() TO readonly_app;

-- ---------------------------------------------------------------------------
-- 1. students -- own row; a faculty member sees their own department;
--    admin sees all.
-- ---------------------------------------------------------------------------
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_students ON students;
CREATE POLICY rls_students ON students FOR SELECT USING (
    app.current_is_admin()
 OR student_id    = app.current_student_id()
 OR department_id = app.current_faculty_department()
);

-- ---------------------------------------------------------------------------
-- 2. attendance -- own rows; the faculty member who recorded them.
-- ---------------------------------------------------------------------------
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_attendance ON attendance;
CREATE POLICY rls_attendance ON attendance FOR SELECT USING (
    app.current_is_admin()
 OR student_id = app.current_student_id()
 OR faculty_id = app.current_faculty_id()
);

-- ---------------------------------------------------------------------------
-- 3-8. Strictly own rows. No faculty access: marks, fees, library loans,
--      enrolments and section membership are the student's own record, and
--      widening any of them is a product decision, not a schema one.
-- ---------------------------------------------------------------------------
ALTER TABLE marks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_marks ON marks;
CREATE POLICY rls_marks ON marks FOR SELECT USING (
    app.current_is_admin() OR student_id = app.current_student_id()
);

ALTER TABLE fee_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_fee_payments ON fee_payments;
CREATE POLICY rls_fee_payments ON fee_payments FOR SELECT USING (
    app.current_is_admin() OR student_id = app.current_student_id()
);

ALTER TABLE library_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_library_transactions ON library_transactions;
CREATE POLICY rls_library_transactions ON library_transactions FOR SELECT USING (
    app.current_is_admin() OR student_id = app.current_student_id()
);

ALTER TABLE placement_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_placement_applications ON placement_applications;
CREATE POLICY rls_placement_applications ON placement_applications FOR SELECT USING (
    app.current_is_admin() OR student_id = app.current_student_id()
);

ALTER TABLE student_enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_student_enrollments ON student_enrollments;
CREATE POLICY rls_student_enrollments ON student_enrollments FOR SELECT USING (
    app.current_is_admin() OR student_id = app.current_student_id()
);

ALTER TABLE student_section_mapping ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_student_section_mapping ON student_section_mapping;
CREATE POLICY rls_student_section_mapping ON student_section_mapping FOR SELECT USING (
    app.current_is_admin() OR student_id = app.current_student_id()
);

-- ---------------------------------------------------------------------------
-- 9. placement_offers -- no student_id column; reached through the
--    application it belongs to.
--
--    The EXISTS runs against placement_applications, which carries its own
--    policy. That is not a problem and is in fact the neat part: the inner
--    lookup is itself filtered, so the offer is visible exactly when the
--    owning application is. Two different tables, so no recursion.
-- ---------------------------------------------------------------------------
ALTER TABLE placement_offers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_placement_offers ON placement_offers;
CREATE POLICY rls_placement_offers ON placement_offers FOR SELECT USING (
    app.current_is_admin()
 OR EXISTS (
        SELECT 1
          FROM placement_applications pa
         WHERE pa.application_id = placement_offers.application_id
           AND pa.student_id = app.current_student_id()
    )
);

-- ---------------------------------------------------------------------------
-- 10. faculty -- a staff directory, readable by any BOUND session.
--
--     The policy looks permissive and still earns its place: an UNBOUND
--     session (no map row, expired row, or a recycled pid) gets NULL from
--     current_role_name(), so `IS NOT NULL` is false and the directory is
--     invisible. Fail-closed applies here too.
--
--     salary is handled separately, below, because RLS filters rows and not
--     columns.
-- ---------------------------------------------------------------------------
ALTER TABLE faculty ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_faculty ON faculty;
CREATE POLICY rls_faculty ON faculty FOR SELECT USING (
    app.current_is_admin()
 OR faculty_id = app.current_faculty_id()
 OR app.current_role_name() IS NOT NULL
);

-- ---------------------------------------------------------------------------
-- 11. faculty_subject_assignments -- who teaches what. Teaching allocation
--     is not personal data; visible to any bound session, and invisible
--     without one.
-- ---------------------------------------------------------------------------
ALTER TABLE faculty_subject_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_faculty_subject_assignments ON faculty_subject_assignments;
CREATE POLICY rls_faculty_subject_assignments ON faculty_subject_assignments FOR SELECT USING (
    app.current_is_admin()
 OR faculty_id = app.current_faculty_id()
 OR app.current_role_name() IS NOT NULL
);

-- ---------------------------------------------------------------------------
-- Column-level: faculty.salary.
--
-- RLS filters ROWS. It cannot hide a column, and column privileges cannot
-- vary by row or by application user, because every request executes as the
-- single role readonly_app. So salary is removed from the text-to-SQL path
-- entirely, for everyone including admins.
--
-- That is a deliberate product decision, not a limitation being worked
-- around: salary has no business being reachable by a natural-language
-- query over a student information system. An administrator who needs it
-- reads it through the admin path, which uses the owning connection.
-- ---------------------------------------------------------------------------
REVOKE SELECT ON faculty FROM readonly_app;
GRANT SELECT (
    faculty_id, employee_code, first_name, last_name, gender, email, phone,
    department_id, designation, qualification, specialization,
    date_of_joining, experience_years, created_at
) ON faculty TO readonly_app;
