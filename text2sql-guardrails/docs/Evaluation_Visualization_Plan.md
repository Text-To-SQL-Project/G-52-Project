Evaluation Visualization Plan

SafeSQL / text2sql-guardrails — turning existing findings into figures

**Prepared:** 2026-09-15 | **Source of truth:** eval/FINDINGS.md, results.jsonl, docs/SECURITY_MODEL.md, PROJECT_HISTORY.txt

## Purpose

This document is a build plan, not a design exploration. Every chart specified below is backed by a number that already exists in the repository's evaluation artifacts — nothing here requires new experiments. The goal is to turn eval/FINDINGS.md into a small set of figures that a paper reviewer, a demo audience, and the project's own Admin screen can each use, without inventing a fourth definition of any metric.

Use this document as the working query/brief when asking a code assistant (or a human contributor) to generate the figures: each chart entry below is written to be pasted directly as a generation request, with its exact data, chart type, axes, and caveats spelled out.

# 1\. Scope and Ground Rules

Three ground rules apply to every figure in this plan, carried over directly from how the project already treats its numbers:

- Anthropic and Gemini are never merged into one series. They differ in sample size (405 vs 120 usable rows) and repeat count (3 vs 1), and the project's own findings log treats merging them as a methodological error.
- Permissive and strict scoring are always shown together, never one without the other. The strict-mode EX drop (−0.299 Anthropic, −0.244 Gemini) is one of the project's central findings — a chart that shows only permissive numbers misrepresents capability.
- Any number flagged "do not cite" in FINDINGS.md (fused_auroc = 0.649) must not appear in a paper or README figure. It may appear in an Admin-only debug view, explicitly labelled as the frozen/stale value, never as a headline number.

# 2\. Three Audiences, Three Toolchains

Graphs serve three different readers. Don't build one pipeline and reuse it for all three — the constraints are different enough that forcing one tool to do all three jobs will cost more time than it saves.

| **Audience**           | **Where it lives**                        | **Tooling**                            | **Constraint**                                                      |
| ---------------------- | ----------------------------------------- | -------------------------------------- | ------------------------------------------------------------------- |
| Paper reviewers        | Static figures in the manuscript / README | Python: matplotlib + seaborn           | Must be reproducible from a script; no interactivity needed         |
| Live demo / evaluators | Admin screen, React app                   | Recharts (already React/Vite/Tailwind) | Reads from the running API; must not silently show the frozen 0.649 |
| Internal / exploratory | Ad hoc, while re-deriving numbers         | matplotlib, quick scripts              | Throwaway — optimize for speed, not polish                          |

# 3\. Data Inventory — What Already Exists

Everything below is already computed and verified in the repository. No new evaluation run is required to produce the first version of any chart in Section 4.

| **Metric family**                                                  | **Source**                        | **Granularity**                        |
| ------------------------------------------------------------------ | --------------------------------- | -------------------------------------- |
| Execution accuracy (permissive / strict)                           | eval/FINDINGS.md §2               | Per provider                           |
| Fused confidence AUROC (raw / calibrated × permissive / strict)    | eval/FINDINGS.md §2               | Per provider                           |
| Calibration error (ECE)                                            | eval/FINDINGS.md §2               | Per provider, raw vs calibrated        |
| Ablation deltas (4-signal vs 5-signal)                             | eval/FINDINGS.md §5 investigation | Per provider × label × split (8 cells) |
| Per-signal AUROC under permissive vs strict                        | eval/FINDINGS.md §5               | Per provider, per signal               |
| Agreement/disagreement mechanism (mean MQ score, FAIL/PASS mix)    | eval/FINDINGS.md §5               | Per provider, 2 groups                 |
| RLS row counts (before / after / admin)                            | docs/SECURITY_MODEL.md            | Per table × principal                  |
| Safety layer metrics (block rate, refusal, clarification accuracy) | eval/FINDINGS.md §6               | Per provider                           |
| Auth cost (Argon2id verification latency)                          | docs/SECURITY_MODEL.md            | Single distribution, 77–112ms          |

# 4\. Figures to Build — Paper / README (matplotlib + seaborn)

Each entry is written as a self-contained spec: paste it as-is when asking for the chart to be generated.

## 4.1 Permissive vs Strict Execution Accuracy

- Chart type: grouped bar chart
- X-axis: provider (Anthropic, Gemini)
- Series: Permissive EX, Strict EX
- Data: Anthropic 0.714 → 0.415; Gemini 0.607 → 0.363
- Annotation: label each bar pair with the delta (−0.299, −0.244)
- Caption note: "Neither number is wrong — they score different criteria; both are reported together by project policy."

## 4.2 The Ablation Inversion (headline figure)

- Chart type: 2×2 grid of grouped bar charts (facets = permissive/strict × in-sample/held-out), each facet showing 5-signal vs 4-signal AUROC for both providers
- Data source: the 8-cell delta table in FINDINGS.md §5 (Anthropic in-sample permissive +0.065 down to Gemini held-out strict +0.024, etc.)
- Highlight: outline or color the one cell (Anthropic, permissive, in-sample) that reproduces the original justification for dropping multi_query_agreement, to make visually explicit that it is 1 of 8 cells, not the average
- This is the single most important figure in the set — it is the visual argument for why the production default (MULTI_QUERY_ENABLED=false) rests on weak evidence

## 4.3 Per-Signal AUROC Inversion

- Chart type: slope chart (dumbbell / before-after lines), one line per signal per provider
- X-axis: two points, "Permissive" and "Strict"
- Data: multi_query_agreement 0.532→0.734 (Anthropic), 0.568→0.783 (Gemini); include the other four signals for contrast
- Purpose: show multi_query_agreement crossing from weakest to strongest signal as the label definition changes — no other signal moves this much

## 4.4 Calibration Reliability Diagrams

- Chart type: reliability diagram (predicted probability bins on X, empirical accuracy on Y, diagonal = perfect calibration)
- Panels: 4 small multiples — {permissive, strict} × {Anthropic, Gemini}, each showing raw vs calibrated curves
- Data: ECE raw→calibrated — permissive 0.171→0.121 (Anthropic), 0.272→0.032 (Gemini); strict 0.475→0.078 (Anthropic), 0.485→0.077 (Gemini)
- Caption note: flag the unresolved 0.118-vs-0.121 discrepancy between README/Admin and FINDINGS §2 for the Anthropic permissive held-out figure; do not silently pick one

## 4.5 RLS Row-Count Impact

- Chart type: grouped bar chart, log-scale Y axis (the ratios span 3 orders of magnitude)
- X-axis: table (students, marks, attendance)
- Series: before RLS, after RLS (as student), admin
- Data: students 2000/1/2000; marks 40000/19/40000; attendance 150000/79/150000
- Caption note: state explicitly that the after-RLS attendance count (79) matching another test student's count is a coincidence of seeded data, not evidence of correctness — identity was asserted separately, not inferred from this count

## 4.6 Agreement/Disagreement Mechanism

- Chart type: two side-by-side stacked bar charts (Agreement group, Disagreement group), each stacked by FAIL/PASS(/WARN) status, annotated with mean MQ score
- Data: Anthropic disagreement n=155, mean 0.303, 108 FAIL/47 PASS; agreement n=250, mean 0.632, 92 FAIL/158 PASS. Gemini disagreement n=43, mean 0.279; agreement n=77, mean 0.656
- Purpose: shows mechanistically why the signal inverts — disagreement rows are the ones permissive scoring is lenient about, and MQ correctly flags them as low-confidence

# 5\. Figures to Build — Admin Dashboard (Recharts)

These extend the existing React Admin screen. They should read live values from the API rather than embedding static numbers, since their entire purpose is to reflect the running system during a demo.

| **Component**        | **Chart type**                              | **Data source**                  | **Demo note**                                                                                                   |
| -------------------- | ------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| AurocSummaryPanel    | Small bar/gauge pair                        | /v1/admin (live)                 | Must visually flag when the served value is the frozen 0.649 rather than the citable 0.625/0.552                |
| RlsRowCountChart     | Interactive grouped bar, principal selector | /v1/admin/rls-demo or equivalent | Replaces the scripted before/after moment in DEMO_RUNBOOK.md with a live, operator-triggered chart              |
| SafetyLayerBreakdown | Grouped bar, layers kept visually separate  | /v1/admin (live)                 | Must keep guardrail block rate and LLM refusal accuracy as distinct series — never merge into one 'safety rate' |

# 6\. Required Code Changes

| **File / path**                | **Change**                                                                            | **Why**                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| eval/generate_figures.py       | New script; reads results artifacts, writes eval/figures/\*.png                       | Single reproducible source for every paper figure                                                  |
| eval/requirements.txt          | Add matplotlib, seaborn; pin versions                                                 | Same discipline already applied to sklearn==1.9.0, to avoid a repeat of the unresolved 0.649 drift |
| frontend/package.json          | Add recharts                                                                          | Lightweight, composable, matches existing Tailwind setup                                           |
| frontend/src/components/admin/ | New chart components (AurocChart.tsx, RlsRowCountChart.tsx, SafetyLayerBreakdown.tsx) | Admin-screen visualizations                                                                        |
| app/api/routes.py              | Expose the full 8-cell ablation grid and per-signal AUROC, not just fused_auroc       | Dashboard cannot show the ablation story live without the underlying cells                         |
| docs/DEMO_RUNBOOK.md           | Update script to reference the live RLS chart                                         | Keep runbook in sync with the interactive replacement                                              |
| README.md                      | Embed 2–3 generated PNGs (permissive/strict, ablation inversion)                      | README already leads with evaluation numbers per commit ea1f079; figures reinforce that            |

# 7\. Sequencing

1. Build eval/generate_figures.py and produce the six paper figures (Section 4) first — lowest risk, no frontend dependency, unblocks the paper immediately.
2. Embed 2–3 of those figures in README.md.
3. Resolve the two open numeric discrepancies (0.118 vs 0.121 ECE; 0.649 vs 0.625 AUROC) before citing any chart that depends on them in the paper — a chart will assert a number visually even if the surrounding text hedges it.
4. Only after the paper figures are stable, add Recharts to the Admin screen — avoids maintaining two divergent definitions of the same numbers in parallel.
5. Update docs/DEMO_RUNBOOK.md once the live RLS chart replaces the scripted row-count moment.

# 8\. Guardrails When Generating These Charts

If delegating chart generation to a coding assistant, include these constraints directly in the request — they are easy to lose otherwise:

- Never plot Anthropic and Gemini as a combined average.
- Never plot permissive EX without strict EX in the same figure or an adjacent one.
- Never surface fused_auroc = 0.649 outside an explicitly labelled 'frozen/stale' debug element.
- Any figure involving row counts under RLS must not imply identity was verified by count matching — caption or annotate that identity was asserted separately.
- Source every number from eval/FINDINGS.md or docs/SECURITY_MODEL.md at generation time — do not hardcode figures from this document without re-checking against the live file, in case either has been updated since.