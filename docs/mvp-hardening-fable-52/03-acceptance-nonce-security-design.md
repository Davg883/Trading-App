# 03 — Acceptance nonce and chat audit security

**Work package:** WP2, commit `c35f961`
**Status:** IMPLEMENTED LOCALLY / PENDING DEPLOYMENT (V2). Concurrency verified against the convex-test transaction model only; **not** against a real Convex backend (see §5).

## 1. Defects in the original pathway

| Defect | Consequence |
|---|---|
| `consumeAcceptanceNonceAndGetContext` and `recordAcceptanceChatTurn` were **public** mutations | Anyone with a nonce could read the research owner's retrieval context (graph checkpoint, projected relationships, spend, ceiling) and write audit records, bypassing the Next.js route. |
| Owner was always `RESEARCH_OWNER_ID ?? 'system_acceptance'` | No per-request binding; a default label could own records. |
| Nonce = `Math.random` hex, stored **in clear** in the shared `audit` table (`recordId`) | Not cryptographically random; anyone able to read audit rows could replay a live nonce. |
| Nonce lookup scanned the newest 40 audit rows | A busy owner could make a valid nonce unfindable; not indexed. |
| No question binding | A nonce minted for one question could be spent on any other. |
| Audit record fields unvalidated | Arbitrary `estimatedCostGbp` (exhausting the owner's daily ceiling, which is computed from these rows), arbitrary tokens, arbitrary "gemini_live / succeeded" claims. |
| `recordEvidenceChatTurn` (signed-in) also unvalidated | A user could write fabricated live-inference records into their own audit trail. |
| Route read nonce from header and accepted any consumer | Combined with the above, the acceptance path was an unauthenticated owner-impersonation channel. |

## 2. Assessment of the proposed (Argon) redesign

The proposal as described — dedicated indexed table, CSPRNG secrets, SHA-256 at rest, owner/question binding, explicit states, reservation identifiers, internal mutations, a server-to-Convex gateway — is sound in outline. Points that needed correction rather than direct implementation:

1. **An external `ConvexHttpClient` cannot call an `internalMutation`** without deployment-administrator authority. Putting a deploy key into a public Next.js route would create a deployment-wide credential exposed to every route bug. The implementation instead adds **Convex HTTP actions** (`convex/http.ts`) that are public URLs but authenticate a narrowly scoped secret and then call internal mutations.
2. **Randomness must be generated outside mutations.** Convex mutations are deterministic and their `Math.random` is seeded. Minting is therefore an internal *action* (`crypto.getRandomValues`), which stores only digests via an internal mutation. The consume reservation is generated in the HTTP action for the same reason.
3. **A gateway secret is not a user identity.** The secret only proves the call comes from the application server. Acceptance turns take their owner from the nonce row; ordinary signed-in turns recorded through the gateway additionally require the user's Convex-verified JWT. The `x-aci-acceptance-owner` header and any body `owner` / `callerId` field are ignored or rejected.
4. **Convex-first deployment is safe here** if, and only if, the old public mutations are removed in the same deployment (see §6). The brief's concern about breaking chat applies only to the acceptance path, not to signed-in chat.

## 3. Design as implemented

**Table `acceptanceNonces`** (indexed `by_nonce_id`, `by_owner`): `nonceId`, `secretSha256`, `owner`, `purpose = evidence_chat_acceptance`, `questionSha256`, `status ∈ {issued, consumed, recorded, failed}`, `issuedBy`, `issuedAtMs`, `expiresAtMs`, `consumedAtMs`, `reservationSha256`, `recordDeadlineMs`, `recordedAtMs`, `recordedTurnId`, `auditId`, `failureCode`, `failedAtMs`. Rows are never deleted or reopened.

**Token format:** `acn1.<nonceId 128-bit hex>.<secret 256-bit hex>`. Only `SHA-256(secret)` is stored. Default lifetime 120 s, maximum 600 s.

**Lifecycle**

```
mint (internal action, deploy key only; operator names owner + exact question)
  └─ issued ──consume (gateway, question hash must match, before expiresAtMs)──▶ consumed (+reservation, deadline = now + 180 s)
                                                                                 ├─ record (gateway, reservation + question hash, before deadline) ──▶ recorded
                                                                                 └─ fail   (gateway, reservation) ──▶ failed
```

- Every check and the state change happen in **one Convex mutation**. Convex mutations are serialisable; of any number of concurrent consumers, exactly one can observe `issued` and commit.
- Rejections write nothing, so failed attempts cannot burn or extend a nonce.
- Duplicate `record` with the same reservation and turn id returns the original audit id (idempotent callback); a different turn is refused.
- A `consumed` nonce past its deadline is reported as `abandoned` by `listNoncesInternal`; an `issued` one past expiry as `expired`. Neither can be revived: replay protection is never weakened to recover a stuck nonce. Recovery is to mint a new nonce.

**Gateway (Convex HTTP actions):** `POST /api/evidence-chat/acceptance/{consume,record,fail}` and `POST /api/evidence-chat/turn`, authenticated by `X-ACI-Gateway-Authorization: Bearer <EVIDENCE_CHAT_GATEWAY_SECRET>` (constant-time comparison). The secret must be ≥ 32 characters and is **refused** if equal to `OPERATIONS_SCHEDULER_SECRET` or `RESEARCH_STAGING_TOKEN`. `EVIDENCE_CHAT_GATEWAY_SECRET_PREVIOUS` supports rotation. Unset → 503 (fail closed).

**Audit validation** (`lib/graph/chat-turn-audit-validation.ts`), applied to every `evidenceChatAudit` write path: bounded string lengths; SHA-256 format for the bundle hash; recognised mode/status/action enumerations; integer, bounded token counts with `cached ≤ input`; cost 0–£5 per turn; latency ≤ 15 min; `createdAtMs` within 15 min of the server clock; JSON objects within size limits; and cross-field rules — `gemini_live` ⇔ `providerStatus = succeeded`, and no cost without live inference. Each row records `recordedVia` (`convex_action`, `server_gateway`, `server_gateway_acceptance`, `client_jwt_legacy`).

**Telemetry accuracy:** deterministic and refused turns previously reported `providerStatus: succeeded` with estimated token counts, and refused-for-budget turns carried the estimated cost of a call that never happened. They now report `not_invoked`, zero tokens and zero cost.

**Rate limit:** a shared per-owner limit of 10 recorded turns per minute is enforced from the audit table (not process memory) in the Convex action and the Next.js route.

## 4. Test evidence (`tests/security-acceptance-nonce.test.ts`, 26 tests, all passing)

| Required case | Result |
|---|---|
| 2 and 10 simultaneous consumptions | Exactly one 200, others 409 `already_consumed`; one `consumed` audit event |
| Wrong owner / forged owner header / payload owner | Owner always from the nonce row; payload `owner` → 400; header ignored |
| Wrong question | 409 `question_mismatch`, nonce still `issued` |
| Expired | 409 `expired` (server-stored expiry) |
| Already consumed / recorded / failed | 409 with the specific reason |
| Missing / wrong / scheduler / staging gateway credential | 401; unset or reused secret → 503 |
| Provider failure after consumption | Recorded as `abstention_only` / `provider_error`, zero cost |
| Failure during audit recording (invalid record) | 400 with violations; nothing written; nonce stays `consumed`; a corrected record still succeeds once |
| Duplicate callback / retry | Same audit id returned, `duplicate: true` |
| Gateway timeout | Route returns 503, never retries the consume |
| Forged telemetry (cost, tokens, mode/status mismatch, placeholder hash, stale timestamp) | Rejected; cost-allowance exhaustion not possible |
| Signed-in chat preserved | `recordEvidenceChatTurn` still works for the verified caller; `/turn` gateway path records `server_gateway` |

## 5. Concurrency verification — limitation

`convex-test` runs each mutation as an isolated transaction but schedules them one at a time. The tests prove the state machine admits exactly one winner under any serial order of whole transactions; they do **not** exercise Convex's optimistic-concurrency engine. An attempt to start a local Convex backend (`npx convex dev`, anonymous local mode) failed because the backend binary download is blocked by this environment's network policy. **Owner action:** run the 10-way consume test against a non-production deployment:

```bash
npx convex run acceptanceNonces:mintAcceptanceNonce '{"owner":"<issuer>|<subject>","question":"<q>","operator":"<name>"}'
```

then fire ten concurrent `POST <deployment>.convex.site/api/evidence-chat/acceptance/consume` requests with the gateway header, and confirm exactly one 200.

## 6. Migration and release plan

**Choice: B — short controlled maintenance window for the acceptance-token path only.** An expand–migrate–contract rollout would keep the insecure public mutations reachable for the whole expand phase; the acceptance path is an operator tool, so a brief outage of it costs little, while keeping it open keeps an unauthenticated write channel open.

| Step | Action | Compatibility |
|---|---|---|
| 0 | Pre-checks: `npm ci`, typecheck, tests, build on the release commit. Generate `EVIDENCE_CHAT_GATEWAY_SECRET` (≥ 32 random characters, unique) and `TYPEDB_BRIDGE_SECRET`. | — |
| 1 | Set both secrets in the **Convex production** environment and in **Vercel production** (server-only; never `NEXT_PUBLIC_`). | No behaviour change yet. |
| 2 | Deploy Convex (`npx convex deploy`). Schema changes are additive (new table, optional field): no data migration. | Old Next.js revision: signed-in chat keeps working (`getChatRetrievalContext`, `askEvidenceLockedQuestion` and `recordEvidenceChatTurn` keep their argument shapes). **Acceptance path returns 401** (maintenance window begins). Some old-revision audit writes are rejected by the new validation — deterministic turns labelled `succeeded`, and refused-for-budget turns carrying cost — so those turns are answered but not audited until step 3. |
| 3 | Deploy Next.js to Vercel. | Acceptance works again with newly minted `acn1.` tokens; signed-in turns are recorded via the gateway (`server_gateway`). Maintenance window ends. |
| 4 | Post-deployment checks (§7). | — |

Do not rely on a fixed delay between steps; complete step 3 after step 2 reports success, and keep the window as short as practical.

**Rollback:** roll back **Next.js only** (Vercel promote previous deployment). Never redeploy the old Convex functions: that would reopen the vulnerability. The old Next.js revision is compatible with the new Convex functions except for the acceptance path and the audit gaps noted in step 2. If the new Convex deployment itself must be rolled back, redeploy a build of the new code with the specific fix rather than the old revision.

**Partial failure:** if step 2 fails, nothing changed in production. If step 3 fails, production is in the step-2 state: secure, signed-in chat works, acceptance unavailable, some audit gaps.

**Pre-deployment smoke tests (staging deployment):** mint → consume → record succeeds; replay → 409; no gateway header → 401; signed-in chat round trip records a row with `recordedVia = server_gateway`.

## 7. Post-deployment security tests (production, owner-run)

1. `curl -X POST <convex-site>/api/evidence-chat/acceptance/consume` without the gateway header → 401.
2. Call `evidenceChat:consumeAcceptanceNonceAndGetContext` through the Convex HTTP API → "Could not find public function".
3. Anonymous `operations:publicOperationsOverview` → no `evidenceChat`, `recentRuns`, `stagedItems`; broker row absent.
4. Anonymous `evidenceChat:getChatOperationsTelemetry` → "Sign in required".
5. Anonymous `graph:executeReadOnlyCloudTypeQl` → "TypeDB bridge credential required".
6. Signed-in chat question → answer returned and a new audit row with `recordedVia: server_gateway`.

Until these are run and recorded, the status remains **IMPLEMENTED LOCALLY / PENDING DEPLOYMENT**.
