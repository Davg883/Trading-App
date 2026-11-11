# 07 — Acceptance-test plan

Tests are hermetic: no live market data, no paid models, no broker calls. The exceptions are the explicitly marked staging tests, which use the Trading 212 **demo** account and a non-production Convex deployment.

| ID | Requirement | Test | Pass criterion |
|---|---|---|---|
| A1 | 1 Universe | Register an experiment; attempt to add a symbol mid-experiment | Refused; a new version is required |
| A2 | 2 Timestamped inputs | Ingest fixture bars, filings and news with event, published and received times | All four times stored; rows missing a receipt time are rejected |
| A3 | 11 Point-in-time | Decision at T with an item published before T but received after T | Item excluded and counted; decision digest unchanged by the late item |
| A4 | 3 Detection | Feature engine on fixed fixtures | Deterministic outputs equal golden values; no access to bars after T (asserted by a spy) |
| A5 | 4 Decisions | Each strategy on fixture scenarios | Correct TRADE / WAIT / REJECT with reason codes and evidence ids; a model provider failure or abstention gives WAIT |
| A6 | 5 Three strategies | Strategy versions are hashed separately | Changing one threshold changes only that strategy's version hash |
| A7 | 6 Record before outcome | Attempt to write a decision whose `decidedAtMs` is after the first outcome bar it depends on | Refused |
| A8 | 7 Deterministic sizing and costs | Golden cases, including the notional cap, minimum order, gap through stop, and FX | Exact quantities, effective R and cost components |
| A9 | 10 Metrics | Fixture trade set | Net P&L, drawdown, win rate, expectancy (with bootstrap CI), profit factor, costs, excess vs QQQ equal reference values computed independently in the test |
| A10 | 9 Human review | Approve-each mode: no order before approval. Veto-window mode: a veto inside the window prevents the order. Override: WAIT converted to TRADE is journaled as human-originated | Each journal entry is present; originals unchanged |
| A11 | 12 Duplicates and fills | Two simultaneous intents for one decision; a retried intent; an ambiguous broker response (mocked) | Exactly one order claim; retry refused; ambiguous goes to `unknown` and blocks the symbol until reconciled; intended vs model vs demo fill recorded |
| A12 | 8 Demo only | Source and **built bundle** contain no live base URL; client construction with a non-demo environment throws; the research app's boundary suite still passes | All pass. **Staging:** a demo order round-trip on the Trading 212 demo account |
| A13 | 13 Limits and halts | Daily, weekly and drawdown loss limits; exposure and cluster caps; data staleness; kill switch | Each blocks new entries inside the claim mutation, not only in the UI |
| A14 | 14 Journal | Recompute the hash chain from an export; tamper with one exported entry | Verification passes untampered and fails at the tampered sequence; there is no update or delete API |
| A15 | Benchmark | QQQ GBP-adjusted per-trade and portfolio benchmark on fixtures | Matches an independent calculation, including the FX convention |
| A16 | Security | Unsigned, expired, altered or replayed intents; secret reuse | All refused |
| A17 | Statistics guard | The report generator after L4 | Report template contains no "profitable" or "beats" language unless the pre-registered L5 criteria are met (lint-style check) |
| A18 | NVIDIA case | Registration before release; post-release decision references it; attempt to edit the pre-release entry | Edit impossible; correction creates a new entry; both are reported |

**Staging tests (owner-approved, non-production)**, mapped to the requirements above:
- A12: a demo order round trip;
- A11 against the real demo API (once);
- latency measurement over 10 sessions (`03` §3);
- concurrency of intent claims against a real Convex deployment.

**Exit criteria for each phase** are listed in `01` §10.
