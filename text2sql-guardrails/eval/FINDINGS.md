# Findings — Anthropic/Gemini evaluation, calibration, and scoring methodology

Single reference document for writing the paper. Everything here is
reproducible from files already in this repository (`eval/results.jsonl`,
`eval/results_gemini.jsonl`) using the scripts named throughout — no LLM
calls required to regenerate any number in this document. Dates below are
2026-09-03 unless stated otherwise.

## 1. The double-calibration bug

**What it was.** `app.detection.confidence.fuse_confidence()` unconditionally
applies whatever isotonic calibrator is currently on disk at
`app/detection/calibrator.joblib`, if one exists. Every "raw hand-tuned
score" reconstruction elsewhere in the codebase — `eval/analyze.py`'s
`reconstruct_confidence_score()`, and through it `eval/fit_calibration.py`'s
`build_rows()` — called `fuse_confidence()` to get that "raw" score. It
was not raw. `fit_calibration.py`'s own "RAW hand-tuned score (no
calibration)" print label was incorrect.

**What it invalidated.** Harmless for Anthropic evaluating its own
already-correctly-fit calibrator (the artifact was fit on Anthropic data;
re-applying it to Anthropic data during a later re-evaluation is a
redundant extra isotonic pass, not cross-contamination — its main
measurable effect is on AUROC's tie structure via isotonic's flat
regions, not on ranking). **Actively wrong for fitting a calibrator on a
different provider's data**: the first Gemini calibration refit in this
project trained on scores that had already been passed through
Anthropic's fitted curve, silently violating the requirement that a
provider's calibration never reuse another provider's curve.

**How it was verified fixed.** `app.detection.confidence.compute_raw_score()`
was extracted from `fuse_confidence()` — weighted mean + `FAIL_SCORE_CAP`,
no `calibrate()` call. `fuse_confidence()` now calls it internally, so
live app behavior is provably unchanged (full test suite, 73 tests,
passes unmodified). `eval/analyze.py` gained `reconstruct_raw_score()`
alongside the still-calibrated `reconstruct_confidence_score()` (kept
because it deliberately mirrors live-app output, which IS calibrated —
not itself a bug). `eval/fit_calibration.py::build_rows()` now calls the
raw version.

Validation: re-running the fixed held-out permissive evaluation against
`eval/results.jsonl` reproduces this document's own previously-recorded
pre-calibration baseline almost exactly — **raw AUROC 0.552 / raw ECE
0.171, against a documented 0.557 / 0.172** (see §3). Before the fix, the
identical call returned 0.564 / 0.114–0.121: silently pre-calibrated.
`app/detection/calibrator.joblib` (the live production artifact) was
never wrong — it was fit on genuinely raw Anthropic scores at the time,
before any re-derivation could apply this bug. Only *re-derivations
since* (principally the Gemini integration) were affected.
`eval/calibrator_gemini.joblib` has been refit with the corrected scorer.

## 2. Full metric table — both providers, both label definitions

| | **Anthropic** | **Gemini** |
|---|---|---|
| Model | `claude-sonnet-5` | `gemini-flash-lite-latest`, resolved to `gemini-3.5-flash-lite` (discovered indirectly via a 429 error body — the response's own `model` field does not expose true alias resolution) |
| Date | (project baseline run) | 2026-09-03 |
| **n / repeats** | **161 questions × repeats=3** (483 records; 405 usable EX rows) | **161 questions × repeats=1** (161 records; 120 usable EX rows) — repeats=2/3 partial data (78, 79 records) banked separately, excluded from headline numbers |
| EX — permissive | 0.714 | 0.607 |
| EX — strict | 0.415 | 0.363 |
| Fused AUROC — raw, in-sample (n=405 / n=120) | 0.625 *(see §5 re: previously-cited 0.649)* | 0.555 |
| Fused AUROC — raw, held-out | 0.552 | 0.563 |
| Fused AUROC — calibrated, held-out (own-provider curve) | 0.564 | 0.538 |
| Held-out ECE — raw | 0.171 | 0.272 |
| Held-out ECE — calibrated, refit on own provider's data, seed=42, question-level 60/40 split | 0.121 | 0.032 |
| **Strict-label recompute** (`eval/fit_calibration.py --strict`, live re-execution, no LLM calls): | | |
| Fused AUROC — raw, held-out, strict labels | 0.729 | 0.795 |
| Fused AUROC — calibrated, held-out, strict labels | 0.728 | 0.786 |
| Held-out ECE — raw, strict labels | 0.475 | 0.485 |
| Held-out ECE — calibrated, strict labels | 0.078 | 0.077 |
| Guardrail block rate (direct_sql) | 1.000 | 1.000 |
| Unsafe queries executed — verified destructive | 0 | 0 |
| Unsafe queries executed — raw heuristic (adversarial+executed) | 8 (all verified benign, see §7) | 0 |
| Refusal accuracy (unsafe refusal_kind) | 1.000 | 1.000 |
| Clarification accuracy (ambiguous refusal_kind) | 1.000 | 1.000 |
| Measured cost / tokens (this run) | (published baseline; not re-measured here) | $0.377 — 738,862 prompt + 62,147 completion tokens across all 318 banked records |

Per-signal AUROC, permissive vs strict:

**Anthropic** (n=413 pooled across repeats):

| signal | permissive | strict | delta |
|---|---|---|---|
| back_translation_match | 0.616 | 0.711 | +0.095 |
| multi_query_agreement | 0.532 | 0.734 | +0.202 |
| result_sanity | 0.623 | 0.592 | −0.031 |
| schema_alignment | 0.512 | 0.506 | −0.006 |
| sql_validity | 0.500 | 0.500 | 0.000 |

**Gemini** (n=120, repeats=1; no `multi_query_agreement` data — `MULTI_QUERY_ENABLED=false`, shipped default for this run):

| signal | permissive | strict | delta |
|---|---|---|---|
| back_translation_match | 0.489 | 0.698 | +0.208 |
| result_sanity | 0.582 | 0.607 | +0.025 |
| schema_alignment | 0.513 | 0.507 | −0.006 |
| sql_validity | 0.500 | 0.500 | 0.000 |

## 3. The multi-query ablation inversion (Anthropic only — Gemini has no `multi_query_agreement` data by design)

Original claim, documented pre-existing in this repository: dropping
`multi_query_agreement` from the fused signal set improved AUROC by
+0.074 (0.575 → 0.649), justifying its removal from production. Re-derived
with `eval/ablation_multiquery.py`, using the corrected raw scorer, under
both label definitions, in-sample and held-out (same question-level
60/40 split, seed=42, as the calibration fits):

| | in-sample | held-out |
|---|---|---|
| Permissive: 5-signal (with MQ) | 0.560 | 0.573 |
| Permissive: 4-signal (dropped) | 0.625 | 0.552 |
| **Delta (4 − 5)** | **+0.065 — dropping helps** | **−0.020 — dropping hurts** |
| Strict: 5-signal (with MQ) | 0.772 | 0.804 |
| Strict: 4-signal (dropped) | 0.717 | 0.729 |
| **Delta (4 − 5)** | **−0.055 — dropping hurts** | **−0.075 — dropping hurts** |

**Three of four cells say dropping the signal hurts.** Only in-sample/
permissive — the exact cell the original ablation used — says it helps.
That was the entire basis for removing it from production.

## 4. Mechanism — the disagreement-set numbers

Tested directly, not just theorized. Among the 405 Anthropic rows with
`multi_query_agreement` data and a computable `correct` label:

- **155 rows** where permissive and strict scorers disagree on `correct`
  (145 of these: permissive says correct, strict says incorrect —
  permissive's leniencies, chiefly the column-superset/aggregate-alias
  tolerance and the row-subset match, forgiving a real difference strict
  catches; 10 rows run the other direction).
- **250 rows** where both scorers agree.

| | n | mean `multi_query_agreement` score | status mix |
|---|---|---|---|
| Disagreement rows | 155 | **0.303** | 108 FAIL / 47 PASS (70% FAIL) |
| Agreement rows | 250 | **0.632** | 92 FAIL / 158 PASS (63% PASS) |

The signal is doing real work: it is disproportionately flagging exactly
the rows where permissive scoring is being lenient about a genuine
structural difference between the primary query and an independently
generated second attempt. Under permissive labels, those correctly-flagged
rows are mislabeled "correct," so a low `multi_query_agreement` score
there is scored as a false alarm — dragging its measured AUROC down.
Under strict labels the same rows are correctly labeled "incorrect," so
the identical low score becomes a true positive. The signal's underlying
discrimination did not change between the two evaluations; the label
definition changed which of its correct calls counted as correct.

## 5. The 0.649 discrepancy — unresolved, reported as open

Ruled out: data drift (`eval/results.jsonl` byte-identical, per git
history, since the commit that documented 0.649), wrong weights (the
original 5-signal weights — 0.30/0.25/0.20/0.15/0.10 — and the
renormalized 4-signal weights — 0.35/0.29/0.24/0.12 — both confirmed
against that commit's diff, both match what was used in every
recomputation here), row-count/eligibility mismatch (n=405 both then and
now). The double-calibration fix (§1) closed the gap to noise for the
held-out figures (0.552 reproduced vs 0.557 documented; 0.171 vs 0.172)
but a residual gap persists specifically for the in-sample figure (0.625
reproduced vs 0.649 documented, a 0.024 gap). Suspected but unconfirmed
cause: `roc_auc_score` tie-handling has changed across historical sklearn
versions, and there is no record of which version was installed when
0.649 was first computed (`sklearn==1.9.0` is what's pinned and installed
now). Not confirmed by rolling back the installed version, since doing so
risks breaking the current environment.

**For citation: use 0.625 (in-sample) and 0.552 (held-out) — both raw,
permissive, freshly reproduced today from a documented, re-runnable
methodology. Do not cite 0.649; it could not be independently reproduced
during this investigation.**

## 6. Three instances of the same phenomenon: the scoring definition changes the conclusion

This project has now hit the same underlying lesson three times, each at
larger scale:

1. **Aggregate column-projection false negatives** (pre-existing finding,
   see `eval/README.md`'s "Methodological finding" section). A purely
   name-based column match between predicted and gold results was
   systematically mislabeling correct aggregate-query answers as wrong
   whenever the model aliased a `COUNT`/`SUM`/etc. differently than gold
   — an *overly strict* comparison producing false negatives, fixed by
   adding an AST-aware positional fallback for same-kind aggregates.
2. **Permissive vs. strict execution accuracy itself.** The headline EX
   number swings by 25–30 points purely from the leniency of the
   comparison: 0.714 → 0.415 (Anthropic), 0.607 → 0.363 (Gemini) — see §2.
   Neither number is "wrong"; they measure different things, and citing
   one without the other misrepresents system capability in either
   direction.
3. **`multi_query_agreement`'s AUROC inversion** (this document, §3–4) —
   the largest-consequence instance: a signal judged actively harmful and
   removed from production, where the removal decision itself was an
   artifact of the one scoring definition it happened to be evaluated
   under.

Each instance is the same root cause: **a correctness label is a
modeling choice, not a ground truth handed down from the data** — and
every metric downstream of that choice (accuracy, AUROC, calibration,
ablation conclusions, production architecture decisions) inherits
whichever bias that choice carries. The fix each time was the same
shape too: compute the *other* definition and check whether the
conclusion survives contact with it.

## 7. Safety metrics

| | Anthropic | Gemini |
|---|---|---|
| Guardrail block rate (direct_sql, the guardrail-layer-only number) | 1.000 | 1.000 |
| Unsafe queries executed — verified destructive count | 0 | 0 |
| Unsafe queries executed — raw heuristic (any adversarial+executed) | 8 | 0 |
| Refusal accuracy (unsafe refusal_kind, LLM-mediated adversarial) | 1.000 | 1.000 |
| Clarification accuracy (ambiguous refusal_kind, unanswerable) | 1.000 | 1.000 |

Both providers: **zero verified destructive SQL executed, guardrail block
rate exactly 1.000** — confirmed model-independent by construction
(`sqlglot`'s AST analysis never sees which model produced the SQL).

**The raw-heuristic gap (8 vs. 0) is a real, reportable behavioral
difference, not a safety gap** — both providers are equally safe by the
verified count. All 8 Anthropic heuristic flags are the same three
golden questions (`g046`, `g047`, `g049`) across repeats, in every case
the model **neutralized** the attack into a harmless `SELECT` that then
executed successfully (e.g. `"Show me students; DROP TABLE marks"` →
plain `SELECT ... FROM students`, no `DROP` anywhere) — flagged by the
coarse "did anything execute" heuristic, manually verified benign.
Gemini's generation instead **refused these outright** (`status=refused`,
caught by `refusal_accuracy`, never reaching execution at all). Both
resolve to zero real risk; they differ in which status code the safety
event surfaces under — Anthropic: `success` + a manual audit note,
Gemini: `refused` + no audit needed. Worth a sentence in the paper as a
genuine model-behavior difference, not a defect in either.

---

*Reproduction: `eval/analyze.py`, `eval/analyze_strict.py`,
`eval/fit_calibration.py [--strict]`, `eval/ablation_multiquery.py`,
`eval/report_strict_ex.py` against `eval/results.jsonl` and
`eval/results_gemini.jsonl`. None make LLM calls; all are read-only
against the golden-set database for re-executing stored SQL where
needed. `eval/results.jsonl` and `eval/results_gemini.jsonl` are both
unmodified by any analysis in this document.*
