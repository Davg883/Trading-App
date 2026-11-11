# 02 — Security findings and access-control matrix

**Work packages:** WP1 (data isolation, commits `55f91ef`, `1671224`), WP4 graph-action closure (`e7cdf97`)
**Status:** IMPLEMENTED LOCALLY / PENDING DEPLOYMENT. Verification level V2 (tested locally). Not observed in production.

## 1. What was wrong

`buildOperationsOverview` (convex/operations.ts) took an `owner` string. `publicOperationsOverview` passed `identity?.tokenIdentifier ?? process.env.RESEARCH_OWNER_ID`, so an anonymous caller received the research owner's full overview. Inside, when `owner === RESEARCH_OWNER_ID` and that owner had no rows, two fallbacks ran without any owner filter:

```ts
await ctx.db.query('brokerConnections').order('desc').first();        // another user's broker connection
await ctx.db.query('evidenceChatAudit').order('desc').take(200);       // other users' chat telemetry
```

`getChatOperationsTelemetry` repeated both patterns. Because these were Convex `query` functions, they were callable directly over the public Convex API: frontend sign-in was irrelevant.

## 2. What changed

- `buildOperationsOverview` gained an audience (`owner` | `public`). The `public` audience never reads `brokerConnections`, `evidenceChatAudit`, run history, staging items, briefings, review records, forward-research events or spend.
- Owner reads use only the `by_owner` index with the verified `tokenIdentifier`. Both unscoped fallbacks were deleted; an empty owner dataset stays empty.
- `publicOperationsOverview` ignores the caller's identity entirely and passes the result through `toPublicOperationsStatus`, an explicit field allowlist. A field added to the owner overview later is private until listed there.
- `getChatOperationsTelemetry` and `checkGeminiProviderStatusAction` now require a verified human identity (`researcher()` / `verifyIdentityClaims`).
- Graph actions (WP4): bridge actions require `TYPEDB_BRIDGE_SECRET`; the allowlisted query action takes identity from the token, not an argument; projection sync requires a reviewer grant; the Macro Case action is internal.

`RESEARCH_OWNER_ID` is still used, deliberately, as the storage key of the scheduled public-reference pipeline (delayed market closes, collector freshness, graph counters). That is a configuration choice about where pipeline data lives, not a caller identity.

## 3. Access-control matrix (before → after)

Fixtures: Owner A and Owner B with private broker, chat, staging, run and briefing rows; Owner C with none; an anonymous caller. Scenarios run with `RESEARCH_OWNER_ID` = A (owner-fallback) and = C (global-scan fallback). Source: `tests/security-convex-data-isolation.test.ts`.

| Caller → function | Before | After |
|---|---|---|
| Anonymous → `publicOperationsOverview` (`RESEARCH_OWNER_ID`=A) | A's chat telemetry, spend, runs, staged research, briefing, broker status | Allowlisted pipeline status only; no private fields |
| Anonymous → `publicOperationsOverview` (`RESEARCH_OWNER_ID`=C) | **Other users'** broker connection and chat telemetry via unscoped scans | Allowlisted pipeline status only |
| Signed-in B → `publicOperationsOverview` | B's own overview (identity-dependent) | Identical to the anonymous response |
| Anonymous → `getChatOperationsTelemetry` | A's telemetry, or all users' rows when A had none | `Sign in required` |
| A → `getChatOperationsTelemetry` | A's rows | A's rows only |
| C (no data) → `operations:overview` / telemetry / history | Could receive others' rows when C was the research owner | Empty results |
| B → `getEvidenceBundleById` (A's bundle id) | Denied | Denied |
| Any caller passing `owner` argument | n/a | Rejected by argument validation |
| Untrusted issuer / audience / authorised party | Denied on owner functions | Denied (now also on telemetry) |
| Model or automation actor → telemetry | Allowed when anonymous fallback applied | Denied |
| Anonymous → `graph:executeReadOnlyCloudTypeQl` | **Arbitrary read-only TypeQL over the whole graph** | Requires `TYPEDB_BRIDGE_SECRET`; closed when unset |
| Anonymous → `graph:probeHostedTypeDbCloud` / `verifyHostedTypeDbCloud` | Allowed | Requires bridge secret |
| Anonymous / any caller → `executeAllowlistedCloudGraphQuery` with forged `callerId` | Allowed | Verified human identity; `callerId` argument removed |
| Signed-in non-reviewer or model → `projectPendingOutboxNow` | Allowed | Reviewer grant and human actor required |
| Anonymous → `checkGeminiProviderStatusAction` | Allowed | `Sign in required` |
| Anonymous → acceptance-nonce mutations | Consume nonce, read owner context, write audit rows | Functions removed (see 03) |

**Regression evidence:** the 14 WP1 tests were run against the original code: 8 failed, demonstrating the defects; all pass after the change. The WP4 suite: 14 of 17 failed on the original code; 17 of 17 pass now.

## 4. Sweep of all public Convex functions

Every exported `query`, `mutation` and `action` in `convex/` was listed and checked for an identity check (`researcher`, `reviewer`, `signedIn`, `humanOwner`, module-local `identity()` wrappers, or `getUserIdentity` + `verifyIdentityClaims`) and for unscoped reads. After the changes, the only function without an identity check is the intentional `publicOperationsOverview`. HTTP actions in `convex/http.ts` authenticate with constant-time bearer tokens (staging, scheduler) or the new gateway secret.

Write paths reviewed: chat audit writes (now validated, owner from token or nonce row), graph outcome and query-audit writes (now human-only), acceptance writes (removed), trading writes (WP3).

## 5. Remaining risks

| Risk | Note |
|---|---|
| Module-local `identity()` wrappers in consensus, defence, infrastructure, policy-risk, proof-scale and recovery call `signedIn`, which admits model/automation actor tokens for reads and some writes. Reviewer-gated decisions are unaffected. | Recommend switching non-review writes to `researcher()` after confirming no automated caller depends on them. |
| Owner identifiers (Clerk `tokenIdentifier` values and deployment names) appear in `docs/*.md` acceptance reports and in Git history. | Owner decision: redact in future reports; history rewriting is out of scope and was not done. |
| This is owner scoping, not commercial multi-tenancy. There is no organisation model, no per-tenant encryption and no tenant administration. | |
| Production behaviour is unverified until the post-deployment checks in 03 §7 are run. | |
