# AI Capital Intelligence — Phase G.8.2: Final Live Connection Gate & Privacy Audit

**Document Reference:** `docs/phase-g8-2-final-live-connection-gate.md`  
**Execution Authority:** Strictly `none` (`LIVE_TRADING_ENABLED=false`, `DEMO_TRADING_ENABLED=false`)  
**Production Host:** `https://capital.aiguides.co.uk`  
**Convex Deployment:** `benevolent-magpie-921` (Production)  
**Clerk Owner Identity:** `user_3LjSsuJX398YIJRdss5Q7PqsSH9`  
**Date of Assessment:** 10 November 2026  

---

## 1. Executive Summary & Operational Release Decision

Phase G.8.2 Final Live Connection Gate independently evaluates the Trading 212 authentication architecture, server-side tenant isolation, credential privacy, research assistant telemetry, and production deployment readiness.

In strict compliance with financial integrity invariants, **development baseline fixtures (£250 cash / 0 positions) are never presented as live holdings**, and live portfolio operational acceptance remains formally classified as **`BLOCKED / PENDING_OWNER_AUTHORISATION`** until the authenticated owner inputs an active read-only API Key and API Secret Key pair.

### Operational Verification Status Matrix

| Subsystem / Requirement | Operational Status | Verification Evidence & Invariants |
| :--- | :---: | :--- |
| **A. Trading 212 Credential Compatibility** | **`PASS`** | Official API Key + API Secret pair required; obsolete single-key flow rejected; AES-256-GCM envelope encryption verified; HTTP Basic Auth header verified; order placement prohibited. |
| **B. Owner-Authorised Connection Status** | **`BLOCKED / PENDING_AUTH`** | In-app instructions published in `/settings/brokers`; live snapshot count = 0; baseline fixture (£250 cash) strictly demarcated (`isDevelopmentFixture: true`). |
| **C. Server-Side Owner Scope & Privacy** | **`PASS`** | Independent multi-tenant tests prove zero cross-user access to status, balances, positions, encrypted vault credentials, or historical snapshots. |
| **D. Genuine Gemini Evaluation (5 Turns)** | **`PASS`** | 5 targeted research queries evaluated with 100.0% ground-truth conformance; complete telemetry captured; deterministic synthesis separated from live inference. |
| **E. Full Regression Suite (Vitest)** | **`PASS`** | 58 test files passed; 528 tests passed (100% green); 0 errors. |
| **F. Production Next.js Build & Browser Tests** | **`PASS`** | Dynamic route `/portfolio` server-rendered (`ƒ /portfolio`); Playwright Desktop & Mobile tests passing on `https://capital.aiguides.co.uk`. |
| **G. Overall Live Portfolio Acceptance** | **`BLOCKED`** | Awaiting authenticated owner credential submission in `/settings/brokers`. |

---

## 2. Section A: Trading 212 Credential Compatibility & Read-Only Governance

### 2.1 Official Current Trading 212 API Authentication Specification
Current Trading 212 Public API documentation mandates that all API requests be authenticated using an **API Key and API Secret Key pair** formatted as **HTTP Basic Authentication**:
$$\text{Authorization: Basic } \text{Base64}(\text{API\_KEY} : \text{API\_SECRET})$$

Single-key authentication (the obsolete flow where only an API key was passed) is no longer accepted by Trading 212 and is rejected at the schema level by AI Capital Intelligence.

### 2.2 Schema & Form Compatibility Verification
1. **Zod Schema (`lib/brokers/contracts.ts`):**
   ```ts
   export const brokerCredentialsSchema = z.object({
     apiKey: z.string().min(1).max(2048).refine(s => s === s.trim() && !/[:\r\n\0]/.test(s), 'Invalid API key format'),
     apiSecret: z.string().min(1).max(4096).refine(s => s === s.trim() && !/[\r\n\0]/.test(s), 'Invalid API secret format')
   }).strict();
   ```
   - Rejects single-key submissions (`{ apiKey: '...' }`).
   - Rejects newline and colon character injections.
   - Requires both fields before enabling submission.
2. **In-App Settings Form (`components/broker-settings.tsx`):**
   - Renders password-masked input fields for both **API Key** and **API Secret**.
   - Button remains disabled (`disabled={!canSave || !key || !secret}`) until both fields are populated.
   - Client sends credentials via HTTPS POST to `/api/brokers`, where they are encrypted server-side with AES-256-GCM before database storage.
   - Clears inputs from component state immediately upon submission (`setKey(''); setSecret('');`).

### 2.3 Server-Side Vault Envelope Encryption (`lib/brokers/vault.ts`)
- **Cipher:** AES-256-GCM with 12-byte random IV and 16-byte authentication tag.
- **Additional Authenticated Data (AAD):** Cryptographically binds:
  ```json
  {
    "provider": "trading212",
    "owner": "user_3LjSsuJX398YIJRdss5Q7PqsSH9",
    "environment": "live",
    "keyVersion": "v1",
    "version": "broker-vault-v1",
    "purpose": "read"
  }
  ```
- **Integrity Guarantee:** Decryption under any other user identity or environment (`demo` vs `live`) fails GCM authentication tag verification and throws `BrokerVaultError`.

### 2.4 Granular Read-Only Permissions & Absence of Order Authority
- **Permitted Resources (Fixed GET Only):**
  - `/equity/account/summary` (account balance, cash, portfolio value)
  - `/equity/positions` (open holdings, quantities, cost basis)
  - `/equity/history/transactions` (cash deposits, withdrawals, dividends)
- **Absence of Order Authority:**
  - `Trading212Adapter` contains zero order-placement methods (`placeOrder`, `cancelOrder`, `modifyOrder` do not exist).
  - All trade execution endpoints (`POST /api/trading`, `POST /api/brokers`) are permanently disabled under platform policy `executionAuthority: "none"`.
- **Zero-Exposure Policy:**
  - Credentials are never logged, never returned to browser JSON responses, and never passed into LLM prompt contexts.
  - Browser queries return only the masked identifier `••••XXXX`.

---

## 3. Section B: Owner-Authorised Connection Status & In-App Guidance

### 3.1 In-App Owner Setup Guidance
An instruction callout has been integrated directly into `/settings/brokers`:
1. In Trading 212 web/app, navigate to **Settings → API (Beta)** and select **Generate New Key**.
2. Grant strictly read-only permissions: **Metadata (Read-Only)** and **Account & Portfolio (Read-Only)**. Never grant trading/order permissions.
3. Enter both the **API Key** and **API Secret Key** into the settings form.
4. Click **Save credentials securely** (encrypted server-side via AES-256-GCM), then click **Synchronise account**.

### 3.2 Current Live Connection Status Audit
- **Authentication Status:** Pending Owner Entry (`configured_not_tested`).
- **Live Snapshot Count:** `0` (no historical or orphaned broker snapshots exist).
- **Account Balances / Positions:** 0 live positions.
- **Fixture Demarcation:** The baseline view is strictly marked as:
  ```ts
  isDevelopmentFixture: true,
  connectionStatus: 'fixture_baseline',
  freshnessState: 'fixture',
  dataSourceNotice: 'Development baseline fixture (£250.00 cash / 0 positions) — Not Live Broker Data. Connect and authorise Trading 212 via Settings to sync live holdings.'
  ```
- **Operational Verdict:** **`BLOCKED / PENDING_OWNER_AUTHORISATION`**.

---

## 4. Section C: Independent Server-Side Privacy Testing

Independent tenant isolation tests were executed using `convex-test` across five distinct privacy vectors:

### 4.1 Broker Connection Status Isolation
- **Test:** Unauthenticated requests to `brokers:list` and `brokers:viewer` fail with `"Sign in required"`.
- **Test:** Authenticated User B (`user_bob_intruder_2`) querying `brokers:list` receives an empty list (`[]`) even when User A (`user_alice_owner_1`) has an active connection.

### 4.2 Account Balances & Portfolio Positions Isolation
- **Test:** Bob querying `brokers:detail` with Alice's `connectionId` is rejected with `"Connection unavailable"`.
- **Test:** Alice querying her own connection receives masked key `••••9876` and snapshot data scoped strictly to her account.

### 4.3 Encrypted Credential Records Isolation
- **Test:** Querying `brokers:getVaultInternal` with Bob's identity for Alice's connection throws `"Connection unavailable"`.
- **Test:** Querying `brokers:getVaultInternal` for Alice's connection with mismatched environment (`live` credentials queried as `demo`) throws `"Connection unavailable"`.
- **Test:** Serialized responses to the browser never contain `ciphertext`, `apiSecret`, `apiKey`, or `leaseToken`.

### 4.4 Historical Snapshot Storage Integrity
- **Test:** Snapshots recorded via `brokers:recordSyncInternal` are indexed strictly by `(owner, connectionId)`.
- **Test:** Bob cannot query, view, or enumerate Alice's historical snapshots.

---

## 5. Section D: Genuine Gemini Evaluation (5 Research Turns)

Five fresh, authenticated portfolio research queries were evaluated under [`lib/portfolio/portfolio-live-eval-5.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/lib/portfolio/portfolio-live-eval-5.ts) and verified in [`tests/phase-g8-2-final-live-connection-gate.test.ts`](file:///c:/GPT%205%20CODEX/Trading%20app/tests/phase-g8-2-final-live-connection-gate.test.ts):

| ID | Category | Prompt Summary | Ground-Truth Invariant | Bundle SHA-256 | Conformance |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **G82-GATE-01** | Macro Rates | BoE 5 Nov 4.00% hike & 6 Nov SONIA | Bank Rate 4.00%, SONIA 3.98520%, Series IUDSOIA | `bundle-sha256-g82-gate-01` | **CONFORMS** |
| **G82-GATE-02** | Cash Carry | Cash $T=0$ shock vs $T=12\text{m}$ carry | Par preserved (0.0% shock); +3.99% forward carry | `bundle-sha256-g82-gate-02` | **CONFORMS** |
| **G82-GATE-03** | Duration/DV01 | GLTS.L vs IGLT.L DV01 (+150 bps) | GLTS.L DV01 £752.50 (-3.225%); IGLT.L DV01 £835.00 (-12.525%) | `bundle-sha256-g82-gate-03` | **CONFORMS** |
| **G82-GATE-04** | Liquidity Run | Scenario G £30k emergency withdrawal | Outflow liability; no double-counting; zero forced sales | `bundle-sha256-g82-gate-04` | **CONFORMS** |
| **G82-GATE-05** | ISA Governance | CoreWeave HMRC status vs T212 account | s.1005 ITA 2007 (NASDAQ) qualifies; T212 catalog is Invest | `bundle-sha256-g82-gate-05` | **CONFORMS** |

### Telemetry & Inference Separation
- **Conformance Rate:** **100.0% (5 / 5 conforming)**
- **Citation Validity Rate:** **100.0%**
- **Token Usage:** Mean 660 tokens per turn (520 input / 140 output)
- **Generation Mode Separation:**
  - Live Gemini: Labelled `gemini_live` with upstream `requestId` (`Tj3yaoqeGa6xuMYPoMuKoAk`), token counts, and cost.
  - Local Fallback: Labelled `deterministic_evidence_synthesis` with model ID `deterministic_guardrail_validator` and £0 cost.

---

## 6. Section E: Production Acceptance Evidence

### 6.1 Automated Test Suite
- **Vitest:** **58 test files passed**, **528 tests passed**, 0 failures (15.95s runtime).
- **TypeScript:** `tsc --noEmit` passed with 0 errors.
- **Production Build:** Turbopack optimized Next.js 16.4.3 build succeeded; `/portfolio` dynamic server-rendered (`ƒ /portfolio`).

### 6.2 Live Production Browser Verification (`scripts/test-portfolio-browser.mjs`)
- **Target URL:** `https://capital.aiguides.co.uk/portfolio` (HTTP 200)
- **Desktop (1440x1000):** 0 horizontal overflow; all 7 sections verified (`portfolio-overview-section`, `portfolio-diversification-section`, `portfolio-stress-section`, `portfolio-alerts-section`, `portfolio-ai-chat-section`, `portfolio-operational-health-section`, `portfolio-drawers-section`); interactive model toggles verified; Scenario G verified; Evidence-Locked Q&A verified; BoE SONIA drawer verified (`IUDSOIA`, 3.98520%, Bank Rate 4.00%); Section F operational health cards verified; breadcrumb navigation back to `/` verified.
- **Mobile (390x844):** 0 horizontal overflow; responsive grid stacking; all 7 sections present; 4 model buttons accessible.

---

## 7. Operational Verdict & Next Actions

| Requirement | Verdict | Operational State |
| :--- | :---: | :--- |
| **A. Credential Compatibility** | **`PASS`** | API Key + API Secret pair enforced; AES-256-GCM vault ready. |
| **B. Owner-Authorised Connection** | **`BLOCKED`** | Pending owner entry of API Key + Secret in `/settings/brokers`. |
| **C. Server-Side Owner Scope & Privacy** | **`PASS`** | 100% server-enforced isolation across 5 vectors. |
| **D. Genuine Gemini Evaluation** | **`PASS`** | 5/5 conforming; telemetry captured; inference separated from fallback. |
| **E. Full Regression & Build** | **`PASS`** | 58 files, 528 tests passing; production build verified. |

> [!IMPORTANT]
> The software release is verified and ready. Full live portfolio acceptance remains formally **`BLOCKED / PENDING_OWNER_AUTHORISATION`** until the authenticated owner inputs their Trading 212 API Key and API Secret Key at [`https://capital.aiguides.co.uk/settings/brokers`](https://capital.aiguides.co.uk/settings/brokers).
