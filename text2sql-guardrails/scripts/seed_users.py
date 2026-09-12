"""
Create the Phase 1 user accounts.

A Python script rather than a seed/*.sql file because Argon2 hashes cannot
be computed in SQL, and storing pre-computed hashes in a committed file
would mean shipping known-password accounts.

Selection is DETERMINISTIC and DERIVED, never hardcoded IDs: the same
query picks the same people on any regenerated dataset, and nothing breaks
if student_id 1 stops existing. The ordering keys are stable natural keys
(prn_number, employee_code), not surrogate ids.

The choice of WHICH people matters for Phase 2. Two of the students are
picked from the SAME section, and the faculty member is picked because
they teach a subject offered to that section. Isolation tests need two
principals whose data genuinely overlaps in the schema graph -- two
students chosen at random would likely share no section, no subject and no
exam, and every "can A see B's rows" test would pass trivially without
proving anything.

Usage:
    python -m scripts.seed_users                 # create/refresh accounts
    python -m scripts.seed_users --show          # list them, no writes

Passwords come from the environment, with NO defaults:
    SEED_ADMIN_PASSWORD, SEED_STUDENT_PASSWORD, SEED_FACULTY_PASSWORD
OPERATOR_PASSWORD is accepted as the bootstrap admin password if
SEED_ADMIN_PASSWORD is unset, which is what it is now for.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402

from app.auth import argon2_parameters, hash_password  # noqa: E402
from app.config import settings  # noqa: E402
from app.db import get_engine  # noqa: E402

# Two students in one section, ordered by a stable natural key so the pick
# is reproducible. LIMIT 2 over the section with the most students keeps it
# deterministic even if sections are renumbered.
_PEER_STUDENTS = text("""
    WITH busiest_section AS (
        SELECT m.section_id
          FROM college_erp.student_section_mapping m
         GROUP BY m.section_id
         ORDER BY count(*) DESC, m.section_id ASC
         LIMIT 1
    )
    SELECT s.student_id, s.prn_number, s.first_name, s.last_name,
           m.section_id
      FROM college_erp.students s
      JOIN college_erp.student_section_mapping m ON m.student_id = s.student_id
      JOIN busiest_section b ON b.section_id = m.section_id
     ORDER BY s.prn_number ASC
     LIMIT 2
""")

# A student from a DIFFERENT section, so isolation tests have a principal
# with no sectional overlap at all as well as one with plenty.
_OUTSIDER_STUDENT = text("""
    SELECT s.student_id, s.prn_number, s.first_name, s.last_name, m.section_id
      FROM college_erp.students s
      JOIN college_erp.student_section_mapping m ON m.student_id = s.student_id
     WHERE m.section_id <> :section_id
     ORDER BY s.prn_number ASC
     LIMIT 1
""")

# A faculty member who actually teaches something offered to the peer
# students' programme -- not just any faculty row.
_TEACHING_FACULTY = text("""
    SELECT f.faculty_id, f.employee_code, f.first_name, f.last_name
      FROM college_erp.faculty f
      JOIN college_erp.faculty_subject_assignments fsa ON fsa.faculty_id = f.faculty_id
      JOIN college_erp.subject_offerings so ON so.offering_id = fsa.offering_id
     WHERE so.program_id = (
               SELECT program_id FROM college_erp.students WHERE student_id = :student_id
           )
     ORDER BY f.employee_code ASC
     LIMIT 1
""")

_UPSERT = text("""
    INSERT INTO app.users (username, password_hash, role, student_id, faculty_id)
    VALUES (:username, :password_hash, :role, :student_id, :faculty_id)
    ON CONFLICT (username) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            role          = EXCLUDED.role,
            student_id    = EXCLUDED.student_id,
            faculty_id    = EXCLUDED.faculty_id,
            is_active     = TRUE
    RETURNING user_id
""")


def _password(*names: str) -> str:
    for n in names:
        v = os.getenv(n) or (settings.OPERATOR_PASSWORD if n == "OPERATOR_PASSWORD" else "")
        if v:
            return v
    raise SystemExit(
        f"None of {', '.join(names)} is set. Seed passwords have no defaults on "
        "purpose -- a demo account with a committed password is a real account "
        "with a public password."
    )


def plan(conn) -> list[dict]:
    peers = conn.execute(_PEER_STUDENTS).mappings().all()
    if len(peers) < 2:
        raise SystemExit("Could not find two students sharing a section; is the ERP data seeded?")
    section_id = peers[0]["section_id"]
    outsider = conn.execute(_OUTSIDER_STUDENT, {"section_id": section_id}).mappings().one_or_none()
    faculty = conn.execute(_TEACHING_FACULTY, {"student_id": peers[0]["student_id"]}).mappings().one_or_none()
    if faculty is None:
        raise SystemExit("Could not find a faculty member teaching this programme.")

    rows = [{
        "username": "admin",
        "role": "admin",
        "student_id": None,
        "faculty_id": None,
        "password": _password("SEED_ADMIN_PASSWORD", "OPERATOR_PASSWORD"),
        "note": "bootstrap administrator",
    }]
    for i, s in enumerate(peers, start=1):
        rows.append({
            "username": f"student{i}",
            "role": "student",
            "student_id": s["student_id"],
            "faculty_id": None,
            "password": _password("SEED_STUDENT_PASSWORD"),
            "note": f"{s['first_name']} {s['last_name']} ({s['prn_number']}), section {s['section_id']}",
        })
    if outsider is not None:
        rows.append({
            "username": "student3",
            "role": "student",
            "student_id": outsider["student_id"],
            "faculty_id": None,
            "password": _password("SEED_STUDENT_PASSWORD"),
            "note": (f"{outsider['first_name']} {outsider['last_name']} "
                     f"({outsider['prn_number']}), section {outsider['section_id']} "
                     "-- deliberately NOT a peer of student1/student2"),
        })
    rows.append({
        "username": "faculty1",
        "role": "faculty",
        "student_id": None,
        "faculty_id": faculty["faculty_id"],
        "password": _password("SEED_FACULTY_PASSWORD"),
        "note": (f"{faculty['first_name']} {faculty['last_name']} "
                 f"({faculty['employee_code']}), teaches student1/student2's programme"),
    })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed app.users with deterministic demo accounts.")
    parser.add_argument("--show", action="store_true", help="Print the plan without writing.")
    args = parser.parse_args()

    engine = get_engine()
    with engine.connect() as conn:
        rows = plan(conn)

    print(f"Argon2 parameters: {argon2_parameters()}")
    print()
    for r in rows:
        link = (f"student_id={r['student_id']}" if r["student_id"]
                else f"faculty_id={r['faculty_id']}" if r["faculty_id"] else "-")
        print(f"  {r['username']:<10} {r['role']:<8} {link:<16} {r['note']}")

    if args.show:
        print("\n--show: nothing written.")
        return

    print("\nHashing and writing...")
    with engine.begin() as conn:
        for r in rows:
            conn.execute(_UPSERT, {
                "username": r["username"],
                "password_hash": hash_password(r["password"]),
                "role": r["role"],
                "student_id": r["student_id"],
                "faculty_id": r["faculty_id"],
            })
    print(f"Done: {len(rows)} account(s) created or refreshed.")


if __name__ == "__main__":
    main()
