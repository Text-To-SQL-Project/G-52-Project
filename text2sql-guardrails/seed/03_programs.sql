-- Data for table: college_erp.programs (12 rows)
SET search_path TO college_erp;

INSERT INTO programs (program_id, department_id, program_name, program_code, degree_type, duration_years, total_semesters) VALUES
(1, 1, 'B.Tech Computer Science', 'BTCSE', 'UG', 4, 8),
(2, 2, 'B.Tech Electronics & Communication', 'BTECE', 'UG', 4, 8),
(3, 3, 'B.Tech Mechanical', 'BTMECH', 'UG', 4, 8),
(4, 4, 'B.Tech Civil', 'BTCIVIL', 'UG', 4, 8),
(5, 5, 'B.Tech Electrical', 'BTEE', 'UG', 4, 8),
(6, 6, 'B.Tech Information Technology', 'BTIT', 'UG', 4, 8),
(7, 7, 'B.Tech AI & Data Science', 'BTAIDS', 'UG', 4, 8),
(8, 1, 'M.Tech Computer Science', 'MTCSE', 'PG', 2, 4),
(9, 2, 'M.Tech VLSI Design', 'MTVLSI', 'PG', 2, 4),
(10, 8, 'MBA', 'MBA', 'PG', 2, 4),
(11, 3, 'Diploma in Mechanical', 'DMECH', 'DIPLOMA', 3, 6),
(12, 4, 'Diploma in Civil', 'DCIVIL', 'DIPLOMA', 3, 6);

