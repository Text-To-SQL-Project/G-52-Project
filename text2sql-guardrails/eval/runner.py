"""
Runs every case in eval/golden_set.jsonl through the REAL pipeline
(app.generation -> app.safety.guardrails -> app.detection (pre) -> execute
-> app.detection (post)) and records everything the offline analysis needs
to eval/results.jsonl. Computes NO metrics itself -- that's eval/metrics.py
and (eventually) analyze.py's job; this script only records what happened.

Usage:
    python -m eval.runner --limit 5 --repeats 1
    python -m eval.runner                      # full set, 3 repeats each

Must be run from text2sql-guardrails/ (or anywhere with that directory on
sys.path) so `import app...` resolves.
"""
from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

# MUST happen before any `app...` import: app.config.Settings reads env vars
# at class-definition time, so this has to land before app.config (or
# anything that imports it) is first imported. Evaluation runs always want
# multi_query_agreement populated, regardless of what .env has it set to.
os.environ["MULTI_QUERY_ENABLED"] = "true"

from sqlalchemy import text  # noqa: E402

import app.generation.llm_client as llm_client  # noqa: E402
from app.api.models import ConfidenceSignal, SignalStatus  # noqa: E402
from app.db import get_readonly_engine  # noqa: E402
from app.detection.back_translation import check_back_translation  # noqa: E402
from app.detection.multi_query import check_multi_query_agreement  # noqa: E402
from app.detection.result_sanity import check_result_sanity  # noqa: E402
from app.detection.schema_align import check_schema_alignment  # noqa: E402
from app.generation.generator import generate_sql, is_noop_sql  # noqa: E402
from app.safety.guardrails import check_guardrails  # noqa: E402

from eval.metrics import execution_match, load_golden_set, strip_trailing_limit  # noqa: E402

EVAL_DIR = Path(__file__).parent
DEFAULT_GOLDEN = EVAL_DIR / "golden_set.jsonl"
DEFAULT_RESULTS = EVAL_DIR / "results.jsonl"


# --- LLM call counting -------------------------------------------------
# Every code path that talks to the model (generate_sql, generate_sql_variant,
# check_back_translation's two calls) funnels through llm_client.complete(),
# so wrapping it here counts every real API call this run makes, regardless
# of which detector/generator triggered it.
_llm_call_count = 0
_original_complete = llm_client.complete


def _counting_complete(system: str, user: str) -> str:
    global _llm_call_count
    _llm_call_count += 1
    return _original_complete(system, user)


llm_client.complete = _counting_complete
# generator.py imported `complete` by name at module load time, so it holds
# its own reference to the original -- patch that binding too.
import app.generation.generator as _generator_module  # noqa: E402
_generator_module.complete = _counting_complete
import app.detection.back_translation as _back_translation_module  # noqa: E402
_back_translation_module.complete = _counting_complete


def _signal_to_dict(signal: ConfidenceSignal) -> dict:
    return {
        "score": signal.score,
        "status": signal.status.value,
        "disabled": bool(signal.detail) and "disabled" in signal.detail.lower(),
    }


def run_pipeline(question: str, sql_override: str | None = None) -> dict:
    """Mirrors app.api.routes.run_query()'s pipeline (minus the
    FastAPI/pydantic request/response layer). Returns a plain dict;
    `signals` only contains whichever signals were actually computed
    before the pipeline exited (empty for blocked/clarification/generation
    -error, since those exit before any detector runs).

    sql_override bypasses generate_sql entirely, same as routes.py's
    sql_override path -- used for direct_sql golden cases, which need to
    exercise check_guardrails() against real destructive/injection SQL
    without depending on the LLM to (possibly) reproduce it faithfully."""
    out = {
        "status": None,
        "blocked": False,
        "executed": False,
        "pred_sql": None,
        "pred_columns": None,
        "pred_rows": None,
        "signals": {},
        "error": None,
    }
    t0 = time.perf_counter()

    if sql_override:
        sql = sql_override
        out["pred_sql"] = sql
    else:
        try:
            gen = generate_sql(question)
        except Exception as e:
            out["status"] = "error"
            out["error"] = f"SQL generation failed: {e}"
            out["latency_ms"] = round((time.perf_counter() - t0) * 1000, 2)
            return out

        sql = gen.sql
        out["pred_sql"] = sql

        if not sql or not sql.strip() or is_noop_sql(sql):
            # Mirrors app.api.routes.run_query(): a disguised refusal
            # (syntactically valid but no-op SQL) is routed the same as an
            # empty string -- see that function's comment for why.
            out["status"] = "clarification"
            out["latency_ms"] = round((time.perf_counter() - t0) * 1000, 2)
            return out

    guard = check_guardrails(sql)
    if not guard.passed:
        out["status"] = "blocked"
        out["blocked"] = True
        out["latency_ms"] = round((time.perf_counter() - t0) * 1000, 2)
        return out

    safe_sql = guard.safe_sql
    out["pred_sql"] = safe_sql

    alignment_signal = check_schema_alignment(safe_sql)
    back_translation_signal = check_back_translation(question, safe_sql)
    out["signals"]["sql_validity"] = _signal_to_dict(ConfidenceSignal(
        key="sql_validity", label="SQL Validity", score=1.0,
        status=SignalStatus.PASS, detail="Parses via sqlglot; passed guardrail AST checks.",
    ))
    out["signals"]["schema_alignment"] = _signal_to_dict(alignment_signal)
    out["signals"]["back_translation_match"] = _signal_to_dict(back_translation_signal)

    engine = get_readonly_engine()
    try:
        with engine.connect() as conn:
            cursor = conn.execute(text(safe_sql))
            result_columns = list(cursor.keys())
            result_rows = [list(row) for row in cursor.fetchall()]
    except Exception as e:
        out["status"] = "error"
        out["error"] = f"Execution failed: {e}"
        out["latency_ms"] = round((time.perf_counter() - t0) * 1000, 2)
        return out

    out["executed"] = True
    out["pred_columns"] = result_columns
    out["pred_rows"] = result_rows

    result_sanity_signal = check_result_sanity(safe_sql, result_columns, result_rows, question)
    multi_query_signal = check_multi_query_agreement(question, safe_sql, result_rows)
    out["signals"]["result_sanity"] = _signal_to_dict(result_sanity_signal)
    out["signals"]["multi_query_agreement"] = _signal_to_dict(multi_query_signal)

    out["status"] = "success"
    out["latency_ms"] = round((time.perf_counter() - t0) * 1000, 2)
    return out


def _load_done_pairs(results_path: Path) -> set[tuple[str, int]]:
    done = set()
    if not results_path.exists():
        return done
    with open(results_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if "id" in rec and "run" in rec:
                done.add((rec["id"], rec["run"]))
    return done


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the golden set through the real pipeline.")
    parser.add_argument("--repeats", type=int, default=3, help="Runs per case (generation is non-deterministic).")
    parser.add_argument("--limit", type=int, default=None, help="Only run the first N cases (smoke test).")
    parser.add_argument("--golden", type=Path, default=DEFAULT_GOLDEN)
    parser.add_argument("--out", type=Path, default=DEFAULT_RESULTS)
    args = parser.parse_args()

    golden = load_golden_set(str(args.golden))
    if args.limit is not None:
        golden = golden[: args.limit]

    done_pairs = _load_done_pairs(args.out)
    if done_pairs:
        print(f"Resuming: {len(done_pairs)} (id, run) pairs already in {args.out}, will be skipped.")

    # Cache gold_rows once per case (fixed data, no need to re-execute per repeat).
    engine = get_readonly_engine()
    gold_cache: dict[str, dict | None] = {}
    for case in golden:
        if case["answerable"] and not case["adversarial"]:
            # Unordered cases: strip gold_sql's own display LIMIT so the
            # cache holds the TRUE, complete answer for the subset match in
            # execution_match(). Ordered (top-N) cases keep their LIMIT --
            # it's part of the answer there, not just a display cap.
            ordered = bool(case.get("ordered"))
            gold_sql = case["gold_sql"] if ordered else strip_trailing_limit(case["gold_sql"])
            try:
                with engine.connect() as conn:
                    cursor = conn.execute(text(gold_sql))
                    gold_cache[case["id"]] = {
                        "columns": list(cursor.keys()),
                        "rows": [list(row) for row in cursor.fetchall()],
                    }
            except Exception as e:
                print(f"WARNING: gold_sql for {case['id']} failed to execute here: {e}")
                gold_cache[case["id"]] = None
        else:
            gold_cache[case["id"]] = None

    total_cases = len(golden)
    total_runs_planned = total_cases * args.repeats
    run_index = 0

    with open(args.out, "a", encoding="utf-8") as out_f:
        for case in golden:
            for run in range(1, args.repeats + 1):
                run_index += 1
                if (case["id"], run) in done_pairs:
                    print(f"[{run_index}/{total_runs_planned}] {case['id']} run={run} SKIPPED (already recorded)")
                    continue

                override = case["gold_sql"] if case.get("direct_sql") else None
                try:
                    pred = run_pipeline(case["question"], sql_override=override)
                    error = None
                except Exception as e:
                    # Belt-and-suspenders: run_pipeline() already catches its
                    # own internal errors, but nothing must kill the whole run.
                    pred = {
                        "status": "error", "blocked": False, "executed": False,
                        "pred_sql": None, "pred_columns": None, "pred_rows": None,
                        "signals": {}, "latency_ms": None, "error": None,
                    }
                    error = str(e)

                if error and not pred.get("error"):
                    pred["error"] = f"runner-level exception: {error}"

                gold = gold_cache.get(case["id"])
                correct = None
                if case["answerable"] and not case["adversarial"]:
                    if gold is None:
                        correct = None  # gold_sql itself couldn't be executed here
                    elif pred["status"] == "success" and pred["pred_rows"] is not None:
                        correct = execution_match(
                            pred["pred_columns"], pred["pred_rows"],
                            gold["columns"], gold["rows"],
                            ordered=bool(case.get("ordered")),
                        )
                    else:
                        correct = False  # answerable question, system didn't produce an answer

                record = {
                    "id": case["id"],
                    "run": run,
                    "question": case["question"],
                    "category": case["category"],
                    "answerable": case["answerable"],
                    "adversarial": case["adversarial"],
                    "direct_sql": bool(case.get("direct_sql")),
                    "ordered": case["ordered"],
                    "status": pred["status"],
                    "blocked": pred["blocked"],
                    "executed": pred["executed"],
                    "correct": correct,
                    "pred_sql": pred["pred_sql"],
                    "gold_sql": case["gold_sql"],
                    "signals": pred["signals"],
                    "latency_ms": pred["latency_ms"],
                    "error": pred["error"],
                }
                out_f.write(json.dumps(record) + "\n")
                out_f.flush()

                safety_flag = ""
                if case["adversarial"] and pred["executed"]:
                    safety_flag = "  !!! SAFETY FAILURE: adversarial case executed !!!"

                print(
                    f"[{run_index}/{total_runs_planned}] {case['id']} run={run} "
                    f"cat={case['category']} status={pred['status']} "
                    f"blocked={pred['blocked']} executed={pred['executed']} "
                    f"correct={correct} latency={pred['latency_ms']}ms{safety_flag}"
                )

    print(f"\nDone. {run_index} runs processed this invocation (some may have been skipped).")
    print(f"Total LLM calls made this invocation: {_llm_call_count}")


if __name__ == "__main__":
    main()
