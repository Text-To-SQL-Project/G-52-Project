"""Unit tests for app.detection.confidence's fusion + calibration wiring.
Pure logic tests -- no DB, no LLM, no network."""
from __future__ import annotations

from app.api.models import ConfidenceSignal, SignalStatus
from app.detection import calibration
from app.detection.confidence import FAIL_SCORE_CAP, WEIGHTS, fuse_confidence

_PASS_SIGNALS = [
    ConfidenceSignal(key="schema_alignment", label="Schema Alignment", score=1.0, status=SignalStatus.PASS, detail="ok"),
    ConfidenceSignal(key="back_translation_match", label="Back-translation Match", score=0.85, status=SignalStatus.PASS, detail="ok"),
    ConfidenceSignal(key="result_sanity", label="Result Sanity", score=0.9, status=SignalStatus.WARN, detail="ok"),
    ConfidenceSignal(key="sql_validity", label="SQL Validity", score=1.0, status=SignalStatus.PASS, detail="ok"),
]


def test_multi_query_agreement_not_in_weights():
    """Dropped per the ablation finding (its removal increased fused AUROC)
    -- see app/detection/confidence.py's module docstring."""
    assert "multi_query_agreement" not in WEIGHTS
    assert len(WEIGHTS) == 4


def test_weights_sum_to_one():
    assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-9


def test_multi_query_signal_present_but_ignored():
    """A multi_query_agreement signal in the input list (e.g. from a run
    with MULTI_QUERY_ENABLED=true) must not affect the fused score at all,
    since it's not a WEIGHTS key -- confirmed by comparing against the same
    signals without it."""
    with_mq = _PASS_SIGNALS + [
        ConfidenceSignal(key="multi_query_agreement", label="Multi-query Agreement", score=0.0, status=SignalStatus.FAIL, detail="disagree"),
    ]
    assert fuse_confidence(_PASS_SIGNALS).score == fuse_confidence(with_mq).score


def test_fail_status_cap_reapplied_after_calibration(monkeypatch):
    """A FAIL-status signal must cap the score at FAIL_SCORE_CAP, even if
    the isotonic calibrator would otherwise map the pre-calibration capped
    value to something higher -- the cap is a safety invariant, not a
    statistical property calibration should be trusted to preserve."""
    # Curve breakpoints (x, y): +0.5 everywhere, capped at 1.0.
    monkeypatch.setattr(calibration, "_load_calibrator", lambda: ([0.0, 0.5, 1.0], [0.5, 1.0, 1.0]))

    fail_signals = _PASS_SIGNALS[:-1] + [
        ConfidenceSignal(key="sql_validity", label="SQL Validity", score=0.0, status=SignalStatus.FAIL, detail="bad"),
    ]
    result = fuse_confidence(fail_signals)
    assert result.score <= FAIL_SCORE_CAP
    assert result.calibrated is True


def test_calibrated_false_when_artifact_missing(monkeypatch):
    monkeypatch.setattr(calibration, "_load_calibrator", lambda: None)
    result = fuse_confidence(_PASS_SIGNALS)
    assert result.calibrated is False


def test_calibrated_true_when_artifact_loads(monkeypatch):
    monkeypatch.setattr(calibration, "_load_calibrator", lambda: ([0.0, 1.0], [0.0, 1.0]))  # identity curve
    result = fuse_confidence(_PASS_SIGNALS)
    assert result.calibrated is True
