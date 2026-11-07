# Amazon cash conversion KPI dictionary

Version: `amazon-cash-2026-v1`. Existing earnings, valuation, forecast-scoring, paper-ledger and execution-risk formulas are unchanged. Source observations retain USD millions; ratios are decimals and changes in margins or growth rates are percentage points.

## Observed financial definitions

Reported, derived, calendar-year management guidance and management expectations are separate observation kinds. Guidance for approximately $220bn of 2026 **cash capex** retains that disclosed label; it is not silently identified as either gross quarterly purchases or TTM net purchases. Forecast AWS growth greater than 40% in 2027 and 2028 is a management expectation for each calendar year, not realised growth, consensus or a system prediction.

Quarterly sales, operating income and net income use a single quarter. TTM revenue, operating cash flow, net cash capital expenditure and free cash flow use exactly matching twelve-month dates. Quarter labels and date boundaries are validated; values cannot be substituted across quarter, TTM and calendar-year guidance periods.

| Calculation | Definition and eligibility |
| --- | --- |
| AWS operating margin | AWS quarterly operating income / AWS quarterly net sales. |
| Company operating margin | Consolidated quarterly operating income / consolidated quarterly net sales. |
| Net cash capital expenditure | Gross cash purchases of property and equipment minus proceeds from property/equipment sales and incentives. Derived observations must reference those two exact inputs and reconcile arithmetically. |
| Free cash flow | Operating cash flow minus compatible net cash capital expenditure. Reported TTM FCF is retained; derived quarterly FCF references its two inputs. |
| Cash bridge residual | Operating cash flow − net capex − free cash flow. A reconciled statement has zero residual. |
| TTM capex coverage | TTM operating cash flow / TTM net cash capex. Positive net capex denominator required. |
| TTM free-cash-flow margin | TTM free cash flow / compatible consolidated TTM revenue. Missing TTM sales leaves this metric null; quarterly sales are not substituted. |
| Cash-flow deterioration | Current TTM FCF minus prior-year comparable TTM FCF, in USD millions. Relative change is current / prior − 1 only when prior FCF is positive; a crossing from inflow to outflow is disclosed explicitly. |
| Capital-expenditure growth | Current TTM net capex / prior-year comparable TTM net capex − 1; quarterly sequential growth is separate when both quarterly values exist. |
| AWS revenue growth | Current AWS quarterly revenue / same quarter prior-year AWS revenue − 1. |
| Cloud growth change | Current quarter's AWS year-over-year growth minus the previous quarter's year-over-year growth, ×100 percentage points. Both year-over-year pairs must exist. |
| Operating-margin change | Current operating margin minus the comparable previous margin, ×100 percentage points. Sequential and annual changes remain separately labelled. |
| AI-specific ROI | Null: AWS segment income does not disclose AI-specific invested capital, attributable net cash benefits or investment timing. |

All computed results include their observation IDs and null reasons. Derived records require compatible period, scope, accounting definition, currency and unit. A revision to an underlying input invalidates an older derived record until a fresh reconciled version is supplied. Ambiguous eligible versions yield unavailable KPIs rather than arbitrary selection.

## Gross-versus-net integrity issue

The supplied brief describes an article calling approximately $77.3bn quarterly purchases **net**. The official Q3 statement reports $77,259m **gross** purchases and $1,381m proceeds and incentives, producing $75,878m net cash capex. The article itself has not been provided or verified: its wording remains an unverified user-described discrepancy, not an attributed quotation or authoritative financial record. Its undated annotation is always redacted from frozen model evidence. TTM net purchases of $210,657m and calendar-year cash-capex guidance are separate figures.

## Bedrock populations

Nearly 17× growth describes **total Bedrock token volume**, while nearly 7× growth describes **Fortune 500 companies' Bedrock spending**, each described year over year. These have different populations and units. No common cohort, token price, revenue-per-token trend or monetisation ratio is calculated. Exact cohort membership, constant-customer methodology, exclusions and measurement dates are not inferred where the release does not provide them. The approximation qualifiers are preserved.

## Timing and experiments

The SEC acceptance timestamp is identified as a publication **proxy**, not proof of the first public release. A date-only company release retains a null exact timestamp and its original publication date. Eligibility uses a conservative end-of-US-Pacific-date bound (UTC date start +32 hours −1 millisecond), never a fabricated exact publication time. Source receipt and observation receipt must also precede the frozen cutoff. Actual October 2026 receipt times are preserved even for older comparative values contained in the newly retrieved release.

The model comparison is retrospective economic interpretation with two pending independent model slots and the deterministic `amazon-cash-rules-v1` baseline. No model result, inference cost, latency, interpretation score or market forecast is invented. Later forward research requires a separately authenticated registration with an eligible evidence snapshot and defined future outcome window. Unverified share-price reactions never become executable price observations, and these calculations carry `executionAuthority: none`.

Reproduce the exported package with `python -m worker.amazon_cash_conversion amazon-cash-research.json`. The wrapper is `{version, case, cutoff, quarter}`; a raw versioned case defaults to its latest declared receipt and Q3 2026. Outputs are deterministic. `--output new-report.json` refuses to overwrite an existing artifact. No network request, model call or broker operation occurs in this evaluator.
