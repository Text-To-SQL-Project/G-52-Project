-- Column-level restrictions on college_erp.students.
--
-- Row Level Security filters ROWS. It has no column dimension, and column
-- privileges cannot vary by application user here because every request
-- executes as the single role readonly_app. So a column that must never be
-- reachable by a natural-language query has to come out of that role's
-- grants entirely.
--
-- WHY THESE TWO
--
-- After the policies in 31_rls_policies.sql, a student sees only their own
-- row, so nothing about their own record is exposed. A faculty member
-- sees every student in their department -- 311 rows in the seeded data --
-- and that is where these two columns became a problem:
--
--   category     a protected social attribute (SC/ST/OBC/General)
--   blood_group  health data
--
-- Neither has any teaching necessity. Date of birth, address and contact
-- details are deliberately LEFT readable: a faculty member plausibly needs
-- to reach a student, and the line is drawn at protected attributes and
-- health data rather than at "personal" in general.
--
-- faculty contact details stay readable too. A staff directory is a
-- reasonable thing for students to see.
--
-- CONSEQUENCE, stated because it is visible in normal use: `SELECT * FROM
-- students` now fails for the query path, since the wildcard expands to
-- include columns the role cannot read. This is mitigated at the cause --
-- the columns are withheld from the generation prompt (see
-- app/schema/introspect.py::RESTRICTED_COLUMNS), and the prompt instructs
-- the model to list columns explicitly rather than use a wildcard -- so a
-- generated query should not produce it. A hand-written sql_override that
-- does will fail closed with the generic client message, which is the
-- correct outcome.

SET search_path TO college_erp;

REVOKE SELECT ON students FROM readonly_app;
GRANT SELECT (
    student_id, prn_number, roll_number, first_name, last_name, gender,
    date_of_birth, email, phone, address, city, state, pincode,
    admission_date, program_id, department_id, current_semester, status,
    created_at
) ON students TO readonly_app;
