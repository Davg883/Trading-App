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
  plan: null | {                 // the AI's proposed trade (owner decision D3); deterministic; only for TRADE
    side: 'BUY';
    entryRule: string; limitPrice: number; plannedEntryReference: number;
    entryConditions: string[];   // the frozen trigger conditions that held at decidedAtMs
    stopPrice: number;           // invalidation level
    targetPrice: number | null; timeExitAtMs: number;
    exitConditions: string[];    // target, invalidation and time rules, as frozen at registration
    quantity: number; plannedRiskGbp: number; plannedNotionalGbp: number;  // intended position size
    costEstimateGbp: number; fxRateUsed: number; fxRateObservedAtMs: number;
  };
  decisionExpiresAtMs: number | null;  // TRADE only: latest time an approval can be acted on (§8.1)
  riskChecks: { rule: string; passed: boolean; detail: string }[];  // against the shadow record's state (02 §6)
  journalSequence: number; prevEntrySha256: string; entrySha256: string;
};
```

WAIT and REJECT decisions are recorded with the same evidence and a **shadow plan**: the hypothetical trade. This lets the filter's value be measured without trading.

**Recorded before human intervention (owner decision D3).**
- The decision entry is written to the journal by the decision function itself, in the same transaction that creates it.
- The review queue reads only journaled entries, so a reviewer cannot see a proposal that has not already been recorded.
- The decision carries no reviewer-editable field.

## 8. Human review (owner decision P4: approve-each only)

The *veto-window* mode is **withdrawn** (`08-owner-decision-p4.md`). There is exactly one mode in Phase A: **no demo order exists until a named reviewer explicitly approves that decision.** No timer, default, expiry or configuration value can cause an order.

### 8.1 Queue and expiry

- Every TRADE decision enters the review queue when it is journaled.
- `decisionExpiresAtMs` is the **entry-authorisation expiry**. It is computed once, when the decision is journaled, and stored on the decision.
- **Provisional rules** (owner decision, 11 November 2026; `08` §4):

| Strategy | Candidate type | Entry-authorisation expiry |
|---|---|---|
| S1 News momentum | Any | 15 minutes after `decidedAtMs`, **or earlier if invalidated**: the price reaches the invalidation (stop) level, or trades above the plan's limit price, before an entry fill |
| S2 Oversold recovery | Pre-market opening candidate (`decidedAtMs` before 09:30 New York on the entry session) | 10:00 America/New_York on the entry session |
| S2 Oversold recovery | Regular-session candidate | 15 minutes after `decidedAtMs` |
| S3 Post-earnings repricing | Pre-market candidate | 11:00 America/New_York on the entry session |
| S3 Post-earnings repricing | Later regular-session signal | 15 minutes after `decidedAtMs` |

- **Calculation:**
  - Times use the IANA zone `America/New_York`, so daylight-saving changes are handled, and the exchange calendar sets trading days and early closes.
  - An expiry never crosses into another session. It is capped at the session's last permitted entry time (`02` §2).
- **Hard rules:**
  - **No extension.** No automatic extension, renewal or re-issue of a decision exists. A reviewer cannot extend an expiry; a new signal requires a new decision from the strategy engine.
  - **No automatic approval.** Expiry never converts to approval.
  - **No action after expiry.** An approval received after expiry, or after the S1 invalidation, is **refused**. No order intent may be issued after expiry, and the paper service refuses one whose decision has expired.
- **Missed opportunities.**
  - At expiry, an unreviewed decision receives a `review_expired` event and becomes a missed opportunity.
  - An S1 decision invalidated before approval receives `review_expired` with reason `invalidated`.
- **Separate from exit rules.** Expiry governs only whether a new entry may be authorised and placed.
  - The demo entry order carries a good-till time no later than the expiry, and the paper service cancels any unfilled remainder at expiry (`order_missed`, or a partial fill).
  - Once any quantity has filled, that position is governed only by the plan's exit conditions (target, invalidation, time exit). Expiry never closes, shortens or extends a position.
  - The 60-second order-intent expiry (`06` §4) is a separate transport control.
- **Freeze and review.**
  - The rules are hashed into `strategyVersion` at formal registration and cannot change during an observation period.
  - They are reviewed only with forward-recorded evidence: review latency, the `review_expired` rate, the `order_missed` rate and the delay effect (`05` §4). Any change starts a new strategy version.

### 8.2 Review events (owner decision D5)

Each event is a new journal entry referencing the decision's `entrySha256`. It records the reviewer's identity, the time, and the latency from `decidedAtMs`.

| Event | Meaning | Effect on the human-approved record |
|---|---|---|
| `approved` | Order the plan as proposed | Order intent issued for the original plan |
| `amended` | Order a changed plan. The amended plan is a complete new plan with its own hash and a mandatory reason. It must pass the risk engine against the human-approved record's state, and cannot increase planned risk or notional above the proposal or any limit in `02`. | Order intent issued for the amended plan |
| `rejected` | Do not trade; mandatory reason code | No trade |
| `deferred` | Reviewer postpones the decision with a note. A deferral is not an approval, and the expiry still applies. | None until a later event |
| `review_expired` | No decision before expiry (system event) | No trade; counted as a missed opportunity |
| `order_missed` | Approved, but the limit was not reached or the order otherwise did not fill before the entry rule lapsed | No trade; counted as a missed opportunity, separately from `review_expired` |
| `converted_wait_to_trade` | Reviewer originates a trade from a WAIT decision | Human-originated cohort only; never in the shadow record |

Delay is not a separate event. It is the measured latency of every review event, and its price effect is attributed in `05` §4.

### 8.3 Immutability of the AI signal (owner decision D6)

- Review events can only **add** entries. No function updates or deletes a decision entry (`06` §5).
- The autonomous shadow record is computed **only** from the original decision entries. It never reads review events.
- Amending a plan never changes the original plan or its hash.

### 8.4 Authority

- Reviewer authority uses the existing explicit reviewer-grant model (`convex/roles.ts`).
- The model and the strategy engines cannot create review events.

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

### 10.1 Owner phases (decision P4)

| Owner phase | L-phases | Scope | Gate |
|---|---|---|---|
| **A** (initial release) | L0–L5 | Explicit approval of every demo order. Both performance records are kept from the first decision. | This specification, after P1–P5 and the phase exit criteria |
| **B** (later) | After L4, using L4/L5 data | A comparison report: autonomous shadow versus human-approved execution (`05` §4). Analysis only; no change to execution. | Report review; no profitability claim beyond `05` §6 |
| **C** (later, not authorised) | — | Fully automatic **demo-only** execution | A separate owner decision, plus a separate security, reliability and risk acceptance. **Not specified here.** Phase A must not contain a dormant path for it (`07` A21). |

No phase grants live-money authority. The research application keeps `executionAuthority = none` in every phase.
