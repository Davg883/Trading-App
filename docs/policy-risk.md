# Benchmark 001.2 — US Midterm Infrastructure Risk

Open `/policy-risk` from Market Radar. The contract version is `policy-risk-001.2-v1` (`lib/policy-risk.ts`, reproduced by `worker/policy_risk.py`). It is separate from the earlier `infrastructure-001.2-v1` financing case.

## Rules the engine enforces

| Requirement | Rule |
| --- | --- |
| An election victory is not an enacted policy | `election`, `campaign_statement`, `candidate_elected` and `candidate_leading` always classify as `political_signal`, which is never a restriction, whatever the direction field says |
| Proposed vs active moratorium | `introduced`, `passed_one_chamber` and `passed_legislature` → `proposed_not_enacted`. Unofficial votes → `pending_certification`. Advisory votes → `advisory_nonbinding`. Only enacted or in-force measures past their effective date, and court orders, are in force |
| Court-tested | `court_order` → `court_constraint` (in force). `enjoined` and `struck_down` → `blocked_by_court` |
| Delay is not cancellation | Holds and delays are `timelineRevisions` and stages (`permitting_on_hold`, `delayed`). `cancelled` is a separate, sourced stage. A project that did not proceed is `not_active_project`, not a delay |
| Planned is not operational | `plannedMw` and `energisedMw` are separate, and unknown energised MW stays null. Totals report known MW and unknown counts separately. Energised above planned is rejected |
| No state-wide inference | Exposure comes only from sourced project↔event links (`direct`, `adjacent`, `jurisdiction_only`, `unclear_per_authority`, `company_states_unaffected`). An unlinked project in a restricted state is `no_substantiated_exposure` |
| Sources and uncertainty | Every classification carries source IDs, primary-source IDs, reasons and an uncertainty level. Secondary-only evidence, conflicting sources, unofficial results and pending litigation raise it |
| No post-cutoff news | `freezePolicyCase(cutoff,'receipt')` uses actual receipt. The `'publication'` basis is a labelled retrospective reconstruction that excludes sources published after the cutoff or with unknown publication time. A registration fails if any hypothesis cites evidence unavailable at its cutoff |
| No automatic order | No broker, ledger or order module is imported. Every output carries `executionAuthority: 'none'` |

For votes, `direction` describes the effect of the reported outcome. A rejected restriction (Harwood) is `neutral`. A rejected rezoning (Wilmington) is `restrictive`.

## Analyses kept separate

- **Policy**: classifications, project exposure and capacity buckets (directly exposed, potentially exposed, no substantiated exposure, not active).
- **Economic**:
  - verified delays and holds, with incremental carry computed only from sourced principal, rate and delay days;
  - developer concentration, within registered projects only;
  - supplier commitments;
  - operational capacity in states with restrictions;
  - sourced capex and FCF observations, plus mechanism chains that are not forecasts.
- **Market**: a registered event study. Groups are developers (APLD, WULF, CRWV, IREN, CIFR), hyperscalers (AMZN, MSFT, GOOGL, META, ORCL), chip suppliers (NVDA, AMD, AVGO) and benchmarks (VT primary, SPY, QQQ). Windows are 1, 5, 20 and 60 sessions from the 3 November close. Returns are equal-weight USD price returns from aligned closes. A window is pending unless every member has exactly one close for every session, with the same provider and basis, received by the evaluation time. Hypotheses H1–H3 were registered after the event and are labelled as not prior predictions.

## Result at capture (5 Nov 2026)

- **Restrictions in force:** 4 — NY EO 62, Oklahoma HB 2992 (cost allocation), Arizona's TPT pause and the Wilmington federal order.
- **Pending or proposed restrictions:** 9.
- **Political signals:** 3.
- **Directly exposed:** AWS Wilmington, via the court-ordered hold on its site plan. It is on hold, not cancelled.
- **Potentially exposed:** Meta Piqua (the city says the effect is unclear), Thor Urbana, EdgeConneX Ashville, TeraWulf Lake Mariner and Lake Hawkeye (the company says it is unaffected).
- **No substantiated exposure:** Applied Digital Polaris Forge 1 and 2.

| 1 session (3→4 Nov) | Equal-weight return | vs VT |
| --- | ---: | ---: |
| Developers | −10.89% | −12.60% |
| Hyperscalers | +3.09% | +1.38% |
| Chip suppliers | −1.39% | −3.10% |
| VT | +1.71% | — |

H1 (developers below VT) and H2 (hyperscalers above developers) are *consistent* at 1 session. All 5, 20 and 60-session windows and H3 are pending. This is one session of one event, and no causal attribution to the election is made.

## Reproduce

```powershell
python scripts/prepare-policy-risk-case.py   # refuses to overwrite an existing capture
python -m worker.policy_risk data/policy-risk/midterm-2026-11-03-request.json
npx vitest run tests/policy-risk.test.ts
python -m unittest worker.test_policy_risk
npm run test:browser:policy
```

To score later windows offline, add `observationSets` (each `{id,capturedAt,sources,prices}`) to the request. Never edit the registered package.

## Convex persistence (`convex/policyRisk.ts`)

Tables are `policyRiskCases`, `policyRiskRegistrations`, `policyRiskObservations` and `policyRiskOutcomes`. All records are append-only and owner-scoped. Each step also writes an `audit` row.

| Function | Access | Behaviour |
| --- | --- | --- |
| `importCase({owner,externalId,caseJson})` | internal | Validates with `parsePolicyCase`. Rejects receipt or publication times after actual ingestion. Exact retries return the same ID. Changed content under the same `externalId` is rejected. Limit 800 KB |
| `list()`, `detail({caseId})` | authenticated | Owner's records only. Detail includes registrations, observation sets and outcome reports |
| `register({caseId,name,cutoff,basis})` | authenticated | The server sets `registeredAt`. The cutoff cannot be in the future, and on a receipt basis it cannot precede actual ingestion. A publication basis is allowed only for retrospective cases and is stored as `retrospective_reconstruction`. Hypotheses citing evidence unavailable at the cutoff are rejected. Freezes the assessment, the group membership with member exposure, the hypotheses and 24 windows |
| `importObservations({owner,registrationId,externalId,observationJson})` | internal | Appends independently captured closes for frozen group tickers only. Immutable per `externalId` |
| `evaluateOutcomes({owner,registrationId,asOf})` | internal | `asOf` must fall between registration and now. Uses only observation sets ingested by `asOf`. Recomputes from the frozen registration, so callers cannot submit returns or hypothesis results. Exact retries return the same ID |

Merging later closes: an identical re-capture of a session collapses into one row. A conflicting close, or a provider change inside a window, leaves that window pending. Later captures must therefore come from the same provider as the registered closes (Nasdaq public historical table).

No function reads or writes portfolios, proposals, fills, quotes, forecasts or broker connections (tested). The `/policy-risk` page shows the private panel when Clerk and Convex are configured.

Deployment is not done here. To deploy, publish the schema and functions with `npx convex dev` against your own project. Then have trusted server code call `policyRisk:importCase` with the authenticated owner's token identifier, `externalId: "policy-risk-001.2-midterm-2026-11-03-source-v1"` and the exact contents of `data/policy-risk/midterm-2026-11-03.json`.
