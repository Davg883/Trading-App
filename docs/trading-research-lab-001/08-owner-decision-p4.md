# 08 — Owner decision P4: human approval of demo orders

**Status:** decision recorded on 11 November 2026 by the owner. It closes prerequisite P4 (`00` §2).
**Scope of authority:** this decision authorises **specification updates only**. It does not authorise implementation or deployment. Prerequisites P1, P2, P3 and P5 remain open, and nothing may be built until all are met.

## 1. Decision (as approved)

| # | Rule |
|---|---|
| D1 | **Phase A:** every demo order requires explicit human approval. |
| D2 | No automatic execution after a veto window in the initial release. The *veto-window* mode previously specified in `01` §8 is withdrawn. |
| D3 | The system records the AI's proposed trade **independently and before any human intervention**. The record includes its timestamp, evidence, entry conditions, intended position size, invalidation level, exit conditions and decision expiry. |
| D4 | Two separate performance records are kept: <ol><li>**the autonomous shadow strategy**: what would have happened without human intervention;</li><li>**the human-approved demo strategy**: actual demo fills and intervention decisions.</li></ol> |
| D5 | Every approval, rejection, amendment, delay and missed opportunity is recorded. |
| D6 | No human decision may retrospectively alter the original AI signal. |
| D7 | **Phase B** (later) may compare shadow autonomy against human-approved execution. |
| D8 | **Phase C** (later) may permit fully automatic **demo-only** execution, but only after a separate security, reliability and risk acceptance. |
| D9 | The research application keeps `executionAuthority = none`. |
| D10 | No live-money trading authority is granted. |

"The AI's proposed trade" here means the complete TRADE decision as the system generated it. That covers the deterministic strategy's plan and the model's validated evidence classification (`01` §6–7), before any reviewer sees it. The model still does not set sizes or prices.

## 2. Where each rule is specified

| Rule | Specification |
|---|---|
| D1, D2 | `01` §8 (approve-each only); `06` §1, §4 (intent requires a recorded approval); `07` A10, A21 |
| D3 | `01` §7 (proposal fields, journaled before the review queue); `07` A7, A19 |
| D4 | `05` §2 (two performance records), §4, §5; `02` §6 (separate risk state per record); `07` A22 |
| D5 | `01` §8.2 (review events, including expiry as a missed opportunity); `07` A10, A20 |
| D6 | `01` §8.3; `06` §5 (hash chain); `07` A19 |
| D7, D8 | `01` §10.1 (Phase A/B/C mapped to L-phases) |
| D9, D10 | `06` §1, §2 (unchanged); `07` A12 |

## 3. Consequences for the design

- **Simpler and safer than a veto window.** No timer can cause an order, so a missed review, an outage or an unread notification cannot place an order. The paper service has no time-based trigger to secure.
- **Delay is a measured cost.** An approval that arrives later than the AI's decision time moves the demo entry. The shadow record keeps the original timing, so the cost of human latency appears as a separate attribution term (`05` §4).
- **Unreviewed decisions are not lost.** A TRADE decision that expires without review is recorded as `review_expired` (a missed opportunity). It stays in the shadow record, and the human-approved record shows no trade.
- **Phase C is not pre-approved.** Nothing in Phase A may contain a dormant automatic-execution path, a feature flag for one, or a configuration value that enables one (`07` A21).

## 4. Entry-authorisation expiry (owner decision, 11 November 2026)

The P4 decision is accepted. The owner set the following **provisional** expiry rules, specified in `01` §8.1:

| Strategy | Rule |
|---|---|
| S1 News momentum | 15 minutes after signal creation, or earlier if invalidated |
| S2 Oversold recovery | 10:00 America/New_York for pre-market opening candidates; 15 minutes from creation for regular-session candidates |
| S3 Post-earnings repricing | 11:00 America/New_York for pre-market candidates; 15 minutes from creation for later regular-session signals |

- **No automatic extension, automatic approval or execution after an expired authorisation.**
- Entry-authorisation expiry stays **separate from position exit rules**.
- The parameters are frozen at formal experiment registration. They are reviewed using forward-recorded evidence; any change creates a new strategy version.

## 5. Final rules clarification (owner decision, 11 November 2026)

This section replaces the earlier "points for confirmation"; the owner has decided each of them. The rules are specified in `01` §8.1.1 and §8.1.2 and tested by `07` A24 and A25.

| Subject | Owner decision |
|---|---|
| S1 early invalidation | An unfilled setup is invalidated if the original price invalidation level is reached, a defined entry range is breached, or the verified news thesis is materially invalidated. |
| S1 buy limit | A price moving beyond a buy-limit order does **not** automatically invalidate the signal. The order may simply stay unfilled until expiry. |
| S2 and S3 early invalidation | Common safeguards: stale or erroneous data, exchange halts, exhausted risk limits and materially invalidated research theses. |
| Price thresholds | No new discretionary price thresholds without a separately registered strategy rule. |
| Pre-market classification | 09:30 America/New_York is the normal regular-session opening, adjusted for official exchange holidays and exceptional schedules. |
| Pre-market expiries | S2 10:00 and S3 11:00 New York are kept. |
| Unchanged | The human-approval requirement, the risk limits and the research-only execution boundary. |

Section 6 refines the S1, S2 and S3 rows above: stale data, halts and exhausted risk limits are execution blocks, not invalidations.

## 6. Final registration clarifications (owner decision, 11 November 2026)

The PR #2 strategy rules are accepted with these refinements. They are **provisional rules, to be frozen at formal experiment registration**. Specified in `01` §8.1.1 and §8.2, `05` §2.2 and `02` §6; tested by `07` A24, A26 and A27.

| # | Owner decision |
|---|---|
| 1 | **Material thesis invalidation.** A verified correction or retraction of the original source may directly invalidate the affected research premise. A later AI-classified expectation-lowering item triggers `REVIEW_REQUIRED` unless a predefined deterministic contradiction rule is satisfied. A reviewer may confirm or reject the invalidation and must record the evidence, timestamp and decision. The original AI signal is preserved unchanged. |
| 2 | **Three separate outcomes.** `setup_invalidated`: the research or price setup is no longer valid. `entry_blocked`: a valid opportunity cannot be executed because of market-integrity, data-quality or risk restrictions. `order_unfilled`: an authorised order had no executable fill before expiry. For S1, stale prices, halts and exhausted risk limits are execution blocks, not thesis invalidations; the same classification applies to S2 and S3. |
| 3 | **Shadow portfolio realism.** The autonomous shadow portfolio obeys the same market-session and halt rules, data-freshness requirements, deterministic risk limits, order-expiry rules, and liquidity and execution assumptions. It receives no hindsight fills and cannot circumvent restrictions imposed on the human-approved demo portfolio. |
| 4 | **Existing decisions preserved.** No S1 entry range until one is separately registered. Invalidation is permanent; any later opportunity needs a new signal and decision identifier. The S1, S2 and S3 expiry rules are unchanged. |

## 7. Registration assumptions confirmed (owner decision, 11 November 2026)

The owner approved the following **provisional registration rules**. They replace the earlier "drafting choices to confirm". This decision authorises specification updates only.

| # | Approved rule | Specified in | Test |
|---|---|---|---|
| 1 | `REVIEW_REQUIRED` blocks new entries and cancels any unfilled entry order. A rejected invalidation does not restore an expired approval. | `01` §8.1.1 | A26, A30 |
| 2 | The autonomous shadow strategy stays blocked while a thesis review is unresolved. Human decisions must not retrospectively alter its performance. | `05` §2.2 | A26, A27 |
| 3 | An explicitly separate, non-executable counterfactual signal analysis measures the opportunity cost of review-triggered abstention. Its hypothetical fills are never included in headline trading returns. | `05` §2.4 | A28 |
| 4 | No deterministic contradiction rules are registered initially. AI-classified expectation-lowering news requires review. | `01` §8.1.1 | A26 |
| 5 | Source corrections are accepted only when authenticated to the original licensed publisher or the relevant issuer, with evidence and timestamps. | `01` §8.1.1 | A30 |
| 6 | Temporary execution blocks may lift when their underlying condition clears, but must not extend signal expiry. | `01` §8.1.1 | A24, A30 |
| 7 | Provisional maximum shadow-fill participation of 1% of eligible volume per bar. The human-approved simulator uses the same conservative liquidity assumptions. | `05` §2.3 | A29 |
| 8 | Executable liquidity is not inferred solely from OHLCV volume. Valid price, spread, session and fill-assumption checks are required. | `05` §2.3 | A29 |
| 9 | At registration, confirm bar duration, market-data entitlement, corporate-action treatment, auction exclusions, fill model and slippage assumptions. | `05` §8 | — |
| 10 | All existing human-approval, risk-limit, research-only and no-live-money restrictions are maintained. | `01` §8, `02`, `06` | A12, A13, A21 |

## 8. Status: ready for formal registration review

- The strategy specification is **complete for formal registration review**. Its scope is closed: no further rules are to be added outside that review.
- Every rule in this folder is **provisional** until it is frozen at registration.
- Values still to be supplied at registration are listed in `05` §8. Spread eligibility has no universal value: it is set per instrument and strategy by calibration (`05` §9).
- This status is not authority to implement, deploy or trade. Prerequisites P1, P2, P3 and P5 (`00` §2) remain open, and security PR Davg883/Trading-App#1 remains the release priority.

## 9. Specification freeze (owner decision, 11 November 2026)

The owner accepted the specification at commit `d48d8ab` as ready for formal registration review, with these final interpretations:

| # | Interpretation | Specified in | Test |
|---|---|---|---|
| 1 | Rejecting a thesis invalidation never restores a previous order approval. A fresh approval is required within the original decision expiry. | `01` §8.1.1 | A26, A30 |
| 2 | Simulated fills require contemporaneous and sufficiently reliable bid and ask data. | `05` §2.3 | A29 |
| 3 | No universal maximum spread percentage is invented or registered. | `01` §2, `05` §2.3 | A31 |
| 4 | A pre-registration market-data calibration procedure uses a separate observation dataset. | `05` §9.1 | A31 |
| 5 | It records observed spread, percentage of mid-price, quotation timestamps, feed latency, missing data and estimated execution costs. | `05` §9.2 | — |
| 6 | Instrument- and strategy-specific spread eligibility rules are proposed from calibration evidence only, before the forward trial begins. | `05` §9.3 | A31 |
| 7 | If suitable quotes or licensing rights are unavailable, the affected strategy is marked NOT READY; fills are never fabricated. | `05` §9.4, `03` §5 | A31 |
| 8 | The S1, S2 and S3 rules and all human-control and research-only restrictions are preserved. | Unchanged | — |

**Frozen.** With the commit that adds this section, the specification is frozen. No further changes are to be made until formal registration, where the provisional rules are confirmed, the calibration proposals are approved, and everything is hashed into the experiment and strategy versions.

No implementation, merge, deployment or trading is authorised.

