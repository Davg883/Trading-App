# AI infrastructure financing dependency

Open `/infrastructure` through the Economics Observatory. This additive Benchmark 001.2 research view preserves the established earnings, stress, Proof & Scale and paper/broker controls. Its calculation contract is `infrastructure-001.2-v1`.

## Registered retrospective case

The local case registers NVIDIA–Nscale–Anthropic financing reports and the Microsoft–Nscale Loughton customer termination. It keeps corporate financing, the Monarch development, the Ward County lease guarantee and Loughton commitments in distinct project records. Original disclosures and attributed news are identified separately; no company-wide default or quantified investment loss is inferred.

Sources, timestamps and extraction limits are documented in [source provenance](../data/infrastructure/SOURCES.md). This artifact was collected on 31 October, after the reports. The earlier-cutoff controls exclude later system receipts, including material that had already been publicly published. It is retrospective research, not evidence of a successful historical forecast.

Unknown principals, maturity dates, project costs, cash collections and available GPU capacity stay unavailable. A contractual payment cap is not recognized revenue, a cash receipt or debt principal. The reported proposed support does not become a signed guarantee because a different guarantee was disclosed at another site.

## Data and status rules

Each immutable event revision retains issuer, optional financier, borrower, guarantor, customer, project, instrument/commitment type, principal/currency, maturity, claim type, publication/receipt, sources and economic-group identifier. Roles remain separate: a financing provider is not relabelled a customer merely to draw a link.

The states are `reported_discussion`, `announced`, `signed`, `funded`, `cancelled` and `expired`. Evidence must support the exact logical event and destination state. Signing/funding requires verified primary binding disclosure, rather than a news story or model conclusion. A material term amendment also requires fresh scoped evidence. Cancelled/expired agreements cannot be silently revived; a new agreement needs a new identity.

Revision chains retain order and identity. Later revisions cannot rewrite earlier snapshots. Sources with unknown publication times, future publication/receipt, unverified status or an outcome role are excluded at the selected cutoff. Reported measurements additionally require completed reporting periods by the source publication and evaluation time. Source labels are curated research assertions; trusted ingestion must substantiate them against the underlying records.

Counterparty links cover equity, GPU supply, commercial contracts, borrowing, guarantees and other commitments. A verified-contract link requires an eligible, active signed/funded event, matching parties/project and the relevant primary source. Reported and inferred relationships use different labels and styles. An announced GPU architecture does not establish a direct purchase contract with the chip designer.

## Numerical and independent review

The [KPI dictionary](infrastructure-kpis.md) defines funding coverage, compatible customer concentration, power readiness, construction exposure, debt-service capacity, guarantee exposure, capital intensity and cash payback. Existing numerical formulas retain their prior versions.

The independent review covers the entire registered case; project filters apply to the event/relationship tables and KPI calculations. It highlights unresolved financing and capacity, supplier-funded purchase dependencies and economic-group overlap. Customer payments, financing balances and guarantee caps cannot form one generic exposure total. A loan and its own backstop are reconciled as one underlying principal, while each party's role remains visible. Unknown overlap or incompatible measurement classes leave the aggregate unavailable.

No score, position size, broker order or execution permission follows from an alert. This domain imports no broker adapter or paper execution function. Existing human approval and deterministic risk gates continue to govern paper proposals.

## Local and private workflow

The public page starts with the reviewed local case, supports source-package imports, historical cutoff inspection, relationship filters, source-gated transition checks and JSON exports. The transition checker validates a proposal without editing the registered history. Imported package labels and declared receipt times are user-supplied claims; local files are not an external audit authority.

When Clerk/Convex are configured, the private panel reads owner-scoped cases and freezes immutable snapshots. The source importer is an internal function:

`infrastructure:importCase({owner,externalId,caseJson,linkedEvidenceIds?,linkedEarningsEventIds?,linkedProofEvidenceIds?})`

Trusted ingestion validates the complete case, source-backed transitions and optional ownership/source-registry links. Reusing an external ID with changed content fails; corrections append a new case version. The server records actual `ingestedAt` separately from imported source receipts. A public snapshot cannot backdate workspace knowledge to before ingestion. Models and public browser clients have no status-promotion mutation.

Public APIs are authenticated `list`, `detail` and `freezeSnapshot({caseId,cutoff})`. Snapshots retain all eligible revision history, separately selected active event versions and exclusion reasons. They cannot create ledger fills, alter broker records or grant live trading permission.

## Offline evaluation

Use **Export offline evaluation** to create a request with `{case,entity,projectId,cutoff}`:

```powershell
python -m worker.infrastructure_financing infrastructure-evaluation-request.json --output new-report.json
python -m unittest worker.test_infrastructure_financing -v
npm run test:browser:infrastructure
```

The worker reproduces the source snapshot, KPI, exposure and risk-review calculations and declares `executionAuthority: none`. Existing output files cannot be overwritten. No provider/model call is made by the evaluator.

See the [acceptance report](infrastructure-acceptance.md) for passing checks, remaining source gaps and integration boundaries.
