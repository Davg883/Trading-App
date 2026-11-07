# Benchmark 001.2 — Proof & Scale

The common framework covers investment research and Vectis ONE service pilots. It extends the existing source registry, evaluation workers and human review architecture; it does not change prior forecast scoring, earnings calculations or paper execution rules.

## Evidence and decisions

The Data Integrity Register retains authoritative-source identity, a source URL, data owner, last verification, permitted uses, reconciliation status, exception policy and revision lineage. A policy can describe investigation or remediation but cannot waive a critical-data block. Revisions are appended, not edited into old snapshots. Publication, receipt and verification dates are evaluated against the decision cutoff; later evidence is unavailable to an earlier forecast. Integrity metadata linked to an existing source does not retroactively rewrite that source's recorded history.

Four independent gates cover business value, data integrity, execution safety and operational readiness. Each has an accountable owner, evidence references, explicit measured thresholds with units, evaluation/revalidation dates and an audit trail. A favourable result in one gate cannot compensate for another. States are `not_assessed`, `pending`, `passed`, `failed` and `expired`. Current contradictory revisions, missing critical data, incompatible data modes and overdue revalidation block expansion.

Model recommendations are recorded separately. A recommendation is never an approval. In the connected workflow, the backend derives reviewer authority from a signed authentication claim, evaluates the evidence again at the time of the decision and writes an append-only human decision. The browser cannot supply its own human role or a successful gate state. Deployment administrators retain database control; the application audit is not a tamper-proof external ledger.

## The next increment

Defined stages are idea, limited pilot, expanded pilot and production. Stage names describe the reviewed research/service scope and grant no brokerage or purchasing authority. A reviewer can approve only the next stage, with permitted users, workflows, source IDs, a capital ceiling, operating budget, review date and rollback plan. Rejections preserve failed checks and reasons. Rollback is recorded explicitly; approval history is retained.

The `/proof-scale` page is available without credentials. It shows the evidence requirements and can inspect supplied local artifacts. The synthetic example is prominently labelled. Local exports are inspection artifacts and cannot approve a connected deployment. Actual approvals require the private connected panel and configured reviewer credentials.

## Measured value

Investment research combines forecast quality, aligned benchmark-relative returns, risk and allocated analysis costs. Market forecasts remain forecasts; they do not become realized gains. Existing Brier, return-error, interval and paper-accounting formulas retain their previous versions.

Vectis ONE separates the baseline cost of equivalent successful work, actual completions, correction costs, verified avoided expenditure, incremental contribution, genuine customer income and complete service costs. Time saved is not automatically cash saved. Unverified projections stay in a forecast column, not realized profit. Missing cost components remain unavailable. DGX Spark profitability cannot be established by a theoretical throughput or API-price comparison.

Per-run records retain model/version, input/output tokens, inference cost, latency, quality evaluation and fallback calls. Nullable hardware fields prepare for measured energy, depreciation, utilization, throughput and cost per successful task. Empty telemetry is not treated as zero consumption or free hardware.

See [versioned Proof & Scale KPI definitions](proof-scale-kpis.md), [architecture](architecture.md) and [implementation acceptance](proof-scale-acceptance.md) for formulas, verification and deployment boundaries.

## Inspiration provenance

The user cited Eric Yehle's *AI Investment Cannot Be Blind. Prove It Small. Scale It With Accurate Data*, dated 30 October 2026. The exact article was not retrievable through the implementation search. Its title and date are user-supplied context, not independently verified source evidence. This release implements the supplied development brief; it does not attribute fabricated quotations or empirical claims to the article, and the article is not used as financial evidence to pass a gate.


## Private review configuration

Configure the existing Clerk/Convex integration and its `convex` JWT template/audience first. Grant selected reviewers an administrator-managed user public metadata field `actorType: "human"`. Map that field into the signed Convex token as `"actorType": "{{user.public_metadata.actorType}}"`. Do not hardcode the human role for every user, derive it from client-editable unsafe metadata, or give model/service identities reviewer credentials. Refresh the token after a role change and verify the claim actually reaches Convex before relying on it. These behaviors follow the [Clerk JWT template](https://clerk.com/docs/guides/sessions/jwt-templates), [metadata](https://clerk.com/docs/guides/users/extending), and [Convex function authentication](https://docs.convex.dev/auth/functions-auth) documentation.

Public functions create pilots, define gate requirements and record human decisions. `importEvidence`, `recordMeasurement`, `recordEconomics`, `recordRun` and `recommendGate` are internal functions; use a separately secured trusted ingestion workflow. Validate original rights, accounting periods, quality criteria and receipts before making a verification declaration. Models must not receive deployment-administrator credentials. The backend overrides imported receipt declarations with actual application receipt and retains declared timestamps separately for provenance.

Economic imports freeze the original calculation and evidence; current source revalidation is displayed separately. Gate definitions are versioned by appending a new definition, which invalidates use of the previous approval. An altered current measurement also blocks expansion until a human reviews the new snapshot. Every approval checks server time again; client display is informational.

From the public page, export an offline evaluation request and run `python -m worker.proof_scale proof-scale-evaluation-request.json --output new-report.json`. The output preserves `executionAuthority: none`. No API credentials are required for this calculation.
