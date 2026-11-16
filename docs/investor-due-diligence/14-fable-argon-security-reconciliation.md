# Vectis ONE — Security Architecture Reconciliation: Argon Stage 1A vs. Fable PR #1 (`ae8f742`)

**Date:** 18 April 2026  
**Repository:** `Davg883/Trading-App`  
**Base Commit (`main`):** `639a2ed320ebff773207c294b3be06df4d830681` (`639a2ed`)  
**Fable PR #1 Branch:** `origin/claude/exciting-bardeen-f4y1iz` (`refs/remotes/origin/pr-1`)  
**Confirmed Fable PR #1 Head:** `ae8f7429babc03efbba1c471f2542012dc1045f7` (`ae8f742`)  
**Local Comparison Target:** Argon Stage 1A Working-Tree Implementation (uncommitted on `main` @ `639a2ed`)  
**Assessment Role:** Independent Principal Software Architect & Security Due Diligence Reviewer  

---

## 1. Executive Summary & Confirmed Revision Baseline

### 1.1 Confirmed Git Revision State
Before conducting this comparison, the remote repository and pull request reference were fetched and verified read-only:

* **`main` branch head:** `639a2ed320ebff773207c294b3be06df4d830681` (`Fix remote research workflow concurrency expression`)
* **GitHub Draft PR #1 (`origin/claude/exciting-bardeen-f4y1iz` / `origin/pr-1`) head:** `ae8f7429babc03efbba1c471f2542012dc1045f7` (`docs: record the pre-merge correction round and revised decision`), 13 commits ahead of `639a2ed` across 91 files (+6,375 / -953 lines).
* **Commit sequence in Fable PR #1 (`639a2ed..ae8f742`):**
  1. `c6ab1f9` — *docs: add MVP hardening review pack and Stage 1A security design*
  2. `1671224` — *security(convex): enforce owner isolation and human caller gates (WP1)*
  3. `b21c628` — *security(chat): replace public acceptance nonces with hashed internal nonces (WP2)*
  4. `bdffde6` — *security(trading): make research-only execution boundary a compile-time property (WP3)*
  5. `a036c21` — *security(graph): require bridge secret on TypeDB cloud actions (WP4)*
  6. `e4e9d33` — *feat(eval): add evidence-locked chat evaluation harness and gold corpus (WP5)*
  7. `c7742ac` — *ci: add pull-request quality gate and ESLint warning baseline ratchet (WP6)*
  8. `919a385` — *feat(ops): add data-freshness helpers and canonical pipeline stage model (WP7)*
  9. `b157809` — *fix(integrity): remove mock defaults and verify UI mutation outcomes (WP8)*
  10. `e0ce8d9` — *docs: add pre-merge adversarial security and engineering review*
  11. `c97b84d` — *security(chat): close gateway, provenance and budget concurrency gaps*
  12. `db4dfe1` — *security(api): harden graph query errors and test-caller gating*
  13. `ce0c178` — *test(ci): enforce Vitest suite in GitHub Actions and cover audit guards*
  14. `ae8f742` — *docs: record the pre-merge correction round and revised decision*

### 1.2 Evidence Classification Applied in This Report
Every claim in this reconciliation report distinguishes rigorously between:
1. **Verified Source Code Inspection (`[CODE-INSPECTED]`):** Direct line-by-line inspection of `ae8f742` via `git show ae8f742:<path>` and local Argon Stage 1A files in the working tree.
2. **Locally Executed Automated Tests (`[EXECUTED-TEST]`):** Tests directly executed in this workspace (`npx tsc --noEmit` exiting `0` and `npx vitest run tests/remediation-stage-1a-convex-access-control.test.ts tests/remote-ops-convex.test.ts` passing `12/12` on Argon Stage 1A, plus inspection of the 23-file / 145-test suite recorded in `ae8f742`).
3. **Unverified Production / Live Staging Runtime (`[UNVERIFIED-PROD]`):** Neither Fable PR #1 (`ae8f742`) nor Argon Stage 1A has been deployed to Convex Cloud (`eu-west-1`) or Vercel production, and neither has been exercised against live Clerk JWTs, live Gemini billing endpoints, or live multi-instance Vercel concurrency.

### 1.3 High-Level Architectural Conclusion
**Fable PR #1 (`ae8f742`) must be retained as the single authoritative security release baseline.** Developing or merging the separate local Argon Stage 1A implementation alongside Fable PR #1 would introduce duplicate Convex tables (`chatAcceptanceNonces` vs. `acceptanceNonces`), conflicting environment variables (`CHAT_ACCEPTANCE_GATEWAY_SECRET` vs. `EVIDENCE_CHAT_GATEWAY_SECRET`), incompatible HTTP Action routes (`/api/chat/acceptance/*` vs. `/api/evidence-chat/*`), and—if Argon's [`app/api/graph/chat/route.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/app/api/graph/chat/route.ts) or [`convex/evidenceChat.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/convex/evidenceChat.ts) overwrote Fable's—would **regress** Fable's atomic pre-inference budget reservations (`convex/chatBudget.ts`) and server-attested telemetry provenance (`recordedVia` / `isAttestedLiveTurn`).

However, our side-by-side audit identified **five specific safeguards in Argon Stage 1A (and residual edge cases in `ae8f742`)** where Fable PR #1 has targeted gaps that should be closed via small, surgical commits directly on the Fable PR #1 branch before production promotion.

---

## 2. Ten-Dimension Architectural Comparison

### 2.1 Gateway Authentication and Credential Scope

| Attribute | Fable PR #1 (`ae8f742`) `[CODE-INSPECTED]` | Argon Stage 1A (Local) `[CODE-INSPECTED]` |
| :--- | :--- | :--- |
| **Secret Environment Variable** | `EVIDENCE_CHAT_GATEWAY_SECRET` (`>= 32` chars) + optional `EVIDENCE_CHAT_GATEWAY_SECRET_PREVIOUS` (`>= 32` chars) for zero-downtime key rotation (`convex/http.ts:192-212`). | `CHAT_ACCEPTANCE_GATEWAY_SECRET` (`>= 32` chars, trimmed). Single secret only (`convex/http.ts:138-145`). |
| **HTTP Header Transport** | Dedicated `X-ACI-Gateway-Authorization: Bearer <secret>` (`lib/graph/evidence-chat-gateway.ts:109`, `convex/http.ts:215`). Preserves standard `Authorization: Bearer <Clerk JWT>` simultaneously on `/api/evidence-chat/turn` and `/api/evidence-chat/budget/reserve`. | Standard `Authorization: Bearer <secret>` on Convex `/api/chat/acceptance/*` (`convex/http.ts:146`) and `x-aci-acceptance-gateway-secret` on Next.js `/api/graph/chat`. Cannot pass both a gateway Bearer secret and a Clerk JWT in `Authorization` on the same request. |
| **Secret Isolation & Reuse Rejection** | Actively compares `EVIDENCE_CHAT_GATEWAY_SECRET` (and `_PREVIOUS`) against `OPERATIONS_SCHEDULER_SECRET` and `RESEARCH_STAGING_TOKEN` using `constantTimeEqual`; if reused, `gatewaySecrets()` returns `null` and HTTP routes fail closed with `503` (`convex/http.ts:197-205`). | Documented as a separate variable (`CHAT_ACCEPTANCE_GATEWAY_SECRET`), but does not programmatically reject operator misconfiguration if set equal to `OPERATIONS_SCHEDULER_SECRET` or `RESEARCH_STAGING_TOKEN`. |
| **Constant-Time Verification** | `constantTimeEqual(token, secret)` over UTF-8 bytes in `convex/acceptanceNonces.ts:62-75`. | `constantTimeEqualString(providedToken, expectedSecret)` with SHA-256 length-normalised digest comparison in `convex/http.ts:122-136`. |
| **Gateway Route Surface** | 5 routes under `/api/evidence-chat/*`: `/acceptance/consume`, `/acceptance/record`, `/acceptance/fail`, `/turn` (dual Gateway Secret + Clerk JWT), and `/budget/reserve` (dual Gateway Secret + Clerk JWT). | 3 routes under `/api/chat/acceptance/*`: `/consume`, `/record`, `/fail` (acceptance workflow only; signed-in user turns still relied on client-callable `recordEvidenceChatTurn` or Convex action). |

**Assessment:** **Fable PR #1 (`ae8f742`) is decisively stronger.** Its dual-header architecture (`X-ACI-Gateway-Authorization` + `Authorization`) enables the Next.js server to authenticate both **itself** (as the trusted gateway) and the **end user** (via Clerk JWT) on `/api/evidence-chat/turn` and `/api/evidence-chat/budget/reserve`. Furthermore, its programmatic refusal of secret reuse against `OPERATIONS_SCHEDULER_SECRET` and `RESEARCH_STAGING_TOKEN` and built-in `_PREVIOUS` secret rotation are superior operational controls.

---

### 2.2 Owner Identity Validation

| Attribute | Fable PR #1 (`ae8f742`) `[CODE-INSPECTED]` | Argon Stage 1A (Local) `[CODE-INSPECTED]` |
| :--- | :--- | :--- |
| **Signed-In User Path (`POST /api/graph/chat`)** | `authenticateGraphCaller(request)` verifies Clerk session (`verifyHumanCaller`) and requires `getToken({ template: 'convex' })` in production. For `/api/evidence-chat/turn` and `/api/evidence-chat/budget/reserve`, Convex independently calls `ctx.auth.getUserIdentity()` and `verifyIdentityClaims` (`convex/evidenceChat.ts:175`, `convex/chatBudget.ts:127`) and binds `owner = identity.tokenIdentifier`. | `authenticateGraphCaller(request)` verifies Clerk session. If the caller also presents an acceptance nonce, Next.js passes `authenticatedOwner: caller.actorId` to `/api/chat/acceptance/consume`, which verifies `row.owner === authenticatedOwner`. |
| **Acceptance Nonce Path (`POST /api/graph/chat`)** | `mintAcceptanceNonce` requires an explicit `owner` matching `/^https:\/\/[^|\s]{3,300}\|[^|\s]{1,300}$/` (`<issuer>|<subject>`). When `x-aci-acceptance-nonce` is presented by an unauthenticated caller (`!caller && acceptanceToken`), Next.js calls `consumeAcceptanceNonce(token, question)` via the authenticated gateway; Convex resolves `owner` from the stored `acceptanceNonces` row (`convex/acceptanceNonces.ts:392`). | `mintServerAcceptanceTokenInternal` allowed `args.owner ?? process.env.RESEARCH_OWNER_ID`. At consume time, if `authenticatedOwner` was omitted, `consumeAcceptanceNonceAndGetContext` required `row.owner === process.env.RESEARCH_OWNER_ID` (`convex/evidenceChat.ts:781-788`). |
| **Behaviour When Both Clerk Session and `x-aci-acceptance-nonce` Are Sent** | In `app/api/graph/chat/route.ts:911`, `if (!caller && acceptanceToken)` **silently ignores** `x-aci-acceptance-nonce` when a Clerk session (`caller`) is present, executing the turn as `caller` without consuming or checking the nonce. | In `app/api/graph/chat/route.ts:273-277`, if both a Clerk session and `x-aci-acceptance-nonce` are present, `authenticatedOwner: caller.actorId` is passed into `consumeAcceptanceNonceAndGetContext`, which **rejects with `401 owner_mismatch`** if `row.owner !== caller.actorId`. |
| **Test-Caller Header (`x-aci-test-caller`)** | Permitted **only** when `process.env.NODE_ENV === 'test' && !process.env.VERCEL_ENV` (`app/api/graph/chat/route.ts:735`, `app/api/graph/query/route.ts:43`). Removed `localhost`/`127.0.0.1` `Host`-header check (`db4dfe1`). | Permitted when `process.env.NODE_ENV === 'test'` and request hostname is `localhost` or `127.0.0.1` (still present in `app/api/graph/query/route.ts`). |

**Assessment:** **Fable PR #1 (`ae8f742`) is stronger on JWT cryptographic verification inside Convex and `x-aci-test-caller` hardening**, while **Argon Stage 1A is stricter when a request simultaneously carries both a Clerk session and `x-aci-acceptance-nonce`** (Fable silently ignores the nonce header when `caller` is non-null, whereas Argon rejects cross-owner mix-ups).

---

### 2.3 Nonce Issuance, Consumption, Failure and Recording

| Lifecycle Stage | Fable PR #1 (`ae8f742`) `[CODE-INSPECTED]` | Argon Stage 1A (Local) `[CODE-INSPECTED]` |
| :--- | :--- | :--- |
| **CSPRNG Execution Environment** | `mintAcceptanceNonce` is an **`internalAction`** (`convex/acceptanceNonces.ts:169`), and `reservation` is generated inside the **`httpAction`** (`convex/http.ts:238`). Only SHA-256 digests (`secretSha256`, `reservationSha256`) are passed into `internalMutation`s. This avoids Convex's deterministic V8 mutation isolate constraints on `crypto.getRandomValues`. | Called `crypto.getRandomValues` directly inside `internalMutation` (`mintServerAcceptanceTokenInternal` and `consumeAcceptanceNonceAndGetContext`). Whilst valid in Node.js/`convex-test`, Convex Cloud mutations run in a deterministic runtime where PRNG calls inside mutations are restricted or seeded. |
| **Token Format & Entropy** | `acn1.<nonceId:32hex>.<secret:64hex>` (128-bit random `nonceId` + 256-bit random `secret`). Only `secretSha256` stored in `acceptanceNonces`. | `aci-accept-v2.<nonceId:uuid>.<secret:64hex>` (UUIDv4 `nonceId` + 256-bit random `secret`). Only `secretSha256` stored in `chatAcceptanceNonces`. |
| **Reservation Storage at Rest** | 256-bit random `reservation` (`64hex`) generated in `convex/http.ts:238`; stored **only as SHA-256 hex (`reservationSha256`)** in `acceptanceNonces` (`convex/acceptanceNonces.ts:386`). | 192-bit random `reservationId` (`rsv_<48hex>`); stored in **plaintext** (`reservationId`) in `chatAcceptanceNonces` while `state === 'consumed'`. |
| **TTL & Recording Deadline** | Default TTL `5 min`, max `15 min` (`MAX_NONCE_TTL_MS`). Enforces `recordDeadlineMs = now + 180_000` (3 minutes after consumption) (`convex/acceptanceNonces.ts:25, 387, 505`). After `recordDeadlineMs`, unrecorded consumed nonces surface as `effectiveStatus: 'abandoned'` in `listNoncesInternal`. | Default TTL `5 min`, max `15 min`. Enforces `expiresAtMs >= now` at both `consume` and `record` time, without a separate `recordDeadlineMs` field. |
| **Idempotent Duplicate Record** | If `row.status === 'recorded'` and `reservationMatches && row.recordedTurnId === turn.turnId`, returns `{ ok: true, auditId: row.auditId, duplicate: true }` (`convex/acceptanceNonces.ts:487-494`). | Strict one-shot: any second call to `record` when `state === 'recorded'` returns `{ ok: false, reason: 'invalid_state' }`. |
| **Handling of `record` Failure in `POST /api/graph/chat`** | **GAP (`app/api/graph/chat/route.ts:1094-1128`):** If `recordAcceptanceTurn` returns `{ ok: false }`, the route does **not** call `failAcceptanceNonce` and still returns **HTTP `200 OK`** with `auditRecorded: 'not_recorded'`. `failAcceptanceNonce` is only called if an uncaught exception enters the `catch` block (`line 1131`). | **FAIL-CLOSED (`app/api/graph/chat/route.ts:365-378`):** If `record` fails (`!recordResp.ok`), the route explicitly calls `notifyAcceptanceNonceFailure` (`fail`) and returns **HTTP `502` (`acceptance_audit_record_failed`)**, never returning `200 OK` for an unrecorded acceptance turn. |

**Assessment:** **Fable PR #1 (`ae8f742`) is architecturally superior** in generating randomness inside `internalAction`/`httpAction` rather than `internalMutation`, hashing `reservationSha256` at rest, enforcing `recordDeadlineMs`, and supporting idempotent duplicate `record` calls for the same `turnId`. **However, Argon Stage 1A catches a genuine flaw in Fable PR #1's [`app/api/graph/chat/route.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/app/api/graph/chat/route.ts) (`lines 1094–1128`)**: Fable fails open (returning HTTP `200 OK` with `auditRecorded: 'not_recorded'` and leaving the nonce in `consumed` state) when `recordAcceptanceTurn` returns `{ ok: false }`.

---

### 2.4 Question-Hash Binding

| Attribute | Fable PR #1 (`ae8f742`) `[CODE-INSPECTED]` | Argon Stage 1A (Local) `[CODE-INSPECTED]` |
| :--- | :--- | :--- |
| **Mint-Time Requirement** | **Mandatory** (`question: v.string()`, trimmed length `3..2000` chars) on every minted nonce (`convex/acceptanceNonces.ts:181, 189-191`). Stores `questionSha256` and `questionPreview`. | **Optional** (`question: v.optional(v.string())`) at mint time (`convex/evidenceChat.ts:685`). If omitted, `boundQuestionSha256` is `null`. |
| **Consume-Time Check** | Computes `sha256Hex(question.trim())` in `convex/http.ts:239` and verifies `constantTimeEqual(row.questionSha256, args.questionSha256)` in `consumeNonceInternal` (`convex/acceptanceNonces.ts:368`). | Computes `sha256Hex(question.trim())` in `consumeAcceptanceNonceAndGetContext` and compares if `row.boundQuestionSha256 !== null` (`convex/evidenceChat.ts:811`). |
| **Record-Time Check** | Independently recomputes `sha256HexSync(turn.question.trim())` inside `recordNonceTurnInternal` using a pure synchronous SHA-256 implementation (`lib/crypto/sha256.ts`) and verifies `constantTimeEqual(row.questionSha256, turnQuestionHash)` (`convex/acceptanceNonces.ts:518-520`). | Compares `args.questionSha256` and `await sha256Hex(args.question.trim())` against `row.boundQuestionSha256` if non-null (`convex/evidenceChat.ts:905-913`). |

**Assessment:** **Fable PR #1 (`ae8f742`) is strictly stronger** because question binding is **mandatory** for every acceptance nonce (no wildcard nonces can be minted) and `recordNonceTurnInternal` recomputes `sha256HexSync(turn.question.trim())` directly from the turn payload rather than trusting a caller-supplied hash field.

---

### 2.5 Client-Field Allowlisting and Payload Sanitisation

| Attribute | Fable PR #1 (`ae8f742`) `[CODE-INSPECTED]` | Argon Stage 1A (Local) `[CODE-INSPECTED]` |
| :--- | :--- | :--- |
| **Top-Level Request Envelope (`convex/http.ts`)** | Checks `'owner' in body` and rejects with HTTP `400` (`Client-supplied owner fields are not permitted`) across all 5 `/api/evidence-chat/*` endpoints (`convex/http.ts:233, 275, 319, 361, 412`). | Recursively walks the entire JSON payload via `hasForbiddenKeys(body)` blocking 13 keys (`owner`, `tokenIdentifier`, `userId`, `subject`, `issuer`, `clerkId`, `actorId`, `authenticated`, `role`, `roles`, `isAdmin`, `bypassAuth`, `internalSecret`) at any nesting depth (`convex/http.ts:110-120`), plus strict top-level key sets per route. |
| **Turn Audit Field Allowlisting** | `pickTurnAuditFields` (`convex/acceptanceNonces.ts:447-457`) enforces a **strict positive allowlist** (`TURN_AUDIT_FIELDS`, 24 fields). Any unexpected property in `turn` (including `owner`, `recordedVia`, `nonceId`, `secretSha256`, `reservationSha256`, `budgetReservationSha256`) aborts with HTTP `400` (`Unexpected turn field: <key>`). Trusted server fields (`owner`, `recordedVia`, `nonceId`, `secretSha256`, `reservationSha256`) are spread **after** `...picked.turn` (`lines 525-532`). | Relies on `hasForbiddenKeys(body)` + explicit top-level `allowedKeys` check in `convex/http.ts:261-278` + Convex `v.object` validator on `recordAcceptanceChatTurn`. |
| **Inner JSON Contract Validation (`bundleJson`, `answerJson`, `validationJson`)** | `validateTurnAuditFields` (`lib/graph/chat-turn-audit-validation.ts:640-648`) checks byte-length caps (`MAX_BUNDLE_JSON_CHARS = 200_000`, `MAX_ANSWER_JSON_CHARS = 100_000`, `MAX_VALIDATION_JSON_CHARS = 50_000`) and `parsesAsObject(json)` (`typeof JSON.parse(json) === 'object'`). **Does not validate inner Zod schemas or cross-check `bundleId`/`bundleSha256` inside `bundleJson` and `answerJson`.** | `validateTurnAuditRecordInput` (`convex/evidenceChat.ts:212-278`) parses `bundleJson`, `answerJson`, and `validationJson` through `evidenceBundleSchema`, `evidenceLockedAnswerSchema`, and `answerValidationReportSchema`, and verifies `parsedBundle.bundleId === args.bundleId`, `parsedBundle.bundleSha256 === args.bundleSha256`, `parsedAnswer.bundleId === args.bundleId`, and `parsedAnswer.bundleSha256 === args.bundleSha256`. |

**Assessment:** **Complementary strengths.** Fable PR #1's `pickTurnAuditFields` positive allowlist and post-spread server field assignment are cleaner and block provenance-field injection (`recordedVia`, `budgetReservationSha256`), whereas **Argon Stage 1A's inner Zod schema validation and `bundleId`/`bundleSha256` cross-check inside `bundleJson` and `answerJson`** prevent callers from writing arbitrary `{}` JSON blobs that pass `parsesAsObject`.

---

### 2.6 Public Versus Internal Convex Functions

| Convex Module & Function | Fable PR #1 (`ae8f742`) `[CODE-INSPECTED]` | Argon Stage 1A (Local) `[CODE-INSPECTED]` |
| :--- | :--- | :--- |
| **`operations:publicOperationsOverview`** | Public `query`, passes `audience: 'public'`, sets `privateRead = false` (never queries `brokerConnections`, `evidenceChatAudit`, `researchJobRuns`, `researchStagingItems`, `morningBriefings`, `graphRelationshipReviews`, or `forwardResearchEvents`), and filters output through `toPublicOperationsStatus` (`convex/operations.ts:670-709, 738-747`). *Note:* Still reads `operationsSettings`, `researchJobs`, `marketObservations`, and `graphProjectionCheckpoints` for `pipelineOwner = process.env.RESEARCH_OWNER_ID` (`lines 750-776`). | Public `query`. When unauthenticated, returns `buildPublicOperationsStatus(now)` with **zero database queries** (`authenticated: false`, `brokerConnectionCount: 0`, `evidenceChatSummary: null`). When authenticated as a human user, returns full owner-scoped overview (`authenticated: true`). |
| **`operations:getChatOperationsTelemetry`** | Public `query`. Returns `null` when unauthenticated (`convex/operations.ts:238-241`). Scopes exclusively to `identity.tokenIdentifier` via `.withIndex('by_owner')` (no `.take(200)` global fallback). Counts only `isAttestedLiveTurn(row)` in `geminiLiveCount` / `latestGeminiLiveTurn`. | Public `query`. Returns `null` when unauthenticated (`convex/operations.ts:261-263`). Scopes exclusively to `identity.tokenIdentifier` via `.withIndex('by_owner')` (no `.take(200)` global fallback). |
| **Acceptance Nonce Mutations** | `mintAcceptanceNonce` (`internalAction`), `storeIssuedNonceInternal` (`internalMutation`), `consumeNonceInternal` (`internalMutation`), `recordNonceTurnInternal` (`internalMutation`), `failNonceInternal` (`internalMutation`), `listNoncesInternal` (`internalQuery`). Public `consumeAcceptanceNonceAndGetContext` and `recordAcceptanceChatTurn` **deleted** from `convex/evidenceChat.ts`. | `mintServerAcceptanceTokenInternal` (`internalMutation`), `consumeAcceptanceNonceAndGetContext` (`internalMutation`), `recordAcceptanceChatTurn` (`internalMutation`), `failAcceptanceNonceInternal` (`internalMutation`). Converted from public `mutation` to `internalMutation`. |
| **`evidenceChat:recordEvidenceChatTurn`** | Kept as public `mutation` (`recordedVia: 'client_jwt_legacy'`) for backward compatibility, **but restricted by `clientRecordedTurnViolations`** so it rejects `generationMode === 'gemini_live'`, `providerStatus === 'succeeded'`, or `estimatedCostGbp > 0` (`convex/evidenceChat.ts:138-145`). Paired with `recordEvidenceChatTurnInternal` (`internalMutation`) for server-attested writes. | Kept as public `mutation` with human auth + Zod schema validation, **without** `recordedVia` or `clientRecordedTurnViolations` restriction on `gemini_live`. |
| **`evidenceChat:checkGeminiProviderStatusAction`** | Hardened in `1671224` (`convex/evidenceChat.ts:468-482`): requires `ctx.auth.getUserIdentity()` + `verifyIdentityClaims` + human actor check before probing Gemini API. | **Untouched** (remained unauthenticated public `action`). |
| **`graph:probeHostedTypeDbCloud`, `executeReadOnlyCloudTypeQl`, `verifyHostedTypeDbCloud`** | Hardened in `a036c21` (`convex/graph.ts:484-497, 600-697`): requires `assertBridgeKey(args.bridgeKey)` verified via `constantTimeEqual` against `TYPEDB_BRIDGE_SECRET` (`>= 32` chars); adds `update` to forbidden TypeQL keyword regex and 20,000-char query limit. | **Untouched** (remained unauthenticated public `action`s). |
| **`graph:executeAllowlistedCloudGraphQuery`** | Hardened in `a036c21` (`convex/graph.ts:627-649`): removed client-supplied `callerId` argument and requires verified human Clerk JWT (`identity.tokenIdentifier`). | **Untouched** (retained client-supplied `callerId: v.string()`). |
| **`graph:verifyMacroCase001Cloud`** | Converted from public `action` to **`internalAction`** (`convex/graph.ts:707`). | **Untouched** (remained public `action`). |
| **`graph:projectPendingOutboxNow`** | Requires verified human Clerk JWT **and** `'reviewer'` role via `api.roles.myRoles` (`convex/graph.ts:563-582`). | Added verified human Clerk JWT check (`convex/graph.ts:539-550`), but did **not** enforce the `'reviewer'` role check. |
| **`graph:recordProjectionOutcome` & `recordGraphQueryAudit`** | Upgraded from `signedIn(ctx)` to `researcher(ctx)` (rejecting non-human/automated tokens) (`convex/graph.ts:127, 459`). | Retained `signedIn(ctx)`. |

**Assessment:** **Fable PR #1 (`ae8f742`) covers a substantially wider Convex surface**, locking down `checkGeminiProviderStatusAction`, the four TypeDB cloud actions (`probeHostedTypeDbCloud`, `executeReadOnlyCloudTypeQl`, `verifyHostedTypeDbCloud`, `executeAllowlistedCloudGraphQuery`), `verifyMacroCase001Cloud`, `projectPendingOutboxNow` (`reviewer` role), and `recordProjectionOutcome`/`recordGraphQueryAudit` (`researcher` human check).

---

### 2.7 Budget Reservation and Rate Limiting

| Attribute | Fable PR #1 (`ae8f742`) `[CODE-INSPECTED]` | Argon Stage 1A (Local) `[CODE-INSPECTED]` |
| :--- | :--- | :--- |
| **Atomic Pre-Inference Budget Reservation Table** | **Yes (`chatBudgetReservations` in `convex/schema.ts:87`, `convex/chatBudget.ts`).** Every paid Gemini call must first acquire a reservation (`MAX_RESERVATION_COST_GBP = £0.05`, `RESERVATION_TTL_MS = 5 min`) inside a serializable Convex mutation (`reserveChatBudget` / `reserveChatBudgetInternal` / `consumeNonceInternal`). | **No.** Budget spent (`paidSpendLast24hGbp`) was read via query (`getChatRetrievalContext` / `consumeAcceptanceNonceAndGetContext`) before calling Gemini and only written when the turn was recorded *after* inference completed. |
| **Rate-Limit Enforcement (`10 turns / min`)** | Enforced inside `evaluateAndReserveBudget` (`convex/chatBudget.ts:83-85`), counting **both** recorded `evidenceChatAudit` rows in the last 60s **and** active `chatBudgetReservations` created in the last 60s (`recentTurns + recentReservations >= SHARED_CHAT_TURNS_PER_MINUTE`). | Counted recorded `evidenceChatAudit` rows in the last 60s (`turnsLastMinute >= 10`) in `app/api/graph/chat/route.ts` and `lib/graph/gemini-provider-adapter.ts:961`, but did not count in-flight concurrent requests that had not yet written an audit row. |
| **Fail-Closed Behaviour When Convex or Gateway Is Unreachable** | In `app/api/graph/chat/route.ts:987-1028`, if `caller.convexToken` is missing (`NODE_ENV !== 'test'`) or `reserveUserChatBudget` fails (`!budgetReservation.ok`), the route returns **HTTP `503 budget_unavailable`** (or `429`) **before** invoking Gemini. | In `app/api/graph/chat/route.ts`, if `getChatRetrievalContext` failed for a signed-in user, `retrievalCtx` fell back to `null` (`paidSpendLast24hGbp = 0`), allowing a paid call if local process rate limits were not exceeded. |

**Assessment:** **Fable PR #1 (`ae8f742`) is dramatically stronger.** Argon Stage 1A had a classic check-then-act (TOCTOU) window between reading `paidSpendLast24hGbp` and recording the completed turn after Gemini returned. Fable PR #1 closes this with atomic serializable reservations in `chatBudgetReservations`. (See Section 7 for our detailed analysis of two residual settlement edge cases in `convex/chatBudget.ts`).

---

### 2.8 Provider Telemetry Provenance

| Attribute | Fable PR #1 (`ae8f742`) `[CODE-INSPECTED]` | Argon Stage 1A (Local) `[CODE-INSPECTED]` |
| :--- | :--- | :--- |
| **Attested Provenance Field (`recordedVia`)** | Adds `recordedVia` to `evidenceChatAudit` (`convex/schema.ts:81`): `'convex_action' \| 'server_gateway' \| 'server_gateway_acceptance' \| 'client_jwt_legacy'`. | Not present in `evidenceChatAudit`. |
| **Restriction on Direct Client Audit Writes (`recordEvidenceChatTurn`)** | `clientRecordedTurnViolations` (`lib/graph/chat-turn-audit-validation.ts:559-576`) blocks any `client_jwt_legacy` call where `generationMode === 'gemini_live'`, `providerStatus === 'succeeded'`, or `estimatedCostGbp > 0`. | Any authenticated human caller could still invoke `recordEvidenceChatTurn` with `generationMode: 'gemini_live'`, `providerStatus: 'succeeded'`, and arbitrary valid JSON payloads, polluting operational telemetry. |
| **Coupling Between `gemini_live` Audit Write and Active Budget Reservation** | Both `recordEvidenceChatTurnInternal` (`convex/evidenceChat.ts:439-457`) and `recordNonceTurnInternal` (`convex/acceptanceNonces.ts:512-516`) **require** a valid, active, unexpired `budgetReservationSha256` in `chatBudgetReservations` whenever `turn.generationMode === 'gemini_live'`, settling it atomically in the same transaction. | Not present. |
| **Operations Telemetry Filtering (`isAttestedLiveTurn`)** | `isAttestedLiveTurn` (`lib/graph/chat-turn-audit-validation.ts:581-589`) ensures `getChatOperationsTelemetry` and `buildOperationsOverview` only count `gemini_live` turns whose `recordedVia` is `'convex_action'`, `'server_gateway'`, or `'server_gateway_acceptance'`. | Counted any `evidenceChatAudit` row for the owner with `generationMode === 'gemini_live' && providerStatus === 'succeeded'`. |

**Assessment:** **Fable PR #1 (`ae8f742`) is overwhelmingly stronger.** This provenance chain (`reserveChatBudget` $\rightarrow$ `budgetReservationSha256` $\rightarrow$ `recordedVia` $\rightarrow$ `isAttestedLiveTurn`) completely prevents client-side fabrication of live Gemini acceptance or telemetry records.

---

### 2.9 Error Handling, Retries and Audit Integrity

| Attribute | Fable PR #1 (`ae8f742`) `[CODE-INSPECTED]` | Argon Stage 1A (Local) `[CODE-INSPECTED]` |
| :--- | :--- | :--- |
| **Gateway Fetch Timeouts & Redirect Policy** | `postGateway` (`lib/graph/evidence-chat-gateway.ts:103-114`) sets `cache: 'no-store'`, `redirect: 'error'`, and `signal: AbortSignal.timeout(10_000)`. Never retries `consumeAcceptanceNonce`. | Uses `cache: 'no-store'` without `redirect: 'error'` or `AbortSignal.timeout(10_000)`. |
| **Timestamp Skew Enforcement (`createdAtMs`)** | Enforces `Math.abs(fields.createdAtMs - serverNowMs) <= 15 * 60 * 1000` (`MAX_TURN_CLOCK_SKEW_MS`) on all recorded turns (`lib/graph/chat-turn-audit-validation.ts:624-626`), preventing backdated turns that evade the 24-hour budget window. | Enforced `createdAtMs > 0` (`Number.isFinite`), without a $\pm 15$-minute server clock-skew window! A compromised gateway request could have backdated `createdAtMs` by $>24$ hours to evade `paidSpendLast24hGbp`. |
| **TypeDB Error Redaction (`POST /api/graph/query`)** | Hardened in `db4dfe1` (`app/api/graph/query/route.ts:108-110`): logs raw error server-side and returns fixed generic string `'Graph query execution failed.'`. | Left `error instanceof Error ? error.message : 'Graph query failed'` in `app/api/graph/query/route.ts`. |
| **Internal Deployment Name Redaction** | Redacted `benevolent-magpie-921 / prestigious-dragon-8` in `convex/operations.ts:356` (`1671224`), **but missed `lib/remote-ops/health-monitor.ts:538`** where `'Convex Cloud (benevolent-magpie-921 / prestigious-dragon-8, eu-west-1)'` still appears in `ae8f742`! | Redacted `benevolent-magpie-921 / prestigious-dragon-8` in **both** `convex/operations.ts` and `lib/remote-ops/health-monitor.ts:538`, and added a static regression test scanning both files. |
| **Fail-Closed Acceptance Audit Recording (`POST /api/graph/chat`)** | **GAP:** If `recordAcceptanceTurn` returns `{ ok: false }`, `app/api/graph/chat/route.ts:1095-1128` still returns HTTP `200 OK` with `auditRecorded: 'not_recorded'` and does not call `failAcceptanceNonce`. | **STRONGER:** If `record` returns `!recordResp.ok`, `app/api/graph/chat/route.ts:365-378` calls `notifyAcceptanceNonceFailure` and returns HTTP `502`. |

**Assessment:** **Fable PR #1 (`ae8f742`) is stronger on clock-skew enforcement ($\pm 15$ min), gateway fetch hardening (`redirect: 'error'`, `10s` timeout), and `/api/graph/query` error sanitisation**, whereas **Argon Stage 1A is stronger on failing closed (`502` + `failAcceptanceNonce`) when acceptance audit recording fails and on redacting `lib/remote-ops/health-monitor.ts:538`**.

---

### 2.10 Convex/Vercel Migration and Rollback Compatibility

| Attribute | Fable PR #1 (`ae8f742`) `[CODE-INSPECTED]` | Argon Stage 1A (Local) `[CODE-INSPECTED]` |
| :--- | :--- | :--- |
| **Convex Schema Changes (`convex/schema.ts`)** | Purely additive: adds `acceptanceNonces` (`lines 42-67`), `chatBudgetReservations` (`lines 87-99`), and optional fields (`recordedVia`, `nonceId`, `secretSha256`, `reservationSha256`, `budgetReservationSha256`) on `evidenceChatAudit` (`lines 81-85`). Existing `evidenceChatAudit` rows remain 100% schema-valid. | Purely additive: adds `chatAcceptanceNonces` (`lines 82-104`). Existing `evidenceChatAudit` rows remain 100% schema-valid. |
| **Public Mutation Removal & Client Compatibility** | Removes public `consumeAcceptanceNonceAndGetContext` and `recordAcceptanceChatTurn` (neither was ever called by browser UI components), while keeping `recordEvidenceChatTurn` as a restricted legacy public mutation (`client_jwt_legacy`) so any older client bundle attempting a deterministic fallback write gets a clean rejection only on `gemini_live` claims. | Converts `consumeAcceptanceNonceAndGetContext` and `recordAcceptanceChatTurn` to `internalMutation` in-place and keeps `recordEvidenceChatTurn` public. |
| **Secret Rotation Without Downtime** | Supports `EVIDENCE_CHAT_GATEWAY_SECRET_PREVIOUS` (`convex/http.ts:201-208`) so Convex and Vercel can rotate gateway secrets without a maintenance window. | Single `CHAT_ACCEPTANCE_GATEWAY_SECRET` only; rotating requires brief synchronised update across Convex and Vercel. |

**Assessment:** **Fable PR #1 (`ae8f742`) is stronger** due to `EVIDENCE_CHAT_GATEWAY_SECRET_PREVIOUS` dual-secret rotation support and additive schema evolution with legacy `recordedVia` differentiation.

---

## 3. Safeguards Present in Argon Stage 1A That Are Absent from Fable PR #1 (`ae8f742`)

Our inspection identified **five specific safeguards** implemented in Argon Stage 1A that are currently absent from Fable PR #1 (`ae8f742`):

1. **Fail-Closed Acceptance Audit Recording in [`app/api/graph/chat/route.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/app/api/graph/chat/route.ts) (`[CODE-INSPECTED]`):**
   * In Fable PR #1 (`ae8f742:app/api/graph/chat/route.ts:1094-1128`), when `acceptance` is active and `recordAcceptanceTurn(...)` returns `{ ok: false }` (for example, due to a validation rejection, expired 3-minute recording deadline, or transient Convex HTTP 5xx error), the handler leaves `auditRecorded = 'not_recorded'`, **does not call `failAcceptanceNonce`**, and returns **HTTP `200 OK`** with the generated answer.
   * In Argon Stage 1A (`app/api/graph/chat/route.ts:365-378`), if the acceptance `record` call does not succeed, the route immediately invokes the `fail` endpoint to transition the nonce to `failed` and returns **HTTP `502` (`acceptance_audit_record_failed`)**. An acceptance run whose audit record failed to persist must never return HTTP `200 OK`.

2. **Deep Inner JSON Schema & Digest Binding Validation (`bundleJson`, `answerJson`, `validationJson`) (`[CODE-INSPECTED]`):**
   * In Fable PR #1 (`ae8f742:lib/graph/chat-turn-audit-validation.ts:640-648`), `validateTurnAuditFields` only checks that `bundleJson`, `answerJson`, and `validationJson` parse as non-array JSON objects (`parsesAsObject`: `typeof JSON.parse(raw) === 'object'`). It does not validate them against `evidenceBundleSchema`, `evidenceLockedAnswerSchema`, or `answerValidationReportSchema`, nor does it verify that the inner `bundleId` and `bundleSha256` inside `bundleJson` and `answerJson` match the top-level `turn.bundleId` and `turn.bundleSha256` columns.
   * In Argon Stage 1A (`convex/evidenceChat.ts:255-278`), every audit write parses all three JSON strings through their canonical Zod schemas and asserts `parsedBundle.bundleId === args.bundleId`, `parsedBundle.bundleSha256 === args.bundleSha256`, `parsedAnswer.bundleId === args.bundleId`, and `parsedAnswer.bundleSha256 === args.bundleSha256`.

3. **Explicit Rejection When a Signed-In Clerk User Supplies a Mismatched `x-aci-acceptance-nonce` (`[CODE-INSPECTED]`):**
   * In Fable PR #1 (`ae8f742:app/api/graph/chat/route.ts:911`), the condition `if (!caller && acceptanceToken)` means that if a request includes both a valid Clerk session (`caller !== null`) and an `x-aci-acceptance-nonce` header, the acceptance nonce header is silently ignored and the request executes as a normal user turn.
   * In Argon Stage 1A (`app/api/graph/chat/route.ts:273-286` and `convex/evidenceChat.ts:781-784`), if `x-aci-acceptance-nonce` is present alongside a Clerk session whose `tokenIdentifier` does not match the nonce's `owner`, the request fails closed with **HTTP `401` (`owner_mismatch`)** rather than silently ignoring the security header.

4. **Redaction of Internal Convex Deployment Identifiers in [`lib/remote-ops/health-monitor.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/remote-ops/health-monitor.ts#L538) (`[CODE-INSPECTED]`):**
   * While Fable PR #1 redacted `benevolent-magpie-921 / prestigious-dragon-8` in `convex/operations.ts:356`, it left the literal string `'Convex Cloud (benevolent-magpie-921 / prestigious-dragon-8, eu-west-1)'` in `ae8f742:lib/remote-ops/health-monitor.ts:538`.
   * Argon Stage 1A redacted `lib/remote-ops/health-monitor.ts:538` to `'Convex Cloud (eu-west-1)'` and added a static assertion covering both `convex/operations.ts` and `lib/remote-ops/health-monitor.ts`.

5. **Zero-Database-Read Public Operations Status & Multi-Snapshot OCC Conflict-and-Retry Test Harness (`[EXECUTED-TEST]`):**
   * In Fable PR #1 (`ae8f742:convex/operations.ts:750-776`), `publicOperationsOverview` (`audience: 'public'`) never reads private tables (`brokerConnections`, `evidenceChatAudit`, `researchJobRuns`, etc.), but still reads `operationsSettings`, `researchJobs`, `marketObservations`, and `graphProjectionCheckpoints` scoped to `pipelineOwner = process.env.RESEARCH_OWNER_ID`. Argon Stage 1A's `buildPublicOperationsStatus(now)` executes zero database reads when unauthenticated.
   * Argon Stage 1A also includes an explicit multi-snapshot optimistic concurrency control (OCC) conflict-and-retry test harness (`tests/remediation-stage-1a-convex-access-control.test.ts`) that models true parallel snapshot reads and automatic retry of conflicting transactions in addition to `convex-test` serial execution.

---

## 4. Safeguards Present in Fable PR #1 (`ae8f742`) That Argon Stage 1A Lacks

Conversely, Fable PR #1 (`ae8f742`) contains **eight major security and architectural safeguards** that are absent from Argon Stage 1A:

1. **Atomic Pre-Inference Budget Reservations (`convex/chatBudget.ts`, `chatBudgetReservations`) (`[CODE-INSPECTED]`):**
   * Reserves `MAX_RESERVATION_COST_GBP` (`£0.05`) atomically in a serializable Convex mutation *before* any paid Gemini call on Next.js (`/api/evidence-chat/budget/reserve`), in `askEvidenceLockedQuestion` (`reserveChatBudgetInternal`), or during acceptance nonce consumption (`consumeNonceInternal`).
   * Counts both recorded turns and active reservations in the last 60 seconds against `SHARED_CHAT_TURNS_PER_MINUTE` (`10/min`) and against the 24-hour spend ceiling (`£1.00`), eliminating the check-then-act race condition present in Argon Stage 1A.
   * Fails closed (`503 budget_unavailable`) if Convex or `EVIDENCE_CHAT_GATEWAY_SECRET` is unavailable.

2. **Server-Attested Telemetry Provenance (`recordedVia`, `isAttestedLiveTurn`, `clientRecordedTurnViolations`) (`[CODE-INSPECTED]`):**
   * Distinguishes `recordedVia: 'convex_action' | 'server_gateway' | 'server_gateway_acceptance' | 'client_jwt_legacy'` on every `evidenceChatAudit` row.
   * Prohibits direct client mutations (`recordEvidenceChatTurn`) from claiming `generationMode === 'gemini_live'`, `providerStatus === 'succeeded'`, or `estimatedCostGbp > 0`.
   * Requires an active, unexpired `budgetReservationSha256` in `chatBudgetReservations` before `recordEvidenceChatTurnInternal` or `recordNonceTurnInternal` will record any `gemini_live` turn.
   * Filters `getChatOperationsTelemetry` and `buildOperationsOverview` through `isAttestedLiveTurn(row)`.

3. **CSPRNG Execution Outside Deterministic Convex Mutations (`[CODE-INSPECTED]`):**
   * Implements `mintAcceptanceNonce` as an `internalAction` (`convex/acceptanceNonces.ts:169`) and generates the consumption `reservation` token in the HTTP Action (`convex/http.ts:238`), passing only SHA-256 hashes into `internalMutation`s, and stores `reservationSha256` hashed at rest rather than plaintext `reservationId`.

4. **Dual-Header Gateway Authentication, Secret Rotation & Active Secret-Reuse Refusal (`[CODE-INSPECTED]`):**
   * Uses `X-ACI-Gateway-Authorization: Bearer <secret>` alongside `Authorization: Bearer <Clerk JWT>`, supports `EVIDENCE_CHAT_GATEWAY_SECRET_PREVIOUS` for zero-downtime rotation, and refuses to start the gateway if `EVIDENCE_CHAT_GATEWAY_SECRET` equals `OPERATIONS_SCHEDULER_SECRET` or `RESEARCH_STAGING_TOKEN`.

5. **Mandatory Question Binding (`questionSha256`) & Synchronous Record-Time Hash Recomputation (`[CODE-INSPECTED]`):**
   * Requires `question` on every minted nonce and recomputes `sha256HexSync(turn.question.trim())` inside `recordNonceTurnInternal` using `lib/crypto/sha256.ts`.

6. **Server Clock-Skew Enforcement (`MAX_TURN_CLOCK_SKEW_MS = 15 min`) (`[CODE-INSPECTED]`):**
   * Rejects any audit turn whose `createdAtMs` differs from `Date.now()` by more than $\pm 15$ minutes (`lib/graph/chat-turn-audit-validation.ts:624-626`), preventing backdated turns from bypassing the rolling 24-hour budget window.

7. **Comprehensive Convex Action & Graph Bridge Hardening (WP1 & WP4) (`[CODE-INSPECTED]`):**
   * Authenticates `evidenceChat:checkGeminiProviderStatusAction` (`convex/evidenceChat.ts:468-482`).
   * Protects `graph:probeHostedTypeDbCloud`, `graph:executeReadOnlyCloudTypeQl`, and `graph:verifyHostedTypeDbCloud` with `TYPEDB_BRIDGE_SECRET` (`>= 32` chars, constant-time compared) and blocks `update` in read-only TypeQL (`convex/graph.ts:484-497, 600-697`).
   * Removes spoofable `callerId` from `graph:executeAllowlistedCloudGraphQuery` in favour of `identity.tokenIdentifier` (`convex/graph.ts:627-649`).
   * Converts `graph:verifyMacroCase001Cloud` to `internalAction` (`convex/graph.ts:707`).
   * Enforces `'reviewer'` role on `graph:projectPendingOutboxNow` (`convex/graph.ts:575-582`) and human `researcher(ctx)` check on `recordProjectionOutcome` / `recordGraphQueryAudit`.

8. **Compile-Time Research-Only Trading Boundary & API Hardening (WP3 & `db4dfe1`) (`[CODE-INSPECTED]`):**
   * Makes `executionPermitted(): false` a literal compile-time guarantee in `lib/trading/execution-boundary.ts` (`POST /api/trading` returns `403`, `POST /api/brokers` rejects `mode: 'live'` with `403`), tightens `x-aci-test-caller` to `NODE_ENV === 'test' && ! process.env.VERCEL_ENV` (removing `localhost` `Host`-header trust), and redacts raw TypeDB errors in `POST /api/graph/query`.

---

## 5. Security Regressions That Would Arise If the Two Implementations Were Merged

Merging the local Argon Stage 1A working-tree changes into Fable PR #1 (`ae8f742`)—or deploying both side-by-side—would cause **five immediate architectural and security regressions**:

1. **Duplicate Nonce Tables & Split Audit State (`convex/schema.ts`):**
   * Argon defines `chatAcceptanceNonces` (`state: 'issued' | 'consumed' | 'recorded' | 'failed'`) inside `convex/evidenceChat.ts`, whereas Fable PR #1 defines `acceptanceNonces` (`status: 'issued' | 'consumed' | 'recorded' | 'failed'`) in `convex/acceptanceNonces.ts` coupled to `chatBudgetReservations` in `convex/chatBudget.ts`. Having both tables in `convex/schema.ts` creates two parallel bearer-token stores with split budget accounting.
2. **Bypass of `chatBudgetReservations` and `recordedVia` Attestation (`app/api/graph/chat/route.ts` & `convex/evidenceChat.ts`):**
   * If Argon's `app/api/graph/chat/route.ts` or `convex/evidenceChat.ts` overwrote Fable's versions, signed-in `/api/graph/chat` requests would no longer call `/api/evidence-chat/budget/reserve` or `/api/evidence-chat/turn`, and `recordEvidenceChatTurn` would lose `clientRecordedTurnViolations`, re-opening client-side fabrication of `gemini_live` audit rows and concurrent budget exhaustion.
3. **Incompatible Gateway Secrets, Headers, and HTTP Routes (`convex/http.ts`):**
   * Argon registers `/api/chat/acceptance/{consume,record,fail}` using `Authorization: Bearer <CHAT_ACCEPTANCE_GATEWAY_SECRET>`, whereas Fable registers `/api/evidence-chat/{acceptance/consume,acceptance/record,acceptance/fail,turn,budget/reserve}` using `X-ACI-Gateway-Authorization: Bearer <EVIDENCE_CHAT_GATEWAY_SECRET>`. Keeping both route trees doubles the HTTP attack surface and requires operators to manage competing gateway secrets.
4. **Incompatible Nonce Token Prefixes (`aci-accept-v2.` vs. `acn1.`):**
   * Tokens minted by `mintAcceptanceNonce` (`acn1.<hex32>.<hex64>`) are rejected by Argon's parser (`aci-accept-v2.<uuid>.<hex64>`) and vice versa.
5. **Reintroduction of `RESEARCH_OWNER_ID` into Acceptance Nonce Minting/Consumption:**
   * Merging Argon's `mintServerAcceptanceTokenInternal` / `consumeAcceptanceNonceAndGetContext` would reintroduce `process.env.RESEARCH_OWNER_ID` fallback into the acceptance flow, directly conflicting with Fable PR #1's explicit `<issuer>|<subject>` tenant binding.

**Mandatory Action:** **Do not merge Argon Stage 1A's files over Fable PR #1.** Instead, discard the local uncommitted Argon Stage 1A working-tree edits after extracting the targeted surgical improvements listed in Section 9 onto Fable PR #1 (`ae8f742`).

---

## 6. Assessment of `RESEARCH_OWNER_ID` Fallback in the Internal Acceptance Workflow

Requirement 6 asks us to assess whether `RESEARCH_OWNER_ID` fallback in the internal acceptance workflow creates an unintended unauthenticated owner capability:

1. **In Baseline `main` (`639a2ed` — Pre-Remediation) `[CODE-INSPECTED]`:**
   * `consumeAcceptanceNonceAndGetContext` and `recordAcceptanceChatTurn` were **public mutations** that accepted an optional `args.owner` and fell back to `process.env.RESEARCH_OWNER_ID ?? 'system_acceptance'`. Because any unauthenticated internet client could call those public mutations and forge an `aci-accept-v1` token timestamp, that fallback created a **critical unauthenticated owner-impersonation vulnerability** (exposing `RESEARCH_OWNER_ID`'s 24-hour spend telemetry and writing forged turns into `RESEARCH_OWNER_ID`'s `evidenceChatAudit` partition).
2. **In Argon Stage 1A (Local) `[CODE-INSPECTED]`:**
   * Converting `mintServerAcceptanceTokenInternal` and `consumeAcceptanceNonceAndGetContext` to `internalMutation` eliminated unauthenticated public exploitation. **However**, retaining `const owner = (args.owner ?? process.env.RESEARCH_OWNER_ID ?? '').trim()` inside `mintServerAcceptanceTokenInternal` (`convex/evidenceChat.ts:689`) and checking `row.owner !== configuredResearchOwner` when `authenticatedOwner` is absent (`convex/evidenceChat.ts:785-788`) still creates two architectural weaknesses:
     * **Ambient Default Authority:** An operator invoking `mintServerAcceptanceTokenInternal` without an `owner` argument silently mints a bearer capability scoped to `RESEARCH_OWNER_ID` without explicitly naming the target tenant or recording operator attribution (`issuedBy`).
     * **Single-Tenant Lock-In:** Requiring `row.owner === process.env.RESEARCH_OWNER_ID` on unauthenticated gateway consumption prevents the acceptance harness from testing any tenant partition other than `RESEARCH_OWNER_ID`.
3. **In Fable PR #1 (`ae8f742`) `[CODE-INSPECTED]`:**
   * **`RESEARCH_OWNER_ID` is completely absent from `convex/acceptanceNonces.ts` and `convex/chatBudget.ts`.** `mintAcceptanceNonce` (`convex/acceptanceNonces.ts:178-199`) requires an explicit `owner` matching `OWNER_TOKEN_IDENTIFIER_PATTERN` (`/^https:\/\/[^|\s]{3,300}\|[^|\s]{1,300}$/`), an explicit `question`, and an explicit `operator` name (`issuedBy: "deployment-admin:<operator>"`).
   * The only remaining use of `RESEARCH_OWNER_ID` in Fable PR #1 is inside `convex/operations.ts:750` (`const pipelineOwner = owner ?? (audience === 'public' ? process.env.RESEARCH_OWNER_ID : null)`), where `privateRead` is strictly `false` (`line 747`) and the output is filtered through `toPublicOperationsStatus` (`lines 670-709`) to serve non-private system status on `/` and `/workspace`.

**Conclusion on `RESEARCH_OWNER_ID`:** Fable PR #1's complete elimination of `RESEARCH_OWNER_ID` from the acceptance and budget workflows is strictly superior to Argon Stage 1A's internal fallback.

---

## 7. Evaluation of Concurrent Reservation Handling and Unsettled Provider Cost Risk

Requirement 7 requires a rigorous evaluation of Fable PR #1's concurrent budget reservation handling (`convex/chatBudget.ts`) and the risk of provider costs being incurred without successful audit settlement:

### 7.1 How Concurrent Reservations Are Serialised (`[CODE-INSPECTED]`)
In Fable PR #1 (`ae8f742:convex/chatBudget.ts:45-120`), `evaluateAndReserveBudget(ctx, owner, source, now)`:
1. Queries `evidenceChatAudit` via `.withIndex('by_owner_created', q => q.eq('owner', owner).gte('createdAtMs', windowStart))`.
2. Queries `chatBudgetReservations` via `.withIndex('by_owner', q => q.eq('owner', owner))`.
3. Sums `auditSpend` (all `gemini_live` turns in the last 24h) + `reservedSpend` (all rows in `chatBudgetReservations` with `status === 'reserved' && expiresAtMs > now`).
4. Checks `recentTurns + recentReservations >= 10` (last 60s) and `spentGbp + 0.05 > ceilingGbp` (`£1.00`).
5. Inserts a new document into `chatBudgetReservations` (`{ owner, reservationSha256, status: 'reserved', reservedCostGbp: 0.05, createdAtMs: now, expiresAtMs: now + 300_000, source }`).

Because every invocation of `evaluateAndReserveBudget` for a given `owner` **both reads the `by_owner` index range on `chatBudgetReservations` and inserts a new row into that exact same `by_owner` index range**, Convex's serializable Optimistic Concurrency Control (OCC) detects a read-write conflict whenever two concurrent mutations execute in parallel for the same `owner`. Only one transaction commits per snapshot; Convex automatically retries the conflicting transaction against the updated snapshot where the first reservation is now visible in `reservations`.

### 7.2 Identified Residual Risk: Unsettled Provider Costs After the 5-Minute `RESERVATION_TTL_MS` Window (`[CODE-INSPECTED]`)
What happens if Next.js reserves budget (`status: 'reserved'`, `expiresAtMs = T + 5 min`), **calls the live Gemini API (incurring real provider cost)**, and then the Next.js serverless function crashes, times out, or fails to reach `/api/evidence-chat/turn` (or `/api/evidence-chat/acceptance/record`) to settle the audit record?

Inspecting `ae8f742:convex/chatBudget.ts:53-55` and `lib/graph/chat-turn-audit-validation.ts:659`:
```ts
const active = reservations.filter((r) => r.status === 'reserved' && r.expiresAtMs > now);
```
1. **During the first 5 minutes (`now < expiresAtMs`):** The unsettled reservation conservatively holds `£0.05` (`MAX_RESERVATION_COST_GBP`) against the owner's `£1.00` daily ceiling and counts as 1 request against the 10-requests/minute rate limit.
2. **After 5 minutes (`now >= expiresAtMs`):** Because `active` filters by `r.expiresAtMs > now`, an **unsettled** reservation (`status === 'reserved'`, `settledAtMs === undefined`) **drops to `£0.00` in `computeActiveReservationSpendGbp`** once 5 minutes have elapsed!
3. **Consequence:**
   * If a server crash, network partition, or uncaught post-inference error prevents `recordAuthenticatedTurn` / `recordAcceptanceTurn` from settling the reservation, the real Gemini provider cost incurred during that turn is **forgotten by the budget ledger 5 minutes later**.
   * Furthermore, in `ae8f742:app/api/graph/chat/route.ts:987-1139`, `releaseChatBudget` (`convex/chatBudget.ts:195`) is **never called** when a pre-provider step fails, nor is a failed/crashed turn's reservation transitioned to a settled state when `failNonceInternal` (`convex/acceptanceNonces.ts:544-569`) runs!
4. **Targeted Remediation (Small Surgical Fix on Fable PR #1):**
   * Count any `chatBudgetReservations` row created within the last 24 hours (`r.createdAtMs >= windowStart`) whose `status === 'reserved'` (i.e. **never explicitly settled by an audit write and never explicitly released before calling Gemini**) against the 24-hour spend ceiling (`reservedCostGbp`), **or** require `app/api/graph/chat/route.ts` to release the reservation only when aborting *before* invoking the Gemini provider (`releaseChatBudgetInternal`), while treating expired-unreleased reservations (`status === 'reserved' && expiresAtMs <= now`) as conservative unsettled spend (`£0.05`) for the remainder of the 24-hour window.
   * Additionally, in `failNonceInternal` (`convex/acceptanceNonces.ts:544-569`), if the nonce failed *before* provider invocation, settle/release `row.budgetReservationSha256`; if it failed *after* provider invocation (or is unknown), mark the reservation as `abandoned_unsettled` so its conservative `£0.05` remains accounted for in the 24h window.

---

## 8. Six-Column Security Reconciliation Matrix

| Security invariant | Fable PR #1 (`ae8f742`) | Argon Stage 1A (Local) | Stronger implementation | Evidence | Required action |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Gateway authentication & credential scope** | Dedicated `EVIDENCE_CHAT_GATEWAY_SECRET` (`>= 32` chars) in `X-ACI-Gateway-Authorization: Bearer <secret>` + `_PREVIOUS` rotation secret + active constant-time refusal if secret equals `OPERATIONS_SCHEDULER_SECRET` or `RESEARCH_STAGING_TOKEN`. | `CHAT_ACCEPTANCE_GATEWAY_SECRET` (`>= 32` chars) in `Authorization: Bearer <secret>` (Convex) and `x-aci-acceptance-gateway-secret` (Next.js). No `_PREVIOUS` rotation; no programmatic reuse refusal. | **Fable PR #1 (`ae8f742`)** | `[CODE-INSPECTED]` `ae8f742:convex/http.ts:189-227`, `ae8f742:lib/graph/evidence-chat-gateway.ts:96-114`; `[EXECUTED-TEST]` `tests/evidence-chat-gateway.test.ts` (PR #1). | Keep Fable PR #1 implementation unchanged. Discard Argon's `CHAT_ACCEPTANCE_GATEWAY_SECRET`. |
| **2. Owner identity validation (signed-in & acceptance)** | Signed-in: Clerk JWT verified in both Next.js (`authenticateGraphCaller`) and Convex (`ctx.auth.getUserIdentity()` + `verifyIdentityClaims`). Acceptance: explicit `<issuer>\|<subject>` required at mint time; no `RESEARCH_OWNER_ID` fallback. *Gap:* ignores `x-aci-acceptance-nonce` if a Clerk session is also active (`!caller && acceptanceToken`). | Signed-in: Clerk session in Next.js. Acceptance: allowed `RESEARCH_OWNER_ID` fallback at mint/consume time, *but* explicitly rejected (`401 owner_mismatch`) if both Clerk session and `x-aci-acceptance-nonce` were sent with mismatched owners. | **Fable PR #1 (`ae8f742`) + Argon's dual-credential mismatch check** | `[CODE-INSPECTED]` `ae8f742:convex/acceptanceNonces.ts:178-199`, `ae8f742:app/api/graph/chat/route.ts:911`; Argon `app/api/graph/chat/route.ts:273-286`. | Keep Fable PR #1's explicit `<issuer>\|<subject>` binding, and add a 6-line check in `app/api/graph/chat/route.ts` rejecting (`400`/`401`) requests that send both a Clerk session and `x-aci-acceptance-nonce` (or cross-checking `caller.actorId === consumed.value.owner`). |
| **3. Nonce issuance, CSPRNG environment & storage at rest** | `mintAcceptanceNonce` is an `internalAction` (`acn1.<32hex>.<64hex>`); `reservation` (`64hex`) minted in `httpAction`. Both `secretSha256` and `reservationSha256` stored **hashed at rest** in `acceptanceNonces`. Enforces `recordDeadlineMs` (3 min) and idempotent duplicate record for same `turnId`. | `mintServerAcceptanceTokenInternal` and `consumeAcceptanceNonceAndGetContext` called `crypto.getRandomValues` inside `internalMutation` (risking Convex deterministic mutation runtime restrictions) and stored `reservationId` in **plaintext** while `consumed`. | **Fable PR #1 (`ae8f742`)** | `[CODE-INSPECTED]` `ae8f742:convex/acceptanceNonces.ts:169-236, 336-412`, `ae8f742:convex/http.ts:238`. | Keep Fable PR #1 (`acceptanceNonces` table + `internalAction` minting + `reservationSha256`). Discard Argon's `chatAcceptanceNonces`. |
| **4. Fail-closed acceptance audit recording (`POST /api/graph/chat`)** | **Fails open on `record` error:** if `recordAcceptanceTurn` returns `{ ok: false }`, `app/api/graph/chat/route.ts:1094-1128` does **not** call `failAcceptanceNonce` and returns **HTTP `200 OK`** with `auditRecorded: 'not_recorded'`. | **Fails closed:** if `record` returns `!recordResp.ok`, `app/api/graph/chat/route.ts:365-378` calls `notifyAcceptanceNonceFailure` (`fail`) and returns **HTTP `502` (`acceptance_audit_record_failed`)**. | **Argon Stage 1A** | `[CODE-INSPECTED]` `ae8f742:app/api/graph/chat/route.ts:1094-1128` vs. Argon `app/api/graph/chat/route.ts:365-378`; `[EXECUTED-TEST]` `tests/remediation-stage-1a-convex-access-control.test.ts`. | **Port Argon's fail-closed check to Fable PR #1:** when `acceptance` is active and `!rec.ok`, call `failAcceptanceNonce` and return HTTP `502` instead of `200 OK`. |
| **5. Question-hash binding** | **Mandatory** `question` on every minted nonce (`questionSha256`). Verified in constant time at `consumeNonceInternal` and recomputed synchronously via `sha256HexSync(turn.question.trim())` inside `recordNonceTurnInternal`. | Optional `question` at mint time (`boundQuestionSha256: string \| null`). | **Fable PR #1 (`ae8f742`)** | `[CODE-INSPECTED]` `ae8f742:convex/acceptanceNonces.ts:181, 368, 518-520`, `ae8f742:lib/crypto/sha256.ts`. | Keep Fable PR #1 implementation unchanged. |
| **6. Client-field allowlisting & inner JSON schema validation** | Positive allowlist `pickTurnAuditFields` (`TURN_AUDIT_FIELDS`) rejects any unknown key in `turn`; enforces $\pm 15$ min `createdAtMs` clock skew. *Gap:* `bundleJson`, `answerJson`, and `validationJson` are only checked with `parsesAsObject` (`typeof JSON.parse(raw) === 'object'`). | Recursive `hasForbiddenKeys` (13 keys) + full Zod schema validation (`evidenceBundleSchema`, `evidenceLockedAnswerSchema`, `answerValidationReportSchema`) + cross-check that inner `bundleId` and `bundleSha256` match top-level columns. *Gap:* no $\pm 15$ min clock-skew check. | **Combined (Fable's `pickTurnAuditFields` + clock-skew check + Argon's inner Zod & `bundleId`/`bundleSha256` validation)** | `[CODE-INSPECTED]` `ae8f742:convex/acceptanceNonces.ts:447-457`, `ae8f742:lib/graph/chat-turn-audit-validation.ts:640-648` vs. Argon `convex/evidenceChat.ts:255-278`. | **Port Argon's inner `bundleId`/`bundleSha256` and Zod schema check** into `lib/graph/chat-turn-audit-validation.ts` (`validateTurnAuditFields`). |
| **7. Public vs. internal Convex functions & broader action surface** | Removes public nonce mutations; restricts `recordEvidenceChatTurn` via `clientRecordedTurnViolations`; authenticates `checkGeminiProviderStatusAction`; gates TypeDB cloud actions with `TYPEDB_BRIDGE_SECRET`; binds `executeAllowlistedCloudGraphQuery` to JWT; makes `verifyMacroCase001Cloud` internal; enforces `'reviewer'` role on `projectPendingOutboxNow`. | Converts nonce mutations to `internalMutation`; scopes `publicOperationsOverview` and `getChatOperationsTelemetry`; adds human check to `projectPendingOutboxNow`. Leaves `checkGeminiProviderStatusAction` and TypeDB cloud actions untouched. | **Fable PR #1 (`ae8f742`)** | `[CODE-INSPECTED]` `ae8f742:convex/evidenceChat.ts:468-482`, `ae8f742:convex/graph.ts:484-707`, `ae8f742:convex/operations.ts:238-275, 670-750`. | Keep Fable PR #1 implementation. (Optionally make `publicOperationsOverview` skip `researchJobs`/`graphProjectionCheckpoints` DB reads if job timestamps are considered non-public). |
| **8. Budget reservation, rate limiting & unsettled cost accounting** | Atomic serializable `chatBudgetReservations` (`£0.05` hold, `10/min` rate limit across turns + reservations, `503 budget_unavailable` fail-closed). *Residual gap:* unsettled reservations drop out of `computeActiveReservationSpendGbp` after `RESERVATION_TTL_MS` (5 min) if the server crashes after calling Gemini or `record` fails. | Read-only budget check before inference (`getChatRetrievalContext`); no reservation table; TOCTOU race window under parallel requests. | **Fable PR #1 (`ae8f742`) + unsettled expired reservation accounting** | `[CODE-INSPECTED]` `ae8f742:convex/chatBudget.ts:45-120`, `ae8f742:lib/graph/chat-turn-audit-validation.ts:655-667`. | Keep Fable PR #1's `chatBudgetReservations` and update `computeActiveReservationSpendGbp` / `failNonceInternal` so unreleased reservations that were not aborted pre-provider remain counted in the 24h window. |
| **9. Provider telemetry provenance (`recordedVia`)** | Enforces `recordedVia` (`convex_action`, `server_gateway`, `server_gateway_acceptance`, `client_jwt_legacy`), blocks `gemini_live` on `client_jwt_legacy`, requires an active `budgetReservationSha256` to record `gemini_live`, and filters telemetry via `isAttestedLiveTurn`. | No `recordedVia` column; no `isAttestedLiveTurn` filter; signed-in callers could still write `gemini_live` via `recordEvidenceChatTurn`. | **Fable PR #1 (`ae8f742`)** | `[CODE-INSPECTED]` `ae8f742:lib/graph/chat-turn-audit-validation.ts:559-589`, `ae8f742:convex/evidenceChat.ts:127-152, 439-458`. | Keep Fable PR #1 implementation unchanged. |
| **10. Error handling, deployment redaction & migration safety** | Gateway `10s` timeout + `redirect: 'error'`; `/api/graph/query` generic error message; `x-aci-test-caller` restricted to `NODE_ENV === 'test' && !process.env.VERCEL_ENV`. *Gap:* `benevolent-magpie-921 / prestigious-dragon-8` still unredacted in `lib/remote-ops/health-monitor.ts:538`. | Redacted `benevolent-magpie-921 / prestigious-dragon-8` in both `convex/operations.ts` and `lib/remote-ops/health-monitor.ts:538`. | **Fable PR #1 (`ae8f742`) + Argon's `health-monitor.ts:538` redaction** | `[CODE-INSPECTED]` `ae8f742:lib/remote-ops/health-monitor.ts:538` vs. Argon `lib/remote-ops/health-monitor.ts:538`. | Redact `benevolent-magpie-921 / prestigious-dragon-8` in `lib/remote-ops/health-monitor.ts:538` on Fable PR #1. |

---

## 9. Minimum Targeted Changes Recommended on Top of Fable PR #1 (`ae8f742`)

To preserve a **single authoritative security release candidate** while achieving the combined security strength of both reviews, **do not merge Argon Stage 1A**. Instead, apply only the following **four small, surgical corrections** directly onto the Fable PR #1 branch (`origin/claude/exciting-bardeen-f4y1iz` @ `ae8f742`):

1. **Fail Closed When Acceptance Audit Recording Fails (`app/api/graph/chat/route.ts:1094-1100`):**
   * In `app/api/graph/chat/route.ts`, when `acceptance` is active and `const rec = await recordAcceptanceTurn(...)` returns `!rec.ok`, immediately invoke `await failAcceptanceNonce(acceptance.token, acceptance.reservation, \`Audit record failed: \${rec.error}\`)` and return `NextResponse.json({ error: 'Failed to record acceptance audit turn', code: 'acceptance_audit_record_failed' }, { status: 502 })` rather than returning HTTP `200 OK` with `auditRecorded: 'not_recorded'`.
2. **Reject Simultaneous Clerk Session + Acceptance Nonce Header (`app/api/graph/chat/route.ts:911`):**
   * Replace `if (!caller && acceptanceToken)` with an explicit guard: if `caller && acceptanceToken`, either reject with HTTP `400` (`ambiguous_credentials: Do not supply both a Clerk session and x-aci-acceptance-nonce`) or verify `caller.actorId === consumed.value.owner` so a mismatched acceptance header is never silently ignored.
3. **Preserve Unreleased Budget Reservations in the 24-Hour Spend Window Unless Explicitly Released Pre-Provider (`lib/graph/chat-turn-audit-validation.ts:655-667`, `convex/chatBudget.ts`, `app/api/graph/chat/route.ts`):**
   * If `POST /api/graph/chat` aborts *before* invoking the Gemini provider, release the reservation (`releaseChatBudgetInternal`); if a reservation is never settled or released after provider invocation commences (`status === 'reserved' && createdAtMs >= windowStart`), continue counting its `reservedCostGbp` (`£0.05`) in the 24-hour rolling budget calculation so crashed or unrecorded live calls cannot evaporate from the daily spend ceiling after 5 minutes.
4. **Verify Inner `bundleId` / `bundleSha256` Integrity in `validateTurnAuditFields` (`lib/graph/chat-turn-audit-validation.ts:640-648`) and Redact `lib/remote-ops/health-monitor.ts:538`:**
   * In `validateTurnAuditFields`, verify that parsed `bundleJson` and `answerJson` contain `bundleId === fields.bundleId` and `bundleSha256 === fields.bundleSha256`.
   * In [`lib/remote-ops/health-monitor.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/remote-ops/health-monitor.ts#L538), replace `'Convex Cloud (benevolent-magpie-921 / prestigious-dragon-8, eu-west-1)'` with `'Convex Cloud (eu-west-1)'`.

---

## 10. Final Determination

**`TARGETED CORRECTIONS REQUIRED`**

*(Specifically: retain **Fable PR #1 (`ae8f742`)** as the sole authoritative security architecture, discard the separate local Argon Stage 1A implementation so no competing tables/secrets/routes are introduced, and apply the 4 targeted surgical corrections in Section 9 to `origin/claude/exciting-bardeen-f4y1iz` before independent staging verification and production promotion.)*
