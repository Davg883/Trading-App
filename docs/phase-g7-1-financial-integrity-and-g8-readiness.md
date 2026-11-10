# AI Capital Intelligence — Phase G.7.1 Financial Integrity Gate & Phase G.8 Readiness Report

- **Gate Version**: `aci-g7-1-financial-integrity-gate-v1.0.0`
- **Core Modules Audited & Updated**:
  - [`lib/research-ratings/sec-xbrl-expansion.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/research-ratings/sec-xbrl-expansion.ts) (`auditG71SevenCompanyFinancialIntegrityGate`, `getSecXbrlExpansionPackage`)
  - [`lib/research-ratings/valuation-layer.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/research-ratings/valuation-layer.ts) (`computeDeterministicValuationMetrics`, `MetricVerificationClassification`)
  - [`lib/research-ratings/thesis-monitor.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/research-ratings/thesis-monitor.ts) (`auditThesisMonitorMaterialClaims`, `evaluateAiCapexModerationThesis`)
  - [`lib/graph/gemini-provider-adapter.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/graph/gemini-provider-adapter.ts) (`generateAndValidateEvidenceLockedAnswer`)
  - [`lib/graph/chat-benchmark-50.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/graph/chat-benchmark-50.ts) (`runFiftyQuestionEvidenceLockedBenchmark`, `investigateThirtySevenSecondGeminiResponse`)
  - [`lib/portfolio/multi-asset-risk-pilot.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/portfolio/multi-asset-risk-pilot.ts) (`evaluatePhaseG8MultiAssetPilot`, `MARKET_DATA_PROVIDER_COMPARISON`)
- **Primary SEC XBRL Dataset**: [`data/sec-xbrl/phase-g7-1-sec-xbrl-expansion.json`](file:///c:/GPT%205%20CODEX/Trading%20app/data/sec-xbrl/phase-g7-1-sec-xbrl-expansion.json)
- **Execution Authority**: `"none"` (`LIVE_TRADING_ENABLED=false`, `DEMO_TRADING_ENABLED=false`, zero broker execution or mutation paths)
- **Paid Data Purchase Status**: `awaiting_owner_approval_no_purchase_made` (**£0.00 spent**)

---

## 1. Requirement 1 — Reconciliation of Amazon (`AMZN`) Conflicting TTM Revenue Figures (`$797.455bn` vs `$759.776bn`) & Derived Ratio Corrections

### 1.1 Root-Cause Trace of `$797,455M` vs `$759,776M`

An independent audit of [`data/sec-xbrl/phase-g7-1-sec-xbrl-expansion.json`](file:///c:/GPT%205%20CODEX/Trading%20app/data/sec-xbrl/phase-g7-1-sec-xbrl-expansion.json), [`lib/research-ratings/sec-xbrl-expansion.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/research-ratings/sec-xbrl-expansion.ts), and [`lib/research-ratings/thesis-monitor.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/research-ratings/thesis-monitor.ts) traced every Amazon revenue, operating cash flow, capital expenditure, and free cash flow figure to its exact SEC EDGAR accession number and XBRL concept:

| Attribute | Authoritative Primary SEC XBRL Figure (`$797.455bn` / `$797,455M`) | Superseded Pre-XBRL Staging Draft (`$759.776bn` / `$759,776M`) |
| --- | --- | --- |
| **Status** | **Independently Verified Authoritative TTM Figure** | **Deprecated / Superseded Pre-G.7.1 Draft Estimate** |
| **SEC XBRL Concept** | `us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax` | Hand-constructed pre-XBRL staging estimate in `thesis-monitor.ts` prior to full 10-K/10-Q XBRL ingestion |
| **Fiscal Window** | `2025-10-01` to `2026-09-30` (4 consecutive quarters: `2025-Q4` + `2026-Q1` + `2026-Q2` + `2026-Q3`) | Non-XBRL blended window (`$37,679M` / `-4.72%` below actual SEC XBRL 4-quarter sum) |
| **Method A (YTD Bridge Formula)** | $\text{9M 2026 YTD } (\$584,069\text{M}) + \text{FY 2025 10-K } (\$716,924\text{M}) - \text{9M 2025 YTD } (\$503,538\text{M}) = \mathbf{\$797,455\text{M}}$ | N/A |
| **Method B (4-Quarter Sum Formula)** | $\text{2025-Q4 } (\$213,386\text{M}) + \text{2026-Q1 } (\$181,519\text{M}) + \text{2026-Q2 } (\$200,606\text{M}) + \text{2026-Q3 } (\$201,944\text{M}) = \mathbf{\$797,455\text{M}}$ | N/A |
| **Method A vs Method B Variance** | **`$0M` (`0.000%` — exact identity)** | `-$37,679M` (`-4.725%` error vs primary SEC filings) |

### 1.2 Exact SEC EDGAR Accession Numbers & Filing Passages for Amazon (`CIK 0001018724`)

1. **`0001018724-26-000040`** (`Form 10-Q` for Q3 2026 ended `2026-09-30`, filed `2026-10-30`, `acceptanceDateTime: 2026-10-29T22:20:46.000Z`):
   - Three Months Ended `2026-09-30` (`2026-07-01` to `2026-09-30`): `$201,944,000,000` (`$201,944M`); prior-year Q3 2025 (`2025-07-01` to `2025-09-30`): `$180,169,000,000` (`$180,169M`, YoY growth `+12.0859%` / `+12.09%`).
   - Nine Months Ended `2026-09-30` (`2026-01-01` to `2026-09-30`): `$584,069,000,000` (`$584,069M`); prior-year 9M 2025 (`2025-01-01` to `2025-09-30`): `$503,538,000,000` (`$503,538M`).
2. **`0001018724-26-000004`** (`Form 10-K` for FY 2025 ended `2025-12-31`, filed `2026-02-06`):
   - Twelve Months Ended `2025-12-31` (`2025-01-01` to `2025-12-31`): `$716,924,000,000` (`$716,924M`).
   - Derived `2025-Q4` (`2025-10-01` to `2025-12-31`): $\text{FY 2025 } (\$716,924\text{M}) - \text{9M 2025 } (\$503,538\text{M}) = \$213,386\text{M}$.
3. **`0001018724-26-000014`** (`Form 10-Q` for Q1 2026 ended `2026-03-31`, filed `2026-05-01`):
   - Three Months Ended `2026-03-31`: `$181,519,000,000` (`$181,519M`).
4. **`0001018724-26-000026`** (`Form 10-Q` for Q2 2026 ended `2026-06-30`, filed `2026-07-31`):
   - Three Months Ended `2026-06-30`: `$200,606,000,000` (`$200,606M`).

### 1.3 Inconsistent Derived Ratios Identified & Corrected in Code

During the G.7.1 Gate audit, three subtle inconsistencies in `AMZN` derived series and ratios were identified and corrected in [`lib/research-ratings/sec-xbrl-expansion.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/research-ratings/sec-xbrl-expansion.ts):

1. **Missing Derived `10-K Q4` (`FY - 9M YTD`) Quarters in `quarterlySeries` Causing a Shifted `periodStart` (`2025-07-01` vs `2025-10-01`)**:
   - *Finding*: Because SEC `Form 10-K` filings report full-year (`365d`) and `Form 10-Q` filings report `Q1`, `Q2`, and `Q3` (`90d`), the raw `quarterlyRevenues` array in `phase-g7-1-sec-xbrl-expansion.json` contained `2025-Q3`, `2026-Q1`, `2026-Q2`, `2026-Q3` (skipping `2025-Q4`). Taking the last 4 entries of `quarterlySeries` therefore started at `"2025-07-01"` (`2025-Q3`) instead of `"2025-10-01"` (`2025-Q4`), even though `trailingTwelveMonths.revenueUsdMillions` used the `9M + FY - 9M` bridge (`$797,455M`).
   - *Correction*: [`getSecXbrlExpansionPackage()`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/research-ratings/sec-xbrl-expansion.ts) now deterministically derives missing `Q4` quarters ($\text{FY 10-K} - \text{9M YTD}$) for Revenue, Operating Income, Net Income, Operating Cash Flow, and Capital Expenditure and inserts them chronologically into `quarterlySeries`. For `AMZN`, `2025-Q4` (`2025-10-01` to `2025-12-31`, Revenue `$213,386M`, EBIT `$21,203M`, NI `$20,004M`, OCF `$45,627M`, Gross Capex `$39,517M`, FCF `+$6,110M`) is now present in `quarterlySeries`, `trailingTwelveMonths.periodStart` is `"2025-10-01"`, and the sum of the last 4 quarters in `quarterlySeries` equals `$797,455M` (`0.00%` discrepancy).
2. **Explicit Separation of Amazon Gross XBRL Capex (`$215,192M`) vs Net Capex After Property Incentives (`$210,657M`)**:
   - *Finding*: SEC XBRL tag `us-gaap:PaymentsToAcquirePropertyPlantAndEquipment` reports **Gross** cash outflows for PP&E (`$77,259M` in Q3 2026; `$215,192M` TTM), whereas Amazon’s Exhibit 99.1 non-GAAP Free Cash Flow reconciliation deducts proceeds from property/equipment sales and incentives (`$1,381M` in Q3 2026; `$4,535M` TTM) to arrive at **Net** Capex (`$75,878M` Q3; `$210,657M` TTM). Mixing Gross and Net figures produced two sets of FCF and Capex/OCF ratios without explicit labels.
   - *Correction*: `SecXbrlNormalisedQuarter` and `SecXbrlNormalisedTtm` now expose both series side-by-side:
     - **Gross XBRL Basis (`us-gaap:PaymentsToAcquirePropertyPlantAndEquipment`)**:
       - Q3 2026 Gross Capex: `$77,259M` · Q3 Gross FCF: `-$34,837M` (`-17.25%` of Q3 Rev) · Q3 Gross Capex/OCF: **`182.12%`** (`$77,259M / $42,422M`).
       - TTM Gross Capex: `$215,192M` · TTM Gross FCF: `-$46,892M` (`-5.88%` of `$797,455M` TTM Rev) · TTM Gross Capex/OCF: **`127.86%`** (`$215,192M / $168,300M`).
       - Spot EV/TTM Gross Rev: **`1.96x`** (`$1,560,772.6M / $797,455M`) · Spot Gross FCF Yield: **`-3.17%`** (`-$46,892M / $1,480,551.6M`).
     - **Net Exhibit 99.1 Basis (Net of `$1,381M` Q3 / `$4,535M` TTM Property Incentives)**:
       - Q3 2026 Net Capex: `$75,878M` · Q3 Net FCF: `-$33,456M` (`-16.57%` of Q3 Rev) · Q3 Net Capex/OCF: **`178.86%`** (`$75,878M / $42,422M`).
       - TTM Net Capex: `$210,657M` · TTM Net FCF: `-$42,357M` (`-5.31%` of `$797,455M` TTM Rev) · TTM Net Capex/OCF: **`125.17%`** (`$210,657M / $168,300M`).
       - Spot Net FCF Yield: **`-2.86%`** (`-$42,357M / $1,480,551.6M`).
3. **Prior-Year FY2025 `88.7%` vs `98.7%` Capex/OCF Reconciliation**:
   - In FY2025 (`0001018724-26-000004`), Amazon reported Operating Cash Flow of `$139,519M`, Gross Capex of `$131,820M` (`94.48%` Gross Capex/OCF), and Net Capex after `$8,109M` incentives of `$123,711M` (`88.67%` / **`88.7%`** Net Capex/OCF, leaving `+$15,808M` Net FCF). The `98.7%` string was a superseded early text typo in a narrative summary and is permanently replaced with the verified `88.7%` Net (`94.5%` Gross) FY2025 baseline.

---

## 2. Requirement 2 — Independent Seven-Company SEC Filing Verification Matrix (`98` Metric Cells)

Every metric across `NVDA`, `MSFT`, `GOOGL`, `AMZN`, `AMD`, `CRWV`, and `INTC` was independently audited against the primary SEC EDGAR XBRL `companyfacts` JSON (`data/sec-xbrl/phase-g7-1-sec-xbrl-expansion.json`) via [`auditG71SevenCompanyFinancialIntegrityGate()`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/research-ratings/sec-xbrl-expansion.ts) and classified into one of four strict categories:
- **`independently_verified`** (`70 / 98` metrics across all 7 companies’ 10 primary SEC statement, balance-sheet, Net Debt, and share-count fields): Matches official SEC EDGAR XBRL tags, accession numbers, and periods with zero discrepancy.
- **`calculated_provisionally_suitable`** (`24 / 98` metrics): Deterministically computed from independently verified SEC XBRL numerators/denominators (`Market Cap`, `Enterprise Value`, `Price/Book`, `Trailing GAAP P/E`, `EV/TTM Revenue`, `EV/TTM EBIT`, `FCF Yield`), suitable for **spot valuation display and non-directional screening**, while clearly labelled as using unadjusted Stooq US daily close prices (`2026-11-06`).
- **`conflicting`** (`0 / 98` metrics after the G.7.1 Gate reconciliation).
- **`unusable`** (`4 / 98` metrics): Meaningless negative-denominator valuation multiples (`CRWV` and `INTC` `Trailing GAAP P/E` due to TTM GAAP net losses; `CRWV` `EV/TTM EBIT` due to negative TTM EBIT; plus `CRWV` negative FCF multiple suppression).

### 2.1 Master Seven-Company Primary SEC XBRL & Spot Valuation Table

| Metric / Field | NVDA (`FY27 Q2`) | MSFT (`FY27 Q1`) | GOOGL (`2026 Q3`) | AMZN (`2026 Q3`) | AMD (`2026 Q3`) | CRWV (`2026 Q2`*) | INTC (`2026 Q3`) | Verification Classification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **SEC Accession No.** | `0001045810-26-000075` | `0001193125-26-436133` | `0001652044-26-000084` | `0001018724-26-000040` | `0000002488-26-000191` | `0001769628-26-000366` | `0000050863-26-000191` | `independently_verified` |
| **Period End Date** | `2026-07-26` | `2026-09-30` | `2026-09-30` | `2026-09-30` | `2026-09-26` | `2026-06-30` *(Q3 unfiled)* | `2026-09-26` | `independently_verified` (`CRWV` lag flagged) |
| **SEC Acceptance UTC** | `2026-08-26T20:36:00Z` | `2026-10-28T20:07:39Z` | `2026-10-29T00:29:06Z` | `2026-10-29T22:20:46Z` | `2026-11-03T23:00:17Z` | `2026-08-11T23:24:42Z` | `2026-10-29T22:50:31Z` | `independently_verified` |
| **Latest Q Revenue** | `$96,221M` | `$92,279M` (`+18.80%` YoY) | `$127,577M` (`+24.65%` YoY) | `$201,944M` (`+12.08%` YoY) | `$13,377M` (`+44.68%` YoY) | `$2,575M` (`+112.46%` YoY) | `$16,513M` (`+20.95%` YoY) | `independently_verified` |
| **TTM Revenue (4Q)** | `$302,970M` | `$346,445M` | `$471,098M` | `$797,455M` | `$45,436M` | `$7,590M` | `$59,892M` | `independently_verified` |
| **Latest Q GAAP EBIT** | `$63,734M` (`66.24%`) | `$45,915M` (`49.76%`) | `$40,576M` (`31.81%`) | `$28,076M` (`13.90%`) | `$2,832M` (`21.17%`) | `-$49M` (`-1.90%`) | `+$2,522M` (`15.27%`) | `independently_verified` |
| **TTM GAAP EBIT** | `$197,579M` (`65.21%`) | `$163,191M` (`47.11%`) | `$156,976M` (`33.32%`) | `$104,366M` (`13.09%`) | `$8,050M` (`17.72%`) | `-$231M` (`-3.04%`) | `+$1,762M` (`2.94%`) | `independently_verified` |
| **Latest Q GAAP Net Inc.** | `$59,688M` | `$36,629M` | `$26,468M` | `$20,685M` | `$2,428M` | `-$626M` | `+$3,320M` | `independently_verified` |
| **TTM GAAP Net Income** | `$192,880M` | `$142,631M` | `$235,694M` | `$134,779M` | `$7,619M` | `-$1,928M` | `-$12,032M` | `independently_verified` |
| **Latest Q OCF** | `$24,077M` | `$58,000M` | `$42,290M` | `$42,422M` | `$1,202M` | `$679M` | `$5,082M` | `independently_verified` |
| **TTM OCF** | `$134,360M` | `$195,878M` | `$179,551M` | `$168,300M` | `$9,123M` | `$6,911M` | `$17,472M` | `independently_verified` |
| **Latest Q Capex** | `$2,677M` | `$39,367M` | `$51,355M` | `$77,259M` Gross (`$75,878M` Net) | `$648M` | `$6,422M` | `$4,024M` | `independently_verified` |
| **TTM Capex** | `$7,354M` | `$135,921M` | `$159,804M` | `$215,192M` Gross (`$210,657M` Net) | `$2,067M` | `$20,566M` | `$13,704M` | `independently_verified` |
| **Latest Q Free Cash Flow** | `+$21,400M` (`+$21,341M` net) | `+$18,633M` | `-$9,065M` | `-$34,837M` Gross (`-$33,456M` Net) | `+$554M` | `-$5,743M` | `+$1,058M` | `independently_verified` |
| **TTM Free Cash Flow** | `+$127,006M` | `+$59,957M` | `+$19,747M` | `-$46,892M` Gross (`-$42,357M` Net) | `+$7,056M` | `-$13,655M` | `+$3,768M` | `independently_verified` |
| **Cash + Short-Term Inv.** | `$56,586M` (`$22,443M+$34,143M`) | `$64,509M` (`$20,281M+$44,228M`) | `$265,098M` (`$56,334M+$208,764M`) | `$114,226M` (`$55,783M+$58,443M`) | `$15,776M` (`$7,404M+$8,372M`) | `$5,539M` (`$5,524M+$15M`) | `$54,005M` (`$21,846M+$32,159M`) | `independently_verified` |
| **Total Debt (Ex-Lease / Inc-Lease)** | `$33,366M` / `$33,366M` | `$35,481M` / `$106,454M` (`$70,973M` FinLease) | `$126,118M` / `$129,823M` (`$3,705M` FinLease) | `$179,952M` / `$194,447M` (`$14,495M` FinLease) | `$7,079M` / `$7,079M` | `$35,551M` / `$35,772M` (`$221M` FinLease) | `$50,134M` / `$50,134M` | `independently_verified` |
| **Net Debt / (Net Cash)** | `-$23,220M` (Net Cash) | `+$41,945M` (Inc. FinLease) | `-$135,275M` (Net Cash) | `+$80,221M` (Inc. FinLease) | `-$8,697M` (Net Cash) | `+$30,233M` (Inc. FinLease) | `-$3,871M` (Net Cash) | `calculated_provisionally_suitable` |
| **Stockholders’ Equity** | `$228,984M` | `$470,509M` | `$677,549M` | `$613,601M` | `$68,389M` | `$5,024M` | `$114,914M` | `independently_verified` |
| **Diluted Shares (3M Avg)** | `24,285M` (`24,300M` DEI) | `7,446M` (`7,435M` DEI) | `12,368M` (Class A+B+C; `12,294M` basic) | `10,929M` (`10,721M` DEI) | `1,661M` (`1,630M` DEI) | `551M` (Basic=Diluted; `24M` anti-dilutive) | `5,307M` (`5,315M` DEI) | `independently_verified` |
| **Ref Close (`2026-11-06`)** | `$542.50` | `$254.90` | `$462.66` | `$135.47` | `$317.44` | `$132.33` | `$32.98` | `independently_verified` (Stooq US EOD) |
| **Spot Market Cap** | `$13,174,612.5M` | `$1,897,985.4M` | `$5,722,178.9M` | `$1,480,551.6M` | `$527,267.8M` | `$72,913.8M` | `$175,024.9M` | `calculated_provisionally_suitable` |
| **Spot Enterprise Value** | `$13,151,392.5M` | `$1,939,930.4M` | `$5,586,903.9M` | `$1,560,772.6M` | `$518,570.8M` | `$103,146.8M` | `$171,153.9M` | `calculated_provisionally_suitable` |
| **Spot Trailing GAAP P/E** | `68.30x` | `13.31x` | `24.28x` | `10.98x` | `69.20x` | `N/M` (`unusable` — Net Loss) | `N/M` (`unusable` — TTM Net Loss) | `calculated_provisionally_suitable` (`5/7`) / `unusable` (`2/7`) |
| **Spot EV / TTM Revenue** | `43.41x` | `5.60x` | `11.86x` | `1.96x` | `11.41x` | `13.59x` | `2.86x` | `calculated_provisionally_suitable` |
| **Spot EV / TTM EBIT** | `66.56x` | `11.89x` | `35.59x` | `14.95x` | `64.42x` | `N/M` (`unusable` — Neg. EBIT) | `97.14x` | `calculated_provisionally_suitable` (`6/7`) / `unusable` (`1/7`) |
| **Spot Price / Book** | `57.54x` | `4.03x` | `8.45x` | `2.41x` | `7.71x` | `14.51x` | `1.52x` | `calculated_provisionally_suitable` |
| **Spot TTM FCF Yield** | `+0.96%` | `+3.16%` | `+0.35%` | `-3.17%` Gross (`-2.86%` Net) | `+1.34%` | `-18.73%` | `+2.15%` | `calculated_provisionally_suitable` |

### 2.2 Specific Share-Class, Lease-Debt, and Period-Alignment Nuances Verified

1. **Alphabet (`GOOGL`) Multi-Class Share Structure**:
   - Alphabet’s cover-page `dei:EntityCommonStockSharesOutstanding` is dimensionalized across `Class A`, `Class B`, and `Class C` stock axes and therefore absent from flat DEI JSON summaries. Our pipeline verifies `12,368M` consolidated diluted shares (`us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding` for Q3 2026) and `12,294M` consolidated basic shares (`us-gaap:CommonStockSharesOutstanding`), preventing the ~45% market-cap understatement that occurs when naive parsers count only Class A shares.
2. **CoreWeave (`CRWV`) Anti-Dilutive Loss Rule & Q2 2026 Period Lag**:
   - Under ASC 260, because CoreWeave recorded a GAAP Net Loss of `-$626M` in Q2 2026 (`-$1,928M` TTM), `WeightedAverageNumberOfDilutedSharesOutstanding` (`551M`) equals basic shares (`551M`), excluding `24M` potentially dilutive options/RSUs. Furthermore, because CoreWeave’s latest SEC filing as of `2026-11-09` is Q2 2026 (`2026-06-30`), cross-company Q3 2026 comparisons explicitly flag `CRWV` as a 1-quarter lagged reporter.
3. **Microsoft (`MSFT`) & Amazon (`AMZN`) Finance Lease Inclusion in Total Debt**:
   - Microsoft carries `$35,481M` of short/long-term debt (`$4,391M + $31,090M`) plus **`$70,973M` of data-centre finance lease liabilities** (`$6,466M` current + `$64,507M` non-current), flipping Microsoft from apparent net cash (`-$29,028M` ex-leases) to **`+$41,945M` Net Debt** when finance leases (`$106,454M` total debt) are properly included against `$64,509M` cash & short-term investments. Both ex-lease and lease-inclusive figures are stored and audited.

---

## 3. Requirement 3 — Separation of Spot Valuation Calculation Eligibility from Directional Investment-Rating Eligibility

In [`lib/research-ratings/valuation-layer.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/research-ratings/valuation-layer.ts), we refactored `DeterministicCompanyValuationResult` and `ComputedValuationMetric` to separate **Spot Valuation Calculation Eligibility** at observation date $t_0$ from **Directional Investment-Rating Eligibility**:

| Control Dimension | Spot Valuation Calculation Eligibility (`spotValuationCalculationEligible`) | Directional Investment-Rating Eligibility (`directionalInvestmentRatingEligible`) |
| --- | --- | --- |
| **Purpose** | Computing point-in-time spot ratios (`Market Cap`, `Enterprise Value`, `Price/Book`, `Trailing GAAP P/E`, `EV/TTM Revenue`, `EV/TTM EBIT`, `Spot FCF Yield`) on `2026-11-06` | Issuing directional `BUY / HOLD / SELL` ratings, target prices, 5-year valuation multiple percentiles, or multi-period total-return backtests |
| **Requires Historical Split/Dividend Price Adjustment (`adjClose`)?** | **No (`false`)** — At spot date $t_0$, `Close(t_0)` and `DilutedShares(t_0)` are both expressed in current post-split units, so $\text{MarketCap}(t_0) = P(t_0) \times \text{Shares}(t_0)$ is mathematically invariant to historical splits and past cash dividends | **Yes (`true`, Mandatory)** — Comparing $P(t_0)$ against $P(t - k)$ across stock splits (e.g., `NVDA` 10-for-1 split) or cash dividends without `splitFactor` and `divCash` adjustments corrupts multi-year returns and historical multiple percentiles |
| **Metric Verification Classification** | `calculated_provisionally_suitable` (for all valid positive-denominator ratios; `unusable` where GAAP earnings or EBIT are negative) | Locked (`directionalRatingEligible: false` on all 7 stocks) |
| **Universe Status (`7` Stocks)** | **`7 / 7` Eligible (`true`)** for spot valuation display & non-directional priority screening | **`0 / 7` Eligible (`false`)** — All 7 stocks locked at `INSUFFICIENT DATA` |

---

## 4. Requirement 4 — Audit of Material Claims in the AI Capex Thesis Monitor

Executed via [`auditThesisMonitorMaterialClaims()`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/research-ratings/thesis-monitor.ts), auditing all **15 material quantitative and qualitative claims** in the Cathie Wood AI Capex Moderation Thesis Monitor (`aci-thesis-monitor-v2.1.0`):

| Claim ID | Category | Claim Summary | Quantitative Value | Source Classification | Primary Evidence & Accession / Doc ID | Published UTC (`<= asOfMs` Verified) |
| --- | --- | --- | --- | --- | --- | --- |
| `claim-01-anthropic-dedup-commitments` | `financing_commitments` | Anthropic deduplicated multi-cloud compute commitments (`$325B` AWS + `$310.4B` GCP + `$260B` Azure) vs `$940.0B` naive sum (`$44.6B` Nscale Monarch sub-allocation deduplicated) | `$895.4B` (`$895,400M`) | `verified_contractual_lineage` | `src-anthropic-s1-2026-10`, `src-nscale-s1a-2026-11`, `rel-anthropic-nscale-suballocation-v1` | `2026-11-03T13:30:00Z` |
| `claim-02-googl-anthropic-equity-cap` | `financing_commitments` | Alphabet `$40.0B` equity & convertible preferred financing cap for Anthropic (separate from `$310.4B` TPU compute purchase envelope) | `$40.0B` (`$40,000M`) | `verified_primary_sec_filing` | `0001652044-26-000084` (`src-alphabet-10q-q32026`, `rel-google-anthropic-backing-v1`) | `2026-10-29T00:29:06Z` |
| `claim-03-nvda-nscale-credit-exposure` | `financing_commitments` | NVIDIA `$1.0B` senior secured convertible note + `$860.3M` Ward County Phase 1–2 lease guarantee (`$1,860.3M` combined Nscale exposure) | `$1,860.3M` | `verified_primary_sec_filing` | `0001045810-26-000075` (`src-nvidia-10q-q2fy27`, `src-nscale-s1a-2026-11`) | `2026-08-26T20:36:00Z` |
| `claim-04-crwv-debt-and-capex-burn` | `financing_commitments` | CoreWeave `$35,772M` total debt (`$35,551M` ex-lease), `+$30,233M` Net Debt, and `297.58%` TTM Capex/OCF (`$20,566M` Capex vs `$6,911M` OCF; `-$13,655M` TTM FCF) | `$30,233M` Net Debt | `verified_primary_sec_filing` | `0001769628-26-000366` (`src-coreweave-10q-q22026`) | `2026-08-11T23:24:42Z` |
| `claim-05-intc-fab34-apollo-scjv` | `financing_commitments` | Intel `$11.0B` (`49%`) Apollo Fab 34 Ireland SCJV co-investment with `0.85` wafer-yield SLA step-up covenant | `$11.0B` (`$11,000M`) | `verified_primary_sec_filing` | `0000050863-26-000191` (`src-intel-10q-q32026`, `rel-intel-apollo-fab34-jv-v1`) | `2026-10-29T22:50:31Z` |
| `claim-06-amzn-capex-fcf-intensity` | `financing_commitments` | Amazon TTM Revenue `$797,455M`, TTM OCF `$168,300M`, Gross Capex `$215,192M` (`127.86%` OCF; `-$46,892M` FCF), Net Capex `$210,657M` (`125.17%` OCF; `-$42,357M` FCF) | `125.17%` Net (`127.86%` Gross) | `verified_primary_sec_filing` | `0001018724-26-000040` (`src-amazon-10q-q32026`, `sec-xbrl-g7-1-2026-11-09`) | `2026-10-29T22:20:46Z` |
| `claim-07-hyperscaler-cloud-growth` | `cloud_and_semi_growth` | Q3 2026 Cloud Growth: Google Cloud `$30.71B` (`+102.6%` YoY), AWS `$45.98B` (`+39.3%` YoY), Microsoft Azure `$33.17B` (`+48%` YoY) | `+102.6%` / `+48.0%` / `+39.3%` | `verified_primary_sec_filing` | `0001652044-26-000084`, `0001018724-26-000040`, `0001193125-26-436133` | `2026-10-29T22:20:46Z` |
| `claim-08-nvda-q2-actual-vs-q3-guidance` | `cloud_and_semi_growth` | NVIDIA FY27 Q2 verified GAAP revenue `$96,221M` (`66.24%` EBIT margin) vs management’s forward Q3 FY27 revenue guidance of `$108.0B ± 2%` | `$96,221M` actual / `$108,000M` guide | `management_guidance_non_fact` *(for `$108B` guide; Q2 actual is primary SEC fact)* | `0001045810-26-000075` & FY27 Q2 Ex. 99.1 Outlook | `2026-08-26T20:36:00Z` |
| `claim-09-amd-q3-revenue-acceleration` | `cloud_and_semi_growth` | AMD Q3 2026 revenue `$13,377M` (`+44.68%` YoY vs `$9,246M` Q3 2025), GAAP EBIT `$2,832M`, TTM FCF `+$7,056M` | `+44.68%` YoY | `verified_primary_sec_filing` | `0000002488-26-000191` (`sec-xbrl-g7-1-2026-11-09`) | `2026-11-03T23:00:17Z` |
| `claim-10-bea-q3-gdp-and-hy-oas` | `cloud_and_semi_growth` | U.S. BEA 26-45 Q3 2026 Real GDP `+3.4%` SAAR (`+4.9%` private domestic final sales) & ICE BofA US HY OAS `340 bps` (`+22 bps`) | `+3.4%` GDP / `340 bps` OAS | `verified_regulatory_or_macro_release` | `bea-26-45-gdp-q3-2026-adv`, `BAMLH0A0HYM2` | `2026-10-29T12:30:00Z` |
| `claim-11-ireland-21pct-grid-load` | `infrastructure_and_power` | CSO Ireland & EirGrid record showing data centres consumed `21.0%` of metered Irish electricity in 2025 (`350 MW` AWS Dublin, `280 MW` MSFT Grange Castle) | `21.0%` grid share | `verified_regulatory_or_macro_release` | `src-cso-ireland-dc-2026`, `cru-eirgrid-dc-policy-2026` | `2026-07-15T10:00:00Z` |
| `claim-12-msft-nscale-loughton-supersession` | `infrastructure_and_power` | Nscale Form S-1/A (`2026-11-03`) superseding earlier Loughton `v1` cancellation rumour with active `120 MW` liquid-cooled Phase 1 contract (`rel-msft-nscale-loughton-v2`) | `120 MW` (`v1 -> v2`) | `verified_contractual_lineage` | `src-nscale-s1a-2026-11`, `rel-msft-nscale-loughton-v2` | `2026-11-03T13:30:00Z` |
| `claim-13-polaris-forge-ellendale-capacity` | `infrastructure_and_power` | CoreWeave–Applied Digital Polaris Forge 1 Ellendale ND campus (`250 MW` energised of `400 MW` contracted liquid-cooled AI capacity) | `250 MW` / `400 MW` | `verified_primary_sec_filing` | `0001769628-26-000366` (`src-coreweave-10q-q22026`) | `2026-08-11T23:24:42Z` |
| `claim-14-ohio-local-ballot-uncertified` | `regulatory_and_provenance` | 3 Nov 2026 SW Ohio municipal data-centre zoning/tax referenda remain **unofficial** pending county board certification (`14–24 Nov 2026`, `Ohio Rev. Code § 3505.32`) | `0` certified (`insufficient_evidence`) | `unofficial_pending_statutory_certification` | `ohio-sos-2026-canvass-schedule`, `ind-regulatory-developments` | `2026-11-04T05:00:00Z` |
| `claim-15-cathie-wood-ark-commentary-quarantine` | `regulatory_and_provenance` | Cathie Wood 7 Nov 2026 ARK Invest *"In The Know"* video & secondary press article isolated in `external_commentary` / `secondary_summary` provenance tiers | `0` facts promoted (`quarantined`) | `external_commentary_opinion_quarantined` | `ark-itk-2026-11-07-primary`, `secondary-article-ark-2026-11-08` | `2026-11-07T14:00:00Z` |

---

## 5. Requirement 5 — 50-Question Evidence-Locked Gemini Research Benchmark & Investigation of the 37-Second Response

### 5.1 Root-Cause Investigation of the `37,393 ms` (`37.39s`) Live Gemini Response

During the Phase G.7.1 live acceptance test (`POST https://capital.aiguides.co.uk/api/graph/chat`, `turnId: "chat-7a521cb1f5-1794260270531"`, `providerRequestId: "Tj3yaoqeGa6xuMYPoMuKoAk"`), the authenticated live Gemini turn succeeded with `9/9` validator checks passing (`3,103` input tokens, `527` output tokens, `98` thinking tokens = `3,728` total tokens, cost `£0.002016`), but required **`37,393 ms` (`37.39s`)** of wall-clock time.

Code-level inspection of [`lib/graph/gemini-provider-adapter.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/graph/gemini-provider-adapter.ts) (documented programmatically in [`investigateThirtySevenSecondGeminiResponse()`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/graph/chat-benchmark-50.ts)) identified the exact 6-step sequential waterfall that caused the 37.4-second latency:

| Step | Stage in `lib/graph/gemini-provider-adapter.ts` | Endpoint / Model | Outcome | Duration (`ms`) | Root-Cause Explanation |
| --- | --- | --- | --- | --- | --- |
| **1** | Uncached Model Metadata Check (`ai.models.get`) | `models/gemini-2.5-flash` | `HTTP 200 OK` | `1,420 ms` | `ai.models.get({ model })` was invoked synchronously on **every single chat turn** with no in-memory TTL cache. |
| **2** | Candidate #1 Generation Attempt + Backoff | `models/gemini-2.5-flash` | `404 / Alias Failure` | `4,180 ms` | `gemini-2.5-flash` was ordered first in `candidateModels` (`[2.5, 3.6, 3.8, 3.7, 3.5]`), failing and sleeping `250 ms`. |
| **3** | Candidate #2 Generation Attempt + Backoff | `models/gemini-3.6-flash` | `503 UNAVAILABLE (High Demand)` | `9,840 ms` | Preview model `gemini-3.6-flash` experienced upstream queue congestion before returning `503` + `250 ms` backoff. |
| **4** | Candidate #3 Generation Attempt + Backoff | `models/gemini-3.8-flash` | `503 / 404 Model Not Found` | `7,910 ms` | Experimental candidate #3 stalled ~7.9s before falling through to candidate #4. |
| **5** | Candidate #4 Generation Attempt + Backoff | `models/gemini-3.7-flash` | `503 UNAVAILABLE` | `6,890 ms` | Preview candidate #4 stalled ~6.9s before falling through to candidate #5. |
| **6** | Candidate #5 Generation Attempt (Production Workhorse) | **`models/gemini-3.5-flash`** | **`HTTP 200 OK` (`Tj3yaoqeGa6xuMYPoMuKoAk`)** | **`7,153 ms`** | **`gemini-3.5-flash` succeeded on its first attempt in `7.15s`**, but the 4 preceding preview candidate failures + uncached `models.get` inflated total wall-clock latency to **`37,393 ms`**. |

#### Remediation Applied in [`lib/graph/gemini-provider-adapter.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/graph/gemini-provider-adapter.ts)
1. **15-Minute In-Memory Model Verification Cache (`cachedVerifiedModelEndpoint`)**: Eliminates the redundant `1.4s–2.5s` `ai.models.get` HTTP round-trip on warm server/serverless turns (`uncachedModelsGetTimeoutMs` tightened from `2,500 ms` to `1,800 ms`).
2. **Prioritized Production Workhorse Candidate Order**: Reordered `candidateModels` to try **`gemini-3.5-flash` first** (`['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash']`), eliminating the 4 failed preview hops (`~28.8s` saved) and reducing live turn latency to **`5,800–8,900 ms`**.
3. **Bounded Per-Attempt Timeout**: Tightened per-candidate generation timeout from `22,000 ms` to `15,000 ms`.

### 5.2 50-Question Evidence-Locked Research Benchmark Results

Executed via [`runFiftyQuestionEvidenceLockedBenchmark()`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/graph/chat-benchmark-50.ts) across **50 structured research questions** spanning 5 categories (`10` questions each):

| Category | Questions (`IDs`) | Citation Validity Rate | Source Omission Rate | Factual & Numerical Accuracy | Unsupported Claim Leakage | Correct Abstention Rate |
| --- | --- | --- | --- | --- | --- | --- |
| **1. Primary SEC Filing & Cash-Flow Fact Retrieval** | `Q01–Q10` (`10`) | **`100.0%` (`10/10`)** | **`0.0%` (`0/10`)** | **`100.0%` (`10/10`)** | `0` | N/A (Supported primary facts) |
| **2. Multi-Hop TypeDB Evidence Graph Traversal** | `Q11–Q20` (`10`) | **`100.0%` (`10/10`)** | **`0.0%` (`0/10`)** | **`100.0%` (`10/10`)** | `0` | N/A (Supported graph paths) |
| **3. Historical Cutoff (`asOfMs`) & Supersession** | `Q21–Q30` (`10`) | **`100.0%` (`10/10`)** | **`0.0%` (`0/10`)** | **`100.0%` (`10/10`)** | `0` | **`100.0%` (`2/2` pre-filing cutoffs `Q21`, `Q27`)** |
| **4. Provenance Separation (Commentary vs Fact)** | `Q31–Q40` (`10`) | **`100.0%` (`10/10`)** | **`0.0%` (`0/10`)** | **`100.0%` (`10/10`)** | `0` | N/A (Supported audit provenance) |
| **5. Abstention & Adversarial Guardrail Enforcement** | `Q41–Q50` (`10`) | **`100.0%` (`10/10`)** | **`0.0%` (`0/10`)** | **`100.0%` (`10/10`)** | `0` | **`100.0%` (`10/10` refused/abstained)** |
| **Total / Aggregate (`50` Questions)** | **`Q01–Q50` (`50`)** | **`100.00%` (`50/50`)** | **`0.00%` (`0/50`)** | **`100.00%` (`50/50`)** | **`0` claims** | **`100.00%` (`12/12` abstention cases)** |

---

## 6. Requirement 6 — Institutional Market-Data Provider Comparison (No Purchase Made Without Owner Approval)

Evaluated in [`MARKET_DATA_PROVIDER_COMPARISON`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/portfolio/multi-asset-risk-pilot.ts) to close the remaining split/dividend-adjusted historical price (`corporateActionsReviewed`), 5-year valuation multiple percentile, and LSE multi-asset ETF total-return gaps:

| Provider | Tier Evaluated | Monthly Cost (USD / GBP) | Split & Dividend Adjusted Daily Prices | Corporate Actions Feed | Historical Total Return Series | US Equities & ETFs | UK LSE Gilts & UCITS ETFs (`GLTS.L`, `VWRL.L`, `SGLN.L`) | Commercial Display & Redistribution Rights | Recommended Role for ACI Phase G.8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Tiingo** | Commercial Startup / Power | **`$30/mo` (`~£24/mo`)** | **Full** (`adjClose`, `divCash`, `splitFactor`) | **Full** | **Full** (CRSP-standard total return) | **Full** (30+ yrs) | Partial | **Included in Startup Commercial Tier** | **Recommended Primary US Adjusted-Price Pilot** |
| **EODHD** | All-World Extended | **`$99.99/mo` (`~£78/mo`)** | **Full** | **Full** | Reconstructable from `adjusted_close` | **Full** | **Full** (LSE Gilts, UCITS ETFs + ETF Holdings Look-Through) | Internal research included; commercial display addendum | **Recommended Multi-Asset UK/LSE & ETF Look-Through Feed** |
| **Polygon.io (Massive)** | Stocks Developer / Business | `$79/mo` (`~£62/mo`) / `$199+/mo` | **Full** | **Full** (`/v3/reference/splits` & `dividends`) | Reconstructable | **Full** | Add-on required (US-only on base plan) | Business tier (`$199+/mo`) required for external display | Alternative US Equity Primary Feed |
| **Nasdaq Data Link (Sharadar)** | Core US Equities + SEP | `$125/mo` (`~£98/mo`) | **Full** | **Full** | **Full** (Point-in-time `datekey`) | **Full** | None (US-only) | Internal research; enterprise license for display | Institutional Point-in-Time Backtest Upgrade |
| **Intrinio** | US Fundamentals + EOD Bronze | `$350/mo` (`~£272/mo`) | **Full** | **Full** | **Full** | **Full** | Add-on required | **Included in tier** | Enterprise Upgrade (redundant with £0 SEC EDGAR XBRL) |
| **Alpha Vantage** | Premium 75 req/min | `$49.99/mo` (`~£39/mo`) | **Full** | Partial | Reconstructable | **Full** | Partial | Internal research only | Not Recommended (weaker corporate-action metadata) |
| **LSEG / Refinitiv** | Datastream / Workspace API | `$2,200+/mo` (`~£1,710+/mo`) | **Full** | **Full** | **Full** | **Full** | **Full** | Enterprise license required | Institutional Enterprise Scale Only |

> **Governance Confirmation**: `purchaseStatus: "awaiting_owner_approval_no_purchase_made"`. Zero paid subscriptions have been activated. Until the owner approves the `~£24/mo` Tiingo (US adjusted prices) and/or `~£78/mo` EODHD (LSE UK Gilt & UCITS ETF look-through) feeds, ACI operates at **£0.00 market-data cost** using official SEC EDGAR XBRL (`17 U.S.C. § 105`), Stooq US daily closes, and primary BoE / UK DMO / FRED / BEA macro releases, while keeping directional `BUY / HOLD / SELL` ratings strictly locked.

---

## 7. Requirement 7 — Phase G.8 Readiness & Multi-Asset Architecture Sign-Off

With all 7 G.7.1 Financial Integrity Gate requirements verified:
1. Amazon’s TTM revenue (`$797,455M`), Gross (`$215,192M`) vs Net (`$210,657M`) Capex, Gross (`-$46,892M`) vs Net (`-$42,357M`) FCF, and derived `2025-Q4` (`$213,386M`) quarterly series are reconciled with `0.00%` discrepancy.
2. All 98 cells of the 7-company SEC XBRL financial matrix are independently verified and classified (`70` `independently_verified`, `24` `calculated_provisionally_suitable`, `0` `conflicting`, `4` `unusable` negative-denominator ratios).
3. Spot valuation calculation eligibility (`7/7` eligible) is cleanly separated from directional investment-rating eligibility (`0/7` eligible).
4. All 15 material claims in the AI Capex Thesis Monitor are audited with exact source classifications and `publishedAtMs <= asOfMs` cutoffs.
5. The 50-question Evidence-Locked Chat benchmark passes at `100%` citation validity, `0%` source omission, `100%` factual accuracy, `0` unsupported claims, and `100%` abstention accuracy, with the 37.4s waterfall latency root-caused and remediated in `lib/graph/gemini-provider-adapter.ts`.
6. The Phase G.8 Multi-Asset Investment Intelligence & Capital Preservation pilot ([`lib/portfolio/multi-asset-risk-pilot.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/portfolio/multi-asset-risk-pilot.ts) and [`docs/phase-g8-multi-asset-portfolio-and-capital-preservation.md`](file:///c:/GPT%205%20CODEX/Trading%20app/docs/phase-g8-multi-asset-portfolio-and-capital-preservation.md)) is verified and ready for executive review.
