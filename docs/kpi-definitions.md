# Economic measurement dictionary

Every observation needs source, source period, currency/unit, accounting definition, publication and receipt timestamps, version and reported/estimated/measured status. Incompatible periods must not silently be combined. Missing or invalid denominators produce unavailable values, not zero.

| Metric | Definition | Interpretation and restriction |
|---|---|---|
| Capital efficiency | Incremental operating cash flow / incremental invested capital | Comparable multi-quarter windows; disclose lag; negative or zero denominator requires separate explanation |
| Cash conversion | Free cash flow / revenue | Define FCF, typically operating cash flow less capital expenditure; compare like accounting periods |
| Hardware economics | Revenue growth, gross margin, operating cash flow | Segment revenue and chip margin are not inference revenue |
| Infrastructure economics | Capex, cash flow, debt service, utilisation, power availability | Company-specific fleet and financing measures; distinguish announced from commissioned capacity |
| Compute throughput | Successful tasks / GPU-hour | Fixed task set, quality threshold and measurement window |
| Inference cost | Fully allocated cost / successful tasks | Include failed attempts, correction, idle capacity and orchestration |
| API usage cost | Uncached input × input price + cached input × cache price + output × output price | Prices per million tokens; cached tokens are a subset of input, not additional input |
| Valuation | Enterprise value / annualised revenue or cash flow | Date-align market value, debt and accounts; negative cash flow is not a meaningful positive multiple |
| Investment edge | Net portfolio return − aligned benchmark return | Include cash, execution costs, FX and separate research-cost attribution |
| Local payback | Purchase/setup capital / positive monthly cloud-cost saving after local operating cost | Assumes equivalent quality and feasible utilisation; zero or negative savings imply no payback |

Keep consumer chat, autonomous workflows and local inference as separate workload categories. Capacity and token volume alone do not establish commercial value. Community infrastructure dividends remain an unverified research proposition, not projected income.


## Benchmark 001.2 additions

The [Proof & Scale KPI dictionary](proof-scale-kpis.md) adds evidence integrity, independent gates, fully allocated research and Vectis economics, and model/infrastructure run records under `proof-001.2-v1`. Forecast, synthetic and realized measurements remain distinct. These additions do not revise the historical Benchmark 001 or earnings evaluation formulas.


## Infrastructure financing dependency

The [infrastructure KPI dictionary](infrastructure-kpis.md) adds funding coverage, customer concentration, power readiness, construction exposure, debt-service capacity, guarantee exposure, capital intensity and project cash payback under `infrastructure-001.2-v1`. Its source and reporting-period rules preserve the distinction between commitments, revenue, cash and operational capacity. It does not modify earlier earnings, stress, forecast-scoring or paper-accounting formulas.

## Portfolio defence — Benchmark 001.3

The [portfolio defence KPI dictionary](portfolio-defence-kpis.md) adds reconciled direct and fund exposure, concentration, aligned historical correlation/beta/volatility/drawdown, matched-capital stress protection, net costs, recovery participation, exact-expiry option payoffs and daily inverse compounding under `defence-001.3-v1`. Source eligibility, unresolved holdings and minimum samples are explicit. These calculations confer no execution authority and preserve all previous financial formulas.

## Amazon cash conversion

The [Amazon KPI dictionary](amazon-kpis.md) adds scope-compatible company/AWS margins, quarterly gross-to-net cash purchases, TTM capex coverage, TTM FCF margin and comparable growth/margin/cash changes under `amazon-cash-2026-v1`. Forecasts, guidance, reported and derived data remain separate; AI-specific ROI and incompatible cohort comparisons remain unavailable. No earlier evaluation formula changes.

## Analyst Consensus Validation 001

The [consensus KPI dictionary](consensus-kpis.md) adds licensed analyst distributions, comparable mean/median targets, disclosed event revisions, receipt-time matched cohorts, independent £500 GBP outcome paths and guarded nested holdout comparisons under `analyst-consensus-001-v1`. Costs, FX, benchmark basis, sample coverage and incomplete windows remain explicit. Existing forecast-scoring, earnings, valuation, risk and paper-ledger formulas are unchanged.
