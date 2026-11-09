# AI Capital Intelligence — Phase G.6: Executive Dashboard & Evidence-Backed Stock Research Ratings

**Document Status**: Formal Phase G.6 UX Redesign & Research Assessment Methodology Acceptance Report  
**Target Production Deployment**: `https://capital.aiguides.co.uk`  
**Methodology Version**: `aci-stock-rating-v1.0.0-exp` (`Experimental research assessment`)  
**Execution Authority**: `none` (Live & Demo order submission disabled; read-only broker & knowledge-graph architecture preserved)

---

## 1. Executive Summary

Phase G.6 transforms the **Market Radar (`/`)** landing experience from a dense, telemetry-heavy dashboard into a concise, decision-oriented **5-Section Executive Overview** backed by a deterministic, versioned **Stock Research Assessment Engine (`aci-stock-rating-v1.0.0-exp`)**:

1. **Section A — Today’s Market Briefing**: A five-sentence executive TL;DR synthesising the market environment (`QQQ` `$691.95 USD`, `+0.97%`, Case 006 v2 `unconfirmed_rebound`), major sector developments (`$895.4B` deduplicated AI compute commitments across TypeDB `Macro Case 001`), top verified fundamental research priorities (`NVDA` `84.1/100`, `MSFT` `74.0/100`), highest material risks (hyperscaler FCF compression at Alphabet `-$9.07B` and Amazon `98.7%` capex/OCF absorption, plus US/Ireland grid constraints), and session-over-session deltas.
2. **Section B — Portfolio Snapshot**: Concise account KPIs (`Total account value`, `Today's investment P/L`, `Cumulative investment P/L`, `Portfolio return`, `Available cash`, `Amount invested`, `Open positions`, `Last full sync`, and `Execution: Read-Only`). For cash-only or single-sync accounts (`< 2` stored valuation points), the large empty performance chart, holdings table, and broker diagnostics are automatically collapsed into an expandable `Expanded Portfolio View` drawer (`data-testid="expanded-portfolio-drawer"`).
3. **Section C — Evidence-Backed Stock Research Table & Detailed Company Assessment Drawer**: A 7-company research table (`NVDA`, `MSFT`, `AMZN`, `GOOGL`, `AMD`, `CRWV`, `INTC`) displaying verified price & GBP equivalent, price classification (`Delayed Public Reference Close (Unadjusted)`), research assessment (`INSUFFICIENT DATA` with `aci-stock-rating-v1.0.0-exp`), 6–12M fundamental horizon, dimension coverage bar, principal justification, key risk/invalidation condition, 6 filter/sort controls, and an interactive **Detailed Company Assessment Drawer** showing the 5-dimension quantitative table and 4-layer epistemic governance separation.
4. **Section D — What Changed?**: Verified before/after historical delta cards across SEC filings (`Anthropic S-1/A`), quarterly cash conversion (`GOOGL`, `AMZN`, `MSFT`), infrastructure financing (`Intel $11.0B Fab 34 Leixlip SCJV`, `Nscale Ward County guarantee`), TypeDB supersession (`rel-loughton-dc-cancelled-v1-r1` $\rightarrow$ `rel-loughton-dc-active-v2-r1`), market regime (`Case 006 v2`), and assessment gates.
5. **Section E — Ask AI Capital Intelligence**: An inline Evidence-Locked Research Assistant with one-click preset questions governed by the 9-check deterministic validator and `POST /api/graph/chat`.

---

## 2. Part 1 Audit — Clutter Removed & Moved to Secondary Collapsible Drawers

| Audited View / Element | Pre-G.6 UX Problem Identified | Phase G.6 Resolution (Zero Provenance Loss) |
| :--- | :--- | :--- |
| **Market Radar (`/`) — Empty Performance Chart** | Cash-only (`£250.00` cash, `0` open positions) or single-sync accounts rendered a large empty SVG chart box (`"At least two stored account valuations are needed to plot a series"`) occupying the centre of the primary screen. | Placed `PerformanceChart`, `HoldingsPanel`, `BrokerSyncStatus`, and `RiskPanel` inside `<details data-testid="expanded-portfolio-drawer">`, which stays collapsed by default when `< 2` valuation points exist and auto-opens when `>= 2` valuation points are recorded. |
| **Market Radar (`/`) — Raw Ingestion & Job Telemetry** | `MorningBriefPanel` (raw source hashes, verification statuses), `AgentOperationsPanel` (per-job interval tables, cost-ceiling telemetry, toggle buttons), `ResearchIntel` (missing-evidence resolver queues), and `Data boundaries` were stacked open on desktop (`wide = true`), creating 3,500+ px of vertical scrolling and duplicate disclaimers. | Grouped into a single clean secondary drawer at the bottom of Market Radar: `Technical, Operations & Evidence Audit Details` (`data-testid="technical-evidence-details"`). All child panels and `data-testid`s remain mounted in the DOM for expert audit and automated tests. |
| **Market Radar (`/`) — Legacy Watchlist Panel** | Displayed delayed reference closes and retrospective policy tags without fundamental financial metrics, dimension coverage, or structured research assessments. | Replaced in the primary view by **Section C — Evidence-Backed Stock Research Table** + **Detailed Company Assessment Drawer**, while preserving the legacy `WatchlistPanel` inside the collapsible technical audit drawer. |
| **Macro Data Room (`/data-room`) — Top Header Bar** | Overcrowded top status cluster with redundant schema/guardrail pills and generic back-link label. | Streamlined top status cluster in `components/macro-data-room.tsx` (`TypeDB Server LIVE`, `Outbox 23/23 Projected`, and direct `← Market Radar & Stock Ratings` navigation link). |

---

## 3. Before & After Visual Comparison

### 3.1 Desktop (`1440x900`) — Before vs After Market Radar

- **Before Phase G.6 (`docs/screenshots/phase-g6-before-market-radar-desktop.png`)**: Dominated by an empty performance chart, empty holdings panel, repetitive risk widgets, and raw operational telemetry tables.
- **After Phase G.6 (`docs/screenshots/phase-g6-after-market-radar-desktop.png`)**: Opens immediately with **Section A (Today's Market Briefing)**, **Section B (Compact Portfolio Snapshot)**, **Section C (Stock Research Watchlist & Detailed Company Drawer)**, **Section D (What Changed?)**, and **Section E (Ask AI Capital Intelligence)**.

![Market Radar After Desktop](screenshots/phase-g6-after-market-radar-desktop.png)

### 3.2 Stock Research Table & Detailed Company Assessment Drawer (`Section C`)

![Stock Research Table and Drawer](screenshots/phase-g6-after-stock-table-and-drawer.png)

### 3.3 Mobile (`390x844`) — Responsive Layout Verification

![Market Radar After Mobile](screenshots/phase-g6-after-market-radar-mobile.png)

### 3.4 Macro Data Room (`/data-room`) — Streamlined Header & Navigation

![Macro Data Room Header](screenshots/phase-g6-after-data-room.png)

---

## 4. Data Availability & Current Rating Coverage Across the 7-Stock Universe

Every tracked company is evaluated deterministically by `evaluateCompanyResearchAssessment()` in [`lib/research-ratings/engine.ts`](../lib/research-ratings/engine.ts). Missing data is **never** treated as `0` (`null` is preserved and triggers dimension-level `insufficient_data`).

| Ticker | Company | Latest Verified Close (USD / GBP) | Dim 1: Valuation (30%) | Dim 2: Earnings & Health (25%, 6–12M) | Dim 3: Momentum (20%, 20D Tactical) | Dim 4: Macro & Sector (15%, 6–12M) | Dim 5: Company Risk (10%, 6–12M) | Covered Weight | Fundamental Priority Score | Production Assessment | Exact Gate Reason for `INSUFFICIENT DATA` |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **NVDA** | NVIDIA Corp. | `$186.64` (`£139.44`) | `null` (`insufficient_data`) | **89.0 / 100** (`66.2%` op margin, `$21.34B` FCF) | **7.3 / 100** (`-13.97%` 20D) | `null` (0 promoted prod hyperedges; `$1.0B` Nscale staged) | **72.0 / 100** (`$1.0B` Nscale note + `$860.3M` guarantee) | **55%** (3/5 dims) | **84.1 / 100** (Rank #1) | `INSUFFICIENT DATA` | Missing 30% Valuation multiples; unadjusted closes; 46 `< 252` backtest sessions |
| **MSFT** | Microsoft Corp. | `$530.61` (`£396.42`) | `null` (`insufficient_data`) | **75.6 / 100** (`49.8%` op margin, `$18.63B` FCF, `+48%` Azure) | **61.1 / 100** (`+0.88%` 20D) | `null` (Loughton v2 & Monarch `$44.6B` in TypeDB) | **70.0 / 100** (Loughton v1->v2 supersession managed) | **55%** (3/5 dims) | **74.0 / 100** (Rank #2) | `INSUFFICIENT DATA` | Missing 30% Valuation multiples; unadjusted closes; 46 `< 252` backtest sessions |
| **AMZN** | Amazon.com, Inc. | `$259.30` (`£193.73`) | `null` (`insufficient_data`) | **54.7 / 100** (`14.0%` op margin, `$115.88B` TTM capex = `88.7%` OCF) | **74.9 / 100** (`+4.23%` 20D) | **69.0 / 100** (`$545B` compute commitment; `350 MW` Dublin grid cap) | **58.0 / 100** (FCF compression + Ireland/NY grid moratoria) | **70%** (4/5 dims) | **59.3 / 100** (Rank #3) | `INSUFFICIENT DATA` | Missing 30% Valuation multiples; unadjusted closes; 46 `< 252` backtest sessions |
| **GOOGL** | Alphabet Inc. | `$284.78` (`£212.76`) | `null` (`insufficient_data`) | **53.4 / 100** (`31.8%` op margin, Cloud `+102.6%`, Q3 FCF `-$9.07B`) | **64.6 / 100** (`+1.73%` 20D) | `null` (`$250B` Anthropic compute commitment) | **63.0 / 100** (Negative Q3 FCF after `$51.36B` capex) | **55%** (3/5 dims) | **56.1 / 100** (Rank #4) | `INSUFFICIENT DATA` | Missing 30% Valuation multiples; unadjusted closes; 46 `< 252` backtest sessions |
| **AMD** | Advanced Micro Devices | `$449.04` (`£335.48`) | `null` (`insufficient_data`) | `null` (No verified primary SEC income/FCF table stored) | **7.9 / 100** (`-13.81%` 20D) | **66.0 / 100** (`$60.4B` Anthropic MI355X/MI400X commitment) | `null` (`insufficient_data`) | **35%** (2/5 dims) | `null` (Unscored) | `INSUFFICIENT DATA` | Missing 30% Valuation + 25% Earnings + 10% Risk tables; 46 `< 252` sessions |
| **CRWV** | CoreWeave, Inc. | `$46.40` (`£34.67`) | `null` (`insufficient_data`) | `null` (No verified primary SEC income/FCF table stored) | **0.0 / 100** (`-30.54%` 20D) | `null` (`insufficient_data`) | `null` (`insufficient_data`) | **20%** (1/5 dims) | `null` (Unscored) | `INSUFFICIENT DATA` | Only 20D reference price series stored; missing SEC financial & valuation tables |
| **INTC** | Intel Corp. | `$56.28` (`£42.05`) | `null` (`insufficient_data`) | `null` (No verified primary SEC income/FCF table stored) | `null` (`< 15` sessions stored) | `null` (`$11.0B` Fab 34 Leixlip SCJV) | **56.0 / 100** (Fab 34 SCJV dividend-priority liability) | **10%** (1/5 dims) | `null` (Unscored) | `INSUFFICIENT DATA` | Missing 30% Valuation + 25% Earnings + 20% Momentum series; 46 `< 252` sessions |

---

## 5. Methodology Specification (`aci-stock-rating-v1.0.0-exp`) & Validation Results

### 5.1 Scoring Rules, Horizons & Gate Thresholds

1. **Five Evidence-Gated Dimensions & Provisional Weights**:
   - **Dimension 1 — Valuation & Fundamentals (`30%`, `6–12M Fundamental`)**: Requires verified diluted share count, corporate-action-adjusted price, and trailing 4-quarter (TTM) or licensed forward consensus `EV/FCF` & `P/E` multiples. Single-quarter EPS is never annualised.
   - **Dimension 2 — Earnings & Financial Health (`25%`, `6–12M Fundamental`)**: Deterministic composite of GAAP operating margin (`0–40 pts`), FCF margin / OCF conversion (`0–35 pts`), and capex discipline (`0–25 pts`) from verified SEC 10-Q / 10-K / 8-K filings.
   - **Dimension 3 — Momentum & Price Trend (`20%`, `20D Tactical — Separated`)**: 20-session relative return vs `QQQ` plus 5-session trend from Nasdaq EOD reference closes. Explicitly separated from the `6–12M Fundamental` priority score so short-term price noise never distorts fundamental research rankings.
   - **Dimension 4 — Macroeconomic & Sector Exposure (`15%`, `6–12M Fundamental`)**: Derived from TypeDB `aci_macro_intelligence_prod` active hyperedges (`$895.4B` deduplicated AI compute commitments) and `Benchmark 001.2` US/Ireland energy & grid constraints.
   - **Dimension 5 — Company-Specific & Counterparty Risk (`10%`, `6–12M Fundamental`)**: Evaluates balance-sheet cash coverage of capex, credit guarantees (`$860.3M` Ward County guarantee, `$11.0B` Intel SCJV), and superseded/cancelled commitments (`Loughton v1`).
2. **Directional Classification Thresholds (When 100% of Evidence & Validation Gates Pass)**:
   - **`BUY`**: All 5 dimensions scored (`coveredWeightRatio === 1.0`), `priceFresh === true` (`<= 7` days), `corporateActionsReviewed === true`, `backtestSampleSessions >= 252`, `compositeScore >= 72.0`, and `company_specific_risk >= 50.0`.
   - **`HOLD`**: All gates passed and `48.0 <= compositeScore < 72.0` (or `compositeScore >= 72.0` with `30.0 <= company_specific_risk < 50.0`).
   - **`SELL`**: All gates passed and `30.0 <= compositeScore < 48.0`.
   - **`AVOID`**: All gates passed and `compositeScore < 30.0` or `company_specific_risk < 30.0`.
   - **`INSUFFICIENT DATA`**: Mandatory whenever any required dimension is `null`, price is stale (`> 7` days), corporate actions are unverified, or backtest history is `< 252` sessions.
3. **Chatbot Non-Override Invariant**: `classifyAssessmentFromValidatedScores()` explicitly ignores any `chatbotSuggestedOverride` parameter. Gemini (`Layer 3`) can explain stored evidence and citations via `/api/graph/chat`, but is hard-blocked from overriding an `INSUFFICIENT DATA` gate or inventing valuation multiples.

### 5.2 Retrospective Point-in-Time Backtest vs `QQQ` (`2026-09-01` → `2026-11-04`, 46 Sessions)

| Metric | Primary-Filing Verified Cohort (`NVDA`, `MSFT`, `GOOGL`, `AMZN`) | Passive Benchmark (`QQQ` Nasdaq-100) | Delta / Gate Status |
| :--- | :--- | :--- | :--- |
| **Stored Trading Sessions** | `46` daily sessions (`2026-09-01` → `2026-11-04`) | `46` daily sessions | `< 252` required sessions (**Experimental gate active**) |
| **Cumulative Gross Return (USD)** | **`-1.66%`** | `-2.22%` | **`+0.56%` gross outperformance (USD)** |
| **Assumed Transaction Friction** | `10 bps` spread + `5 bps` slippage + `15 bps` FX (`30 bps` total + `£1` fee) | Passive hold | Realistic retail/institutional friction applied |
| **Cumulative Net Return (GBP, after FX & friction)** | **`-1.79%`** | `-1.73%` | `-0.06%` net GBP after 30 bps round-trip friction |
| **Maximum Drawdown (USD)** | **`-6.75%`** | `-8.68%` | **`+1.93%` lower drawdown vs `QQQ`** |
| **Forward-Registered Signals** | `0` forward directional signals | — | Retrospective backtest strictly separated from forward claims |

### 5.3 Weight Sensitivity Analysis (4 Schemes)

| Weight Scheme | Weights (`Val / Earn / Mom / Macro / Risk`) | Ranked Priority Order | Top-2 Stability | Spearman Rank Correlation ($\rho$) vs Baseline | Directional Labels Emitted |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Provisional Baseline** | `30% / 25% / 20% / 15% / 10%` | `NVDA → MSFT → AMZN → GOOGL → AMD → CRWV → INTC` | `NVDA, MSFT` | **`1.000`** | `0` (all gated at `INSUFFICIENT DATA`) |
| **2. Earnings & Cash-Flow Heavy** | `20% / 40% / 10% / 15% / 15%` | `NVDA → MSFT → AMZN → GOOGL → AMD → INTC → CRWV` | `NVDA, MSFT` | **`0.964`** | `0` (all gated at `INSUFFICIENT DATA`) |
| **3. Macro & Counterparty Risk Heavy** | `20% / 25% / 10% / 25% / 20%` | `NVDA → MSFT → AMD → AMZN → GOOGL → INTC → CRWV` | `NVDA, MSFT` | **`0.857`** | `0` (all gated at `INSUFFICIENT DATA`) |
| **4. Equal Dimension Weights** | `20% / 20% / 20% / 20% / 20%` | `NVDA → MSFT → AMZN → GOOGL → AMD → INTC → CRWV` | `NVDA, MSFT` | **`0.964`** | `0` (all gated at `INSUFFICIENT DATA`) |

---

## 6. Automated Test & Verification Summary

- **TypeScript Compilation (`npm run typecheck`)**: `0` errors across the entire codebase.
- **Next.js Production Build (`npm run build`)**: Compiled cleanly (`16/16` static & dynamic routes built).
- **Vitest Automated Test Suite (`npx vitest run`)**: **51 / 51 test files passed (`479 / 479` tests passing)**, including the new 6-test suite in [`tests/phase-g6-research-ratings.test.ts`](../tests/phase-g6-research-ratings.test.ts) and all security/isolation regression tests in [`tests/portfolio-performance.test.ts`](../tests/portfolio-performance.test.ts) and [`tests/remote-ops-server-security.test.ts`](../tests/remote-ops-server-security.test.ts).

---

## 7. Remaining External Dependencies to Unlock Live Directional (`BUY` / `HOLD` / `SELL`) Ratings

To graduate `aci-stock-rating-v1.0.0-exp` from `Experimental research assessment` (`INSUFFICIENT DATA`) to live directional `BUY` / `HOLD` / `SELL` ratings in production, three external data dependencies must be provisioned:

1. **Licensed Adjusted Market-Data & Valuation Feed (Unlocks Dimension 1 — 30% Weight)**: Connect a licensed EOD or intraday equity feed (e.g., Polygon.io, LSEG, or Tiingo institutional license) providing split- and dividend-adjusted closes (`corporateActionsReviewed: true`), verified diluted share counts, and trailing 4-quarter (TTM) / forward consensus `EV/FCF` and `P/E` multiples.
2. **Minimum 252-Session (1-Year) Point-in-Time Price & Filing History (Unlocks Validation Gate)**: Expand the stored historical price and point-in-time SEC filing archive from the current 46 trading sessions (`2026-09-01` → `2026-11-05`) to at least 252 trading sessions across multiple market regimes.
3. **Complete Primary SEC XBRL Income & Cash-Flow Tables for `AMD`, `INTC`, and `CRWV` (Unlocks Dimension 2 — 25% Weight)**: Import full quarterly GAAP income statement and cash-flow statement packages for `AMD`, `INTC`, and `CRWV` so all 7 tracked equities have complete `Earnings & Financial Health` sub-scores alongside `NVDA`, `MSFT`, `AMZN`, and `GOOGL`.
