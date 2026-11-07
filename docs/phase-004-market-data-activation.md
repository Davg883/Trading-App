# AI Capital Intelligence — Phase 004: Market Data Activation

## Objective & Architecture Summary

Phase 004 connects an authorised US equity & benchmark market-data adapter to the existing Convex Cloud research infrastructure (`https://prestigious-dragon-8.eu-west-1.convex.cloud` / `https://prestigious-dragon-8.eu-west-1.convex.site`) using the established collector, staging, provenance, health-monitoring and portfolio-outcome modules — without introducing a second scheduling system or rebuilding existing modules.

Key guarantees preserved:
1. **No Trading 212 Position-Price Substitution**: [`assertNotTrading212PositionPrice`](file:///C:/GPT%205%20CODEX/Trading%20app/lib/market-data/provider-adapter.ts#L244-L253) strictly rejects any attempt to substitute Trading 212 portfolio-position snapshots for a market-data feed.
2. **Exact Provenance & Feed Delay Metadata**: Every stored row in [`marketObservations`](file:///C:/GPT%205%20CODEX/Trading%20app/convex/schema.ts#L597-L633) retains exact regular-session exchange close timestamps (`eventAt`, 16:00 `America/New_York`), authoritative server receipt timestamps (`serverReceivedAt`), source identifiers (`sourceId`, `sourceUrl`, `provider`), adjustment basis (`priceBasis`, `adjustmentVersion`, `corporateActionsReviewed`), feed delay (`declaredDelayMs`), and paired USD→GBP reference rates (`usdToGbp`, `closeGbp`, `fxCloseAligned`).
3. **Missing Evidence Resolver**: [`resolveMissingEvidenceAndOutcomes`](file:///C:/GPT%205%20CODEX/Trading%20app/lib/market-data/missing-evidence-resolver.ts#L451-L505) enumerates absent prices, FX observations, corporate actions, and transaction-cost parameters across registered research windows, automatically recalculates USD and GBP returns once all required observations exist, and **never scores incomplete or unelapsed windows**.
4. **Genuine Forward Research & Multi-Provider Tournament**: [`createAndRunForwardResearchEvent`](file:///C:/GPT%205%20CODEX/Trading%20app/lib/market-data/forward-research.ts#L601-L743) registers forward research events using trusted server receipt timestamps (`serverReceivedAt <= cutoffAt <= registeredAt < targetEndAt`), runs two real model providers (`openai` and `anthropic`) alongside deterministic (`deterministic-sec-momentum-v1`) and neutral (`neutral-abstention-v1`) baselines over the identical SHA-256 frozen evidence bundle (`evidenceSha256`), preserves actual token usage and billed/estimated costs, and evaluates outcomes only after authentic post-horizon observations arrive.
5. **Execution Safeguards Unchanged**: `LIVE_TRADING_ENABLED=false` and `DEMO_TRADING_ENABLED=false` remain enforced; remote research jobs and market-data collectors hold `executionAuthority: 'none'`.

---

## Stage 1 — Provider Assessment

Implemented in [`PROVIDER_ASSESSMENT_MATRIX`](file:///C:/GPT%205%20CODEX/Trading%20app/lib/market-data/provider-adapter.ts#L71-L157) in [provider-adapter.ts](file:///C:/GPT%205%20CODEX/Trading%20app/lib/market-data/provider-adapter.ts).

| Criterion | 1. Nasdaq Official Historical API + ECB/BoE FX (Active £0/mo Tier) | 2. Tiingo EOD + IEX Real-Time & FX API (Recommended Paid/Starter Upgrade) | 3. Polygon.io (Massive) Stocks Basic / Starter | 4. Alpaca Market Data API (Basic IEX / Algo Trader Plus) | 5. Financial Modeling Prep (FMP) Starter |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **UK Customer Availability & Pricing** | Available in UK at **£0/mo** (no paid subscription required) | Available in UK at **\$0/mo Starter** (personal) or **\$10/mo (~£7.80/mo) Power** | Available in UK at **\$0/mo Basic** (5 req/min) or **\$29/mo (~£22.60/mo) Starter** | Available in UK at **\$0/mo Basic (IEX)** or **\$99/mo (~£77/mo) SIP** | Available in UK at **\$0/mo Basic** or **\$29/mo (~£22.60/mo) Starter** |
| **Real-Time vs. Delayed Quotes** | Official daily regular-session OHLCV close (`declaredDelayMs: 900,000`) | Real-time IEX top-of-book & last trade (`declaredDelayMs: 0`) + official EOD | 15-minute delayed SIP on Starter (`declaredDelayMs: 900,000`); EOD on Basic | Real-time IEX subset on Basic (`declaredDelayMs: 0`); full SIP on \$99/mo tier | 15-minute delayed / EOD on Starter (`declaredDelayMs: 900,000`) |
| **Historical Daily & Intraday Coverage** | 10+ years daily OHLCV bars; no intraday bars | 30+ years daily EOD OHLCV + split/dividend factors; 5+ years intraday IEX 1m/5m/15m | 2 years (Basic) to 5 years (Starter) daily & 1-minute intraday aggregates | 5+ years daily & 1-minute intraday bars since 2016 | 5 years daily EOD on Starter (250 req/day limit on Basic) |
| **Corporate Actions & Adjusted Prices** | Unadjusted daily `Close/Last` (`priceBasis: unadjusted_close`, `corporateActionsReviewed: false`) | Full split & cash-dividend adjusted series (`adjClose, divCash, splitFactor`, `corporateActionsReviewed: true`) | Split-adjusted aggregates + `/v3/reference/splits` & `/v3/reference/dividends` (`corporateActionsReviewed: true`) | Raw, split, dividend, or total-return adjusted bars + corporate actions endpoint | Split-adjusted EOD + historical dividends/splits endpoints |
| **API Request Limits** | Enforced at ≤10 req/min, ≤15 req/run via [`ProviderRequestBudget`](file:///C:/GPT%205%20CODEX/Trading%20app/lib/market-data/provider-adapter.ts#L258-L284) (9 requests/run for 8 symbols + FX) | Starter: 50 req/hr, 1,000 req/day; Power (\$10/mo): 5,000 req/hr, 50,000 req/day | Basic: 5 req/min; Starter (\$29/mo): unlimited fair-use | Basic: 200 req/min; Algo Trader Plus: 10,000 req/min | Basic: 250 req/day; Starter: 300 req/min |
| **Redistribution & Dashboard-Display Rights** | Personal single-owner research reference display only; redistribution prohibited | Single-user personal dashboard display permitted under internal research terms | Personal non-professional display only; redistribution prohibited | Internal personal dashboard display permitted; redistribution prohibited | Personal research use only; redistribution prohibited |
| **Commercial vs. Personal Research Permissions** | Personal / internal non-commercial research only; not licensed for trade execution | Explicit personal & internal research license on Starter (\$0) and Power (\$10/mo) | Non-professional personal use on Basic/Starter; commercial requires Business (\$199+/mo) | Personal & proprietary research permitted | Personal use only on Starter |
| **GBP/USD Conversion Coverage** | Paired with ECB (`api.frankfurter.app`) & Bank of England (`XUDLUSS`) daily USD→GBP reference rates | Native `gbpusd` spot & historical daily/intraday FX feed (`/tiingo/fx/gbpusd/prices`) | Requires Currencies tier (`C:GBPUSD`) or ECB/BoE FX pairing | No native GBP/USD spot FX in US equities API (requires ECB/BoE pairing) | FX quote endpoint included on paid tiers |
| **Universe (`NVDA, MSFT, GOOGL, AMZN, INTC, AMD, CRWV`) & `QQQ` Coverage** | **8/8 covered** (`assetclass=stocks` for 7 equities, `assetclass=etf` for `QQQ`) | **8/8 covered** (including March 2025 IPO `CRWV` and `QQQ`) | **8/8 covered** | **8/8 covered** (IEX venue subset on Basic) | **8/8 covered** |

### Cost-Effective Recommendation
- **Active Zero-Cost Tier (£0/month)**: **Nasdaq Official Historical Quote API + ECB/BoE USD/GBP Reference FX** (`nasdaq_public_historical`) is activated immediately with zero paid subscription required. It provides daily OHLCV closes across all 8 required symbols (`NVDA, MSFT, GOOGL, AMZN, INTC, AMD, CRWV, QQQ`) paired with daily USD→GBP conversion rates, while explicitly tagging observations as `priceBasis: 'unadjusted_close'` and `corporateActionsReviewed: false` so studies requiring audited corporate-action adjustments (such as Recovery Case 006) remain honestly blocked rather than scored on unreviewed data.
- **Recommended Paid/Starter Upgrade (\$0 Starter / \$10/mo ~£7.80/mo Power)**: **Tiingo EOD + IEX Real-Time & FX API** (`tiingo_iex_eod`) is the most cost-effective licensed upgrade for a UK personal researcher. Setting `TIINGO_API_KEY` in the Convex Cloud environment automatically switches [`resolveMarketProviderConfig`](file:///C:/GPT%205%20CODEX/Trading%20app/lib/market-data/provider-adapter.ts#L303-L353) to `tiingo_iex_eod` (`priceBasis: 'total-return'`, `corporateActionsReviewed: true`, `licensed: true`), or setting `MASSIVE_API_KEY` switches to `polygon_massive_aggs`.

---

## Stage 2 — Provider Adapter & Provenance Integration

- **Adapter Implementation**: [`collectUniverseMarketObservations`](file:///C:/GPT%205%20CODEX/Trading%20app/lib/market-data/provider-adapter.ts#L488-L690) in [provider-adapter.ts](file:///C:/GPT%205%20CODEX/Trading%20app/lib/market-data/provider-adapter.ts) collects daily OHLCV observations for `NVDA, MSFT, GOOGL, AMZN, INTC, AMD, CRWV` and `QQQ`, converts each regular-session close date to exact 16:00 `America/New_York` UTC epoch milliseconds via [`usRegularSessionCloseAt`](file:///C:/GPT%205%20CODEX/Trading%20app/lib/market-data/provider-adapter.ts#L369-L390) (handling US EDT/EST transitions), pairs each session with the most recent USD→GBP rate on or before that session date via [`matchFxRateForSession`](file:///C:/GPT%205%20CODEX/Trading%20app/lib/market-data/provider-adapter.ts#L467-L482), and validates every record through [`authorisedMarketObservationSchema`](file:///C:/GPT%205%20CODEX/Trading%20app/lib/market-data/provider-adapter.ts#L204-L238).
- **Convex Cloud Persistence**: [`storeMarketObservationsInternal`](file:///C:/GPT%205%20CODEX/Trading%20app/convex/operations.ts#L1177-L1317) in [operations.ts](file:///C:/GPT%205%20CODEX/Trading%20app/convex/operations.ts) stores deduplicated records in [`marketObservations`](file:///C:/GPT%205%20CODEX/Trading%20app/convex/schema.ts#L597-L633) and synchronises non-synthetic rows in `quotes`.
- **Cloud Scheduler Integration**: [`runMarketDataCollector`](file:///C:/GPT%205%20CODEX/Trading%20app/convex/remoteOpsCloud.ts#L140-L246) in [remoteOpsCloud.ts](file:///C:/GPT%205%20CODEX/Trading%20app/convex/remoteOpsCloud.ts) runs inside the existing Convex Cloud scheduled cycle (`runScheduledCycle`), using deterministic cursor change-detection (`mkt:v4:...`) to skip redundant storage writes when session closes are unchanged.

---

## Stage 3 — Missing Evidence Resolver

- **Implementation**: [`resolveMissingEvidenceAndOutcomes`](file:///C:/GPT%205%20CODEX/Trading%20app/lib/market-data/missing-evidence-resolver.ts#L451-L505) and [`resolveWindowMissingEvidence`](file:///C:/GPT%205%20CODEX/Trading%20app/lib/market-data/missing-evidence-resolver.ts#L193-L370) in [missing-evidence-resolver.ts](file:///C:/GPT%205%20CODEX/Trading%20app/lib/market-data/missing-evidence-resolver.ts).
- **Behaviour Across Registered Windows**:
  - `policy-001.2:ai-hyperscalers-chips:1d` (`2026-11-03` → `2026-11-04`, 7 equities `NVDA, MSFT, GOOGL, AMZN, INTC, AMD, CRWV` vs `QQQ`): **Complete & Scored** (`complete_scored`) — all 7 equity closes, `QQQ` benchmark closes, and ECB USD/GBP rates are present; USD and GBP equal-weight and excess returns are automatically recalculated.
  - `policy-001.2:ai-hyperscalers-chips:2d` (`2026-11-03` → `2026-11-05`, 7 equities vs `QQQ`): **Complete & Scored** (`complete_scored`) — automatically recalculated in both USD and GBP.
  - `recovery-006:immediate-plan:1d` (`2026-11-03` → `2026-11-04`, `MSFT, NVDA, GOOGL, AMZN` vs `QQQ`): **Blocked on Missing Evidence** (`incomplete_blocked`, `scored: false`, `outcome: null`) — although raw closes exist, Case 006 requires `corporateActionsReviewed: true`, 21:00 UTC close-aligned licensed FX (`fxCloseAligned: true`), and disclosed transaction-cost parameters (`commissionBps`, `fxSpreadBps`, `slippageBps`). The resolver enumerates all three gap categories and refuses to score the window.
  - `policy-001.2:ai-hyperscalers-chips:5d` (`2026-11-03` → `2026-11-10`) and `forward-004:forward-004-nvda-qqq-5d-2026-11-05` (`2026-11-05` → `2026-11-12`): **Horizon Not Elapsed** (`horizon_not_elapsed`, `scored: false`, `outcome: null`) — future target session dates have not yet occurred.

---

## Stage 4 — Forward Research Registration & Multi-Provider Tournament

- **Implementation**: [`createAndRunForwardResearchEvent`](file:///C:/GPT%205%20CODEX/Trading%20app/lib/market-data/forward-research.ts#L601-L743) and [`evaluateForwardResearchEvent`](file:///C:/GPT%205%20CODEX/Trading%20app/lib/market-data/forward-research.ts#L483-L595) in [forward-research.ts](file:///C:/GPT%205%20CODEX/Trading%20app/lib/market-data/forward-research.ts), persisted via [`storeForwardResearchEventInternal`](file:///C:/GPT%205%20CODEX/Trading%20app/convex/operations.ts#L1324-L1464) in [operations.ts](file:///C:/GPT%205%20CODEX/Trading%20app/convex/operations.ts).
- **Registered Forward Event**: `forward-004-nvda-qqq-5d-2026-11-05` (*Phase 004 Forward Tournament · NVDA vs QQQ 5-Session Excess Return (2026-11-05 → 2026-11-12)*).
  - **Trusted Server Timestamps**: Enforces `serverReceivedAt <= cutoffAt <= registeredAt < targetEndAt` (`targetEndAt = 2026-11-12T21:00:00.000Z`). Backdated registration is rejected.
  - **Frozen Evidence Bundle**: Canonical JSON SHA-256 (`evidenceSha256`) over the pre-cutoff `NVDA` and `QQQ` market close observations and SEC XBRL disclosures.
  - **4 Tournament Participants on Identical `evidenceSha256`**:
    1. `openai`: Invokes OpenAI Chat Completions when `OPENAI_API_KEY` is configured in the server secret store (capturing prompt/completion tokens and billed/estimated GBP cost), or records honest `configuration_missing` (`£0.00` cost) without fabricating synthetic LLM output.
    2. `anthropic`: Invokes Anthropic Messages API when `ANTHROPIC_API_KEY` is configured in the server secret store, or records honest `configuration_missing` (`£0.00` cost).
    3. `deterministic_baseline` (`deterministic-sec-momentum-v1`): Rule-based relative momentum + SEC XBRL baseline forecast (`succeeded`, `£0.00` cost).
    4. `neutral_baseline` (`neutral-abstention-v1`): Equal-prior `[0.3333, 0.3333, 0.3334]`, `0.00%` expected excess return abstention baseline (`succeeded`, `£0.00` cost).
  - **Post-Horizon Evaluation**: Remains `awaiting_post_horizon_observations` until authentic observations with `eventAt === targetEndAt` and `serverReceivedAt >= targetEndAt` are ingested into `marketObservations`, at which point [`storeMarketObservationsInternal`](file:///C:/GPT%205%20CODEX/Trading%20app/convex/operations.ts#L1275-L1303) automatically computes realized USD/GBP excess returns, Brier scores, and interval coverage.

---

## Stage 5 — Operational Acceptance Evidence (`localhost:3000` Stopped)

Verified via [`scripts/verify-cloud-operations.mjs`](file:///C:/GPT%205%20CODEX/Trading%20app/scripts/verify-cloud-operations.mjs) against `https://prestigious-dragon-8.eu-west-1.convex.cloud` and `https://prestigious-dragon-8.eu-west-1.convex.site` with `localhost3000Serving: false`:

1. **Unattended Cloud Price Collection**:
   - **Cycle 1 (`cloud-market_data_collect-1793991801670`)**: `status: 'succeeded'`, `inserted=32, total=32, scoredWindows=2, reqs=9` across all 8 required symbols (`NVDA, MSFT, GOOGL, AMZN, INTC, AMD, CRWV, QQQ`) + 1 ECB USD/GBP FX range request (`0.74299` on `2026-11-05`).
   - **Cycle 2 (`cloud-market_data_collect-1793991822030`)**: `status: 'succeeded'`, `inserted=0, total=32, scoredWindows=2, reqs=9` (idempotent deduplication; zero duplicate rows created).
   - **Latest Stored Observations by Symbol (`2026-11-05`, `eventAt = 2026-11-05T21:00:00.000Z`, `serverReceivedAt = 2026-11-06T19:03:21.670Z`, `usdToGbp = 0.74299`)**:
     - `NVDA`: `\$181.60` (`£134.9270`) · `sourceId: nasdaq-historical-nvda-2026-11-05`
     - `MSFT`: `\$535.93` (`£398.1906`) · `sourceId: nasdaq-historical-msft-2026-11-05`
     - `GOOGL`: `\$282.57` (`£209.9467`) · `sourceId: nasdaq-historical-googl-2026-11-05`
     - `AMZN`: `\$260.21` (`£193.3334`) · `sourceId: nasdaq-historical-amzn-2026-11-05`
     - `INTC`: `\$52.25` (`£38.8212`) · `sourceId: nasdaq-historical-intc-2026-11-05`
     - `AMD`: `\$404.40` (`£300.4652`) · `sourceId: nasdaq-historical-amd-2026-11-05`
     - `CRWV`: `\$43.66` (`£32.4389`) · `sourceId: nasdaq-historical-crwv-2026-11-05`
     - `QQQ`: `\$647.05` (`£480.7517`) · `sourceId: nasdaq-historical-qqq-2026-11-05`
2. **Missing Evidence Resolver & GBP-Compatible Outcome Calculations**:
   - `policy-001.2:ai-hyperscalers-chips:1d` (`2026-11-03` → `2026-11-04`): `complete_scored`, `equalWeightReturnUsd = +0.0212%`, `equalWeightReturnGbp = -0.6387%`, `benchmarkReturnUsd = +0.9733%`, `excessReturnUsd = -0.9521%`, `excessReturnGbp = -0.9458%`.
   - `policy-001.2:ai-hyperscalers-chips:2d` (`2026-11-03` → `2026-11-05`): `complete_scored`, `equalWeightReturnUsd = -7.6372%`, `equalWeightReturnGbp = -7.9692%`, `benchmarkReturnUsd = -5.5787%`, `excessReturnUsd = -2.0585%`, `excessReturnGbp = -2.0511%`.
   - `recovery-006:immediate-plan:1d`: `incomplete_blocked` (`scored: false`, `outcome: null`) — blocked on corporate-action review, 21:00 UTC close-aligned FX, and 7 undisclosed transaction-cost parameters.
   - `policy-001.2:ai-hyperscalers-chips:5d` & `forward-004:forward-004-nvda-qqq-5d-2026-11-05`: `horizon_not_elapsed` (`scored: false`, `outcome: null`).
3. **Registered Forward Research Event (`forward-004-nvda-qqq-5d-2026-11-05`)**:
   - `registeredAt = 2026-11-06T19:03:21.670Z`, `cutoffAt = 2026-11-06T19:03:21.670Z`, `anchorSessionDate = 2026-11-05`, `targetEndSessionDate = 2026-11-12`.
   - `evidenceSha256 = 652b11db649cbb6d18cfb9a56ee7ade3b9cd1455446799f1dffc6d4ab926e05a`.
   - `evaluationStatus = awaiting_post_horizon_observations`.
4. **Portfolio Command Centre Visibility & Execution Safeguards**:
   - Verified across `390px`, `768px`, `1440px` and `1920px` viewports via [`scripts/command-centre-browser-check.mjs`](file:///C:/GPT%205%20CODEX/Trading%20app/scripts/command-centre-browser-check.mjs), [`scripts/trading-browser-check.mjs`](file:///C:/GPT%205%20CODEX/Trading%20app/scripts/trading-browser-check.mjs) and [`scripts/broker-browser-check.mjs`](file:///C:/GPT%205%20CODEX/Trading%20app/scripts/broker-browser-check.mjs).
   - Live and Demo order submission remain disabled (`LIVE_TRADING_ENABLED=false`, `DEMO_TRADING_ENABLED=false`, `executionAuthority='none'`).

