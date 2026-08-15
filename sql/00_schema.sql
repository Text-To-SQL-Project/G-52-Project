-- ============================================================================
-- COLLEGE ERP DATABASE SCHEMA (PostgreSQL)
-- 25 normalized tables covering Academics, Attendance, Examinations,
-- Fees, Library and Placements modules.
-- ============================================================================

DROP SCHEMA IF EXISTS college_erp CASCADE;
CREATE SCHEMA college_erp;
SET search_path TO college_erp;

-- ============================================================================
-- MODULE 1: CORE / ACADEMIC STRUCTURE
-- ============================================================================

CREATE TABLE departments (
    department_id       SERIAL PRIMARY KEY,
    department_name     VARCHAR(100) NOT NULL,
    department_code     VARCHAR(10)  NOT NULL UNIQUE,
    hod_name             VARCHAR(100),
    established_year    SMALLINT,
    created_at           TIMESTAMP DEFAULT NOW()
);

CREATE TABLE programs (
    program_id           SERIAL PRIMARY KEY,
    department_id         INT NOT NULL REFERENCES departments(department_id) ON DELETE CASCADE,
    program_name          VARCHAR(120) NOT NULL,
    program_code           VARCHAR(15)  NOT NULL UNIQUE,
    degree_type            VARCHAR(20)  NOT NULL CHECK (degree_type IN ('UG','PG','DIPLOMA','PHD')),
    duration_years         SMALLINT NOT NULL,
    total_semesters        SMALLINT NOT NULL,
    created_at             TIMESTAMP DEFAULT NOW()
);

CREATE TABLE academic_years (
    academic_year_id      SERIAL PRIMARY KEY,
    year_name              VARCHAR(9) NOT NULL UNIQUE,          -- e.g. 2023-2024
    start_date              DATE NOT NULL,
    end_date                 DATE NOT NULL,
    is_current               BOOLEAN DEFAULT FALSE
);

CREATE TABLE semesters (
    semester_id            SERIAL PRIMARY KEY,
    academic_year_id       INT NOT NULL REFERENCES academic_years(academic_year_id) ON DELETE CASCADE,
    semester_type           VARCHAR(4) NOT NULL CHECK (semester_type IN ('ODD','EVEN')),
    start_date               DATE NOT NULL,
    end_date                  DATE NOT NULL,
    UNIQUE(academic_year_id, semester_type)
);

-- ============================================================================
-- MODULE 2: STUDENTS & FACULTY
-- ============================================================================

CREATE TABLE students (
    student_id             SERIAL PRIMARY KEY,
    prn_number               VARCHAR(20) NOT NULL UNIQUE,        -- Permanent Registration No.
    roll_number               VARCHAR(20) NOT NULL UNIQUE,
    first_name                 VARCHAR(60)  NOT NULL,
    last_name                   VARCHAR(60)  NOT NULL,
    gender                       VARCHAR(10) NOT NULL CHECK (gender IN ('Male','Female','Other')),
    date_of_birth              DATE NOT NULL,
    email                        VARCHAR(120) NOT NULL UNIQUE,
    phone                        VARCHAR(15)  NOT NULL UNIQUE,
    address                      VARCHAR(200),
    city                          VARCHAR(60),
    state                         VARCHAR(60),
    pincode                      VARCHAR(10),
    blood_group                 VARCHAR(5),
    category                     VARCHAR(10) CHECK (category IN ('GENERAL','OBC','SC','ST','EWS')),
    admission_date              DATE NOT NULL,
    program_id                   INT NOT NULL REFERENCES programs(program_id),
    department_id                INT NOT NULL REFERENCES departments(department_id),
    current_semester            SMALLINT NOT NULL,
    status                        VARCHAR(15) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','GRADUATED','DROPPED','ON_LEAVE')),
    created_at                    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE student_enrollments (
    enrollment_id           SERIAL PRIMARY KEY,
    student_id                 INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    semester_id                 INT NOT NULL REFERENCES semesters(semester_id),
    program_id                   INT NOT NULL REFERENCES programs(program_id),
    semester_number             SMALLINT NOT NULL,
    enrollment_date             DATE NOT NULL,
    status                        VARCHAR(15) NOT NULL DEFAULT 'ENROLLED' CHECK (status IN ('ENROLLED','COMPLETED','BACKLOG')),
    UNIQUE(student_id, semester_id)
);

CREATE TABLE faculty (
    faculty_id               SERIAL PRIMARY KEY,
    employee_code               VARCHAR(20) NOT NULL UNIQUE,
    first_name                   VARCHAR(60) NOT NULL,
    last_name                     VARCHAR(60) NOT NULL,
    gender                         VARCHAR(10) NOT NULL CHECK (gender IN ('Male','Female','Other')),
    email                          VARCHAR(120) NOT NULL UNIQUE,
    phone                          VARCHAR(15)  NOT NULL UNIQUE,
    department_id                  INT NOT NULL REFERENCES departments(department_id),
    designation                    VARCHAR(40) NOT NULL,
    qualification                  VARCHAR(40),
    specialization                 VARCHAR(100),
    date_of_joining                DATE NOT NULL,
    experience_years               SMALLINT,
    salary                          NUMERIC(10,2),
    created_at                      TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- MODULE 3: SUBJECTS & TEACHING ASSIGNMENTS
-- ============================================================================

CREATE TABLE subjects (
    subject_id                SERIAL PRIMARY KEY,
    subject_code                 VARCHAR(15) NOT NULL UNIQUE,
    subject_name                  VARCHAR(120) NOT NULL,
    department_id                  INT NOT NULL REFERENCES departments(department_id),
    credits                        SMALLINT NOT NULL,
    subject_type                   VARCHAR(15) NOT NULL CHECK (subject_type IN ('CORE','ELECTIVE','LAB','PROJECT')),
    semester_number                SMALLINT NOT NULL
);

CREATE TABLE subject_offerings (
    offering_id                SERIAL PRIMARY KEY,
    subject_id                    INT NOT NULL REFERENCES subjects(subject_id) ON DELETE CASCADE,
    program_id                     INT NOT NULL REFERENCES programs(program_id),
    semester_id                     INT NOT NULL REFERENCES semesters(semester_id),
    academic_year_id                INT NOT NULL REFERENCES academic_years(academic_year_id),
    UNIQUE(subject_id, program_id, semester_id)
);

CREATE TABLE faculty_subject_assignments (
    assignment_id               SERIAL PRIMARY KEY,
    faculty_id                     INT NOT NULL REFERENCES faculty(faculty_id) ON DELETE CASCADE,
    offering_id                     INT NOT NULL REFERENCES subject_offerings(offering_id) ON DELETE CASCADE,
    academic_year_id                INT NOT NULL REFERENCES academic_years(academic_year_id),
    UNIQUE(faculty_id, offering_id)
);

-- ============================================================================
-- MODULE 4: SECTIONS / BATCHES
-- ============================================================================

CREATE TABLE sections (
    section_id                  SERIAL PRIMARY KEY,
    program_id                     INT NOT NULL REFERENCES programs(program_id),
    semester_id                     INT NOT NULL REFERENCES semesters(semester_id),
    section_name                     VARCHAR(5) NOT NULL,
    academic_year_id                 INT NOT NULL REFERENCES academic_years(academic_year_id),
    max_students                     SMALLINT DEFAULT 70,
    UNIQUE(program_id, semester_id, section_name, academic_year_id)
);

CREATE TABLE student_section_mapping (
    mapping_id                  SERIAL PRIMARY KEY,
    student_id                     INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    section_id                      INT NOT NULL REFERENCES sections(section_id) ON DELETE CASCADE,
    academic_year_id                 INT NOT NULL REFERENCES academic_years(academic_year_id),
    UNIQUE(student_id, academic_year_id)
);

-- ============================================================================
-- MODULE 5: ATTENDANCE
-- ============================================================================

CREATE TABLE attendance (
    attendance_id               BIGSERIAL PRIMARY KEY,
    student_id                     INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    offering_id                     INT NOT NULL REFERENCES subject_offerings(offering_id) ON DELETE CASCADE,
    faculty_id                      INT NOT NULL REFERENCES faculty(faculty_id),
    semester_id                      INT NOT NULL REFERENCES semesters(semester_id),
    attendance_date                  DATE NOT NULL,
    status                            VARCHAR(10) NOT NULL CHECK (status IN ('PRESENT','ABSENT','LATE')),
    UNIQUE(student_id, offering_id, attendance_date)
);

-- ============================================================================
-- MODULE 6: EXAMINATIONS & MARKS
-- ============================================================================

CREATE TABLE exam_types (
    exam_type_id                SERIAL PRIMARY KEY,
    exam_type_name                  VARCHAR(30) NOT NULL UNIQUE,
    max_marks_default                SMALLINT NOT NULL,
    weightage_percent                 SMALLINT
);

CREATE TABLE exams (
    exam_id                     SERIAL PRIMARY KEY,
    offering_id                     INT NOT NULL REFERENCES subject_offerings(offering_id) ON DELETE CASCADE,
    exam_type_id                     INT NOT NULL REFERENCES exam_types(exam_type_id),
    academic_year_id                  INT NOT NULL REFERENCES academic_years(academic_year_id),
    exam_date                          DATE NOT NULL,
    max_marks                          SMALLINT NOT NULL,
    UNIQUE(offering_id, exam_type_id, academic_year_id)
);

CREATE TABLE marks (
    marks_id                    BIGSERIAL PRIMARY KEY,
    exam_id                        INT NOT NULL REFERENCES exams(exam_id) ON DELETE CASCADE,
    student_id                      INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    marks_obtained                   NUMERIC(6,2) NOT NULL,
    grade                             VARCHAR(3),
    is_pass                            BOOLEAN,
    UNIQUE(exam_id, student_id)
);

-- ============================================================================
-- MODULE 7: FEES
-- ============================================================================

CREATE TABLE fee_categories (
    fee_category_id             SERIAL PRIMARY KEY,
    category_name                    VARCHAR(50) NOT NULL UNIQUE,
    description                       VARCHAR(150)
);

CREATE TABLE fee_structure (
    fee_structure_id            SERIAL PRIMARY KEY,
    program_id                       INT NOT NULL REFERENCES programs(program_id),
    academic_year_id                  INT NOT NULL REFERENCES academic_years(academic_year_id),
    fee_category_id                    INT NOT NULL REFERENCES fee_categories(fee_category_id),
    amount                              NUMERIC(10,2) NOT NULL,
    due_date                             DATE,
    UNIQUE(program_id, academic_year_id, fee_category_id)
);

CREATE TABLE fee_payments (
    payment_id                  SERIAL PRIMARY KEY,
    student_id                       INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    fee_structure_id                  INT NOT NULL REFERENCES fee_structure(fee_structure_id),
    amount_paid                        NUMERIC(10,2) NOT NULL,
    payment_date                        DATE NOT NULL,
    payment_mode                         VARCHAR(20) NOT NULL CHECK (payment_mode IN ('ONLINE','CASH','CHEQUE','DD','UPI')),
    transaction_ref                       VARCHAR(30) NOT NULL UNIQUE,
    status                                 VARCHAR(15) NOT NULL DEFAULT 'SUCCESS' CHECK (status IN ('SUCCESS','PENDING','FAILED','REFUNDED'))
);

-- ============================================================================
-- MODULE 8: LIBRARY
-- ============================================================================

CREATE TABLE library_books (
    book_id                      SERIAL PRIMARY KEY,
    isbn                              VARCHAR(20) NOT NULL UNIQUE,
    title                              VARCHAR(200) NOT NULL,
    author                              VARCHAR(120) NOT NULL,
    publisher                           VARCHAR(120),
    category                             VARCHAR(60),
    total_copies                          SMALLINT NOT NULL,
    available_copies                       SMALLINT NOT NULL,
    price                                   NUMERIC(8,2)
);

CREATE TABLE library_transactions (
    transaction_id               BIGSERIAL PRIMARY KEY,
    book_id                           INT NOT NULL REFERENCES library_books(book_id) ON DELETE CASCADE,
    student_id                         INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    issue_date                          DATE NOT NULL,
    due_date                             DATE NOT NULL,
    return_date                           DATE,
    fine_amount                            NUMERIC(6,2) DEFAULT 0,
    status                                  VARCHAR(15) NOT NULL CHECK (status IN ('ISSUED','RETURNED','OVERDUE','LOST'))
);

-- ============================================================================
-- MODULE 9: PLACEMENTS
-- ============================================================================

CREATE TABLE placement_companies (
    company_id                   SERIAL PRIMARY KEY,
    company_name                      VARCHAR(150) NOT NULL,
    industry                            VARCHAR(80),
    website                              VARCHAR(120),
    hr_contact_name                       VARCHAR(100),
    hr_email                              VARCHAR(120),
    hr_phone                               VARCHAR(15)
);

CREATE TABLE placement_drives (
    drive_id                     SERIAL PRIMARY KEY,
    company_id                        INT NOT NULL REFERENCES placement_companies(company_id) ON DELETE CASCADE,
    academic_year_id                   INT NOT NULL REFERENCES academic_years(academic_year_id),
    drive_date                          DATE NOT NULL,
    job_role                             VARCHAR(100) NOT NULL,
    package_lpa                           NUMERIC(6,2) NOT NULL,
    eligibility_criteria                    VARCHAR(200)
);

CREATE TABLE placement_applications (
    application_id                BIGSERIAL PRIMARY KEY,
    drive_id                           INT NOT NULL REFERENCES placement_drives(drive_id) ON DELETE CASCADE,
    student_id                          INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    application_date                     DATE NOT NULL,
    status                                VARCHAR(15) NOT NULL DEFAULT 'APPLIED' CHECK (status IN ('APPLIED','SHORTLISTED','SELECTED','REJECTED')),
    UNIQUE(drive_id, student_id)
);

CREATE TABLE placement_offers (
    offer_id                     SERIAL PRIMARY KEY,
    application_id                    BIGINT NOT NULL REFERENCES placement_applications(application_id) ON DELETE CASCADE UNIQUE,
    offer_date                          DATE NOT NULL,
    package_lpa                          NUMERIC(6,2) NOT NULL,
    offer_status                          VARCHAR(15) NOT NULL DEFAULT 'PENDING' CHECK (offer_status IN ('ACCEPTED','DECLINED','PENDING'))
);

-- ============================================================================
-- INDEXES for common query patterns
-- ============================================================================
CREATE INDEX idx_students_program ON students(program_id);
CREATE INDEX idx_students_department ON students(department_id);
CREATE INDEX idx_attendance_student ON attendance(student_id);
CREATE INDEX idx_attendance_offering ON attendance(offering_id);
CREATE INDEX idx_attendance_date ON attendance(attendance_date);
CREATE INDEX idx_marks_student ON marks(student_id);
CREATE INDEX idx_marks_exam ON marks(exam_id);
CREATE INDEX idx_fee_payments_student ON fee_payments(student_id);
CREATE INDEX idx_library_txn_student ON library_transactions(student_id);
CREATE INDEX idx_placement_app_student ON placement_applications(student_id);
CREATE INDEX idx_faculty_department ON faculty(department_id);
CREATE INDEX idx_subjects_department ON subjects(department_id);
