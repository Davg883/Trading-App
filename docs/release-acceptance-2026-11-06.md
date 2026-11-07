# Next release acceptance — 6 November 2026

Scope: Case 006 v2 follow-on release. All earlier implementation, evidence records and source packages are preserved; v1 and v2 remain separate. Nothing was migrated to production and no brokerage execution was added. Environment: Clerk development instance "Trading App" (`harmless-akita-9211`) and Convex dev deployment `prestigious-dragon-8`.

## Priority 1 — Explicit reviewer authority (done, deployed to dev)

**Model** (`convex/authz.ts`, `convex/roles.ts`, table `roleGrants`):

| Role | How it is obtained | What it allows |
| --- | --- | --- |
| Researcher | Implicit for any signed-in, non-model identity | Create and register research on records the caller owns |
| Reviewer | Explicit grant stored server-side; must expire within one year; revocable | Every consequential approval or rejection: paper proposals (`research:review`), Case 006 experiments, consensus recommendations, defence allocations, Proof & Scale gate reviews, expansion and rollback decisions |
| Administrator | Bootstrap only, through internal `roles:grantRoleInternal` (deploy key or CLI) | Assign and revoke reviewer roles for **other** identities. It confers no approval power and cannot change its own roles |

- **Signing in confers no review authority.** The earlier self-asserted `actorType: 'human'` claim is no longer authority. Clerk never issued that claim, so no one could review before. Declared model or automation actors are still refused even when their token identifier holds a grant.
- **Audit:** every grant and revocation writes an `audit` row (`role.reviewer.granted` / `.revoked`) recording the operator, the route (`deployment_admin` or `administrator`), the expiry and the reason. Grant rows are revoked, never deleted.
- **Separation:** reviewer authority never bypasses ownership (`Record unavailable` across owners). Paper execution still requires approval *and* a post-approval quote *and* the deterministic risk gate, all unchanged.
- **Deployed:** the dev deployment exposes `roles:grantRoleInternal` and `roles:revokeRoleInternal` as **internal** only. `assignReviewer`, `revokeReviewer` and `myRoles` are public and server-checked.

**Project owner reviewer assignment — done 6 Nov 2026.** Grant `r972b350jhvnep1874e4hks8dh8hqbxb`: reviewer for `…|user_3LjSsuJX398YIJRdss5Q7PqsSH9`, via `deployment_admin` by operator `david.grannum`, expiring 2027-02-04T12:56:24Z, with audit row `role.reviewer.granted`. The command used:

```bash
npx convex run roles:grantRoleInternal '{"subject":"https://harmless-akita-9211.clerk.accounts.dev|user_3LjSsuJX398YIJRdss5Q7PqsSH9","role":"reviewer","reason":"Project owner reviewer assignment","expiresAt":<epoch-ms within 1 year>,"operator":"david.grannum"}'
```

**Role and permission tests** (`tests/roles-convex.test.ts`, 10 tests; plus 66 updated tests in the existing review suites):

| Case | Result |
| --- | --- |
| Signed-in user without a grant approves or rejects | Refused: "Reviewer role required" |
| Unauthenticated or expired session (Convex rejects expired JWTs before the handler runs, so no identity reaches it) | Refused: "Sign in required" (roles, review, assignment) |
| Deployment-admin bootstrap of the owner as reviewer | Allowed; audit row; duplicate active grant refused |
| Grant without a reason, in the past, longer than one year, or after expiry | Refused / no longer honoured |
| Revocation | Authority removed; grant row and audit history retained |
| Non-admin assigns a reviewer; admin assigns itself; admin approves | All refused. Admin can assign and revoke others |
| Reviewer acts on another owner's proposal | Refused: "Record unavailable" |
| Model actor using a granted token identifier | Refused |
| Rejected approval | Terminal; re-review refused; execution refused ("Human approval required") |
| Approved proposal without a post-approval quote | Execution refused; no fills created (independent risk path) |

Full suite: **353 TypeScript tests and all Python tests pass.** The suites now run with the dev server bound to `localhost`, after the Clerk redirect-loop fix.

## Priority 2 — Real data activation (blocked)

No licensed price, adjustment or FX provider key or licence is configured (`.env.local` holds only Clerk, Convex and import keys). **Live-provider coverage: none. Licences: none.** Reconstructed observations stay in separately versioned retrospective packages (pinned in `lib/research-packages.ts`). Forward-collected data will be a separate source type and must never be merged into them. Required from you:

- a provider choice and licence covering this use, with adjusted daily bars, corporate actions and receipt times;
- a GBP/USD source aligned to the 21:00 UTC US close;
- your broker's cost schedule.

## Priority 3 — Forward experiment (blocked)

No model provider keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) or pinned model IDs are configured, and there is no licensed price feed to score against.

- **Forward-registered observations:** 0.
- **Model versions:** none.
- **Billed model or provider cost:** £0.

The existing engines already include neutral, deterministic-rules and passive-benchmark baselines, and score only completed windows.

## Priority 4 — £500 manual investment tracking (code present; activation needs your keys)

- **Adapter:** `lib/brokers/trading212.ts` issues **GET requests only**, to `equity/account/summary`, `equity/positions` and `equity/history/transactions`. There is no order, cancellation, withdrawal or transfer endpoint.
- **Credentials:** encrypted with AES-GCM in a server-side vault. Sync is triggered by the authenticated owner on `/settings/brokers`.
- **Ledger:** existing tests confirm the paper ledger is independent of broker records.

Activation needs three server-only values in `.env.local`:

- `CONVEX_BROKER_ADMIN_KEY`: a deploy key for `prestigious-dragon-8`;
- `BROKER_VAULT_KEY_B64`: 32 random bytes, base64-encoded;
- `BROKER_APP_ORIGIN=http://localhost:3000`.

Generating that credential from this session was **blocked by the permission check**, so it is your step:

```bash
npx convex deployment token create trading-app-broker-readonly --deployment prestigious-dragon-8
```

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Then restart the dev server, open `/settings/brokers` and enter your Trading 212 API key, ideally a read-only key.

**Portfolio measurement methodology (when activated):**

- Broker snapshots are observations with provider receipt times, stored separately from the research ledger and from the three £500 research experiments.
- Actual holdings and transactions are never written into the paper ledger.
- Returns on manually executed purchases are measured from imported fills and fees in GBP, separately from the hypothetical research windows.

## Remaining production requirements

1. A Clerk production instance on an owned domain, with production keys.
2. `npx convex deploy` to a production deployment, setting `CLERK_JWT_ISSUER_DOMAIN` there.
3. A production administrator bootstrap and reviewer assignment.
4. HTTPS `BROKER_APP_ORIGIN` / `RESEARCH_APP_ORIGIN`.
5. Licensed data contracts and model-provider billing accounts.
6. Cleanup of the unused `ai-capital-intelligence` Convex project.
