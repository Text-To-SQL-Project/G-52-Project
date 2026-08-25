"""
Confidence fusion: combines four detector signals into one overall
Confidence. The base score is a hand-tuned weighted mean with a hard
fail-override; app.detection.calibration then applies an isotonic
regression fit on held-out-verified data (see eval/fit_calibration.py) to
turn that heuristic mean into an actually-calibrated P(correct) when a
fitted calibrator artifact is present, and reports calibrated=True only
then -- see the `calibrated` field below.

multi_query_agreement was removed from the weighted set: the eval/
ablation study (135-question golden set, see eval/learned_weights.md and
eval/README.md) found it was the only signal whose removal *increased*
fused-confidence AUROC (drop = -0.074), and standalone it was barely above
chance (AUROC 0.532) -- it was actively hurting discrimination, not just
failing to help. MULTI_QUERY_ENABLED now also defaults to false (was
already false via app.config's env fallback), so app.detection.multi_query
still runs (harmlessly, as a disabled neutral signal) if explicitly
enabled, but its score is never weighted into the fused score below
regardless -- it's simply not a key in WEIGHTS anymore.
"""
from __future__ import annotations

from app.api.models import Confidence, ConfidenceSignal, SignalStatus
from app.detection.calibration import calibrate

# Weighted-mean weights, kept module-level so they're easy to tune (and to
# cite in the paper) without touching the fusion logic itself. Renormalized
# from the original 5-signal weights (0.30/0.25/0.20/0.10, sum 0.85) after
# dropping multi_query_agreement, so these four still sum to 1.0.
WEIGHTS: dict[str, float] = {
    "schema_alignment": 0.35,
    "back_translation_match": 0.29,
    "result_sanity": 0.24,
    "sql_validity": 0.12,
}

# Any signal at FAIL status forces the overall score down to this cap -- a
# definite hallucination must never be reported as high confidence, no
# matter how the weighted mean of the other signals looks.
FAIL_SCORE_CAP = 0.40


def _is_disabled(signal: ConfidenceSignal) -> bool:
    """A detector that was turned off (e.g. BACK_TRANSLATION_ENABLED=false)
    still returns a neutral WARN signal rather than being omitted, so the
    response shape stays uniform. Those
    neutral placeholders never actually measured anything, so they're
    excluded from the weighted mean (and from the fail-override) rather
    than dragging the average toward their placeholder score. Detected via
    the 'disabled' marker each detector's disabled-state detail string
    carries by convention -- a genuine LLM/API failure signal (also WARN,
    also score 0.5) is intentionally NOT treated as disabled here, since it
    reflects an attempted-but-failed measurement, not a skipped one."""
    return bool(signal.detail) and "disabled" in signal.detail.lower()


def fuse_confidence(signals: list[ConfidenceSignal]) -> Confidence:
    present = [
        s for s in signals
        if s.key in WEIGHTS and not _is_disabled(s)
    ]
    total_weight = sum(WEIGHTS[s.key] for s in present)

    if total_weight <= 0:
        # Nothing was actually measured -- report neutral, not "definitely
        # wrong" (0.0) or "definitely right" (1.0).
        score = 0.5
    else:
        score = sum(WEIGHTS[s.key] * s.score for s in present) / total_weight

    is_fail_capped = any(s.status == SignalStatus.FAIL for s in present)
    if is_fail_capped:
        score = min(score, FAIL_SCORE_CAP)

    score = max(0.0, min(1.0, score))

    # eval/fit_calibration.py fits an isotonic regression mapping this raw
    # hand-tuned score -> P(correct), on a question-level 60/40 train/test
    # split (never row-level, to avoid leaking repeats of the same question
    # across the boundary). See eval/reliability_holdout.png and that
    # script's printed AUROC/ECE for the held-out numbers that justified
    # wiring it in here. calibrated=True only when an actual fitted
    # calibrator was loaded -- a missing artifact degrades to the raw score
    # with calibrated=False, exactly as before this existed.
    score, calibrated = calibrate(score)
    # Re-apply the FAIL cap after calibration: it's a hard safety invariant
    # ("a definite hallucination must never be reported as high
    # confidence"), not a statistical property the calibration curve should
    # be trusted to preserve on its own in a region the fit may have seen
    # little data for.
    if is_fail_capped:
        score = min(score, FAIL_SCORE_CAP)

    if score >= 0.80:
        label = "High"
    elif score >= 0.55:
        label = "Medium"
    else:
        label = "Low"

    return Confidence(
        score=round(score, 2),
        label=label,
        calibrated=calibrated,
        signals=signals,
    )
