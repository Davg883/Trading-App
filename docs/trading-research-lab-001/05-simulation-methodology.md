# 05 — Simulation methodology

## 1. Principles

1. **Forward recording only.** Every decision (TRADE, WAIT or REJECT) is written to the journal, with its evidence digest, **before** any price after the decision time is observed. Backtests may be used to sanity-check code, but are never reported as evidence of performance.
2. **Point-in-time evidence.**
   - An observation is usable only if its `receivedAt` is at or before the decision time. News or filings published earlier but received later are excluded, and the exclusion is counted.
   - This reuses `selectPointInTimeEvidence` (receipt basis) and the frozen-bundle digest from `lib/market-data/forward-research.ts`.
3. **No backfill, no revision.**
   - A missing observation stays missing, and outcome windows that depend on it are marked `blocked_incomplete` (the existing missing-evidence resolver).
   - A correction is a new journal entry that references the original. The original is never edited.
4. **Frozen rules.** Strategy thresholds, the universe, cost parameters and the risk model are hashed into `strategyVersion` and `experimentId` at registration. Any change starts a new version, and results are never pooled across versions.
5. **Survivorship.** The universe is fixed at registration, and delisted or halted names stay in the denominators.

## 2. Two performance records (owner decision P4) and two fill ledgers

The two **performance records** are kept separately from the first decision. They are never pooled.

| Record | Contains | Source of trades | Fills |
|---|---|---|---|
| **R1: autonomous shadow strategy** | What would have happened with no human intervention | Every TRADE decision exactly as journaled, at its `decidedAtMs`, with its original plan; no approval, rejection or amendment is ever read; it obeys every market, data, risk, expiry and execution restriction that R2 obeys (§2.2) | Model ledger only |
| **R2: human-approved demo strategy** | What actually happened | Approved and amended orders, entered at approval time; rejected, expired, invalidated, blocked and unfilled decisions appear as no trade; human-originated trades are a separate cohort | Demo ledger (actual fills), with a model-ledger fill at the approval time for comparison |

Each record has its own equity curve, risk state and halts (`02` §6). The two **fill ledgers** below are the fill rules used to price them.

### 2.1 Fill ledgers

| Ledger | Fill rule | Purpose |
|---|---|---|
| **Model ledger** (deterministic) | **Market entry:** next 1-min bar open after the decision, plus the slippage parameter. **Limit:** filled only if the bar trades through the limit by at least one tick; otherwise "missed". **Stop:** first bar whose low reaches the stop, filled at min(stop, bar open). **Time exit:** last regular-session bar of the exit session | Reproducible reference result |
| **Demo ledger** (Trading 212 demo) | Actual demo fills and timestamps | Execution-feasibility check |

For every trade, the record compares the intended price, the model fill and the demo fill. The difference between them is a reported metric.

Demo fills are **not** evidence of live fill quality: demo matching may differ from the live market. Neither ledger is a live result.

### 2.2 Shadow portfolio realism (owner decision, `08` §6)

R1 differs from R2 in exactly one respect: no human approves, amends, rejects or delays its entries. In every other respect it obeys the same rules:

| Rule | Applied to R1 |
|---|---|
| Market session and exchange halts | No R1 fill outside a permitted session window or while the symbol is halted; the same session-timing rules as `02` §2 |
| Data freshness | An R1 entry needs fresh data at the fill bar. Stale or unverified data gives `entry_blocked`, as in R2 |
| Deterministic risk limits | Every limit and halt in `02`, evaluated against R1's own state (`02` §6) |
| Order expiry | The same entry-authorisation expiry (`01` §8.1). An R1 order unfilled at expiry is `order_unfilled`; there is no extension |
| Entry outcomes | The same `setup_invalidated`, `entry_blocked` and `order_unfilled` classification (`01` §8.1.1) |
| Liquidity and execution | The model-ledger fill rules, slippage, cost and minimum-order assumptions, identical to those used for R2's model-ledger comparison; partial fills where the bar's volume cannot absorb the order under the registered participation assumption |

**No hindsight fills.**
- R1 fills are computed forward, bar by bar, from bars received after `decidedAtMs`, and each fill is journaled when its bar arrives.
- A fill is never recomputed from later or corrected data. A data correction is a `correction` entry, reported separately.
- R1 never fills at a price, time or size that R2 would have been prevented from using.

**Thesis reviews in R1.** R1 cannot use a human judgement.
- A verified correction or retraction, or a registered deterministic contradiction rule, invalidates an unfilled R1 setup directly.
- An AI-classified expectation-lowering item blocks an unfilled R1 entry (`thesis_review_pending`) until expiry. The reviewer's later decision is not read by R1.

## 3. Benchmark

- **Per trade:** the QQQ return over the same entry-to-exit window, applied to the same GBP notional. FX uses the same convention as the trade: the trade's FX rates at entry and exit, recorded with timestamps. The result is excess R and excess £.
- **Portfolio:** the lab equity curve against a £500 QQQ buy-and-hold, GBP-adjusted. Daily marking uses the Bank of England / ECB reference rate for that date, with the convention stated. The lab is mostly in cash, so a cash-drag adjustment is reported alongside: a benchmark scaled to the lab's average gross exposure.

## 4. Outcome evaluation

- Outcomes are computed by deterministic code from licensed, corporate-action-adjusted prices after each exit.
- WAIT and REJECT decisions are evaluated on their shadow plans with the same rules. This measures whether the filters remove losing trades or winning ones.
- Human-originated trades (WAIT converted to TRADE by a reviewer) are a separate cohort in R2 and never enter R1.
- **Intervention attribution** (the basis for Phase B). The difference R1 − R2, per decision and in total, is split into:
  - **rejection effect:** the R1 outcome of rejected decisions;
  - **missed-opportunity effect:** the R1 outcome of `review_expired`, `entry_blocked` and `order_unfilled` decisions in R2, each reported separately;
  - **amendment effect:** amended plan versus original plan, both priced on the model ledger at approval time;
  - **delay effect:** the original plan on the model ledger at approval time versus at `decidedAtMs`;
  - **execution effect:** the demo fill versus the model-ledger fill at approval time.
- Review latency (median, p95) and the counts of each review event are reported for every strategy.

## 5. Metrics (per record, per strategy, per cohort, per ledger; gross and net)

| Metric | Definition |
|---|---|
| Net P&L | Σ (exit − entry) × qty × FX − all costs, in £ |
| R-multiple | Net P&L ÷ planned risk (£), per trade; effective-R noted where the notional cap bound |
| Win rate | Share of trades with net R > 0 |
| Expectancy | Mean net R per trade, with a 95% bootstrap confidence interval |
| Profit factor | Σ winning £ ÷ \|Σ losing £\| |
| Max drawdown | Largest peak-to-trough fall of the marked equity curve, in £ and % |
| Costs | Total and per trade, by component, as % of gross P&L |
| Benchmark-relative | Mean excess R vs QQQ; information ratio over sessions |
| Exposure | Average and maximum gross exposure; time in market |
| Execution | Intended vs. model vs. demo fill differences (bp) |
| Data quality | Excluded-by-point-in-time counts; blocked windows; feed latency p95 |

## 6. Statistics and sample size

The initial observation (30 sessions, at least 30 qualifying opportunities) is **exploratory**.

**Sample size.** To distinguish a mean net expectancy μ (in R) from zero with standard deviation σ, a two-sided test at α = 0.05 with 80% power needs about `n ≈ 7.84 (σ/μ)²` trades **per strategy**:

| μ (net R per trade) | σ (R) | n per strategy | With Holm correction across 3 strategies (first test α ≈ 0.0167) |
|---|---|---|---|
| 0.30 | 1.0 | ≈ 87 | ≈ 116 |
| 0.20 | 1.2 | ≈ 282 | ≈ 375 |
| 0.10 | 1.0 | ≈ 784 | ≈ 1,043 |

The confirmatory phase (L5) pre-registers μ, σ (estimated from L4), α and the stopping rule before it starts. There are no interim looks without an alpha-spending plan.

**Other limitations to report:**
- trade outcomes within a session are correlated (common market factor), so effective sample sizes are smaller;
- regime dependence: results from one regime do not generalise;
- 30 sessions cover a single short macro window;
- there is a single benchmark;
- demo fills are not live fills.

**Claims permitted after L4:**
- descriptive statistics with confidence intervals;
- data and execution feasibility;
- cost magnitude;
- a decision on whether to proceed to L5.

**Not permitted:** "profitable", "beats the market", or any return projection.

## 7. First case study: NVIDIA earnings (forward-recorded)

**Date:** 17 November 2026, as supplied in the brief. **It must be confirmed against NVIDIA's investor-relations calendar, with the confirmation and its receipt time journaled, before the case is registered.**

| Step | Timing | Record |
|---|---|---|
| 1. Registration | Before the scheduled release, at the latest 60 minutes before | Experiment and case IDs; frozen pre-release evidence bundle (prior guidance, 10-Q/10-K facts, recent 8-Ks, price state, licensed consensus if contracted) with SHA-256; the S3 rule version; S1/S2 earnings blackout confirmed for NVDA |
| 2. Pre-earnings predictions | In the registration entry | Expected direction of the revenue and guidance surprise vs. consensus (if consensus is licensed); expected next-session gap bucket (< −5%, −5 to −2%, −2 to +2%, +2 to +5%, > +5%); model classification and confidence, or abstention |
| 3. Release capture | When received | Press-release time, 8-K acceptance time, our receipt times; no trading action |
| 4. Post-release decision | Next session, 10:00 New York | A **separate** S3 decision record referencing the registration entry, using only post-release evidence received by then: TRADE / WAIT / REJECT |
| 5. Outcomes | After 1 and 5 sessions | Scored separately for the pre-earnings predictions (calibration) and the S3 decision (R, excess vs QQQ) |

Additional rules for the case study:
- **Separation.** The pre-earnings entry and the post-release entry are separate, hash-chained journal records. The pre-earnings record is never edited after the release; if it contained an error, a correction entry references it and both are reported.
- **Weight.** One event has no statistical weight. It tests the recording pipeline and point-in-time controls, not the strategy.
