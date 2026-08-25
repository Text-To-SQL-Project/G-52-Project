-- Data for table: college_erp.academic_years (5 rows)
SET search_path TO college_erp;

INSERT INTO academic_years (academic_year_id, year_name, start_date, end_date, is_current) VALUES
(1, '2021-2022', '2021-07-01', '2022-05-31', FALSE),
(2, '2022-2023', '2022-07-01', '2023-05-31', FALSE),
(3, '2023-2024', '2023-07-01', '2024-05-31', FALSE),
(4, '2024-2025', '2024-07-01', '2025-05-31', FALSE),
(5, '2025-2026', '2025-07-01', '2026-05-31', TRUE);

