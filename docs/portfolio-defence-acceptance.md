# Benchmark 001.3 implementation acceptance

Date: 31 October 2026. Calculation version: `defence-001.3-v1`.

## Delivered

- Working `/defence` view linked from Paper Trading and Human Review, preserving the six dashboard modules and all previous research pages.
- Direct and recursive ETF look-through exposure by company, sector, issuer domicile, instrument denomination currency and AI layer; overlap reconciliation, explicit unknown residuals, stale holdings controls and incomplete-HHI labels.
- Five conditional stress categories, local user-defined shock entry, editable fully funded research weights and explicit costs. Matching checks cover capital, horizon, currency, calendar, session, basis and evidence mode.
- Gross and net scenario protection, stress loss, recovery participation, guarded aligned correlation, beta, rolling correlation, annualised volatility and drawdown.
- Separate dated issuer/reference specifications for cash, ultrashort high-quality bonds, defensive equities, diversified value, physical-gold ETCs and research-only option/inverse structures. Unselected products and unknown account availability remain explicit.
- Isolated synthetic exact-expiry protective put and covered collar mathematics, including premiums, fees, multiplier and coverage; compounded daily inverse path experiments. No pre-expiry intrinsic-value substitution and no executable derivatives or inverse allocations.
- Internal-only Convex source imports, actual ingestion timestamps, immutable owner-scoped snapshots, signed human research reviews, rejection reasons, revalidation dates and append-only superseding decisions.
- Independent Python evaluator, versioned KPI dictionary, source provenance, README and architecture updates.

## Validation evidence

| Check | Result |
| --- | --- |
| `npm run test` | **199 passed across 22 files**, including the previous 158 tests and 41 new defence engine, fixture and Convex tests. |
| `npm run test:python` | **110 passed**, including the previous 86 and 24 new independent defence tests. |
| TypeScript checking | Passed; also completed by the production build. |
| `npm run lint` | Passed. |
| `npm run build` | Passed; `/defence` included in production routes. |
| Dashboard browser check | Passed navigation, existing paper approval/persistence and mobile checks. |
| Earnings, stress, Proof & Scale, broker and infrastructure browser checks | All passed, including historical exclusions, synthetic separation and existing disconnected account boundaries. |
| `npm run test:browser:defence` | Passed navigation, observed-empty mode, synthetic labelling, look-through exposure, matched capital, contract expiry/premium, daily inverse behaviour, invalid cutoff, incompatible-capital rejection, missing shock rejection, and responsive layout without browser exceptions. |
| Independent reproduction | The actual UI download was evaluated twice in Python with identical output. Exposure, initial capital, scenario result and 70-return synthetic analytics matched the interface. Independent agent parity checks also compared full TypeScript/Python output trees within floating-point tolerance. |

There are **309 passing automated TypeScript/Python tests** in total. Seven browser scripts also pass. Desktop and mobile screenshots were inspected; the mobile historical-series selector overflow was corrected. Existing accounting, model-runner, earnings, stress, security and paper controls remain covered by the full suites.

## Required acceptance cases

| Requirement | Evidence |
| --- | --- |
| Do not count ETF holdings twice | Recursive wrapper replacement and company aggregation tests; the synthetic direct/fund example reconciles to 100%, with 84% known AI and 4% unknown exposure. |
| Align correlations and require sufficient history | Session identity, missing sessions, adjustment/currency mismatch, constant variance and sample-threshold tests; default 60 returns with a floor of 30. |
| Separate unobserved and synthetic | Strict mode validation, historical cutoff exclusions, empty observed workspace, prominent demo labels and isolated contract experiments. |
| Same capital for hedged/unhedged | Mismatched-capital rejection in engine, Python and actual browser import; all costs are reserved inside initial capital. |
| Contract-aware derivative payoff | Exact expiry/settlement, premium, multiplier, share coverage, currency and fee tests; pre-expiry and wrong-date settlements remain pending. |
| Correct daily-reset behaviour | Compounded-path tests and browser experiment; multi-period inverse return is not equated to negative index return. |
| Human approval cannot be bypassed | Convex ownership, unauthenticated/model identity, superseding and research-only-product tests. Research reviews create no proposals, fills, holdings changes or orders; established paper approval/risk tests pass. |
| Preserve prior functionality | Full suites and all six previous browser scripts rerun successfully. |

## Outstanding integrations and limits

No licensed historical prices, live quotes or authoritative ETF holdings feed has been configured. The observed workspace therefore begins without positions or market values. No genuine historical hedge performance or personal allocation recommendation is asserted. Fund and AI classifications in imported artifacts require independent verification; `verified` in a local JSON file is a declaration, not an attestation service. The 90-day holdings freshness rule and sample thresholds are documented research guardrails, not proofs of economic independence or future protection.

Clerk/Convex deployed sessions, production human reviewer claims and trusted live ingestion have not been tested with real credentials. The backend is validated through mocked authenticated Convex tests. Configure the established deployment and publish the additive schema/functions before using private snapshots. Private imports are limited to 800,000 bytes and frozen snapshots to 850,000 bytes; local imports support up to 3 MB. Larger studies need a future immutable artifact-storage design.

The synthetic calendar is a weekday illustration, not an actual exchange calendar. Observed historical cases must supply a verified calendar and compatible licensed prices. Static stress shocks are explicit assumptions; future scenario date bounds do not establish actual realised trading sessions. The currency concentration view measures denomination, not full revenue geography or a validated economic FX hedge. No implicit FX conversion is performed for historical statistics.

Issuer TER values are dated specifications, not complete total ownership costs. Horizon fees, financing, slippage and other applicable costs must be explicitly incorporated into declared costs; the engine does not silently infer them from annual-fee metadata. Contract experiments omit executable quotes, time value, early exercise, dividend effects, tax and margin implementation. No predictive covariance model, optimiser, automatic allocation recommendation, leveraged trading or live-money execution is introduced.

Trading 212 and other broker connections remain read-only. A favourable human research review is not an allocated portfolio and cannot widen the established paper instrument allowlist. No broker credentials, orders, hardware purchases or external model calls were used for this release.

See [workflow](portfolio-defence.md), [KPI dictionary](portfolio-defence-kpis.md) and [source provenance](../data/defence/SOURCES.md).
