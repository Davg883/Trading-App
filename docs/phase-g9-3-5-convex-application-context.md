# G9.3.5 — Convex application-context enforcement

Status: implemented and verified locally; **not deployed**. Development only; Production remains NO-GO.

## Change

`convex/authz.ts` `verifyIdentityClaims` now requires application context for every Clerk identity:

| Token claims | Before | After |
| :- | :- | :- |
| allowed `azp`, no `aud` (Clerk default browser/server-route session token) | accepted | accepted |
| `aud: "convex"`, no `azp` (Clerk `convex` JWT template) | accepted | accepted |
| allowed `azp` + `aud: "convex"` | accepted | accepted |
| untrusted `azp` (any `aud`) | rejected | rejected |
| untrusted `aud` (any `azp`) | rejected | rejected |
| untrusted issuer | rejected | rejected |
| **neither `azp` nor `aud`** (Clerk Backend-API / secret-minted token) | **accepted** everywhere except the chat HTTP gateway | **rejected everywhere**: `Missing token application context` |

The `requireApplicationContext` option is removed (the chat gateway in `convex/http.ts` no longer needs it). There is no
opt-out: the audit below found no legitimate caller that needs one, and adding an exception requires review.
Issuer, audience, authorised-origin, actor-type and owner-isolation checks are unchanged.

## Compatibility audit

**Shared validation inventory (18 modules).** `convex/authz.ts` plus 17 importers — brokers, consensus, defence,
earnings, evidenceChat, graph, http, infrastructure, operations, policyRisk, portfolio, proofScale, recovery, research,
roles, stress, trading — which use `signedIn` / `researcher` / `reviewer` / `administrator` or `verifyIdentityClaims`. Every raw `ctx.auth.getUserIdentity()` outside `authz.ts` (evidenceChat
×2, graph ×2, http ×1) is passed straight to `verifyIdentityClaims`.

**Authentication patterns found.**

| Pattern | Credential | Claims | Affected |
| :- | :- | :- | :- |
| Browser (`lib/clerk-convex-auth.ts`, every connected page) | Clerk session token, `convex` template preferred | `azp` = page origin (or `aud: convex`) | no |
| Next.js server routes (chat, brokers, trading, remote-ops, research import) | `session.getToken({template:'convex'}) ?? session.getToken()` | same | no |
| Server privileged paths (`lib/brokers`, `lib/trading`, `lib/remote-ops`, `lib/research-import-server`, `scripts/verify-cloud-operations.mjs`) | Convex admin/deploy key via `setAdminAuth`, internal functions only | no Clerk identity | no |
| HTTP actions (staging, scheduler, chat gateway) | shared secrets / staging bearer | gateway also checks the user JWT | gateway: only tokens without context, now refused consistently |
| Python worker | staging bearer to `/api/research/staging`; anonymous `graph:verifyHostedTypeDbCloud` (bridge key) | none | no |
| Graph bridge actions (`probeHostedTypeDbCloud`, `executeReadOnlyCloudTypeQl`, `verifyHostedTypeDbCloud`) | bridge key | none | no |
| `npx convex run --identity` / acting-as admin auth | — | — | none found in the repository |

**Conclusion:** no authorised workflow sends a Clerk identity without `azp` or `aud`. The only tokens refused by the
change are ones minted outside the application (as in the G9.3.3 Preview finding).

**Operator note:** Convex dashboard “Act as a user” identities must now include `azp` (an allowed origin) or
`aud: "convex"`; a bare subject/issuer identity is refused like any other context-less token.

## Affected functions

Every public function that authenticates a Clerk identity: 79 of the 83 public queries and mutations across the 21
function modules now refuse a context-less token (sweep in `tests/sprint-g9-3-5-convex-application-context.test.ts`),
plus the actions `evidenceChat:askEvidenceLockedQuestion`, `evidenceChat:checkGeminiProviderStatusAction`,
`graph:projectPendingOutboxNow`, `graph:executeAllowlistedCloudGraphQuery`, and the chat HTTP gateway. Unaffected:
`operations:publicOperationsOverview` and `release:fingerprint` (public; identical result to an anonymous caller),
`trading:recordOptIn` / `trading:setLiveKillSwitch` (refused for every caller by the research-only boundary), internal
functions, crons and bridge-key actions.

## Tests

- `tests/helpers/app-identity.ts`: `APP_SESSION` (`azp` = `http://localhost:3000`, in the default allowlist) and
  `CONVEX_TEMPLATE_SESSION` (`aud: convex`). The 35 convex-test suites now spread `APP_SESSION` into each of their
  102 identities explicitly; tests that set their own untrusted `azp`/`aud` still override it. Production validation
  was not relaxed to fit them.
- `tests/sprint-g9-3-5-convex-application-context.test.ts` (20 tests): claim matrix; owner-scoped functions with
  browser and template identities; cross-user isolation; reviewer grant unusable without context; sweep of every
  public query and mutation (a context-less token never receives more than an anonymous caller); chat gateway with
  missing context, expired and invalid-issuer bearer tokens.
- `tests/sprint-g9-3-4-convex-application-context.test.ts`: known gap flipped to rejection; option removed.

## Backend fingerprint

`convex/deploymentFingerprint.ts` changes from `2231bc06…` to `923d0c40…` (89 files, 4 packages). Until the dev
backend is redeployed, `npm run release:check` reports RELEASE GATE FAIL and a frontend built from this commit
reports INCOMPATIBLE, so the Convex deployment must precede the Preview push.
