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
-- valid mapping, so `student_id = (SELECT app.current_student_id())`
-- evaluates to NULL, not TRUE, and the row is excluded. An unbound session
-- sees zero rows everywhere, without a guard clause anyone could forget.
--
-- EVERY SCALAR ACCESSOR CALL BELOW IS WRAPPED IN `(SELECT ...)`. THIS IS
-- LOAD-BEARING FOR PERFORMANCE AND MUST NOT BE "SIMPLIFIED" AWAY.
--
-- The accessors are STABLE, but STABLE does NOT mean hoisted: it licenses
-- the planner to treat the value as fixed within one statement, and
-- nothing more. PostgreSQL re-invokes a bare function call in a qual once
-- PER ROW. Only a SUBQUERY becomes an InitPlan evaluated once. Wrapping
-- the call converts `Filter: (... app.current_session() ...)` into
-- `InitPlan` + `Filter: ($0 OR (student_id = $1))`, comparing against
-- constants.
--
-- Measured on 40,000 rows: 7,712 ms unwrapped against 22 ms wrapped, a
-- 345x difference; on attendance's 150,000 rows the unwrapped form took
-- 54 seconds. The cost is per row, so it is invisible on the small result
-- sets a request normally touches and severe on any scan. See
-- eval/FINDINGS.md section 17.
--
-- tests/test_rls_policies.py::test_every_policy_hoists_its_accessors fails
-- if any site here is unwrapped. One missed wrap reverts that policy to
-- the slow path with NO functional symptom -- same rows, same isolation,
-- silently 345x slower.
--
-- The set-returning accessors (current_faculty_offerings,
-- current_faculty_taught_students) are deliberately NOT wrapped: they
-- already sit in the FROM of a subquery and are already hoisted as a
-- hashed SubPlan.
--
-- Semantics are unchanged. Evaluating once per statement is correct
-- because identity is keyed on (pid, backend_start), both fixed for the
-- life of the backend, so it cannot change mid-statement -- the same fact
-- that justifies STABLE in the first place.
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
-- Helpers: the querying faculty member's TEACHING relation.
--
-- Two accessors, both SECURITY DEFINER for the same reason as
-- current_faculty_department() above: they read tables that carry their own
-- policies (faculty_subject_assignments) or that are the very table being
-- filtered (marks), and a policy cannot evaluate a policy on the table it is
-- protecting without PostgreSQL rejecting it as recursive.
--
-- Elevating also buys independence. If faculty_subject_assignments' own
-- policy is ever narrowed, a non-DEFINER version of this lookup would
-- silently narrow what faculty can see in marks -- a policy changing meaning
-- because a DIFFERENT table's policy changed, which is exactly the kind of
-- action-at-a-distance that stays invisible until someone notices missing
-- rows. DEFINER pins the relation to the schema, not to another policy.
--
-- Both take NO ARGUMENTS and return sets derived solely from the session
-- map. That is deliberate: a function taking a student_id would be a boolean
-- oracle a caller could steer ("do you teach student 87?"), and generated SQL
-- is attacker-influenced input. With no argument there is nothing to steer.
-- search_path is pinned so the elevated bodies cannot be redirected.
--
-- Both return the empty set when current_faculty_id() is NULL, so a student
-- or an unbound session matches nothing -- fail-closed, same as every other
-- accessor here.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.current_faculty_offerings()
RETURNS TABLE (offering_id int)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = college_erp, pg_temp
AS $fn$
    SELECT fsa.offering_id
      FROM college_erp.faculty_subject_assignments fsa
     WHERE fsa.faculty_id = app.current_faculty_id()
$fn$;

GRANT EXECUTE ON FUNCTION app.current_faculty_offerings() TO readonly_app;

-- The students this faculty member has actually assessed in an offering they
-- teach. This is the closest thing the schema offers to "my students":
-- student_enrollments records enrolment in a PROGRAMME and SEMESTER and
-- carries no offering_id, so there is no edge from a teaching assignment to
-- an enrolled student. Marks are the only evidence that a specific student
-- sat in a specific offering.
--
-- Consequence, accepted: a student a faculty member teaches but has not yet
-- examined is not visible to them. That errs closed, which is the direction
-- to err, but it means this set grows as assessment happens rather than at
-- enrolment time.
CREATE OR REPLACE FUNCTION app.current_faculty_taught_students()
RETURNS TABLE (student_id int)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = college_erp, pg_temp
AS $fn$
    SELECT DISTINCT m.student_id
      FROM college_erp.marks m
      JOIN college_erp.exams e ON e.exam_id = m.exam_id
     WHERE e.offering_id IN (SELECT o.offering_id
                               FROM app.current_faculty_offerings() o)
$fn$;

GRANT EXECUTE ON FUNCTION app.current_faculty_taught_students() TO readonly_app;


-- ---------------------------------------------------------------------------
-- 1. students -- own row; a faculty member sees their own department;
--    admin sees all.
-- ---------------------------------------------------------------------------
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_students_scope ON students;
DROP POLICY IF EXISTS rls_students ON students;
CREATE POLICY rls_students ON students FOR SELECT USING (
    (SELECT app.current_is_admin())
 OR student_id    = (SELECT app.current_student_id())
 OR department_id = (SELECT app.current_faculty_department())
);

-- ---------------------------------------------------------------------------
-- 2. attendance -- own rows; the faculty member who recorded them.
-- ---------------------------------------------------------------------------
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_attendance ON attendance;
CREATE POLICY rls_attendance ON attendance FOR SELECT USING (
    (SELECT app.current_is_admin())
 OR student_id = (SELECT app.current_student_id())
 OR faculty_id = (SELECT app.current_faculty_id())
);

-- ---------------------------------------------------------------------------
-- 3-8. The student's own record. Four of these stay strictly own-rows;
--      marks and student_section_mapping additionally admit the faculty
--      member who TEACHES the row, per the faculty scope principle in
--      docs/SECURITY_MODEL.md.
--
--      Closed to faculty, deliberately: fee_payments, library_transactions,
--      placement_applications (and placement_offers below). Financial and
--      placement records have no teaching relevance, so no teaching relation
--      grants them.
--
--      Closed to faculty, also deliberately but for a different reason:
--      student_enrollments. See its own note below.
-- ---------------------------------------------------------------------------
ALTER TABLE marks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_marks ON marks;
-- marks: scoped PER MARK, not per student. The faculty branch asks whether
-- THIS mark's exam belongs to an offering the querying faculty member
-- teaches -- so a lecturer sees the marks they are responsible for, and not
-- the rest of that same student's transcript in subjects they do not teach.
-- exams carries no policy of its own, so this EXISTS reads it unfiltered.
CREATE POLICY rls_marks ON marks FOR SELECT USING (
    (SELECT app.current_is_admin())
    OR student_id = (SELECT app.current_student_id())
    OR EXISTS (
        SELECT 1
          FROM exams e
         WHERE e.exam_id = marks.exam_id
           AND e.offering_id IN (SELECT o.offering_id
                                   FROM app.current_faculty_offerings() o)
    )
);

ALTER TABLE fee_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_fee_payments ON fee_payments;
CREATE POLICY rls_fee_payments ON fee_payments FOR SELECT USING (
    (SELECT app.current_is_admin()) OR student_id = (SELECT app.current_student_id())
);

ALTER TABLE library_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_library_transactions ON library_transactions;
CREATE POLICY rls_library_transactions ON library_transactions FOR SELECT USING (
    (SELECT app.current_is_admin()) OR student_id = (SELECT app.current_student_id())
);

ALTER TABLE placement_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_placement_applications ON placement_applications;
CREATE POLICY rls_placement_applications ON placement_applications FOR SELECT USING (
    (SELECT app.current_is_admin()) OR student_id = (SELECT app.current_student_id())
);

-- student_enrollments: DELIBERATELY CLOSED TO FACULTY, and the reasoning is
-- the point. Two independent grounds.
--
-- First, the schema cannot express a teaching relation here. The table
-- records enrolment in a programme and semester with no offering_id, so
-- there is no edge from a teaching assignment to an enrolment row. The only
-- available predicates were department or programme, neither of which is a
-- teaching relation.
--
-- Second, and decisively: the realistic faculty question against this table
-- is an institution-wide aggregate ("how many students enrolled in each
-- academic year?"). Under ANY scoped policy that query returns a smaller
-- number with nothing marking it partial -- a plausible wrong answer.
-- Closed, it returns zero rows, which is an obviously wrong answer. A loud
-- wrong answer beats a quiet one, and result_sanity can catch an empty
-- result but cannot catch a silently-narrowed count.
ALTER TABLE student_enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_student_enrollments ON student_enrollments;
CREATE POLICY rls_student_enrollments ON student_enrollments FOR SELECT USING (
    (SELECT app.current_is_admin()) OR student_id = (SELECT app.current_student_id())
);

ALTER TABLE student_section_mapping ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_student_section_mapping ON student_section_mapping;
-- student_section_mapping: section membership for the students this faculty
-- member actually teaches. Scoped per STUDENT rather than per row, because a
-- section mapping has no offering to attach a teaching relation to.
--
-- sections carries no faculty link at all -- no faculty_id, and nothing
-- references it but this table -- so "sections I teach" is not expressible.
-- The cohort reading (sections matching my offerings' programme, semester
-- and year) was measured and rejected: it admits students in the cohort I do
-- not teach, which is a wider relation wearing a narrower name.
CREATE POLICY rls_student_section_mapping ON student_section_mapping FOR SELECT USING (
    (SELECT app.current_is_admin())
    OR student_id = (SELECT app.current_student_id())
    OR student_id IN (SELECT t.student_id
                        FROM app.current_faculty_taught_students() t)
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
    (SELECT app.current_is_admin())
 OR EXISTS (
        SELECT 1
          FROM placement_applications pa
         WHERE pa.application_id = placement_offers.application_id
           AND pa.student_id = (SELECT app.current_student_id())
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
    (SELECT app.current_is_admin())
 OR faculty_id = (SELECT app.current_faculty_id())
 OR (SELECT app.current_role_name()) IS NOT NULL
);

-- ---------------------------------------------------------------------------
-- 11. faculty_subject_assignments -- who teaches what. Teaching allocation
--     is not personal data; visible to any bound session, and invisible
--     without one.
-- ---------------------------------------------------------------------------
ALTER TABLE faculty_subject_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_faculty_subject_assignments ON faculty_subject_assignments;
CREATE POLICY rls_faculty_subject_assignments ON faculty_subject_assignments FOR SELECT USING (
    (SELECT app.current_is_admin())
 OR faculty_id = (SELECT app.current_faculty_id())
 OR (SELECT app.current_role_name()) IS NOT NULL
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
