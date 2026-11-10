# 08 — Financial and interface integrity

**Work package:** WP8, commit `866d780`
**Status:** IMPLEMENTED LOCALLY / PENDING DEPLOYMENT (V2). No screenshots were taken and no brokerage data was viewed.

## 1. Hard-coded inputs found

| Input | Where | Previous label | Now |
|---|---|---|---|
| Sterling cash carry 3.99 % (SONIA reference) | Inside `calculatePortfolioConcentrationIntelligence` | None (silent constant) | `ILLUSTRATIVE_GBP_CASH_CARRY`: status `illustrative`, source, as-of 6 Nov 2026; exposed on every report as `cashCarryInput` |
| Bank Rate 4.00 %, SONIA 3.9852 %, gilt yields 4.1–4.42 %, durations, OCFs, ETF look-through weights | `PHASE_G8_MULTI_ASSET_UNIVERSE` and scenario tables | `dataCoverageStatus: 'verified_primary_or_reference'` | `hand_entered_reference_unverified`; `MULTI_ASSET_INPUT_PROVENANCE` states they are illustrative, not refreshed and not re-verified |
| Scenario shocks and cash yields per scenario | `PHASE_G8_STRESS_SCENARIOS` | Presented as analysis | Unchanged values; covered by the illustrative provenance note |
| Equity closes, FX | `marketObservations` (collector) or registered source packages | Labelled delayed / unlicensed | Unchanged (already labelled correctly) |

Live licensed data was not obtained (no purchase authority). Replacing illustrative inputs requires an official or licensed feed with stored observation times.

## 2. Fixture versus live account

| Defect | Fix |
|---|---|
| `evaluatePhaseG8MultiAssetPilot().ownerLiveAccountRiskSummary` returned a hard-coded £250 balance labelled `trading212_live_read_only` with a fixed timestamp | `accountSource: 'development_fixture_not_live'` and a notice that it is not read from any account |
| The calculator decided "fixture" from the amount held (exactly £250 and no positions) | Source must be explicit. A real account holding £250 is not mislabelled; unlabelled input is never treated as live |
| Any non-fixture input was `fresh` and `connected` with no timestamp | A live snapshot is `fresh` only with a retrieval time within 24 h; otherwise `stale` or `unavailable`/`disconnected` |
| Dashboard tab "Owner Live Account (£250 Cash Baseline)" | "Development Fixture (Not Live)", or "Your Trading 212 Account (Read-Only)" when a snapshot is supplied |
| Freshness pill hard-coded "Fresh (<15m)" | Derived from the report |
| Pre-written answers headed "Evidence-Locked Explanations" and one stating "Your Trading 212 live account currently holds £250.00" with citation `trading212-live-snapshot` | Headed "Pre-written Risk Explanations" with a notice that they are fixed text, not model output, and do not read the account; the account-specific claim and citation removed |

Note: `app/portfolio/page.tsx` never passes a live snapshot, so the portfolio page always shows the fixture. Showing real holdings there needs a deliberate, authenticated server-side snapshot read, which was not added.

## 3. Deterministic arithmetic (`lib/portfolio/financial-arithmetic.ts`)

All figures are computed in code. Tested functions: duration price return (with optional convexity), DV01 per basis point, FX translation for a GBP investor (compounded, sign conventions for cable), cash scenario (zero instantaneous shock, separate forward carry, `null` when the rate is unavailable), market P/L excluding external flows, concentration (HHI, top 3, unpriced positions reported), and freshness classification (missing or future timestamps are never fresh).

The existing pilot DV01 field (`dv01Per100BpsParallelShiftGbp = value × duration / 100`) was checked and is correct for a 100 bp move.

## 4. Tests (`tests/financial-integrity.test.ts`, 16 tests)

Duration and DV01 (2.15 y and 8.35 y at +150 bp; DV01 × 150 equals the duration approximation); dollar appreciation versus depreciation and compounding; cash carry versus instantaneous shock and the pilot's illustrative carry input; withdrawals versus market losses (including the stored-valuation P/L function); concentration with a missing price; stale and missing timestamps; the £250 mislabelling cases; the G.8 fixture label; universe status; dashboard text.

## 5. Product review notes (code-level only; no browser session was run)

- Data Room independent scrolling: the files changed in this review do not touch `data-room.css` or the drawer layout; the earlier fix is preserved.
- Homepage Market Radar falls back to static registered packages when the operations overview is unavailable; the watchlist shows the source string for each price.
- Not assessed in a browser: mobile layout, keyboard accessibility, loading and error states. These need a Playwright pass against a preview deployment before a pilot.
- Investor demonstrations should use the fixture or educational models, never a real account.
