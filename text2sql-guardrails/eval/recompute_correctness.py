"""
Recomputes the `correct` field in eval/results.jsonl using the CURRENT
eval.metrics.execution_match() criterion, without re-running the pipeline
(no new LLM calls). Necessary because results.jsonl doesn't persist raw
predicted rows/columns (kept lean by design), so recomputation re-executes
pred_sql and gold_sql fresh against the DB (read-only queries only) to get
them again.

Use this whenever execution_match()'s comparison logic changes and you want
existing results relabeled under the new criterion rather than paying for a
full re-run.

Usage:
    python -m eval.recompute_correctness eval/results.jsonl
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from sqlalchemy import text

from app.db import get_eval_engine
from eval.metrics import execution_match, strip_trailing_limit

EVAL_DIR = Path(__file__).parent


def load_results(path: str) -> list[dict]:
    records = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("results", type=Path)
    args = parser.parse_args()

    records = load_results(str(args.results))
    engine = get_eval_engine()

    changed_to_true = []
    changed_to_false = []
    unchanged = 0
    skipped_not_applicable = 0
    skipped_error = 0

    for r in records:
        if r["correct"] is None:
            skipped_not_applicable += 1
            continue
        if r["status"] != "success" or not r["pred_sql"]:
            # Not a success -> correct stays False by the same policy
            # runner.py uses (answerable question, no answer produced).
            if r["correct"] is not False:
                changed_to_false.append(r["id"])
                r["correct"] = False
            else:
                unchanged += 1
            continue

        gold_sql = r["gold_sql"] if r["ordered"] else strip_trailing_limit(r["gold_sql"])
        try:
            with engine.connect() as conn:
                pred_cursor = conn.execute(text(r["pred_sql"]))
                pred_columns = list(pred_cursor.keys())
                pred_rows = [list(row) for row in pred_cursor.fetchall()]

                gold_cursor = conn.execute(text(gold_sql))
                gold_columns = list(gold_cursor.keys())
                gold_rows = [list(row) for row in gold_cursor.fetchall()]
        except Exception as e:
            print(f"WARNING: {r['id']} run={r['run']} failed to re-execute: {e}")
            skipped_error += 1
            continue

        new_correct = execution_match(
            r["pred_sql"], pred_columns, pred_rows,
            gold_sql, gold_columns, gold_rows,
            ordered=r["ordered"],
        )

        if new_correct != r["correct"]:
            (changed_to_true if new_correct else changed_to_false).append(f"{r['id']} run={r['run']}")
            r["correct"] = new_correct
        else:
            unchanged += 1

    print(f"Unchanged: {unchanged}")
    print(f"Changed False -> True (recovered false negatives): {len(changed_to_true)}")
    for x in changed_to_true:
        print(f"  {x}")
    print(f"Changed True -> False (new false positives found): {len(changed_to_false)}")
    for x in changed_to_false:
        print(f"  {x}")
    print(f"Not applicable (no correct label): {skipped_not_applicable}")
    print(f"Skipped (re-execution error): {skipped_error}")

    with open(args.results, "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")
    print(f"\n{args.results} updated in place with recomputed `correct` labels.")


if __name__ == "__main__":
    main()
