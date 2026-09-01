"""
Offline analysis over eval/results.jsonl (produced by eval/runner.py).
Computes no NEW correctness logic of its own for execution -- `correct`
was already decided by eval/metrics.execution_match() at record time and is
read directly from the stored field, since results.jsonl deliberately does
not persist raw predicted rows (see eval/runner.py's schema). refusal_rate
and block_rate mirror eval.metrics.refusal_accuracy()/block_accuracy()
exactly (same case filters, same status checks) -- those two are reused
directly since they only need each record's "status" field, which IS
stored. See eval/README.md for the full criterion definition.

Usage:
    python -m eval.analyze eval/results.jsonl
    python -m eval.analyze eval/results.jsonl --plot eval/reliability.png
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

from sklearn.metrics import f1_score, roc_auc_score

from app.api.models import ConfidenceSignal, SignalStatus
from app.detection.confidence import WEIGHTS, fuse_confidence
from eval.metrics import block_accuracy, clarification_accuracy, load_golden_set, refusal_accuracy

EVAL_DIR = Path(__file__).parent
DEFAULT_GOLDEN = EVAL_DIR / "golden_set.jsonl"


def load_results(path: str) -> list[dict]:
    records = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def execution_accuracy_from_stored(records: list[dict]) -> float:
    """Mirrors eval.metrics.execution_accuracy()'s case filter (answerable,
    non-adversarial) but reads the already-decided `correct` field instead
    of re-executing gold_sql -- results.jsonl doesn't store raw predicted
    rows/columns, only the verdict runner.py computed at the time via
    execution_match()."""
    cases = [r for r in records if r["answerable"] and not r["adversarial"]]
    if not cases:
        return 0.0
    correct = sum(1 for r in cases if r["correct"] is True)
    return correct / len(cases)


def reconstruct_confidence_score(signals: dict) -> float | None:
    """Rebuild the fused overall confidence score from a result record's
    stored per-signal {"score","status","disabled"} dict, using the exact
    same app.detection.confidence.fuse_confidence() the live pipeline
    calls -- not a re-derivation of its logic. Returns None if no signals
    were recorded at all (pipeline exited before any detector ran, e.g.
    blocked/clarification/generation-error)."""
    if not signals:
        return None
    return _fuse_excluding(signals, None)


def status_breakdown(records: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for r in records:
        counts[r["status"] or "None"] += 1
    return dict(counts)


def is_wrong_label(r: dict) -> bool | None:
    """Ground truth for the detection F1/AUROC and ablation analyses below:
    was this record's outcome actually wrong? Restricted to records where
    at least one detector signal was computed -- blocked/clarification
    records short-circuit the pipeline before any detector runs (empty
    `signals`), so there is no detector output to score there; this
    returns None for those (exclude from the analysis) rather than
    guessing a label for data that doesn't exist.

    For records WITH signals (status is "success", or "error" from a
    post-guardrail execution failure with partial pre-execution signals):
      - category "unanswerable", or adversarial=true: reaching this point
        with real signal data means the system did NOT refuse/block --
        i.e. it produced a plausible-looking answer to a question it
        should have declined. Always wrong (True).
      - otherwise (answerable, non-adversarial): wrong unless `correct`
        is exactly True.
    """
    if not r["signals"]:
        return None
    if r["category"] == "unanswerable" or r["adversarial"]:
        return True
    return r["correct"] is not True


def detection_f1_auroc(results: list[dict]) -> dict[str, dict]:
    """Per-signal detection performance: how well does each individual
    detector, on its own, separate actually-wrong outcomes from actually-
    correct ones? AUROC uses the continuous score (as 1-score, since a LOW
    signal score is meant to indicate trouble); F1 uses the signal's own
    status field binarized as flagged=(status != "pass") against the same
    ground truth -- the real operational threshold the system already
    uses, not an arbitrary cutoff. disabled signals are excluded (a
    disabled signal's 0.5 placeholder is not a real measurement)."""
    per_signal: dict[str, list[tuple[float, str, bool]]] = defaultdict(list)
    for r in results:
        label = is_wrong_label(r)
        if label is None:
            continue
        for key, sig in r["signals"].items():
            if sig.get("disabled"):
                continue
            per_signal[key].append((sig["score"], sig["status"], label))

    out = {}
    for key in sorted(per_signal):
        rows = per_signal[key]
        y_true = [1 if wrong else 0 for _, _, wrong in rows]
        y_score = [1 - score for score, _, _ in rows]
        y_pred = [0 if status == "pass" else 1 for _, status, _ in rows]

        n = len(y_true)
        n_pos = sum(y_true)
        auroc = roc_auc_score(y_true, y_score) if 0 < n_pos < n else None
        f1 = f1_score(y_true, y_pred, zero_division=0)
        out[key] = {"n": n, "n_wrong": n_pos, "auroc": auroc, "f1": f1}
    return out


def _fuse_excluding(signals: dict, exclude_key: str | None) -> float:
    """Rebuild the fused confidence score from a record's stored signals,
    optionally excluding one signal entirely (not just zeroing its weight
    -- fuse_confidence() renormalizes over whatever's left, matching how
    it already handles a missing/disabled signal)."""
    reconstructed = []
    for key, sig in signals.items():
        if key not in WEIGHTS or key == exclude_key:
            continue
        reconstructed.append(ConfidenceSignal(
            key=key, label=key, score=sig["score"],
            status=SignalStatus(sig["status"]),
            detail="disabled (reconstructed)" if sig.get("disabled") else None,
        ))
    return fuse_confidence(reconstructed).score


def ablation_study(results: list[dict]) -> dict:
    """Leave-one-signal-out ablation over fuse_confidence(): for every
    record with a computable ground-truth label, compute the fused score
    with all present signals, and again with each signal individually
    excluded (see _fuse_excluding). Compares AUROC (fused score
    discriminating actually-correct from actually-wrong) full vs each
    leave-one-out variant -- the signal whose removal causes the LARGEST
    AUROC drop is the most "load-bearing": fuse_confidence relies on it
    the most to separate correct from incorrect outcomes. A signal that
    was simply absent from a given record (e.g. disabled) contributes no
    difference for that record, which is the correct behavior, not a
    special case that needs handling."""
    y_true: list[int] = []
    full_scores: list[float] = []
    loo_scores: dict[str, list[float]] = {k: [] for k in WEIGHTS}

    for r in results:
        label = is_wrong_label(r)
        if label is None:
            continue
        y_true.append(1 if label else 0)
        full_scores.append(1 - _fuse_excluding(r["signals"], None))
        for key in WEIGHTS:
            loo_scores[key].append(1 - _fuse_excluding(r["signals"], key))

    n = len(y_true)
    n_pos = sum(y_true)
    if not (0 < n_pos < n):
        return {"n": n, "full_auroc": None, "drops": {}}

    full_auroc = roc_auc_score(y_true, full_scores)
    drops = {key: full_auroc - roc_auc_score(y_true, scores) for key, scores in loo_scores.items()}
    return {"n": n, "full_auroc": full_auroc, "drops": drops}


def print_report(golden: list[dict], results: list[dict]) -> None:
    print(f"Loaded {len(results)} result record(s)")
    print(f"Golden set: {len(golden)} case(s)")

    ids_seen = {r["id"] for r in results}
    ids_expected = {g["id"] for g in golden}
    missing = ids_expected - ids_seen
    if missing:
        print(f"WARNING: {len(missing)} golden case(s) have NO result record at all: {sorted(missing)}")

    runs = sorted({r["run"] for r in results})
    print(f"Repeats present: {runs}")

    print("\n--- Status by category (all runs pooled) ---")
    by_cat: dict[str, list[dict]] = defaultdict(list)
    for r in results:
        by_cat[r["category"]].append(r)
    for cat in sorted(by_cat):
        recs = by_cat[cat]
        print(f"  {cat:14s} (n={len(recs):3d}): {status_breakdown(recs)}")
        if cat == "adversarial":
            direct = [r for r in recs if r.get("direct_sql")]
            llm_mediated = [r for r in recs if not r.get("direct_sql")]
            if direct:
                print(f"    direct_sql     (n={len(direct):3d}): {status_breakdown(direct)}")
            if llm_mediated:
                print(f"    llm_mediated   (n={len(llm_mediated):3d}): {status_breakdown(llm_mediated)}")

    print("\n--- Safety check: adversarial cases that executed ---")
    safety_failures = [r for r in results if r["adversarial"] and r["executed"]]
    if safety_failures:
        print(f"  !!! {len(safety_failures)} SAFETY FAILURE(S) !!!")
        for r in safety_failures:
            print(f"    id={r['id']} run={r['run']} question={r['question']!r}")
            print(f"      pred_sql={r['pred_sql']!r}")
    else:
        print(f"  None. All {len(by_cat.get('adversarial', []))} adversarial case(s) were blocked/refused before execution.")

    print("\n--- Metrics per run index ---")
    for run in runs:
        run_records = [r for r in results if r["run"] == run]
        predictions = {r["id"]: r for r in run_records}
        ra = refusal_accuracy(golden, predictions)
        ca = clarification_accuracy(golden, predictions)
        ba = block_accuracy(golden, predictions)
        ba_direct = block_accuracy(golden, predictions, direct_sql=True)
        ba_llm = block_accuracy(golden, predictions, direct_sql=False)
        ea = execution_accuracy_from_stored(run_records)
        print(f"  run={run}: refusal_accuracy={ra:.3f}  clarification_accuracy={ca:.3f}  "
              f"block_accuracy={ba:.3f}  execution_accuracy={ea:.3f}")
        print(f"    block_accuracy split: direct_sql={ba_direct:.3f} (guardrail layer)  "
              f"llm_mediated={ba_llm:.3f} (often neutralized upstream of guardrails -- see eval/README.md)")

    if len(runs) > 1:
        ras, cas, bas, bas_direct, bas_llm, eas = [], [], [], [], [], []
        for run in runs:
            run_records = [r for r in results if r["run"] == run]
            predictions = {r["id"]: r for r in run_records}
            ras.append(refusal_accuracy(golden, predictions))
            cas.append(clarification_accuracy(golden, predictions))
            bas.append(block_accuracy(golden, predictions))
            bas_direct.append(block_accuracy(golden, predictions, direct_sql=True))
            bas_llm.append(block_accuracy(golden, predictions, direct_sql=False))
            eas.append(execution_accuracy_from_stored(run_records))

        def _mean_std(xs: list[float]) -> tuple[float, float]:
            m = sum(xs) / len(xs)
            var = sum((x - m) ** 2 for x in xs) / len(xs)
            return m, var ** 0.5

        rm, rs = _mean_std(ras)
        cm, cs = _mean_std(cas)
        bm, bs = _mean_std(bas)
        bdm, bds = _mean_std(bas_direct)
        blm, bls = _mean_std(bas_llm)
        em, es = _mean_std(eas)
        print(f"\n  across {len(runs)} runs: refusal={rm:.3f}+/-{rs:.3f}  clarification={cm:.3f}+/-{cs:.3f}  "
              f"block={bm:.3f}+/-{bs:.3f}  execution={em:.3f}+/-{es:.3f}")
        print(f"    block split: direct_sql={bdm:.3f}+/-{bds:.3f}  llm_mediated={blm:.3f}+/-{bls:.3f}")

    errors = [r for r in results if r["status"] == "error"]
    if errors:
        print(f"\n--- {len(errors)} error record(s) ---")
        for r in errors:
            print(f"  id={r['id']} run={r['run']} category={r['category']} error={r['error']!r}")

    latencies = [r["latency_ms"] for r in results if r["latency_ms"] is not None]
    if latencies:
        print("\n--- Latency ---")
        print(f"  n={len(latencies)}  mean={sum(latencies) / len(latencies):.0f}ms  "
              f"min={min(latencies):.0f}ms  max={max(latencies):.0f}ms")

    print("\n--- Confidence signal scores (mean by key, all runs pooled) ---")
    signal_scores: dict[str, list[float]] = defaultdict(list)
    for r in results:
        for key, sig in r["signals"].items():
            if not sig.get("disabled"):
                signal_scores[key].append(sig["score"])
    for key in sorted(signal_scores):
        scores = signal_scores[key]
        print(f"  {key:24s} n={len(scores):3d}  mean={sum(scores) / len(scores):.3f}")
    if "multi_query_agreement" not in signal_scores:
        print(
            "  multi_query_agreement    -- no data (MULTI_QUERY_ENABLED=false for this run, "
            "the shipped default; dropped from fuse_confidence()'s WEIGHTS after the ablation "
            "study found its removal improved fused AUROC -- see app/detection/confidence.py). "
            "Set MULTI_QUERY_ENABLED=true before running eval.runner to re-populate it."
        )

    print("\n--- Per-signal detection performance (all runs pooled) ---")
    print("  ground truth: was the outcome actually wrong? (see is_wrong_label() docstring)")
    f1_auroc = detection_f1_auroc(results)
    for key in sorted(f1_auroc):
        m = f1_auroc[key]
        auroc_str = f"{m['auroc']:.3f}" if m["auroc"] is not None else "N/A (single class)"
        print(f"  {key:24s} n={m['n']:3d}  n_wrong={m['n_wrong']:3d}  AUROC={auroc_str}  F1={m['f1']:.3f}")
    if "multi_query_agreement" not in f1_auroc:
        print("  multi_query_agreement    -- no data, same reason as above; skipping.")

    print("\n--- Ablation: leave-one-signal-out AUROC drop (fused confidence discriminating correct/wrong) ---")
    ablation = ablation_study(results)
    most_load_bearing = None
    if ablation["full_auroc"] is None:
        print(f"  n={ablation['n']}: insufficient class variation to compute AUROC.")
    else:
        print(f"  n={ablation['n']}  full-signal-set AUROC={ablation['full_auroc']:.3f}")
        drops = ablation["drops"]
        most_load_bearing = max(drops, key=drops.get)
        for key in sorted(drops, key=drops.get, reverse=True):
            marker = "  <-- most load-bearing" if key == most_load_bearing else ""
            print(f"    without {key:24s} AUROC drop = {drops[key]:+.3f}{marker}")

    ece_n, ece = compute_ece(results)
    ea_all = execution_accuracy_from_stored(results)
    ba_direct_all = block_accuracy(golden, {r["id"]: r for r in results if r["run"] == runs[0]}, direct_sql=True)
    unsafe_executed = [r for r in results if r["adversarial"] and r["executed"]]

    print("\n=== Report summary ===")
    print(f"  EX (execution_accuracy, all runs pooled):        {ea_all:.3f}")
    print(f"  ECE (n={ece_n}):                                       {ece:.3f}")
    print(f"  Guardrail block rate (direct_sql, run {runs[0]}):       "
          f"{ba_direct_all:.3f}  <- the guardrail-layer number; see eval/README.md before citing the unsplit block_accuracy")
    print(f"  Unsafe queries executed (adversarial+executed):   {len(unsafe_executed)} "
          f"(inspect each -- see 'Safety check' above; not all executed SQL is necessarily destructive)")
    if most_load_bearing is not None:
        print(f"  Most load-bearing signal (ablation):              {most_load_bearing} "
              f"(AUROC drop {ablation['drops'][most_load_bearing]:+.3f} when removed)")
    else:
        print("  Most load-bearing signal (ablation):              N/A (insufficient data)")


def _reliability_bins(results: list[dict], n_bins: int = 10) -> tuple[list[float], list[float], list[int]]:
    """Bin (fused confidence, correct) points into n_bins equal-width
    buckets over [0, 1]. Only answerable, non-adversarial records with a
    non-None `correct` verdict and at least one recorded signal contribute
    a point. Shared by plot_reliability() and compute_ece() so the numeric
    ECE reported in the summary always matches what the plot shows."""
    points: list[tuple[float, bool]] = []
    for r in results:
        if r["correct"] is None:
            continue
        conf = reconstruct_confidence_score(r["signals"])
        if conf is None:
            continue
        points.append((conf, bool(r["correct"])))

    bins: list[list[tuple[float, bool]]] = [[] for _ in range(n_bins)]
    for conf, correct in points:
        idx = min(int(conf * n_bins), n_bins - 1)
        bins[idx].append((conf, correct))

    bin_conf, bin_acc, bin_n = [], [], []
    for b in bins:
        if not b:
            continue
        confs = [c for c, _ in b]
        corrects = [c for _, c in b]
        bin_conf.append(sum(confs) / len(confs))
        bin_acc.append(sum(corrects) / len(corrects))
        bin_n.append(len(b))
    return bin_conf, bin_acc, bin_n


def compute_ece(results: list[dict], n_bins: int = 10) -> tuple[int, float]:
    """Expected Calibration Error: the count-weighted mean absolute gap
    between each reliability bin's mean confidence and its observed
    accuracy (Guo et al. 2017). Returns (n points used, ECE)."""
    bin_conf, bin_acc, bin_n = _reliability_bins(results, n_bins)
    total = sum(bin_n)
    ece = sum((n / total) * abs(acc - conf) for conf, acc, n in zip(bin_conf, bin_acc, bin_n)) if total else 0.0
    return total, ece


def plot_reliability(results: list[dict], out_path: Path, n_bins: int = 10) -> tuple[int, float]:
    """Reliability diagram: fused predicted confidence (x) vs observed
    execution-match accuracy (y), following the standard style from Guo et
    al. 2017 ("On Calibration of Modern Neural Networks"). Returns the
    same (n, ECE) as compute_ece() -- see that function and
    _reliability_bins() for the shared binning/ECE logic."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    bin_conf, bin_acc, bin_n = _reliability_bins(results, n_bins)
    total, ece = compute_ece(results, n_bins)

    fig, ax = plt.subplots(figsize=(6, 6))
    ax.plot([0, 1], [0, 1], linestyle="--", color="gray", linewidth=1, label="Perfect calibration")
    if bin_conf:
        ax.plot(bin_conf, bin_acc, color="tab:blue", alpha=0.6, zorder=2)
        ax.scatter(bin_conf, bin_acc, s=[30 + n * 8 for n in bin_n], color="tab:blue", zorder=3, label="Observed (bin size = point size)")
        for conf, acc, n in zip(bin_conf, bin_acc, bin_n):
            ax.annotate(str(n), (conf, acc), textcoords="offset points", xytext=(6, 4), fontsize=8)
    ax.set_xlabel("Predicted confidence (fused, from app.detection.confidence.fuse_confidence)")
    ax.set_ylabel("Observed accuracy (execution_match)")
    ax.set_title(f"Reliability diagram (n={total}, ECE={ece:.3f})")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.legend(loc="upper left", fontsize=8)
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    return total, ece


def main() -> None:
    parser = argparse.ArgumentParser(description="Analyze eval/results.jsonl.")
    parser.add_argument("results", type=Path, help="Path to results.jsonl")
    parser.add_argument("--golden", type=Path, default=DEFAULT_GOLDEN)
    parser.add_argument("--plot", type=Path, default=None, help="Write a reliability diagram PNG to this path.")
    args = parser.parse_args()

    golden = load_golden_set(str(args.golden))
    results = load_results(str(args.results))

    print_report(golden, results)

    if args.plot:
        n_points, ece = plot_reliability(results, args.plot)
        print(f"\nReliability diagram written to {args.plot} ({n_points} point(s), ECE={ece:.3f})")


if __name__ == "__main__":
    main()
