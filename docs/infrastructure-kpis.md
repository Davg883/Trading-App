# Infrastructure financing dependency KPI dictionary

Calculation version: `infrastructure-001.2-v1`. This is an additive research contract. It does not revise established earnings, market-return, scoring, paper-accounting or approval formulas.

## Evidence and contractual status

Each financing record identifies the issuer, borrower, guarantor, customer and project when known. Unknown parties, principal and maturity stay null. Publication time describes the source; receipt time describes availability to the research system. Both must precede a forecast cutoff. Revisions append a complete source/event history and do not overwrite earlier experiment snapshots. Outcome evidence is excluded from forecast evidence.

`reported_discussion`, `announced`, `signed`, `funded`, `cancelled` and `expired` are distinct states. A report about discussions does not prove an agreement; a company announcement does not by itself prove a signed instrument; a guarantee does not prove cash was advanced; and a funded facility does not prove an operating project. A transition requires evidence explicitly supporting that event and destination state. A hypothetical, inferred or commercial-speculation link cannot appear as a verified contractual edge.

A proposed supplier guarantee remains a reported proposal rather than a signed liability. Even a signed guarantee is contingent exposure, not a cash balance or automatic loss. A cancellation concerns its specific project/contract; it does not silently terminate a company's other agreements.

## Keep economic measurements separate

Contracted backlog is the value of contracted future performance under its stated definition. It is not recognised revenue. Revenue is not cash collected. Planned or contracted power is not energised power. Energised power is not installed GPU capacity, and installed capacity is not necessarily commercially available capacity. These are separate metric identities with their own sources, scopes, dates, units and accounting definitions; no automatic conversion is applied.

Ratios require compatible project/company scope, reporting window, currency, units and definitions as applicable. Missing inputs produce null and a reason. Forecast, reported discussion, actual measurement and market outcome evidence cannot silently substitute for one another. A news article's price or forecast does not become an authoritative consensus dataset.

## Exposure and independent review

A supplier's equity investment, GPU sale, customer contract, borrowing and guarantee may describe different views of one underlying financing chain. Record the underlying economic exposure identifier and commitment role before aggregating. Do not add a debt principal and the guarantee covering that same principal as though two separate projects were funded. Do not add a customer's future contract value to the supplier's financing balance and call the result recognised revenue or total capital at risk.

Deduplication does not mean every party bears the same loss. Keep issuer, borrower, guarantor, beneficiary and customer exposure visible separately. Conflicting principal/currency or unknown overlap prevents a reliable total; it does not justify selecting the most convenient number. Independent research flags should identify unresolved funding, concentration, construction/power risk and supplier-financed purchases without asserting that a reported relationship is a verified contract or predicting a default.

Infrastructure-risk alerts are research outputs only. They do not create broker orders, authorise paper trades, change risk policy or purchase hardware. Existing human approval and deterministic risk controls remain mandatory.

## Versioned numerical definitions

All numerical KPIs use only reported metrics supported by verified primary company, filing or regulator evidence available by the cutoff. Corroborated news remains valid research context but cannot establish a binding monetary KPI. Reporting-period end must not follow either the cutoff or its supporting source's publication. Each selected metric must be unique for the requested entity/project scope; competing observations require reconciliation rather than an arbitrary choice. Currency amounts preserve their declared currency and source IDs. No implicit FX conversion, annualisation, extrapolation or unit conversion is performed.

| KPI | Definition | Eligibility and interpretation |
| --- | --- | --- |
| Funding coverage | Committed funding / project cost | Same period, basis, monetary unit and currency; positive project-cost denominator. Funding must cite active signed/funded borrowing, equity investment or explicit cash-funding commitments. A commercial contract, GPU supply agreement or customer backlog cannot be cited as cash funding. Discussions, contingent guarantees and customer backlog do not supply cash funding. The ratio is committed coverage, not proof of funds drawn or construction completion. |
| Customer concentration | Named customer's recognised revenue / total recognised revenue | Exact same period, accounting basis, currency, unit and revenue definition; customer amount cannot exceed total. Backlog concentration is not substituted for earned-revenue concentration. |
| Power readiness | Energised power MW / planned power MW | Same scope/period/basis and a positive planned-power denominator. It is a power-only ratio. It does not estimate how many GPUs are installed, energised or commercially available. |
| Construction exposure | Construction commitments − construction payments | Compatible reported totals. A negative result signals incompatible inputs and remains null rather than being presented as negative construction risk. This is not a default probability or loss estimate. |
| Debt-service capacity | Cash available for debt service / debt service due | Compatible reported period/basis/currency with positive debt-service denominator. Cash available may be negative; forecast cash flow is not treated as measured debt capacity. |
| Guarantee exposure | Explicit principal of active signed/funded guarantees for the named guarantor | Verified primary binding evidence, known principal/currency and underlying economic-group reconciliation. Proposed guarantees remain excluded. It is a contingent principal measure, not an expected loss or cash asset. Absence of authoritative amounts produces null rather than an invented zero. |
| Capital intensity | Capital expenditure / recognised revenue | Same reporting period, basis, currency and unit; revenue must be positive. Contracted backlog and cash collections are different denominators and are not substituted. |
| Project cash payback | Project cost / positive annual project operating cash flow | Compatible reported annual period of 364–366 days, basis and currency. This simple, undiscounted ratio is labelled in years. It is not a forecast of future demand, an NPV/IRR model or proof of commercial profitability. Missing or nonpositive project cash flow leaves payback null. |

Contracted backlog, recognised revenue, cash collections, installed GPU capacity and commercially available GPU capacity are also returned as five separate direct measurements. A missing measurement stays null with a reason. Positive forecast capacity cannot suppress the alert that available service capacity remains unproven.

## Comparable underlying exposure

Each economic group preserves its member logical-event IDs, principal, currency and measurement type. Borrowing and its guarantee may share a financing-principal group; a single loan and guarantees no larger than that loan count the loan once. Equal duplicate views of another explicitly reconciled commitment can also count once. Unequal or unclear overlapping commitments remain unavailable pending reconciliation.

Commercial multi-year contract value, equity investment and debt principal are different measurements. They cannot form one generic total merely because their currency matches. Cross-type commitments tied to the same project but assigned different groups raise a potential double-counting flag. Missing groups/principal or multiple currencies also prevent an unqualified aggregate. The result is comparable contractual principal, not consolidated balance-sheet exposure, net loss at default or the sum of every party's economic risk.

Supplier-financing dependency alerts require the reported guarantee and GPU-supply relationship to concern the same project and supplier/borrower pair. They never join an unrelated Texas financing discussion to a Monarch supply relationship simply because both name NVIDIA and Nscale. The alert is an investigation prompt rather than proof of circular revenue or a contractual obligation.

## Offline reproduction

Export an evaluation request from the infrastructure view, then run:

```powershell
python -m worker.infrastructure_financing infrastructure-evaluation-request.json --output new-infrastructure-report.json
python -m unittest worker.test_infrastructure_financing -v
```

The request shape is `{case, entity, projectId, cutoff}`. The case carries `version`, `id`, `name`, `mode`, `sources`, `events`, `relationships` and `metrics`. Timestamps are UTC epoch milliseconds. The report includes the frozen case with all eligible revision history, separately selected active events, excluded evidence and reasons, KPI calculations, comparable exposure groups and independent alerts. Existing output files cannot be overwritten by the CLI. Every report declares `executionAuthority: none`.

The numerical layer preserves deterministic IEEE-754 source precision and rejects nonfinite or unsupported-magnitude results. It is a research evaluator rather than a payment ledger or a substitute for independent source verification. A local source package cannot prove that its declared receipt timestamps or reviewer identities are independently authenticated; production ingestion must retain actual system receipt separately and keep historical snapshots immutable.

A same-status amendment to principal, currency or maturity requires a new supporting source ID rather than reusing the original evidence. For signed/funded commitments the new source itself must be verified primary binding evidence scoped to the same event and status; including an old primary source alongside a new news report cannot satisfy this amendment requirement.
