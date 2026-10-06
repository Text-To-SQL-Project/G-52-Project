"""
Loads the isotonic-regression calibrator fit by eval/fit_calibration.py and
applies it to a raw fused confidence score.

Fit procedure, held-out numbers, and the reliability diagram all live in
eval/fit_calibration.py and eval/reliability_holdout.png -- this module only
loads the persisted artifact and applies it; it has no fitting logic of its
own, so it never makes an LLM call or touches eval/results.jsonl.
"""
from __future__ import annotations

import json
from bisect import bisect_right
from functools import lru_cache
from pathlib import Path

CALIBRATOR_PATH = Path(__file__).parent / "calibrator.json"


@lru_cache(maxsize=1)
def _load_calibrator():
    """The fitted isotonic curve as (x, y) breakpoints, or None if the
    artifact is missing or unreadable -- callers must degrade to the raw
    (uncalibrated) score rather than fail the request. A missing calibrator
    (e.g. a fresh clone before eval/fit_calibration.py has been run) is not
    a reason to break query serving.

    The curve is stored as JSON (written by eval/fit_calibration.py next to
    the .joblib) and applied with plain linear interpolation, which is
    exactly what IsotonicRegression.predict does with out_of_bounds="clip".
    That keeps scikit-learn, SciPy and NumPy out of the serving path:
    smaller deploys (serverless size limits) and no ~4 s import on cold start.
    """
    try:
        data = json.loads(CALIBRATOR_PATH.read_text())
        xs, ys = [float(v) for v in data["x"]], [float(v) for v in data["y"]]
        return (xs, ys) if xs and len(xs) == len(ys) else None
    except Exception:
        return None


def _interpolate(xs: list[float], ys: list[float], x: float) -> float:
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    i = bisect_right(xs, x)
    x0, x1, y0, y1 = xs[i - 1], xs[i], ys[i - 1], ys[i]
    return y0 if x1 == x0 else y0 + (y1 - y0) * (x - x0) / (x1 - x0)


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
    calibrated = _interpolate(*calibrator, raw_score)
    return max(0.0, min(1.0, calibrated)), True
