# Portfolio defence KPI dictionary

Version: `defence-001.3-v1`. These additive research calculations do not change the established earnings, valuation, market-return, forecast-scoring, risk-engine or paper-accounting formulas. All returns are decimal returns and all monetary costs preserve their declared currency.

## Evidence, portfolios and look-through exposure

Synthetic demonstrations, observed historical studies and authentic forward records are separate modes. Publication/event timestamps and system receipt timestamps must both precede the requested evidence cutoff. Later revisions and outcome observations cannot enter an earlier forecast. A source label does not by itself make a locally imported file authoritative. Missing or contradictory critical inputs remain unavailable; models cannot replace them.

Portfolios are fully funded, long only, and have positive initial capital. Allocation weights sum to one. Comparisons require identical initial capital, currency, horizon, regular-session calendar and price-adjustment convention. No implicit currency conversion, missing-price fill, borrowed capital or rebalancing is introduced.

ETF look-through replaces the economic exposure of the ETF wrapper with its eligible constituent weights. It does not add both the full fund weight and its underlying holdings to the same economic-exposure total. Direct holdings in the same company are then combined with the indirect exposure to that company. Nested funds are recursively expanded with cycle protection. Unreported holdings, unavailable or stale fund data and incomplete classification remain explicit unresolved exposure. A global index fund with missing holdings is not labelled independent of the AI cycle.

Company, sector, geographic, currency and AI-economic-layer exposure are separate views of the same capital; the dimensions must not be summed together. Currency classification describes instrument denomination, not complete economic foreign-exchange exposure or an inferred hedge ratio. A fund's trading currency does not establish the currencies of its underlying business revenues. AI-related classification is a sourced research input, not a model-created market fact.

AI-related weight, known non-AI weight and unresolved AI-classification weight are returned separately. Company concentration uses the Herfindahl sum of squared combined company weights on a 0–1 scale. Where an economic owner is unknown, the displayed HHI is an incomplete sum over identified companies and `hhiComplete` is false; it is not a reliable whole-portfolio concentration statistic. The default maximum age for fund disclosures is 90 calendar days from the holdings-as-of timestamp. Older disclosures remain evidence history but do not silently become a current look-through snapshot. Competing fund revisions with the same instrument, holdings-as-of and receipt timestamp must be reconciled rather than arbitrarily selected.

## Matched-capital scenario comparisons

User-defined scenarios are assumptions rather than forecasts or historical observations. Historical scenarios require identifiable source evidence and compatible observations. AI correction, broad equity downturn, interest-rate/credit-spread shock, recession/earnings shock and AI recovery are scenario categories, not probabilities.

| Measurement | Definition | Limitation |
| --- | --- | --- |
| Gross scenario return | Sum of starting allocation weight × supplied compatible instrument scenario return | Static starting allocation; missing instrument shocks do not become zero. |
| Deployed capital | Initial capital − all declared costs | Costs are reserved inside the fixed starting capital, so the comparison does not implicitly borrow to fund fees. |
| Gross scenario P&L | Deployed capital × gross scenario return | Measured in the common portfolio currency. |
| Analysis costs | Declared fees + slippage + financing costs | Absolute monetary amounts; absent cost information does not prove a cost is zero. |
| Net scenario P&L | Gross P&L − declared costs | Costs are explicitly deducted once. |
| Net scenario return | Net P&L / initial capital | Requires positive initial capital. |
| Gross protection | Alternative gross P&L − unhedged gross P&L | Positive means less loss or more gain in that scenario, not guaranteed protection. |
| Net protection | Alternative net P&L − unhedged net P&L | Includes differential declared costs. |
| Rebound participation | Alternative net return / unhedged net return | Only defined when the unhedged net return is positive. Otherwise null. |

A scenario table is a conditional comparison. It is not an allocation recommendation. A hedge may lose money when the underlying risk does not occur. Bonds remain exposed to duration, inflation, credit and liquidity risk; defensive and value equities remain equities; gold-linked ETCs retain price, currency, structure, custody and issuer risks. Cash can lose purchasing power and can create counterparty, currency or opportunity costs.

## Historical analytics

Historical analytics require aligned regular-session observations with the same calendar, currency, total-return or split-adjusted basis and declared adjustment version. Corporate-action review must be complete. A return interval contributes only when both instruments have observations at the same start and end sessions; a multi-session gap is not relabelled as one daily return.

The default eligibility threshold is 60 aligned returns. The minimum configurable threshold is 30 aligned returns. This is an explicit research guardrail, not proof of statistical stability or forecasting ability. Thin, nonstationary, stale or exceptional histories can remain economically unreliable even above the threshold. No unsupported covariance matrix or optimiser confidence is produced.

| Measurement | Definition |
| --- | --- |
| Simple session return | Closing price at session end / closing price at prior aligned session − 1 |
| Sample covariance | Sum of paired return deviations / (n − 1) |
| Sample variance | Sum of squared return deviations / (n − 1) |
| Correlation | Sample covariance / square root of the two sample variances |
| Benchmark sensitivity (beta) | Sample covariance with benchmark / benchmark sample variance |
| Annualised historical volatility | Sample standard deviation of session returns × square root of declared sessions per year |
| Maximum drawdown | Minimum over the path of current value / greatest earlier-or-current value − 1 |

Zero variance leaves correlation and/or beta null as applicable. A 252-session annualisation convention is disclosed when used; it does not turn a short sample into an observed year. Rolling correlations apply the same alignment and minimum-sample rules to each completed trailing window. There is no look-forward fill.

## Research-only derivatives and inverse products

Protective puts, collars and inverse products remain research specifications. They cannot be routed to paper execution or a broker. No leveraged or uncovered position is authorised.

At exact expiry settlement, a long put's gross payoff is `contracts × multiplier × max(put strike − underlying settlement, 0)`. A collar subtracts `contracts × multiplier × max(underlying settlement − call strike, 0)` for its covered short call. Option units cannot exceed the declared covered underlying shares. Strike, premium, settlement and contract specifications must use compatible currency and price basis. Put premiums are costs; covered-call premiums are receipts. Net derivative payoff deducts the total put premium and adds the total call premium. Financing, spread and transaction costs remain separate disclosed inputs. Premiums are per underlying unit, not per contract.

Before expiry, intrinsic value is not substituted for an option market price. Without a valid exact-expiry settlement, the expiry payoff stays null. An observation after expiry is not silently used as the expiry settlement. These are isolated payoff calculations, not modelled complete portfolio returns, and do not assume a collar is cost free.

The option research strategy P&L includes `(underlying expiry price − underlying starting price) × underlying shares`, adds the put payoff, subtracts any covered-call liability, and then deducts net premium and declared fees. Its input and result remain labelled `unverified_user_input`; arithmetic completion is not evidence verification or a forward prediction. Contract multiplier, number of contracts, underlying shares, strikes, expiry, exact settlement and currencies must all be explicit. The illustration does not infer exercise style, an exchange contract, market availability, tax treatment, or cash needed for an actual implementation.

A daily-reset inverse research path compounds each daily factor: `product((1 − index daily return) × (1 − annual fee bps / 10,000 / sessions per year)) − 1`. It is never the negative of the index's multi-month return. Fee drag is a simple declared daily convention. The versioned path contract bounds daily index returns to −100% through +100%, which preserves a nonnegative illustrative unlevered inverse NAV. Tracking error, borrow costs, spreads, counterparty effects, taxation and actual product mechanics require additional sourced inputs.

## Human review and reproduction

Research records and analysis exports carry no execution authority. A human review must identify the intended allocation, supporting and challenging evidence, costs, protection limits, loss conditions and unresolved data gaps. Existing authenticated paper approval and the independent deterministic risk gate remain required. A reviewed research case cannot widen the paper instrument allowlist or change broker permissions.

The independent evaluator uses Python's standard library and no external model or market-data calls:

```powershell
python -m worker.portfolio_defence defence-evaluation-request.json --output new-defence-report.json
python -m unittest worker.test_portfolio_defence -v
```

Output is deterministic for the same versioned request. The output writer refuses to overwrite an existing report. This release does not configure licensed historical price or ETF holdings feeds or imply that unconfigured integrations are live.
