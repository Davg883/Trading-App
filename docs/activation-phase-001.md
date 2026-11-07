# Activation Phase 001 — acceptance (6 November 2026)

Environment: Clerk development instance "Trading App" and Convex dev deployment `prestigious-dragon-8`. Nothing was migrated to production and no order execution was enabled. No secret values appear in this report.

## A. Reviewer bootstrap

| Item | Result |
| --- | --- |
| Path | Deployment-owner CLI only: internal `roles:grantRoleInternal` (not callable from the app) |
| Grantee | `https://harmless-akita-9211.clerk.accounts.dev\|user_3LjSsuJX398YIJRdss5Q7PqsSH9`. This is the same identity that owns the imported v2 case; `roles:myRoles` for it returns `roles: ['reviewer']` |
| Grant | `r972b350jhvnep1874e4hks8dh8hqbxb`, via `deployment_admin`, operator `david.grannum`, reason recorded, audit row `role.reviewer.granted` |
| Expiry | **2027-02-04 12:56 UTC** (90 days; the limit is 12 months) |

Live behaviour on the dev deployment, checked with a labelled verification identity (`dev-verification|activation-check`) and a 60-second grant, so no records were created under the owner's account:

| Check | Result |
| --- | --- |
| Approval without a grant | Refused: "Reviewer role required" |
| Approval with a grant | Accepted |
| Rejection with a grant | Accepted. Executing the rejected proposal is refused ("Human approval required") |
| Approved proposal without a post-approval quote | Execution refused ("A post-approval quote is required"). The `fills` table remained empty, so approval does not bypass the independent risk path |
| After the grant expired | Approval refused ("Reviewer role required") |

## B. Broker vault configuration

- **Set up by the owner** with `node scripts/configure-broker-vault.mjs prestigious-dragon-8`. The script:
  - created Convex deploy key `trading-app-broker-readonly-2026-11-06` through the CLI's own deploy-key command;
  - generated an independent 32-byte random AES-256-GCM key (standard Base64);
  - wrote `CONVEX_BROKER_ADMIN_KEY`, `BROKER_VAULT_KEY_B64`, `BROKER_VAULT_KEY_VERSION=v1` and `BROKER_APP_ORIGIN=http://localhost:3000` to the gitignored `.env.local` without printing any value.
- **Rotation safety:** a second run refused to replace the existing vault key, as designed. (Claude's own attempts to create this key were blocked by the session permission check.)
- **Verified without revealing values:** the key decodes to 32 bytes; the admin key, version and origin are present. After a restart, `/settings/brokers` no longer reports "not configured", and signed-out API calls return `sign_in_required`.
- **Decryption after restart: verified.** After a dev-server restart, the owner's Test Connection on Live succeeded at 2026-11-06 13:29:27 UTC against the account summary endpoint, so the stored ciphertext decrypts with the configured key.

## C. Trading 212 connection

| Connection | Result |
| --- | --- |
| Demo | Credentials saved; the provider rejected them (`invalid_credentials`). The key supplied is a **Live** key, so Demo is not yet tested |
| Live (read-only) | Key `••••FVft` saved, tested and synchronised at 2026-11-06 13:06 UTC |

**Genuine provider responses** (Live, GBP):

- **Account summary:** total value £250.00; cash available £250.00; reserved £0; in pies £0; investments £0, cost £0, P/L £0.
- **Positions:** none.
- **Transaction history:** 1 item, a DEPOSIT of £250.00 on 2026-10-30T19:34:48Z. Not truncated; no further cursor.

**Capabilities:** the adapter has one HTTP method, `GET`, against three fixed resources (`equity/account/summary`, `equity/positions`, `equity/history/transactions`). There is no order, cancellation, withdrawal or transfer method, route or Convex function. The broker Convex functions are three public, read-only, owner-scoped queries (`list`, `viewer`, `detail`); every vault and sync operation is internal.

**Delete and revoke:** not yet exercised. Deletion is on `/settings/brokers` ("Delete local connection"); revocation is done in Trading 212's API settings and is separate.

## D. Credential exposure checks

| Surface | Result |
| --- | --- |
| Public Convex query (`brokers:list` as owner) | Fields: `connectionId`, `createdAt`, `environment`, `lastAttemptAt`, `lastErrorCode`, `lastSuccessfulSyncAt`, `lastVerifiedAt`, `maskedKey`, `nextAllowedAt`, `provider`, `readOnly`, `status`, `updatedAt`. **No ciphertext, lease token or key material.** Unauthenticated: "Sign in required" |
| Stored data | Ciphertext only in `brokerCredentials.encryptedPayload` (internal-only access). The masked key keeps only its last 4 characters |
| Browser storage | No `localStorage` or `sessionStorage` use in broker code. The browser check confirms no broker or credential keys are stored |
| Application logs | The dev-server log shows request paths and status codes only; no keys, secrets or authorization headers |
| Source control | `.env.local` matches the `.env*` ignore rule. The folder is not a git repository; nothing was committed |
| This report | No secret values |

## Regressions

- **TypeScript:** 353/353 pass.
- **Python:** all pass.
- **Typecheck:** clean.
- **Browser checks:**
  - recovery and policy-risk pass;
  - brokers passes after the script was updated to handle the configured, signed-out state as well as the unconfigured state;
  - every safety assertion is kept: fail-closed and no-store API responses, a refused signed-out sync, no browser storage and empty password fields.
- **Lint:** one pre-existing error in `components/recovery-monitor.tsx` (a `Date.now()` call inside a click handler, flagged as impure render). It is unrelated to this phase.

## Remaining blockers

2. **Demo coverage:** a Trading 212 demo-account API key is needed; the current key is Live.
3. **Delete and revoke:** delete the failed Demo connection locally to exercise deletion. Decide whether to keep or revoke the Live key at Trading 212.
4. Production instances, licensed market and FX data, and model providers are unchanged and out of scope.
