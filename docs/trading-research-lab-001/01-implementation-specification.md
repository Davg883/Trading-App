# 01 — Implementation specification

**Specification only; not implemented.** Builds on existing components wherever possible.

## 1. Architecture summary

```
                 ┌───────────────────────── Research application (existing, executionAuthority = none) ─────────────────────────┐
 Data adapters → │ Evidence store (Convex) → Feature/regime engine (deterministic) → Signal engine (3 strategies, deterministic) │
 (licensed)      │        ↑ point-in-time reads                     ↓                                                            │
                 │ AI research assistant (reads evidence only) → structured rationale + evidence ids (no sizes, no prices)       │
                 │                                   ↓                                                                           │
                 │ Decision record (TRADE / WAIT / REJECT) → pre-registration (hash-chained journal) → human review queue        │
                 └───────────────────────────────────┬───────────────────────────────────────────────────────────────────────────┘
                                                     │ approved order intents only (no credentials, no broker URLs)
                         ┌───────────────────────────▼─────────────────────────────┐
                         │ Paper execution service (separate deployment, demo only)│
                         │ model ledger fills  +  Trading 212 DEMO orders          │
                         └───────────────────────────┬─────────────────────────────┘
                                                     ▼
                              Fills, reconciliation, outcome evaluation, metrics, export
```

- The **research application keeps `DEPLOYMENT_EXECUTION_AUTHORITY = 'none'`**. It never holds an order-capable credential.
- Order intents go to a separately deployed paper execution service: option C in `docs/mvp-hardening-fable-52/04-research-only-execution-boundary.md`. That service can reach only `demo.trading212.com`. See `06-security-architecture.md`.

## 2. Universe

The universe is fixed at experiment registration and versioned. A change creates a new experiment version, and the old version's results are not merged into the new one.

- **Initial universe:** NVDA, AMD, AVGO, TSM (ADR), MSFT, GOOGL, AMZN, META, AAPL, INTC, MU, QCOM, CRWV, plus QQQ as the benchmark only. This is the existing `MARKET_DATA_SYMBOLS` set extended. Every symbol must also be available as a Trading 212 instrument; the demo instrument list is checked at registration.
- **Eligibility, checked at each decision:**
  - 20-session median dollar volume above US$500m;
  - price above US$10;
  - estimated spread at or below 10 bp;
  - not halted;
  - no corporate action pending within the holding window.

## 3. Inputs (see `03-data-source-assessment.md`)

| Input | Use | Point-in-time key |
|---|---|---|
| Intraday and daily OHLCV | Momentum, volatility, entries, exits, outcomes | Bar end time + provider receipt time |
| Corporate actions | Adjusting outcome prices | Effective date + announcement time |
| Earnings calendar and results | Post-earnings repricing; earnings blackout for the other two strategies | Scheduled time; release time |
| SEC filings (8-K Item 2.02, 10-Q, 10-K) | Expectation changes | EDGAR acceptance time + receipt time |
| Licensed news headlines and bodies | News momentum | Provider publication time + receipt time |
| Consensus estimates (optional, licensed) | Surprise measurement | Snapshot time |
| GBP/USD | GBP-adjusted returns | Rate timestamp |

Every observation is stored with `eventAt`, `publishedAt`, `receivedAt` and provider, licence and source identifiers. This extends the existing `marketObservations` and evidence tables.

## 4. Feature and regime engine (deterministic code)

All features are computed only from observations whose `receivedAt` is at or before the decision time:
- returns over 1, 5 and 20 sessions;
- gap size;
- relative volume (volume ÷ 20-session median for the same time of day);
- ATR(14);
- realised volatility (5d, 20d) and its 1-year percentile;
- distance from 20- and 50-day moving averages;
- relative strength against QQQ;
- regime label:
  - QQQ above or below its 50-day moving average;
  - QQQ 20-day realised volatility tercile;
  - semiconductor breadth (the share of universe names above their 20-day MA).

## 5. Strategies (each separately versioned, registered and evaluated)

All three strategies share these rules:
- Rules are deterministic.
- Entry happens at the **next tradable price after the decision timestamp**; never at a price observed before the decision.
- The stop distance is set from ATR.
- Every exit is either a target, the invalidation (stop) level, or the time limit.

| Strategy | Trigger (all must hold) | Entry | Invalidation | Exit |
|---|---|---|---|---|
| **S1 News momentum** | A material licensed news item or 8-K classified as expectation-raising, published in the last 60 min; price up at least 1.5% since the item; relative volume at least 2×; regime not "QQQ below 50-day MA and top-tercile volatility"; no earnings within 2 sessions | Next 1-min bar open after decision; limit at decision price + 0.2% | Low of the reaction bar, or 1.2 × ATR(14) below entry if tighter | +2R target, the invalidation level, or end of session 3 |
| **S2 Oversold recovery** | 5-session return at or below −8% with no company-specific negative filing or news in the window; price at least 2 ATR below the 20-day MA; regime "QQQ above 50-day MA"; first up-close day after the decline | Next session open | 1.0 × ATR below the decline low | Mean reversion to the 20-day MA, the invalidation level, or session 5 |
| **S3 Post-earnings repricing** | An earnings release is recorded (time-stamped); gap of at least 3% in the direction of a positive surprise measured from the evidence; the first 30 minutes of the regular session hold above the opening price | After 10:00 New York time on the first full session after release | Low of the first 30 minutes | +2R, the invalidation level, or session 5 |

Threshold values are **initial hypotheses**. They must be frozen at registration and cannot be tuned during the observation period.

## 6. AI research assistant role

The model **does not** decide sizes, prices or orders. For each candidate, it receives the point-in-time evidence bundle (existing `EvidenceBundleV1` pattern) and returns structured output:
- classification of the news or filing (expectation-raising, expectation-lowering, neutral, or not material);
- cited evidence identifiers;
- counter-evidence;
- a confidence category;
- an abstention when the evidence is insufficient.

Its output is validated by the existing evidence-locked validator, and its telemetry follows `lib/evaluation` rules. A provider failure becomes `WAIT` with the reason recorded, never `TRADE`.

## 7. Decision record (schema outline)

```ts
type LabDecision = {
  decisionId: string;            // uuid
  experimentId: string;          // e.g. lab-001-v1
  strategyId: 'S1' | 'S2' | 'S3';
  strategyVersion: string;       // frozen rule set hash
  symbol: string;
  decidedAtMs: number;           // server time
  decision: 'TRADE' | 'WAIT' | 'REJECT';
  reasonCodes: string[];         // e.g. 'relative_volume_below_threshold', 'model_abstained', 'risk_limit'
  evidenceBundleSha256: string;  // canonical digest (existing computeCanonicalSha256)
  evidenceIds: string[];
  modelTurnId: string | null;    // audit row of the AI classification, if any
  plan: null | {                 // deterministic, only for TRADE
    side: 'BUY';
    entryRule: string; limitPrice: number; plannedEntryReference: number;
    stopPrice: number; targetPrice: number | null; timeExitAtMs: number;
    quantity: number; plannedRiskGbp: number; plannedNotionalGbp: number;
    costEstimateGbp: number; fxRateUsed: number; fxRateObservedAtMs: number;
  };
  riskChecks: { rule: string; passed: boolean; detail: string }[];
  journalSequence: number; prevEntrySha256: string; entrySha256: string;
};
```

WAIT and REJECT decisions are recorded with the same evidence and a **shadow plan**: the hypothetical trade. This lets the filter's value be measured without trading.

## 8. Human review and override

- **Queue.** Every TRADE decision enters a review queue.
- **Two owner-selectable modes (P4):**
  - *approve-each*: no demo order is placed until a reviewer approves it;
  - *veto-window*: the demo order is placed after N minutes unless vetoed.
- **Override.** A reviewer may veto (record `human_override: vetoed`) or approve. They may also convert a WAIT to TRADE, which is recorded as a human-originated trade and evaluated separately from model-originated trades.
- **Original preserved.** An override never edits the original decision; it is a new journal entry referencing it.
- **Authority.** Reviewer authority uses the existing explicit reviewer-grant model (`convex/roles.ts`).

## 9. Components to build

| Component | Location | Reuses |
|---|---|---|
| Intraday price and FX adapters | `lib/market-data/` | `provider-adapter.ts`, `marketObservations` |
| News and earnings adapters | `lib/research-lab/sources/` | staging validator, receipt timestamps |
| Feature and regime engine | `lib/research-lab/features.ts` | `lib/portfolio/financial-arithmetic.ts` |
| Strategy engines S1–S3 | `lib/research-lab/strategies/` | — |
| Risk engine | `lib/research-lab/risk.ts` | `lib/trading/order-model.ts` risk gate pattern |
| Journal (hash-chained, append-only) | `convex/labJournal.ts` | audit table; canonical SHA-256 |
| Decision, review, outcome functions | `convex/lab*.ts` | roles, owner scoping, budget reservations for model calls |
| Outcome evaluator and metrics | `lib/research-lab/evaluation.ts` | `forward-research.ts`, `missing-evidence-resolver.ts`, `performance.ts` |
| Paper execution service | **separate deployment** | `trading212-orders.ts` (demo-only build), claim/reconcile state machine from `convex/trading.ts` |
| UI: lab dashboard, review queue, journal export | `app/research-lab/` | — |

## 10. Phases

| Phase | Scope | Exit criterion |
|---|---|---|
| L0 | Prerequisites P1–P5 | All recorded |
| L1 | Data adapters, point-in-time store, feature engine; no decisions | 10 sessions of complete, timestamped data with latency measured |
| L2 | Strategies, decisions, journal, model-ledger fills; no broker | Acceptance tests A1–A9 pass; decisions recorded before outcomes |
| L3 | Paper execution service (demo only), human review | Acceptance tests A10–A14 pass; security review of the service |
| L4 | Observation: 30 sessions, at least 30 qualifying opportunities | Exploratory report; no profitability claim |
| L5 | Extended observation to the pre-registered sample size (`05` §6) | Confirmatory report |
