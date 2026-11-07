# Trading 212 secure read-only connection

Open **Connections & settings → Broker Connections · Trading 212**, or `/settings/brokers`. The research application works without this connection. Demo means Trading 212's actual provider demo account; it is separate from the application's synthetic examples and internal paper ledger.

## What is implemented

The page accepts a new API key and matching secret for an explicitly selected Demo or Live environment, saves an encrypted credential pair, verifies account summary, synchronises account/holdings/recent cash transactions, and deletes local connection data. Saved credentials are never repopulated. Live has the same read-only capabilities as Demo. No order, cancellation, transfer or withdrawal interface or adapter method exists.

The adapter uses HTTP Basic authentication with the key as username and secret as password. Fixed allowlisted GET resources are:

| Resource | Demo / Live path | Use |
| --- | --- | --- |
| Account summary | `/api/v0/equity/account/summary` | Verify credentials, account currency/value and nested cash balances |
| Open positions | `/api/v0/equity/positions` | Holdings, quantity, broker prices and available account-value fields |
| Cash transaction history | `/api/v0/equity/history/transactions?limit=50` | A bounded recent page; more history is explicitly marked incomplete |

Hosts are exactly `https://demo.trading212.com` and `https://live.trading212.com`. The [official API specification](https://docs.trading212.com/api) is the source for these endpoints and authentication. There is no invented separate cash endpoint; cash is read from account summary. Permissions and account-type support must be checked against the provider's current specification. This beta account API is not a substitute for licensed real-time market data.

## Local configuration

1. Configure and deploy the existing Convex project and Clerk integration, including its `convex` JWT template/audience. Confirm login and owner isolation. No Proof & Scale reviewer role is required merely to read one's broker account.
2. Configure `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` and the Convex issuer as in the main README.
3. On the Next.js server only, set `CONVEX_BROKER_ADMIN_KEY` to a deployment administrator key for that same Convex deployment. It is used to call internal vault functions after a verified user-token lookup. Keep this key out of client environments and model/service prompts. An administrator credential has broad deployment privileges; protect access to this server runtime.
4. Set `BROKER_VAULT_KEY_B64` to a securely generated 32-byte AES key encoded as standard Base64, and `BROKER_VAULT_KEY_VERSION` to an identifier such as `v1`. The encryption key must be managed separately from stored ciphertext. It is not a Trading 212 key and is never stored in Convex.
5. Set `BROKER_APP_ORIGIN` to the exact application origin, such as `http://localhost:3000` for local use. Use the same address in the browser: `localhost` and `127.0.0.1` are different origins. Production requires an explicit HTTPS origin.
6. Start the server. Sign in on `/settings/brokers`, select Demo and paste a key/secret generated for that environment. Choose only Account, Portfolio and needed History read permissions in Trading 212. Save, then Test Connection, then Synchronise account after the displayed cooldown.

One way to generate and use a local vault key without printing it is:

```powershell
$brokerVaultKey = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:BROKER_VAULT_KEY_B64 = $brokerVaultKey
$env:BROKER_VAULT_KEY_VERSION = 'v1'
$env:BROKER_APP_ORIGIN = 'http://localhost:3000'
# Set the remaining server configuration through your secret manager, then start:
npm run dev
```

Process environment settings are lost when that shell closes. For persistent local settings use an ignored `.env.local` or a local secret manager, with appropriate file permissions. Never paste actual secrets into source files, reports, screenshots, model prompts, browser storage or chat. `.env.example` contains names and empty placeholders only.

## Deployed secret configuration

Set the server-only administrator key, vault key/version, Clerk secret and HTTPS application origin in the deployment platform's encrypted secret manager. Set the public Convex URL and Clerk publishable key separately. Deploy the new Convex tables/internal functions to the same deployment before testing the page. The Next.js Node runtime must support outbound HTTPS to Clerk, Convex and Trading 212 and a request duration of up to 60 seconds. Provider IP restrictions must allow the deployment's egress addresses if enabled.

The encrypted vault is stored in Convex and works across application instances; it does not depend on an ephemeral local disk. The encryption key remains exclusively in the Next.js server's secret configuration. The Convex administrator bridge uses the pinned Convex 1.48 runtime `setAdminAuth` capability; a mocked runtime regression verifies it. Re-test this boundary on dependency upgrades.

Keep encryption keys backed up in a separate managed vault. This release supports one active key/version and does not silently decrypt with alternate keys. To change it, disconnect/reconnect the accounts using a planned rotation or implement an authenticated re-encryption migration while the old key is available. Losing the key makes existing ciphertext unreadable; local deletion and provider revocation remain possible. Do not replace an encryption key and assume old credentials still work.

## Security and synchronization boundaries

- Next.js authenticates the Clerk session, obtains the user's Convex token, asks Convex for its canonical owner identity, and only then performs an internal administrator operation. Request bodies cannot select another owner.
- AES-256-GCM encrypts the credential pair with a random nonce and authenticated owner/environment/version data. Copying ciphertext to another owner or environment fails authentication. Ordinary Convex queries return only masked metadata and owner-scoped sanitized snapshots. No public vault query or credential mutation exists.
- Credentials pass through the new-entry form and same-origin server request only. Form values clear after saving or attempting to save, when changing environment, and when identity changes. No local/session storage, browser demo state, client environment variable or source file stores them. The saved secret is never returned.
- Mutating routes require same-origin JSON, bounded bodies and a signed session. Sensitive responses use `private, no-store` headers. Quiet per-request Convex clients and static errors avoid logging authentication headers, credential bodies, raw provider responses or internal exception messages.
- Provider calls have a ten-second timeout, fixed GET-only destinations, no redirects and no automatic retries. A persistent lease prevents overlapping account checks; a conservative 60-second application cooldown survives failures and key replacement. Provider rate-limit retry times can extend it. Manual retries occur only after the displayed time. Limits are per provider account, so sharing one broker account across multiple keys/applications may still cause provider-side limits.
- Test Connection updates the account-verification timestamp. Full portfolio synchronization has its own timestamp. A later summary-only test preserves older holdings/history with their original individual retrieval times. Missing History permission yields a visible partial result; failed account or positions requests do not fabricate data.
- Snapshots retain provider, exact API source, retrieval time, currency and Demo/Live environment. They never enter the authoritative internal paper ledger automatically. Financial forecasts and Proof & Scale gates cannot invoke this adapter to trade.

## Disconnect and revoke

**Delete local connection** removes the active encrypted pair, connection metadata and saved snapshots. Credential replacement/deletion invalidates in-flight results so a late response cannot recreate the connection or publish an old generation's holdings. Database backup retention is a separate deployment responsibility.

Local deletion does **not** revoke the provider key. In Trading 212, open **Settings → API (Beta) → the relevant key card → Delete**. The [official key-management guide](https://helpcentre.trading212.com/hc/en-us/articles/14584770928157-Trading-212-API-key) describes provider-side deletion. This integration does not invent an API revocation endpoint or execute provider-side deletion.

401 errors can mean incorrect, revoked or expired credentials, or the wrong environment; the API does not reliably distinguish those causes. 403 indicates missing permission. Rate limits and unavailable resources have separate safe messages. Do not weaken permissions or add order access to resolve a read-only integration error.

## Validation status

Automated tests use mock credentials and mocked HTTP responses only. They cover encryption/tampering, owner/environment separation, redirects, destination allowlisting, error redaction, cooldowns, stale writes, public-query confidentiality, the actual server-administrator bridge, and the existing paper approvals/risk gate. No real Trading 212 account has been connected or verified in acceptance. The success criterion can be exercised with actual Demo credentials after the required services and secrets are configured. See [acceptance report](broker-acceptance.md).
