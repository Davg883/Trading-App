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
- **Unreviewed decisions are not lost.** A TRADE decision that expires without review is recorded as `expired_unreviewed` (a missed opportunity). It stays in the shadow record, and the human-approved record shows no trade.
- **Phase C is not pre-approved.** Nothing in Phase A may contain a dormant automatic-execution path, a feature flag for one, or a configuration value that enables one (`07` A21).
