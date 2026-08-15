# College ERP — Synthetic Database (PostgreSQL)

A fully normalized 25-table College ERP schema with FK-consistent synthetic
data, verified by actually loading it into a real PostgreSQL 16 instance
(zero constraint violations).

## Contents

| File / Folder | Description |
|---|---|
| `sql/00_schema.sql` | DDL — all 25 tables, PKs, FKs, CHECK constraints, indexes |
| `sql/01_..._25_*.sql` | Batched `INSERT` scripts, one per table, in FK-safe load order (500 rows/statement) |
| `sql/99_load_all.sql` | Master script — runs schema + all inserts in order via `psql \i` |
| `csv/*.csv` | One CSV per table (same 25 tables) |

## Loading into PostgreSQL

```bash
createdb college_erp
psql -d college_erp -f sql/99_load_all.sql
```

Or manually: run `00_schema.sql` first, then the numbered insert files `01`→`25` in order (they respect foreign-key dependencies).

## Schema overview (25 tables, 9 modules)

**Core academic structure:** `departments`, `programs`, `academic_years`, `semesters`
**People:** `students`, `faculty`
**Curriculum:** `subjects`, `subject_offerings`, `faculty_subject_assignments`
**Batches:** `sections`, `student_section_mapping`, `student_enrollments`
**Attendance:** `attendance`
**Examinations:** `exam_types`, `exams`, `marks`
**Fees:** `fee_categories`, `fee_structure`, `fee_payments`
**Library:** `library_books`, `library_transactions`
**Placements:** `placement_companies`, `placement_drives`, `placement_applications`, `placement_offers`

All child tables reference parents via `FOREIGN KEY ... REFERENCES`, with `ON DELETE CASCADE` used where deleting the parent should also clear dependent records (e.g., deleting a student cascades to their attendance, marks, fee payments, library and placement history).

## Row counts generated

| Table | Rows | Table | Rows |
|---|---|---|---|
| departments | 8 | exam_types | 5 |
| programs | 12 | exams | 456 |
| academic_years | 5 | marks | **40,000** |
| semesters | 10 | fee_categories | 5 |
| students | **2,000** | fee_structure | 300 |
| faculty | **100** | fee_payments | **8,000** |
| subjects | **80** | library_books | 3,000 |
| subject_offerings | 130 | library_transactions | 12,000 |
| faculty_subject_assignments | 130 | placement_companies | 150 |
| sections | 48 | placement_drives | 200 |
| student_section_mapping | 2,000 | placement_applications | 5,000 |
| student_enrollments | 9,541 | placement_offers | 749 |
| attendance | **150,000** | | |

## Data generation notes

- Built with Python (`pandas`, `numpy`, `Faker`).
- **Names**: curated pools of ~120 common Indian first names (male/female) and ~60 Indian surnames, combined combinatorially — not Faker's generic locale defaults — for realistic results (e.g. "Deepak Iyer", "Oindrila Roy").
- **Emails**: `firstname.lastname<id>@student.college.edu.in` (students) / `@college.edu.in` (faculty), guaranteed unique.
- **Phones**: realistic 10-digit Indian mobile numbers (`+91` + digit 6-9 + 9 more digits), guaranteed unique.
- **PRN**: `<admission_year><program_code><sequence>` e.g. `2024BTAIDS0001`.
- **Roll number**: `<dept_code><yy><sequence>` e.g. `AIDS24001`.
- Marks are sampled from a normal distribution per exam (mean ≈62% of max marks) so grade/pass-rate distributions look organic rather than uniform-random.
- Attendance status skewed 82% present / 13% absent / 5% late, matching typical real-world attendance patterns.
- All target row counts (150k attendance, 40k marks, 8k fee payments, 2k students, 100 faculty, 80 subjects) were generated then de-duplicated against natural uniqueness constraints (e.g. one attendance record per student/subject/date) and resampled to land exactly on target.

## Integrity verification performed

The full schema + all 25 insert scripts were loaded into a real PostgreSQL 16
database during generation. Results:
- 0 constraint violations across ~230,000 total rows.
- 0 orphaned foreign keys spot-checked across `marks`, `fee_payments`, `library_transactions`, `placement_applications` against `students`.
- All row counts confirmed via `pg_stat_user_tables` after load.
