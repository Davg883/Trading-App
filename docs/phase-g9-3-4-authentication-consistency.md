# G9.3.4 — Authentication consistency and fail-closed behaviour

Status: A implemented and tested locally; B and C are reviewed designs, **not implemented**. Development only;
Production remains NO-GO.

## A. Chat history fails closed (implemented)

**Path traced.** Browser → `GET /api/graph/chat` → `resolveAuthenticatedCaller` (Clerk `auth()`, server-side claim and
expiry check) → `ConvexHttpClient(NEXT_PUBLIC_CONVEX_URL).setAuth(token).query('evidenceChat:listChatHistory')` →
Convex `researcher(ctx)` → `verifyIdentityClaims` (issuer, `aud`, `azp` against `CLERK_ALLOWED_AZP_ORIGINS`).

**Defect.** The route caught every failure of that query and returned `200 {history: []}`; it also returned `200 []`
when the Convex URL or the token was missing. In G9.3.3 a token Convex refused ("Untrusted token authorized party")
was therefore shown as a user with no history.

**Correction** (`app/api/graph/chat/route.ts`, `lib/auth/convex-error-classification.ts`):

| Outcome | Response |
| :- | :- |
| Authorised query, zero rows | 200, `history: []` |
| Authorised query, rows | 200, those rows |
| Convex refuses the token (sign-in required, untrusted issuer / audience / authorised party, unknown key, no provider) | 401 `invalid_token` |
| Convex: token expired | 401 `token_expired` |
| Convex: automated actor / ownership refusal | 403 `forbidden_identity` |
| Transport failure, timeout, Convex error, non-array result, Convex URL or token missing | 503 `history_unavailable`, `Retry-After: 30`, redacted server log |

Responses never contain Convex error text, request IDs, stack traces or tokens. POST is unchanged: it never reads
history, and its gateway paths already map 401/403 and fail closed with 503.

## B. Convex application-context policy (design for review — not implemented)

**Token inventory.**

| Token | Who obtains it | `azp` | `aud` |
| :- | :- | :- | :- |
| Clerk default session token, browser | `lib/clerk-convex-auth.ts` (`useConvexClerkAuth`) for every connected page | page origin | none |
| Clerk default session token, server route | chat, brokers, trading, remote-ops, research-import routes (`session.getToken()`) | request origin | none |
| Clerk `convex` JWT template | same callers, preferred when the instance has it | origin | `convex` |
| Clerk Backend-API session token (`POST /v1/sessions/{id}/tokens`) | no application code; only with the Clerk secret | none | none |
| Machine credentials (gateway secret, scheduler secret, staging token, admin/deploy keys) | HTTP actions, crons, worker | not Clerk JWTs | — |

`complete-bunny-8662` has no `convex` template (Clerk `resource_not_found`), so development uses default session
tokens only.

**Current enforcement.** All Clerk identities pass through `verifyIdentityClaims` (directly or via `signedIn` /
`researcher` / `reviewer` / `administrator`) in 18 modules. Every one rejects a bad issuer, a foreign `aud` and an
unauthorised `azp`. Only `convex/http.ts` (chat gateway) also passes `requireApplicationContext: true`; everywhere
else a valid-issuer token with **neither** `aud` nor `azp` is accepted. Pinned by
`tests/sprint-g9-3-4-convex-application-context.test.ts`.

**Options.**

1. *Provider configuration (`convex/auth.config.ts`).* Not suitable: `customJwt` can require `aud` (`applicationID`),
   but Clerk default tokens carry no `aud`, and Convex provider config cannot check `azp`. Requiring `aud` would reject
   every development token.
2. *Shared helper (recommended).* Make application context mandatory by default in `verifyIdentityClaims` (or in
   `signedIn`), keeping an explicit opt-out for any reviewed caller that needs one. One change covers all 18 modules.
3. *Per sensitive function.* Leaves the default open and relies on every new function remembering the flag.

**Compatibility impact of option 2.** No browser or server-route token is affected (all carry `azp`, or `aud` with the
template). Affected: Backend-API-minted tokens (none in use) and **35 test files** whose `convex-test`
`withIdentity({...})` identities carry neither claim — they would need a shared test identity with an allowed `azp`.
Migration: add the helper default plus a test-identity factory in one reviewed change, run the full suite, then a
G9.3.3-style Preview check that browser sessions still work and a server-minted token is refused by ordinary queries.

## C. Research staging authentication (proposal — not implemented)

`GET/POST /api/research/staging` is machine-to-machine: bearer `RESEARCH_STAGING_TOKEN` (≥32 chars, constant-time
comparison) bound to `RESEARCH_OWNER_ID`. Today the handler checks configuration first, so an unconfigured server
answers every caller `503 not_configured` ("Remote research staging is not configured on this server."), revealing
configuration state before checking credentials.

**Proposed order.**

1. Missing or malformed `Authorization: Bearer` header → 401 `unauthorized_staging` (no configuration detail).
2. Well-formed header, service not configured → 503 `staging_unavailable` with a generic message (no variable names).
3. Configured, token mismatch → 401 `unauthorized_staging` (unchanged constant-time comparison).
4. Configured, token matches → existing behaviour and ownership restrictions unchanged.

The Python worker does not branch on these status codes, so the reorder is compatible.

**Test plan** (unit tests with test-only stubbed values; no real credentials created, ingestion stays disabled):
not configured + no header → 401; not configured + bearer → 503 generic, no configuration names; configured + no
header / wrong scheme / short token / wrong token → 401; configured + correct token → reaches the existing staging
logic (Convex client mocked); response bodies never echo the presented token; GET and POST covered separately.
