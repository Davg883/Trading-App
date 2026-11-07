# Benchmark 001.2 Proof & Scale KPI dictionary

Calculation version: `proof-001.2-v1`. Monetary measurements use GBP. Returns, utilisation, error rates and success rates use decimals; timestamps are UTC epoch milliseconds. These additive definitions do not change earlier forecast, earnings, Brier or paper-accounting formulas.

## Evidence and decision eligibility

An integrity revision preserves `id`, logical `sourceId`, authoritative source name, source URL, data owner, last verification time, permitted uses, reconciliation status, exception policy, publication time, system receipt time, mode, critical status, revision number and predecessor ID. Revision one has no predecessor. Subsequent revisions form a complete, ordered, unforked chain. Corrections append a revision; they do not overwrite an earlier forecast snapshot.

Only revisions both published and received by the evaluation cutoff are eligible. The highest eligible revision for each logical source is active. A later revision does not enter an earlier evaluation, while an old reference cannot silently remain current after a revised record becomes eligible. Verification performed after the cutoff cannot retrospectively establish eligibility.

Every referenced record must have a named authority and data owner, verification available at the cutoff, explicit permitted use, matched reconciliation and an exception policy. Missing and contradictory critical information blocks expansion even if omitted from an individual gate's references. An exception policy is an instruction to resolve or reject an exception; it is not an automatic waiver of a critical block. Synthetic, historical and forward evidence do not share a decision context.

## Four independent gates

Business value, data integrity, execution safety and operational readiness each retain an owner, required evidence, named thresholds and units, measurements, evaluation time, revalidation deadline, human decision and audit history. The states are `not_assessed`, `pending`, `passed`, `failed` and `expired`.

A threshold uses a named metric and an inclusive `gte` or `lte` comparison. Exactly one measurement for that metric is required. It must be measured rather than forecast, use the same unit, reference the gate's frozen evidence and have observation and receipt times no later than the human evaluation. A positive numerical result alone does not create a human decision. Model recommendations remain advisory.

An expansion requires all four gates to pass without unresolved blocks. Revalidation at or before the decision time is expired. Permitted users, workflows and sources, explicit capex and operating ceilings, and a future review date define the next increment. Stages are idea, limited pilot, expanded pilot and production; a decision cannot skip a stage. Production expansion additionally requires a forward-evidence context. These calculations express deterministic readiness; authenticated approval and enforcement occur in Convex. An offline file cannot prove the identity of its declared human reviewer.

## Recognised and forecast financial measurements

Each scalar uses `{value, status, evidenceIds}`. Status is `forecast`, `unverified` or `verified`. A recognised measurement requires a finite value, verified status and eligible, active source references satisfying the integrity rules. Missing values remain null with explicit blockers. Forecasts remain in the separate `forecasts` object and do not contribute to realised benefits or profit. A verification declaration is not independent proof that a source is correct: trusted ingestion and reconciliation must substantiate it.

| KPI | Definition and conditions |
| --- | --- |
| Investment forecast quality | Supplied realised Brier score and return MAE. Existing score formulas are retained. Brier is unnormalised multiclass, between 0 and 2; MAE is nonnegative. |
| Benchmark-relative result | Verified realised instrument return minus verified realised benchmark return. Both decimal returns must reference the exact same evidence-ID set (order independent), identifying a common underlying aligned outcome protocol, session window and adjustment basis. Different reference sets block the relative result. The existing market/earnings outcome engines establish alignment; this layer does not infer it from two numbers. |
| Investment risk | Supplied verified realised maximum drawdown, positive loss magnitude in 0..1. A forecast drawdown is retained as a forecast. |
| Fully allocated analysis/service cost | Sum of explicit, verified inference, labour, data, energy, hardware depreciation, operations, correction and other costs. Every component is required, including evidenced zeros. One missing or unverified component makes the total null. |
| Baseline workflow cost | Verified measured cost of the comparison workflow for its declared scope and period. It is a baseline, not automatically a cash saving. |
| Successful completions | Verified successful task count, a nonnegative integer no greater than verified attempted tasks. Missing attempt count prevents a success-rate claim. |
| Success rate | Successful tasks / attempted tasks; null if either is unavailable or attempts are zero. Quality criteria must be documented in the source evidence. |
| Correction cost | Explicit verified `correctionGbp` component of fully allocated costs. It remains visible even when another cost is missing. |
| Avoidable expenditure | Verified observed expenditure actually avoided under the measured comparison. An estimated opportunity or projected saving remains forecast/unverified. |
| Incremental contribution | Separately supplied verified incremental contribution under the declared accounting definition; a negative measured contribution remains a signed loss. It is not added again to customer income when calculating profit. |
| Customer income | Verified genuine customer income for the same measured scope and reporting period. Prospective sales or internal hours released are not customer income. |
| Cost per successful task | Fully allocated service cost / verified successful tasks; null when costs are incomplete or successes are zero/unavailable. |
| Realised service profit | Verified customer income minus complete service cost. Avoided spending and incremental contribution are reported separately and never added again into this profit. |

These period and definition boundaries must be supplied by the authoritative records. The evaluator does not combine currencies, infer missing depreciation, value released employee hours as cash, extrapolate pilot savings, allocate capital returns without a capital base, or establish DGX Spark commercial profitability from token prices. Synthetic arithmetic remains a labelled example rather than measured business income.

## Run and infrastructure economics

Per-run records retain run ID, evidence mode, provider, exact model version, integer input and output tokens, measured inference cost, response latency, quality state and fallback-call count. A summary sums tokens and fallback calls, counts tasks with `quality: passed`, and sums inference costs only when every run has an available cost. Mean latency is null if any run's latency is unavailable. Duplicate run IDs and mixed evidence modes are rejected.

The hardware object prepares nullable energy kWh, depreciation GBP, utilisation in 0..1 and throughput per second. Null means unmeasured, not zero. Per-run inference statistics deliberately leave `fullServiceCostGbp` null: they omit other delivery costs and customer income. The fieldwise economic ledger supplies the separate complete cost-per-successful-task comparison. Energy tariff, hardware acquisition/depreciation period, service occupancy and utilisation boundaries need actual readings and accounting evidence before populating these fields.

## Offline reproduction

```powershell
python -m unittest worker.test_proof_scale -v
python -m worker.proof_scale proof-request.json --output proof-report-new.json
```

Input is a JSON object with `version`, `evidence`, `asOf`, `mode` and `permittedUse`. Optional sections are `gates`, `expansion` (current stage, next stage and scope), `investment`, `vectis` and `runs`. The CLI refuses to overwrite an existing output file. Every report declares `executionAuthority: none`; neither an offline passing gate nor a reported profit authorises a paper order, brokerage action or hardware purchase.

Calculations preserve source precision using deterministic IEEE-754 arithmetic; they do not round each inference cost to two decimal places, which would erase sub-penny measurements. This research layer is not a payment ledger. Fully allocated totals exceeding the supported safe amount (`Number.MAX_SAFE_INTEGER / 100` GBP in the web engine) remain null with a block.

`commercialProfitEstablished` can be true only in forward mode, with positive genuine measured customer income, a positive result after complete verified costs, and positive verified attempts and successes. Synthetic or historical arithmetic never establishes commercial profit through this flag. Source claims and workload provenance still require independent verification; a positive pilot result does not authorise a hardware purchase or establish future demand.
