# AI Capital Intelligence · Benchmark 001.2

A Next.js and Convex research and paper-trading laboratory for testing AI economic analysis. The six-module dashboard starts with labelled synthetic data so it can be reviewed without accounts or API keys. The earnings page uses a separately reviewed SEC financial artifact; the Market Stress Monitor starts in observed mode with unavailable market prices until sourced data is imported. Synthetic results are not investment performance.

## Run locally

Use Node.js 22 LTS or newer supported LTS and Python 3.12+ for the optional numerical worker.

```powershell
npm install
npm run dev
```

Open http://localhost:3000. The workspace covers Market Radar, Economics Observatory, Analyst Lab, Paper Trading, Human Review and Vectis ONE. Browser demonstration state is local to that browser. Synthetic experiments do not call real models.

## Earnings Intelligence — 29 October update

Open http://localhost:3000/earnings for the Alphabet Q3 2026 case. Its financial metrics were checked against the SEC-hosted earnings release and are kept separate from the synthetic dashboard. Explore the cash-flow bridge, compatible KPI calculations, source registry, article candidate intake, pre/post evidence exclusions and JSON report import. Media consensus estimates without original vendor snapshots remain blocked.

The offline earnings bridge now connects frozen evidence, two provider artifacts, a registered neutral/no-trade baseline and aligned outcome scoring. Run a network-free demonstration with `python -m worker.demo_earnings --output-dir test-results/my-earnings-demo` using a new output directory. See [earnings benchmark instructions](docs/earnings-benchmark.md) for actual provider runs and report generation. The real case's historical snapshots are intentionally blocked by late receipt: no historical prediction is fabricated.

Append-only Convex earnings imports and owner-scoped frozen snapshots are implemented in `convex/earnings.ts`. Internal imports require deployment/admin setup; the public case page is a reviewed local artifact, not a live Convex feed. Existing authentication and human approval requirements remain in force.

```powershell
npm run build
npm run test
python -m unittest worker.test_research -v
python -m unittest worker.test_model_runner -v
```

## Offline numerical worker

No Python package installation is required. Run commands from the project root:

```powershell
python -m worker evaluate worker/example.json
python -m worker evaluate worker/example.json --output evaluation.json
python -m worker import-prices worker/example-prices.csv --database research.sqlite
```

The example fixtures are synthetic. The evaluation CLI accepts `forecasts`, optional `evidence`/`cutoff`, `usage`/`rates`, and aligned `equity`/`benchmark` arrays. Returns use decimals, not percentages. Its output includes the calculation version, scores, inference cost and portfolio metrics. Missing scores are `null`. Invalid input returns a nonzero exit code and a JSON error on stderr.

Price CSV columns are `symbol,timestamp,receivedAt,source,currency,close`. Timestamps require timezones. Imports run atomically, ignore exact duplicates and reject conflicting records. Use a new versioned source when importing a correction. SQLite is the initial offline store; PostgreSQL/time-series hosting is a later scaling step.

## Configure Convex and external services

1. Copy `.env.example` to `.env.local` and keep secrets out of source control.
2. Run `npx convex dev` and complete Convex account/project setup. This provisions a deployment and generates the typed client API.
3. Configure Clerk with `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` and `CLERK_JWT_ISSUER_DOMAIN`. Set the Convex JWT issuer domain in the Convex deployment environment too; create the Clerk JWT template named `convex` with audience `convex`. Authentication must provide a verified human identity before public backend functions can access private records. An arbitrary browser-supplied user ID is insufficient.
4. Validate deployment, login and two-user ownership isolation before using real research records.
5. Choose licensed source coverage, then configure provider adapters and the optional Python model runner. Check exact available model IDs and current prices with each provider.

The browser demo, Convex backend functions and offline Python worker are independently testable pieces. A populated `.env.local` is not by itself an end-to-end production connection. Consult the implemented provider modules and architecture notes before enabling an integration. No live broker or payment credentials are needed.

## Research safeguards

Evidence eligibility checks both publication and receipt time. Experiment snapshots and submitted forecasts have no public editing API. Human approval and deterministic risk checks precede paper execution. Paper fills use post-approval prices, fees and FX, with duplicate protection. Source ingestion is internal-only in Convex. These are application controls; deployment administrators can still modify the database.

The initial experiment should compare two independent model providers with a frozen rules strategy and a passive benchmark. Economic interpretation and market direction are scored separately. Reports should include failures, no-trade decisions, rejected proposals and research costs.

## Further reading and boundaries

- [Architecture, integration sequence and checked primary sources](docs/architecture.md)
- [Experiment registration and evaluation protocol](docs/experiment-protocol.md)
- [Financial and compute KPI dictionary](docs/kpi-definitions.md)
- [Optional real model tournament CLI, credentials and result records](docs/model-runner.md)

The optional authenticated workbench uses Clerk and Convex; its production data starts empty until imported. The main dashboard remains a synthetic demonstration. Production work still requires licensed data feeds, verified exchange calendars and corporate actions, connected model runs, deployment and operational monitoring. The CLI evaluates supplied outcomes; it does not discover tradable prices or correct unaligned input series. Real investment conclusions require forward observations beyond this synthetic demonstration.


- [Implementation acceptance review and remaining real-experiment gate](docs/acceptance-review.md)
- [Earnings update: commands, safeguards and remaining integration boundaries](docs/earnings-benchmark.md)
- [Alphabet source verification and timestamp provenance](data/earnings/SOURCES.md)

## Market Stress & Valuation Monitor — Benchmark 001.1

Open `/stress` from Market Radar. The watchlist covers GOOGL, AMZN, MSFT, NVDA, INTC and CRWV. Observed mode begins without market prices: import a licensed provider dataset to populate it, or explicitly select the separate synthetic demonstration. A provider name or user-declared license is metadata, not independent verification of redistribution rights.

The monitor compares aligned QQQ returns, drawdowns, accounting and valuation inputs, and a seven-part earnings review. Missing consensus, incompatible reporting periods and incomplete outcome windows remain unavailable or pending. The reviewed Alphabet SEC financial extraction is reused; other company financials are not invented. The October 2026 case is retrospective research, not a historical prediction or verified claim about sector-wide price moves.

New calculations use `stress-001.1-v1`; established research and earnings formulas are unchanged. Optional owner-scoped Convex imports and registrations are append-only through the application API. Browser exports and local Python registrations are research artifacts, not proof of an independently timestamped forward prediction. Paper proposals retain authenticated approval and the existing deterministic execution gate.

See [stress research workflow](docs/stress-benchmark.md), [versioned KPI definitions](docs/stress-kpis.md), and [Benchmark 001.1 acceptance report](docs/stress-acceptance.md). No market-data feed, model provider, Clerk deployment or brokerage connection is represented as live by this update.


## Proof & Scale — Benchmark 001.2

Open `/proof-scale` from the dashboard for the common investment-research and Vectis ONE framework. Inspect authoritative-source ownership, use rights, reconciliation and revision history; review four independent gates; compare measured value with complete costs; and define the next permitted increment of scope. Missing or contradictory critical data blocks approval. Synthetic demonstrations and locally imported artifacts provide no deployment authorization.

Persistent human decisions require the configured Clerk/Convex private panel and a server-signed reviewer claim. Models can recommend but cannot approve or amend human gate decisions. Existing human-approved paper trading remains a separate workflow. This release neither enables live brokerage nor purchases hardware. See [workflow and setup](docs/proof-scale.md), [KPI definitions](docs/proof-scale-kpis.md) and [acceptance report](docs/proof-scale-acceptance.md).


## Trading 212 secure broker connection

Open `/settings/brokers`, or Connections & settings → Broker Connections → Trading 212. Sign in, select a separate Demo or Live connection, enter a new provider key/secret, save securely, test account summary and synchronise positions/recent cash history. Both environments are read-only. No order placement, cancellation, transfer or withdrawal capability is included.

Credentials are encrypted server-side with AES-256-GCM and stored in internal-only Convex vault records. The vault key is separately managed in the Next.js server environment; owner-scoped client queries return masked identifiers and sanitized snapshots only. Credentials never enter browser storage, synthetic state or model prompts. Broker snapshots remain separate from the internal paper ledger.

Before using actual credentials, configure Clerk/Convex, `CONVEX_BROKER_ADMIN_KEY`, `BROKER_VAULT_KEY_B64`, `BROKER_VAULT_KEY_VERSION` and `BROKER_APP_ORIGIN` using the [local and deployed setup guide](docs/broker-connections.md). Adding provider credentials alone is insufficient. Local deletion removes this application's active connection; revoke the provider key separately in Trading 212 settings. No real account has been verified by the automated tests. See the [broker acceptance report](docs/broker-acceptance.md).


## AI infrastructure financing dependency — Benchmark 001.2

Open `/infrastructure` from the Economics Observatory for the sourced NVIDIA–Nscale–Anthropic financing and Loughton customer-termination case. Explore project-level counterparties, event revisions, reported versus signed obligations, economic-group overlap and independently sourced project KPIs. Contracted value, earned revenue, cash collections, installed GPUs and available service capacity remain separate. Missing inputs stay unavailable.

Publication and receipt cutoffs prevent retrospective reports from entering earlier forecasts. Status changes require suitable event-specific evidence; the public transition checker grants no editing or execution authority. Owner-scoped Convex imports and frozen snapshots extend the existing source system. No broker permission or order capability is added. See the [workflow](docs/infrastructure-financing.md), [KPI definitions](docs/infrastructure-kpis.md), [source provenance](data/infrastructure/SOURCES.md) and [acceptance report](docs/infrastructure-acceptance.md).

## Portfolio Defence & Hedging — Benchmark 001.3

Open `/defence` from Paper Trading or Human Review. Inspect direct and ETF look-through concentration across companies, sectors, issuer domicile, instrument currencies and AI layers. Compare five stress categories and locally defined scenarios at identical starting capital and horizon, including all declared fees, slippage and financing. Unknown holdings, incomplete histories and incompatible observations remain visible or unavailable.

Observed research starts empty; a separate synthetic demonstration uses invented instruments, holdings, prices and shock returns. The independent reference catalogue contains dated product specifications, not market prices or recommendations. Protective puts, covered collars and daily inverse paths are isolated research calculations and cannot be executed. Owner-scoped Convex snapshots and authenticated human research reviews do not change the existing paper ledger or risk allowlist. Trading 212 stays read-only.

Export the research package and reproduce it with `python -m worker.portfolio_defence portfolio-defence-research.json`. Run `npm run test:browser:defence` against the local server for the interface, safeguard and export checks. No new secrets are required for offline research; persistent review uses the established Clerk/Convex configuration and trusted source ingestion. See the [workflow](docs/portfolio-defence.md), [versioned KPI dictionary](docs/portfolio-defence-kpis.md) and [acceptance report](docs/portfolio-defence-acceptance.md).

## Amazon Q3 2026 cash conversion case

Open `/earnings/amazon` from Economics Observatory or the earnings case navigation. The official SEC/IR extraction covers six quarters of company/AWS results and TTM cash measures. It reconciles quarterly gross property/equipment purchases with proceeds and derived net cash capex, and compares compatible TTM operating cash, capex, FCF and revenue. Management's calendar-year cash-capex guidance and 2027/2028 AWS expectations remain separate from reported results. Bedrock token and Fortune 500 spending populations cannot be used to infer unit monetisation, and AI-specific ROI remains unavailable.

The local case and two pending-model interpretation draft are retrospective. Real source/import receipts are retained; older comparison periods do not acquire earlier receipt times. No models, performance scores, consensus vendor observations, executable prices or trades are invented. A later forward experiment must be independently registered before future outcomes. Existing model-runner, risk, human approval and broker boundaries remain unchanged.

Use `python -m worker.amazon_cash_conversion amazon-q3-2026-cash-request.json` to reproduce the UI export. Run `npm run test:browser:amazon` against the local server. Private persistent registration uses the existing Clerk/Convex setup and trusted earnings ingestion; it does not itself call models. See [source verification](data/earnings/AMAZON-SOURCES.md), [KPI definitions](docs/amazon-kpis.md), [experiment workflow](docs/amazon-experiment.md) and [acceptance report](docs/amazon-acceptance.md).

The separate `worker.amazon_interpretation_runner` supports OpenAI and Anthropic over the same frozen evidence, with an explicit paid-request flag, exact model versions, safe failure records and no automatic retries. Trusted internal ingestion retains immutable results for private comparison, including tokens, latency and unknown billed costs. Provider keys belong only in the worker environment. Real model runs and independently assessed quality scores remain pending configuration and review; no paid provider calls were made during implementation.

## Analyst Consensus Validation 001 — 3 November 2026

Open `/consensus` from the research dashboard. Compare NVIDIA, Microsoft and Apple using official company disclosures and licensed analyst records when imported. The Melius NVIDIA target cut from $420 to $315 with Buy maintained is displayed as a corroborated public research flag, excluded from licensed consensus aggregates. Distribution, mean/median targets, 7/30/90-day event revisions, matched historical cohorts and provider headline changes keep distinct definitions and actual receipt-time controls.

Two independent **£500 local retrospective research portfolios** are registered in the included artifact: equal-weight NVIDIA/Microsoft/Apple and a 50% global ETF / 50% GBP cash comparison. Add a custom allocation, declare costs and export frozen research. Outcome tracking uses 1/5/20/60 registered trading sessions, aligned adjusted prices and GBP FX, net returns, a gross GBP benchmark, net benchmark-relative returns and drawdowns. Real outcomes remain pending. These records do not change the existing paper ledger, its £5,000 capital minimum or broker permissions.

The observed case starts without licensed analyst rows, market prices, FX or valuations. A separate synthetic demonstration shows completed calculations without borrowing observed financial facts. No analyst-signal advantage or historical model prediction is asserted. Incremental information is a separately defined comparison of prices/fundamentals, then consensus labels, then analyst revisions; credible conclusions require independently verified forward holdouts.

Run `python -m worker.analyst_consensus data/consensus/november-3-2026-request.json` to reproduce the registered local case. `npm run test:browser:consensus` verifies the view and exports against a running local server. See [licensed-provider setup](docs/consensus-provider.md), [KPI definitions](docs/consensus-kpis.md), [private experiment workflow](docs/consensus-experiment.md), [source provenance](data/consensus/SOURCES.md) and [acceptance report](docs/consensus-acceptance.md).

## US Midterm Infrastructure Risk — Benchmark 001.2

Open `/policy-risk` from Market Radar. This view registers the 3 November 2026 midterm as a retrospective policy event. It covers 19 sourced state and local data-centre policy events and 9 project records with sourced exposure links, and it runs a 1/5/20/60-session event study comparing developers, hyperscalers, chip suppliers and diversified benchmarks. Election results never become enacted rules. Unofficial votes stay pending. Holds are not cancellations, and planned MW is never operational. No order is generated. See [docs/policy-risk.md](docs/policy-risk.md) and [source provenance](data/policy-risk/SOURCES.md).
