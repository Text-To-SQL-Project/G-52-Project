"""
Confidence fusion: combines the five detector signals into one overall
Confidence. This is a hand-tuned weighted mean with a hard fail-override --
NOT a calibrated probability (see the `calibrated` field below).
"""
from __future__ import annotations

from app.api.models import Confidence, ConfidenceSignal, SignalStatus

# Weighted-mean weights, kept module-level so they're easy to tune (and to
# cite in the paper) without touching the fusion logic itself.
WEIGHTS: dict[str, float] = {
    "schema_alignment": 0.30,
    "back_translation_match": 0.25,
    "result_sanity": 0.20,
    "multi_query_agreement": 0.15,
    "sql_validity": 0.10,
}

# Any signal at FAIL status forces the overall score down to this cap -- a
# definite hallucination must never be reported as high confidence, no
# matter how the weighted mean of the other signals looks.
FAIL_SCORE_CAP = 0.40


def _is_disabled(signal: ConfidenceSignal) -> bool:
    """A detector that was turned off (BACK_TRANSLATION_ENABLED=false,
    MULTI_QUERY_ENABLED=false, ...) still returns a neutral WARN signal
    rather than being omitted, so the response shape stays uniform. Those
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

    if any(s.status == SignalStatus.FAIL for s in present):
        score = min(score, FAIL_SCORE_CAP)

    score = max(0.0, min(1.0, score))

    if score >= 0.80:
        label = "High"
    elif score >= 0.55:
        label = "Medium"
    else:
        label = "Low"

    return Confidence(
        score=round(score, 2),
        label=label,
        # True calibration (isotonic regression fit against measured ECE
        # on a labelled correct/incorrect dataset) is Phase 5 work -- we
        # don't have that dataset yet. This is a hand-tuned weighted mean
        # over heuristic signals, not a calibrated probability, so we do
        # not claim calibration we haven't measured.
        calibrated=False,
        signals=signals,
    )
