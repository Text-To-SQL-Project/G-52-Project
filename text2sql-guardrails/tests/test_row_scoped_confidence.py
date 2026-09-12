"""
W4: result_sanity under row scoping, and the restricted-column handling.

The case that motivated this: a student with no marks asks for their
average. The query is correct and correctly scoped, the result is one NULL
row, and before this change result_sanity called that `null_aggregate`,
forced status to FAIL, and FAIL_SCORE_CAP clamped the fused confidence to
0.40. The confidence system was penalising the security model for working.
"""
from __future__ import annotations

import pytest

from app.api.models import ConfidenceSignal, SignalStatus
from app.detection.confidence import FAIL_SCORE_CAP, _is_disabled, fuse_confidence
from app.detection.result_sanity import _ROW_COUNT_SENSITIVE, check_result_sanity
from app.schema.introspect import RESTRICTED_COLUMNS, introspect_schema

AVG_SQL = "SELECT AVG(score) AS avg_score FROM marks WHERE student_id = 32"


def _healthy_others():
    return [
        ConfidenceSignal(key="schema_alignment", label="Schema Alignment",
                         score=0.9, status=SignalStatus.PASS, detail="ok"),
        ConfidenceSignal(key="back_translation_match", label="Back-translation",
                         score=0.9, status=SignalStatus.PASS, detail="ok"),
        ConfidenceSignal(key="sql_validity", label="SQL Validity",
                         score=1.0, status=SignalStatus.PASS, detail="ok"),
    ]


# --- the motivating case ---------------------------------------------------

def test_student_with_no_marks_is_no_longer_failed():
    unscoped = check_result_sanity(AVG_SQL, ["avg_score"], [[None]], "my average", row_scoped=False)
    scoped = check_result_sanity(AVG_SQL, ["avg_score"], [[None]], "my average", row_scoped=True)

    assert unscoped.status is SignalStatus.FAIL, "precondition: this used to be a forced FAIL"
    assert scoped.status is not SignalStatus.FAIL
    assert _is_disabled(scoped), "should report itself unmeasured, not silently pass"


def test_the_fail_cap_no_longer_applies_to_that_query():
    scoped_conf = fuse_confidence(
        _healthy_others() + [check_result_sanity(AVG_SQL, ["avg_score"], [[None]], "q", row_scoped=True)],
        row_scoped=True,
    )
    unscoped_conf = fuse_confidence(
        _healthy_others() + [check_result_sanity(AVG_SQL, ["avg_score"], [[None]], "q", row_scoped=False)],
        row_scoped=False,
    )
    assert unscoped_conf.score <= FAIL_SCORE_CAP, "precondition: clamped before"
    assert scoped_conf.score > FAIL_SCORE_CAP, "row-scoped request should not be clamped"


def test_empty_result_is_not_penalised_when_row_scoped():
    scoped = check_result_sanity("SELECT * FROM library_transactions", ["a"], [], "my loans",
                                 row_scoped=True)
    assert _is_disabled(scoped)


# --- what must NOT be suppressed -------------------------------------------

def test_only_the_three_row_count_checks_are_suppressed():
    assert _ROW_COUNT_SENSITIVE == {"empty_result", "all_null_column", "null_aggregate"}


def test_content_checks_still_fire_under_row_scoping():
    """Filtering cannot turn values into zeros, so this is still evidence
    of a bad query and must keep scoring."""
    sig = check_result_sanity("SELECT total FROM t", ["total"], [[0], [0], [0]], "q", row_scoped=True)
    assert not _is_disabled(sig)
    assert sig.score < 1.0
    assert "entirely 0" in sig.detail


# --- row_scoped may never be inferred --------------------------------------

def test_row_scoped_defaults_to_false():
    """eval/ and every other caller that does not pass it get the original
    behaviour, which is why published baselines are unaffected."""
    import inspect
    assert inspect.signature(check_result_sanity).parameters["row_scoped"].default is False
    assert inspect.signature(fuse_confidence).parameters["row_scoped"].default is False


def test_a_small_result_alone_does_not_trigger_suppression():
    """The flag comes from the principal. If it could be inferred from the
    data, an attacker could suppress the detector by crafting a small
    result."""
    sig = check_result_sanity(AVG_SQL, ["avg_score"], [[None]], "q", row_scoped=False)
    assert sig.status is SignalStatus.FAIL


# --- calibration honesty ---------------------------------------------------

def test_row_scoped_requests_report_uncalibrated():
    """The isotonic curve was fit on unscoped runs where every signal was
    present. Reusing it over a renormalised subset would be a number that
    looks principled and is not."""
    conf = fuse_confidence(_healthy_others() + [
        check_result_sanity(AVG_SQL, ["avg_score"], [[None]], "q", row_scoped=True)
    ], row_scoped=True)
    assert conf.calibrated is False


# --- restricted columns ----------------------------------------------------

def test_salary_is_the_declared_restricted_column():
    assert RESTRICTED_COLUMNS.get("faculty") == {"salary"}


def test_generation_schema_omits_restricted_columns():
    """Fix the cause: a model that never sees the column does not write SQL
    naming it, so the user never meets an error that looks like a bug."""
    schema = introspect_schema(include_samples=False, omit_restricted=True)
    faculty = next(t for t in schema.tables if t.name == "faculty")
    assert "salary" not in [c.name for c in faculty.columns]


def test_schema_explorer_still_lists_the_column_but_never_its_values():
    """Structure is not data. The column's existence is legitimate
    operator knowledge; five real salaries are not."""
    schema = introspect_schema(include_samples=True)
    faculty = next(t for t in schema.tables if t.name == "faculty")
    salary = next((c for c in faculty.columns if c.name == "salary"), None)
    assert salary is not None, "the column should still be listed"
    assert salary.sample_values == [], "restricted columns must never carry samples"


def test_unrestricted_columns_keep_their_samples():
    schema = introspect_schema(include_samples=True)
    faculty = next(t for t in schema.tables if t.name == "faculty")
    first_name = next(c for c in faculty.columns if c.name == "first_name")
    assert first_name.sample_values


def test_the_generation_prompt_never_mentions_the_restricted_column():
    from app.generation.prompt_builder import build_system_prompt
    prompt = build_system_prompt(introspect_schema(include_samples=False, omit_restricted=True))
    assert "salary" not in prompt.lower()
