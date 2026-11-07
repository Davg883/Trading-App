# Infrastructure financing dependency — acceptance report

Reviewed 31 October 2026. This additive Benchmark 001.2 release extends the Economics Observatory and evidence system under `infrastructure-001.2-v1`; it does not replace the earlier Proof & Scale domain.

## Delivered

- A sourced retrospective case at `/infrastructure`, linked from Economics Observatory, with separate NVIDIA–Nscale–Anthropic financing reports, corporate commitments, the Texas guarantee and the Loughton customer agreement.
- Structured source/event registers with named parties and roles, project, principal/currency, maturity, claim type, scoped contractual status, publication/receipt, revision lineage and economic-group identifiers.
- Counterparty relationship filters distinguishing verified active contracts, reported relationships and inferred context. Unknown or speculative links cannot acquire verified status through a display choice.
- Versioned funding, concentration, power, construction, debt service, guarantees, capital intensity and payback KPIs, plus five distinct backlog/revenue/cash/installed/available measurements. Missing or incompatible inputs remain null with reasons.
- A case-wide independent research panel addressing financing, delivery, supplier-funded purchase dependency and overlapping economic exposure. It grants no trading authority and does not estimate an unsupported aggregate loss.
- A source-gated local transition checker, immutable owner-scoped Convex case imports and frozen snapshots, a matching offline Python evaluator, source-provenance records and updated documentation.

The local case is a reviewed file artifact. Production Convex ingestion is implemented but is not represented as already deployed or populated. The source collection occurred after the reports, so it is not eligible for earlier historical forecasts.

## Passing verification

**158 TypeScript tests and 86 Python tests pass (244 total)**. This preserves the earlier 128 TypeScript and 67 Python tests and adds 19 deterministic infrastructure tests, 8 backend tests, 3 actual-case fixture tests and 19 Python infrastructure tests.

| Acceptance requirement | Evidence |
| --- | --- |
| Proposed guarantee is not signed | Primary binding support required for signed/funded status; reported Monarch support remains `reported_discussion`, principal null; browser rejects promotion using the report |
| Backlog is not earned revenue | Distinct metric identities; actual-case TCV and recognised revenue remain separate with different periods; commercial contract value cannot satisfy cash-funding coverage |
| Power is not energised GPU capacity | Unit/identity checks reject substitution; forecast power cannot establish measured capacity or suppress the unproven-availability alert |
| Concentration uses compatible definitions | Exact scope, periods, accounting basis, currency, units and recognised-revenue definitions required; incompatible numerator/denominator rejected |
| Exposure is not counted twice | Explicit economic groups reconcile a loan and its own backstop; mixed TCV/equity/financing, ambiguous overlap, missing principal or multiple currencies block an unqualified total |
| No historical evidence/outcome leakage | Publication, receipt, reporting-period and actual workspace-ingestion checks; frozen eligible history with active versions selected separately; cutoff browser hides later counterparty cards and case conclusions |
| Alerts cannot generate orders | Research outputs carry `executionAuthority: none`; backend snapshot test confirms no paper/broker writes; no infrastructure module imports an order or broker adapter |
| Existing safeguards remain | Complete prior earnings, stress, risk, paper accounting, owner authorization and broker read-only suites rerun |

Type checking, ESLint and production compilation passed. The infrastructure browser test exercised Observatory navigation, six active event versions, source statuses, separate metrics, denied promotion, publication-before-receipt exclusion, relationship filters, mobile layout and an actual browser-export-to-Python evaluation. Repeating that evaluation produced identical output. Desktop/mobile screenshots were inspected.

The existing dashboard, earnings and Market Stress browser regressions also passed. No paid model, market-data or broker call was made for this release.

## Source and interpretation limits

1. The case registers original company/SEC disclosures and attributed reporting with their differing authority. The reported proposed support is not a signed obligation. A separate disclosed guarantee at another site cannot establish it.
2. The Loughton record describes customer termination supported by attributed company statements. It does not establish abandonment of the entire development or cancellation of unrelated business. Unavailable termination economics are not estimated.
3. Binding financing drawdowns, exact project costs, maturity schedules, compatible customer-level revenue and commissioned/available GPU capacity remain missing where not extracted. Corresponding KPIs remain unavailable. Company plans and multi-year customer payments do not supply those observations.
4. Source-support classifications are curated judgments rather than automatic legal verification. Syndicated reports are not independent confirmations. Trusted ingestion must validate the underlying source, dates and contractual terms.
5. The current local artifact was received on 31 October. Backend imports retain a separate actual ingestion timestamp, and snapshots cannot backdate workspace knowledge. Local files cannot independently attest authentic forward registration.
6. Private Clerk/Convex deployment and two-user production tests require configuration. Application tests establish owner isolation in the Convex test runtime; no production data feed or automatic filing refresh is claimed.
7. The independent review is explicitly case-wide. Project filters affect event/relationship tables and KPI scope; they do not imply that a known commitment at one site applies to another.

No live brokerage permissions, order actions, hardware purchase or automatic paper-trade proposal was introduced.

## Reproduce

```powershell
npm test
python -m unittest discover -s worker -p test_*.py
npm run typecheck
npm run lint
npm run build
# With the local app running at localhost:3000:
npm run test:browser:infrastructure
```

See [workflow](infrastructure-financing.md), [KPI dictionary](infrastructure-kpis.md), [source provenance](../data/infrastructure/SOURCES.md) and [architecture](architecture.md).
