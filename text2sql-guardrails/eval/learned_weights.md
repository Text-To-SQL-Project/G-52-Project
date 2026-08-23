# Learned confidence-fusion weights

Fits `fuse_confidence()`'s weights from `eval/results.jsonl` data via logistic regression, as a data-driven alternative to the hand-tuned weights in `app/detection/confidence.py`. No new LLM calls were made -- this is a pure offline re-analysis of the existing evaluation run.

## Dataset

- **105 usable rows** (35 unique golden-set questions x up to 3 repeats), restricted to answerable, non-adversarial cases with a non-`None` `correct` label and all 5 signal scores present (no rows were dropped for missing signals in this run).
- Class balance: **74 correct / 31 incorrect** (70.5% positive).
- Feature order (fixed, used for every coefficient below): `back_translation_match, multi_query_agreement, result_sanity, schema_alignment, sql_validity`.
- Grouping for cross-validation: golden case `id` -- the 3 repeats of the same question are always kept together in either train or test, never split across the boundary, since generation is non-deterministic but repeats of the same question still share question-specific characteristics that would leak across a naive random split.
- `5`-fold `GroupKFold`, `random_state=42` where randomness is involved (the inner fit/calibration split for isotonic calibration).

## Results (all metrics on held-out data)

| Approach | AUROC | ECE (n) |
|---|---|---|
| 1. Hand-tuned (current `fuse_confidence`) | 0.359 | 0.356 (n=105) |
| 2. Learned (logistic regression, 5-fold CV) | 0.253 | 0.220 (n=105) |
| 3. Learned + isotonic calibration | 0.473 | 0.197 (n=105) |

AUROC: does the score rank correct answers above incorrect ones (label = 1 if `correct`, higher score = more confident it's correct)? 0.5 = chance, 1.0 = perfect separation.
ECE (Expected Calibration Error, Guo et al. 2017, 10 equal-width bins over [0,1]): does the score's numeric VALUE match the observed accuracy at that value? 0.0 = perfectly calibrated.

**Note on comparability with the earlier ablation report** (`eval/analyze.py`'s "most load-bearing signal" section): that analysis used a *broader* dataset (n=113) including adversarial/unanswerable cases that reached `success` (labeled always-wrong), and the opposite score direction (predicting *wrongness*). The numbers here use a *narrower*, `correct`-label-only dataset (n=105) as the user's request specified, so the two AUROC figures are not directly the same quantity and should not be expected to match numerically.

## Learned coefficients

From a **final logistic regression fit on all 105 usable rows** (unregularized default, `sklearn.linear_model.LogisticRegression`) -- this is the model the AUROC/ECE numbers above are estimating the held-out performance OF, not itself evaluated on held-out data (that's what the CV numbers above are for). Positive coefficient = higher signal score pushes the prediction toward "correct"; magnitude is directly comparable across signals since all 5 raw scores are already on the same [0,1] scale (no feature standardization was applied).

| Signal | Final-fit coefficient | Hand-tuned weight | Across-fold mean +/- std |
|---|---|---|---|
| `back_translation_match` | +0.679 | 0.25 | +0.559 +/- 0.555 |
| `multi_query_agreement` | -0.621 | 0.15 | -0.582 +/- 0.390 |
| `result_sanity` | +0.741 | 0.20 | +0.572 +/- 0.378 |
| `schema_alignment` | +0.001 | 0.30 | -0.002 +/- 0.004 |
| `sql_validity` | +0.001 | 0.10 | -0.002 +/- 0.004 |
| *intercept* | -0.071 | -- | -- |

**Coefficient stability:** high variance across folds -- treat individual-fold coefficients with caution, this dataset (35 unique questions) is small for a 5-feature fit. See the across-fold mean +/- std column -- a std comparable to or larger than the mean for a given signal means its sign/magnitude is not reliably estimated from this sample size and any large deviation from the hand-tuned weight should be treated as a hypothesis to re-test with more data, not a settled result.

## Limitations

- **Small sample**: 35 unique questions is a small training set for a 5-parameter logistic regression; coefficient estimates (and especially the isotonic calibration map, fit on an even smaller inner split) carry substantial variance -- see the stability note above.
- **Repeats are not fully independent**: the 3 repeats per question share the same underlying question and schema context even though generation is non-deterministic; GroupKFold prevents them from spanning the train/test boundary, but within a fold they're still correlated samples, not i.i.d. draws.
- **Label scope**: only rows with a `correct` label are used here (answerable, non-adversarial cases). The adversarial/unanswerable cases that reached `success` when they shouldn't have (a real failure mode, see eval/analyze.py's safety-check output) are *not* represented in this fit at all, since they have no `correct` label by construction.
