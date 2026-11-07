# Benchmark 001 experiment protocol

## Question

Can independent model forecasts improve on both a frozen deterministic earnings rule and passive buy-and-hold after trading and research costs?

## Registration before each run

Freeze the company universe (MSFT, GOOGL, AMZN, NVDA, CRWV), evidence IDs, evidence cutoff, pre/post-release round, exact model versions, prompts, participant deadline, inference budgets, neutral band, horizons, benchmark and sizing/fill policy. Do not tune these after seeing outcomes.

Initial proposed neutral band is ±0.2%; values inside or on the boundary are neutral. Probabilities cover up/down/neutral and sum to one. Returns use decimal fractions in both calculation engines (0.01 means 1%). Brier score is the unnormalised three-class sum, range 0–2. Do not compare it directly with binary Brier scores without disclosing the convention.

Every forecast requires expected return, interval with explicit intended coverage, evidence-linked explanation, invalidation, trade/no-trade decision and usage. Failed, missing, late and invalid submissions stay in the denominator of operational reporting, but are not assigned invented numeric forecasts.

## Time and execution

An evidence item is eligible only when both its public publication time and system receipt time are at or before the forecast cutoff. All timestamps must carry an explicit timezone. Preserve subsequent corrections as new observations. Historical tests cannot exclude knowledge memorised during model training; report that limitation.

The intended horizons are one tradable hour, one session and five sessions under a frozen exchange calendar. A quote is executable only after human approval and processing latency. Do not use the release price as a fill for a forecast created later. Account for spread, slippage, FX, fees, unfilled proposals and cash. The prototype does not yet implement exchange-calendar mapping or real-time quote ingestion end to end.

## Distinct scorecards

- Economic interpretation: verified numerical claims, unsupported claims, company-specific operating outcomes and invalidations.
- Market forecast: probability calibration, multiclass Brier, return MAE, interval coverage and interval width by horizon.
- Trading: reconciled net equity, drawdown, turnover, rejection rate and excess return against aligned passive and rules portfolios.
- Intelligence economics: input/output/cached tokens, latency, actual billed cost and independently adjudicated useful task success.

No forecasts means missing scores, not perfect accuracy. A three-company pilot is descriptive. Expand forward sample size before inferring an edge, and retain all registered strategies to avoid winner selection.

## Monthly review

Record a reviewer, date, evidence and conclusion for reliability, unseen-event forecasting improvement, returns after all costs, value of additional model spend, and quality-equivalent local/cloud economics.
