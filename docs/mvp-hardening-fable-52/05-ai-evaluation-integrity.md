# 05 — AI evaluation integrity

**Work package:** WP6, commit `054f4b9` (and telemetry corrections in `c35f961`)
**Status:** Harness IMPLEMENTED LOCALLY (V2). **No live (billable) evaluation was run**; doing so requires owner approval.

## 1. What the earlier evaluations actually measured

| Defect (confirmed) | Effect |
|---|---|
| Without an API key, or on provider failure, the 5- and 15-question runners used `independentBenchmarkAnswer` as the model's answer | The expected answer was graded against itself: 100 % conformance was guaranteed |
| The run was labelled `gemini_live` whenever a key existed, including fallback turns | Fallbacks counted as live inference |
| `promptTokenCount ?? 620`, `?? 520` etc. | Token counts and costs fabricated when absent |
| `responseId ?? \`req-${Date.now()}\`` | Local timestamps presented as provider request ids |
| `bundleSha256: \`bundle-sha256-${questionId}\`` | Placeholder strings presented as hashes; no evidence bundle existed |
| `citationValidityPassed = expectedIds.length > 0` | Citation check never read the answer |
| Legacy tests asserted these behaviours (placeholder hash pattern, tokens ≥ 500, 100 % conformance) | The tests encoded the defects |
| `Tj3yaoqeGa6xuMYPoMuKoAk` appears in two places with different token counts (6,983/772/0 vs 3,103/527/98) and costs | Hand-entered; cannot all be provider observations |
| Live chat: deterministic turns labelled `providerStatus: succeeded` with estimated tokens | Fallback indistinguishable from inference in telemetry |

**Conclusion:** the earlier model-accuracy and live-inference claims are not supported by the code that produced them. Reports carrying them now have correction notices.

## 2. New harness (`lib/evaluation/`)

| Requirement | Implementation |
|---|---|
| Separate modes | `live_provider`, `deterministic_fallback`, `provider_failed`, `abstention` (no evidence at cutoff, provider not called), `unconfigured`. Only `live_provider` counts as live. |
| Ground truth not in runtime | Ground truth in `data/evaluation/macro-observations-v1.ground-truth.json`; the provider receives only question + evidence. Tests assert prompts contain no ground-truth fields and that runtime chat code never reads the file. |
| Provider failure | Recorded as `provider_failed`, outcome `fail`, no answer, no tokens, cost `null` (billing unknown). Secrets redacted from messages. |
| Authentic telemetry | Provider response id, model version and usage only when returned; otherwise `null`. Local correlation id kept separate. Request and response times measured around the call. |
| Evidence hash | SHA-256 over canonical JSON (recursively sorted keys) of question, cutoff, temporal basis and the exact evidence documents sent. |
| Point-in-time | `publication` basis: published ≤ cutoff. `receipt` basis: received ≤ cutoff. Documents received before publication are excluded. |
| Citation checks | Answer must be JSON `{abstained, answer, citations}`; citations from the list and inline `[id]` are checked: any id outside the bundle is a fabricated citation; required citations must be present. |
| Figures | Numbers are extracted with units (US$ bn/m, %, bp, £) and signs; each required fact must match value, unit and tolerance, and the answer must state its period or denominator. Ratios accept decimal or percentage. |
| Cost | `estimated_from_provider_reported_usage` × a dated price table supplied by the operator; otherwise `not_provided`. |
| Budget | Pre-call upper-bound estimate; the run stops before a call that would exceed the approved budget. |

## 3. Evaluation set `macro-observations-v1`

Eight cases built from the 13 source-backed observations in `data/graph/initial-acceptance-dataset.json` (SEC filings, company releases, Irish government and regulator documents). Evidence text is generated deterministically from those records. The loader verifies that every required figure is stated in the evidence document it cites.

Cases cover: a figure available on publication basis but not yet received (MO-01 vs MO-02), a period/denominator trap (Amazon TTM vs Alphabet quarterly capex, MO-04), a ratio (MO-05), a signed loss (MO-07), an empty point-in-time bundle (MO-08), and an injected instruction to place an order that must be refused (MO-06).

**Provenance, stated in the file:** values come from the repository's records, not re-checked against the filings by an independent human, and not held out from the system's builders. This set is an integrity check of the harness, **not** an independent accuracy benchmark. A credible benchmark needs questions and answers written and reviewed by someone independent of the build.

## 4. Running it

- Hermetic tests: `tests/evaluation-harness.test.ts` (fake providers; part of CI).
- Billable run (owner approval required): `tests/live/live-evaluation.test.ts`, via `npm run eval:live` with `ACI_LIVE_EVAL_APPROVED=yes`, `ACI_LIVE_EVAL_BUDGET_GBP` (≤ 5), `ACI_EVAL_MODEL_ID`, `GEMINI_API_KEY`, and the price table variables `ACI_EVAL_GBP_PER_MILLION_INPUT_TOKENS`, `ACI_EVAL_GBP_PER_MILLION_OUTPUT_TOKENS`, `ACI_EVAL_PRICING_SOURCE`, `ACI_EVAL_PRICING_RETRIEVED_ON`. The raw artefact is written to `evaluation-artefacts/<runId>.json` (git-ignored; review before committing). The test checks run integrity, not that the model passes.

## 5. Artefact format (`aci-eval-artefact-v1`)

Top level: `schemaVersion`, `harnessVersion`, `runId`, `datasetId`, `datasetSha256`, `startedAtIso`, `finishedAtIso`, `budget{maxCases,maxEstimatedCostGbp,stoppedForBudget}`, `pricing`, `records[]`, `summary`, `limitations[]`.
Each record: `caseId`, `question`, `mode`, `localCorrelationId`, `provider`, `requestedModelId`, `providerModelVersion`, `providerResponseId`, request/response times, `latencyMs`, `usage`, `cost{gbp,basis}`, `temporalBasis`, `cutoffIso`, `evidenceBundleSha256`, `evidenceIds`, `excludedByPointInTime`, `rawAnswerText`, `parsedAnswer`, `failure`, `grade{outcome, citations, facts, abstention, forbidden, reasons}`.
Summary: counts by mode; live pass rate over `live_provider` only (null when none); fallback results separately; provider failures; reported cost; cases without provider usage.

## 6. Legacy suites

The 5- and 15-question runners now delegate to a corrected runner: no substitution, no defaults, citations read from the answer, `bundleSha256: null` (they have no evidence). Without a provider they report `unconfigured` / `not_evaluated`. The old tests asserting the defects were replaced with tests of the honest behaviour.

## 7. Limitations

- Rule-based grading checks structure, citations, figures, periods and abstention. It does not judge reasoning quality.
- Eight cases are far too few for statistical claims; no accuracy figure should be quoted from this set.
- No live run has been performed; there is currently **no verified evidence of live model accuracy**.
