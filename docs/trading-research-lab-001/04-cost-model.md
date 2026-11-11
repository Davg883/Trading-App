# 04 — Cost model

Two separate things are modelled:
- **per-trade transaction costs**, which enter every P&L figure;
- **implementation and running costs** of the lab, which enter the experiment's economics but not trade P&L.

## 1. Per-trade transaction costs

Each item below is a parameter stored with the experiment version, with its source and the date it was confirmed. **Values marked "confirm" must be checked against the current Trading 212 fee schedule and vendor data before registration.**

| Component | Model | Initial parameter | Status |
|---|---|---|---|
| Commission | Fixed per order | £0 | Confirm (Trading 212 states commission-free share dealing; check for current exceptions) |
| FX conversion (GBP account, USD instrument) | % of notional, each side | 0.15% per side | **Confirm** |
| Half-spread | Measured from contemporaneous quotes. The fixed figures here are planning estimates for the breakeven analysis only and are never used to create a simulated fill (`05` §2.3, §9) | Planning estimate: mega-cap 2 bp per side; other universe names 5 bp per side | Replaced by calibration measurements before the forward trial (`05` §9) |
| Slippage vs. intended price | Market orders: next-bar open vs. decision reference. Limits: unfilled orders recorded as missed, not as filled | 5 bp per side (regular hours); 15 bp at the open; 25 bp for gaps | Calibrated from demo fills and the market data after L4 |
| Regulatory sell-side fees (SEC Section 31, FINRA TAF) | Per sell | Negligible at this size; included if the broker passes them on | Confirm |
| Stamp duty | — | None for US shares | — |
| Overnight financing | — | None (unleveraged) | — |

**Round-trip estimate on a £100 position (mega-cap, regular-hours market orders):**

| Item | £ |
|---|---|
| FX 0.15% × 2 | 0.30 |
| Half-spread 2 bp × 2 | 0.04 |
| Slippage 5 bp × 2 | 0.10 |
| **Total** | **≈ £0.44** |

That is **0.18R** at a full £2.50 risk budget. When the £100 notional cap binds (effective risk of about £1.50), the same costs are **0.29R**.

## 2. Breakeven

For a strategy with a +2R target and a −1R invalidation, gross expectancy per trade is `3p − 1`, where p is the win rate. After cost c (in R), the breakeven win rate is `p* = (1 + c) / 3`:

| Cost c | Breakeven win rate |
|---|---|
| 0.00R | 33.3% |
| 0.18R | 39.3% |
| 0.29R | 43.0% |

Time exits and partial outcomes make the real distribution wider. This table is for orientation only; the evaluation uses actual R-multiples (`05` §5).

Costs are therefore a first-order effect at this scale. The experiment reports gross, net-of-model-costs and net-of-actual-demo-fill results separately.

## 3. Cost recording per trade

Each trade stores:
- the intended entry and exit references;
- the model-ledger fills;
- the demo fills, if any;
- each cost component separately;
- the FX rate and its timestamp;
- the cost parameter version.

**The P&L is never stored net-only.**

## 4. Implementation and running costs (estimates, not quotes)

| Item | Basis | Estimate | Status |
|---|---|---|---|
| Licensed intraday equity data | Vendor quote; professional or non-display licence likely | **Unknown until quoted** | Required (P3) |
| Licensed news | Vendor quote | **Unknown until quoted**; typically the largest item | Required for S1 |
| Consensus estimates | Vendor quote | Unknown | Optional (S3 degrades without it) |
| Model inference | Existing per-owner daily ceiling (default £2/day) | At most about £60/month at the ceiling; actual use expected to be well below | Configurable |
| Hosting (Convex, Vercel) | Existing plans | Possible plan upgrade for intraday polling volume | To check against plan limits |
| Engineering | One engineer: L1 2–3 weeks, L2 about 3 weeks, L3 2–3 weeks, plus fixes | **About 8–10 engineer-weeks** before observation starts | Estimate |
| Independent security review of the paper execution service | External reviewer | Quote required | Required before L3 |
| Observation period | 30 sessions (L4); a confirmatory sample needs far longer (`05` §6) | Data subscriptions run for the whole period | — |

For context: the £500 simulated capital and a 0.5% risk budget mean that one full-size trade risks £2.50, so data and engineering costs will exceed any plausible P&L of this experiment by orders of magnitude. The experiment is justified only as research evidence, not by its returns.
