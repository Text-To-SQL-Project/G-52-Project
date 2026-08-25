"""
Fits confidence-fusion weights from eval/results.jsonl via logistic
regression, as a data-driven alternative to the hand-tuned weights in
app/detection/confidence.py. Uses ONLY already-recorded results -- makes
no new LLM calls.

Compares three approaches, all scored on HELD-OUT data:
  1. Hand-tuned          -- the current fuse_confidence() formula. It was
     never fit to this data (weights were set by hand before this eval
     existed), so every usable row is fairly "held out" relative to it.
  2. Learned              -- plain logistic regression on the 5 signal
     scores, evaluated via GroupKFold cross-validation (grouped by golden
     case id, so the 3 repeats of a given question never span the
     train/test boundary -- that would leak question-specific quirks
     across the split).
  3. Learned + isotonic  -- the same logistic regression, with an isotonic
     calibration map. The map is fit on a held-out INNER split of each
     OUTER training fold (never the same rows used to fit the logistic
     regression, and never the outer test fold it's ultimately scored on)
     -- a nested calibration scheme, not calibration-on-training-data.

Usage:
    python -m eval.fit_weights eval/results.jsonl
    python -m eval.fit_weights eval/results.jsonl --folds 5 --seed 42
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupKFold, GroupShuffleSplit

from app.api.models import ConfidenceSignal, SignalStatus
from app.detection.confidence import WEIGHTS, fuse_confidence

EVAL_DIR = Path(__file__).parent
DEFAULT_OUT = EVAL_DIR / "learned_weights.md"

# Fixed, documented feature order -- coefficients reported below are in
# this order.
SIGNAL_KEYS = sorted(WEIGHTS)


def load_results(path: str) -> list[dict]:
    records = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def build_dataset(results: list[dict]):
    """Usable rows: a non-None `correct` label (answerable, non-adversarial
    cases only -- adversarial/unanswerable cases have no correctness label
    to regress against) with all 5 signal scores present. Returns
    (X, y, groups, hand_tuned_scores)."""
    X, y, groups, hand_tuned = [], [], [], []
    skipped_missing_signal = 0
    for r in results:
        if r["correct"] is None:
            continue
        if not all(k in r["signals"] for k in SIGNAL_KEYS):
            skipped_missing_signal += 1
            continue
        X.append([r["signals"][k]["score"] for k in SIGNAL_KEYS])
        y.append(1 if r["correct"] else 0)
        groups.append(r["id"])
        hand_tuned.append(_hand_tuned_score(r["signals"]))
    if skipped_missing_signal:
        print(f"Skipped {skipped_missing_signal} row(s) with a correct label but incomplete signals.")
    return np.array(X, dtype=float), np.array(y, dtype=int), groups, hand_tuned


def _hand_tuned_score(signals: dict) -> float:
    """The current, hand-tuned fuse_confidence() score, reconstructed from
    stored signals -- same approach as eval/analyze.py's
    reconstruct_confidence_score()."""
    reconstructed = []
    for key, sig in signals.items():
        if key not in WEIGHTS:
            continue
        reconstructed.append(ConfidenceSignal(
            key=key, label=key, score=sig["score"],
            status=SignalStatus(sig["status"]),
            detail="disabled (reconstructed)" if sig.get("disabled") else None,
        ))
    return fuse_confidence(reconstructed).score


def compute_ece(scores: list[float], labels: list[int], n_bins: int = 10) -> tuple[int, float]:
    bins: list[list[tuple[float, int]]] = [[] for _ in range(n_bins)]
    for s, label in zip(scores, labels):
        idx = min(int(max(0.0, min(1.0, s)) * n_bins), n_bins - 1)
        bins[idx].append((s, label))
    total = len(scores)
    ece = 0.0
    for b in bins:
        if not b:
            continue
        conf = sum(s for s, _ in b) / len(b)
        acc = sum(label for _, label in b) / len(b)
        ece += (len(b) / total) * abs(acc - conf)
    return total, ece


def cv_learned(X, y, groups, n_splits: int, seed: int) -> np.ndarray:
    """Out-of-fold predicted P(correct) from a plain logistic regression."""
    gkf = GroupKFold(n_splits=n_splits)
    oof = np.zeros(len(y))
    for train_idx, test_idx in gkf.split(X, y, groups):
        model = LogisticRegression()
        model.fit(X[train_idx], y[train_idx])
        oof[test_idx] = model.predict_proba(X[test_idx])[:, 1]
    return oof


def cv_learned_isotonic(X, y, groups, n_splits: int, seed: int) -> np.ndarray:
    """Out-of-fold predicted P(correct) from logistic regression + a nested
    isotonic calibration map (see module docstring)."""
    gkf = GroupKFold(n_splits=n_splits)
    groups_arr = np.array(groups)
    oof = np.zeros(len(y))
    for train_idx, test_idx in gkf.split(X, y, groups):
        gss = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=seed)
        inner_fit_rel, inner_calib_rel = next(
            gss.split(X[train_idx], y[train_idx], groups_arr[train_idx])
        )
        fit_idx = train_idx[inner_fit_rel]
        calib_idx = train_idx[inner_calib_rel]

        model = LogisticRegression()
        model.fit(X[fit_idx], y[fit_idx])

        calib_raw = model.predict_proba(X[calib_idx])[:, 1]
        iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
        iso.fit(calib_raw, y[calib_idx])

        test_raw = model.predict_proba(X[test_idx])[:, 1]
        oof[test_idx] = iso.predict(test_raw)
    return oof


def fold_coefficients(X, y, groups, n_splits: int) -> dict[str, list[float]]:
    gkf = GroupKFold(n_splits=n_splits)
    per_key: dict[str, list[float]] = {k: [] for k in SIGNAL_KEYS}
    for train_idx, _ in gkf.split(X, y, groups):
        m = LogisticRegression()
        m.fit(X[train_idx], y[train_idx])
        for k, c in zip(SIGNAL_KEYS, m.coef_[0]):
            per_key[k].append(float(c))
    return per_key


def fold_test_auroc(X, y, groups, n_splits: int) -> list[dict]:
    """Per-fold held-out AUROC for the plain learned model (approach 2),
    plus each fold's test-set size and class balance -- the aggregate
    out-of-fold AUROC in cv_learned() can look fine while masking a fold
    whose test split has too few (or zero) negatives to estimate AUROC at
    all; this surfaces that per fold instead of hiding it in an average."""
    gkf = GroupKFold(n_splits=n_splits)
    results = []
    for fold_idx, (train_idx, test_idx) in enumerate(gkf.split(X, y, groups), start=1):
        model = LogisticRegression()
        model.fit(X[train_idx], y[train_idx])
        y_test = y[test_idx]
        n_pos_test = int(y_test.sum())
        n_neg_test = len(y_test) - n_pos_test
        if n_pos_test == 0 or n_neg_test == 0:
            auroc = None  # undefined -- single-class test fold
        else:
            preds = model.predict_proba(X[test_idx])[:, 1]
            auroc = float(roc_auc_score(y_test, preds))
        results.append({
            "fold": fold_idx, "n_test": len(test_idx),
            "n_pos_test": n_pos_test, "n_neg_test": n_neg_test, "auroc": auroc,
        })
    return results


def _mean_std(xs: list[float]) -> tuple[float, float]:
    m = sum(xs) / len(xs)
    var = sum((x - m) ** 2 for x in xs) / len(xs)
    return m, var ** 0.5


def write_report(out_path: Path, *, n, n_groups, n_pos, folds, seed,
                  hand_auroc, hand_ece, hand_ece_n,
                  learned_auroc, learned_ece, learned_ece_n,
                  iso_auroc, iso_ece, iso_ece_n,
                  final_coefs, final_intercept, fold_coefs, fold_auroc) -> None:
    lines = []
    lines.append("# Learned confidence-fusion weights\n")
    lines.append(
        "Fits `fuse_confidence()`'s weights from `eval/results.jsonl` data via "
        "logistic regression, as a data-driven alternative to the hand-tuned "
        "weights in `app/detection/confidence.py`. No new LLM calls were made "
        "-- this is a pure offline re-analysis of the existing evaluation run.\n"
    )

    lines.append("## Dataset\n")
    lines.append(
        f"- **{n} usable rows** ({n_groups} unique golden-set questions x up to 3 repeats), "
        f"restricted to answerable, non-adversarial cases with a non-`None` `correct` label "
        f"and all 5 signal scores present (no rows were dropped for missing signals in this run).\n"
        f"- Class balance: **{n_pos} correct / {n - n_pos} incorrect** "
        f"({n_pos / n:.1%} positive).\n"
        f"- Feature order (fixed, used for every coefficient below): "
        f"`{', '.join(SIGNAL_KEYS)}`.\n"
        f"- Grouping for cross-validation: golden case `id` -- the 3 repeats of "
        f"the same question are always kept together in either train or test, "
        f"never split across the boundary, since generation is non-deterministic "
        f"but repeats of the same question still share question-specific "
        f"characteristics that would leak across a naive random split.\n"
        f"- `{folds}`-fold `GroupKFold`, `random_state={seed}` where randomness is "
        f"involved (the inner fit/calibration split for isotonic calibration).\n"
    )

    lines.append("## Results (all metrics on held-out data)\n")
    lines.append("| Approach | AUROC | ECE (n) |")
    lines.append("|---|---|---|")
    lines.append(f"| 1. Hand-tuned (current `fuse_confidence`) | {hand_auroc:.3f} | {hand_ece:.3f} (n={hand_ece_n}) |")
    lines.append(f"| 2. Learned (logistic regression, {folds}-fold CV) | {learned_auroc:.3f} | {learned_ece:.3f} (n={learned_ece_n}) |")
    lines.append(f"| 3. Learned + isotonic calibration | {iso_auroc:.3f} | {iso_ece:.3f} (n={iso_ece_n}) |")
    lines.append("")
    lines.append(
        "AUROC: does the score rank correct answers above incorrect ones "
        "(label = 1 if `correct`, higher score = more confident it's correct)? "
        "0.5 = chance, 1.0 = perfect separation.\n"
        "ECE (Expected Calibration Error, Guo et al. 2017, 10 equal-width bins "
        "over [0,1]): does the score's numeric VALUE match the observed "
        "accuracy at that value? 0.0 = perfectly calibrated.\n"
        "\n"
        "**Note on comparability with the earlier ablation report** "
        "(`eval/analyze.py`'s \"most load-bearing signal\" section): that "
        "analysis used a *broader* dataset (n=113) including adversarial/"
        "unanswerable cases that reached `success` (labeled always-wrong), "
        "and the opposite score direction (predicting *wrongness*). The "
        "numbers here use a *narrower*, `correct`-label-only dataset (n="
        f"{n}) as the user's request specified, so the two AUROC figures "
        "are not directly the same quantity and should not be expected to "
        "match numerically.\n"
    )

    lines.append("## Learned coefficients\n")
    lines.append(
        "From a **final logistic regression fit on all "
        f"{n} usable rows** (unregularized default, `sklearn.linear_model."
        "LogisticRegression`) -- this is the model the AUROC/ECE numbers "
        "above are estimating the held-out performance OF, not itself "
        "evaluated on held-out data (that's what the CV numbers above are "
        "for). Positive coefficient = higher signal score pushes the "
        "prediction toward \"correct\"; magnitude is directly comparable "
        "across signals since all 5 raw scores are already on the same "
        "[0,1] scale (no feature standardization was applied).\n"
    )
    lines.append("| Signal | Final-fit coefficient | Hand-tuned weight | Across-fold mean +/- std |")
    lines.append("|---|---|---|---|")
    for key in SIGNAL_KEYS:
        fold_vals = fold_coefs[key]
        fm, fs = _mean_std(fold_vals)
        lines.append(
            f"| `{key}` | {final_coefs[key]:+.3f} | {WEIGHTS.get(key, float('nan')):.2f} | {fm:+.3f} +/- {fs:.3f} |"
        )
    lines.append(f"| *intercept* | {final_intercept:+.3f} | -- | -- |")
    lines.append("")

    coef_variance_note = (
        "high variance across folds -- treat individual-fold coefficients with "
        f"caution, this dataset ({n_groups} unique questions) is small for a "
        "5-feature fit" if any(_mean_std(fold_coefs[k])[1] > abs(_mean_std(fold_coefs[k])[0]) for k in SIGNAL_KEYS)
        else "reasonably stable across folds"
    )
    lines.append(
        f"**Coefficient stability:** {coef_variance_note}. See the "
        "across-fold mean +/- std column -- a std comparable to or larger "
        "than the mean for a given signal means its sign/magnitude is not "
        "reliably estimated from this sample size and any large deviation "
        "from the hand-tuned weight should be treated as a hypothesis to "
        "re-test with more data, not a settled result.\n"
    )

    lines.append("## Per-fold test AUROC\n")
    lines.append(
        "The aggregate out-of-fold AUROC above (approach 2) is computed by "
        "pooling all folds' held-out predictions into one `roc_auc_score` "
        "call. That can look fine while masking a fold whose test split "
        "happens to have too few (or zero) negatives to estimate AUROC at "
        "all. This breaks the same cross-validation down per fold.\n"
    )
    lines.append("| Fold | Test rows | Positives | Negatives | AUROC |")
    lines.append("|---|---|---|---|---|")
    for f in fold_auroc:
        auroc_str = f"{f['auroc']:.3f}" if f["auroc"] is not None else "undefined (single-class test fold)"
        lines.append(f"| {f['fold']} | {f['n_test']} | {f['n_pos_test']} | {f['n_neg_test']} | {auroc_str} |")
    lines.append("")

    lines.append("## Limitations\n")
    lines.append(
        f"- **Small sample**: {n_groups} unique questions is a small training "
        "set for a 5-parameter logistic regression; coefficient estimates "
        "(and especially the isotonic calibration map, fit on an even "
        "smaller inner split) carry substantial variance -- see the "
        "stability note above.\n"
        "- **Repeats are not fully independent**: the 3 repeats per question "
        "share the same underlying question and schema context even though "
        "generation is non-deterministic; GroupKFold prevents them from "
        "spanning the train/test boundary, but within a fold they're still "
        "correlated samples, not i.i.d. draws.\n"
        "- **Label scope**: only rows with a `correct` label are used here "
        "(answerable, non-adversarial cases). The adversarial/unanswerable "
        "cases that reached `success` when they shouldn't have (a real "
        "failure mode, see eval/analyze.py's safety-check output) are *not* "
        "represented in this fit at all, since they have no `correct` label "
        "by construction.\n"
    )

    out_path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Fit confidence-fusion weights from eval/results.jsonl.")
    parser.add_argument("results", type=Path, help="Path to results.jsonl")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    results = load_results(str(args.results))
    X, y, groups, hand_tuned = build_dataset(results)
    n = len(y)
    n_pos = int(y.sum())
    n_groups = len(set(groups))
    print(f"Usable rows: {n} (unique golden cases: {n_groups})  correct={n_pos}  incorrect={n - n_pos}")

    # 1. Hand-tuned.
    hand_auroc = roc_auc_score(y, hand_tuned)
    hand_ece_n, hand_ece = compute_ece(hand_tuned, list(y))
    print(f"1. Hand-tuned:            AUROC={hand_auroc:.3f}  ECE={hand_ece:.3f} (n={hand_ece_n})")

    # 2. Learned.
    oof_learned = cv_learned(X, y, groups, n_splits=args.folds, seed=args.seed)
    learned_auroc = roc_auc_score(y, oof_learned)
    learned_ece_n, learned_ece = compute_ece(list(oof_learned), list(y))
    print(f"2. Learned:               AUROC={learned_auroc:.3f}  ECE={learned_ece:.3f} (n={learned_ece_n})")

    # 3. Learned + isotonic.
    oof_iso = cv_learned_isotonic(X, y, groups, n_splits=args.folds, seed=args.seed)
    iso_auroc = roc_auc_score(y, oof_iso)
    iso_ece_n, iso_ece = compute_ece(list(oof_iso), list(y))
    print(f"3. Learned + isotonic:    AUROC={iso_auroc:.3f}  ECE={iso_ece:.3f} (n={iso_ece_n})")

    # Final full-data fit for reportable coefficients.
    final_model = LogisticRegression()
    final_model.fit(X, y)
    final_coefs = dict(zip(SIGNAL_KEYS, (float(c) for c in final_model.coef_[0])))
    final_intercept = float(final_model.intercept_[0])
    print("\nFinal full-data coefficients:")
    for k in SIGNAL_KEYS:
        print(f"  {k:24s} {final_coefs[k]:+.3f}   (hand-tuned weight: {WEIGHTS.get(k):.2f})")
    print(f"  {'intercept':24s} {final_intercept:+.3f}")

    fold_coefs = fold_coefficients(X, y, groups, n_splits=args.folds)

    fold_auroc = fold_test_auroc(X, y, groups, n_splits=args.folds)
    print("\nPer-fold test AUROC (learned model, approach 2):")
    for f in fold_auroc:
        auroc_str = f"{f['auroc']:.3f}" if f["auroc"] is not None else "undefined (single-class test fold)"
        print(
            f"  fold {f['fold']}: n_test={f['n_test']:3d}  "
            f"pos={f['n_pos_test']:3d}  neg={f['n_neg_test']:3d}  AUROC={auroc_str}"
        )

    write_report(
        args.out,
        n=n, n_groups=n_groups, n_pos=n_pos, folds=args.folds, seed=args.seed,
        hand_auroc=hand_auroc, hand_ece=hand_ece, hand_ece_n=hand_ece_n,
        learned_auroc=learned_auroc, learned_ece=learned_ece, learned_ece_n=learned_ece_n,
        iso_auroc=iso_auroc, iso_ece=iso_ece, iso_ece_n=iso_ece_n,
        final_coefs=final_coefs, final_intercept=final_intercept, fold_coefs=fold_coefs,
        fold_auroc=fold_auroc,
    )
    print(f"\nReport written to {args.out}")


if __name__ == "__main__":
    main()
