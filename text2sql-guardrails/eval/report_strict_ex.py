"""
Reports permissive vs strict execution accuracy (see eval/metrics.py's
execution_match(strict=...) and eval/README.md's "Strict mode" section)
for an existing results.jsonl, WITHOUT modifying that file and WITHOUT
making any LLM calls -- pred_sql/gold_sql are both already-generated SQL
strings recorded at run time; this only re-executes them (read-only
queries) to recover the raw rows/columns results.jsonl doesn't persist
(see eval/recompute_correctness.py's docstring for why that re-execution
step is necessary at all).

Deliberately a separate, read-only script rather than reusing
eval/recompute_correctness.py: that script overwrites its input file with
recomputed `correct` labels, which is exactly what must NOT happen to the
paper's existing results.jsonl here.

Usage:
    python -m eval.report_strict_ex eval/results.jsonl
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from sqlalchemy import text

from app.db import get_eval_engine
from eval.metrics import execution_match, strip_trailing_limit


def load_results(path: str) -> list[dict]:
    records = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("results", type=Path)
    args = parser.parse_args()

    records = load_results(str(args.results))
    engine = get_eval_engine()

    considered = 0  # answerable, non-adversarial, status == "success"
    permissive_correct = 0
    strict_correct = 0
    permissive_mismatches = []  # stored `correct` disagreed with a fresh permissive recompute
    flips_permissive_true_strict_false = []
    skipped_error = 0

    for r in records:
        if r["correct"] is None:
            continue  # not an answerable/non-adversarial case
        if r["status"] != "success" or not r["pred_sql"]:
            continue  # answerable question, system didn't produce an answer -- correct either way

        considered += 1
        ordered = bool(r["ordered"])
        gold_sql_permissive = r["gold_sql"] if ordered else strip_trailing_limit(r["gold_sql"])
        gold_sql_strict = r["gold_sql"]  # strict never strips -- departure #3 off

        try:
            with engine.connect() as conn:
                pred_cursor = conn.execute(text(r["pred_sql"]))
                pred_columns = list(pred_cursor.keys())
                pred_rows = [list(row) for row in pred_cursor.fetchall()]

                gold_cursor_p = conn.execute(text(gold_sql_permissive))
                gold_columns_p = list(gold_cursor_p.keys())
                gold_rows_p = [list(row) for row in gold_cursor_p.fetchall()]

                if gold_sql_strict == gold_sql_permissive:
                    gold_columns_s, gold_rows_s = gold_columns_p, gold_rows_p
                else:
                    gold_cursor_s = conn.execute(text(gold_sql_strict))
                    gold_columns_s = list(gold_cursor_s.keys())
                    gold_rows_s = [list(row) for row in gold_cursor_s.fetchall()]
        except Exception as e:
            print(f"WARNING: {r['id']} run={r['run']} failed to re-execute: {e}")
            skipped_error += 1
            considered -= 1
            continue

        is_permissive = execution_match(
            r["pred_sql"], pred_columns, pred_rows,
            gold_sql_permissive, gold_columns_p, gold_rows_p,
            ordered=ordered, strict=False,
        )
        is_strict = execution_match(
            r["pred_sql"], pred_columns, pred_rows,
            gold_sql_strict, gold_columns_s, gold_rows_s,
            strict=True,
        )

        if is_permissive != r["correct"]:
            permissive_mismatches.append(f"{r['id']} run={r['run']} stored={r['correct']} recomputed={is_permissive}")
        if is_permissive:
            permissive_correct += 1
        if is_strict:
            strict_correct += 1
        if is_permissive and not is_strict:
            flips_permissive_true_strict_false.append(f"{r['id']} run={r['run']}")

    print(f"Loaded {len(records)} record(s) from {args.results}")
    print(f"Considered (answerable, non-adversarial, status=success, re-executable): {considered}")
    print(f"Skipped (re-execution error): {skipped_error}")
    print()
    if permissive_mismatches:
        print(f"NOTE: {len(permissive_mismatches)} record(s) where a fresh permissive recompute "
              f"disagrees with the stored `correct` label (informational -- results.jsonl untouched):")
        for m in permissive_mismatches[:20]:
            print(f"  {m}")
        if len(permissive_mismatches) > 20:
            print(f"  ... and {len(permissive_mismatches) - 20} more")
        print()

    permissive_ex = permissive_correct / considered if considered else 0.0
    strict_ex = strict_correct / considered if considered else 0.0
    gap = permissive_ex - strict_ex

    print("=== EX report (recomputed offline, no LLM calls, results.jsonl NOT modified) ===")
    print(f"  Permissive EX (this project's methodology): {permissive_ex:.3f}  ({permissive_correct}/{considered})")
    print(f"  Strict EX (leaderboard-comparable):          {strict_ex:.3f}  ({strict_correct}/{considered})")
    print(f"  Gap (permissive - strict):                   {gap:+.3f}")
    print()
    print(f"  {len(flips_permissive_true_strict_false)} case(s) score correct under permissive but NOT strict:")
    for x in flips_permissive_true_strict_false:
        print(f"    {x}")


if __name__ == "__main__":
    main()
