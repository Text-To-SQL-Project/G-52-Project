"""
Strict-label companion to eval/analyze.py: recomputes `correct` under
execution_match(strict=True) (see eval/metrics.py, eval/README.md's
"Strict mode" section) for every answerable, non-adversarial, status
"success" record, then reports EX and per-signal/fused AUROC under BOTH
label definitions side by side -- permissive (the stored `correct` field,
already decided by execution_match(strict=False) at run time -- this
project's own methodology) and strict (leaderboard-comparable).

Deliberately reuses analyze.py's detection_f1_auroc()/ablation_study()
UNCHANGED against a copy of the records with `correct` overwritten to the
strict value, rather than reimplementing the AUROC computation --
guarantees the two label definitions are scored by bug-for-bug identical
logic, with only the label source differing.

Read-only DB queries only (re-executes pred_sql/gold_sql to recover the
raw rows/columns results.jsonl doesn't persist -- same reason
eval/recompute_correctness.py needs this), zero LLM calls. Never writes
back to the input file.

Usage:
    python -m eval.analyze_strict eval/results_gemini.jsonl
"""
from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path

from sqlalchemy import text

from app.db import get_eval_engine
from eval.analyze import ablation_study, detection_f1_auroc, execution_accuracy_from_stored
from eval.metrics import execution_match


def load_results(path: str) -> list[dict]:
    records = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def recompute_strict_labels(records: list[dict]) -> tuple[list[dict], int]:
    """Returns a NEW list of records (input untouched) with `correct`
    overwritten to the strict-mode value for every eligible record, and
    the count of records that could not be re-executed (skipped, left at
    their permissive value)."""
    engine = get_eval_engine()
    strict_records = copy.deepcopy(records)
    skipped = 0

    for r in strict_records:
        if r["correct"] is None or r["status"] != "success" or not r["pred_sql"]:
            continue  # not eligible either way -- same as permissive

        gold_sql_strict = r["gold_sql"]

        try:
            with engine.connect() as conn:
                pred_cursor = conn.execute(text(r["pred_sql"]))
                pred_columns = list(pred_cursor.keys())
                pred_rows = [list(row) for row in pred_cursor.fetchall()]

                # Strict mode never strips gold's LIMIT (departure #3, see
                # eval/README.md), so always re-execute gold_sql AS
                # AUTHORED here, regardless of whether that happens to
                # match the permissive (possibly-stripped) version.
                gold_cursor = conn.execute(text(gold_sql_strict))
                gold_columns = list(gold_cursor.keys())
                gold_rows = [list(row) for row in gold_cursor.fetchall()]
        except Exception as e:
            print(f"WARNING: {r['id']} run={r['run']} failed to re-execute for strict labeling: {e}")
            skipped += 1
            continue

        r["correct"] = execution_match(
            r["pred_sql"], pred_columns, pred_rows,
            gold_sql_strict, gold_columns, gold_rows,
            strict=True,
        )

    return strict_records, skipped


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("results", type=Path)
    args = parser.parse_args()

    permissive_records = load_results(str(args.results))
    strict_records, skipped = recompute_strict_labels(permissive_records)

    print(f"Loaded {len(permissive_records)} record(s) from {args.results}")
    print(f"Records re-executed for strict labeling; {skipped} skipped (re-execution error, kept at permissive value)")
    print()

    permissive_ex = execution_accuracy_from_stored(permissive_records)
    strict_ex = execution_accuracy_from_stored(strict_records)
    print("=== Execution accuracy ===")
    print(f"  Permissive: {permissive_ex:.3f}")
    print(f"  Strict:     {strict_ex:.3f}")
    print(f"  Gap:        {permissive_ex - strict_ex:+.3f}")
    print()

    print("=== Per-signal AUROC: permissive vs strict ===")
    perm_f1auroc = detection_f1_auroc(permissive_records)
    strict_f1auroc = detection_f1_auroc(strict_records)
    all_keys = sorted(set(perm_f1auroc) | set(strict_f1auroc))
    print(f"  {'signal':24s} {'permissive':>10s} {'strict':>10s} {'delta':>8s}")
    for key in all_keys:
        p = perm_f1auroc.get(key, {}).get("auroc")
        s = strict_f1auroc.get(key, {}).get("auroc")
        p_str = f"{p:.3f}" if p is not None else "N/A"
        s_str = f"{s:.3f}" if s is not None else "N/A"
        delta_str = f"{s - p:+.3f}" if (p is not None and s is not None) else "N/A"
        print(f"  {key:24s} {p_str:>10s} {s_str:>10s} {delta_str:>8s}")
    print()

    print("=== Fused confidence AUROC (full signal set): permissive vs strict ===")
    perm_ablation = ablation_study(permissive_records)
    strict_ablation = ablation_study(strict_records)
    perm_auroc = perm_ablation["full_auroc"]
    strict_auroc = strict_ablation["full_auroc"]
    perm_str = f"{perm_auroc:.3f}" if perm_auroc is not None else "N/A"
    strict_str = f"{strict_auroc:.3f}" if strict_auroc is not None else "N/A"
    print(f"  Permissive: {perm_str}  (n={perm_ablation['n']})")
    print(f"  Strict:     {strict_str}  (n={strict_ablation['n']})")
    if perm_auroc is not None and strict_auroc is not None:
        print(f"  Delta:      {strict_auroc - perm_auroc:+.3f}")


if __name__ == "__main__":
    main()
