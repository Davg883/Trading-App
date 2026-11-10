# AI Capital Intelligence — Phase G.8: Multi-Asset Investment Intelligence & Capital Preservation Report

- **Pilot Version**: `aci-phase-g8-multi-asset-pilot-v1.0.0` ([`lib/portfolio/multi-asset-risk-pilot.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/portfolio/multi-asset-risk-pilot.ts))
- **G.7.1 Prerequisite Gate**: Passed ([`docs/phase-g7-1-financial-integrity-and-g8-readiness.md`](file:///c:/GPT%205%20CODEX/Trading%20app/docs/phase-g7-1-financial-integrity-and-g8-readiness.md))
- **Architecture Preserved**: Next.js 16 · Vercel · Convex (`benevolent-magpie-921`) · TypeDB Cloud 3.14.2 (`aci_macro_intelligence_prod`) · Gemini Evidence-Locked Chat · Trading 212 Read-Only Broker Sync
- **Execution Authority**: `"none"` (`LIVE_TRADING_ENABLED=false`, `DEMO_TRADING_ENABLED=false`, zero trade execution, zero personalised investment advice)

---

## 1. Stage 1 — Multi-Asset Research Universe (`8` Asset Classes, `18` Representative Instruments + `7` Direct AI Equities)

Phase G.8 expands AI Capital Intelligence from a single-sector 7-stock AI MVP into an 8-asset-class capital-preservation and portfolio-risk framework designed for a UK Sterling (`GBP`) investor:

| # | Asset Class (`AssetClassCategory`) | Representative Instruments (`Ticker` / Venue) | Base / Underlying CCY | Effective Duration (`Years`) | Running Yield / Coupon (`%`) | OCF (`%`) | Embedded 7-Stock AI Look-Through Weight | Data Coverage Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **1** | **Sterling Cash & Eligible Bank Deposits** (`sterling_cash_and_deposits`) | `GBP_CASH` (SONIA Sweep), `NSI_SAVER` (HM Treasury NS&I Direct Saver), `CSH2.L` (Amundi Overnight SONIA ETF) | `GBP` / `GBP` | `0.00–0.05y` | `3.92%–4.00%` | `0.00%–0.07%` | `0.0%` | `verified_primary_or_reference` (BoE SONIA 3.9852% / Bank Rate 4.00% / Trading 212 GBP Cash) |
| **2** | **UK Government Gilts & High-Quality Bonds** (`uk_gilts_and_quality_bonds`) | `GLTS.L` (0–5yr Short Gilts), `IGLT.L` (All-Maturity Gilts), `INXG.L` (Index-Linked Gilts), `VAGS.L` (Global IG Bond GBP-Hedged) | `GBP` / `GBP` | `2.15y` (`GLTS.L`) to `14.20y` (`INXG.L`) | `4.10%–4.42%` | `0.07%–0.10%` | `0.0%` | `reference_delayed_awaiting_adjusted_feed` (UK DMO / LSE Reference) |
| **3** | **Global Developed-Market Equity Benchmarks** (`developed_market_equities`) | `VWRL.L` (Vanguard FTSE All-World), `CSP1.L` (iShares Core S&P 500), `ISF.L` (iShares Core FTSE 100) | `GBP` / `MULTI_CCY`, `USD`, `GBP` | `0.00y` | `1.24%` (`CSP1.L`) to `3.65%` (`ISF.L`) | `0.07%–0.22%` | **`15.6%` (`VWRL.L`) · `24.8%` (`CSP1.L`) · `0.0%` (`ISF.L`)** | `reference_delayed_awaiting_adjusted_feed` |
| **4** | **Emerging-Market Equities** (`emerging_market_equities`) | `VFEM.L` (Vanguard FTSE Emerging Markets UCITS ETF) | `GBP` / `MULTI_CCY` | `0.00y` | `2.68%` | `0.22%` | `0.0%` | `reference_delayed_awaiting_adjusted_feed` |
| **5** | **Defensive Sectors: Healthcare, Utilities & Staples** (`defensive_equity_sectors`) | `IUHC.L` (Healthcare), `IUUS.L` (Utilities), `IUCS.L` (Consumer Staples) | `GBP` / `USD` | `0.00y` | `1.55%–3.15%` | `0.15%` | `0.0%` | `reference_delayed_awaiting_adjusted_feed` |
| **6** | **Cyclical Sectors: Financials, Industrials & Energy** (`cyclical_equity_sectors`) | `IUFS.L` (Financials), `IUIS.L` (Industrials & Transport), `IUES.L` (Energy) | `GBP` / `USD` | `0.00y` | `1.42%–3.35%` | `0.15%` | `0.0%` | `reference_delayed_awaiting_adjusted_feed` |
| **7** | **Gold & Diversifying Real Assets** (`gold_and_diversifiers`) | `SGLN.L` (iShares Physical Gold ETC — Allocated London Bullion) | `GBP` / `USD` | `0.00y` | `0.00%` | `0.12%` | `0.0%` | `reference_delayed_awaiting_adjusted_feed` |
| **8** | **Seven-Stock AI & Semiconductor Universe** (`ai_and_semiconductor_equities`) | `AI7_BASKET` (`NVDA`, `MSFT`, `GOOGL`, `AMZN`, `AMD`, `CRWV`, `INTC`) | `USD` / `USD` | `0.00y` | `~0.35%` | `0.00%` | **`100.0%`** | `verified_primary_or_reference` (SEC EDGAR XBRL G.7.1 + Stooq US Close) |

---

## 2. Stage 2 — Economic Regime & Market Stress Monitor (`9` Primary Indicators)

Evaluated via [`PHASE_G8_ECONOMIC_REGIME_INDICATORS`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/portfolio/multi-asset-risk-pilot.ts):
- **Overall Regime Classification**: **Late-Cycle Fiscal/AI Capex Expansion with Elevated Valuation Concentration & Rate Sensitivity**

| Indicator ID | Indicator Title | Latest Verified Observation (`asOfDate`) | Regime Signal | Capital-Preservation Implication | Primary Source |
| --- | --- | --- | --- | --- | --- |
| `reg-ind-01-boe-fed-policy` | UK SONIA / BoE Base Rate & US Fed Funds Target | BoE `4.00%` (`SONIA 3.99% / 3.9852%`) · Fed `4.50%–4.75%` (`2026-11-09`) | `expansionary_supportive` | Positive real return on Sterling cash (`3.99%` vs `~2.3%` UK CPI; BoE MPC raised Bank Rate by 25 bps to 4.00% on 5 Nov 2026) makes GBP cash and `0–5yr` short gilts (`GLTS.L`, `4.18%` yield, `2.15y` duration) disciplined capital preservation anchors. | Bank of England (Official MPC Summary 2026-11-05 & SONIA Series IUDSOIA) & Federal Reserve FOMC |
| `reg-ind-02-yield-curve-slope` | UK 10Y–2Y Gilt & US 10Y–2Y Treasury Slope | UK `4.42% vs 4.18%` (`+24 bps`) · US `4.38% vs 4.16%` (`+22 bps`) (`2026-11-09`) | `neutral_watch` | Modest `+22 to +24 bps` term spread offers limited compensation for extending bond duration beyond 5 years given sovereign issuance supply. | UK DMO & US Treasury Yield Curve |
| `reg-ind-03-us-real-gdp-q3` | US Real GDP Growth & Private Domestic Final Demand | `+3.4%` SAAR Real GDP · `+4.9%` Private Final Sales (`2026-10-29`) | `expansionary_supportive` | Strong private domestic demand (`+4.9%`) lowers immediate recession odds but keeps policy rates higher for longer. | U.S. BEA Release `26-45` (`bea-26-45-gdp-q3-2026-adv`) |
| `reg-ind-04-credit-spreads-hy-oas` | ICE BofA US High Yield OAS & AI Infrastructure Leverage | `340 bps` HY OAS (`+22 bps` MoM) · `CRWV +$30,233M` Net Debt (`2026-11-06`) | `late_cycle_caution` | Tight headline spreads (`340 bps`) mask `$895.4B` of off-balance-sheet/multi-cloud AI commitments and `7.12x` Debt/Equity at leveraged neoclouds; favour sovereign gilts and IG credit over HY. | FRED `BAMLH0A0HYM2` & SEC Form 10-Q Debt Ledger |
| `reg-ind-05-equity-index-concentration` | S&P 500 Top-7 AI & Mega-Cap Concentration Share | `34.2%` in Top 7 (`24.8%` in ACI 7-Stock AI Universe) (`2026-11-06`) | `elevated_stress` | Passive `CSP1.L` (`24.8%`) and `VWRL.L` (`15.6%`) already carry large embedded AI weights; combining them with direct AI stocks creates severe single-theme crowding. | S&P Dow Jones & FTSE All-World Constituent Audit |
| `reg-ind-06-ai-capex-to-ocf-intensity` | Hyperscaler & Neocloud Capex-to-OCF Intensity | `AMZN 125.2%` Net (`127.9%` Gross) · `GOOGL 121.4%` Q3 · `CRWV 297.6%` TTM (`2026-11-03`) | `elevated_stress` | Capital expenditure exceeding 100% of operating cash flow compresses free cash flow (`AMZN -$42.4B` Net / `-$46.9B` Gross TTM FCF) and heightens multiple-compression risk. | SEC EDGAR XBRL Phase G.7.1 (`sec-xbrl-g7-1-2026-11-09`) |
| `reg-ind-07-volatility-vix-move` | Equity (`VIX`) & Bond (`MOVE`) Implied Volatility | `VIX 18.4` · `MOVE 108.5` (`2026-11-06`) | `neutral_watch` | Elevated bond volatility (`MOVE 108.5`) reinforces anchoring fixed-income reserves in `0–5yr` short gilts (`GLTS.L`, `2.15y` duration). | CBOE VIX & ICE BofA MOVE Reference |
| `reg-ind-08-grid-power-constraints` | Sovereign Grid Power Share & Data-Centre Queues | Ireland `21.0%` Metered Electricity Share · `120–400 MW` AI Campuses (`2026-11-03`) | `late_cycle_caution` | Physical grid bottlenecks support regulated utilities (`IUUS.L`) and industrial power equipment (`IUIS.L`) as real-asset diversifiers. | CSO Ireland & EirGrid (`src-cso-ireland-dc-2026`) |
| `reg-ind-09-gbp-usd-fx-regime` | Sterling Exchange Rate Regime (`GBP/USD` & `EUR/GBP`) | `GBP/USD 1.2920` · `EUR/GBP 0.8340` (`2026-11-06`) | `neutral_watch` | Unhedged US equities expose a UK investor to a `-9.1%` GBP translational loss if Sterling appreciates `+10%`; near-term liabilities must stay in GBP. | Bank of England Spot FX Reference |

---

## 3. Stage 3 — Multi-Asset Portfolio Risk & Capital Preservation Engine

### 3.1 Owner Live Trading 212 Account Risk Evaluation (`trading212_live_read_only`)
- **Live Account State**: `£250.00` uninvested Sterling cash (`totalCashGbp: 250.00`), `0` open equity/ETF positions (`investedPositionsValueGbp: 0.00`), `totalPortfolioValueGbp: £250.00`.
- **Risk & Capital-Preservation Telemetry**:
  - `cashAllocationPct`: **`100.0%`** (`GBP`)
  - `equityAllocationPct`: **`0.0%`**
  - `unhedgedFxExposurePct`: **`0.0%`**
  - `effectiveDurationYears`: **`0.00y`** (`£0` DV01 rate shock sensitivity)
  - `maxStressDrawdownAcrossAllScenariosPct`: **`0.00%`** (Instantaneous par preservation at $T=0$: nominal price shock is `0.00%` across Scenarios A–G with zero market principal at risk. Separately, uninvested cash earns `+3.99%` annualised forward carry [SONIA `3.9852%` / Bank Rate `4.00%`], generating `+£9.96` annual income).

### 3.2 Core Risk Capabilities Implemented in [`lib/portfolio/multi-asset-risk-pilot.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/portfolio/multi-asset-risk-pilot.ts)
1. **ETF Look-Through Overlap Detection**: Automatically decomposes index ETFs (`VWRL.L` `15.6%` embedded 7-stock AI weight, `26.4%` US Tech weight; `CSP1.L` `24.8%` embedded 7-stock AI weight, `39.5%` US Tech weight) and adds them to any direct holdings in `NVDA`, `MSFT`, `GOOGL`, `AMZN`, `AMD`, `CRWV`, and `INTC` to report **True Total AI Universe Exposure (`totalTrueAiUniverseExposurePct`)** and **True Total US Tech Exposure (`totalTrueUsTechExposurePct`)**.
2. **Interest-Rate Duration & `DV01` Engine**: Computes portfolio-weighted effective duration (`portfolioEffectiveDurationYears`) and Sterling pound `DV01` per `+100 bps` parallel yield-curve shift (`dv01Per100BpsParallelShiftGbp`), distinguishing `0–5yr` short gilts (`GLTS.L`, `2.15y` duration) from all-maturity gilts (`IGLT.L`, `8.35y` duration) and index-linked gilts (`INXG.L`, `14.20y` duration).
3. **Currency Translation Exposure (`GBP` vs Unhedged `USD` / `MULTI_CCY`)**: Quantifies the exact share of portfolio capital exposed to `GBP/USD` exchange-rate swings versus domestic/GBP-hedged instruments (`GBP_CASH`, `GLTS.L`, `IGLT.L`, `VAGS.L`, `ISF.L`).
4. **Emergency Reserve & Forced-Sale Protection Metric**: Computes `intradayAndCashLiquidityBufferPct` (Sterling Cash + Money Market + `0–5yr` Short Gilts) and translates it into **months of living-expense coverage** (`monthsOfEmergencyReserveCoveredAt2500GbpPerMonth` at `£2,500/month`) so investors can verify they will never be forced to liquidate equities during a bear market.

---

## 4. Stage 4 — Asset-Class Opportunity Screening (Non-Promotional, Horizon-Specific)

Evaluated via [`PHASE_G8_ASSET_CLASS_SCREENING`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/portfolio/multi-asset-risk-pilot.ts). All 8 asset classes remain gated at `directionalRatingGateStatus: "locked_educational_screening_only"`:

| Asset Class | Current Yield / Valuation Summary | Short-Term (`0–12m`) Role | Medium-Term (`1–3y`) Role | Long-Term (`3–7y+`) Role | Key Downside Risks |
| --- | --- | --- | --- | --- | --- |
| **1. Sterling Cash & Deposits** | `3.99%–4.00%` GBP yield (`~1.7%` real), `0.0y` dur | Primary capital-preservation & liquidity anchor (`0%` nominal drawdown) | Reinvestment yield risk if BoE shifts policy path | Lags productive real assets due to long-run inflation compounding | Rate cuts reducing carry; CPI spikes `>5%` |
| **2. UK Gilts & Quality Bonds** | `GLTS.L` `4.25%` (`2.15y` dur) · `IGLT.L` `4.42%` (`8.35y` dur) | Short gilts capture `96%` of gilt yield with `1/4` the duration risk | Intermediate gilts/IG bonds rally `+3% to +7%` if recession forces rate cuts | Locks in `>4.2%` nominal sovereign yield; long gilts face fiscal supply risk | `+100–200 bps` rate shock (`-8.4%` to `-16.7%` on `IGLT.L`) |
| **3. Developed-Market Equities** | S&P 500 `~27.4x` P/E (`1.24%` yld) · FTSE 100 `~14.2x` P/E (`3.65%` yld) | Vulnerable to AI capex multiple compression (`15.6%–24.8%` embedded AI weight) | Global breadth & UK value/income (`ISF.L`) cushion US tech multiples | Core long-term real equity compounding engine | Hidden US tech concentration; unhedged USD translation risk |
| **4. Emerging-Market Equities** | `VFEM.L` `~13.1x` P/E, `2.68%` dividend yield | Sensitive to USD strength, trade tariffs, and Asian hardware cycle | `>45%` P/E discount to S&P 500 offers geographic diversification | Long-term demographic & industrial growth satellite (`0%–10%`) | Tariff/geopolitical shocks; EM currency drawdowns |
| **5. Defensive Equity Sectors** | `17x–20x` P/E, `1.55%–3.15%` yield (`IUHC.L`, `IUUS.L`, `IUCS.L`) | Lower beta (`0.55–0.70`) during tech sell-offs; utilities benefit from grid demand | Resilient cash flow and dividend stability in economic slowdowns | Steady equity compounding with shallower max drawdowns | Bond-proxy sensitivity during rapid `+200 bps` rate spikes |
| **6. Cyclical Equity Sectors** | `12x–19x` P/E, `1.42%–3.35%` yield (`IUFS.L`, `IUIS.L`, `IUES.L`) | Supported by `+3.4%` Q3 GDP & physical grid buildout; Energy hedges inflation | Vulnerable if HY credit spreads widen `>500 bps` in recession | Real-economy cash flows & inflation pass-through (`5%–10%` weight) | Recession credit losses; commodity cyclicality |
| **7. Gold & Diversifiers** | `SGLN.L` `0.0%` yield, `0.12%` OCF, London vault bullion | Hedges simultaneous stock/bond sell-offs and geopolitical tail shocks | Protects against monetary debasement and persistent inflation | Disciplined `5%–10%` non-sovereign tail-risk hedge | Rising real interest rates + surging USD; zero income |
| **8. 7-Stock AI & Semi Universe** | Spot P/E `11.0x–69.2x` · EV/Rev `1.96x–43.41x` · FCF Yld `-18.7% to +3.2%` | Extreme cash-flow dispersion (`NVDA +$127B` FCF vs `AMZN -$42.4B` Net FCF) | Depends on converting `$895.4B` commitments into cloud operating cash flow | High-beta growth satellite only; cap total look-through weight `<=10%` for balanced users | `-35% to -50%` capex moderation drawdown; `CRWV` `7.12x` leverage; `100%` USD risk |

---

## 5. Stage 5 & Stage 6 — Portfolio Stress Laboratory (`Scenarios A–G`) & Four Educational Benchmark Portfolios (`£100,000` Hypothetical Basis)

Evaluated via [`PHASE_G8_EDUCATIONAL_BENCHMARK_PORTFOLIOS`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/portfolio/multi-asset-risk-pilot.ts) using a hypothetical **`£100,000` GBP** basis (`executionAuthority: "none"`):

### 5.1 Structural Exposure & Look-Through Comparison Across the 4 Educational Reference Portfolios

| Metric | 1. Capital Preservation Reference (`£100k`) | 2. Balanced Multi-Asset Reference (`£100k`) | 3. Growth-Oriented Diversified (`£100k`) | 4. Technology-Concentrated Contrast (`£100k`) | Owner Live Trading 212 Account (`£250`) |
| --- | --- | --- | --- | --- | --- |
| **Sterling Cash & MMF (`%`)** | **`45.0%`** (`£45,000`) | **`15.0%`** (`£15,000`) | **`5.0%`** (`£5,000`) | `5.0%` (`£5,000`) | **`100.0%`** (`£250.00`) |
| **UK Gilts & Quality IG Bonds (`%`)** | **`45.0%`** (`35% GLTS.L + 10% IGLT.L`) | **`25.0%`** (`15% GLTS.L + 10% VAGS.L`) | **`15.0%`** (`10% GLTS.L + 5% IGLT.L`) | `0.0%` | `0.0%` |
| **Developed Equities (`%`)** | `0.0%` | `30.0%` (`20% VWRL.L + 10% ISF.L`) | `40.0%` (`30% VWRL.L + 10% ISF.L`) | `25.0%` (`25% CSP1.L`) | `0.0%` |
| **Defensive + Cyclical + EM Equities (`%`)** | `5.0%` (`5% IUUS.L`) | `25.0%` (`12% Def + 8% Cyc + 5% EM`) | `30.0%` (`10% Def + 10% Cyc + 10% EM`) | `0.0%` | `0.0%` |
| **Physical Gold (`SGLN.L` `%`)** | `5.0%` (`£5,000`) | `5.0%` (`£5,000`) | `5.0%` (`£5,000`) | `0.0%` | `0.0%` |
| **Direct 7-Stock AI Basket (`%`)** | **`0.00%`** | **`0.00%`** | **`5.00%`** (`£5,000`) | **`70.00%`** (`£70,000`) | **`0.00%`** |
| **Hidden ETF Look-Through AI Weight (`%`)** | **`0.00%`** | **`3.12%`** (via `VWRL.L`) | **`4.68%`** (via `VWRL.L`) | **`6.20%`** (via `CSP1.L`) | **`0.00%`** |
| **True Total 7-Stock AI Exposure (`%`)** | **`0.00%`** | **`3.12%`** (`£3,120`) | **`9.68%`** (`£9,680`) | **`76.20%`** (`£76,200`) | **`0.00%`** |
| **True Total US Tech Exposure (`%`)** | **`0.00%`** | **`5.40%`** | **`13.04%`** | **`79.88%`** | **`0.00%`** |
| **Unhedged USD Exposure (`%`)** | `10.00%` | `41.25%` | `56.00%` | `95.00%` | **`0.00%`** |
| **Effective Bond Duration (`Years` / `DV01`)** | `1.60y` (`£1,600` per `100 bps`) | `0.97y` (`£970` per `100 bps`) | `0.63y` (`£630` per `100 bps`) | `0.00y` (`£0`) | `0.00y` (`£0`) |
| **Weighted Running Yield (`%`)** | **`4.19%`** | **`3.16%`** | **`2.65%`** | `0.79%` | **`3.99%`** |
| **Cash + Short-Gilt Reserve (`Months` @ `£2.5k/mo`)** | **`32.0 months` (`80%`)** | **`12.0 months` (`30%`)** | **`6.0 months` (`15%`)** | **`2.0 months` (`5%` — Forced Sale Risk)** | `0.1 months` (`£250` cash) |

### 5.2 Stress Scenario Performance Matrix Across `Scenarios A–G` (`%` Return & `£` P&L on `£100,000`)

| Stress Scenario | 1. Capital Preservation (`£100k`) | 2. Balanced Multi-Asset (`£100k`) | 3. Growth-Oriented Diversified (`£100k`) | 4. Technology-Concentrated (`£100k` Contrast) |
| --- | --- | --- | --- | --- |
| **Scenario A: AI Capex Slowdown (`-35%` AI, `-18%` Dev Eq, `+3.5%` Gilts)** | **`+3.72%` (`+£3,720`)**<br>Post-stress: `£103,720` | **`-4.89%` (`-£4,890`)**<br>Post-stress: `£95,110` | **`-10.89%` (`-£10,890`)**<br>Post-stress: `£89,110` | **`-28.77%` (`-£28,770`)**<br>Post-stress: `£71,230` |
| **Scenario B: Severe US Tech Drawdown (`-50%` AI, `-26%` Dev Eq, `+5%` Gilts)** | **`+4.39%` (`+£4,390`)**<br>Post-stress: `£104,390` | **`-7.55%` (`-£7,550`)**<br>Post-stress: `£92,450` | **`-16.46%` (`-£16,460`)**<br>Post-stress: `£83,540` | **`-41.27%` (`-£41,270`)**<br>Post-stress: `£58,730` |
| **Scenario C: Interest-Rate Hike Shock (`+150–200 bps`, `-7.2%` Gilts, `-22%` AI)** | **`-1.18%` (`-£1,180`)**<br>Post-stress: `£98,820` | **`-7.17%` (`-£7,170`)**<br>Post-stress: `£92,830` | **`-10.44%` (`-£10,440`)**<br>Post-stress: `£89,560` | **`-18.24%` (`-£18,240`)**<br>Post-stress: `£81,760` |
| **Scenario D: Recession & Credit Widening (`HY OAS +250 bps`, `-28%` Cyc, `+6.8%` Gilts)** | **`+4.75%` (`+£4,750`)**<br>Post-stress: `£104,750` | **`-8.16%` (`-£8,160`)**<br>Post-stress: `£91,840` | **`-16.21%` (`-£16,210`)**<br>Post-stress: `£83,790` | **`-28.21%` (`-£28,210`)**<br>Post-stress: `£71,790` |
| **Scenario E: Inflation & Energy Spike (`-6.5%` Gilts, `+4.5%` Cyc/Energy, `+11.5%` Gold)** | **`-0.38%` (`-£380`)**<br>Post-stress: `£99,620` | **`-5.09%` (`-£5,090`)**<br>Post-stress: `£94,910` | **`-8.55%` (`-£8,550`)**<br>Post-stress: `£91,450` | **`-20.30%` (`-£20,300`)**<br>Post-stress: `£79,700` |
| **Scenario F: Sterling Appreciation (`+10%` GBP/USD Shock, `-9.1%` Unhedged USD)** | **`+3.25%` (`+£3,250`)**<br>Post-stress: `£103,250` | **`-2.32%` (`-£2,320`)**<br>Post-stress: `£97,680` | **`-5.26%` (`-£5,260`)**<br>Post-stress: `£94,740` | **`-7.84%` (`-£7,840`)**<br>Post-stress: `£92,160` |
| **Scenario G: Liquidity Stress (`£30k` Withdrawal During `-25%` Bear Market)** | **`+3.23%` (`+£3,230`)**<br>*Zero forced equity sales (`£80k` liquid buffer)* | **`-7.61%` (`-£7,610`)**<br>*Zero forced equity sales (`£30k` liquid buffer)* | **`-14.65%` (`-£14,650`)**<br>*Requires `£15k` equity sale beyond `£15k` buffer* | **`-29.77%` (`-£29,770`)**<br>*Forces `£25k` sale of depressed tech equities* |

---

## 6. Stage 7 — Executive Dashboard & Portfolio Command Centre Integration Plan

1. **Executive Overview (`Market Radar`)**:
   - Displays the 9-indicator **Economic Regime & Market Stress Strip** (`BoE 4.00% / SONIA 3.99%`, `UK 10Y–2Y +24 bps`, `BEA Q3 Real GDP +3.4%`, `US HY OAS 340 bps`, `S&P 500 Top-7 Concentration 34.2%`, `AMZN 125.2% Net / 127.9% Gross Capex/OCF`) alongside the Cathie Wood AI Capex Moderation Thesis Monitor (`1 Supports, 4 Contradicts, 2 Neutral, 1 Insufficient = 8`).
   - Separates **Spot Reference Valuation Ratios** (`spotValuationCalculationEligible: true`, labelled `calculated_provisionally_suitable`) from **Directional Investment Ratings** (`directionalInvestmentRatingEligible: false`, locked at `INSUFFICIENT DATA`).
2. **Portfolio Command Centre (`Multi-Asset Risk & Stress Laboratory`)**:
   - Displays the live read-only Trading 212 account (`£250.00` uninvested GBP cash, `0` open positions, `0.00%` stress drawdown) side-by-side with the **4 Educational Multi-Asset Benchmark Portfolios (`£100k` reference models)**.
   - Surfaces **ETF Look-Through Concentration Alerts** whenever combined direct + index-ETF exposure to the 7-stock AI universe exceeds `15.0%` (`76.20%` in the Technology-Concentrated contrast portfolio vs `3.12%` in Balanced Multi-Asset).
   - Provides interactive scenario toggles across **`Scenarios A–G`** showing GBP P&L impact, effective duration (`DV01`), unhedged USD currency risk, and emergency reserve coverage (`monthsOfEmergencyReserveCoveredAt2500GbpPerMonth`).
