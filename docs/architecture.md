# Benchmark 001 architecture and implementation boundaries

The application is a paper-only research laboratory. The six-module dashboard uses labelled synthetic figures. The separate earnings and stress pages reuse a reviewed Alphabet SEC financial artifact; no observed market prices are bundled. Synthetic and observed data are separated. Commentary in the supplied Moonshots review is strategic context, not verified financial evidence. No transcript claim has been promoted to a financial fact.

## Runtime boundaries

| Layer | Responsibility |
|---|---|
| Next.js App Router | Server-rendered shell and interactive research workspace |
| Browser demonstration | Labelled synthetic data and local persistence; no secret credentials |
| Convex | Authenticated, owner-scoped evidence, frozen protocols, forecasts, approvals, paper fills and audit records |
| Deterministic TypeScript | Risk checks, paper arithmetic and metrics shared with tests |
| Python CLI | Offline evaluation and atomic historical-price CSV imports |
| SQLite | Local numerical research store; not a production streaming service |

The Python CLI is independently runnable; it is not automatically invoked by browser controls. The demonstration and authenticated Convex workflow are separate execution modes until the application integration is configured and verified. Adding API keys alone does not create a licensed price feed, historical consensus dataset, or production deployment.

Research models must not own approval credentials. Source ingestion and model submissions use internal Convex functions; public review functions require a human identity. Risk policy lives in application code, with no model-controlled policy mutation. Audit rows are append-only through the exposed application API, but deployment administrators retain database access: this is not a cryptographically immutable external audit service.

## Production integration sequence

1. Provision Convex and an identity provider. Configure its issuer and enforce a separate service identity for research ingestion.
2. Run Convex code generation/deployment, then verify owner isolation with two independent users.
3. Choose licensed market data and document coverage, delay, display rights, trading sessions and costs. Keep secrets server-side.
4. Ingest official sources and preserve source payloads, publication time, receipt time, revision identity and currency. SEC companyfacts alone does not provide intraday historical consensus.
5. Pin exact provider model IDs and prices. The Python model runner provides bounded independent requests, timeout capture, output validation and raw usage records. Production wiring still needs budget reservations, billing reconciliation and Convex ingestion.
6. Import exchange calendars and corporate actions before real horizon evaluation. The offline CLI assumes its supplied outcomes and equity series have already been aligned correctly.
7. Migrate numerical data to PostgreSQL/time-series storage when data volume or multiple workers justify it. Add durable queues, retries, service monitoring and backups.
8. Run forward paper experiments before making claims about investment edge.

Live brokerage and payments are deliberately absent. A later brokerage project needs its own requirements and explicit authorisation.

## Sources checked during implementation

Reviewed 27 October 2026; provider prices are intentionally not asserted.

- [Next.js server and client boundaries](https://nextjs.org/docs/app/getting-started/server-and-client-components): keep secrets and data-access logic on the server; use client components for interactions.
- [Convex Next.js quickstart](https://docs.convex.dev/quickstart/nextjs): deployment URL, provider and generated API setup.
- [Convex best practices](https://docs.convex.dev/understanding/best-practices/): authenticate public functions and enforce record ownership.
- [Convex function authentication](https://docs.convex.dev/auth/functions-auth): derive identity from the authenticated context rather than caller-supplied identity fields.
- [SEC EDGAR data APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces): public submissions and companyfacts endpoints; preserve accounting-period differences. SEC data APIs do not support browser CORS.
- [Python SQLite transaction control](https://docs.python.org/3/library/sqlite3.html): explicit transaction behaviour. The worker uses Python 3.12+ transaction configuration and closes connections after import.



## Benchmark 001.1 extension

`lib/market-data.ts` defines a provider-independent import boundary, explicit feed delays, source URLs, event/receipt timestamps, exchange calendars and price-adjustment versions. `lib/stress.ts` adds versioned valuation calculations, evidence-based research classifications and 1/5/20/60-session outcomes. These modules do not replace `lib/research.ts` or the earnings engine.

`/stress` is a local review/import surface. Observed mode has no fabricated quotes; synthetic mode is explicit. Financial inputs retain reported/estimated/derived categories and period definitions. Imports supplied in the browser are unverified local research inputs. In the backend, `convex/stress.ts` limits ingestion to internal functions, scopes records to the authenticated owner, freezes eligible evidence during registration and seals completed results. Existing earnings event IDs can link imports to the established source registry.

`worker/stress.py` calculates the same versioned research KPIs offline. `worker/stress_runner.py` registers immutable evidence bundles, compares two independent providers with neutral and deterministic baselines, records failures/costs/latency, and evaluates completed targets against passive QQQ. Economic interpretation remains separately adjudicated; market-return scores cannot establish its accuracy. Local files are not an external timestamp authority. Historical replay also cannot remove knowledge acquired during model training.

The paper ledger remains in the established workflow. Additional review context carries thesis, counterevidence, valuation and financial risks, sizing assumptions, planned loss, freshness, uncertainty and model disagreement. It grants no execution authority. A declared stop is a planning assumption, not guaranteed loss protection or a placed stop order.

Primary-source references reviewed for this extension:

- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces): disclosure/XBRL ingestion and accounting-period context.
- [Market aggregate bars](https://massive.com/docs/rest/stocks/aggregates/custom-bars): provider-specific timestamp and adjustment semantics must be preserved by an adapter.
- [Split versus dividend adjustments](https://polygon.io/knowledge-base/article/is-polygons-stock-data-adjusted-for-splits-or-dividends): adjustment labels cannot be treated as interchangeable.

A real feed adapter, licensed history and calendar/corporate-action verification still require configuration and testing. Trading 212 is not used as a general price feed; no brokerage permission has been added.


## Benchmark 001.2: independent evidence gates

The additive Proof & Scale domain is shared by investment research and Vectis ONE. Versioned deterministic TypeScript calculations and a matching offline Python evaluator support the Data Integrity Register, four independent evidence gates, run economics and bounded pilot increments. Source-integrity revisions link existing evidence and earnings/stress sources without modifying their historical snapshots.

Owner-scoped Convex records separate trusted evidence ingestion, model recommendations and authenticated human approvals. Every expansion re-evaluates current gate validity, evidence revisions, thresholds, data mode and scope. A browser-provided role or model recommendation cannot authorize expansion. Scope approval records permitted users/workflows/sources, capex and operating ceilings, next review and rollback actions; it does not execute a purchase, broaden brokerage permissions or alter the paper-trade risk gate.

The public `/proof-scale` view provides local inspection and an explicitly synthetic example. The private panel is conditional on actual Clerk and Convex configuration. Local artifacts and offline reviewer names are not authenticated approvals. Fully allocated economic outcomes retain forecast/realized distinctions; missing hardware or service costs cannot establish commercial profitability. See the domain workflow and acceptance report for configuration and remaining live-integration requirements.


## Trading 212 read-only account boundary

`/settings/brokers` is a separate account connection surface. Browser requests go to authenticated, same-origin Next.js Node route handlers. A user-scoped Convex JWT first resolves canonical ownership. A fresh quiet administrator client then invokes internal vault operations; it is never shared with a browser or AI provider. Credentials are AES-256-GCM encrypted before Convex receives them, with owner/environment/version bound as authenticated data. The encryption key lives separately in the server's secret manager. Public Convex functions have no vault access path.

The Trading 212 adapter exposes fixed GET-only account summary, positions and cash transaction resources. Basic authentication, exact Demo/Live destinations, redirect blocking, bounded bodies, timeouts and persistent sync leases protect the boundary. Account snapshots have source/retrieval/currency/environment provenance and never create internal paper fills. A summary test does not pretend to refresh portfolio holdings; per-section timestamps are retained.

Credential replacement increments a generation and invalidates outstanding leases. Deleted or superseded connections reject late completions. Local deletion removes active ciphertext/snapshots but is distinct from provider key revocation. Signed-out and switched-user interfaces remount and immediately hide retained account state. All sensitive route responses are non-cacheable and errors use safe fixed messages.

The runtime admin bridge is isolated around pinned Convex 1.48 and covered using actual ConvexHttpClient with mocked transport. Deployment administrator keys require strict server-runtime access control. This release provides no model access to broker credentials, no generic broker request proxy, no order endpoint and no live brokerage authority. See the broker setup and acceptance documents for required secrets and unverified production boundaries.


## Infrastructure financing dependency extension

`lib/infrastructure-financing.ts` and `worker/infrastructure_financing.py` share the additive `infrastructure-001.2-v1` contract. Strict sources, immutable event revisions, scoped status proofs, differentiated counterparty relationships and distinct metric identities prevent a reported guarantee from becoming a signed obligation or contracted backlog from becoming revenue. Comparable economic-group reconciliation avoids double-counting a loan and its backstop or summing multi-year customer payments with financing as a generic exposure.

The Economics Observatory links to `/infrastructure`. The default artifact is sourced retrospective research, separated from the synthetic dashboard. Historical cutoffs select only eligible publication/receipt evidence, retain complete eligible revision history and expose active versions separately. Private Convex ingestion is internal-only and records actual workspace ingestion; authenticated owner snapshots cannot be backdated before the import. Optional links reuse the existing research, earnings and integrity registries.

The infrastructure domain produces research-only outputs with no execution authority. It does not import broker adapters or order/ledger actions. Source classification and real financing reconciliation still require trusted review; local JSON is not an independently timestamped audit service. See the infrastructure workflow, provenance and acceptance report for the registered case and missing inputs.

## Portfolio defence extension

`lib/portfolio-defence.ts` and the independent standard-library evaluator `worker/portfolio_defence.py` implement `defence-001.3-v1`. This additive domain leaves previous scoring and accounting formulas unchanged. Strict cases separate instrument specifications, source records, dated fund disclosures, fully funded portfolios, scenarios and adjusted price histories. Shared evidence cutoffs exclude late source records, later holdings revisions and ineligible price observations. Price histories retain provider, currency, calendar, session, adjustment basis and corporate-action status.

ETF look-through recursively replaces the fund wrapper with its constituents. Unknown holdings remain unresolved rather than becoming independent AI exposure. Correlation and beta use exact aligned returns and minimum samples; unsupported histories produce null statistics. Matched scenario comparisons reserve declared costs inside identical initial capital and report both gross and net protection. Option terminal payoffs and daily-reset inverse experiments are separate unverified research specifications with no execution authority.

`/defence` links from Paper Trading and Human Review. Public local calculations are ephemeral and do not persist as forecasts or approvals. The product-reference catalogue is separate from synthetic prices. Convex `defenceCases`, `defenceSnapshots` and `defenceAllocationReviews` provide internal-only trusted imports, actual ingestion timestamps, immutable owner-scoped snapshots, signed human reviewer claims, expiry and explicit superseding decisions. A favourable research review neither modifies a portfolio nor creates a paper order. The established proposal/approval/risk/fill pipeline, its instrument allowlist and all read-only broker boundaries remain unchanged.

Licensed histories, authoritative fund holdings and deployed Clerk/Convex credentials remain configuration and source-verification requirements. This release does not imply those feeds are connected, create a predictive covariance model or authorise any live or leveraged trading.

## Amazon cash conversion case

`/earnings/amazon` reuses `EarningsCase` and the established earnings source/evidence workflow, with an additive cash-conversion economics panel. The Economics Observatory and earnings navigation link to the case. `data/earnings/amazon-q3-2026.json` contains only compatible reported legacy `MetricRecord` values. The typed companion `amazon-q3-2026-cash.json` retains reported, explicitly derived, management-guidance and management-expectation observations separately. No guidance or derived observation is disguised as reported legacy data.

`lib/amazon-cash-conversion.ts` and independent `worker/amazon_cash_conversion.py` use `amazon-cash-2026-v1`. Exact period boundaries, scope, accounting definitions, derivation input IDs, revisions, publication precision and actual receipt times control eligibility and reproducible calculations. Gross/net capex and quarter/TTM/guidance definitions remain distinct. Undated unverified article wording is redacted from model snapshots. No executable quote, inferred AI return or common Bedrock token/spending cohort is produced.

The existing `earningsEvents`, `earningsMetrics` and `earningsSnapshots` contracts remain intact. Additive `earningsInterpretationCases` and `earningsInterpretationExperiments` link immutable owner-scoped case imports and retrospective registrations to the AMZN event. Trusted ingestion checks source-registry links and actual import time; browser registrations cannot backdate possession. Two distinct declared model providers receive one frozen evidence manifest plus deterministic rules and an unscored economic-interpretation rubric. Results, costs, latency and scores remain pending until actual runs. No financial or market forecast is created by interpretation registration.

A later forward experiment must use a new authenticated registration, eligible historical evidence and predefined future targets. The existing market model-runner contract, scoring formulas, human approval, independent risk checks, paper ledger and read-only broker adapters remain unchanged. Registered model identities do not establish model independence beyond their declared providers or prove a completed experiment.

`amazon-interpretation-2026-v1` adds strict interpretation-only outputs and the opt-in offline `worker.amazon_interpretation_runner`. It reuses the established bounded, redirect-blocking HTTP transport, fixes provider destinations, preflights both credentials and exact versions, and never silently retries a paid inference. Both requests contain identical canonical active evidence; eligible prior revisions remain separate audit history. Returned versions, citation eligibility, request ordering and exact evidence bytes are validated again at internal ingestion. Append-only `earningsInterpretationResults` retain all submission attempts, including failures, without amending the original manifest. Private experiment views show results, tokens, latency, unavailable costs and unscored quality separately. Models cannot provide scores, forecasts, trade authority or approvals. Actual paid provider and deployed authenticated runs remain unverified until configuration.

## Analyst consensus validation

`analyst-consensus-001-v1` is additive. The `/consensus` view and independent `worker/analyst_consensus.py` separate licensed recommendation events, provider headline labels, financial/news context, instruments, research portfolios, verified calendars, licensed adjusted prices, licensed GBP FX and optional forward ablation evidence. Source publication, provider update, actual receipt and trusted workspace ingestion have separate roles. Unlicensed web claims are inspection-only and never enter numerical consensus or model evidence.

Consensus counts use one eligible active provider/analyst/institution/company identity, a declared lookback, raw-rating mapping and explicit coverage population. Event-reported revisions are distinct from archived matched-cohort changes. No later corrected row enters an earlier frozen snapshot. Source context preserves quarter/year definitions and unavailable valuations rather than inventing price or annualised EPS assumptions.

`buildConsensusStudy` freezes portfolio costs, weights, instruments and calendar into each registered outcome window. Every research plan has its own £500 capital. New custom allocations append separate records. Later price/FX observations can complete outcomes but cannot rewrite the analyst evidence or plan. Adjusted series and same-session conversions produce GBP paths; incomplete windows, missing observations and unknown costs remain pending. Retrospective entry before receipt is visibly retrospective and is never promoted into a forward forecast.

Convex `consensusCases`, `consensusStudies`, `consensusPortfolios`, `consensusRecommendationReviews` and `consensusOutcomes` provide trusted immutable ingestion, owner-scoped studies, human-only research reviews and independent outcome recomputation. They do not write to the original paper portfolios, proposals, quotes, fills, forecasts or broker vault. The existing £5,000 paper policy and execution gates are preserved. Live purchases remain separate user actions outside this application.

The Benzinga worker adapter normalises licensed exports or opt-in fixed-endpoint read-only requests. Credentials never enter case artifacts, browser state or model inputs. Coverage/licence verification, deployed authentication and genuine provider operation remain external prerequisites; configuration is not represented as a tested live feed.

Three nested study arms share the same eligible prices, GBP FX and financial context, adding first provider headlines and then individual analyst revisions. External forward holdout comparisons enforce chronological protocol and submission order, aligned targets and explicit missing-input handling. Their scores are descriptive audit inputs, not a claim of authentic registration, statistical significance or a proven investment advantage. No result is created from the initial three-company retrospective case.
