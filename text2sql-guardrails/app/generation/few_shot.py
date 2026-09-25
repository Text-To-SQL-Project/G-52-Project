"""
Few-shot examples for the SQL generation prompt, over the real college_erp
schema. Each pair below was executed against the live database and
confirmed to run and return rows before being saved here (see the verified
row counts in the commit/PR description or chat history for this change).
"""
from __future__ import annotations

FEW_SHOT_EXAMPLES: list[dict[str, str]] = [
    {
        "question": "Which departments have the most students?",
        "sql": (
            "SELECT d.department_name, COUNT(*) AS student_count\n"
            "FROM students s\n"
            "JOIN departments d ON s.department_id = d.department_id\n"
            "GROUP BY d.department_name\n"
            "ORDER BY student_count DESC\n"
            "LIMIT 5;"
        ),
    },
    {
        "question": "Which students have attendance below 75%?",
        "sql": (
            "SELECT s.student_id, s.first_name, s.last_name,\n"
            "       ROUND(100.0 * SUM(CASE WHEN a.status = 'PRESENT' THEN 1 ELSE 0 END) / COUNT(*), 2) AS attendance_pct\n"
            "FROM attendance a\n"
            "JOIN students s ON a.student_id = s.student_id\n"
            "GROUP BY s.student_id, s.first_name, s.last_name\n"
            "HAVING 100.0 * SUM(CASE WHEN a.status = 'PRESENT' THEN 1 ELSE 0 END) / COUNT(*) < 75\n"
            "ORDER BY attendance_pct ASC\n"
            "LIMIT 10;"
        ),
    },
    {
        "question": "What is the average marks obtained per subject?",
        "sql": (
            "SELECT sub.subject_name, ROUND(AVG(m.marks_obtained), 2) AS avg_marks\n"
            "FROM marks m\n"
            "JOIN exams e ON m.exam_id = e.exam_id\n"
            "JOIN subject_offerings so ON e.offering_id = so.offering_id\n"
            "JOIN subjects sub ON so.subject_id = sub.subject_id\n"
            "GROUP BY sub.subject_name\n"
            "ORDER BY avg_marks DESC\n"
            "LIMIT 10;"
        ),
    },
    {
        "question": "How many fee payments are in each status, and what's the total amount?",
        "sql": (
            "SELECT status, COUNT(*) AS payment_count, SUM(amount_paid) AS total_amount\n"
            "FROM fee_payments\n"
            "GROUP BY status\n"
            "ORDER BY payment_count DESC;"
        ),
    },
    {
        "question": "Which companies have made the most accepted placement offers?",
        "sql": (
            "SELECT c.company_name, COUNT(*) AS offer_count\n"
            "FROM placement_offers o\n"
            "JOIN placement_applications a ON o.application_id = a.application_id\n"
            "JOIN placement_drives d ON a.drive_id = d.drive_id\n"
            "JOIN placement_companies c ON d.company_id = c.company_id\n"
            "WHERE o.offer_status = 'ACCEPTED'\n"
            "GROUP BY c.company_name\n"
            "ORDER BY offer_count DESC\n"
            "LIMIT 10;"
        ),
    },
    {
        "question": "List average GPA by department",
        "sql": (
            "SELECT d.department_name, ROUND(AVG(m.marks_obtained) / 10.0, 2) AS avg_gpa\n"
            "FROM marks m\n"
            "JOIN students s ON m.student_id = s.student_id\n"
            "JOIN departments d ON s.department_id = d.department_id\n"
            "GROUP BY d.department_name\n"
            "ORDER BY avg_gpa DESC;"
        ),
    },
]
