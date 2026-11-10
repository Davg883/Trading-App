# 11 — Pre-merge security review of PR #1

**PR:** Davg883/Trading-App#1 (draft) · **Head:** `13b0481` · **Base:** `main` @ `639a2ed`
**Date:** 10 November 2026
**Reviewer independence: NONE.** This review was carried out by the same AI session that wrote the PR. It was conducted adversarially (defects were proven with throw-away probe tests rather than asserted), but it is self-review: evidence level V1/V2, not V4. An independent human or separate reviewer is still required.

**Decision: REQUEST CHANGES.** The PR is a substantial net security improvement over the deployed MVP and should not be abandoned. Two newly introduced defects break invariants the PR's own design documents claim, and `main` has no branch protection, so the new CI gate cannot block a release. All three are small to fix.

---

## 1. Critical blockers

### C1. The `/api/evidence-chat/turn` gateway lets the request body override the verified owner and the provenance label
`convex/http.ts:319`:
```ts
ctx.runMutation(chatM('recordEvidenceChatTurnInternal'), { owner, recordedVia: 'server_gateway', ...turn })
```
`turn` comes from the request body and is spread **after** the verified `owner`. `gatewayJson` rejects only a top-level `owner`; a nested `turn.owner` passes through.

**Proven** (probe test, since deleted): authenticated as user A with the gateway secret, a request with `turn: {..., owner: B, recordedVia: 'convex_action'}` returned 200 and stored a row owned by **B**, labelled `convex_action`, with `estimatedCostGbp: 4.99`.

Impact: whoever holds `EVIDENCE_CHAT_GATEWAY_SECRET` can write audit rows into any owner's trail, forge provenance, and use up any owner's daily cost ceiling (£4.99 per row). This contradicts the claim in `03` §2.3 that "a gateway secret alone must not establish the end-user's identity". It is not reachable from the internet without the secret, because only the Next.js server holds it and the route builds `turnFields` itself.

**Fix:** spread `turn` first and set `owner` and `recordedVia` last; or validate `turn` against an explicit field allowlist before calling the mutation. Add a regression test for a nested `owner` or `recordedVia`.

### C2. The acceptance `record` gateway lets the body bypass the question binding
`convex/http.ts:259-264`: `{nonceId, secretSha256, reservationSha256, turnQuestionSha256: await questionDigest(turn.question), ...turn}`. A `turn.turnQuestionSha256` (or `turn.nonceId`, `turn.secretSha256`, `turn.reservationSha256`) overrides the server-computed value.

**Proven:** after consuming a nonce bound to question Q, recording a turn for a different question returned `409 question_mismatch` as intended. Adding `turnQuestionSha256 = SHA-256(Q)` inside `turn` returned **200** and stored the different question. This breaks the owner/question binding, which is one of the PR's core security claims. Exploitation requires the gateway secret, a live token and the reservation.

**Fix:** same pattern as C1: computed fields last, plus an allowlist. Add regression tests for nested overrides of every computed field.

### C3. `main` is unprotected, so the CI gate cannot prevent an unsafe release
`list_branches` reports `main` with `protected: false`. CI ran and passed on the PR (run 42877020761, six checks including **CI gate**), but nothing requires it. Vercel's production deployment settings were not inspected. Until branch protection requires **CI gate** and an approval, a failing check prevents nothing.

---

## 2. High and medium risks

| # | Risk | Reference | Severity |
|---|---|---|---|
| H1 | The public `recordEvidenceChatTurn` mutation still accepts a fully fabricated but schema-valid turn (`gemini_live` / `succeeded`, up to £5) for the caller's own account, tagged `client_jwt_legacy`. `getChatOperationsTelemetry` and `buildOperationsOverview` count any `gemini_live` + `succeeded` row as live inference and use it to set `geminiConfigured` / `geminiEnabled`, without filtering on `recordedVia`. **Fabricated telemetry can therefore still count as genuine provider inference** for that owner. | `convex/evidenceChat.ts` (`recordEvidenceChatTurn`; `latestGeminiLiveTurn`), `convex/operations.ts` (`latestGeminiLiveTurn`, `geminiLiveCount`) | High (integrity) |
| H2 | Chat cost and rate controls fail open. If `getChatRetrievalContext` throws, or the user has no Convex token, the route proceeds with spend `0`, the default ceiling and no shared limit. If the audit write fails, the turn is answered but never counted. While Convex is unreachable, paid Gemini calls are bounded only per request and by the per-process limiter. Pre-existing, but `03` §3 presents the shared limit as enforcement. | `app/api/graph/chat/route.ts` (`retrievalCtx = null` fallback; limit check `retrievalCtx?.turnsLastMinute ?? 0`) | High (cost) |
| H3 | Rollout window: after the Convex deploy but before the Vercel deploy, the **old** `/api/trading` `cancel` action calls the broker without any Convex execution check (it only reads `orderInternal`). Submission and confirmation are blocked by the new Convex layer; cancellation is not. This only matters if production `LIVE_TRADING_ENABLED` or `DEMO_TRADING_ENABLED` is `true` and an acknowledged order exists. | `lib/trading/server.ts` on `main`, `case 'cancel'` | High if flags are on; otherwise none |
| H4 | `CONVEX_BROKER_ADMIN_KEY` (a deployment-wide Convex admin key) still lives in the public-facing Next.js server for broker sync. WP3 removed its use for trading, but any Next.js server compromise yields full Convex admin. Pre-existing and out of scope, but it is the largest remaining credential exposure. | `lib/brokers/server.ts:147-148` | High (pre-existing) |
| M1 | `TYPEDB_BRIDGE_SECRET` grants arbitrary read-only TypeQL over **all tenants** (database-enforced read transaction, but no tenant filter). The Next.js server only needs allowlisted queries. The secret is passed as a public-action **argument**, not a header; whether Convex retains action arguments anywhere visible (dashboard, logs) is unverified. | `convex/graph.ts` `executeReadOnlyCloudTypeQl`, `assertBridgeKey`; `lib/graph/typedb-driver-adapter.ts` `callConvexCloudAction` | Medium |
| M2 | Status labels still overstated: `typedb_cloud` is reported `connected` from Convex counters without any TypeDB probe; the `ecb_usd_gbp_reference` provider is hard-coded `connected`; `app/page.tsx:59` and `app/workspace/page.tsx:42` display a specific HTTP 402 / prepayment-depleted message whenever any provider error has been recorded. | `convex/operations.ts` environment audit and providers | Medium |
| M3 | Workflow actions are pinned by tag (`actions/checkout@v4`, `setup-node@v4`, `setup-python@v5`, `docker://rhysd/actionlint:1.7.7`), not by commit SHA or image digest. | `.github/workflows/ci.yml` | Medium (supply chain) |
| M4 | Module-local `identity()` wrappers (consensus, defence, infrastructure, policy-risk, proof-scale, recovery) use `signedIn`, which admits model and automation actor tokens for owner-scoped reads and some writes. | e.g. `convex/infrastructure.ts:10` | Medium |
| M5 | Nonce concurrency is proven only under convex-test's serial transaction model, not on a real Convex backend. | `tests/security-acceptance-nonce.test.ts` | Medium (unproven) |
| M6 | Anonymous homepage visitors no longer see the morning briefing or forward-research events (they now fall back to static registered packages). This is the intended privacy change, but it is a visible change to a legitimate workflow and needs product sign-off. | `convex/operations.ts` `toPublicOperationsStatus` | Medium (product) |
| M7 | After the Convex deploy, and until Vercel holds `TYPEDB_BRIDGE_SECRET`, the data-room probe and Convex-bridged graph reads degrade to "NOT REACHABLE" or the deterministic mirror. This fails safe, but is user-visible. | `convex/graph.ts` bridge actions | Low–medium |
| L1 | The CI step that asserts no secrets are present can never fail, because the workflow defines none. It is a guard against future edits only. | `ci.yml` | Low |
| L2 | The `fail-before` counts in `09` (8/14, 16/20, 14/17) partly reflect new API shapes, such as calls to functions that did not exist yet, not only exploitable defects. | `09` §2 | Low (reporting) |

---

## 3. Verified strengths (re-checked in this review)

| Claim | How it was checked |
|---|---|
| The unscoped `brokerConnections` / `evidenceChatAudit` fallbacks are gone, and the public overview never reads private tables. | Grep shows no unscoped `.query(..).order/take` on private tables; `toPublicOperationsStatus` is an explicit allowlist; the identity-independence test compares the anonymous and signed-in responses. |
| Every public Convex function except the intentional public status now checks identity. | Function-by-function sweep (`02` §4), with module wrappers confirmed by hand. |
| The cross-tenant graph read is closed. | Tenant filtering in allowlisted TypeQL is keyed on `callerId` (`lib/graph/typedb-schema.ts:693`), and `callerId` now comes from the verified token instead of an argument. |
| Raw TypeQL is read-only at the database, not just by regex. | `executeReadOnlyTypeQlOnLiveServer` opens a TypeDB `read` transaction (`typedb-driver-adapter.ts:658`). |
| Nonce secrets and reservations are stored only as SHA-256 digests; randomness is generated outside mutations; state transitions are single-transaction. | Code and tests. |
| No environment flag enables trading in the new build. | Constant with no runtime input; route returns 403 before auth, and the client and Convex refuse independently. The Next.js routes are the only importers of the order client (reachability test). |
| Every audit write path validates mode against status (`gemini_live` requires `succeeded`), cost and ranges. | All three paths call `insertValidatedChatTurn`. |
| The evaluation harness cannot count fallbacks as live. | Mode taxonomy; summary counts only `live_provider`; the ground truth never reaches the provider (test inspects prompts). |
| Convex functions type-check under Convex's own config. | `tsc -p convex --noEmit` exit 0. |
| CI runs on GitHub and passes. | PR check runs, run 42877020761. |

---

## 4. Unproven claims

- Any production behaviour (no V3 evidence).
- That `npx convex deploy` bundles and deploys the new modules. Type-checking passes, but no deployment was attempted.
- Nonce single-winner behaviour under real Convex optimistic concurrency.
- That the Convex runtime exposes `CONVEX_CLOUD_URL`, on which TypeDB fail-closed detection relies.
- That Convex does not retain action arguments where `bridgeKey` could be observed.
- That production `LIVE_TRADING_ENABLED` / `DEMO_TRADING_ENABLED` are currently false, and that no trading keys or acknowledged orders exist (affects H3).
- Vercel production deploy source and gating.
- Live TypeDB behaviour after the configuration changes: the integration tests are skipped in CI and were never run.
- Any model accuracy figure: no live evaluation has been run.

---

## 5. Test design review

| Weakness | Example |
|---|---|
| Nested-override negative cases were missed, which is how C1 and C2 got through | The tests post `owner` at the top level and expect 400, but never inside `turn`. |
| Concurrency tests cannot fail for the reason they claim to test | `Promise.all` over convex-test runs transactions serially. |
| Some checks inspect source text, not behaviour | Research-only boundary "no `process.env`" regex; `x-aci-test-caller` guard regex; dashboard text regex. These are useful tripwires but not proofs. |
| Legacy trading tests mock the boundary module | Acceptable and documented, but they no longer test production behaviour. |
| Untested failure paths | Clerk middleware throwing (only the unconfigured case is tested); chat route with Convex context unavailable (H2); signed-in route via gateway, with fallback to the legacy mutation; old-Next.js-plus-new-Convex combinations; old `/api/trading` `cancel` against new Convex. |
| Weak grader heuristics in the legacy runner | The abstention regex (`cannot|unable|…`) can misclassify ordinary answers. It is labelled superseded, so impact is low. |

**Missing security tests to add before merge:** nested `owner` / `recordedVia` / computed-hash overrides on all three gateway routes; `recordedVia` filtering of live-inference counts (after the H1 fix); chat route fail-closed when the context load fails (after the H2 fix); proxy behaviour when `clerkMiddleware` throws; real-backend 10-way nonce consumption (owner-run, against a non-production deployment).

---

## 6. Lint errors, advisories and skipped tests

| Item | Release blocker? | Reason |
|---|---|---|
| 29 ESLint errors (23 `no-explicit-any`, 4 `react-hooks/purity`, 2 `no-unescaped-entities`) | No | None are security-relevant. `react-hooks/purity` (`Date.now()` during render) can cause hydration mismatches: fix soon. |
| 8 moderate `npm audit` advisories | No | All in dev-only ESLint tooling (`typescript-eslint`, `eslint-config-next`, `minimatch`); none ship in the runtime bundle. |
| 3 skipped Vitest live-TypeDB tests + 1 skipped Python TypeDB test | **Conditional blocker** | This PR changes TypeDB configuration, bridge authentication and status reporting. Run `npm run test:integration:typedb` against a **staging** TypeDB before deploying WP4. |
| 1 skipped billable live evaluation | No | Not required to ship security fixes. Required before any accuracy claim. |

---

## 7. Old/new compatibility matrix

| Combination | Signed-in chat | Acceptance path | Public homepage | Data room / graph | Trading | Security state |
|---|---|---|---|---|---|---|
| Old Next + old Convex (today) | Works | Works (insecure) | Leaks private data | Anonymous TypeQL open | Flag-gated execution | Vulnerable |
| **Old Next + new Convex** (after step 2) | Works; some old-format turns rejected by validation and so not audited | 401 (maintenance) | Works, private fields removed | Bridge calls lack a key: probe degrades, queries fall back to the mirror | Submit and confirm blocked by Convex; **old `cancel` still reaches the broker if flags are on (H3)** | Convex holes closed |
| **New Next + old Convex** (wrong order, or a Vercel preview pointed at production Convex) | Works; gateway 404 falls back to the legacy mutation | 401 | Works, but still leaky | Bridge argument rejected by old actions: probe degrades | Blocked by the new route | Convex holes **still open** |
| New Next + new Convex | Works via gateway (`server_gateway`) | Works with `acn1.` tokens | Allowlisted | Works with `TYPEDB_BRIDGE_SECRET` | Fully blocked | Intended state, subject to C1, C2, H1 and H2 |

Note: Vercel already built a preview for this PR. If preview environments use the production Convex URL, the "new Next + old Convex" combination is already running in preview. Confirm the preview environment variables.

---

## 8. Recommended release batches

The branch is linear, and commit `e7cdf97` mixes Convex, Next.js and UI changes. Split it by cherry-picking onto fresh branches from `main`, one PR per batch:

1. **CI and reproducibility** (`ebcb7fd`). No runtime effect. Merge first, then enable branch protection requiring **CI gate** (closes C3).
2. **Trading boundary** (`7a4b79b`). Deploy Convex and Vercel together. First confirm production flags are off (H3). Independent of the other batches.
3. **Convex access control** (`55f91ef`, `1671224`, and the Convex parts of `e7cdf97`: graph actions, bridge key, TypeDB fail-closed). Set `TYPEDB_BRIDGE_SECRET` in both environments, deploy Convex, then the Next.js bridge change. Run the TypeDB integration suite on staging beforehand.
4. **Nonce and gateway** (`c35f961`) **after fixing C1, C2 and H1, and adding the missing tests**, plus a real-backend concurrency run. Follow the maintenance-window plan in `03` §6.
5. **Labels, evaluation, financial integrity, pipeline stages** (`054f4b9`, `866d780`, `d0c2e2e`, the label parts of `e7cdf97`). Low risk; Next.js and library code.
6. **Documentation** (`13b0481`, this file). Update `06` and `09`: CI has now been observed passing on GitHub; `main` is unprotected.

## 9. Release and rollback procedure (per batch)

1. Run CI and confirm it passes with branch protection enforced; owner approval recorded on the PR.
2. Set the required server-only secrets (unique, ≥ 32 random characters) in Convex **and** Vercel production. Never prefix them with `NEXT_PUBLIC_`. Do not reuse the scheduler or staging tokens.
3. Pre-deployment: verify production trading flags are off. Run the staging smoke tests from `03` §6 and the TypeDB integration suite.
4. Deploy Convex; confirm the deploy succeeded. Then deploy Vercel. Do not rely on a fixed delay between them.
5. Run the post-deployment checks in `03` §7 and `04` §5, and record them as V3 evidence.
6. **Rollback:** promote the previous Vercel deployment. **Never** roll Convex back past the access-control and nonce batches: that reopens the anonymous reads and the public acceptance mutations. If Convex must change, roll forward with a fix.
7. Partial failure: if Convex succeeds and Vercel fails, the state is the "old Next + new Convex" row of the matrix. It is secure apart from H3, so deploy Vercel promptly or disable trading flags.

## 10. Does the PR make the deployed MVP safer?

**Yes, materially**, once C1 and C2 are fixed:
- It removes anonymous access to private telemetry, cross-user scans, an anonymous whole-database graph query and an unauthenticated audit-write path.
- It turns the research-only claim into an enforced property.
- It gives the project a working CI gate.

The two new defects are confined to the new gateway and need its secret, so even as written the PR exposes far less than `main`. But it should not merge while its own stated invariants are demonstrably broken and nothing can block a failing build.
