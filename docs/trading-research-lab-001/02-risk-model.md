# 02 — Risk model

All rules are deterministic code, evaluated at decision time and **again** inside the execution claim (the existing `claimSubmissionInternal` pattern). A rule can only make trading more restrictive. Model output cannot loosen any rule.

## 1. Capital and sizing

| Parameter | Value | Note |
|---|---|---|
| Simulated capital (C) | £500 | Equity marked to the GBP value of the model ledger |
| Planned risk per trade (r) | 0.5% of C = **£2.50** | "1R" |
| Stop distance (d) | \|entry − stop\| in USD | From the strategy rule (ATR-based) |
| Quantity | `q = floor_to_step( r / (d × fxUsdToGbp) )` | Step = the broker's fractional increment for the instrument |
| Notional cap per position | 20% of C = **£100** | If `q × entry × fx > £100`, then q is reduced and the **effective risk is below 1R**; this is recorded |
| Minimum order | The broker minimum (confirm per instrument on the demo account) | If q is below the minimum, the decision becomes `REJECT: below_minimum_order` |
| Leverage, shorting, options, CFDs | **None** | Long-only cash equities |

**Worked example.** Entry US$140, stop US$136.40 (2.6% below), USD→GBP 0.78:
- risk per share is £2.81, so `q = 2.50 / 2.81 = 0.89` shares and the notional is £97 (under the cap);
- with the stop at 1.5%, the uncapped notional would be about £167. It is capped at £100, so the effective risk is £1.50 (0.6R).

The cap therefore binds often on tight stops. Results must be reported in both £ and R, with effective R recorded per trade.

## 2. Exposure limits

| Limit | Value |
|---|---|
| Concurrent open positions | 3 |
| Gross exposure | 60% of C (£300) |
| Positions per symbol | 1 |
| Correlated cluster (semiconductors: NVDA, AMD, AVGO, TSM, MU, QCOM, INTC) | At most 2 concurrent positions and £150 notional |
| Total open risk (sum of distances to stop) | 1.5% of C (£7.50) |
| New entries per session | 3 |
| Earnings | S1 and S2: no entry within 2 sessions before a scheduled release, and positions closed before the release. S3: entries only after the release |
| Session timing | No entries in the first 5 minutes or the last 15 minutes of the regular session (S3: none before 10:00 New York) |

## 3. Loss limits and halts

| Trigger | Action | Release |
|---|---|---|
| Realised + unrealised loss for the session ≥ 1.5% of C (£7.50) | **Daily halt**: no new entries; open positions keep their exits | Automatic next session |
| Rolling 5-session loss ≥ 3% of C (£15) | **Weekly halt** | Reviewer releases, with a recorded reason |
| Drawdown from peak equity ≥ 5% of C (£25) | **Experiment halt**: no entries in any strategy | Owner decision; recorded as a protocol event, and results before and after are reported separately |
| 5 consecutive losing trades in one strategy | **Strategy halt** | Reviewer release |
| Data staleness: last price older than 2 minutes intraday, or a feed outage | No entries; exits use the last valid rule (time exit) and the model ledger records "stale" | Automatic when fresh |
| Unreconciled demo order (ambiguous broker response) | No further orders for that symbol | After reconciliation |
| Manual kill switch | Immediate halt of all entries and demo orders | Reviewer |

Halts are state stored in Convex and checked inside the order-claim mutation, not only in the UI.

## 4. Model and data risk

- **Model output.** It can only *classify* evidence. It cannot change thresholds, sizes or prices. Abstention or a provider failure becomes `WAIT`.
- **Model cost.** The existing budget reservation applies (daily ceiling; fail closed).
- **Stale or missing evidence.** It blocks a TRADE; it never defaults to a value.
- **Corporate actions.** These are applied to outcome prices from licensed corporate-action data. Without that data, affected trades are flagged and excluded from metrics with a stated reason, never silently adjusted.

## 5. What the risk model cannot protect against

- Gaps through stops: a fill below the stop is recorded at the actual price, and the R loss can exceed 1.
- Demo-account fill behaviour that differs from the live market.
- Regime changes outside the observation period.
- The small-sample problem (`05` §6).
