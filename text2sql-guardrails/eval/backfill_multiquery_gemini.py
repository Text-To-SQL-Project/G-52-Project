"""
One-off backfill: adds real multi_query_agreement data to the 120 run=1
"success" records in eval/results_gemini.jsonl. That run used the shipped
MULTI_QUERY_ENABLED=false default, so those records have no data for this
signal at all -- unlike eval/results.jsonl (Anthropic), which predates
this project's removal of eval/runner.py's old force-enable override and
already has it for 413/483 records.

Re-executes each qualifying record's ALREADY-STORED pred_sql (read-only,
no LLM call -- results_gemini.jsonl doesn't persist raw predicted rows)
to recover primary_rows, then calls check_multi_query_agreement() for
real: exactly ONE new LLM call per record (generate_sql_variant(), since
MULTI_QUERY_N=2 means n_variants=1).

Does NOT change the shipped MULTI_QUERY_ENABLED default or WEIGHTS --
sets the env var only for this script's own process, before any app
import, so the detector actually runs instead of returning its disabled
placeholder. The live app and .env.example are untouched.

Updates ONLY signals.multi_query_agreement plus prompt_tokens/
completion_tokens (incremented for the new call) on each qualifying
record; every other record and field is preserved exactly.

Usage:
    python -m eval.backfill_multiquery_gemini eval/results_gemini.jsonl
"""
from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path

# Must happen before any app.* import -- app.config.Settings reads env
# vars at class-definition time.
os.environ["MULTI_QUERY_ENABLED"] = "true"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

from sqlalchemy import text  # noqa: E402

import app.generation.llm_client as llm_client  # noqa: E402
from app.db import get_readonly_engine  # noqa: E402
from app.detection.multi_query import check_multi_query_agreement  # noqa: E402


def main() -> None:
    path = Path(sys.argv[1])
    records = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))

    engine = get_readonly_engine()
    updated = 0
    skipped = 0

    for r in records:
        if r["run"] != 1 or r["status"] != "success" or not r["pred_sql"]:
            continue

        try:
            with engine.connect() as conn:
                cursor = conn.execute(text(r["pred_sql"]))
                primary_rows = [list(row) for row in cursor.fetchall()]
        except Exception as e:
            print(f"SKIP {r['id']}: could not re-execute stored pred_sql: {e}")
            skipped += 1
            continue

        signal = check_multi_query_agreement(r["question"], r["pred_sql"], primary_rows)
        usage = llm_client.get_last_usage()

        r["signals"]["multi_query_agreement"] = {
            "score": signal.score,
            "status": signal.status.value,
            "disabled": bool(signal.detail) and "disabled" in signal.detail.lower(),
        }
        r["prompt_tokens"] = r.get("prompt_tokens", 0) + usage["prompt_tokens"]
        r["completion_tokens"] = r.get("completion_tokens", 0) + usage["completion_tokens"]

        updated += 1
        print(f"[{updated}] {r['id']}: score={signal.score} status={signal.status.value} "
              f"disabled={r['signals']['multi_query_agreement']['disabled']}")

    with open(path, "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")

    print(f"\nDone. Updated {updated} record(s), skipped {skipped} (re-execution error).")
    print(f"Total LLM calls made: {updated}")


if __name__ == "__main__":
    main()
