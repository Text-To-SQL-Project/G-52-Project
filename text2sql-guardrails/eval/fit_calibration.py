"""
Fits a publication-grade calibrator for the hand-tuned fused confidence
score (app.detection.confidence.fuse_confidence): an isotonic regression
mapping raw fused score -> calibrated P(correct), fit on a QUESTION-level
train split and evaluated on a disjoint QUESTION-level held-out split. Makes
NO new LLM calls -- pure offline re-analysis of eval/results.jsonl.

Why split by question, not by row: eval/results.jsonl has up to 3 repeats
per golden-set question (generation is non-deterministic). Splitting by row
would let repeats of the same question land on both sides of the train/test
boundary, leaking question-specific difficulty into the "held-out" estimate
-- the same leakage eval/fit_weights.py's GroupKFold is designed to avoid,
here avoided by grouping the split itself.

Usage:
    python -m eval.fit_calibration eval/results.jsonl
    python -m eval.fit_calibration eval/results.jsonl --train-frac 0.6 --seed 42 \
        --out app/detection/calibrator.joblib --plot eval/reliability_holdout.png
"""
from __future__ import annotations

import argparse
import random
from pathlib import Path

import joblib
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import roc_auc_score

from eval.analyze import reconstruct_raw_score
from eval.fit_weights import compute_ece, load_results

EVAL_DIR = Path(__file__).parent
DEFAULT_CALIBRATOR_OUT = EVAL_DIR.parent / "app" / "detection" / "calibrator.joblib"
DEFAULT_PLOT_OUT = EVAL_DIR / "reliability_holdout.png"


def build_rows(results: list[dict], strict: bool = False) -> list[tuple[str, float, int]]:
    """(question_id, raw hand-tuned fused score, correct label) for every
    usable row -- same eligibility as fit_weights.build_dataset(): a
    non-None `correct` label (answerable, non-adversarial) with at least
    one recorded signal.

    Uses reconstruct_raw_score(), NOT reconstruct_confidence_score() --
    the latter always applies whatever calibrator is currently on disk
    (app/detection/calibrator.joblib), which would mean fitting THIS
    calibrator on output that already passed through a different one
    (wrong for a from-scratch fit; actively wrong when fitting on a
    different provider's data than that calibrator was fit on). See
    eval/README.md for the bug this replaces.

    strict=True recomputes `correct` via execution_match(strict=True)
    before building rows (eval.analyze_strict.recompute_strict_labels(),
    reused directly rather than duplicated -- makes one read-only DB
    round-trip per eligible row, no LLM calls). The raw confidence score
    itself is unaffected by which label definition is used; only which
    `correct` value labels each row changes.
    """
    if strict:
        from eval.analyze_strict import recompute_strict_labels
        results, skipped = recompute_strict_labels(results)
        if skipped:
            print(f"WARNING: {skipped} record(s) skipped during strict relabeling (kept at permissive value)")

    rows = []
    for r in results:
        if r["correct"] is None:
            continue
        score = reconstruct_raw_score(r["signals"])
        if score is None:
            continue
        rows.append((r["id"], score, 1 if r["correct"] else 0))
    return rows


def split_by_question(
    rows: list[tuple[str, float, int]], train_frac: float, seed: int
) -> tuple[list[tuple[str, float, int]], list[tuple[str, float, int]]]:
    question_ids = sorted({qid for qid, _, _ in rows})  # sorted first for determinism
    rng = random.Random(seed)
    rng.shuffle(question_ids)
    n_train = round(len(question_ids) * train_frac)
    train_ids = set(question_ids[:n_train])
    test_ids = set(question_ids[n_train:])
    train_rows = [row for row in rows if row[0] in train_ids]
    test_rows = [row for row in rows if row[0] in test_ids]
    return train_rows, test_rows


def _bin_points(scores: list[float], labels: list[int], n_bins: int = 10):
    bins: list[list[tuple[float, int]]] = [[] for _ in range(n_bins)]
    for s, label in zip(scores, labels):
        idx = min(int(max(0.0, min(1.0, s)) * n_bins), n_bins - 1)
        bins[idx].append((s, label))
    bin_conf, bin_acc, bin_n = [], [], []
    for b in bins:
        if not b:
            continue
        bin_conf.append(sum(s for s, _ in b) / len(b))
        bin_acc.append(sum(label for _, label in b) / len(b))
        bin_n.append(len(b))
    return bin_conf, bin_acc, bin_n


def plot_holdout_reliability(scores: list[float], labels: list[int], out_path: Path, n_bins: int = 10) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    bin_conf, bin_acc, bin_n = _bin_points(scores, labels, n_bins)
    n, ece = compute_ece(scores, labels, n_bins)

    fig, ax = plt.subplots(figsize=(6, 6))
    ax.plot([0, 1], [0, 1], linestyle="--", color="gray", linewidth=1, label="Perfect calibration")
    if bin_conf:
        ax.plot(bin_conf, bin_acc, color="tab:green", alpha=0.6, zorder=2)
        ax.scatter(bin_conf, bin_acc, s=[30 + n * 8 for n in bin_n], color="tab:green", zorder=3,
                    label="Held-out, isotonic-calibrated (bin size = point size)")
        for conf, acc, cnt in zip(bin_conf, bin_acc, bin_n):
            ax.annotate(str(cnt), (conf, acc), textcoords="offset points", xytext=(6, 4), fontsize=8)
    ax.set_xlabel("Calibrated confidence (isotonic, fit on train split only)")
    ax.set_ylabel("Observed accuracy (execution_match)")
    ax.set_title(f"Held-out reliability diagram (n={n}, ECE={ece:.3f})")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.legend(loc="upper left", fontsize=8)
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser(description="Fit + evaluate an isotonic calibrator, held out by question.")
    parser.add_argument("results", type=Path)
    parser.add_argument("--train-frac", type=float, default=0.6)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", type=Path, default=DEFAULT_CALIBRATOR_OUT)
    parser.add_argument("--plot", type=Path, default=DEFAULT_PLOT_OUT)
    parser.add_argument(
        "--strict", action="store_true",
        help="Recompute `correct` via execution_match(strict=True) before fitting -- "
             "leaderboard-comparable labels instead of this project's permissive default.",
    )
    args = parser.parse_args()

    results = load_results(str(args.results))
    rows = build_rows(results, strict=args.strict)
    if args.strict:
        print("Labels: STRICT (execution_match(strict=True), recomputed via live re-execution)")
    else:
        print("Labels: permissive (stored `correct` field, this project's default methodology)")
    train_rows, test_rows = split_by_question(rows, args.train_frac, args.seed)

    train_ids = sorted({q for q, _, _ in train_rows})
    test_ids = sorted({q for q, _, _ in test_rows})
    print(f"Usable rows: {len(rows)}  (unique questions: {len(train_ids) + len(test_ids)})")
    print(f"Train: {len(train_ids)} questions, {len(train_rows)} rows, "
          f"{sum(y for _, _, y in train_rows)} correct / {len(train_rows) - sum(y for _, _, y in train_rows)} incorrect")
    print(f"Test:  {len(test_ids)} questions, {len(test_rows)} rows, "
          f"{sum(y for _, _, y in test_rows)} correct / {len(test_rows) - sum(y for _, _, y in test_rows)} incorrect")

    X_train = [s for _, s, _ in train_rows]
    y_train = [y for _, _, y in train_rows]
    X_test = [s for _, s, _ in test_rows]
    y_test = [y for _, _, y in test_rows]

    # --- Baseline: raw hand-tuned score on the SAME held-out split (no
    # calibration), so the calibration effect is isolated from the
    # train/test split itself. ---
    raw_auroc = roc_auc_score(y_test, X_test)
    raw_n, raw_ece = compute_ece(X_test, y_test)
    print(f"\nHeld-out, RAW hand-tuned score (no calibration): AUROC={raw_auroc:.3f}  ECE={raw_ece:.3f} (n={raw_n})")

    # --- Isotonic regression, fit on train only. ---
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
    iso.fit(X_train, y_train)
    calibrated_test = iso.predict(X_test)

    # Isotonic is monotonic NON-DECREASING, not strictly increasing -- it
    # can (and typically does) map several distinct raw scores to the same
    # flat output where the fit found no significant difference in
    # empirical accuracy between them. Those new ties get 0.5 credit each
    # in roc_auc_score's pairwise comparison instead of a strict win/loss,
    # so a small AUROC shift vs. the raw score is expected, not a bug --
    # only a *rank-order inversion* (a strict decrease beyond what ties can
    # explain) would indicate something wrong with out_of_bounds handling.
    cal_auroc = roc_auc_score(y_test, calibrated_test)
    cal_n, cal_ece = compute_ece(list(calibrated_test), y_test)
    print(f"Held-out, ISOTONIC-CALIBRATED:                   AUROC={cal_auroc:.3f}  ECE={cal_ece:.3f} (n={cal_n})")
    if abs(cal_auroc - raw_auroc) > 1e-9:
        print(f"  (calibrated AUROC differs from raw by {cal_auroc - raw_auroc:+.4f} -- expected, from "
              f"ties introduced by isotonic's flat regions, not a rank-order change.)")

    print(f"\nFor reference -- prior in-sample ECE figures (not held-out, cited for comparison only):")
    print(f"  0.267  = 5-signal hand-tuned fusion (includes multi_query_agreement), full n=405, in-sample")
    print(f"  0.227  = 4-signal hand-tuned fusion (multi_query_agreement dropped), full n=405, in-sample")

    if args.plot:
        plot_holdout_reliability(list(calibrated_test), y_test, args.plot)
        print(f"\nHeld-out reliability diagram written to {args.plot}")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(iso, args.out)
    print(f"Calibrator fit on train split ({len(train_rows)} rows) saved to {args.out}")


if __name__ == "__main__":
    main()
