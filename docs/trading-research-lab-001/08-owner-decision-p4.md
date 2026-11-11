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

### Drafting choices to confirm at registration

These are choices made in drafting, not owner instructions:

| Detail | Current drafting |
|---|---|
| Entry while `REVIEW_REQUIRED` is pending | Blocked; a working unfilled entry order is cancelled. If the reviewer rejects the invalidation, an order needs a fresh approval before the unchanged expiry. |
| `REVIEW_REQUIRED` in the shadow portfolio | The shadow entry stays blocked until expiry, because the shadow record may not use a human judgement. |
| Deterministic contradiction rules | None is registered, so every AI-classified expectation-lowering item goes to `REVIEW_REQUIRED`. |
| "Verified" correction or retraction | It comes from the same licensed source or the issuer and is stored as evidence. |
| Whether a block lifts | Yes, when its condition clears, but the expiry is never extended. |
| Shadow liquidity assumption | A participation limit per bar, to be given a value at registration; none is set yet. |
