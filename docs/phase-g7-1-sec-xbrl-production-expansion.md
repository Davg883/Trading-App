# AI Capital Intelligence — Phase G.7.1: SEC EDGAR XBRL Production Expansion & Thesis Monitor Quality Gate Report

- **Package Version**: `aci-sec-xbrl-g7-1-v1.0.0` ([`lib/research-ratings/sec-xbrl-expansion.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/research-ratings/sec-xbrl-expansion.ts), [`data/sec-xbrl/phase-g7-1-sec-xbrl-expansion.json`](file:///c:/GPT%205%20CODEX/Trading%20app/data/sec-xbrl/phase-g7-1-sec-xbrl-expansion.json))
- **Thesis Monitor Version**: `aci-thesis-monitor-v2.1.0` ([`lib/research-ratings/thesis-monitor.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/research-ratings/thesis-monitor.ts))
- **Methodology & Valuation Versions**: `aci-stock-rating-v1.0.0-exp` · `aci-valuation-layer-v1.0.0`
- **Production Environments**:
  - **Vercel Production**: `https://capital.aiguides.co.uk`
  - **Convex Production**: `https://benevolent-magpie-921.eu-west-1.convex.cloud`
  - **TypeDB Cloud 3.14.2**: `aci_macro_intelligence_prod`
- **Licensing & Model Cost**: **£0.00** (U.S. SEC EDGAR API, `17 U.S.C. § 105` Public Domain)
- **Execution Authority**: `"none"` (`LIVE_TRADING_ENABLED=false`, `DEMO_TRADING_ENABLED=false`)

---

## 1. Thesis Monitor Quality Audit & Root-Cause Resolution (Part A)

### 1.1 Why `aci-thesis-monitor-v2.0.0` Reported `4 + 3 + 1 + 1 = 9` Across 8 Declared Indicators

In `aci-thesis-monitor-v2.0.0`, [`evaluateAiCapexModerationThesis`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/research-ratings/thesis-monitor.ts) declared **8** leading indicators in `leadingIndicators`, but derived `evidenceChangeAssessment.counts` from a separate 9-item `rawChangeItems` array:
- Two separate change items (`chg-hyperscaler-q3-capex-surge` and `chg-fcf-compression-bridge`) mapped to the same underlying capex/FCF cash-conversion bridge.
- A standalone macro market volatility item (`chg-nov5-selloff-nov6-rebound`, classified `neutral`) was included in `rawChangeItems` even though 5–6 November index volatility was not one of the 8 declared leading indicators.
- Meanwhile, `ind-semiconductor-demand` and `ind-power-availability` were absent from `rawChangeItems` and `ind-regulatory-developments` was split across enacted state rules (`supports`) and uncertified local elections (`insufficient_evidence`).

### 1.2 Programmatic Invariant Enforcement in `aci-thesis-monitor-v2.1.0`

In `aci-thesis-monitor-v2.1.0` ([`lib/research-ratings/thesis-monitor.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/research-ratings/thesis-monitor.ts)):
1. Every item in `evidenceChangeAssessment.items` and every category total in `evidenceChangeAssessment.counts` is derived **1-to-1** from the 8 unique records in `leadingIndicators`.
2. Programmatic runtime assertions verify on every invocation:
   - `leadingIndicators.length === 8`
   - `new Set(leadingIndicators.map((i) => i.indicatorId)).size === 8` (`zeroDuplicateIndicatorIds: true`)
   - `counts.supports + counts.contradicts + counts.neutral + counts.insufficient_evidence === leadingIndicators.length === 8` (`sumOfMutuallyExclusiveCountsEqualsTotal: true`)

| Metric | Prior (`v2.0.0`) | Corrected (`v2.1.0`) |
| --- | --- | --- |
| **Declared Leading Indicators** | `8` | `8` |
| **Supporting (`supports`)** | `4` | **`1`** (`ind-cloud-revenue-growth`) |
| **Contradicting (`contradicts`)** | `3` | **`4`** (`ind-capex-to-ocf`, `ind-free-cash-flow`, `ind-semiconductor-demand`, `ind-credit-spreads-and-financing`) |
| **Neutral (`neutral`)** | `1` | **`2`** (`ind-project-deployment-delays`, `ind-power-availability`) |
| **Insufficient (`insufficient_evidence`)** | `1` | **`1`** (`ind-regulatory-developments`) |
| **Category Sum** | `9` (Invalid) | **`8`** (`1 + 4 + 2 + 1 = 8`, Valid) |

---

## 2. Corrected 8-Indicator Direction Table (Part A.3–A.6 & Part D.2)

Each indicator now explicitly separates:
1. `observedFinancialFact`
2. `hypothesisBeingTested`
3. `relevanceOfObservation`
4. `evidenceDirection` (`supports | contradicts | neutral | insufficient_evidence`)
5. `sourceConfidence` (`level` + `rationale`)
6. `freshnessAndHistoricalEligibility` (`freshnessStatus`, `publishedAtMs`, `receivedAtMs`, `eligibleAtCutoff`, `ageDays`, `rationale`)
7. `latestEligibleObservation`, `previousComparableObservation`, `evidenceSourceAndTimestamp`, `materialChange`, and `hypothesisResolution` (`supports | contradicts | does_not_resolve`).

| # | Indicator ID | Observed Financial Fact (Latest vs Prior Comparable) | Hypothesis Tested | Corrected Direction & Resolution | Reclassification Rationale (Part A.5–A.6) |
| --- | --- | --- | --- | --- | --- |
| **1** | `ind-capex-to-ocf` | **Latest**: AMZN `125.2%` TTM (`178.9%` Q3); GOOGL `121.4%` Q3 (`54.0%` TTM); MSFT `67.9%` FY27 Q1; CRWV `297.6%` TTM (`945.8%` Q2).<br>**Prior**: AMZN `88.7%` FY25 (`96.3%` Q3 2025); GOOGL `49.5%` Q3 2025. | Hyperscaler & neocloud Capex/OCF is moderating from peak levels toward sustainable capital intensity (`< 80%`). | **`contradicts`** (`contradicts`) | Unchanged (`contradicts`). Latest SEC filings show Capex/OCF accelerating sharply rather than moderating. |
| **2** | `ind-free-cash-flow` | **Latest**: AMZN `-$42,357M` TTM (`-$33,456M` Q3); GOOGL `-$9,065M` Q3 (`+$111,648M` TTM); CRWV `-$13,655M` TTM (`-$6,675M` Q2); MSFT `+$18,633M` Q1; NVDA `+$21,341M` Q2; AMD `+$701M` Q3 (`+$6,742M` TTM); INTC `-$1,497M` Q3 (`-$8,213M` TTM).<br>**Prior**: AMZN `+$14,808M` FY25; GOOGL `+$44,755M` Q3 2025. | Moderating capex is already improving capital efficiency and restoring positive Free Cash Flow across AI infrastructure builders. | **`contradicts`** (`contradicts`) | **Reclassified from `supports` to `contradicts`**. Deeply negative FCF at AMZN (`-$42.4B` TTM), GOOGL (`-$9.1B` Q3), CRWV (`-$13.7B` TTM), and INTC (`-$8.2B` TTM) is evidence of acute cash burn from unmoderated capex — never confirmation that capital discipline is already improving. |
| **3** | `ind-cloud-revenue-growth` | **Latest**: Google Cloud `$30.71B` (`+102.6%` YoY, `$11.12B` EBIT); AWS `$45.98B` (`+39.3%` YoY, `$17.45B` EBIT); Azure `$33.17B` (`+48%` YoY); US Q3 Real GDP `+3.4%` SAAR (`BEA 26-45`).<br>**Prior**: Google Cloud `$15.16B` Q3 2025; AWS `$33.01B` Q3 2025; US Q2 Real GDP `+2.2%` SAAR. | Enterprise AI cloud revenue and operating income continue expanding at a healthy double-digit pace (`>= 25%` YoY). | **`supports`** (`supports`) | Unchanged (`supports`). Sole indicator currently supporting the thesis’s second clause (that underlying AI cloud demand remains strong). |
| **4** | `ind-semiconductor-demand` | **Latest**: NVDA Q2 FY27 Data Center `$89.0B` (`$96.22B` total, `66.2%` EBIT margin) & Q3 FY27 guide `$108.0B ± 2%` (`+12.2%` QoQ); AMD Q3 2026 revenue `$13,377M` (`+44.68%` YoY, `$3,275M` EBIT).<br>**Prior**: NVDA Q1 FY27 `$81.62B`; AMD Q3 2025 `$9,246M`. | AI accelerator shipment growth is moderating from hyper-growth toward a steadier replacement cadence. | **`contradicts`** (`contradicts`) | Unchanged (`contradicts`). Sequential NVDA revenue guidance (`+12.2%` QoQ to `$108B`) and AMD `+44.7%` YoY growth refute any autumn 2026 hardware ordering pause. |
| **5** | `ind-credit-spreads-and-financing` | **Latest**: US HY OAS (`BAMLH0A0HYM2`) `340 bps` (`+22 bps`); Anthropic `$895.4B` deduplicated commitments (`-$104.0B` 9M GAAP loss); CRWV `$35,551M` debt (`$30,027M` Net Debt); NVDA `$1.0B` Nscale note + `$860.3M` guarantee.<br>**Prior**: US HY OAS `318 bps`; pre-S-1/A disclosures. | AI buildouts are becoming more self-funded and capital-efficient with declining reliance on circular vendor financing and debt. | **`contradicts`** (`contradicts`) | Unchanged (`contradicts`). Widening credit spreads (`+22 bps`), `$895.4B` in locked-in frontier-lab commitments, and `$30.0B` CRWV Net Debt demonstrate escalating leverage and commitment lock-in. |
| **6** | `ind-project-deployment-delays` | **Latest**: MSFT Loughton UK `v1` cancelled (`rel-loughton-dc-cancelled-v1-r1`) and superseded by active `v2` (`rel-loughton-dc-active-v2-r1`); AWS Wilmington OH court pause; Polaris Forge 1 `250 MW` of `400 MW` energised.<br>**Prior**: Uncancelled Loughton `v1` lease. | Project cancellations and contract restructurings reflect voluntary capital efficiency that reduces net aggregate capex. | **`neutral`** (`does_not_resolve`) | **Reclassified from `supports` to `neutral` (`does_not_resolve`)**. Replacing Loughton `v1` with `v2` alongside record hyperscaler capex represents contract reallocation and local permitting friction, not net capex moderation. |
| **7** | `ind-power-availability` | **Latest**: Ireland data centres at `21.0%` of national electricity (`cru-eirgrid-dc-policy-2026`), governing AWS Dublin (`350 MW`) and MSFT Grange Castle (`280 MW`).<br>**Prior**: Pre-2026 connection policy (`~18%` share). | Grid bottlenecks force hyperscalers into higher-return, lower-capex software/silicon optimisation. | **`neutral`** (`does_not_resolve`) | **Reclassified from `supports` to `neutral` (`does_not_resolve`)**. Physical grid connection queues are an external supply bottleneck that increases onsite generation and shell-holding costs rather than confirming improved capital efficiency. |
| **8** | `ind-regulatory-developments` | **Latest**: Enacted NY EO 62 (`>= 50 MW` pause) & OK HB 2992 (`>= 75 MW` tariff); 3 Nov 2026 SW Ohio municipal referenda remain **unofficial** pending `14–24 Nov 2026` statutory canvass (`Ohio Rev. Code § 3505.32`).<br>**Prior**: Pre-3 Nov 2026 municipal litigation. | Enacted moratoria and certified ballot measures demonstrably reduce 2026–2027 hyperscaler capital expenditure budgets. | **`insufficient_evidence`** (`does_not_resolve`) | **Reclassified from `supports` to `insufficient_evidence` (`does_not_resolve`)**. Local ballot returns are uncertified until `14–24 Nov 2026` and zero issuers have filed FY2027 capex guidance quantifying regulatory capex reductions. |

---

## 3. SEC EDGAR XBRL Fields Added per Stock (Part B)

All 7 universe stocks were extracted directly from official SEC EDGAR endpoints (`https://data.sec.gov/submissions/CIK{10-digit}.json` and `https://data.sec.gov/api/xbrl/companyfacts/CIK{10-digit}.json`) at **£0.00** cost and persisted in [`data/sec-xbrl/phase-g7-1-sec-xbrl-expansion.json`](file:///c:/GPT%205%20CODEX/Trading%20app/data/sec-xbrl/phase-g7-1-sec-xbrl-expansion.json). Raw XBRL facts (`rawXbrlFacts`) are stored separately from normalised USD-millions financial values (`normalisedFinancialValues`).

| Ticker | CIK | Latest Filing & Exact `acceptanceDateTime` | Latest Quarter (`3M`) Revenue / EBIT / Net Income | 4Q TTM Revenue / EBIT / Net Income | Latest Q & TTM OCF / Capex / FCF | Balance Sheet Cash+ST Inv / Debt+Leases / Net Debt / Book Equity | Weighted-Avg Diluted Shares (`3M`) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **NVDA** | `0001045810` | `10-Q` (`0001045810-26-000075`)<br>`2026-08-26T20:36:00.000Z` | Rev: `$96,221M`<br>EBIT: `$63,734M` (`66.24%`)<br>NI: `$59,688M` | Rev: `$302,970M`<br>EBIT: `$197,579M` (`65.21%`)<br>NI: `$192,880M` | **Q2**: OCF `$24,077M`, Capex `$2,677M`, FCF `$21,400M` (`$21,341M` net of PP&E principal)<br>**TTM**: OCF `$134,360M`, Capex `$7,354M`, FCF `$127,006M` | Cash+ST: `$56,586M`<br>Debt: `$33,366M`<br>Net Debt: `-$23,220M` (Net Cash)<br>Equity: `$228,984M` | `24,285M` shares |
| **MSFT** | `0000789019` | `10-Q` (`0001193125-26-436133`)<br>`2026-10-28T20:07:39.000Z` | Rev: `$92,279M`<br>EBIT: `$45,915M` (`49.76%`)<br>NI: `$36,629M` | Rev: `$343,108M`<br>EBIT: `$164,775M` (`48.02%`)<br>NI: `$128,895M` | **Q1**: OCF `$58,000M`, Capex `$39,367M`, FCF `$18,633M`<br>**TTM**: OCF `$187,960M`, Capex `$114,557M`, FCF `$73,403M` | Cash+ST: `$88,435M`<br>Debt+FinLease: `$97,853M`<br>Net Debt: `+$9,418M`<br>Equity: `$470,509M` | `7,446M` shares |
| **GOOGL** | `0001652044` | `10-Q` (`0001652044-26-000084`)<br>`2026-10-29T00:29:06.000Z` | Rev: `$127,577M` (`+24.65%` YoY)<br>EBIT: `$40,576M` (`31.81%`)<br>NI: `$26,201M` | Rev: `$474,897M`<br>EBIT: `$156,089M` (`32.87%`)<br>NI: `$116,697M` | **Q3**: OCF `$42,290M`, Capex `$51,355M`, FCF `-$9,065M`<br>**TTM**: OCF `$358,487M`, Capex `$193,428M`, FCF `+$165,059M` | Cash+ST: `$197,650M`<br>Debt: `$126,118M`<br>Net Debt: `-$71,532M` (Net Cash)<br>Equity: `$563,914M` | `12,368M` shares (Class A+B+C) |
| **AMZN** | `0001018724` | `10-Q` (`0001018724-26-000040`)<br>`2026-10-29T22:20:46.000Z` | Rev: `$201,944M` (`+12.08%` YoY)<br>EBIT: `$28,076M` (`13.90%`)<br>NI: `$21,191M` | Rev: `$797,455M`<br>EBIT: `$104,366M` (`$104,405M` Ex. 99.1)<br>NI: `$78,432M` | **Q3**: OCF `$42,422M`, Gross Capex `$77,259M` (`$75,878M` net), FCF `-$34,837M` (`-$33,456M` net)<br>**TTM**: OCF `$168,300M`, Gross Capex `$215,192M` (`$210,657M` net), FCF `-$46,892M` (`-$42,357M` net) | Cash+ST: `$118,524M`<br>Debt: `$179,952M`<br>Net Debt: `+$61,428M`<br>Equity: `$472,226M` | `10,929M` shares |
| **AMD** | `0000002488` | `10-Q` (`0000002488-26-000191`)<br>`2026-11-03T23:00:17.000Z` | Rev: `$13,377M` (`+44.68%` YoY)<br>EBIT: `$3,275M` (`24.48%`)<br>NI: `$2,690M` | Rev: `$46,668M`<br>EBIT: `$8,653M` (`18.54%`)<br>NI: `$7,611M` | **Q3**: OCF `$1,202M`, Capex `$501M`, FCF `+$701M`<br>**TTM**: OCF `$9,123M`, Capex `$2,381M`, FCF `+$6,742M` | Cash+ST: `$15,921M`<br>Debt: `$7,079M`<br>Net Debt: `-$8,842M` (Net Cash)<br>Equity: `$79,532M` | `1,661M` shares |
| **CRWV** | `0001769628` | `10-Q` (`0001769628-26-000366`)<br>`2026-08-11T23:24:42.000Z`<br>*(Q2 2026 latest; Q3 not yet filed)* | Rev: `$2,684M` (`+121.27%` YoY)<br>EBIT: `+$58M` (`2.16%`)<br>NI: `-$626M` | Rev: `$8,904M`<br>EBIT: `+$226M` (`2.54%`)<br>NI: `-$1,928M` | **Q2**: OCF `$679M`, Capex `$6,422M`, FCF `-$5,743M`<br>**TTM**: OCF `$6,911M`, Capex `$20,566M`, FCF `-$13,655M` | Cash+ST: `$5,524M`<br>Debt: `$35,551M`<br>Net Debt: `+$30,027M`<br>Equity: `$4,661M` | `551M` shares (Basic = Diluted due to GAAP net loss) |
| **INTC** | `0000050863` | `10-Q` (`0000050863-26-000191`)<br>`2026-10-29T22:50:31.000Z` | Rev: `$14,667M` (`+7.43%` YoY)<br>EBIT: `+$1,546M` (`10.54%`)<br>NI: `-$1,615M` | Rev: `$53,827M`<br>EBIT: `+$2,516M` (`4.67%`)<br>NI: `-$12,032M` | **Q3**: OCF `$5,082M`, Capex `$6,579M`, FCF `-$1,497M`<br>**TTM**: OCF `$17,472M`, Capex `$25,685M`, FCF `-$8,213M` | Cash+ST: `$36,054M`<br>Debt: `$50,134M`<br>Net Debt: `+$14,080M`<br>Equity: `$129,572M` | `5,307M` shares (`5,315M` DEI cover-page) |

---

## 4. Before-and-After Financial Data Coverage Matrix (84 Cells: 7 Stocks × 12 Categories)

Evaluated via [`summariseG71BeforeAfterCoverage()`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/research-ratings/sec-xbrl-expansion.ts):

### 4.1 Overall 84-Cell Status Summary

| Audit Status | Before G.7.1 (Phase G.7 Baseline) | After G.7.1 (SEC XBRL Expansion) | Net Change |
| --- | --- | --- | --- |
| **`verified`** | `18 / 84` (`21.4%`) | **`49 / 84` (`58.3%`)** | **`+31` verified primary cells** |
| **`missing`** | `41 / 84` (`48.8%`) | **`7 / 84` (`8.3%`)** | **`-34` missing cells eliminated** |
| **`stale`** | `5 / 84` (`6.0%`) | **`0 / 84` (`0.0%`)** | **`-5` stale cells eliminated** |
| **`unsuitable`** | `20 / 84` (`23.8%`) | **`28 / 84` (`33.3%`)** | `+8` *(14 Market Cap/EV & Current Valuation cells now computed on unadjusted reference closes; 7 Corporate Action cells + 7 Unadjusted Price cells gated until licensed split-adjusted feed is connected)* |
| **`conflicting`** | `0 / 84` (`0.0%`) | **`0 / 84` (`0.0%`)** | `0` |

### 4.2 Per-Company Verified Category Count (`Before -> After`)

| Ticker | Before Verified (`/ 12`) | After Verified (`/ 12`) | Newly Verified Categories in Phase G.7.1 | Remaining Non-Verified Categories (`5 / 12` per stock) |
| --- | --- | --- | --- | --- |
| **NVDA** | `4 / 12` | **`7 / 12`** | `debt_and_cash`, `diluted_share_counts`, `sec_filing_timestamps` *(plus multi-quarter/TTM expansion of `revenue_and_growth`, `earnings_and_operating_margins`, `ocf_and_capex`, `free_cash_flow`)* | `market_cap_and_ev` (computed on unadjusted close), `current_valuation_measures` (computed on unadjusted close), `historical_valuation_multiples`, `corporate_actions_and_distributions`, `adjusted_historical_prices` |
| **MSFT** | `4 / 12` | **`7 / 12`** | `debt_and_cash`, `diluted_share_counts`, `sec_filing_timestamps` *(plus 4Q TTM flow expansion)* | Same 5 price-adjustment-dependent categories |
| **GOOGL** | `5 / 12` | **`7 / 12`** | `debt_and_cash`, `diluted_share_counts` *(plus 4Q TTM flow expansion)* | Same 5 price-adjustment-dependent categories |
| **AMZN** | `5 / 12` | **`7 / 12`** | `debt_and_cash`, `diluted_share_counts` *(plus 16/16 staging reconciliation)* | Same 5 price-adjustment-dependent categories |
| **AMD** | `0 / 12` | **`7 / 12`** | `revenue_and_growth`, `earnings_and_operating_margins`, `ocf_and_capex`, `free_cash_flow`, `debt_and_cash`, `diluted_share_counts`, `sec_filing_timestamps` | Same 5 price-adjustment-dependent categories |
| **CRWV** | `0 / 12` | **`7 / 12`** | `revenue_and_growth`, `earnings_and_operating_margins`, `ocf_and_capex`, `free_cash_flow`, `debt_and_cash`, `diluted_share_counts`, `sec_filing_timestamps` | Same 5 price-adjustment-dependent categories |
| **INTC** | `0 / 12` | **`7 / 12`** | `revenue_and_growth`, `earnings_and_operating_margins`, `ocf_and_capex`, `free_cash_flow`, `debt_and_cash`, `diluted_share_counts`, `sec_filing_timestamps` | Same 5 price-adjustment-dependent categories |

---

## 5. Updated Non-Directional Stock Research-Priority Scores & Remaining Blockers (Part C)

Evaluated via [`evaluateUniverseResearchAssessments()`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/research-ratings/engine.ts) and [`evaluateUniverseG71ExpandedValuationLayer()`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/research-ratings/sec-xbrl-expansion.ts). All 7 stocks remain strictly locked at **`INSUFFICIENT DATA`** for directional Buy/Hold/Sell ratings.

| Rank | Ticker | Production Rating Label | Covered Weight (`Before -> After`) | Earnings & Health Score (`Dim 2`) | Non-Directional Screening Score (`Before -> After`) | Reference-Price Valuation Snapshot (`computed_unadjusted_reference_price` — Internal Screening Only) | Remaining Blockers Preventing Directional `BUY / HOLD / SELL` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **1** | **NVDA** | `INSUFFICIENT DATA` | `70% -> 70%` | `89.0` | `82.3 -> 82.3` | Ref Mkt Cap: `$4,532.6B` · Ref EV: `$4,509.3B` · Ref P/E: `23.50x` · Ref EV/Rev: `14.88x` · Ref EV/FCF: `35.50x` | Unadjusted reference price (`corporateActionsReviewed=false`); `46 < 252` backtest sessions; Tier 5 forward horizon unelapsed |
| **2** | **MSFT** | `INSUFFICIENT DATA` | `70% -> 70%` | `75.6` | `73.7 -> 73.7` | Ref Mkt Cap: `$3,670.5B` · Ref EV: `$3,679.9B` · Ref P/E: `28.48x` · Ref EV/Rev: `10.73x` · Ref EV/FCF: `50.13x` | Unadjusted reference price (`corporateActionsReviewed=false`); `46 < 252` backtest sessions; Tier 5 forward horizon unelapsed |
| **3** | **AMD** | `INSUFFICIENT DATA` | **`35% -> 70%`** | **`60.4`** | **`null -> 63.0`** | Ref Mkt Cap: `$366.8B` · Ref EV: `$358.0B` · Ref P/E: `48.19x` · Ref EV/Rev: `7.67x` · Ref EV/FCF: `53.10x` | Unadjusted reference price (`corporateActionsReviewed=false`); `46 < 252` backtest sessions; Tier 5 forward horizon unelapsed |
| **4** | **GOOGL** | `INSUFFICIENT DATA` | `70% -> 70%` | `53.4` | `61.5 -> 61.5` | Ref Mkt Cap: `$3,355.9B` · Ref EV: `$3,284.3B` · Ref P/E: `28.76x` · Ref EV/Rev: `6.92x` · Ref EV/FCF: `19.90x` | Unadjusted reference price (`corporateActionsReviewed=false`); `46 < 252` backtest sessions; Tier 5 forward horizon unelapsed |
| **5** | **AMZN** | `INSUFFICIENT DATA` | `70% -> 70%` | `49.0` | `57.7 -> 57.7` | Ref Mkt Cap: `$2,433.6B` · Ref EV: `$2,495.0B` · Ref P/E: `31.03x` · Ref EV/Rev: `3.13x` · Ref EV/FCF: `N/M (Negative FCF)` | Unadjusted reference price (`corporateActionsReviewed=false`); `46 < 252` backtest sessions; Tier 5 forward horizon unelapsed |
| **6** | **INTC** | `INSUFFICIENT DATA` | **`25% -> 50%`** | **`50.3`** | **`null -> 54.1`** | Ref Mkt Cap: `$298.7B` · Ref EV: `$312.8B` · Ref P/E: `N/M (Net Loss)` · Ref EV/Rev: `5.81x` · Ref EV/FCF: `N/M (Negative FCF)` | Missing 20D momentum bar series in `policy-risk` window; unadjusted reference price; `46 < 252` backtest sessions |
| **7** | **CRWV** | `INSUFFICIENT DATA` | **`35% -> 70%`** | **`18.0`** | **`null -> 36.1`** | Ref Mkt Cap: `$47.7B` · Ref EV: `$77.8B` · Ref P/E: `N/M (Net Loss)` · Ref EV/Rev: `8.73x` · Ref EV/FCF: `N/M (Negative FCF)` | Q3 2026 10-Q not yet filed (latest is Q2 2026 ended `2026-06-30`); unadjusted reference price; `46 < 252` backtest sessions |

---

## 6. Unresolved & Special-Handling SEC XBRL Fields Audit (Part B.5)

Every SEC XBRL tag anomaly or non-standard structure encountered during extraction is documented in `stagingVerificationAudit.unresolvedXbrlFieldsAudit`:
1. **Alphabet (`GOOGL`) Dimensionalized Cover-Page DEI Share Tag**:
   - *Issue*: Alphabet tags `dei:EntityCommonStockSharesOutstanding` across `StatementClassOfStockAxis` (`Class A`, `Class B`, `Class C`), which SEC’s `companyfacts` JSON endpoint omits.
   - *Resolution*: Resolved deterministically via consolidated `us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding` (`12,368M` shares in Q3 2026) and `us-gaap:CommonStockSharesOutstanding` (`12,294M` shares).
2. **CoreWeave (`CRWV`) Filing Lag & GAAP Anti-Dilution Boundary**:
   - *Issue*: As of `2026-11-09`, CoreWeave’s latest filed Form 10-Q in SEC EDGAR is **Q2 2026** (`0001769628-26-000366`, period ended `2026-06-30`, accepted `2026-08-11T23:24:42Z`). Additionally, because CoreWeave is GAAP loss-making (`-$626M` Q2 / `-$1,928M` TTM Net Loss), `WeightedAverageNumberOfDilutedSharesOutstanding` (`551M`) equals basic shares (`551M`) under GAAP anti-dilution rules (`24M` employee stock options are anti-dilutive).
   - *Resolution*: Explicitly flagged as `q2_2026_latest_q3_not_yet_filed` with anti-dilution note; `trailingGaapPe` and `evToTtmFcf` are suppressed as `not_meaningful_negative_earnings` / `not_meaningful_negative_fcf`.
3. **Amazon (`AMZN`) Gross XBRL Capex vs Net Capex (Proceeds/Incentives) & $39M TTM EBIT Rounding**:
   - *Issue*: SEC XBRL `us-gaap:PaymentsToAcquirePropertyPlantAndEquipment` reports **Gross** cash capex (`$77,259M` in Q3 2026; `$215,192M` TTM), whereas Amazon’s Exhibit 99.1 Free Cash Flow bridge deducts `$1,381M` Q3 (`$4,535M` TTM) of property and equipment incentives/proceeds (`$75,878M` Q3 net capex; `$210,657M` TTM net capex). Additionally, the 9M + FY25 − 9M25 XBRL Operating Income bridge yields `$104,366M` vs `$104,405M` sum of four quarterly earnings releases (`$39M` / `0.037%` difference).
   - *Resolution*: Both Gross XBRL Capex (`$77,259M` Q3 / `$215,192M` TTM) and Net Capex (`$75,878M` Q3 / `$210,657M` TTM) are preserved and reconciled `100%` in `stagingVerificationAudit`.
4. **Split-Adjusted Historical Equity Prices & Multi-Year Valuation Multiple Percentiles (`ALL_7_STOCKS`)**:
   - *Issue*: SEC EDGAR XBRL provides primary financial statements, balance sheets, share counts, and filing timestamps, but does not provide daily split/dividend-adjusted equity prices (`adjClose`, `splitFactor`, `divCash`).
   - *Resolution*: All price-dependent valuation ratios remain classified as `computed_unadjusted_reference_price` (`allValuationMultiplesResolved: false`) until a licensed split-adjusted EOD feed (e.g. Tiingo Commercial at `~$30–$50/mo`) is connected.

---

## 7. Convex Scheduled Cloud Collection & Live Gemini Verification (Part A.7 & Part D)

### 7.1 Convex Production Scheduled Cycle (`remoteOpsCloud:runScheduledCloudCycle`)
- Updated `CLOUD_SEC_TICKERS` in [`convex/remoteOpsCloud.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/convex/remoteOpsCloud.ts) to include all 7 universe stocks (`['NVDA', 'MSFT', 'AMZN', 'GOOGL', 'INTC', 'AMD', 'CRWV']`).
- Deployed to `https://benevolent-magpie-921.eu-west-1.convex.cloud` and executed `npx convex run remoteOpsCloud:runScheduledCloudCycle '{"forceOnDemand":true,"jobs":["sec_filings_collect","portfolio_risk_refresh"]}' --prod`:
  - `sec_filings_collect`: Verified all 7 official SEC EDGAR submission headers (`AMD:10-Q:0000002488-26-000191`, `AMZN:10-Q:0001018724-26-000040`, `CRWV:10-Q:0001769628-26-000366`, `GOOGL:10-Q:0001652044-26-000084`, `INTC:10-Q:0000050863-26-000191`, `MSFT:10-Q:0001193125-26-436133`, `NVDA:10-Q:0001045810-26-000075`).
  - `portfolio_risk_refresh`: Evaluated `aci-thesis-monitor-v2.1.0` (`1S/4C/2N/1I = 8`, `sumEqualsTotalIndicators: true`, `zeroDuplicateIndicatorIds: true`, `executionAuthority: "none"`).

### 7.2 Live Authenticated Gemini 2.5 Flash Inference Against Corrected v2.1.0 Evidence Bundle
- See Section 6 of [`docs/ai-capex-moderation-thesis-monitor.md`](file:///c:/GPT%205%20CODEX/Trading%20app/docs/ai-capex-moderation-thesis-monitor.md) for the live authenticated `POST https://capital.aiguides.co.uk/api/graph/chat` (`mode: "gemini_live_required"`) telemetry and 9/9 validator verification.

---

## 8. Test Suite & Production Browser Acceptance Summary (Part E)

- **TypeScript (`npm run typecheck`)**: `0` errors across all application, library, Convex, and test modules.
- **Automated Test Suite (`npx vitest run`)**: **`53 / 53` test files passed (`496 / 496` tests passing)**, including:
  - [`tests/ai-capex-moderation-thesis-monitor.test.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/tests/ai-capex-moderation-thesis-monitor.test.ts) (`8/8` passed)
  - [`tests/phase-g7-financial-data-and-valuation.test.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/tests/phase-g7-financial-data-and-valuation.test.ts) (`8/8` passed, including Stage 7 G.7.1 SEC XBRL verification)
  - [`tests/phase-g6-research-ratings.test.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/tests/phase-g6-research-ratings.test.ts) (`7/7` passed)
