# Analyst Consensus Validation 001 — implementation acceptance

Date: 3 November 2026. Contract: `analyst-consensus-001-v1`.

## Delivered

The working `/consensus` view is accessible from the existing research dashboard. It covers NVIDIA, Microsoft and Apple; retains the previous modules, source/evidence architecture, independent risk policy, human approval and read-only broker connections; and adds no live execution capability.

The observed case contains sourced company financial context and relevant news, a separately labelled corroborated Melius report, two independent £500 local retrospective research registrations and eight pending outcome windows. It contains **no fabricated analyst rows, consensus aggregates, market prices, FX, valuations or model predictions**. A separate synthetic dataset exercises the complete workflow with invented values and no observed financial context.

## Evidence and source verification

- Official NVIDIA FY2027 Q2 disclosure: quarter ended 26 July 2026. Company-reported FCF includes the additional 59m principal-payment adjustment: USD 24,077m OCF − 2,677m purchases − 59m principal = 21,341m FCF.
- Official Microsoft FY2027 Q1 disclosure: quarter ended 30 September 2026. USD 58,000m OCF − 39,367m cash property/equipment additions = 18,633m derived cash FCF. Recast segment income is not labelled as Azure operating income.
- Official Apple FY2026 Q4 release was published on **2 November 2026**, with year ended 26 September. Its annual USD 145,097m OCF − 9,041m capex = 136,056m derived annual FCF is kept separate from quarterly revenue/income. Quarterly EPS is not annualised into P/E.
- Melius Research's NVIDIA target change from $420 to $315 with Buy maintained is corroborated by dated Benzinga reporting and a public provider table. The original note was not obtained. This 25% target reduction is an inspection flag, not an imported licensed analyst observation or a verified forecast.

See [source provenance](../data/consensus/SOURCES.md). Financial context is frozen as structured data with its original reporting periods and actual retrieval time. Date-only publications retain a null exact timestamp and a conservative eligibility bound. Newly collected historical values are not backdated into earlier source snapshots.

## Licensed consensus capability

Provider-independent records preserve analyst, institution, raw rating, previous rating, target, previous target, currency, original publication, provider update, actual receipt, source, mode and explicit revisions. The monitor selects one eligible active analyst/institution/provider/company record and shows distribution, mean/median targets, target population, mapping and coverage status. Partial coverage is visibly partial.

For 7/30/90 days it separately displays provider-reported event revisions, actual receipt-time matched cohorts and headline-label changes. An unchanged Buy headline can coexist with target cuts. Event previous values never manufacture an earlier consensus snapshot. Unlicensed records, later receipts, later corrections, incompatible currencies, ambiguous active versions and credential-bearing source URLs are blocked or excluded.

The tested Benzinga adapter supports licensed JSON exports and explicit opt-in fixed-endpoint HTTP retrieval, with server-only credentials, bounded pagination, timeouts, redirect rejection, quarantine records and safe errors. Exact retries preserve first receipt; corrections append rather than overwrite. No network request to Benzinga was made, and no licence was purchased. See [provider setup](consensus-provider.md).

## £500 registrations and accounting

`data/consensus/november-3-2026-request.json` and `november-3-2026-registered-study.json` preserve the actual local retrospective registration. The two standard portfolios are independent:

| Research portfolio | Planned gross allocation |
| --- | --- |
| AI equities | £500 total, equal weights in NVDA, MSFT and AAPL. |
| Diversified comparison | £500 total, 50% VT global equity ETF and 50% GBP cash. |

These are unfilled local research records, not authenticated deployed registrations or paper-ledger fills. They do not combine into one £1,000 account. The included source calendar accounts for US holidays and early closes. VT uses US regular sessions; its global mandate does not prove independence from AI or availability to a UK account. Verified fund look-through remains a separate requirement.

Starting from the 3 November 2026 regular close, the endpoints are:

| Trading sessions | End close, UTC | Initial observed status |
| --- | --- | --- |
| 1 | 4 November 2026, 21:00 | Pending. |
| 5 | 10 November 2026, 21:00 | Pending. |
| 20 | 2 December 2026, 21:00 | Pending. |
| 60 | 1 February 2027, 21:00 | Pending. |

Each window freezes portfolio weights, costs, approved unleveraged instruments, benchmark, price-adjustment convention and calendar. A custom fully funded £500 plan can be added independently. Net returns require all daily adjusted prices and matching licensed GBP FX, explicit all-in entry/exit costs, additional ongoing fees and cash assumptions where applicable. Unknown costs remain null. A declared zero is permitted but never fabricated.

Entry and exit costs are reserved inside the fixed initial capital; daily net GBP paths and drawdowns include the chosen cost convention. Gross benchmark return and net benchmark-relative portfolio return have distinct labels. Adjusted ETF prices do not silently receive duplicate TER charges. Portfolio concentration, cash, direct FX denomination and unresolved ETF overlap remain review questions; the engine does not infer a complete economic hedge ratio.

Appending later price/FX observations cannot amend the earlier analyst evidence or frozen cost assumptions. Python exports retain the original registered case and later outcome observations. Private outcome records are independently recomputed through internal functions; clients cannot insert arbitrary returns.

## Incremental-value test

The nested protocol freezes the same prices, GBP FX and financial context for three arms: baseline, baseline plus consensus labels, and baseline plus labels plus individual revisions. The initial case contains no model predictions or completed holdouts and cannot establish incremental value.

Optional forward holdout records require chronological training/protocol/evidence/submission/entry/outcome order, identical target definitions, company/horizon/benchmark/currency/basis/protocol, all three paired predictions and explicit missing-data handling. Duplicate holdouts and mixed targets are rejected. Default minimum 30 paired holdouts is a research guardrail, not a statistical power claim. Results remain descriptive even when available and do not establish causality, statistical significance or a trading recommendation. Imported declarations require independent audit.

## Validation

| Check | Result |
| --- | --- |
| Full TypeScript suite | **276 passing tests across 29 files**: previous 242 plus 21 consensus-engine tests, nine persistence tests and four actual-case/demonstration tests. |
| Full Python suite | **177 passing tests**: previous 142 plus 28 independent consensus tests and seven provider-ingestion tests. |
| Cross-language reproduction | Complete TypeScript/Python parity for the empty licensed observed case and synthetic recommendations, all revision windows, frozen study arms, GBP FX/cost paths, outcomes and ablation result. |
| Browser/worker export | Actual observed and synthetic UI downloads run through the Python evaluator; repeat outputs are identical. Observed eight windows stay pending; synthetic eight windows complete. |
| Consensus browser checks | Passed sourced flag, unlicensed nulls, three company contexts, two registered £500 plans, custom allocation, pending/completed windows, immutable exported costs after an edit, invalid cutoff rejection and responsive layout. No browser exceptions. |
| Existing browser regression | Dashboard paper approval/persistence, earnings, market stress and broker connection checks rerun successfully. |
| TypeScript checking | Passed, including production build. |
| Lint and production build | Passed; `/consensus` included in routes. |
| Visual inspection | Desktop and mobile screenshots inspected; responsive check confirms no horizontal page overflow. |

**453 automated tests pass in total.** Existing earnings, stress, market-model runner, authentication, risk, paper accounting, infrastructure, Proof & Scale and portfolio-defence tests remain included. New persistence tests verify owner isolation, actual-ingestion cutoffs, immutable £500 plans, custom allocations, human-only reviews, deterministic outcome recomputation and no side effects on the existing ledger, quotes, forecasts or broker records.

## Outstanding integrations and result limits

No relevant connected market-data plugin or configured provider credentials were available. Appropriate licences and the actual feed must be configured and tested before real recommendations, headline snapshots, market prices, FX and compatible valuations can populate the observed calculations. The import tool validates structure and chronology; it cannot independently prove provider coverage, licensing rights or instrument suitability. Current publication timezone and corporate-action conventions require provider verification.

Clerk/Convex deployment is unconfigured in the local preview. Persistent owner-scoped registrations and authenticated human reviews are implemented and tested with Convex mocks, but no real deployed authenticated study or broker account was used. Local drafts are explicitly labelled and exported; they do not prove an authentic historical prediction. The existing paper-ledger minimum remains £5,000 and its risk gates are unchanged; these £500 research plans cannot bypass them.

The future outcome windows have not completed and valid observed prices/FX are absent. Therefore no real net return, drawdown, analyst accuracy, market forecast score or incremental information advantage is asserted. Later forward experiments require separate advance registration. Any live purchase remains a separate manual user decision in the broker account, outside this application.
