"""
Re-derives the 5-signal-vs-4-signal (multi_query_agreement dropped)
ablation documented in eval/README.md's "Confidence-fusion changes"
section, under BOTH permissive and strict execution-match labels, and
both in-sample and held-out (question-level 60/40 split, seed=42, same
split fit_calibration.py uses).

Uses app.detection.confidence.compute_raw_score() directly (via
eval.analyze.reconstruct_raw_score()) with an explicit weights dict per
signal set -- the TRUE raw hand-tuned score, no calibration applied (see
eval/README.md and app/detection/confidence.py's compute_raw_score()
docstring for the double-calibration bug this avoids).

Anthropic data only -- Gemini has no multi_query_agreement data by
design (MULTI_QUERY_ENABLED=false, the shipped default, for that run).

Read-only DB re-execution for strict labels (eval.analyze_strict), zero
LLM calls. Never writes to any results file.

Usage:
    python -m eval.ablation_multiquery eval/results.jsonl
"""
from __future__ import annotations

import argparse
import random
from pathlib import Path

from sklearn.metrics import roc_auc_score

from eval.analyze import reconstruct_raw_score
from eval.analyze_strict import recompute_strict_labels
from eval.fit_calibration import load_results

# The ORIGINAL 5-signal weights, before multi_query_agreement was dropped
# and the remaining four renormalized -- see confidence.py's WEIGHTS
# comment ("Renormalized from the original 5-signal weights (0.30/0.25/
# 0.20/0.10, sum 0.85)"): the fifth weight is 1.0 - 0.85 = 0.15.
WEIGHTS_5SIGNAL = {
    "schema_alignment": 0.30,
    "back_translation_match": 0.25,
    "result_sanity": 0.20,
    "sql_validity": 0.10,
    "multi_query_agreement": 0.15,
}
WEIGHTS_4SIGNAL = {
    "schema_alignment": 0.35,
    "back_translation_match": 0.29,
    "result_sanity": 0.24,
    "sql_validity": 0.12,
}


def build_rows_for_weights(results: list[dict], weights: dict[str, float]) -> list[tuple[str, float, int]]:
    """Same eligibility/shape as fit_calibration.build_rows(), but for an
    arbitrary weights dict (so both the 5- and 4-signal ablation use
    identical row-selection logic, differing only in which signals feed
    the weighted mean) and REQUIRING multi_query_agreement data present
    when it's one of the weights -- a record where it's absent/disabled
    would otherwise silently fall back to the other 4 signals, hiding
    exactly the comparison this script exists to make."""
    rows = []
    for r in results:
        if r["correct"] is None:
            continue
        if "multi_query_agreement" in weights:
            mq = r["signals"].get("multi_query_agreement")
            if mq is None or mq.get("disabled"):
                continue
        score = reconstruct_raw_score(r["signals"], weights)
        if score is None:
            continue
        rows.append((r["id"], score, 1 if r["correct"] else 0))
    return rows


def auroc_of(rows: list[tuple[str, float, int]]) -> float | None:
    if not rows:
        return None
    y = [label for _, _, label in rows]
    if len(set(y)) < 2:
        return None
    scores = [s for _, s, _ in rows]
    return roc_auc_score(y, scores)


def report_one_label_definition(label_name: str, results: list[dict], seed: int, train_frac: float) -> None:
    rows_5 = build_rows_for_weights(results, WEIGHTS_5SIGNAL)
    rows_4 = build_rows_for_weights(results, WEIGHTS_4SIGNAL)

    # Same question-level split for both signal sets, so held-out numbers
    # are comparable -- split on the 5-signal row set's question ids (a
    # subset of the 4-signal set's, since multi_query_agreement isn't
    # always present) and apply the same train/test id partition to both.
    # Same shuffle logic as fit_calibration.split_by_question(), applied
    # here directly rather than called, so both signal sets share exactly
    # one partition instead of each independently reshuffling its own
    # (different) question-id set.
    q5 = sorted({qid for qid, _, _ in rows_5})
    rng = random.Random(seed)
    shuffled = list(q5)
    rng.shuffle(shuffled)
    n_train = round(len(shuffled) * train_frac)
    train_ids = set(shuffled[:n_train])

    def split(rows):
        train = [row for row in rows if row[0] in train_ids]
        test = [row for row in rows if row[0] not in train_ids and row[0] in q5]
        return train, test

    train_5, test_5 = split(rows_5)
    train_4, test_4 = split(rows_4)

    in_sample_5 = auroc_of(rows_5)
    in_sample_4 = auroc_of(rows_4)
    held_out_5 = auroc_of(test_5)
    held_out_4 = auroc_of(test_4)

    print(f"\n=== {label_name} labels ===")
    print(f"  rows with multi_query_agreement data: {len(rows_5)}  (unique questions: {len(q5)})")
    print(f"  held-out test subset: {len(test_5)} rows")
    print()
    print(f"  {'':20s} {'in-sample':>12s} {'held-out':>12s}")
    print(f"  {'5-signal (with MQ)':20s} {in_sample_5:>12.3f} {held_out_5:>12.3f}" if held_out_5 is not None
          else f"  {'5-signal (with MQ)':20s} {in_sample_5:>12.3f} {'N/A':>12s}")
    print(f"  {'4-signal (dropped)':20s} {in_sample_4:>12.3f} {held_out_4:>12.3f}" if held_out_4 is not None
          else f"  {'4-signal (dropped)':20s} {in_sample_4:>12.3f} {'N/A':>12s}")
    delta_in_sample = in_sample_4 - in_sample_5
    print(f"  Delta (4-signal minus 5-signal), in-sample: {delta_in_sample:+.3f}"
          f"  ({'dropping MQ helps' if delta_in_sample > 0 else 'dropping MQ hurts' if delta_in_sample < 0 else 'no change'})")
    if held_out_5 is not None and held_out_4 is not None:
        delta_held_out = held_out_4 - held_out_5
        print(f"  Delta (4-signal minus 5-signal), held-out:  {delta_held_out:+.3f}"
              f"  ({'dropping MQ helps' if delta_held_out > 0 else 'dropping MQ hurts' if delta_held_out < 0 else 'no change'})")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("results", type=Path)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--train-frac", type=float, default=0.6)
    args = parser.parse_args()

    permissive_results = load_results(str(args.results))
    strict_results, skipped = recompute_strict_labels(permissive_results)
    if skipped:
        print(f"WARNING: {skipped} record(s) skipped during strict relabeling")

    report_one_label_definition("PERMISSIVE", permissive_results, args.seed, args.train_frac)
    report_one_label_definition("STRICT", strict_results, args.seed, args.train_frac)


if __name__ == "__main__":
    main()
