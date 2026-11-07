# Benchmark 001.1 KPI definitions

Version: `stress-001.1-v1`. All returns are decimals; timestamps are UTC epoch milliseconds. These definitions add a research contract without modifying Benchmark 001 earnings, Brier, accounting or model-runner formulas.

| Measurement | Definition and eligibility |
| --- | --- |
| Session return | End regular-session daily close / preceding exchange-calendar session close − 1. Missing intervening sessions do not become a one-session return. |
| 30 / 90 days / 52 weeks | Calendar-day lookbacks of 30 / 90 / 364 days from the latest completed calendar close. Return starts at the last session on or before the boundary; high uses sessions inside the boundary. Complete instrument and QQQ bars are required throughout the selected window. |
| Drawdown | Latest regular close / highest compatible daily high within the window − 1. Requires corporate-action-reviewed bars; no opportunistic partial coverage. |
| Relative return | Instrument simple return − QQQ simple return, using identical start/end regular-session timestamps, provider, currency, price basis and adjustment version. This is a difference, not a return ratio. |
| Forward EPS | Positive estimated forward-12-month EPS from a declared authoritative consensus vendor, with collection timestamp no later than receipt/cutoff. An article alone does not qualify. |
| Forward P/E | Eligible price / compatible forward EPS. Same issuer, currency, synthetic mode and adjustment version; total-return-adjusted prices cannot be divided by EPS. |
| EPS change / P/E change | EPS current / prior − 1; P/E current − prior. Same vendor, exact forecast start/end, accounting and adjustment definitions. Rolling horizons cannot silently compare. |
| Enterprise value | Market cap + debt − cash + preferred equity + minority interest, all at the same instant and compatible definitions. Every component is explicit, including zero. |
| EV/revenue | Enterprise value / positive annual or TTM revenue, same accounting basis/currency; revenue period must end by the balance-sheet instant. No quarter × 4 assumption. |
| Free cash flow | Reported operating cash flow − positive capex outflow, identical reporting period/basis. |
| FCF margin / capex intensity | FCF / revenue; capex / revenue. Revenue must be positive and compatible. |
| Net debt / maturity exposure | Debt − cash; separately reported debt due within 12 months. Missing maturity data remains null. |
| Revenue trend / margin trend | Revenue current / prior − 1; operating-income/revenue margin current − prior. Same scope/definitions and ordered nonoverlapping reporting periods. |

Values keep contributing source IDs. Inputs remain separated into reported, estimated and derived records. Public release and system receipt must both precede the cutoff. Reported financial periods must have ended by publication. Missing, incompatible or nonpositive denominator inputs produce null plus a reason. Mixed observed/synthetic issuers are rejected. Currency and corporate-action mismatches are rejected, never silently converted; a normalization must preserve explicit provenance before importing a new compatible dataset. The web engine also exposes an explicit sourced close-only FX conversion helper; it does not manufacture converted intraday highs.

The research checklist returns potential valuation opportunity only for verified stable fundamentals, a reviewed valuation reset, positive evidence, no opposing evidence and no unresolved uncertainty. Verified deterioration with negative evidence returns fundamental deterioration. Other cases return insufficient evidence. Price decline is not a classifier input. There is no opportunity score or automatic order.

`valuation-checklist-v1` is an intentionally simple preregistered forecasting baseline: checklist opportunity/deterioration/insufficient maps to up/down/neutral one-hot probabilities; expected relative return is +2/−2/0 times the frozen neutral band, with a ±1-band interval. These numerical forecast assumptions are uncalibrated experimental controls, not a valuation score, confidence claim or trading recommendation. The neutral baseline is one-hot neutral and zero expected relative return. QQQ is a passive realized benchmark with no invented probability forecast. AI responses provide their own probabilities and 80% intervals. Existing Brier/MAE/coverage formulas are reused unchanged.

`economic-factual-rubric-v1` is a separate optional human source check: each cited economic statement is correct, incorrect or unassessable. Factual accuracy = correct / (correct + incorrect); coverage = assessed / all claims. All-unassessable yields null accuracy. It does not use returns. Human identity in an offline file is a declaration, not authenticated proof; no trade permission follows from adjudication.
