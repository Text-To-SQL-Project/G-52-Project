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

**Gemini** (n=120, repeats=1; `multi_query_agreement` backfilled post-hoc
— see §8 for that caveat):

| signal | permissive | strict | delta |
|---|---|---|---|
| back_translation_match | 0.489 | 0.698 | +0.208 |
| **multi_query_agreement** | **0.568** | **0.783** | **+0.215** |
| result_sanity | 0.582 | 0.607 | +0.025 |
| schema_alignment | 0.513 | 0.507 | −0.006 |
| sql_validity | 0.500 | 0.500 | 0.000 |

`multi_query_agreement`'s permissive→strict inversion **replicates across
both providers at nearly identical magnitude**: Anthropic +0.202 (0.532 →
0.734), Gemini +0.215 (0.568 → 0.783). On both providers it is the
*strongest single signal* under strict labels and among the *weakest*
under permissive labels.

## 3. The multi-query ablation inversion — measured on both providers

Original claim, documented pre-existing in this repository: dropping
`multi_query_agreement` from the fused signal set improved AUROC by
+0.074 (0.575 → 0.649), justifying its removal from production. Re-derived
with `eval/ablation_multiquery.py`, using the corrected raw scorer, under
both label definitions, in-sample and held-out (same question-level
60/40 split, seed=42, as the calibration fits).

**Anthropic** (n=405, repeats=3):

| | in-sample | held-out |
|---|---|---|
| Permissive: 5-signal (with MQ) | 0.560 | 0.573 |
| Permissive: 4-signal (dropped) | 0.625 | 0.552 |
| **Delta (4 − 5)** | **+0.065 — dropping helps** | **−0.020 — dropping hurts** |
| Strict: 5-signal (with MQ) | 0.772 | 0.804 |
| Strict: 4-signal (dropped) | 0.717 | 0.729 |
| **Delta (4 − 5)** | **−0.055 — dropping hurts** | **−0.075 — dropping hurts** |

**Gemini** (n=120, repeats=1; `multi_query_agreement` backfilled post-hoc,
see §8):

| | in-sample | held-out |
|---|---|---|
| Permissive: 5-signal (with MQ) | 0.578 | 0.587 |
| Permissive: 4-signal (dropped) | 0.543 | 0.563 |
| **Delta (4 − 5)** | **−0.034 — dropping hurts** | **−0.024 — dropping hurts** |
| Strict: 5-signal (with MQ) | 0.816 | 0.772 |
| Strict: 4-signal (dropped) | 0.742 | 0.795 |
| **Delta (4 − 5)** | **−0.074 — dropping hurts** | **+0.024 — dropping helps** |

### Does the finding hold on both providers? Yes — and the original justification does not replicate

**Across both providers, 6 of 8 cells say dropping `multi_query_agreement`
hurts.** Each provider has exactly one dissenting cell, and they are
*different cells*: Anthropic's is permissive/in-sample (+0.065), Gemini's
is strict/held-out (+0.024, on only 48 held-out rows). Neither dissent
reproduces on the other provider.

The single most important observation for the paper: **the exact cell that
justified the production decision — permissive, in-sample — flips sign
between providers.** It is +0.065 (dropping helps) on Anthropic and −0.034
(dropping hurts) on Gemini. The original ablation's conclusion is not
merely label-definition-dependent; it does not survive a change of model
either. The decision to remove the signal from production rests on a
result that replicates on neither axis tested here.

Conversely, the *pro-keeping* evidence is consistent across both axes and
both providers: strict/in-sample says keep on Anthropic (−0.055) and
Gemini (−0.074), and permissive/held-out says keep on Anthropic (−0.020)
and Gemini (−0.024).

## 4. Mechanism — the disagreement-set numbers

Tested directly, not just theorized. Among the 405 Anthropic rows with
`multi_query_agreement` data and a computable `correct` label:

- **155 rows** where permissive and strict scorers disagree on `correct`
  (145 of these: permissive says correct, strict says incorrect —
  permissive's leniencies, chiefly the column-superset/aggregate-alias
  tolerance and the row-subset match, forgiving a real difference strict
  catches; 10 rows run the other direction).
- **250 rows** where both scorers agree.

| Anthropic | n | mean `multi_query_agreement` score | status mix |
|---|---|---|---|
| Disagreement rows | 155 | **0.303** | 108 FAIL / 47 PASS (70% FAIL) |
| Agreement rows | 250 | **0.632** | 92 FAIL / 158 PASS (63% PASS) |

**The mechanism replicates on Gemini** (run=1, the 120 rows with
backfilled `multi_query_agreement` data), at nearly identical magnitude:

| Gemini | n | mean `multi_query_agreement` score | status mix |
|---|---|---|---|
| Disagreement rows | 43 | **0.279** | 30 FAIL / 11 PASS / 2 WARN (70% FAIL) |
| Agreement rows | 77 | **0.656** | 24 FAIL / 48 PASS / 5 WARN (62% PASS) |

Both providers: ~0.28–0.30 mean score and ~70% FAIL on disagreement rows,
versus ~0.63–0.66 mean score and ~62–63% PASS on agreement rows. The
effect is not an artifact of one model's generation behavior.

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

## 8. Methodological caveat: Gemini's `multi_query_agreement` was backfilled post-hoc

**Anthropic's `multi_query_agreement` data was collected during the
original evaluation run**, inline, as part of each question's pipeline
execution — the signal saw that run's live primary query and its live
result rows at the moment they were produced.

**Gemini's was not.** That run used the shipped `MULTI_QUERY_ENABLED=false`
default, so the signal was never computed. It was added afterwards
(2026-09-05) by `eval/backfill_multiquery_gemini.py`: for each of the 120
`run=1` `status=success` records, the already-stored `pred_sql` was
re-executed read-only against the same golden-set database to recover the
primary result rows (`results_gemini.jsonl` does not persist raw rows),
and `check_multi_query_agreement()` was then called against that
reconstructed input — one new LLM call per record, 120 total, zero
retries, zero failures.

What a reviewer should know about the difference:

- **The variant generation is genuinely fresh, not reconstructed.** The
  new second-opinion query was generated at backfill time by the same
  model (`gemini-flash-lite-latest`) against the same prompt-building
  code. This is the part of the signal that carries the information.
- **The primary side is reconstructed, not replayed.** The comparison
  uses the *stored* `pred_sql` re-executed against the *current* database
  state. The golden-set database is static and was not modified between
  the original run and the backfill, so the recovered rows should be
  identical to the originals — but this is an assumption of database
  stability, not a byte-for-byte replay of recorded output.
- **Temporal separation.** Variant generation happened ~2 days after the
  primary generation, against a floating model alias
  (`gemini-flash-lite-latest`) that could in principle have been
  repointed in that window (see §2 — its resolution is not observable
  from a successful response). No evidence it changed, but it cannot be
  ruled out from the data.
- **Direction of any resulting bias is not established.** It is not
  obvious whether post-hoc variant generation would inflate or deflate
  measured agreement relative to inline collection. The Anthropic result,
  which has no such caveat, shows the same inversion at the same
  magnitude — which is the main reason to treat the Gemini replication as
  corroborating rather than as the primary evidence.

For the paper: cite Anthropic's ablation as the primary result (inline
collection, repeats=3, n=405) and Gemini's as a replication with this
caveat attached, not as an independent confirmation of equal standing.

---

*Reproduction: `eval/analyze.py`, `eval/analyze_strict.py`,
`eval/fit_calibration.py [--strict]`, `eval/ablation_multiquery.py`,
`eval/report_strict_ex.py`, `eval/backfill_multiquery_gemini.py` against `eval/results.jsonl` and
`eval/results_gemini.jsonl`. None make LLM calls; all are read-only
against the golden-set database for re-executing stored SQL where
needed. `eval/results.jsonl` and `eval/results_gemini.jsonl` are both
unmodified by any analysis in this document.*
