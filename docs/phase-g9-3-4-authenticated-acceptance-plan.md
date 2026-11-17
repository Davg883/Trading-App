# G9.3.4 — Authenticated acceptance plan (prepared, not executed)

Target: Vercel Preview of `1aa1de1` on `verify/combined-release-candidate`, Clerk `complete-bunny-8662`, Convex dev
`prestigious-dragon-8`. Production remains NO-GO. Requires separate approval before any step that creates accounts.

## Identities

Two temporary Clerk development users, created through the Backend API exactly as in G9.3.3 (no passwords, external IDs
`aci-g934-acceptance-a` / `-b`, deleted at the end). The Clerk secret is streamed from `vercel env pull` into memory
only; sign-in tickets and session tokens are single-use, sealed to a non-extractable page key, and never printed,
logged, screenshotted, committed or written to evidence. No old-owner tokens are used.

## Cases

| # | Caller | Origin | Request | Expected |
| :- | :- | :- | :- | :- |
| A1 | User A, browser session | branch alias `…-864cea-…` (allowlisted) | `GET /api/graph/chat` | 200, `history: []`, `executionAuthority: none` |
| A2 | User B, browser session | branch alias | `GET /api/graph/chat` | 200, `history: []` (no rows from A or the owner) |
| A3 | User A, browser session | per-deployment URL `trading-<hash>-…` (not allowlisted) | `GET /api/graph/chat` | **401 `invalid_token`** (was 200 `[]` before G9.3.4); body has no Convex text, request ID or token |
| A4 | User A, session expired by waiting past `exp` without refresh | branch alias | `GET` with stale Bearer | 401 `token_expired` |
| A5 | User A after sign-out | branch alias | `GET` / `POST` | 401 |
| A6 | Signed out | both origins | `GET` / `POST` | 401 |
| A7 | User A | branch alias | `POST` invalid payload | 400; no history query |

A1–A7 read only. No chat question is submitted (no acceptance nonce minted, no research records created).

## Dependency-failure cases (503)

Not run against the shared development backend: making `prestigious-dragon-8` unreachable would affect every
developer. Covered instead by controlled test doubles in `tests/sprint-g9-3-4-chat-history-fail-closed.test.ts`
(network failure, timeout, Convex 5xx, non-array result, missing Convex URL, missing token → 503
`history_unavailable`, `Retry-After: 30`, redacted log). Optional local check if wanted: run the release-candidate
build locally with `NEXT_PUBLIC_CONVEX_URL` pointed at an unroutable test host (e.g. `https://unreachable.invalid`)
for that process only, signed in as test user A, and confirm 503 — no shared environment variables change.

## Evidence and cleanup

Record status codes, response `code` fields, the per-deployment URL and the Vercel runtime-log excerpt (filtered to
`/api/graph/chat`, tokens redacted) in `docs/evidence/g9-3-4-authenticated-acceptance.json`. Delete both users through
the Clerk Backend API, confirm 404 on lookup, and confirm by Convex dashboard count that no rows exist for either
subject. Database impact expected: none.
