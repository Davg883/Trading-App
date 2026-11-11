# 06 — Security architecture

## 1. Non-negotiable properties

1. **No route to the live brokerage environment** exists in any component of the lab: no live credential, no live base URL, no live client construction.
2. **The research application keeps `DEPLOYMENT_EXECUTION_AUTHORITY = 'none'`.** It never stores an order-capable credential and never calls an order endpoint. Lab 001 does not change that constant.
3. **Models and research agents have no execution authority.**
   - They classify evidence only.
   - Sizes, prices, stops and orders come from deterministic code.
   - Orders are placed only after the human review step required by the selected mode.
4. **Every decision, override, order intent, fill and correction is journaled** in an append-only, hash-chained record before it can affect anything downstream.

## 2. Components and trust boundaries

| Component | Holds | Can do | Cannot do |
|---|---|---|---|
| Research app (existing Next.js + Convex) | Evidence, decisions, journal, review state; model budget | Record decisions; sign **order intents** for approved TRADE decisions | Hold broker credentials for orders; call order endpoints |
| **Paper execution service** (new, separate deployment and separate Convex project) | Demo API key (its own vault key); order state machine; demo fills | Place, reconcile and cancel orders on `demo.trading212.com` only | Reach the live host; read research evidence beyond the intent; accept unsigned intents |
| AI research assistant | Read-only evidence bundle | Return a validated classification | Anything else |
| Reviewer (human, explicit reviewer grant) | — | Approve, veto, override, halt | Edit or delete journal entries |

## 3. Demo-only enforcement (defence in depth)

| Layer | Control | Verified by |
|---|---|---|
| Build | `PAPER_BROKER_ENVIRONMENT = 'demo'` compile-time constant; the client is constructed only with it; the live base URL string is absent from the service's source and build output | CI test greps the source **and** the built bundle for `live.trading212.com`; unit test that construction with any other environment throws |
| Credential | Only a key generated in the Trading 212 **demo** account is stored. Trading 212 keys are environment-specific, so a live key fails authentication on the demo host, failing closed. The service never "tests" a key against the live host | Acceptance test A12; operational check at key installation |
| Network | Egress allowlist limited to `demo.trading212.com` (and the research app's intent endpoint) **where the hosting platform supports egress control** | Platform configuration review. **Residual risk:** typical serverless hosts (Vercel, Convex) do not offer per-function egress allowlists, so on those hosts this layer is absent and the first two layers carry the guarantee |
| Research app | Unchanged research-only boundary (`lib/trading/execution-boundary.ts`) and its tests | Existing suite (20 tests) |

## 4. Order intents

- **Contents:** an intent is created by a Convex action in the research app for an approved TRADE decision. It carries `{decisionId, experimentId, strategyVersion, symbol, side:'BUY', quantity, limitPrice, stopPrice, targetPrice, timeExitAtMs, journalEntrySha256, issuedAtMs, expiresAtMs}`.
- **Signing:** HMAC-SHA-256 with a dedicated `LAB_INTENT_SIGNING_SECRET`, distinct from every other secret. Like the existing gateway rules, it is refused if it equals any other secret. It supports rotation via a previous-key slot.
- **Verification by the paper service:**
  - the signature;
  - expiry (60 seconds);
  - that the journal entry exists, through an authenticated read-only gateway route;
  - that the entry's approval state matches the review mode;
  - that no halt is active.
- **Idempotency:** one order per `decisionId`, enforced by a unique index and the existing claim pattern (`claimSubmissionInternal`: a single atomic claim, exactly one submit attempt, no automatic resubmission). An ambiguous broker response moves the order to `unknown` and blocks the symbol until it is reconciled.
- **Stops and targets** are managed by the service as order rules (stop orders where the broker supports them, otherwise monitored exits). Every exit order is also journaled with its triggering rule.

## 5. Journal integrity

- **Append-only:**
  - A Convex table `labJournal` with a unique `(experimentId, sequence)` index.
  - Entries are written only through an internal mutation that reads the previous head, sets `prevEntrySha256`, and computes `entrySha256 = SHA-256(canonicalJson(entry without hashes) ‖ prevEntrySha256)` in the same transaction.
  - No update or delete function exists for the table.
- **Corrections:** a correction is a new entry of type `correction` that references the original entry.
- **Export:**
  - The daily export is JSON Lines plus a CSV view plus a manifest containing the chain head hash, the entry count and the export time.
  - It is stored outside Convex (object storage or a git-committed archive).
  - A verification script recomputes the chain from an export.
- **Limitation:** a holder of the Convex deployment admin key can still write to tables directly. The hash chain and external exports make tampering **detectable**, not impossible. Admin-key holders must be named, and their access logged.

## 6. Threats and mitigations

| Threat | Mitigation |
|---|---|
| A prompt-injected news item persuades the model to "buy now" | The model cannot emit orders; its output is a validated classification; the deterministic rules and risk engine decide; the adversarial-content checks in the existing validator apply |
| Duplicate orders from retries or double clicks | One order per decision (unique index, atomic claim); no resubmission |
| Replay of a captured intent | Expiry, single use (claim), signature over all fields |
| Forged intent | HMAC secret held only by the research Convex deployment and the paper service |
| Look-ahead in evaluation | Point-in-time selection on receipt time; outcomes computed after exit; journal sequence before outcome data |
| Silent revision of a recorded prediction | Hash chain; corrections only as new entries; external exports |
| Live-environment access by mistake | Section 3 layers; no live code path exists to enable |
| Model cost runaway | Existing budget reservation (fail closed) |
| Credential leakage from the research app | The research app holds no order credential at all |

## 7. Prerequisites from the security PR

The lab depends on these, so PR #1 must be independently reviewed and released first (P1):
- owner scoping;
- validated, attested audit records;
- budget reservations;
- strict evidence validation;
- the research-only boundary;
- the CI gate.
