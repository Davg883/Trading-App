# Analyst consensus validation KPI dictionary

Version: `analyst-consensus-001-v1`. Existing earnings, model forecasting, risk-engine and paper-ledger formulas remain unchanged. Coverage initially includes NVDA, MSFT and AAPL. The £500 calculations are independent research comparisons; they do not amend the established paper-ledger minimum capital or authorise any allocation.

## Licensed evidence and as-of snapshots

Recommendation records identify the provider, analyst, institution, company, raw current and previous ratings, current and previous targets, target currency, source URL, publication time, provider update time and actual receipt time. A provider must have a licensed-use declaration and permitted-use description before its records enter numerical analysis. JSON licensing fields are declarations requiring independent verification, not a licence granted by this application.

The provider's rating normalization table is explicit and exact. An unfamiliar raw rating is `unmapped`; the engine never guesses that an article's phrase means Buy, Strong Buy or a numerical rating. One active recommendation per provider/analyst/institution/symbol is selected at each cutoff. Only records published, updated and received by the cutoff are eligible. Declared superseding revisions preserve identity and ordered receipt history. Ambiguous latest records require reconciliation.

The analyst lookback is explicit, defaults to 365 calendar days and is configurable from 1 to 3,650 days. A provider's coverage declaration records the covered interval, symbol universe, analyst population, completeness, publication and receipt. A complete status requires both current eligible coverage metadata and full coverage of the requested lookback. A partial licensed sample may be described, but is prominently identified as a sample rather than complete market consensus. Unlicensed records produce no count, distribution or target average.

| Measurement | Definition |
| --- | --- |
| Active analyst count | Number of unique eligible provider/analyst/institution/symbol identities inside the lookback. |
| Rating distribution | Counts of positive, neutral, negative and unmapped raw ratings under the provider's declared mapping. |
| Mean price target | Arithmetic mean of eligible active non-null targets, only when all included targets share one known currency. |
| Median price target | Middle sorted eligible target, or average of the two middle targets for an even sample. Same currency restriction applies. |
| Provider consensus label | The provider's separately published headline. It is not derived from an invented rating score or inferred from a single analyst event. |

Target prices are analyst expectations, not executable prices, realised outcomes or independent fair values. Unverified public-web Melius-style claims remain inspection annotations. They are excluded from numerical consensus and frozen study evidence. No article reaction is converted to a price observation.

## Revisions and population composition

Revision windows are 7, 30 and 90 calendar days. Two different measurements remain separate:

1. **Matched as-of cohort:** compare the same analyst/institution/provider/company identities that were actually available at both endpoints. Rating upgrades/downgrades follow the declared normalization table; raw rating changes are also counted. Target increases, cuts and unchanged targets are independent of rating changes. Added and removed analyst coverage is reported separately.
2. **Reported events:** compare the current and previous values explicitly supplied within a newly eligible vendor event published during the window. These comparisons can be available on the first licensed import even when earlier receipt-time archives do not exist. They do not reconstruct the consensus that an earlier experiment could have known.

Mean absolute target revisions require one compatible target currency; mean percentage revisions additionally require a positive previous target. Missing previous values are not manufactured. A target cut under an unchanged Buy rating is recorded as a target cut, with no implied rating downgrade. Changes in the provider's headline label are tracked separately; a label can change through coverage composition or provider methodology.

## Frozen baseline context and study arms

Financial and news context records retain a source, company, publication or publication date, actual receipt and bounded structured JSON. The JSON is data only; no evaluation or execution of its contents occurs. A date-only source uses a conservative end-of-US-Pacific-date bound (UTC date start +32 hours −1 millisecond) for eligibility. Unknown publication dates, late receipts and future revisions are excluded. Feature identifiers are unique across financial/news, prices, headline labels, recommendation revisions and FX records.

The frozen study declares nested arms: (a) prices, eligible FX and fundamentals/news, (b) the same baseline plus provider headline labels, and (c) the same baseline plus labels and analyst revisions. FX belongs to every arm so a GBP target cannot receive currency information only in a later treatment. Freezing feature references does not run or validate a predictive model. All arms share the exact registered outcome convention; later model experiments must preserve their evidence and submission times independently.

## Independent £500 GBP portfolios

The AI comparison holds NVDA, MSFT and AAPL at equal starting weights. The diversified comparison contains a sourced global equity ETF and GBP cash. Custom research portfolios require unique positive weights totaling one, explicit unleveraged instrument specifications, sourced research approval and £500 starting capital. A globally diversified fund can still have material AI exposure; global diversification is not economic independence from AI.

Weights are fixed starting weights; no unrequested rebalancing, borrowing, short selling, derivatives or live execution is introduced. Each 1, 5, 20 and 60-session registration freezes its portfolio, instrument specifications, calendar, benchmark, price basis, adjustment version, session type, source cutoff, mode and registration time. Later valuation imports cannot replace the registered weights, costs or product definitions.

All entry costs, exit costs and additional annual portfolio fees default to null when unknown. A cash return assumption is also explicit. Zero is accepted only as a declared research assumption, never as a fabricated broker fee or guaranteed cash yield. Outcomes remain pending until required costs are supplied.

For each required session, noncash holdings need one eligible licensed adjusted close and, when the denomination is not GBP, an explicit licensed FX rate at the same timestamp. Publication and receipt must precede the valuation cutoff. Corporate-action review, regular-session identity, adjustment version and currency must agree with registration. Missing intermediate sessions are not filled, and provider or FX conversion conventions cannot silently change inside a path. All calculations use the complete aligned daily GBP path, not mismatched endpoint windows.

| Measurement | Definition and limitation |
| --- | --- |
| Converted GBP close | Source instrument close × sourced same-session currency-to-GBP rate. GBP instruments require no implicit conversion. |
| Holding growth | Current GBP close / entry GBP close. GBP cash uses `(1 + declared annual cash rate) ^ (actual elapsed days / 365.25)`. |
| Portfolio gross growth | Sum of starting weight × holding growth. |
| Deployed capital | £500 − declared entry cost − reserved exit cost. All costs remain inside the same initial capital. |
| Additional annual fee factor | `exp(−annual portfolio fee bps / 10,000 × elapsed days / 365.25)`. This is a declared research convention, not an inferred fund charge. |
| Net portfolio value | Deployed capital × gross growth × additional annual fee factor. |
| Gross return | Portfolio gross growth − 1, before declared additional costs. |
| Net / absolute return | Net ending value / £500 − 1. |
| Benchmark return | Benchmark GBP simple return over the same registered entry/end sessions and adjustment basis. It is a gross benchmark; no hypothetical benchmark dealing fee is inferred. |
| Benchmark-relative return | Net portfolio return − gross benchmark return. Gross relative return is also retained separately. |
| Maximum drawdown | Lowest complete-path net value / greatest earlier net value − 1, including initial £500 as the starting peak and the reserved-cost convention. |

Adjusted ETF return series already reflect product expenses in the supplied data; the additional annual portfolio fee must not silently duplicate the ETF's TER. Cost provenance and completeness remain human review responsibilities. Split-adjusted price comparisons are explicitly price returns and do not imply reinvested dividends; total-return inputs require the provider's compatible adjustment definition.

Incomplete future windows, missing calendars, insufficient observations, unlicensed quotes, FX gaps, unknown costs or conflicting revisions remain pending with reasons. A retrospective study registered after its historical entry close is labelled a retrospective return comparison and does not establish a forecast known at entry. A genuinely forward registration must precede entry and preserve the independently eligible source cutoff.

## Incremental information-value assessment

No value claim follows from a consensus label, a three-company example, synthetic performance or an incomplete future return. The optional external ablation register requires chronological training, protocol registration, evidence, submission, entry, end and outcome receipt; paired predictions from all three arms; verified outcome declarations; explicit missing-input handling; and the same company, horizon, benchmark, currency, price basis, target definition and model protocol. Duplicate holdouts are rejected.

The default research minimum is 30 paired holdouts; a configurable minimum cannot be below 10. These are declared research guardrails, not a statistical power calculation. Missing-input cases and unverified/pending cases remain separately counted and unscored. Compatible complete holdouts yield descriptive mean squared forecast error for each arm, the label error difference versus baseline, the full revision-arm difference versus baseline, and the incremental revision difference versus the label arm. Numerical overflow leaves the comparison unavailable.

Even a lower descriptive error does not establish persistent predictive value, causality or statistical significance. Imported declarations do not prove actual feature isolation, authentic earlier registration, independence or source verification; those require an auditable experiment and independent review. The initial November 2026 research case contains no validated out-of-sample advantage.

These calculations and study approvals carry `executionAuthority: none`. Existing human-approved paper-trading and read-only brokerage controls remain independent.
