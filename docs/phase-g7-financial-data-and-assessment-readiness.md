# AI Capital Intelligence — Phase G.7: Financial Data Completeness & Research Assessment Readiness

**Document Status**: Phase G.7 Audit, Deterministic Valuation Architecture & Prioritised Implementation Proposal  
**Target Production Deployment**: `https://capital.aiguides.co.uk`  
**Methodology & Engine Versions**:
- Stock Research Screening Engine: `aci-stock-rating-v1.0.0-exp` ([`lib/research-ratings/engine.ts`](../lib/research-ratings/engine.ts))
- Deterministic Valuation Layer: `aci-valuation-layer-v1.0.0` ([`lib/research-ratings/valuation-layer.ts`](../lib/research-ratings/valuation-layer.ts))
- Forward Research Evaluation Ledger: `aci-forward-evaluation-v1.0.0` ([`lib/research-ratings/forward-evaluation.ts`](../lib/research-ratings/forward-evaluation.ts))
- Data Readiness & Release-Gate Auditor: `aci-data-readiness-v1.0.0` ([`lib/research-ratings/financial-data-readiness.ts`](../lib/research-ratings/financial-data-readiness.ts))
- Execution Authority: `none` (All live and demo order execution disabled; production directional `BUY` / `HOLD` / `SELL` classifications remain locked at `INSUFFICIENT DATA`)

---

## 1. Executive Summary: What Is Achievable With Existing Free Sources vs Paid Services

Before purchasing any market-data subscriptions or unlocking directional rating gates, we audited all **84 financial data cells** (`7 companies × 12 categories`) across the research universe (`NVDA`, `MSFT`, `GOOGL`, `AMZN`, `AMD`, `CRWV`, `INTC`):

| Audit Classification | Cell Count (`84` Total) | Share of Universe | Primary Cause |
| :--- | :---: | :---: | :--- |
| **`verified`** | **18 / 84** | `21.4%` | `NVDA`, `MSFT`, `GOOGL`, and `AMZN` have verified primary SEC income and cash-flow statements (`Revenue`, `Operating Income`, `OCF`, `Capex`, `FCF`), plus exact SEC EDGAR `acceptanceDateTime` (`publishedAt`) timestamps on `GOOGL` and `AMZN`. |
| **`missing`** | **55 / 84** | `65.5%` | Missing SEC XBRL balance-sheet `Debt & Cash` (7/7), `Diluted Share Counts` (7/7), `Market Cap & EV` (7/7), `Current Valuation Multiples` (7/7), `Historical Multiples` (7/7), `Corporate Actions` (7/7), plus missing local XBRL income/cash-flow tables for `AMD`, `CRWV`, and `INTC` (12 cells) and `AMD` filing timestamps (1 cell). |
| **`unsuitable`** | **7 / 84** | `8.3%` | Stored historical prices (`46` sessions for 6 stocks; `0` static / `6` policy-risk sessions for `INTC`) are **unadjusted public reference closes** (`priceBasis: unadjusted_close`, `corporateActionsReviewed: false`) without commercial redistribution rights. |
| **`stale`** | **3 / 84** | `3.6%` | `NVDA` (`nvda-fy27-q2`) has date-only publication (`2026-08-26`, `publishedAt: null`); `CRWV` and `INTC` local records reference earlier S-1/10-K timestamps without latest 2026 10-Q `acceptanceDateTime`. |
| **`conflicting`** | **1 / 84** | `1.2%` | `MSFT` has `publicationDate: "2026-10-28"` (`publishedAt: null`) in `company-comparison.json` vs `publishedAt: "2026-10-29T06:00:00Z"` in `Macro Case 001` (`src-msft-10q-2026q3`). |

### Crucial Finding: 46 of the 66 Non-Verified Cells (`69.7%`) Are Resolvable at £0 / Month Using Existing SEC EDGAR XBRL Infrastructure

1. **Achievable Immediately at £0 / Month (U.S. SEC EDGAR XBRL API — Public Domain, Commercial Reuse Permitted)**:
   - Our Convex cloud collector ([`convex/remoteOpsCloud.ts`](../convex/remoteOpsCloud.ts)) already queries `https://data.sec.gov/submissions/CIK{10-digit}.json` and `https://data.sec.gov/api/xbrl/companyfacts/CIK{10-digit}.json`.
   - Extending the deterministic SEC XBRL extractor to persist structured multi-quarter facts resolves **46 of the 66 non-verified cells at zero cost**:
     - Full quarterly & 4-quarter Trailing Twelve Months (`TTM`) **Revenue, Operating Income (EBIT), GAAP Net Income, Operating Cash Flow, Capital Expenditure, and Free Cash Flow** for **`AMD` (`CIK 0000002488`)**, **`INTC` (`CIK 0000050863`)**, and **`CRWV` (`CIK 0001769628`)**, plus missing 4-quarter TTM sums for **`NVDA`**, **`MSFT`**, and **`GOOGL`**.
     - Consolidated Balance Sheet **Cash & Cash Equivalents, Short-Term Marketable Securities, Total Short- & Long-Term Debt, Finance Lease Liabilities, and Stockholders’ Equity** for **all 7 companies**.
     - Authoritative **Weighted-Average Diluted & Basic Share Counts** (`us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding` and cover-page multi-class `dei:EntityCommonStockSharesOutstanding`, including `GOOGL` Class A + Class B + Class C summation) for **all 7 companies**.
     - Exact SEC EDGAR **`acceptanceDateTime` (`publishedAt` UTC epoch ms)** and **`10-Q/A` / `10-K/A` restatement flags** for **all 7 companies**.
     - Backfilling `INTC` daily reference closes from 6 sessions to 46+ sessions via the existing `nasdaq_public_historical` collector for **internal owner screening** at £0.
2. **Requires Paid Commercial Data Provider (`20 / 84` Cells — Do Not Purchase Without Owner Approval)**:
   - SEC EDGAR XBRL does not provide daily split- and dividend-adjusted equity prices (`adjClose`, `splitFactor`, `divCash`), and publicly visible reference endpoints (Nasdaq web JSON, Stooq, Yahoo Finance, Trading 212 personal API) **prohibit commercial redistribution**.
   - Specifically, the **20 cells** covering **`Corporate Actions & Distributions` (`7/7`)**, **`Adjusted Historical Prices` (`7/7`)**, and **`Multi-Year Historical Valuation Multiples` (`6/7`, plus `CRWV` post-IPO)** require:
     - **For Single-Owner / Internal Research**: **Tiingo Power Tier ($10 / month ≈ £7.80 / month)** — provides 30+ years of split- and dividend-adjusted daily OHLCV (`adjClose`, `splitFactor`, `divCash`), IEX real-time quotes, and `gbpusd` FX.
     - **For Commercial Multi-User Redistribution**: **Tiingo Commercial Redistribution Tier ($50–$150 / month ≈ £39–£118 / month)** or **Nasdaq Data Link — Sharadar Core US Equities ($199+ / month commercial)**.

---

## 2. Stage 1 — Seven-Stock Financial Data Coverage Matrix (84 Audited Cells)

The table below summarises the programmatic audit implemented in [`SEVEN_STOCK_COVERAGE_MATRIX`](../lib/research-ratings/financial-data-readiness.ts#L101-L1150). Each cell is classified as `verified`, `stale`, `missing`, `conflicting`, or `unsuitable`:

### 2.1 Summary Matrix Across All 7 Companies & 12 Categories

| Category | NVDA (`0001045810`) | MSFT (`0000789019`) | GOOGL (`0001652044`) | AMZN (`0001018724`) | AMD (`0000002488`) | CRWV (`0001769628`) | INTC (`0000050863`) | Remediation Source |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Revenue & Growth** | **`verified`** (`FY27 Q2` `$96,221M`; Data Center `$89,000M`; TTM missing) | **`verified`** (`FY27 Q1` `$92,279M`; Azure `+48%` YoY; TTM missing) | **`verified`** (`2026-Q3` `$127,577M` `+24.65%` YoY; Cloud `+102.6%`) | **`verified`** (`TTM-2026-Q3` `$797,455M`; `2026-Q3` `$201,944M` `+12.09%` YoY) | **`missing`** (No local SEC table stored) | **`missing`** (No local S-1/10-Q table stored) | **`missing`** (No local SEC table stored) | **£0 SEC EDGAR XBRL** |
| **2. Earnings & Operating Margins** | **`verified`** (`FY27 Q2` EBIT `$63,734M` `66.24%`; Net `$59,688M`; EPS `$2.46`) | **`verified`** (`FY27 Q1` EBIT `$45,915M` `49.76%`; Net `$36,629M`; EPS `$4.92`) | **`verified`** (`2026-Q3` EBIT `$40,576M` `31.81%`; EPS `$2.12`; Net $ total missing) | **`verified`** (`TTM-2026-Q3` EBIT `$104,405M` `13.09%`; `2026-Q3` EBIT `$28,076M` `13.90%`) | **`missing`** (No local SEC table stored) | **`missing`** (No local S-1/10-Q table stored) | **`missing`** (No local SEC table stored; loss-making guard needed) | **£0 SEC EDGAR XBRL** |
| **3. OCF & Capital Expenditure** | **`verified`** (`FY27 Q2` OCF `$24,077M`; Cash Capex `$2,677M` = `11.12%` OCF) | **`verified`** (`FY27 Q1` OCF `$58,000M`; Cash Capex `$39,367M` = `67.87%` OCF) | **`verified`** (`2026-Q3` OCF `$42,290M`; Capex `$51,355M` = `121.44%` OCF) | **`verified`** (`TTM-2026-Q3` OCF `$168,300M`, Net Capex `$210,657M` = `125.17%` OCF) | **`missing`** (No local SEC table stored) | **`missing`** (No local S-1/10-Q table stored) | **`missing`** (No local SEC table stored) | **£0 SEC EDGAR XBRL** |
| **4. Free Cash Flow** | **`verified`** (`FY27 Q2` `$21,341M`, `22.18%` FCF margin) | **`verified`** (`FY27 Q1` `$18,633M`, `20.19%` FCF margin) | **`verified`** (`2026-Q3` `-$9,065M`, `-7.11%` FCF margin) | **`verified`** (`TTM-2026-Q3` `-$42,357M`, `-5.31%` margin; `2026-Q3` `-$33,456M`) | **`missing`** (Blocked by missing OCF/capex) | **`missing`** (Blocked by missing OCF/capex) | **`missing`** (Blocked by missing OCF/capex) | **£0 SEC EDGAR XBRL** |
| **5. Debt & Cash** | **`missing`** (Book equity `$228,984M` stored; Cash & Total Debt `null`) | **`missing`** (Book equity `$470,509M` stored; Cash & Total Debt `null`) | **`missing`** (Cash, marketable securities & debt `null`) | **`missing`** (Cash, marketable securities & debt `null`) | **`missing`** (Cash & debt `null`) | **`missing`** (GPU SPV debt facilities, leases & cash `null`) | **`missing`** (Cash & debt `null`; `$11B` Fab 34 SCJV in TypeDB) | **£0 SEC EDGAR XBRL** |
| **6. Diluted Share Counts** | **`missing`** (`null`; EPS back-solving prohibited) | **`missing`** (`null`; EPS back-solving prohibited) | **`missing`** (`null`; Class A + B + C multi-class sum required) | **`missing`** (`null` in cash JSON) | **`missing`** (`null`) | **`missing`** (`null`; post-IPO Class A+B & anti-dilution required) | **`missing`** (`null`) | **£0 SEC EDGAR XBRL** |
| **7. Market Cap & Enterprise Value** | **`missing`** (`null` — blocked by shares & net debt) | **`missing`** (`null` — blocked by shares & net debt) | **`missing`** (`null` — blocked by multi-class shares & net debt) | **`missing`** (`null` — blocked by shares & net debt) | **`missing`** (`null` — blocked by shares & net debt) | **`missing`** (`null` — blocked by shares & GPU debt) | **`missing`** (`null` — blocked by shares & net debt) | **£0 SEC XBRL** (Internal) / **Paid Feed** (Commercial) |
| **8. Historical Valuation Multiples** | **`missing`** (`null` — no multi-year series) | **`missing`** (`null` — no multi-year series) | **`missing`** (`null` — no multi-year series) | **`missing`** (`null` — no multi-year series) | **`missing`** (`null` — no multi-year series) | **`missing`** (`null` — post-IPO history limited) | **`missing`** (`null` — no multi-year series) | **Paid Adjusted Price Feed + £0 SEC XBRL** |
| **9. Current Valuation Measures** | **`missing`** (`null` — needs 4Q TTM flows, shares & net debt) | **`missing`** (`null` — needs 4Q TTM flows, shares & net debt) | **`missing`** (`null` — needs 4Q TTM flows, A+B+C shares & net debt) | **`missing`** (`null` — TTM rev/EBIT ready; needs shares, Net Income & debt) | **`missing`** (`null` — needs TTM XBRL, shares & debt) | **`missing`** (`null` — needs XBRL; P/E & EV/FCF N/M if negative) | **`missing`** (`null` — needs XBRL; P/E & EV/FCF N/M if negative) | **£0 SEC EDGAR XBRL** |
| **10. Corporate Actions & Distributions** | **`missing`** (`corporateActionsReviewed: false`) | **`missing`** (`corporateActionsReviewed: false`) | **`missing`** (`corporateActionsReviewed: false`) | **`missing`** (`corporateActionsReviewed: false`) | **`missing`** (`corporateActionsReviewed: false`) | **`missing`** (`corporateActionsReviewed: false`) | **`missing`** (`corporateActionsReviewed: false`) | **Paid Corporate-Action Feed (Tiingo / Polygon)** |
| **11. Adjusted Historical Prices** | **`unsuitable`** (`46` unadjusted reference bars) | **`unsuitable`** (`46` unadjusted reference bars) | **`unsuitable`** (`46` unadjusted reference bars) | **`unsuitable`** (`46` unadjusted reference bars) | **`unsuitable`** (`46` unadjusted reference bars) | **`unsuitable`** (`46` unadjusted reference bars) | **`unsuitable`** (`6` bars in policy-risk; `<15` blocks 20D momentum) | **Paid Adjusted Price Feed (Tiingo $10/mo internal / $50+/mo comm.)** |
| **12. SEC Filing Timestamps (`publishedAt` & `receivedAt`)** | **`stale`** (Date-only `2026-08-26`, `publishedAt: null`) | **`conflicting`** (`2026-10-28` null vs `2026-10-29T06:00:00Z`) | **`verified`** (`publishedAt: 1793217693000`, `receivedAt: 1793294123000`) | **`verified`** (`publishedAt: 1793304327000`, `receivedAt: 1793471503000`) | **`missing`** (No local filing record stored) | **`stale`** (Has `2026-10-12` Polaris source; missing latest 10-Q EDGAR timestamp) | **`stale`** (Has `2026-02-14` 10-K; missing 2026 10-Q EDGAR timestamps) | **£0 SEC EDGAR Submissions API** |

---

## 3. Stage 2 — Legitimate Data Sources, Licensing, Commercial Reuse Rights & Ongoing Costs

We must never assume that publicly visible market prices (e.g., Stooq, Yahoo Finance, Nasdaq web tables, or Trading 212 personal account snapshots) can legally be redistributed through a commercial research application. The catalog below (codified in [`LEGITIMATE_DATA_SOURCES_CATALOG`](../lib/research-ratings/financial-data-readiness.ts#L1185-L1375)) establishes the legal and technical boundaries of each source:

| Provider / Source | Data Domains Covered | Monthly Cost (GBP / USD) | Internal Personal Research | Commercial Redistribution | Historical Depth & Freshness | Recommendation |
| :--- | :--- | :---: | :---: | :---: | :--- | :--- |
| **1. U.S. SEC EDGAR XBRL & Submissions API** (`data.sec.gov`) | 10-K/10-Q/8-K/S-1 Revenue, EBIT, Net Income, OCF, Capex, Debt, Cash, Diluted Shares, `acceptanceDateTime` | **£0 / mo** (`$0`) | **Yes** | **Yes** (17 U.S.C. § 105 Public Domain; requires `User-Agent` & $\le 10$ req/s) | 15+ years (`2009–Present`); real-time within ~60s of EDGAR acceptance | **Expand Immediately (£0)** — solves 46 of 66 missing/stale cells. |
| **2. Official Central Banks & Grid Authorities** (ECB, BoE `XUDLUSS`, FRED, EirGrid, EIA) | Daily USD/GBP & EUR/USD reference FX, `VIXCLS`, US 10Y yields, regional grid capacity | **£0 / mo** (`$0`) | **Yes** | **Yes** (Open government/central-bank data with attribution) | 20+ years daily series; 16:00 CET/London FX fixing | **Retain (£0)** — note 16:00 London fixing vs 21:00 UTC US equity close. |
| **3. Nasdaq Public Historical Quote API** (`api.nasdaq.com`) | Unadjusted daily OHLCV closes (`NVDA`, `MSFT`, `GOOGL`, `AMZN`, `AMD`, `CRWV`, `INTC`, `QQQ`) | **£0 / mo** (`$0`) | **Yes** (Single-owner internal display) | **No** (Terms prohibit commercial republication; unadjusted closes only) | 10 years unadjusted daily bars; 15m+ delayed EOD | **Internal Reference Only (£0)** — use to backfill `INTC` 20D momentum for owner; do not redistribute commercially. |
| **4. Trading 212 Personal Account API** (`live.trading212.com`) | Authenticated owner cash, invested cost, open position quantities & account P/L | **£0 / mo** (`$0`) | **Yes** (Owner portfolio view only) | **No** (Strictly prohibited as a market price feed) | Point-in-time owner account syncs | **Prohibited for Market Data Feed** (`assertNotTrading212PositionPrice`). |
| **5. Tiingo EOD Split/Dividend-Adjusted Prices & IEX API** | `adjOpen/High/Low/Close`, `splitFactor`, `divCash`, IEX real-time, `gbpusd` FX | **$10 / mo (~£7.80/mo)** Power (Internal) · **$50–$150 / mo (~£39–£118/mo)** Commercial | **Yes** | **Yes on Commercial Tier** ($50–$150/mo) | 30+ years split/dividend-adjusted daily EOD; 5+ years intraday | **Recommended #1 Paid Upgrade** (subject to owner approval) to resolve the 20 adjusted-price & corporate-action cells. |
| **6. Nasdaq Data Link — Sharadar Core US Equities (`SEP` + `SF1`)** | Split-adjusted prices (`SEP`), point-in-time SEC fundamentals (`SF1`), **delisted US equities** | **$50 / mo (~£39/mo)** Personal · **$199+ / mo (~£156+/mo)** Commercial | **Yes** | **Yes on Commercial Tier** | 20+ years survivorship-bias-free US equities | **Optional Tier 4 Upgrade** if survivorship-free delisted company backtesting is expanded beyond the 7-stock cohort. |
| **7. Polygon.io (Massive) Stocks Starter / Business** | Split-adjusted daily/minute aggregates (`/v2/aggs`), `/v3/reference/splits` & `dividends` | **$29 / mo (~£22.60/mo)** Personal · **$199 / mo (~£156/mo)** Business | **Yes** | **Yes on Business Tier** ($199+/mo) | 5 years (Starter) to 20+ years (Business) | **Alternative to Tiingo** (already supported in `lib/market-data/provider-adapter.ts`). |
| **8. Licensed Consensus Estimate Vendors** (Intrinio Zacks / FMP Enterprise / LSEG) | Forward Street consensus Revenue, EBITDA, EPS, FCF & revision timestamps | **$250–$1,000+ / mo (~£195–£780+/mo)** | Requires license | Requires enterprise license | 5–15+ years point-in-time estimates | **Defer / Not Required** — Dimension 1 (Valuation) is anchored on deterministic SEC XBRL Trailing TTM multiples at £0. |

---

## 4. Stage 3 — Deterministic Valuation Layer (`aci-valuation-layer-v1.0.0`)

Implemented in [`lib/research-ratings/valuation-layer.ts`](../lib/research-ratings/valuation-layer.ts) and verified by unit tests in [`tests/phase-g7-financial-data-and-valuation.test.ts`](../tests/phase-g7-financial-data-and-valuation.test.ts).

### 4.1 Exact Mathematical Formulas & Period-Matching Rules

Every financial ratio in `computeDeterministicValuationMetrics(bundle)` enforces strict currency/unit normalisation (`normaliseToUsdMillions` converting `'billions'`, `'millions'`, `'thousands'`, or `'ones'` in `'USD'` to `$M`) and period compatibility:

| Metric Key | Formula (`USD millions` / `shares millions`) | Required Period Scope | Loss-Making / Negative Value / Missing Input Guardrail |
| :--- | :--- | :--- | :--- |
| **`market_cap_usd_millions`** | $\text{Close}_{\text{USD}} \times \text{DilutedShares}_{\text{M}}$ | `POINT_IN_TIME` | Rejects share counts back-solved from rounded EPS (`blocked_derived_share_count_unsuitable`). Rejects un-reconciled multi-class shares (`GOOGL` requires Class A + B + C total). Returns `null` if price or primary XBRL share count is missing. |
| **`net_debt_usd_millions`** | $(\text{TotalDebt}_{\text{M}} + \text{FinanceLeases}_{\text{M}}) - (\text{Cash}_{\text{M}} + \text{ShortTermInvestments}_{\text{M}})$ | `POINT_IN_TIME` | Negative values represent **Net Cash** (formatted as `-$X,XXXM (Net Cash)`). Returns `null` if XBRL debt or cash is missing. |
| **`enterprise_value_usd_millions`** | $\text{MarketCap}_{\text{M}} + \text{NetDebt}_{\text{M}}$ | `POINT_IN_TIME` | Returns `null` if either `MarketCap` or `NetDebt` is `null`. |
| **`price_to_book`** | $\frac{\text{MarketCap}_{\text{M}}}{\text{BookEquity}_{\text{M}}}$ | `POINT_IN_TIME` | If $\text{BookEquity}_{\text{M}} \le 0$, returns `null` with `status: 'not_meaningful_negative_book_equity'`. |
| **`trailing_gaap_pe`** | $\frac{\text{MarketCap}_{\text{M}}}{\text{NetIncome}_{\text{TTM, M}}}$ | **`TTM` or `ANNUAL` only** | Refuses `SINGLE_QUARTER` flows (`blocked_period_mismatch_requires_ttm`). If $\text{NetIncome}_{\text{TTM}} \le 0$, returns `null` (`N/M (Loss-Making)`, `not_meaningful_negative_earnings`) so loss-making firms never sort as "cheap" on a negative P/E. |
| **`ev_to_ttm_revenue`** | $\frac{\text{EnterpriseValue}_{\text{M}}}{\text{Revenue}_{\text{TTM, M}}}$ | **`TTM` or `ANNUAL` only** | Refuses `SINGLE_QUARTER` flows. If $\text{EV} \le 0$, returns `null` (`not_meaningful_non_positive_ev`). |
| **`ev_to_ttm_ebit`** | $\frac{\text{EnterpriseValue}_{\text{M}}}{\text{OperatingIncome}_{\text{TTM, M}}}$ | **`TTM` or `ANNUAL` only** | Refuses `SINGLE_QUARTER` flows. If $\text{OperatingIncome}_{\text{TTM}} \le 0$, returns `null` (`N/M (Operating Loss)`, `not_meaningful_negative_ebit`). |
| **`ev_to_ttm_fcf`** | $\frac{\text{EnterpriseValue}_{\text{M}}}{\text{FreeCashFlow}_{\text{TTM, M}}}$ | **`TTM` or `ANNUAL` only** | Refuses `SINGLE_QUARTER` flows. If $\text{FreeCashFlow}_{\text{TTM}} \le 0$ (e.g., `AMZN` `-$42,357M`), returns `null` (`N/M (Negative TTM FCF)`, `not_meaningful_negative_fcf`). |
| **`fcf_yield_market_cap_pct`** | $\left(\frac{\text{FreeCashFlow}_{\text{TTM, M}}}{\text{MarketCap}_{\text{M}}}\right) \times 100$ | **`TTM` or `ANNUAL` only** | Defined for both positive and negative TTM FCF; when $\text{FCF}_{\text{TTM}} < 0$, formats as `-X.XX% (Cash Burn)` with explicit warning. |
| **`fcf_yield_ev_pct`** | $\left(\frac{\text{FreeCashFlow}_{\text{TTM, M}}}{\text{EnterpriseValue}_{\text{M}}}\right) \times 100$ | **`TTM` or `ANNUAL` only** | Requires $\text{EV} > 0$; preserves negative cash-burn yield when $\text{FCF}_{\text{TTM}} < 0$. |
| **`net_debt_to_ttm_ocf`** | $\frac{\text{NetDebt}_{\text{M}}}{\text{OperatingCashFlow}_{\text{TTM, M}}}$ | **`TTM` or `ANNUAL` only** | Requires positive $\text{OCF}_{\text{TTM}} > 0$. |
| **`gaap_operating_margin_pct`** | $\left(\frac{\text{OperatingIncome}_{\text{M}}}{\text{Revenue}_{\text{M}}}\right) \times 100$ | Matched `SINGLE_QUARTER` or `TTM` | Valid whenever numerator and denominator share the identical fiscal period (`NVDA` `66.24%`, `MSFT` `49.76%`, `GOOGL` `31.81%`, `AMZN` TTM `13.09%` / Q3 `13.90%`). |
| **`fcf_margin_pct`** | $\left(\frac{\text{FreeCashFlow}_{\text{M}}}{\text{Revenue}_{\text{M}}}\right) \times 100$ | Matched `SINGLE_QUARTER` or `TTM` | Valid on matched period (`NVDA` `+22.18%`, `MSFT` `+20.19%`, `GOOGL` Q3 `-7.11%`, `AMZN` TTM `-5.31%` / Q3 `-16.57%`). |
| **`net_capex_to_ocf_pct`** | $\left(\frac{\text{NetCapex}_{\text{M}}}{\text{OperatingCashFlow}_{\text{M}}}\right) \times 100$ | Matched `SINGLE_QUARTER` or `TTM` | Valid on matched period (`NVDA` `11.12%`, `MSFT` `67.87%`, `GOOGL` Q3 `121.44%`, `AMZN` TTM `125.17%` / Q3 `178.86%`). |

---

## 5. Stage 4 — Five-Tier Directional-Rating Release Gate Architecture

Implemented in [`evaluateFiveTierReleaseGates`](../lib/research-ratings/financial-data-readiness.ts#L1588-L1740). Production `BUY` / `HOLD` / `SELL` / `AVOID` classifications remain **hard-locked at `INSUFFICIENT DATA`** until all 5 progressive gates are satisfied and approved by the owner:

| Gate Tier | Title & Allowed Output Classification | Permits `BUY` / `HOLD` / `SELL`? | Current Universe Status | Mandatory Release Criteria | Why 252 Price Observations Do Not Suffice |
| :--- | :--- | :---: | :--- | :--- | :--- |
| **Tier 1** | **Fundamental Research Screening** (`Non-Directional Screening Score 0–100 + Blocking Reasons`) | **No** (`false`) | **Passed for 4/7** (`NVDA`, `MSFT`, `GOOGL`, `AMZN`); **Blocked for 3/7** (`AMD`, `CRWV`, `INTC`) | Verified primary SEC income/cash-flow metrics, TypeDB counterparty links, non-directional priority score, and explicit per-row blocking reasons (`data-testid="blocking-reasons-<TICKER>"`). | Tier 1 ranks fundamental due-diligence priority only and makes zero directional return claims. |
| **Tier 2** | **Valuation-Supported Investment Assessment** (`Multiples & FCF Yield Evaluated; Non-Predictive`) | **No** (`false`) | **Blocked (`0/7`)** | Tier 1 + 4-quarter `TTM` XBRL statements, primary XBRL diluted share counts (multi-class reconciled), balance-sheet Cash & Debt, and corporate-action-reviewed prices (`Market Cap`, `EV`, `EV/TTM Revenue`, `EV/TTM EBIT`, `Trailing P/E`, `FCF Yield`). | 252 price bars cannot compute Enterprise Value, P/E, or FCF Yield without balance-sheet Net Debt, Diluted Shares, and 4Q TTM cash flows. |
| **Tier 3** | **Risk and Momentum Analysis** (`Horizon-Separated Fundamental, Leverage & Tactical Momentum`) | **No** (`false`) | **Blocked (`0/7`)** | `252+` consecutive trading sessions of split- and dividend-adjusted daily prices (`adjClose`, `splitFactor`, `divCash`, `corporateActionsReviewed: true`) for all 7 stocks, `QQQ`, and `SOXX`, plus realized volatility, max drawdown, and `Net Debt / TTM OCF`. | 252 split-adjusted daily bars are the minimum needed to measure **trailing 1-year realized volatility, beta, and 52-week drawdown** (Tier 3), NOT proof of forward predictive alpha (Tiers 4 & 5). |
| **Tier 4** | **Historically Validated Methodology** (`Point-in-Time Multi-Cycle Backtested Methodology`) | **No** (`false`) | **Blocked (`0/7`)** | Multi-year (`3–5+` years across rate/capex regimes) strict point-in-time backtest (`publishedAt <= anchorAt`) across a survivorship-bias-free cohort, deducting spread (`10 bps`), slippage (`5 bps`), and FX (`15 bps`) vs `QQQ`, `SOXX`, and passive equal-weight across $\ge 12$ quarterly earnings cycles. | **Statistical Invariant**: A 252-session (1-year) window contains **only $N = 1$ independent 12-month fundamental horizon** inside a single market regime. Validating a 6–12M fundamental rating model requires multi-year cross-sectional cohorts across multiple macro cycles. |
| **Tier 5** | **Prospectively Evaluated Signals** (`Production Directional Unlock Gate`) | **Yes** (`true` — **only after owner sign-off**) | **Blocked (`0/7`)** | Tiers 1–4 passed + cryptographically sealed `ImmutableAssessmentSnapshot` records evaluated out-of-sample over elapsed `20D`, `60D`, and `180D+` forward horizons against `QQQ`, `SOXX`, and passive equal-weight with zero look-ahead or tamper violations. | Historical backtests (even over 252+ days) remain vulnerable to specification search; only frozen forward-registered signals scored on unseen future sessions prove live discipline. |

---

## 6. Stage 5 — Forward Research Evaluation Architecture (`aci-forward-evaluation-v1.0.0`)

Implemented in [`lib/research-ratings/forward-evaluation.ts`](../lib/research-ratings/forward-evaluation.ts):

1. **Timestamped, Immutable Assessment Snapshots (`createImmutableAssessmentSnapshot`)**:
   - Captures `recordedAtMs`, `recordedAtIso`, `methodologyVersion` (`aci-stock-rating-v1.0.0-exp`), `horizonKey` (`20D_TACTICAL`, `60D_QUARTERLY`, `126D_SEMIANNUAL`, `252D_ANNUAL`), `targetEndAtMs`, all 7 company entries (`assessmentLabel`, `researchPriorityScore`, `priorityRank`, `coveredWeightPct`, `unmetGates`, `anchorCloseUsd`, `anchorCloseGbp`, `citedSourceIds`), and computes a canonical SHA-256 content hash (`snapshotSha256`).
2. **Retrospective Tamper Detection (`verifyAssessmentSnapshotIntegrity`)**:
   - Recomputes the canonical SHA-256 digest prior to any outcome evaluation. If any historical score, label, timestamp, or citation was modified after registration, `evaluateForwardAssessmentOutcomes` halts immediately with `evaluationStatus: 'blocked_tampered_snapshot'`.
3. **Look-Ahead Bias & Unelapsed Horizon Prevention**:
   - If `evaluationAsOfMs < snapshot.targetEndAtMs`, evaluation halts with `evaluationStatus: 'horizon_not_elapsed'`.
   - If any outcome price bar has `eventAtMs <= snapshot.recordedAtMs` or `serverReceivedAtMs <= snapshot.recordedAtMs`, evaluation halts with `evaluationStatus: 'blocked_look_ahead_violation'`.
4. **Three-Benchmark Outcome Measurement (`evaluateForwardAssessmentOutcomes`)**:
   - Measures the top-priority fundamental cohort (gross USD, gross GBP, and net GBP after `10 bps` spread + `5 bps` slippage + `15 bps` FX conversion per leg = `60 bps` round-trip) against:
     1. **`QQQ`** (Nasdaq-100 broad market benchmark)
     2. **`SOXX`** (Sector benchmark for AI Semiconductors & Cloud Infrastructure)
     3. **`Passive Equal-Weight Universe Alternative`** (`1/N` buy-and-hold across all 7 universe stocks)
   - Reports realized annualised volatility (`%`), maximum drawdown (`%`), data freshness (`missingSessionsCount`, `maxPriceStalenessDaysAtTarget`, `allBarsCorporateActionsReviewed`), and signal/rank transitions (`computeAssessmentTransitionLedger`).

---

## 7. Stage 6 — Production Integrity Verification

Verified by [`auditProductionIntegrityAndMetricProvenance`](../lib/research-ratings/financial-data-readiness.ts#L1771-L1855) and UI instrumentation in [`components/command-centre/command-centre.tsx`](../components/command-centre/command-centre.tsx#L83-L87) and [`components/command-centre/executive-overview.tsx`](../components/command-centre/executive-overview.tsx#L1041-L1065):

1. **Broker Values Labelled With Actual Last-Sync Timestamp**:
   - Section B (`Portfolio Snapshot`) displays `data-testid="broker-last-sync-pill"` in the header (`Last Broker Sync: <ISO timestamp> (<relative age>)` when synced, `Not yet synchronised` when connected without sync, or `Signed out (no broker data loaded)` when unauthenticated), alongside the `Last full sync` KPI card.
2. **Unauthenticated Chat Fallback Cannot Be Mistaken for Live Gemini Inference**:
   - When an unauthenticated visitor submits a question in Section E (`Ask AI Capital Intelligence`), the response renders `data-testid="chat-fallback-notice"`:
     > **Unauthenticated Deterministic Public-Evidence Fallback (Not Live Gemini Inference):** This response was synthesised deterministically from approved SEC & TypeDB public evidence because you are not signed in. Sign in with the authorised owner account to execute live Gemini 2.5 Flash inference.
   - Its `modelId` is `'deterministic-evidence-engine-v1'` and `generationMode` is `'deterministic_public_evidence_synthesis (Sign in for live Gemini cloud synthesis)'`.
3. **Zero Private Brokerage Records Sent to Public-Research Inference**:
   - `buildExecutiveAssistantRequestPayload(question)` constructs a strict 3-key payload (`{"question","temporalBasis","mode"}`). No Trading 212 balances, cash, or positions ever enter `/api/graph/chat`.
4. **100% Screening Metric Provenance (`42 / 42` Observed Metrics Audited)**:
   - Every observed metric across all 7 companies has a non-empty `metricName`, `valueDisplay`, `periodOrAsOf`, `sourceLabel`, `sourceId`, and `definedFormulaOrBasis` (`incompleteProvenanceMetricsCount: 0`).
5. **Existing Phase G.6 Functionality & Read-Only Safety Preserved**:
   - Dashboard layout, 5 executive sections, stock filters, drawers, and `executionAuthority: 'none'` remain intact.

---

## 8. Prioritised Implementation Plan (Zero-Cost First, Paid Feeds Only After Owner Approval)

### Phase G.7.1 — Zero-Cost SEC EDGAR XBRL Expansion (£0 / Month — Ready to Execute Immediately)

1. **Step 1 (SEC XBRL Balance Sheet & Share Count Extractor — £0)**:
   - Extend the SEC XBRL collector (`convex/remoteOpsCloud.ts` / `worker/`) for all 7 CIKs (`NVDA`, `MSFT`, `GOOGL`, `AMZN`, `AMD`, `CRWV`, `INTC`) to extract and store:
     - `us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding` & `dei:EntityCommonStockSharesOutstanding` (with `GOOGL` Class A + Class B + Class C summation).
     - `us-gaap:CashAndCashEquivalentsAtCarryingValue`, `MarketableSecuritiesCurrent` / `ShortTermInvestments`, `LongTermDebtCurrent`, `LongTermDebtNoncurrent`, `FinanceLeaseLiability`, and `StockholdersEquity`.
2. **Step 2 (4-Quarter TTM Income & Cash-Flow Bridge for All 7 Stocks — £0)**:
   - Extract 8 consecutive quarters of `Revenues`, `OperatingIncomeLoss`, `NetIncomeLoss`, `NetCashProvidedByUsedInOperatingActivities`, and `PaymentsToAcquirePropertyPlantAndEquipment` for `NVDA`, `MSFT`, `GOOGL`, `AMD`, `CRWV`, and `INTC` (plus `NetIncomeLoss` for `AMZN`).
   - Reconcile exact SEC EDGAR `acceptanceDateTime` (`publishedAt` UTC epoch ms) across all 7 stocks.
   - **Impact**: Resolves **46 of the 66 non-verified cells at £0**, upgrades `AMD`, `CRWV`, and `INTC` to **Gate Tier 1**, and populates all fundamental inputs for **Gate Tier 2** (`aci-valuation-layer-v1.0.0`).
3. **Step 3 (Backfill `INTC` 46-Session Reference Closes for Internal Screening — £0)**:
   - Run `collectUniverseMarketObservations` (`nasdaq_public_historical`) for `INTC` so its 20D momentum sub-score is evaluated alongside the other 6 stocks in internal owner mode.

### Phase G.7.2 — Optional Paid Market-Data Upgrade (Requires Explicit Owner Approval Before Any Subscription)

4. **Step 4 (Corporate-Action & Split-Adjusted EOD Price Feed)**:
   - *For single-owner internal research & Tier 3/4 backtesting*: **Tiingo Power Tier ($10 / month ≈ £7.80 / month)** provides 30+ years of split- and dividend-adjusted daily prices (`adjClose`, `splitFactor`, `divCash`) + `gbpusd` FX.
   - *For commercial multi-user redistribution*: **Tiingo Commercial Redistribution Tier ($50–$150 / month ≈ £39–£118 / month)** or **Nasdaq Data Link Sharadar ($199+ / month)**.
   - **Impact**: Resolves the remaining **20 cells** (`Corporate Actions`, `Adjusted Historical Prices`, and `Multi-Year Historical Valuation Multiples`) and unlocks **Gate Tiers 2, 3, and 4**.
5. **Step 5 (Accumulate Forward-Registered Snapshots for Gate Tier 5)**:
   - Persist daily/weekly `ImmutableAssessmentSnapshot` records (`aci-forward-evaluation-v1.0.0`) in Convex and evaluate realized net outcomes against `QQQ`, `SOXX`, and the passive equal-weight baseline as `20D`, `60D`, and `180D` horizons elapse.
