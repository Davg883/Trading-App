# Trading 212 read-only integration acceptance

Reviewed 30 October 2026, following Benchmark 001.2. This records local implementation verification with mocked credentials and HTTP responses. It does not claim that a real Trading 212 account has been connected.

Rechecked 31 October 2026 against the repeated integration brief and the current official OpenAPI specification. All 128 TypeScript tests and 67 Python tests passed again, and the broker settings browser check passed. `/settings/brokers` responded successfully. A configuration-presence check (without printing secret values) confirmed that Clerk, Convex and the server vault settings remain absent; connection controls correctly remain disabled. Actual Demo verification is still pending those settings and a provider key pair. No duplicate integration or trading capability was added.

## Delivered

- `/settings/brokers`, reached through Connections & settings → Broker Connections · Trading 212, with Demo/Live read-only selection, new key/secret fields, secure save/replace, Test Connection, synchronization, status, verification/full-sync timestamps and local deletion.
- Owner-scoped account summary/cash, holdings and recent cash-transaction widgets. Each section retains environment, source, retrieval time and currency; missing or unauthorized history stays visible. No balances are fabricated in the disconnected interface.
- A provider-independent adapter contract with a Trading 212 implementation limited to the current official account summary, positions and cash-history GET resources. No order, modification, cancellation, transfer or withdrawal method exists.
- Server-side AES-256-GCM credential encryption bound to the authenticated owner, environment and key version. The key lives separately in server secret configuration. Convex stores only ciphertext in internal-only vault records; public owner-scoped queries return masked metadata and sanitized snapshots.
- Authenticated same-origin Node routes, bounded input/output bodies, quiet per-request clients, redirect blocking, timeouts, persistent request cooldowns, safe errors and generation-checked sync completion. Replacement or deletion invalidates stale results.
- Provider-side revocation guidance, a complete local/deployed setup guide, empty environment placeholders and regression tests. Broker data remains separate from the internal paper ledger and cannot bypass research approvals.

## Passing checks

The final TypeScript suite passed **128 tests across 16 files**. This includes all research, earnings, market-stress, Proof & Scale, security and paper-accounting tests. The unchanged Python suite passed **67 tests** during this release, giving **195 automated tests** across both runtimes.

New broker coverage consists of 19 adapter/vault tests, 9 Convex broker tests, 7 server-boundary tests and 2 UI privacy tests. The tests use mock key pairs and mocked responses only; no paid model request or real broker request was made.

| Acceptance requirement | Evidence |
| --- | --- |
| Secrets inaccessible to browser/public queries | Public query allowlisting; actual server-to-Convex runtime test sees ciphertext only; no raw credentials, encryption key or administrator key returned |
| Owner A cannot read owner B | Authenticated Convex ownership tests and server-derived canonical owner; caller-supplied owner fields rejected |
| Demo cannot silently switch to Live | Fixed environment URLs, immutable adapter environment and owner/environment-bound authenticated encryption; no automatic fallback |
| Errors do not expose credentials | Static error messages; redirect/network/provider error tests; sensitive backend exception is neither returned nor logged |
| No order endpoint can be called | Fixed operation/path allowlist; malicious operation and pagination rejection; server integration test observes only three approved Demo GETs |
| Existing approvals and risk remain intact | Full prior TypeScript regression suite; broker snapshots create no paper fills and do not mutate ledger tables |
| App works without broker configuration | Browser verifies settings navigation, disabled connection actions, empty balances, safe non-cacheable unconfigured response and separate environment selection |
| Safe disconnect | Vault/snapshot deletion tests, late-completion rejection, and server deletion test succeeds even when the encryption key is unavailable; provider revocation remains a separate explicit step |
| Account privacy on sign-out | Rendered authenticated positive control and stale-state signed-out negative control; identity changes remount account UI and clear new-entry fields |
| Safe synchronization | Lease/cooldown tests, provider rate-delay persistence, partial History handling, per-section timestamps and summary-test preservation of older holdings |

Type checking, ESLint and the production build passed. Desktop/mobile broker settings screenshots were inspected. The browser check confirmed no broker credentials or connection state in local/session storage and no page overflow at 390px. The existing dashboard, earnings, Market Stress and new Proof & Scale browser checks also passed during the combined release.

## Outstanding verification and limits

1. Configure Clerk, Convex, the separately managed encryption key/version, the server-only Convex administrator credential and the exact application origin before entering an actual provider key pair. Deploy the new internal functions to the same Convex project. These configured production services have not been tested here.
2. The real success criterion—verifying an authenticated user's actual Trading 212 Demo summary and positions—remains pending actual credentials and configured services. Automated acceptance establishes the mocked path, not the validity of a real account or entitlement.
3. Key permissions are selected at Trading 212. Create read-only keys; the application cannot inspect or reduce every permission already granted to a key. Its own adapter can only read. 401 responses cannot reliably distinguish incorrect, revoked, expired or wrong-environment keys.
4. Transaction history is a bounded recent page of up to 50 records. Additional history is marked incomplete. Large account payloads are bounded and rejected if they exceed pilot limits; this release does not silently truncate holdings.
5. One active vault encryption key/version is supported. Changing it requires planned re-encryption or reconnection. Primary-record deletion does not control the deployment's database backup retention. No provider-side revocation endpoint is invented.
6. The server-only administrator bridge uses the pinned Convex runtime's internal administrator method and has a mocked compatibility regression. Retest on upgrades. Protect server administrator credentials and do not share them with model runners.
7. No broker execution, money movement or hardware purchase was implemented or activated. This beta account API is not a licensed general market-data service.

See [local/deployed setup, rotation and revocation guide](broker-connections.md), [official API specification](https://docs.trading212.com/api), and [Proof & Scale acceptance](proof-scale-acceptance.md).

## Reproduce

```powershell
npm test
python -m unittest discover -s worker -p test_*.py
npm run typecheck
npm run lint
npm run build
# App running without Clerk/Convex keys at localhost:3000:
npm run test:browser:brokers
```
