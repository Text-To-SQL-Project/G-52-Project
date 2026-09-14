# Findings — evaluation, calibration, scoring methodology, and verification reliability

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

## 9. Verification infrastructure passing for the wrong reason — seven instances

Distinct from §6, which is about a *scoring definition* changing a
conclusion. This one is about a check reporting success while not
exercising the thing it appeared to exercise. **Seven instances so far**,
and they are not confined to the metrics code: the set now includes a
security guard, a shell redirect, and a test suite. That spread is itself
the finding.

| # | What claimed to be verified | What was actually happening |
|---|---|---|
| 1 | `execution_match()` decided predicted-vs-gold correctness | Name-based column projection systematically mislabelled correct aggregate answers as wrong (see `eval/README.md`, "Methodological finding") |
| 2 | `fit_calibration.py` fit a calibrator on *raw* hand-tuned scores | Those scores had already been through an isotonic curve; a Gemini refit trained on Anthropic-calibrated input (§1), **and a mislabelled ECE reached three user-facing surfaces** (§14) |
| 3 | The test suite exercised the read-only execution path | Generated SQL in every host-side run executed **as a superuser** |
| 4 | An RLS probe showed a CTE attack "did not leak" | Principal and victim owned the same row count, so `count(*)` matched through a total leak (§10) |
| 5 | — *(caught prospectively)* | `eval/db_guard.py`: RLS would silently filter an eval run's rows rather than raise |
| 6 | `assert_bypasses_rls()` guarded eval against a filtered connection | The guard returned early on **every** connection and asserted nothing, for a day |
| 7 | `psql -f /dev/stdin < file.sql` applied a policy file | Reported each statement, exited zero, and applied **nothing from the file** |

### The third instance, in detail (2026-09-12)

`app/db.py::get_readonly_engine()` fell back to `DATABASE_URL` whenever
`READONLY_DATABASE_URL` was unset. That variable is set for the API
container by `docker-compose.yml`, but it was unset on the host, and the
`readonly_app` role had never been created on the host's PostgreSQL
instance at all. Every host-side test run therefore executed generated SQL
with full privileges.

The five affected tests — four schema-disclosure tests in
`tests/test_safety.py` and one in `tests/test_llm_provider_contract.py` —
were not wrong about what they assert. They assert that no schema
identifier leaks into a CLARIFICATION, REFUSED, BLOCKED or ERROR response,
and that held. But the read-only layer, described in `app/db.py` as "the
second line of defence behind the guardrails: even a guardrail miss cannot
write", had **no local coverage whatsoever** while appearing to sit behind
a passing end-to-end test.

**Why it was invisible.** A privileged connection is indistinguishable
from a constrained one on the happy path: same rows, same timing, same
response shape. The only observable difference is in what gets *refused*,
and nothing in the suite was asking for anything that should be refused.

**How it was caught.** Not by a failing test. It surfaced during Phase 0
diagnosis for Row Level Security, when "which DB role does each component
connect as?" was put to the live databases instead of inferred from the
configuration files. The answer — eval, the API and the test suite
resolving to three different roles across two different PostgreSQL
instances — matched none of the configuration.

**What makes it loud now.** `get_readonly_engine()` raises instead of
defaulting, naming the missing variable. `app/startup_checks.py` refuses to
boot the API if the executing role is a superuser or holds `BYPASSRLS`, and
logs the role it actually resolved to on every start. `readonly_app` now
exists on both instances. The test-only fallback that remains for
unprovisioned machines is named `_insecure_readonly_fallback_for_tests`,
warns when it fires, and hard-fails any test marked `isolation` — so a
future RLS isolation test cannot silently acquire superuser and then pass.

### Why this belongs in the paper

All three instances share a shape:

1. **The check was green, and honest about its own assertion.** None of the
   three tests was buggy. Each verified exactly what it said. The gap was
   between what was asserted and what a reader would reasonably conclude
   had been verified.
2. **The failure was invisible on the happy path.** A mislabelled-correct
   query, a double-calibrated score and a privileged connection all produce
   output indistinguishable from the intended behaviour.
3. **None was found by running more tests.** One by refusing to believe an
   implausible metric, one by tracing what "raw" actually meant, one by
   asking the live system a question its configuration could not answer.
4. **The fix each time was to make the invisible thing assert itself** — a
   documented matching criterion, an extracted `compute_raw_score()`, a
   startup check that names the role it got. Not more happy-path coverage.

For a project whose contribution is *guardrails plus calibrated
confidence*, this is the same argument applied reflexively. The system's
own thesis is that you should not report a query as high-confidence merely
because the pipeline noticed nothing wrong. The evaluation apparatus
deserves the same scepticism: **absence of a failing test is not evidence
that a control is present.**

### The fourth instance (2026-09-13) — a count that matched through a total leak

Recorded in §10, and the sharpest of the set. The first version of that
finding gave the principal and the victim two rows each and compared
`count(*)`. A CTE attack shape returned 2 and was written up as "did not
leak". It had leaked completely, returning the victim's two rows instead of
the principal's. Caught only by re-running with unequal row counts and
comparing row **identity**. It was committed while writing this very
section. The lesson is apparently not learnable once.

### The fifth instance (2026-09-12) — caught prospectively

`eval/db_guard.py` exists because Row Level Security, once enabled, would
filter an eval run's rows without raising anything — execution accuracy
would drift to a new, entirely plausible number with nothing in the output
to say why. That guard aborts the run instead. Same lesson, applied before
it could cost anything.

### The sixth instance (2026-09-13) — the guard from §9.5 was itself a no-op

**What it was supposed to catch.** `assert_bypasses_rls()` is the
enforcement behind the fifth instance above. An eval run must execute on a
connection that RLS cannot filter, because a filtered run does not fail —
it returns fewer rows and a new, plausible execution-accuracy number with
nothing in the output to explain the drift. The guard's whole purpose is to
abort rather than let a quietly-wrong baseline get published.

**What it actually did.** It called
`is_immune(..., problem_tables=[])` as shorthand for "this connection is a
superuser or holds BYPASSRLS". But an empty `problem_tables` list means
*ownership-based* immunity, and with nothing to check the call returned
`True` for **every** connection. The function then returned early, every
time. From `d1a89eb` until `57611b2` — about a day — the guard asserted
nothing at all.

**Why its tests passed throughout.** This is the part worth the space,
because the tests were not sloppy:

- The tests exercised `is_immune()` itself, a **pure decision function**,
  across its cases. That function was correct then and is correct now. It
  was never the bug.
- Other tests asserted on the **source text** of `assert_bypasses_rls()` —
  that it mentions the right role attributes. That assertion was also
  correct. The source said the right things.
- **Nothing asked what the function did.** No test called
  `assert_bypasses_rls()` with a connection that *should* be rejected and
  checked that it raised. The guard's only observable behaviour is a
  refusal, and no test ever attempted the thing it was supposed to refuse.

So a correct pure function plus a correct source-text assertion produced a
green suite over a control that was doing nothing. The gap was not in
either assertion; it was that neither was **behavioural**.

**How it was found.** Not by a test. By re-reading the call site while
writing up the fifth instance and noticing that the shorthand argument did
not mean what the call site assumed. The fix (`57611b2`) added two
behavioural tests, and — the part that matters — **the fix was verified by
reintroducing the bug and confirming the new tests fail.** A test for a
guard is worth only as much as its demonstrated ability to fail.

**Blast radius: none, by luck.** Eval resolves to a superuser connection,
which the guard would have admitted either way, so no published number is
affected. The exposure was that a misconfigured run would not have been
caught — the exact scenario the guard exists for.

### The seventh instance (2026-09-15) — an honest command with the wrong input

Applying the faculty-scope policies (§14's neighbouring work, commit
`1d7f2fd`) to the container database:

```bash
docker compose exec -T db psql -U app -d college_erp -v ON_ERROR_STOP=1 \
    -f /dev/stdin < seed/31_rls_policies.sql
```

This printed `SET`, `ALTER TABLE`, `DROP POLICY`, `CREATE POLICY`, `GRANT`
— and exited zero. **It applied nothing from the file.** The new policies
were absent afterwards; `pg_policies` still held the old expressions.

Every part of that output was honest. Statements really were executed and
really did succeed; psql reported each one accurately. The command simply
read them from somewhere other than the file that was handed to it, and
`ON_ERROR_STOP=1` offered no protection because **there was no error —
there was no input.** Piping to stdin instead (`cat file | docker compose
exec -T db psql ...`) works correctly.

It cost one debug cycle: the policy file was patched, "applied", and the
tests still showed the old behaviour, which looked like a policy-logic bug
rather than an application failure. (Compounded by the two-instance split
documented in `docs/SECURITY_MODEL.md` — the host and container databases
must both be updated and both be verified.)

**The generalisable lesson, and the reason this belongs here rather than in
a shell-tips file:**

> **Verify by reading the state back, not by trusting an exit code.**

An exit code reports whether a process failed. It does not report whether
the process did what you wanted, and the two diverge exactly when the input
is wrong rather than the operation. The same shape recurs across all seven
instances in this section: a green test that never ran the code
(instance 3), a guard that returned early (instance 6), a count that
matched through a leak (instance 4), a "raw" score that had been calibrated
(instance 2). In every case the reported signal was truthful about
something *other than* the question being asked.

The verification that works is the one that interrogates the system
afterwards and is capable of coming back negative: read `pg_policies` on
each instance; ask the live connection which role it is; compare row
identity rather than row count; reintroduce the bug and watch the test
fail.

### Instance 2 again, one layer out: when the bad value outlives the bug

§1 recorded the double-calibration bug's effect on *re-derivations* — the
Gemini refit trained on Anthropic-calibrated input. **§14 records the part
that reached users**, and it belongs in this section rather than only in
the calibration one, because the mechanism is this section's mechanism and
not §1's.

`fit_calibration.py` printed its held-out baseline under the label

```
Held-out, RAW hand-tuned score (no calibration): ...  ECE=0.118
```

The number was real. The computation ran. The script did not fail, warn, or
behave oddly in any way. **Only the word `RAW` was false** — those scores
had already been through the production isotonic curve. Anyone reading that
line had no way to tell, because the only thing that was wrong was the one
thing the output asserted about itself.

0.118 was then read off that line and written into `README.md`,
`eval/README.md` and `app/api/routes.py`'s `held_out_ece`, where the Admin
screen served it to anyone who opened the page. It was cited as a headline
calibration result for **nine days and across two documentation passes**,
including one pass whose explicit purpose was correcting stale figures.

Two things make this the sharpest instance in the set:

1. **It is the only one where the wrong value escaped the tooling and
   reached user-facing surfaces.** Instances 1, 3, 6 and 7 produced wrong
   *confidence* in a control or a label. This one produced a wrong
   *number*, published under a headline.
2. **The bug was fixed nine days before the number was.** `4e9ac32` fixed
   the double calibration on 2026-09-03. The figure it had produced
   survived until 2026-09-15, propagating through three surfaces the entire
   time, because nothing connected "that function was wrong" to "therefore
   every number it printed is suspect."

> **A wrong number is more durable than the bug that produced it.** Fixing
> the code does not retract its output. When a computation is found to have
> been wrong, the fix is incomplete until every figure it produced has been
> traced to where it was published and either reproduced or retired.

This is also why §14 reconstructs the pre-fix path rather than simply
declaring 0.118 unreproducible. Re-deriving it (0.117 against the recorded
0.118) is what turns "we cannot reproduce this" into "we know exactly what
this measured, and it was not what the label said" — the difference between
a discrepancy and an explanation. Compare §5, where the residual 0.649
genuinely could not be explained and is reported as open.

## 10. Generated SQL can rewrite the RLS session variable (2026-09-13)

**Status: found during Phase 2 planning, before any policy was written.
No policy exists in this repository yet; this is a design input, not a
live vulnerability.**

This one generalises past this project. The textbook pattern for
multi-tenant Row Level Security in PostgreSQL is:

```sql
-- application, per request, inside a transaction
SELECT set_config('app.student_id', '32', true);

-- policy
CREATE POLICY p ON marks FOR SELECT
  USING (student_id = current_setting('app.student_id', true)::int);
```

That pattern assumes the SQL running in the session is trusted to not
touch `app.student_id`. **In a text-to-SQL system the SQL is written by a
language model, and that assumption does not hold.** `set_config` is an
ordinary, `VOLATILE` function returning `text`. A statement that calls it
is still a plain `SELECT`, so it passes every read-only check: no DDL, no
DML, single statement, `sqlglot` parses it as `exp.Select`.

### The exploit

Probe table, policy as above. Principal is student 32, owning ids 1 and 2.
Victim is student 87, owning ids 3, 4 and 5. Row counts are deliberately
**unequal** — see the correction below for why that matters. Any id in
{3,4,5} reaching the client is a policy bypass.

| Shape | ids returned | |
|---|---|---|
| baseline, no attack | 1,2 | correct |
| `set_config` in a subquery target list | 1,3,4,5 | **leak** |
| CTE, then join | 3,4,5 | **leak** |
| CTE `MATERIALIZED`, then join | 3,4,5 | **leak** |
| scalar subquery in target list | 1,3,4,5 | **leak** |
| `WHERE set_config(...) IS NOT NULL` | 3,4,5 | **leak** |
| `LATERAL` | 3,4,5 | **leak** |
| window function `ORDER BY set_config(...)` | 1,3,4,5 | **leak** |
| `UNION` arm | 1,2,3,4,5 | **leak** |
| top-level `ORDER BY` | 1,3,4,5 | **leak** |
| `CASE` expression in `WHERE` | 3,4,5 | **leak** |
| `EXISTS (SELECT set_config(...))` | 1,2 | did not leak here |

Nine of ten attack shapes bypass the policy. The working exploit, as a
single statement no guardrail currently blocks:

```sql
SELECT id FROM (SELECT set_config('app.student_id','87',true), id FROM marks) z
```

Two distinct leak signatures appear, and both matter. Where the principal's
own rows come back *alongside* the victim's (`1,3,4,5`), the GUC changed
partway through the scan, so visibility differs row to row. Where only the
victim's rows come back (`3,4,5`), the GUC changed before the scan began.
The split depends on plan shape, which means **the exploitability of any
given query is a planner decision**, not a property of the SQL text. An
audit that checks one query shape establishes nothing about another.

`EXISTS` did not leak in this configuration. That is recorded as an
observation, not as a safe shape — see the correction immediately below
for why a single negative result here should not be trusted.

### Correction: the first version of this finding was wrong

The initial probe used a table where **both** the principal and the victim
owned exactly two rows, and checked the attack with `count(*)`. The CTE
shape returned 2, which was read as "did not leak". It had leaked
completely: it returned the victim's two rows instead of the principal's
two rows, and the count could not tell the difference.

This is the same failure documented in §9 — a check passing for the wrong
reason — committed while writing up §9. It was caught only by re-running
with unequal row counts and comparing row identities instead of
cardinality. The lesson transfers directly into the test design: **an
isolation test must assert on row identity, never on row count.**

### Why the obvious mitigations are insufficient

- **Denylisting `set_config` in the AST guardrail** stops the literal
  cases above. It is a denylist against a language with `format`,
  dynamic dispatch, operator syntax and functions that may gain
  GUC-writing behaviour in future PostgreSQL versions. Useful as noise
  reduction; not a control.
- **Marking the GUC read-only** is not possible. PostgreSQL has no
  mechanism to make a custom `SET LOCAL` setting immutable for the rest
  of a transaction.
- **Comparing filtered against unfiltered results** to detect tampering
  requires running the user's SQL with a bypass role, which defeats the
  policy and creates a counting oracle for rows outside the user's scope.

### The design this project adopts

Three layers, on the explicit understanding that only the third is
structural:

1. AST denylist for `set_config`, `current_setting` write-forms and
   `pg_catalog` write-forms. Noise reduction.
2. **Post-execution re-assertion**: read the GUC back after the statement
   and discard the result set if it changed. Fails closed, logs the
   discard server-side with the offending SQL, returns the existing
   generic client message. Catches shapes the denylist misses, including
   ones that do not exist yet.
3. **GUC-free policies wherever the schema allows it.** The only layer
   that does not depend on enumerating attacks. Tables that cannot avoid
   reading a mutable GUC are enumerated as a stated limitation rather
   than left implicit.

For anyone implementing RLS under generated SQL: layer 2 is the one to
build first. It is cheap, and it is the only one that holds against an
attack shape nobody has thought of yet.

## 11. Stated limitation: every row-scoped table depends on a mutable GUC

> **SUPERSEDED by section 12.** This limitation was real when written and
> was then removed by building the control it says was not implemented.
> Kept in full, and kept in place, because the sequence is the finding:
> a limitation was identified precisely, costed, and closed, rather than
> shipped as a caveat. Read 10 → 11 → 12 in order.

Written during Phase 2 implementation, before the policies exist, so the
reasoning is recorded rather than reconstructed.

§10 establishes that generated SQL can rewrite the session variable a
PostgreSQL RLS policy reads. The obvious follow-up is to write policies
that do not read a mutable setting at all. **For this schema, no such
formulation exists.** Every table that needs row scoping needs to know
*which* student or faculty member is asking, and there is no unforgeable
place to put that under the current connection architecture.

### Why `current_user` is not the escape hatch

The natural alternative is a per-user database role, with policies reading
`current_user` instead of a custom setting. That is worse, not better,
because **`role` is itself a writable GUC**:

| probe, session authenticated as `readonly_app` | result |
|---|---|
| `SELECT set_config('role','probe_student32',true)` | `current_user` becomes `probe_student32` |
| same call from inside a subquery target list | escaped back to `readonly_app` |
| `SELECT set_config('role','app',true)` | `ERROR: permission denied to set role "app"` |

Switching is bounded by role membership, which is the only good news. But
`SET LOCAL ROLE` requires the pooled session user to be a *member* of every
per-user role it might switch into — and a query can then switch freely
among exactly those roles. A connection pooled across users would hand
student A a one-line path to student B's identity. The GUC approach at
least confines the attack to rewriting a value; the naive per-user-role
approach hands over authentication itself.

### The eleven tables

Nine student-scoped, two faculty-scoped. Each reads `app.student_id`,
`app.faculty_id` or `app.role` from the session, and each therefore rests
on the layer 1 and layer 2 mitigations described in §10 rather than on a
structural guarantee:

| table | scoping key | why no GUC-free form |
|---|---|---|
| `students` | `student_id` | three different predicates by role; the role itself is a setting |
| `attendance` | `student_id` | direct column, still needs "which student" |
| `marks` | `student_id` | as above |
| `fee_payments` | `student_id` | as above |
| `library_transactions` | `student_id` | as above |
| `placement_applications` | `student_id` | as above |
| `student_enrollments` | `student_id` | as above |
| `student_section_mapping` | `student_id` | as above |
| `placement_offers` | via `application_id` | no direct column; `EXISTS` against a table that is itself GUC-scoped |
| `faculty` | `faculty_id` | own row plus department visibility |
| `faculty_subject_assignments` | `faculty_id` | direct column |

The fourteen shared reference tables (`departments`, `programs`,
`academic_years`, `semesters`, `subjects`, `subject_offerings`, `sections`,
`exam_types`, `exams`, `fee_categories`, `fee_structure`, `library_books`,
`placement_companies`, `placement_drives`) are GUC-free in the only way
that counts: they get **no policy at all**, because every user is entitled
to see all of them. That is not a mitigation, it is an absence of a
requirement.

### What would make it structural

Two designs remove the mutable setting from the trust path. Both cost
something the current architecture does not currently pay:

1. **Connection authenticated directly as the per-user role.** No
   membership, so nothing to switch into, so `set_config('role', ...)` has
   no reachable target. Ends cross-user connection pooling and ties
   PostgreSQL role lifecycle to application account lifecycle.
2. **Session table keyed on `pg_backend_pid()`.** A query cannot forge its
   own backend pid, and `readonly_app` has no write privilege on the table,
   so the mapping is unforgeable from inside the query. Costs a committed
   write per request from the privileged connection.

Neither is implemented as of this section. The honest statement for the
paper is that the enforcement boundary is in the database, which survives
arbitrary query *shape* — that claim is intact and is the point of choosing
RLS over predicate injection — but the *binding of identity to session* is
not equally protected, and rests on a denylist plus a post-execution check
that a sufficiently informed attacker can evade by restoring the value
before the statement ends.

That distinction is worth stating precisely rather than blurring: **RLS
removes the "a clever query shape defeats the filter" class of attack. It
does not by itself remove the "a clever query rewrites who you are" class.**

## 12. The limitation in section 11, closed: backend-keyed session identity

Sections 10 and 11 establish two things. Generated SQL can rewrite the
session GUC an RLS policy reads, in nine of ten query shapes tested. And
`current_user` is no escape, because `role` is itself a writable GUC — a
per-user-role design would hand a query membership-bounded access to other
users' identities, which is worse than what it replaces.

Section 11 concluded that all eleven scoped tables therefore depended on a
denylist plus an evadable post-execution check, and named two designs that
would make the binding structural instead. **One of them is now built.**

### What replaced the GUC

`app.session_map`, keyed on **`(pid, backend_start)`**:

```sql
SELECT s.* FROM app.session_map s
 WHERE s.pid = pg_backend_pid()
   AND s.backend_start = (SELECT a.backend_start FROM pg_stat_activity a
                           WHERE a.pid = pg_backend_pid())
   AND s.expires_at > now()
```

Neither value is settable from SQL. A backend cannot choose its own pid and
cannot change its own start time, so the two attacks that defeat the GUC
design — rewriting the setting, or switching role — have nothing to act on.
The executing role is granted `SELECT` on the table and nothing else, so a
generated query can read the mapping but can never write one. The row is
written by the privileged connection, in a separate committed transaction,
before the query statement begins.

### Why the composite key, not pid alone

Operating systems recycle process ids. A row left behind for pid 12345
would silently grant that identity to whichever unrelated backend next
received pid 12345 — a wrong-user data leak arriving through *normal
operation*, not through an attack, and therefore one that no amount of
query-shape testing would surface. `backend_start` disambiguates: two
backends may share a pid over time, never a pid and a start timestamp.

This is asserted, not assumed. `test_recycled_pid_with_a_stale_row_is_rejected`
plants a row for the current pid carrying a *different* `backend_start` and
a different student's identity, then checks that the session sees **zero**
rows — and that adding the correct row afterwards yields only the correct
student's rows, so a stale row cannot contaminate a live session either.

### Fail-closed, by SQL semantics rather than by vigilance

The accessors return `NULL` when there is no valid mapping, so a policy
written as `USING (student_id = app.current_student_id())` evaluates to
`NULL`, not `TRUE`, and the row is excluded. **No mapping yields zero rows,
never all rows**, without anyone having to remember a guard clause on the
eleventh table. Verified directly (`test_no_mapping_yields_zero_rows_not_all_rows`),
along with an expired mapping (`test_expired_mapping_stops_granting_identity`)
and a failed bind aborting the request rather than running unscoped.

### What a failed cleanup costs

Cleanup is post-request `DELETE`, with `expires_at` as a TTL backstop. A
failed delete is harmless, and the composite key is why: the leftover row
can only ever match the exact backend it was written for. If that backend
is reused by this application, the next request overwrites it via `ON
CONFLICT` before running anything. If the backend dies, no future backend
can match the key, because a new process gets a new start time even on a
recycled pid. Proven in `test_a_failed_delete_leaves_nothing_another_backend_can_use`.

### Measured cost on the real request path

Not the probe — the wired path, 40 samples, median ms:

| step | median | p95 |
|---|---|---|
| read backend identity | 0.45 | 1.14 |
| bind session map | 0.84 | 1.31 |
| bind GUCs (redundant) | 0.75 | 1.05 |
| **the query itself** | **7.14** | **8.50** |
| re-assert GUCs (redundant) | 0.37 | 0.54 |
| release session map | 0.85 | 1.11 |

**Total overhead 3.26 ms**, of which 2.14 ms is the control and 1.12 ms is
the deliberately retained redundant layer. Against a request whose
dominant cost is a multi-second LLM call, that is not a meaningful figure —
it is roughly 0.1% of a two-second generation. The policy lookup itself
compiles to an `InitPlan` evaluated once per statement (`loops=1` against a
150,000-row table), so it does not scale with result size.

### The old layers are kept, and are now redundant by design

The `set_config` denylist and the GUC re-assertion both stay, even though
the policies no longer read those GUCs. Removing a layer the moment another
one works would undercut the defence-in-depth argument this project is
making everywhere else. They also still do something specific: if a policy
is ever written against `current_setting()` by mistake — the natural thing
to reach for, and what every tutorial shows — the old attack surface does
not silently reopen. Drift becomes a caught anomaly instead of a breach.
The code says "redundant-by-design, not load-bearing" so nobody later
mistakes cheap insurance for the control.

### For the paper

The honest claim is now stronger than section 11 allowed, and it is worth
stating precisely because the distinction is the contribution:

- **Enforcement is in the database**, so it survives arbitrary query shape.
  That was always true of RLS and is why it beats predicate injection.
- **Identity binding is also structural**, resting on two values the query
  cannot forge, rather than on a setting it can rewrite.

Section 11 remains in this document unedited above. The sequence — pattern
found, limitation stated precisely, cost measured, control built — is more
useful than the endpoint alone, and a limitation that was closed is a
better result than one that was merely disclosed.

## 13. A schema browser bypasses Row Level Security entirely

This one generalises past this project, and it is worth stating plainly
because **a policy audit will not find it**. It is not a policy failure.
Every policy can be perfect and the hole is still open.

### The mechanism

`app/schema/introspect.py` runs on the **owning** connection, because it
has to: reading `pg_catalog`, foreign keys and column types is structural
work, and the read-only role would give a partial answer. Owners bypass
RLS unconditionally unless `FORCE ROW LEVEL SECURITY` is set, which it
deliberately is not here.

But `introspect_schema()` does not only read structure. Two of the things
it returns are **data**:

- `_sample_values()` runs `SELECT DISTINCT <column> FROM <table> LIMIT 5`
- `_row_estimate()` runs `SELECT COUNT(*) FROM <table>`

Both reach the client through `GET /v1/schema`, which any authenticated
user can call. So before the fix below, a student could open the Schema
Explorer and read five real values from **every column of every table** —
including columns their row policy was carefully written to hide, and
including exact row counts for tables they can see one row of.

No row policy gets an opportunity to intervene, because the query never
executes as the row-scoped role.

### Why an audit misses it

Every instinct for verifying RLS points at the wrong place:

- `pg_policies` is complete and correct. Eleven tables, eleven policies.
- Testing the query path proves nothing about this path — different role,
  different connection, different endpoint.
- The endpoint is called "schema", and schema is structure, and structure
  is not supposed to be data. The name actively misleads.

The leak arrives through an API whose entire purpose is to expose
structure. It looks like metadata. Five sample values from
`students.blood_group` are not metadata.

### The distinction that fixes it

**Structure is not data, but a sample value is data wearing structure's
clothes.** Once stated that way the fix is obvious and narrow:

| returned by `/v1/schema` | is it | treatment |
|---|---|---|
| table and column names, types, nullability | structure | shown to everyone |
| primary and foreign keys | structure | shown to everyone |
| sample values | **data** | suppressed for restricted columns; role-gated otherwise |
| row estimates | **data** | role-gated |

Column *existence* stays visible to every user. An operator is entitled to
know a column exists, and hiding the name buys nothing — the model is not
the attacker, and a curious user learns the same from any ER diagram.

### What this project does now

`RESTRICTED_COLUMNS` in `app/schema/introspect.py` names the columns the
query role has no grant on: `faculty.salary`, `students.category`,
`students.blood_group`. They receive two different treatments, and the
split is the point:

- **omitted entirely from the generation prompt**, so the model never
  learns they exist and never writes SQL that execution would refuse —
  fixing the cause, not the symptom;
- **listed but sample-free in the Schema Explorer**, unconditionally, not
  gated on who is asking, because introspection runs as the owner and
  there is no role to gate on at that layer.

Row estimates remain role-gated work (W5), not yet done at the time of
writing this section.

### The general statement

> Any text-to-SQL system that exposes a schema browser over a row-scoped
> database has this hole. Introspection must run privileged to be
> complete; anything it returns that is derived from row contents —
> samples, counts, min/max, histograms, "top values" — bypasses every row
> policy in the database, and no amount of policy review will surface it,
> because the policies are not involved.

The general defence is equally short: **audit the introspection endpoint's
response fields, not its queries.** Ask of each field whether it could
differ between two users of the same schema. If it could, it is data.

---

*Reproduction: `eval/analyze.py`, `eval/analyze_strict.py`,
`eval/fit_calibration.py [--strict]`, `eval/ablation_multiquery.py`,
`eval/report_strict_ex.py`, `eval/backfill_multiquery_gemini.py` against `eval/results.jsonl` and
`eval/results_gemini.jsonl`. None make LLM calls; all are read-only
against the golden-set database for re-executing stored SQL where
needed. `eval/results.jsonl` and `eval/results_gemini.jsonl` are both
unmodified by any analysis in this document.*


## 14. The 0.118 vs 0.121 held-out ECE discrepancy — reconciled (2026-09-15)

Two different numbers were being published for the same quantity, the
Anthropic held-out isotonic-calibrated ECE under permissive labels:

| source | figure |
|---|---|
| `README.md`, `app/api/routes.py::held_out_ece`, `eval/README.md` | **0.118** (paired with AUROC 0.574) |
| `eval/FINDINGS.md` §2 | **0.121** (paired with AUROC 0.564) |

### What was re-run

`eval/fit_calibration.py eval/results.jsonl --seed 42 --train-frac 0.6`,
the documented procedure, with `--out`/`--plot` redirected to a scratch
path so the production artifact was untouched (verified by md5 before and
after: `e8a25bb5…` unchanged). No LLM calls; this path reads
`eval/results.jsonl` only.

```
Held-out, RAW hand-tuned score (no calibration): AUROC=0.552  ECE=0.171 (n=162)
Held-out, ISOTONIC-CALIBRATED:                   AUROC=0.564  ECE=0.121 (n=162)
```

`n=162` matches the documented split exactly (81 train / 54 test
questions), so a split or seed mismatch is **ruled out** — unlike the §5
investigation, the eligibility set is provably identical.

### Where 0.118 came from

The pre-fix path was reconstructed directly: take the same split, push both
halves through the production isotonic curve *first*, then fit again on top
— which is precisely what `fuse_confidence()` did before `4e9ac32` (§1).

```
                                              raw            calibrated
A. corrected scorer (documented procedure)   0.552 / 0.171   0.564 / 0.121
B. pre-fix path (pre-calibrated input)       0.564 / 0.117   0.564 / 0.121
```

**0.118 is row B's *raw* cell, not a calibrated result.** It is the ECE of
scores that had already been through the isotonic curve while being labelled
"RAW hand-tuned score (no calibration)" by `fit_calibration.py`'s own
output — the exact mislabelling §1 documents. Reproduced today at 0.117
against the recorded 0.118.

So 0.118 never measured what it was published as. It is not a better
calibration result; it is the double-calibration bug's artifact, read off
the wrong row and promoted into the README, the Admin endpoint and the
paper-facing summary.

### What did not reconcile

The paired **AUROC 0.574 could not be reproduced by either path** — both
give 0.564. That residual is the same class and the same era as §5's
in-sample 0.649 (reproduced at 0.625), with the same suspected and
unconfirmed cause: `roc_auc_score` tie-handling across sklearn versions,
with no record of which version was installed at the time
(`sklearn==1.9.0` is pinned now). Not confirmed by rolling back, for the
same reason given in §5.

### For citation

> **Use ECE 0.121 and calibrated held-out AUROC 0.564.** Both reproduce
> today from a documented, re-runnable procedure on an identical split.
> **0.118 and 0.574 are superseded and must not be cited.** 0.118 in
> particular should not be described as a calibration result at all.

`README.md` and `eval/README.md` have been corrected. `app/api/routes.py`
still serves `held_out_ece=0.118` alongside `fused_auroc=0.649`, both
deliberately frozen and both flagged in `README.md` — the same treatment
0.649 received in `dece029`. **That freeze is now a demo hazard**: the
Admin screen and this document disagree on two figures, and a reviewer
comparing them will find it. Retiring both in `routes.py` is the
outstanding action.

### Note for §9

This is instance 2's blast radius, one layer further out than §1 recorded,
and it is written up there as its own case — see **§9, "Instance 2 again,
one layer out: when the bad value outlives the bug"**. The short version:
the double-calibration bug did not only affect the Gemini refit; it put a
mislabelled figure into three user-facing surfaces, where it survived nine
days and two documentation passes. The bug was fixed on 2026-09-03; the
number it produced was not retired until 2026-09-15. **A wrong number is
more durable than the bug that produced it.**
