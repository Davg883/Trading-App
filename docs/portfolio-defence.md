# Portfolio Defence & Hedging — Benchmark 001.3

Open `/defence` from Paper Trading or Human Review. This is portfolio research, with no automatic investment recommendation, order submission or allocation change. The six existing dashboard modules, earnings, stress, financing and approval systems remain in place.

## Evidence and exposure

Observed research starts empty. Import a source-attributed case, or explicitly select the separate synthetic example. All synthetic instruments, holdings, prices and shock assumptions are illustrations. The product reference catalogue is separate from calculation inputs: verified issuer specifications do not supply a licensed quote or a reliable fund holdings file.

Record both publication and system receipt time, evidence mode, source URL, revision identity, currency, calendar, session and price basis. Evidence unavailable at a cutoff is excluded. A source received today cannot authenticate an earlier forward forecast. Private Convex imports record actual ingestion time in addition to supplied receipt times, and cannot create backdated snapshots. Local imports and exports are inspectable research artifacts, not an independently timestamped forecast registry.

ETF exposure is replaced by proportional constituent exposure, recursively. The fund wrapper is not added again. Direct shares and shares held through several funds aggregate into one economic company exposure. Unexplained, stale or unsupported fund weights remain unknown; a global fund is never presumed independent of AI. Geographic classification is issuer domicile, not a claim about revenue geography. Currency concentration follows the supplied economic exposure classification and does not infer that a GBP listing eliminates foreign-exchange risk. AI layer assignments require researcher evidence and can remain unknown.

## Matched comparisons

Compare fully funded long-only alternatives at identical starting capital, currency, horizon, exchange calendar, session and price basis. Scenario return assumptions and all absolute costs are explicit. Gross protection excludes declared costs; net protection includes them. Rebound participation is available only against a positive baseline return. These are conditional stress results, not return forecasts or realised profits. No default cash yield is represented as a guaranteed market yield.

User-defined shocks cover AI correction, broad equity decline, rising rates/credit spreads, recession/earnings and AI recovery. Historical cases require eligible source-backed observations and matched trading sessions; narrative news alone is insufficient for a historical return calculation. Missing asset returns block the affected comparison instead of substituting a model estimate.

Aligned historical statistics require sufficiently long, compatible supplied histories. Missing sessions are not silently filled or paired across gaps. Minimum sample thresholds are research quality gates, not statistical proof of future hedge effectiveness. Historical correlation and beta may change precisely when protection is needed. No covariance optimizer or automatic recommended allocation is provided.

## Research-only products

Protective puts and covered collars require explicit expiry, strike, premium, multiplier, share coverage, settlement convention and currency. The terminal payoff experiment includes premium and fees and only values the exact defined expiry. It is not a pre-expiry option pricing model and does not model early exercise, dividends, taxation, volatility surfaces or executable quotes. Short calls must be covered; naked or leveraged positions are not enabled.

Daily inverse illustrations compound the daily path and costs. They do not negate a cumulative multi-month index return. They remain research only, with no portfolio execution or broker permission. Read the [SEC daily reset bulletin](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-alerts/sec), [OIC protective put explanation](https://prd-web.optionseducation.org/strategies/all-strategies/protective-put-married-put) and [OIC collar explanation](https://www.optionseducation.org/strategies/all-strategies/collar-protective-collar).

## Human review and deployment

The optional authenticated panel lists trusted internal case imports, freezes immutable owner-scoped evidence snapshots and records human research reviews. A signed Clerk `actorType: human` reviewer claim is required. A model cannot supply or amend that claim. Review decisions retain reasons, acknowledged risks and revalidation dates, and confer no execution authority. Unsupported, inverse or derivative allocations cannot become executable paper orders through this feature.

Actual paper allocation changes must still enter the existing proposal, human approval and independent deterministic execution-risk workflow. The existing instrument allowlist and ledger policy are unchanged. An approved research alternative is not an allocated portfolio. Broker connections remain read-only.

Use the existing Clerk/Convex configuration; no additional provider secret is required for offline research. Registered cases are imported through internal `defence:importCase`, with owner and external ID, by trusted server ingestion. No public browser function can assert that a fund holdings file has been independently verified. Source licensing, authoritative holdings, quality classifications and deployed authentication must be verified before operational use.

See the [versioned KPI dictionary](portfolio-defence-kpis.md) and [implementation acceptance report](portfolio-defence-acceptance.md).
