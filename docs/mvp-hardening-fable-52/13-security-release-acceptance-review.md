# 13 — Security release acceptance review (staging readiness)

**Reviewed code:** `ee98ae5`. The branch head `0ceafaf` adds only `docs/trading-research-lab-001/`; verified with `git diff --quiet ee98ae5 HEAD -- ':!docs'`.
**Date:** 11 November 2026.

**Reviewer independence: NONE.** This review was produced by the same AI session that wrote PR #1 and every correction under review. It was performed adversarially:
- findings were established by executing probe tests against the actual code, not taken from the author's reports;
- the probes were removed afterwards and no source file was changed.

It is still **developer self-review**. It must not be counted as independent verification (V4), and it does not replace the separate reviewer required before production.

## 1. Decision

**REQUEST CHANGES.**

Four defects were confirmed by executed probes in the budget and evidence-integrity paths introduced by the latest corrections:
- a reconciled billed charge is ignored;
- unknown liability disappears after 24 hours;
- client-recorded evidence is labelled with the strict integrity marker;
- one budget reservation can cover several paid provider calls, with billed usage lost.

The migration has no working gate that prevents unrecorded or paid research while the Convex and Vercel versions are mismatched.

Several items also need staging access that this environment does not have (§4). Staging is not approved. Production is not authorised by this review in any case.

## 2. Findings (critical verification items)

| # | Item | Result | Evidence and location |
|---|---|---|---|
| 1 | Accepted answers have durable, matching audit records | **FAIL** (partial) | **Acceptance turns and paid signed-in turns:** confirmed only after their record is confirmed (`app/api/graph/chat/route.ts:159-198`, `:450-481`; suite `security-chat-route-audit-fail-closed`, 8/8 executed). **Non-paid signed-in turns:** still returned 200 with `auditRecorded: 'not_recorded'` when both the gateway and the legacy record fail, or when there is no Convex token (`route.ts:482-509`). **Convex action path:** fails if the record throws. |
| 2 | Retries cannot produce duplicate paid inference or duplicate charges | **FAIL** | **Route-level audit retries:** pass (single retry, same `turnId`, Convex dedupe at `convex/acceptanceNonces.ts:417` `recordTurnWithReservation`). **Inside the provider adapter:** a malformed, timed-out, 429 or 5xx response is retried across up to 7 candidate models within one request (`lib/graph/gemini-provider-adapter.ts:1327`, `:1609-1619`). **Probe P4:** a first response with 1,500 output tokens that failed to parse caused a second paid call; the turn recorded only the second call's 100 output tokens. One reservation covered two paid calls, and the first call's usage was lost. **Client resubmission:** the chat route has no request idempotency key, so resubmitting after a 503 makes a new paid call (each separately reserved and accounted). |
| 3 | Unknown provider charges remain recorded after the 24-hour window | **FAIL** | **Probe P2:** a started call that never reported back had stored status `in_flight` after 24 hours, and `listUnresolvedReservationsInternal` returned **0 rows** (`convex/chatBudget.ts:316` filters `createdAtMs ≥ now − 24h`). Both the liability and the operator's view disappear, although the row still exists. |
| 4 | Budget lifecycle: crashes, timeouts, retries, delayed callbacks, reconciliation | **FAIL** | **Pass:** crash after start → `unknown`; timeout → `unknown`; delayed callback settles; duplicate completion is idempotent (suite `security-chat-budget-reservation`, 24/24 executed). **Probe P1:** after a timeout was recorded (audit row with £0 cost), reconciling it to `settled` with an actual billed charge of £0.04 **did not count the £0.04**. `reservationLiabilityGbp` counts reconciled charges only when `auditId === null` (`convex/chatBudget.ts:71`), so a further £0.05 reservation was allowed against a £0.06 ceiling. |
| 5 | Concurrent reservations cannot overspend | **NOT VERIFIED** | **Passes under convex-test's serial transaction model:** 6 concurrent requests against a £0.11 ceiling gave exactly 2 granted. **Design analysis:** `reserveChatBudget` reads the owner's audit and reservation index ranges and inserts in one mutation; Convex's optimistic concurrency should serialise conflicting writers. Not proven without a real backend. |
| 6 | Nonce consumption single-use under real Convex semantics | **NOT VERIFIED** | No staging Convex deployment is available here. The serial-model tests pass (2- and 10-way, `security-acceptance-nonce`). |
| 7 | No client field can override ownership, question identity or provenance | **PASS** | Explicit allowlist `pickTurnAuditFields` (`convex/acceptanceNonces.ts`); the question is hashed inside the mutation against the persisted nonce hash; owner, provenance and reservation are applied after the allowlisted fields (`convex/http.ts`). Suite `security-gateway-field-allowlist` 7/7 executed, including nested `owner`, `recordedVia`, `turnQuestionSha256`, `nonceId` and `budgetReservationSha256`. |
| 8 | Legacy public mutations cannot manufacture verified live inference | **PASS**, with a related **FAIL** | **Live claims, provider success and cost** are refused on the client path, and live counts use only attested rows (suite `security-live-evidence-attestation`, 5/5). **Related (probe P3):** the client path accepted a self-consistent fabricated evidence bundle (digest recomputed by the client) and stored it with `evidenceIntegrity: 'strict_v1'` (`convex/acceptanceNonces.ts:396`). The marker certifies internal consistency only, not server origin, yet it is applied to `client_jwt_legacy` rows. |
| 9 | Graph-query authorisation and the TypeDB bridge | **PASS**, with residual risk | Allowlisted queries take identity from the verified token, and tenant filtering is keyed on it. Bridge actions require `TYPEDB_BRIDGE_SECRET` (`convex/graph.ts:59`, `:1069`, `:1116`, `:1141`). Projection sync requires a reviewer grant (suite `security-runtime-hardening`, 17/17). **Residual:** the bridge secret grants read-only TypeQL across all tenants. It is passed as an action **argument**, and whether Convex retains action arguments anywhere visible is **NOT VERIFIED**. |
| 10 | Live trading cannot be activated by runtime configuration | **PASS** | Compile-time constant `DEPLOYMENT_EXECUTION_AUTHORITY = 'none'` (`lib/trading/execution-boundary.ts:22`), enforced in the route, the order client and Convex. Suite `security-research-only-boundary` 20/20 executed with both flags `true`. **Residual (rollout only):** the *old* production route's `cancel` action (`origin/main:lib/trading/server.ts`) reaches the broker without a Convex check until Vercel is updated. |
| 11 | Convex-first / Vercel-second incompatibility | **FAIL** | See §5. While old Next.js runs against new Convex: <ul><li>live turns recorded through the client mutation are refused;</li><li>old deterministic turns (labelled `succeeded`) fail validation;</li><li>the old route then returns **200 with unrecorded answers**, including paid live answers.</li></ul> |
| 12 | Maintenance / feature gate preventing unrecorded research during migration | **FAIL** (absent) | There is no gate in the code. The intended switch does not work: `EVIDENCE_CHAT_GEMINI_ENABLED=false` does **not** stop paid calls in `auto` mode, in both the old (`origin/main` adapter line 1079) and new (line 1103) code; the flag only affects `gemini_live_required` mode. |
| 13 | Old and new versions compatible with the rollback process | **FAIL** | Rolling Vercel back to the current production build while the new Convex is live recreates the unrecorded-answer state in item 11. |
| 14 | Reported CI run and required checks | **PASS** (run) / **FAIL** (gating) | Run 42933714505 on `ee98ae5`: `pull_request`, completed, success (re-queried via the GitHub API). `main` reports `protected=false`; the branch-protection endpoint returned 403 to this integration. **Missing required checks:** <ul><li>required status check on `main`;</li><li>Convex-config type check (`tsc -p convex`; the root `tsc` covers the files under different compiler settings);</li><li>Convex bundling or deploy dry-run;</li><li>live TypeDB integration (skipped);</li><li>secret scanning;</li><li>a check that the Vercel production deploy depends on CI.</li></ul> |
| 15 | Inherited lint errors and advisories | **PASS** | All 29 ESLint errors are outside security-sensitive code: 23 `no-explicit-any` in `lib/research-ratings/sec-xbrl-expansion.ts` and one test file, 4 `react-hooks/purity` in pages and components, 2 unescaped entities. None in `convex/`, `lib/graph/`, `lib/brokers/`, `lib/trading/`, `lib/auth/`, `app/api/` or `proxy.ts`. All 8 advisories are moderate and dev-only (ESLint and `minimatch` ReDoS); `npm ls --omit=dev` shows none reach production dependencies. |

**Additional finding (not in the list):** `GET /api/graph/chat?statusOnly=1` runs `checkGeminiProviderAvailability({verifyEndpoint: true})` **before authentication** (`app/api/graph/chat/route.ts:85` precedes `:99`). Anonymous callers can make the server call the provider's model endpoints with its key and learn the provider's configuration state. This is the same class as the Convex probe action closed in `1671224`. **Severity: low to medium.**

**Corrections under review, summarised:**

| Commit | Result |
|---|---|
| `c9c274b` ambiguous credentials | **PASS** (route code `:225`; suite `security-chat-route-credentials` 6/6) |
| `8f382d3` budget accounting | **FAIL** (items 2, 3, 4) |
| `f892962` fail-closed audit | **PASS** for acceptance and paid turns; **FAIL** for non-paid signed-in turns (item 1) |
| `74fd033` evidence validation | **PASS** for consistency checks (`security-evidence-validation` 16/16); **FAIL** on labelling of client-recorded rows (item 8) |
| `90de0a3` public status labels | **PASS** (`public-status-identifiers` 3/3) |

## 3. Tests actually executed (this review, local, Linux)

| Check | Result |
|---|---|
| Next.js `tsc --noEmit`; Convex `tsc -p convex --noEmit` | pass; pass |
| Vitest full suite | **730 passed, 4 skipped** (3 live TypeDB, 1 billable live evaluation) |
| Python `unittest` | 218 passed, 1 skipped (live TypeDB) |
| actionlint | pass |
| ESLint inventory; `npm audit`; `npm ls --omit=dev` | as in item 15 |
| GitHub API: run 42933714505; `main` protection flag | success; `protected=false` (protection details: 403) |
| Adversarial probes P1–P4 (temporary file, deleted) | all four **reproduced the defect**; results in items 2–4 and 8 |

## 4. Blocked by environment limitations

| Test | Blocker |
|---|---|
| Nonce single use and reservation concurrency under real Convex OCC | No non-production Convex deployment or deploy key here |
| Convex bundling and deployment of the new modules | No deploy key |
| Live TypeDB integration (3 Vitest + 1 Python) | No TypeDB server |
| Strict evidence validation against production-shaped and TypeDB-backed bundles | No staging stack |
| Real provider timeout and billing comparison | No billable runs authorised |
| Branch-protection settings detail | API returned 403 to this integration |
| Whether Convex retains action arguments (bridge secret exposure) | Requires Convex platform documentation or support confirmation |

## 5. Release compatibility matrix

| Next.js \ Convex | Old Convex (`main`) | New Convex (`ee98ae5`) |
|---|---|---|
| **Old Next.js (`main`)** | Today: vulnerable (anonymous reads, open nonce mutations, anonymous graph query); research recorded without validation | **Unsafe for research:** <ul><li>Convex holes are closed;</li><li>old live and deterministic turns are refused at the audit boundary, and the old route still returns 200, so answers are returned unrecorded (paid calls included);</li><li>acceptance path is 401;</li><li>bridge probe degrades;</li><li>old trading `cancel` still reaches the broker if flags are on.</li></ul> |
| **New Next.js (`ee98ae5`)** | **Fails closed for paid chat** (503: reserve and start routes are missing); non-paid signed-in turns are recorded through the old legacy mutation without validation; acceptance is 401. Convex holes are still open | Intended state, subject to the fixes in §6 |

## 6. Required changes before staging (minimal, no new architecture)

| ID | Change | Addresses |
|---|---|---|
| R1 | One paid provider attempt per reservation: <ul><li>on the paid path, do not retry across models;</li><li>never retry after a response that returned usage (including parse failures);</li><li>record a parse failure as `provider_error` with failure kind `unknown`, carrying the returned usage.</li></ul> If retries are kept, each attempt needs its own reservation and recorded usage. | Item 2 (P4) |
| R2 | Count a reconciled charge whatever `auditId` is: liability = reconciled charge − cost already on the audit row, floored at 0 | Item 4 (P1) |
| R3 | `listUnresolvedReservationsInternal` must not filter by the 24-hour window. Decide and document whether unresolved liabilities keep counting against the daily ceiling after 24 hours. Either way they must remain visible and count toward any monthly or experiment ledger until reconciled. | Item 3 (P2) |
| R4 | Do not stamp `evidenceIntegrity: 'strict_v1'` on `client_jwt_legacy` rows; use a distinct value such as `client_asserted_v1` | Item 8 (P3) |
| R5 | Require authentication for `GET /api/graph/chat?statusOnly=1`, or serve it from cached state without a provider call | Additional finding |
| R6 | An owner-controlled maintenance gate in the new chat route (`RESEARCH_CHAT_MAINTENANCE=on` → 503 before any provider call or audit write). Also make `EVIDENCE_CHAT_GEMINI_ENABLED=false` actually block live calls in `auto` mode. | Items 11–13 |
| R7 | Non-paid signed-in turns: apply the same rule as paid turns (no 200 without a confirmed record), or label the response clearly as unaudited and exclude it from research evidence | Item 1 |
| R8 (recommended, may follow staging) | A request idempotency key on `POST /api/graph/chat` so client resubmission reuses the turn instead of making a new paid call | Item 2 |

Each change needs a failing-then-passing regression test, following the existing probes' scenarios.

## 7. Staging test plan (after R1–R7; non-production Convex and Vercel preview with non-production secrets only)

1. Deploy Convex (staging), then the Vercel preview, with `RESEARCH_CHAT_MAINTENANCE=on`. Confirm chat returns 503 with no provider call and no audit write.
2. Concurrency against real Convex:
   - 10 parallel nonce consumes give exactly 1 success;
   - 10 parallel reserves against a ceiling that affords 2 give exactly 2.
3. Crash path: stop the server after `budget/start`. Confirm `unknown` after 5 minutes, still listed after 24 hours (R3), resolved by `reconcileReservationInternal` with an audit event, and the reconciled charge counted (R2).
4. Provider faults: a forced short client timeout and a forced malformed response give exactly one provider call per reservation (R1), with usage recorded.
5. End-to-end: a signed-in chat round trip and an acceptance round trip each produce one `strict_v1` row with matching digests, including one bundle retrieved through live TypeDB.
6. Fail-closed audit: block the audit routes at the gateway. Confirm 502 or 503, the answer withheld, and the nonce state as specified.
7. Anonymous checks: `statusOnly` (R5), the removed nonce mutations, `getChatOperationsTelemetry`, `executeReadOnlyCloudTypeQl` without the bridge secret, and `/api/trading` (403).
8. Run `npm run test:integration:typedb` against staging TypeDB.
9. Record every result with timestamps as V3-staging evidence. A separate reviewer repeats steps 2, 3 and 7.

## 8. Owner-controlled production release plan (only after staging passes and independent review)

1. **Branch protection:** require **CI gate** and one approval on `main`. Confirm Vercel production deploys only from `main`.
2. **Pre-flight:**
   - confirm `LIVE_TRADING_ENABLED` and `DEMO_TRADING_ENABLED` are not `true` in production;
   - review and revoke any stored trading keys;
   - set `EVIDENCE_CHAT_GATEWAY_SECRET` and `TYPEDB_BRIDGE_SECRET` (unique) in Convex and Vercel.
3. **Gate the old code.** The old production code has no working switch (item 12), so research chat must be blocked at the edge before Convex changes: a Vercel firewall rule or platform-level block on `POST /api/graph/chat`. If the edge block is unavailable on the plan in use, the owner removes `GEMINI_API_KEY` from the production environment (an owner credential action, not performed by this review) for the window.
4. **Deploy Vercel first** with `RESEARCH_CHAT_MAINTENANCE=on` (new code, chat off). Convex is still old; paid chat would fail closed anyway.
5. **Deploy Convex.** The window in which the old Convex vulnerabilities remain open is minutes and bounded by steps 4–5. This reverses the earlier "Convex first" advice, because with the gate the Vercel-first order avoids the unrecorded-answer state.
6. Run the post-deployment checks (`03` §7 plus §7 items 5–7 above).
7. Turn the gate off: `RESEARCH_CHAT_MAINTENANCE=off`, redeploy. Remove the edge block or restore the key.
8. **Rollback:**
   - set `RESEARCH_CHAT_MAINTENANCE=on` and redeploy, or promote the previous **new-code** deployment;
   - never promote a Vercel build older than the gate commit while the new Convex is live;
   - never redeploy pre-WP2 Convex functions.

## 9. Remaining security risks after R1–R8

- **No independent review yet.** This document is self-review.
- **Bridge secret** grants all-tenant read-only TypeQL (M1), and is passed as an action argument.
- **Convex admin key in the Next.js server** for broker sync (H4).
- **Unknown liabilities** need operator reconciliation; billing truth is unverified.
- **Concurrency** is unproven until staging.
- **Lab 001 specification:** resolved. It was moved to branch `claude/trading-research-lab-001` and removed from this PR without changing any code.
