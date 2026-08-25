"""
Loads the isotonic-regression calibrator fit by eval/fit_calibration.py and
applies it to a raw fused confidence score.

Fit procedure, held-out numbers, and the reliability diagram all live in
eval/fit_calibration.py and eval/reliability_holdout.png -- this module only
loads the persisted artifact and applies it; it has no fitting logic of its
own, so it never makes an LLM call or touches eval/results.jsonl.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

CALIBRATOR_PATH = Path(__file__).parent / "calibrator.joblib"


@lru_cache(maxsize=1)
def _load_calibrator():
    """Returns the fitted IsotonicRegression, or None if the artifact is
    missing or fails to load -- callers must degrade to the raw
    (uncalibrated) score rather than fail the request. A missing calibrator
    (e.g. a fresh clone before eval/fit_calibration.py has been run) is not
    a reason to break query serving."""
    if not CALIBRATOR_PATH.exists():
        return None
    try:
        import joblib
        return joblib.load(CALIBRATOR_PATH)
    except Exception:
        return None


def is_available() -> bool:
    """Whether a fitted calibrator is currently loaded -- for the admin
    endpoint, not the request path (which already degrades via calibrate())."""
    return _load_calibrator() is not None


def calibrate(raw_score: float) -> tuple[float, bool]:
    """Returns (score_to_report, was_calibrated). was_calibrated=False means
    the caller should report the raw score with Confidence.calibrated=False,
    exactly as before this module existed."""
    calibrator = _load_calibrator()
    if calibrator is None:
        return raw_score, False
    calibrated = float(calibrator.predict([raw_score])[0])
    return max(0.0, min(1.0, calibrated)), True
