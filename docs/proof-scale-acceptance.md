# Benchmark 001.2 acceptance report

Reviewed 30 October 2026. This report covers the local Proof & Scale implementation. The later Trading 212 integration is documented separately.

## Delivered

The `/proof-scale` interface supports investment research and Vectis ONE. It includes the Data Integrity Register, four independent gates with all five states, measured economics, separate forecasts, run statistics, scope inspection and immutable revision/audit views. The dashboard retains its six modules and links to the new page.

The private Clerk/Convex panel supports named pilots, gate definitions, human pass/fail/pending decisions, exact next-stage approval or rejection, and recorded rollback actions. Evidence, economic outcomes, run records and model recommendations enter through internal trusted ingestion. Provider-signed reviewer identity is derived on the server; a model cannot supply a human role in mutation arguments. Local artifacts provide no deployment authority.

Integrity sidecar records link the existing evidence, earnings source registry and stress imports. Records are appended without rewriting historical forecasts. The backend stamps actual application receipt separately from a source's declared receipt time. Gate and economic decisions freeze their source/measurement snapshots. Current revisions and changed measurements trigger re-review rather than altering the historical decision.

The TypeScript and Python engines use `proof-001.2-v1`. Existing earnings, forecast scoring, paper accounting and approval formulas retain their previous versions. Unverified savings and financial forecasts do not count as realized profit. Missing service costs remain null; synthetic or historical arithmetic cannot establish commercial profitability through the commercial-profit flag.

## Verification

At the Proof & Scale milestone, **91 TypeScript tests and 67 Python tests passed (158 total)**. This includes all pre-existing research, earnings, model-runner, risk, security and accounting tests. The new coverage comprises 16 deterministic TypeScript tests, 10 Convex security tests and 17 Python tests.

| Acceptance requirement | Evidence |
| --- | --- |
| Missing authoritative data blocks critical decisions | Missing authority, ownership, verification, permissions, reconciliation and source-reference tests; visible empty register and failed demo integrity gate |
| Later or revised evidence cannot leak into historical forecasts | Cutoff-safe source revisions; actual backend receipt stamping; earlier-cutoff browser check; immutable gate and economic source snapshots |
| Unverified savings are not realized profit | Forecast/unverified savings remain null in recognized results; complete eight-category costs and genuine income required; negative incremental contribution preserved separately |
| Models cannot approve or alter gates | Signed human-role checks reject model, service, unauthenticated and missing-role identities; recommendations do not create decisions |
| Failed/expired gates prevent expansion | All four independent gates re-evaluated at server decision time; invalid stages, stale measurements, revised critical sources and expired gates reject expansion |
| Financial results reproduce | Repeated evaluation equality tests and actual browser export evaluated twice by Python with identical output |
| Historical, synthetic and forward evidence stay distinct | Schema, evaluation and browser mixed-mode rejection tests; conspicuous mode labels |
| Paper approvals/risk remain intact | All existing approval, deterministic execution, idempotency, source, accounting and owner-isolation tests rerun |

Type checking, ESLint and the production build passed. The original dashboard, earnings case, Market Stress Monitor and Proof & Scale browser checks passed. Desktop and mobile Proof & Scale screenshots were inspected; the page has no horizontal overflow at 390px. Wide registers scroll within their panels.

The browser-to-Python test exported the actual UI request, evaluated the synthetic Vectis case, confirmed null realized profit and null unverified savings, reproduced the output exactly, appended a revision, checked the earlier evidence exclusion and rejected a mixed-mode import. No live model or hardware requests occurred.

## Configuration and remaining boundaries

- Production Clerk/Convex login, deployed two-user isolation and reviewer-role assignment remain untested without deployment configuration. The local Convex test runtime verifies application authorization logic.
- Real invoice reconciliation, quality adjudication, energy meters, hardware accounting, customer receipts and licensed research sources are not connected. Schema support and trusted import APIs do not establish the truth of supplied evidence.
- Human owners define the required business and safety thresholds. This framework enforces their recorded evidence requirements; it does not infer every accounting definition or validate a commercial thesis automatically. Underlying investment returns must reference a shared aligned outcome protocol.
- Local files, declared reviewer names and demonstration records cannot prove authentic forward authorization. Administrators retain database control; this is an application audit rather than an external tamper-proof ledger.
- Scope approval is a recorded permission for a bounded next increment, not an execution engine for workflows, hardware procurement or brokerage. An overdue review or rollback must also be enforced by any future execution service.
- The cited Eric Yehle article could not be retrieved; its title/date are recorded as user-supplied inspiration. No quote, numerical claim or gate evidence was invented from it.

No hardware was purchased and no live brokerage execution was activated.

## Reproduce

```powershell
npm test
python -m unittest discover -s worker -p test_*.py
npm run typecheck
npm run lint
npm run build
# With the local app running:
npm run test:browser:proof
```

See [workflow and deployment setup](proof-scale.md), [KPI dictionary](proof-scale-kpis.md) and [architecture](architecture.md).
