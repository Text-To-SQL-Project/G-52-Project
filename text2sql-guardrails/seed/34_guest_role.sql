-- Open Google sign-up (POST /auth/google): a Google account that isn't
-- linked to an existing user gets a new 'guest' account instead of a 403.
--
-- A guest has no student_id and no faculty_id, and is not an admin. Every
-- RLS policy in 31_rls_policies.sql matches only "is admin", "my student_id"
-- or "my faculty_id / department", each of which is NULL for a guest, so the
-- 11 personal-data tables (students, attendance, marks, fees, ...) return no
-- rows at all. Guests see only the reference tables (departments, programs,
-- subjects, exams, library_books, placement companies/drives, ...).
-- No policy changes are needed; this migration only admits the role.

ALTER TABLE app.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE app.users ADD CONSTRAINT users_role_check
    CHECK (role IN ('student', 'faculty', 'admin', 'guest'));

ALTER TABLE app.users DROP CONSTRAINT IF EXISTS role_link_exclusive;
ALTER TABLE app.users ADD CONSTRAINT role_link_exclusive CHECK (
    (role = 'student' AND student_id IS NOT NULL AND faculty_id IS NULL)
 OR (role = 'faculty' AND faculty_id IS NOT NULL AND student_id IS NULL)
 OR (role IN ('admin', 'guest') AND student_id IS NULL AND faculty_id IS NULL)
);

ALTER TABLE app.session_map DROP CONSTRAINT IF EXISTS session_map_role_check;
ALTER TABLE app.session_map ADD CONSTRAINT session_map_role_check
    CHECK (role IN ('student', 'faculty', 'admin', 'guest'));

-- Exception found by testing: the faculty directory (31_rls_policies.sql
-- section 10) was visible to ANY bound session, which was safe while every
-- user was an admin-created college member. With open sign-up "any bound
-- session" includes anyone with a Gmail account, and the directory carries
-- staff email and phone. Guests are excluded; college roles keep it.
-- (faculty_subject_assignments stays visible: course-to-teacher ids only,
-- classified non-personal there, and the names now sit behind this policy.)
DROP POLICY IF EXISTS rls_faculty ON college_erp.faculty;
CREATE POLICY rls_faculty ON college_erp.faculty FOR SELECT USING (
    (SELECT app.current_is_admin())
 OR faculty_id = (SELECT app.current_faculty_id())
 OR (SELECT app.current_role_name()) IN ('student', 'faculty')
);
