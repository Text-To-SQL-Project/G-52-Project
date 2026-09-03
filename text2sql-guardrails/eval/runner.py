"""
Runs every case in eval/golden_set.jsonl through the REAL pipeline
(app.generation -> app.safety.guardrails -> app.detection (pre) -> execute
-> app.detection (post)) and records everything the offline analysis needs
to eval/results.jsonl. Computes NO metrics itself -- that's eval/metrics.py
and (eventually) analyze.py's job; this script only records what happened.

Evaluates the DEPLOYED config as-is (reads .env like every other entrypoint)
rather than overriding it -- this used to force MULTI_QUERY_ENABLED=true
regardless of .env so multi_query_agreement was always populated, but that
meant the eval measured a configuration nothing actually ships with. Now
that the ablation study has settled multi_query_agreement's fate (dropped
from fuse_confidence()'s WEIGHTS -- see app/detection/confidence.py -- and
MULTI_QUERY_ENABLED defaults to false in .env.example to match), a fresh
run with the shipped default won't populate that signal; eval/analyze.py
skips its diagnostic section gracefully when the data's absent rather than
erroring. Pass --repeats and/or set MULTI_QUERY_ENABLED=true in your own
.env first if you deliberately want to re-derive it.

Usage:
    python -m eval.runner --limit 5 --repeats 1
    python -m eval.runner                      # full set, 3 repeats each

Must be run from text2sql-guardrails/ (or anywhere with that directory on
sys.path) so `import app...` resolves.
"""
from __future__ import annotations

import argparse
import json
import logging
import time
import urllib.error
import urllib.request
from pathlib import Path

# This is a standalone entrypoint -- it never imports app.main, so
# app.main's logging.basicConfig() call never runs here. Without a handler
# configured, logging.getLogger(...).info()/.warning() calls throughout
# app/ (including app.generation.llm_client's per-attempt latency and
# rate-limit-header logging, added alongside the multi-provider work) are
# silently dropped rather than reaching stdout -- the exact bug Task 1's
# schema-disclosure fix already had to fix once for app/main.py, recurring
# here because this is a second, separate process entrypoint.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

from sqlalchemy import text  # noqa: E402

import app.generation.llm_client as llm_client  # noqa: E402
from app.api.models import ConfidenceSignal, SignalStatus  # noqa: E402
from app.config import settings  # noqa: E402
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


def _fetch_model_provenance() -> dict:
    """Written into every result record (see `record` below) so a results
    file identifies exactly which model produced it -- not just the
    floating name (which can silently start pointing at a different model,
    as gemini-2.5-flash did), but a version string where the provider
    exposes one. Fetched live, once per run, from the provider's own
    models-metadata endpoint (GET, not a generation call -- zero quota
    cost) rather than hardcoded, so it can't go stale.

    Gemini exposes a per-model `version` field this way (e.g.
    "3.6-flash-07-2026" for gemini-3.6-flash, the closest thing to a pin
    that model has -- see eval/README.md's model-provenance note).
    Anthropic and Groq have no equivalent public per-model version
    endpoint; model_version stays None for those, and the model NAME
    itself (e.g. "claude-sonnet-5") is the citable identifier.
    """
    provenance = {"provider": settings.LLM_PROVIDER, "model": settings.LLM_MODEL, "model_version": None}
    if settings.LLM_PROVIDER != "gemini":
        return provenance
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{settings.LLM_MODEL}"
        f"?key={settings.LLM_API_KEY}"
    )
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.load(resp)
        provenance["model_version"] = data.get("version")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        print(f"WARNING: could not fetch model version metadata for {settings.LLM_MODEL!r}: {e}")
    return provenance


# --- LLM call counting -------------------------------------------------
# Every code path that talks to the model (generate_sql, generate_sql_variant,
# check_back_translation's two calls) funnels through llm_client.complete(),
# so wrapping it here counts every real API call this run makes, regardless
# of which detector/generator triggered it.
_llm_call_count = 0
_original_complete = llm_client.complete

# Per-QUESTION token usage (measured, not the earlier tiktoken-approximated
# estimate) -- reset in main()'s loop immediately before each run_pipeline()
# call, read immediately after, and written into that run's own result
# record. Accumulates across however many real complete() calls that one
# question made (1 for a refusal, up to 3 for a full success), via
# llm_client.get_last_usage() read right after each call -- see that
# function's docstring for why a failed call correctly contributes nothing.
_usage_since_reset = {"prompt_tokens": 0, "completion_tokens": 0}

# What the configured LLM_MODEL actually resolved to on this question's
# most recent successful call -- matters for a floating alias (e.g.
# gemini-flash-lite-latest), which can silently repoint at a different
# model with no other way to detect it. A single-key dict (not a bare
# variable) so main()'s loop can reset it each question without a `global`
# declaration, matching _usage_since_reset's pattern. None if the
# provider's response never exposed a resolved-model field at all (see
# llm_client._extract_resolved_model).
_resolved_model_since_reset: dict = {"value": None}

# Run-WIDE token totals (never reset, unlike _usage_since_reset above) --
# feeds the periodic progress checkpoint's running cost estimate. Pricing
# is a rough live estimate only, not the final accounting: it's hardcoded
# to whatever model/rate was known to be resolving at the time this was
# written (gemini-3.5-flash-lite's paid-tier rate, $0.30/$2.50 per 1M
# input/output tokens, confirmed 2026-09-03 -- see eval/README.md's
# Provider throughput section) rather than looked up dynamically, since
# there's no live pricing API to query. Wrong for a genuinely different
# provider/model; harmless since it's clearly labeled as an estimate in
# the checkpoint line, not written into any result record.
_run_total_usage = {"prompt_tokens": 0, "completion_tokens": 0}
_ESTIMATE_INPUT_RATE_PER_TOKEN = 0.30 / 1_000_000
_ESTIMATE_OUTPUT_RATE_PER_TOKEN = 2.50 / 1_000_000


def _counting_complete(system: str, user: str, **kwargs) -> str:
    global _llm_call_count
    _llm_call_count += 1
    result = _original_complete(system, user, **kwargs)
    usage = llm_client.get_last_usage()
    _usage_since_reset["prompt_tokens"] += usage["prompt_tokens"]
    _usage_since_reset["completion_tokens"] += usage["completion_tokens"]
    _run_total_usage["prompt_tokens"] += usage["prompt_tokens"]
    _run_total_usage["completion_tokens"] += usage["completion_tokens"]
    resolved = llm_client.get_last_resolved_model()
    if resolved:
        _resolved_model_since_reset["value"] = resolved
    return result


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
        "status_reason": None,
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
            out["status_reason"] = f"SQL generation failed: {e}"
            out["error"] = f"SQL generation failed: {e}"
            out["latency_ms"] = round((time.perf_counter() - t0) * 1000, 2)
            return out

        if gen.refusal:
            # Mirrors app.api.routes.run_query(): the model's own
            # structured refusal short-circuits here -- never reaches
            # check_guardrails() or the executor. refusal_kind picks
            # "refused" (unsafe) vs "clarification" (ambiguous).
            out["status"] = "clarification" if gen.refusal_kind == "ambiguous" else "refused"
            out["status_reason"] = gen.reason or "The model declined to generate SQL for this request."
            out["latency_ms"] = round((time.perf_counter() - t0) * 1000, 2)
            return out

        sql = gen.sql
        out["pred_sql"] = sql

        if not sql or not sql.strip() or is_noop_sql(sql):
            # Defensive backstop, not the primary refusal path -- see
            # app.api.routes.run_query()'s matching comment.
            out["status"] = "refused"
            out["status_reason"] = "Detected a disguised refusal (empty or no-op SQL) despite refusal=false."
            out["latency_ms"] = round((time.perf_counter() - t0) * 1000, 2)
            return out

    guard = check_guardrails(sql)
    if not guard.passed:
        out["status"] = "blocked"
        out["status_reason"] = "; ".join(guard.blocked_reasons) or "Blocked by guardrails."
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
        out["status_reason"] = f"Execution failed: {e}"
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
    parser.add_argument(
        "--progress-file", type=Path, default=None,
        help="Overwritten with a one-line status every --progress-every completed runs, "
             "so a long run can be checked without tailing full output.",
    )
    parser.add_argument(
        "--progress-every", type=int, default=15,
        help="How many completed (non-skipped) runs between progress-file updates.",
    )
    args = parser.parse_args()

    golden = load_golden_set(str(args.golden))
    if args.limit is not None:
        golden = golden[: args.limit]

    provenance = _fetch_model_provenance()
    print(f"Model provenance for this run: {provenance}")

    run_start_time = time.monotonic()
    completed_since_progress_update = 0

    def _write_progress(run_index: int, total_runs_planned: int) -> None:
        if args.progress_file is None:
            return
        elapsed = time.monotonic() - run_start_time
        cost_estimate = (
            _run_total_usage["prompt_tokens"] * _ESTIMATE_INPUT_RATE_PER_TOKEN
            + _run_total_usage["completion_tokens"] * _ESTIMATE_OUTPUT_RATE_PER_TOKEN
        )
        line = (
            f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] "
            f"{run_index}/{total_runs_planned} runs | "
            f"{_llm_call_count} LLM calls | "
            f"{elapsed:.0f}s elapsed | "
            f"{_run_total_usage['prompt_tokens']}+{_run_total_usage['completion_tokens']} "
            f"prompt+completion tokens | "
            f"~${cost_estimate:.4f} running cost estimate "
            f"(rough, {settings.LLM_MODEL} nominal rate -- see eval/README.md)\n"
        )
        args.progress_file.write_text(line, encoding="utf-8")

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
                        "sql": gold_sql,
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
    daily_limit_hit = False

    with open(args.out, "a", encoding="utf-8") as out_f:
        for case in golden:
            if daily_limit_hit:
                break
            for run in range(1, args.repeats + 1):
                run_index += 1
                if (case["id"], run) in done_pairs:
                    print(f"[{run_index}/{total_runs_planned}] {case['id']} run={run} SKIPPED (already recorded)")
                    continue

                if 0 < settings.LLM_DAILY_CALL_LIMIT <= _llm_call_count:
                    print(
                        f"\nSTOPPING: LLM_DAILY_CALL_LIMIT={settings.LLM_DAILY_CALL_LIMIT} reached "
                        f"({_llm_call_count} calls made) at {case['id']} run={run} -- "
                        f"{run_index-1}/{total_runs_planned} runs completed this invocation. "
                        f"Not attempting further calls. Resume later with the same --out file; "
                        f"checkpointing will pick up exactly here."
                    )
                    daily_limit_hit = True
                    break

                override = case["gold_sql"] if case.get("direct_sql") else None
                _usage_since_reset["prompt_tokens"] = 0
                _usage_since_reset["completion_tokens"] = 0
                _resolved_model_since_reset["value"] = None
                try:
                    pred = run_pipeline(case["question"], sql_override=override)
                    error = None
                except Exception as e:
                    # Belt-and-suspenders: run_pipeline() already catches its
                    # own internal errors, but nothing must kill the whole run.
                    pred = {
                        "status": "error", "status_reason": None, "blocked": False, "executed": False,
                        "pred_sql": None, "pred_columns": None, "pred_rows": None,
                        "signals": {}, "latency_ms": None, "error": None,
                    }
                    error = str(e)
                    pred["status_reason"] = f"runner-level exception: {error}"

                if error and not pred.get("error"):
                    pred["error"] = f"runner-level exception: {error}"

                gold = gold_cache.get(case["id"])
                correct = None
                if case["answerable"] and not case["adversarial"]:
                    if gold is None:
                        correct = None  # gold_sql itself couldn't be executed here
                    elif pred["status"] == "success" and pred["pred_rows"] is not None:
                        correct = execution_match(
                            pred["pred_sql"], pred["pred_columns"], pred["pred_rows"],
                            gold["sql"], gold["columns"], gold["rows"],
                            ordered=bool(case.get("ordered")),
                        )
                    else:
                        correct = False  # answerable question, system didn't produce an answer

                record = {
                    "id": case["id"],
                    "run": run,
                    "provider": provenance["provider"],
                    "model": provenance["model"],
                    "model_version": provenance["model_version"],
                    "question": case["question"],
                    "category": case["category"],
                    "answerable": case["answerable"],
                    "adversarial": case["adversarial"],
                    "direct_sql": bool(case.get("direct_sql")),
                    "ordered": case["ordered"],
                    "status": pred["status"],
                    "status_reason": pred.get("status_reason"),
                    "blocked": pred["blocked"],
                    "executed": pred["executed"],
                    "correct": correct,
                    "pred_sql": pred["pred_sql"],
                    "gold_sql": case["gold_sql"],
                    "signals": pred["signals"],
                    "latency_ms": pred["latency_ms"],
                    "error": pred["error"],
                    "prompt_tokens": _usage_since_reset["prompt_tokens"],
                    "completion_tokens": _usage_since_reset["completion_tokens"],
                    "resolved_model": _resolved_model_since_reset["value"],
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

                completed_since_progress_update += 1
                if completed_since_progress_update >= args.progress_every:
                    _write_progress(run_index, total_runs_planned)
                    completed_since_progress_update = 0

    _write_progress(run_index, total_runs_planned)  # final state, regardless of the interval
    print(f"\nDone. {run_index} runs processed this invocation (some may have been skipped).")
    print(f"Total LLM calls made this invocation: {_llm_call_count}")
    cache_stats = llm_client.get_cache_stats()
    print(
        f"Prompt cache: {cache_stats['cache_read_input_tokens']} tokens read from cache, "
        f"{cache_stats['cache_creation_input_tokens']} tokens written to cache "
        "(cache_system=True calls only)."
    )


if __name__ == "__main__":
    main()
