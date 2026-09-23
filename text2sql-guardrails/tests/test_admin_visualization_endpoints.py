import pytest
from fastapi import HTTPException

from app.api.routes import get_admin_eval_metrics, get_admin_rls_demo
from app.users import Principal

ADMIN = Principal(user_id=1, username="admin", role="admin", student_id=None, faculty_id=None)
STUDENT = Principal(user_id=2, username="student1", role="student", student_id=32, faculty_id=None)


def test_admin_eval_metrics_returns_8_cells_and_persignal():
    resp = get_admin_eval_metrics(_=ADMIN)
    assert len(resp.ablation_cells) == 8
    # Exactly one cell is the historical justification cell
    justification_cells = [c for c in resp.ablation_cells if c.is_justification_cell]
    assert len(justification_cells) == 1
    assert justification_cells[0].provider == "Anthropic"
    assert justification_cells[0].regime == "Permissive"
    assert justification_cells[0].split == "In-sample"
    assert justification_cells[0].delta == 0.065

    # 6 of 8 cells say dropping hurts
    hurts = [c for c in resp.ablation_cells if c.dropping_hurts]
    assert len(hurts) == 6

    # Both providers represented in per_signal_auroc
    assert "Anthropic" in resp.per_signal_auroc
    assert "Gemini" in resp.per_signal_auroc

    # Superseded value flagged
    assert resp.auroc_comparison.superseded_frozen_value == 0.649
    assert resp.auroc_comparison.in_sample_raw == 0.625


def test_admin_rls_demo_returns_principals_and_caveat():
    resp = get_admin_rls_demo(_=ADMIN)
    principals = {p.principal: p for p in resp.principals}
    assert "admin" in principals
    assert "faculty1" in principals
    assert "student1" in principals
    assert "student2" in principals

    assert principals["admin"].students == 2000
    assert principals["faculty1"].students == 311
    assert principals["student1"].students == 1
    assert principals["student2"].students == 1

    # Coincidence caveat present
    assert "79 attendance rows" in resp.caveat
    assert "coincidence" in resp.caveat
