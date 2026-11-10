# 04 — Research-only execution boundary

**Work package:** WP3, commit `7a4b79b`
**Status:** IMPLEMENTED LOCALLY / PENDING DEPLOYMENT (V2). No trading call was made at any point during this review.

## 1. Finding

`/api/trading` could save trading-capable Trading 212 keys, issue and accept order confirmations, submit orders and cancel them. The only deployment-level control was `LIVE_TRADING_ENABLED` / `DEMO_TRADING_ENABLED` equal to the string `"true"`. `executionAuthority: "none"` appeared in many responses and status rows, but nothing enforced it as a property of the deployment.

## 2. Options compared

| Option | Strength | Weakness |
|---|---|---|
| A. Hard-coded research-only build guard | Small, reviewable, no runtime input can change it, keeps code for a future separate service | Execution code still ships in the bundle |
| B. Remove the execution endpoints from this deployment | Strongest: no code path at all | Larger change; loses tested workflow code; harder to review in one step |
| C. Separate execution service | Correct long-term architecture (separate credentials, deploy pipeline, audit, regulatory scope) | Not a near-term change |

**Chosen:** A now, enforced at three independent layers, with C recommended before any execution capability is reconsidered. B remains a sensible follow-up once the owner confirms execution is out of scope for the pilot.

## 3. Implementation

`lib/trading/execution-boundary.ts` declares `DEPLOYMENT_EXECUTION_AUTHORITY = 'none'` as a compile-time constant. The module reads no environment variable, request, database row or flag (a test asserts this from the source text).

| Layer | Refuses |
|---|---|
| `handleTrading` (`/api/trading`) | Every action, returning 403 `research_only_deployment` **before** authentication, parsing, vault, Convex or broker access |
| `Trading212OrderClient` | `submit` and `cancel`, before building any request, even when constructed with `executionEnabled: true` |
| Convex `trading.ts` | `saveTradingKeyInternal`, `recordOptIn`, `issueConfirmationInternal`, `confirmInternal`, `claimSubmissionInternal` (whatever `executionFlagEnabled` says), and releasing the Live emergency switch |

`executionFlag()` now returns `false` whatever the environment. The homepage, workspace and trading pages compute displayed flags through the boundary, and the trading page shows a research-only notice. Engaging the kill switch and deleting a stored key remain possible (they reduce capability).

**Preserved:** read-only brokerage synchronisation (`/api/brokers/*`, read-purpose vault credentials, `lib/brokers/trading212.ts`) is a separate code path with no order endpoints or mutating HTTP methods (asserted by test). Order drafts and risk evaluation records in Convex are retained as research records. Research agents, the Python worker and Convex functions cannot import the order client (asserted by a source-reachability test).

## 4. Critical acceptance test

`tests/security-research-only-boundary.test.ts` sets `LIVE_TRADING_ENABLED=true` and `DEMO_TRADING_ENABLED=true`, replaces global `fetch` and the order client's transport with spies that fail the test if called, and verifies:

- all ten `/api/trading` actions (save live/demo key, issue confirmation, confirm, submit, cancel, reconcile, evaluate, instruments, monitor) return 403 with no authentication, Convex or network call;
- the order client refuses live and demo submission and cancellation with no transport call;
- Convex refuses a submission claim for a fully confirmed, opted-in, reviewer-approved, kill-switch-released order with `executionFlagEnabled: true`, and the order stays `confirmed`;
- confirmations, key storage and opt-in are refused; the kill switch cannot be released.

Run against the code before the change, **16 of 20** of these tests failed; all 20 pass now.

The pre-existing order-workflow tests (`trading-*.test.ts`) are retained. They replace the boundary module through the test runner's module mock so the workflow gates stay covered for a future separate service; no application input can do the same.

## 5. Remaining risk and production verification

- Production behaviour must be re-verified after the separately authorised release: `POST /api/trading` with any body should return 403 `research_only_deployment`.
- The execution code remains in the repository and bundle. Option B or C removes it.
- Previously stored trading keys, if any exist in production, are not deleted by this change. The owner should review `tradingCredentials` and delete keys, and revoke them at Trading 212, if execution is out of scope. This review did not read or alter any stored credential.
