# AI Capital Intelligence — Production Connection Recovery & Workspace Status Audit

**Date:** 8 November 2026 (`2026-11-08T17:49:35Z`)  
**Target Production Deployment:** `https://capital.aiguides.co.uk` (Vercel Project `trading-app` / `prj_IY8KVnNw4HL9uHbn1EEQRMU02UOF`)  
**Convex Production Deployment:** `benevolent-magpie-921` (`https://benevolent-magpie-921.eu-west-1.convex.cloud`)  
**TypeDB Cloud Cluster:** `https://teoxx0-0.cluster.typedb.com:80` (TypeDB `3.14.2`, TLS enabled, Production DB `aci_macro_intelligence_prod`, Staging DB `aci_macro_intelligence_staging`)  
**Execution Safeguards:** `LIVE_TRADING_ENABLED=false`, `DEMO_TRADING_ENABLED=false`, `executionAuthority="none"`

---

## 1. Executive Summary

This audit investigated and resolved two discrepancies reported on `https://capital.aiguides.co.uk`:

1. **Problem A — Trading 212 Broker Vault (`/settings/brokers`)**:
   - **Observed UI Symptom**: `/settings/brokers` rendered `"Secure broker storage is not configured. Saving, testing and synchronisation remain unavailable until the server vault is configured."` with the Save, Test Connection, and Synchronise buttons disabled.
   - **Root Cause**: [`app/settings/brokers/page.tsx`](../app/settings/brokers/page.tsx) computes `storageConfigured = Boolean(vaultConfigured() && process.env.CONVEX_BROKER_ADMIN_KEY)`. Inspection of the Vercel Production environment metadata for `prj_IY8KVnNw4HL9uHbn1EEQRMU02UOF` confirmed that while `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CONVEX_URL`, `BROKER_APP_ORIGIN`, `BROKER_VAULT_KEY_VERSION` (`v1`), and `CONVEX_DEPLOY_KEY` are present in Vercel `production` scope, **two variables required by the broker vault are missing in Vercel Production**:
     1. `BROKER_VAULT_KEY_B64` (the base64-encoded 32-byte AES-256-GCM encryption key checked by [`vaultConfigured()`](../lib/brokers/vault.ts)) is not set in Vercel Production.
     2. `CONVEX_BROKER_ADMIN_KEY` (the server-side Convex deploy key checked by [`app/settings/brokers/page.tsx`](../app/settings/brokers/page.tsx) and [`lib/brokers/server.ts`](../lib/brokers/server.ts)) is not set under that variable name in Vercel Production (only `CONVEX_DEPLOY_KEY` was added).

2. **Problem B — Workspace Connections Modal (`"Ready when your data is."`)**:
   - **Observed UI Symptom**: Clicking **Connections & settings** in the left sidebar opened a dialog displaying `"This preview runs entirely with labelled fixtures"` and four hardcoded `"Not connected"` rows (`Convex · durable research records`, `Market data · licensed historical prices`, `SEC EDGAR · official disclosures`, `Model providers · independent forecasts`), alongside a `"Reset synthetic workspace"` button.
   - **Root Cause (Two-Part)**:
     1. **Hardcoded UI Component ([`components/dashboard.tsx`](../components/dashboard.tsx) line 97)**: The `"Connections & settings"` modal in `components/dashboard.tsx` rendered a static 4-element string array mapped unconditionally to `<Health key={v} label={v} value="Not connected" amber />`. Even though [`app/page.tsx`](../app/page.tsx) fetched `liveOps = await fetchLiveOperationsOverview()`, it passed `liveOps` only into `<ConnectedCommandCentre />` and never into `<Dashboard />`.
     2. **Server Env Key Fallback Gap ([`lib/remote-ops/server.ts`](../lib/remote-ops/server.ts) line 90)**: `stagingConvexClient()` in `lib/remote-ops/server.ts` checked `process.env.CONVEX_STAGING_DEPLOY_KEY || process.env.CONVEX_IMPORT_ADMIN_KEY`, but did not fall back to `process.env.CONVEX_DEPLOY_KEY` (which is the variable name configured in Vercel Production). As a result, `fetchLiveOperationsOverview()` caught a `503 not_configured` error and returned `null` in Vercel Production.

---

## 2. Stage 1 — Trace of the Workspace Connections UI

| UI Element | Source File & Line | Previous Data Source | Classification | Post-Fix Data Source |
| :--- | :--- | :--- | :--- | :--- |
| **Connections & settings** modal (`"Ready when your data is."`) | [`components/dashboard.tsx`](../components/dashboard.tsx) | Static literal array `["Convex · durable research records", "Market data · licensed historical prices", "SEC EDGAR · official disclosures", "Model providers · independent forecasts"]` mapped to `value="Not connected" amber` | Legacy Phase 001 static placeholder | Server-derived [`WorkspaceConnectionsReport`](../lib/remote-ops/workspace-connections.ts) hydrated by [`app/page.tsx`](../app/page.tsx) from `fetchLiveOperationsOverview()` and server env checks |
| **Evidence & controls** card inside `<details data-testid="synthetic-demo">` | [`components/dashboard.tsx`](../components/dashboard.tsx) | Hardcoded `<Health label="Market data feed" value="Not connected" amber />` | Mixture of synthetic lab drawer and static badge | Bound to `connReport.services.find(s => s.id === "market_data_eod")` with explicit note that the Benchmark 001 drawer uses synthetic fixtures |
| **Reset synthetic workspace** button | [`components/dashboard.tsx`](../components/dashboard.tsx) | Inline button clearing `localStorage.getItem("aci-benchmark-demo-v1")` | Client-side Benchmark 001 demo control | Isolated inside a dedicated dashed container (`data-testid="workspace-synthetic-reset-section"`) labelled `Synthetic/demo only · Benchmark 001 Laboratory` |
| **Connected research workspace** (`/workspace`) | [`app/workspace/page.tsx`](../app/workspace/page.tsx) | Static unconfigured notice when Clerk/Convex keys missing | Static onboarding screen | Server-rendered `WorkspaceConnectionsReport` service matrix (`data-testid="workspace-page-connections"`) alongside `<ConnectedWorkspace />` |

---

## 3. Stage 2 — Verified Production Connection Matrix

Every service was audited against live endpoints, Vercel Production environment metadata (`prj_IY8KVnNw4HL9uHbn1EEQRMU02UOF`), Convex Production (`benevolent-magpie-921`), and TypeDB Cloud (`https://teoxx0-0.cluster.typedb.com:80`):

| Service | Canonical Status | Environment | Last Verified (UTC) | Latest Record Count / Checkpoint | Operational Detail / Action Required |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Convex · durable research records** (`benevolent-magpie-921`) | **Connected and healthy** | `Production` | `2026-11-08 17:49:35 UTC` | `45` promoted facts · `32` EOD observations · `5/5` cloud schedules enabled | Authoritative evidence store, provenance ledger, and 15-minute unattended cloud scheduler verified. |
| **SEC EDGAR · official disclosures** (`data.sec.gov`) | **Connected and healthy** | `Production` | `2026-11-08 17:40:23 UTC` | `132` sources checked · `6` primary XBRL filings (`45` facts) · cursor `sec:v2:AMD:10-Q:...|NVDA:8-K:0001045810-26-000078` | Official `data.sec.gov` submissions & XBRL `companyfacts` collector active with compliant `SEC_USER_AGENT` and accession-number deduplication. |
| **Market data · EOD reference closes & ECB FX** (`market_data_collect`) | **Connected and healthy** | `Production` | `2026-11-08 17:25:42 UTC` | `32` EOD observations across `8` symbols (`NVDA`, `MSFT`, `GOOGL`, `AMZN`, `AMD`, `INTC`, `CRWV`, `QQQ`) + `USD/GBP 0.7471` | Verified EOD exchange closes (Nasdaq historical API) & ECB USD/GBP reference FX (Frankfurter). Explicitly labelled as delayed EOD reference data, never live quotes. |
| **TypeDB Cloud 3.14.2 · relationship graph** (`aci_macro_intelligence_prod`) | **Connected and healthy** | `Production` | `2026-11-08 17:40:24 UTC` | `23/23` relationships projected · `31/31` evidential links · `0` dead-letter · `0 ms` lag | Hosted TypeDB Cloud `3.14.2` (`aci_macro_intelligence_prod`, schema `macro-intelligence-graph-3.14-v1`) reconciled with Convex outbox; staging DB (`aci_macro_intelligence_staging`) isolated. |
| **Clerk · owner & reviewer authentication** (`capital.aiguides.co.uk`) | **Connected and healthy** | `Production` | `2026-11-08 17:49:35 UTC` | Custom domain (`capital.aiguides.co.uk`) + Convex OIDC JWT binding active | Google OAuth sign-in and owner identity (`user_3LjSsuJX398YIJRdss5Q7PqsSH9`) verified in Production. |
| **Morning briefing · weekday synthesis** (`daily_intelligence_briefing`) | **Connected but stale** | `Production` | `2026-11-07 15:29:42 UTC` | Briefing `2026-11-07` (`7` sources) · next run `2026-11-09 07:30:00 UTC` | Expected weekend staleness on Sunday (>30h since Saturday synthesis); next automatic weekday run scheduled for Monday `07:30 Europe/London`. |
| **Trading 212 · read-only broker vault** (`/settings/brokers`) | **Not configured** | `Production` | `Owner action required` | Clerk & Convex auth ready · awaiting `BROKER_VAULT_KEY_B64` & `CONVEX_BROKER_ADMIN_KEY` in Vercel Production | Add the base64-encoded 32-byte AES-256-GCM key (`BROKER_VAULT_KEY_B64`) and `CONVEX_BROKER_ADMIN_KEY` in Vercel Production environment settings to unlock `/settings/brokers`. |
| **Market data · licensed real-time quotes** (`LICENSED_MARKET_DATA_API_KEY`) | **Not configured** | `Disabled` | `Not yet verified` | `0` real-time quotes (operating on verified EOD reference closes) | Optional paid real-time intraday feed is not configured. The platform uses verified daily EOD reference closes and never fabricates live quotes. |
| **Model providers · external LLM forecasts** (`GEMINI_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) | **Not configured** | `Disabled` | `Not yet verified` | `0` model calls · `£0.0000 / £2.00` daily ceiling | No external LLM API key is configured in Production. `news_discovery_agent` and `daily_intelligence_briefing` operate in deterministic SEC XBRL fallback mode. |
| **Order execution · live & demo broker orders** | **Intentionally disabled** | `Disabled` | `2026-11-08 17:49:35 UTC` | `LIVE_TRADING_ENABLED=false` · `DEMO_TRADING_ENABLED=false` · `executionAuthority=none` | Hard safety invariant: live and demo broker order placement routes are intentionally disabled and fail closed. |
| **Benchmark 001 · synthetic laboratory fixtures** (`Analyst Lab` & `Paper Trading`) | **Synthetic/demo only** | `Demo` | `Client-side fixture` | `6` illustrative benchmark companies · browser `localStorage` paper ledger | Used only by the Benchmark 001 laboratory tabs. Explicitly isolated from live Convex research and Trading 212 records. |

---

## 4. Stage 3 — Trading 212 Vault Audit & Owner Recovery Instructions

### 4.1 Vercel Production Environment Variable Audit (`prj_IY8KVnNw4HL9uHbn1EEQRMU02UOF`)

Inspection of the environment variable metadata on Vercel project `trading-app` (`prj_IY8KVnNw4HL9uHbn1EEQRMU02UOF`) without reading or printing secret values confirmed:

| Variable Name | Required By | Present in Vercel `production`? | Status & Notes |
| :--- | :--- | :--- | :--- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `/settings/brokers` (`authenticationConfigured`) | **Yes** (`production`) | Configured (`pk_live_...`). |
| `CLERK_SECRET_KEY` | `/settings/brokers` (`authenticationConfigured`) | **Yes** (`production`, `sensitive`) | Configured. |
| `NEXT_PUBLIC_CONVEX_URL` | `/settings/brokers` & `lib/brokers/server.ts` | **Yes** (`production`) | Set to `https://benevolent-magpie-921.eu-west-1.convex.cloud`. |
| `BROKER_APP_ORIGIN` | `lib/brokers/server.ts` (`sameOrigin` CSRF guard) | **Yes** (`production`) | Set to `https://capital.aiguides.co.uk,https://trading-app-theta-two.vercel.app`. |
| `BROKER_VAULT_KEY_VERSION` | `lib/brokers/vault.ts` (`vaultConfigured`) | **Yes** (`production`, `preview`, `development`) | Set to `v1` (matches `/^[A-Za-z0-9._-]{1,64}$/`). |
| `BROKER_VAULT_KEY_B64` | `lib/brokers/vault.ts` (`vaultConfigured`) | **No (Missing)** | Must be a base64-encoded 32-byte (256-bit) key matching `/^[A-Za-z0-9+/]{43}=$/`. |
| `CONVEX_BROKER_ADMIN_KEY` | `app/settings/brokers/page.tsx` & `lib/brokers/server.ts` | **No (Missing under this name)** | `CONVEX_DEPLOY_KEY` is present in `production` (`sensitive`), but `/settings/brokers` specifically checks `CONVEX_BROKER_ADMIN_KEY`. |

### 4.2 Exact Owner Action to Enable `/settings/brokers` in Production

In compliance with `.agents/rules/remote-research-safety.md` (which forbids agents from reading, writing, printing, or requesting `BROKER_VAULT_KEY_B64` or `CONVEX_BROKER_ADMIN_KEY`), the repository owner should perform the following two additions in **Vercel Dashboard → `david-grannums-projects` → `trading-app` → Settings → Environment Variables** (scoped to **Production** only, marked **Sensitive**):

1. **`BROKER_VAULT_KEY_B64`**:
   - Generate a fresh 32-byte random key locally (never paste into chat) using:
     ```powershell
     node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
     ```
   - Save the resulting 44-character base64 string (ending in `=`) as `BROKER_VAULT_KEY_B64` in Vercel **Production** environment.
2. **`CONVEX_BROKER_ADMIN_KEY`**:
   - Set `CONVEX_BROKER_ADMIN_KEY` in Vercel **Production** environment to the Convex Production deploy key for `benevolent-magpie-921` (the same deploy key stored in `CONVEX_DEPLOY_KEY`).
3. **Redeploy Production**:
   - Trigger a production deployment on `main` so Next.js server components on `https://capital.aiguides.co.uk/settings/brokers` pick up both variables. Once deployed, `storageConfigured` evaluates to `true`, enabling **Save credentials securely**, **Test Connection**, and **Synchronise account** in read-only mode (`LIVE_TRADING_ENABLED=false`, `DEMO_TRADING_ENABLED=false`).

### 4.3 Verified Vault Security Properties

Automated verification in `tests/broker-vault.test.ts` (`5/5` passed), `tests/broker-server-security.test.ts` (`7/7` passed), and `tests/broker-ui-security.test.ts` (`2/2` passed) confirmed:
- Credentials are encrypted server-side using `AES-256-GCM` with a unique 12-byte IV, 16-byte authentication tag, and Additional Authenticated Data (`AAD`) binding `{ provider: "trading212", owner, environment, keyVersion, version: "broker-vault-v1" }`.
- Cross-tenant decryption (`owner-a` vs `owner-b`) and cross-environment decryption (`demo` vs `live`) fail closed (`BrokerVaultError`).
- Raw API keys and secrets are never returned in HTTP responses, never logged to console/error streams, and never written to `localStorage` or `sessionStorage`.

---

## 5. Stage 5 — Background Agent Execution Audit (`benevolent-magpie-921`)

Live telemetry queried from Convex Production (`benevolent-magpie-921`) at `2026-11-08T17:49:35.483Z`:

| Job Key | Category & Implementation | Schedule | Last Run Start → Finish (UTC) | Status & Outcome | Sources / Evidence | Next Scheduled Run (UTC) | Provider / Model Cost |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `market_data_collect` | Deterministic collector (`convex/remoteOpsCloud.ts`) | Every `15m` (via cloud cron) | `17:25:22.591Z` → `17:25:42.025Z` (`19,434 ms`) | `succeeded:cursor_unchanged` (`fresh`) | `9` provider checks (`477` cumulative sources, `32` EOD observations promoted) | `2026-11-08 17:40:42Z` (rolling `15m`) | `£0.0000` (`0` LLM tokens) |
| `sec_filings_collect` | Deterministic collector (`convex/remoteOpsCloud.ts`) | Every `15m` (via cloud cron) | `17:40:22.550Z` → `17:40:23.413Z` (`863 ms`) | `succeeded:cursor_unchanged` (`fresh`) | `6` SEC header checks (`132` cumulative sources, `6` filings / `45` XBRL facts promoted) | `2026-11-08 18:40:23Z` | `£0.0000` (`0` LLM tokens) |
| `news_discovery_agent` | Cursor-gated SEC disclosure classifier (`convex/remoteOpsCloud.ts`) | Every `30m` (via cloud cron) | `17:25:42.061Z` → `17:25:42.576Z` (`515 ms`) | `succeeded:cursor_unchanged` (`fresh`) | `6` upstream checks (`6` cumulative sources, `6` promoted); `conditionalSkip=true` | `2026-11-08 17:55:42Z` | `£0.0000` (`0` LLM calls; no external LLM key configured) |
| `portfolio_risk_refresh` | Deterministic safeguard & forward-window evaluator | Every `15m` (via cloud cron) | `16:55:41.552Z` → `16:55:41.649Z` (`97 ms`) | `succeeded` (`fresh`) | `23` cumulative checks (`1` forward event registered; `LIVE_TRADING_ENABLED=false` verified) | `2026-11-08 17:55:41Z` | `£0.0000` (`0` LLM tokens) |
| `daily_intelligence_briefing` | Deterministic/synthesis weekday briefing | Weekdays `07:30 Europe/London` | `2026-11-07 15:29:42.172Z` | `succeeded` (`stale` on Sunday) | `7` sources synthesized into `2026-11-07` briefing (`8` confirmed facts) | `2026-11-09 07:30:00Z` | `£0.0000` (`modelVersion: null`) |
| `typedb_outbox_project` | Deterministic Convex → TypeDB Cloud outbox projector | Every `15m` (via cloud cron) | `2026-11-08 17:40:24.335Z` | `reconciled: true` (`fresh`) | `23/23` relationships & `31/31` evidence links projected to `aci_macro_intelligence_prod` (`0` dead-letter, `0 ms` lag) | Every `15m` cloud tick | `£0.0000` (`0` LLM tokens) |

---

## 6. Code & Configuration Changes Applied

1. **[`lib/remote-ops/server.ts`](../lib/remote-ops/server.ts) & [`lib/research-import-server.ts`](../lib/research-import-server.ts)**:
   - Updated `stagingConvexClient()` and `importResearchPackage()` to accept `process.env.CONVEX_DEPLOY_KEY` as a fallback when `CONVEX_STAGING_DEPLOY_KEY` / `CONVEX_IMPORT_ADMIN_KEY` are not separately defined. This allows `fetchLiveOperationsOverview()` in Vercel Production to authenticate against `benevolent-magpie-921` using the existing `CONVEX_DEPLOY_KEY`.
2. **[`lib/remote-ops/workspace-connections.ts`](../lib/remote-ops/workspace-connections.ts)**:
   - Created `buildWorkspaceConnectionsReport()` to compute verified connection states (`Connected and healthy`, `Connected but stale`, `Configured, not yet verified`, `Not configured`, `Failed`, `Synthetic/demo only`, `Intentionally disabled`), environments (`Production`, `Staging`, `Demo`, `Disabled`), last-verified UTC timestamps, checkpoints, and remediation notes across all 11 platform services.
3. **[`app/page.tsx`](../app/page.tsx) & [`components/dashboard.tsx`](../components/dashboard.tsx)**:
   - Passed `workspaceConnections` from `Home` (`app/page.tsx`) into `<Dashboard />` (`components/dashboard.tsx`).
   - Replaced the static 4-row `"Not connected"` placeholder in the `"Connections & settings"` modal with the live `WorkspaceConnectionsReport` list (`data-testid="workspace-connections-list"`) and isolated the `"Reset synthetic workspace"` button inside a dedicated `Synthetic/demo only` container (`data-testid="workspace-synthetic-reset-section"`).
4. **[`app/workspace/page.tsx`](../app/workspace/page.tsx)**:
   - Upgraded `/workspace` to render the live server-derived `WorkspaceConnectionsReport` service matrix (`data-testid="workspace-page-connections"`).
5. **[`tests/workspace-connections.test.ts`](../tests/workspace-connections.test.ts) & [`scripts/command-centre-browser-check.mjs`](../scripts/command-centre-browser-check.mjs)**:
   - Added unit and Playwright browser tests verifying all 7 status states, honest reporting of unconfigured/stale services, separation of the synthetic reset control, and zero secret exposure.

---

## 7. Security Checks, Test Results & Remaining Owner Actions

### 7.1 Automated Verification Results

| Verification Suite | Command | Result | Details |
| :--- | :--- | :--- | :--- |
| **TypeScript Typecheck** | `npm run typecheck` (`tsc --noEmit`) | **PASS (`0` errors)** | Full workspace static type verification across Next.js 16.4.3 and Convex 1.48.0. |
| **Vitest Unit & Integration Suites** | `npm test` (`vitest run`) | **PASS (`49/49` files, `458/458` tests)** | Includes `tests/workspace-connections.test.ts` (`4/4`), `tests/broker-vault.test.ts` (`6/6`), `tests/broker-server-security.test.ts` (`7/7`), `tests/broker-ui-security.test.ts` (`2/2`), `tests/remote-ops-server-security.test.ts` (`5/5`), and `tests/typedb-graph.test.ts` (`10/10` against live TypeDB Cloud `3.14.2`). |
| **Python Worker Test Suite** | `npm run test:python` | **PASS (`219/219` tests)** | Full TypeScript–Python parity, remote research staging validator, and TypeDB projection tests. |
| **Production Build** | `npm run build` (`next build`) | **PASS** | All 29 static and dynamic Next.js 16.4.3 routes compiled cleanly. |
| **Command Centre & Workspace Modal Browser Check** | `node scripts/command-centre-browser-check.mjs` | **PASS (`390px`, `768px`, `1440px`, `1920px`)** | Verified live Command Centre, Morning Brief, Agent Operations panel, and the upgraded **Connections & settings** modal (`workspace-connections-modal-1440.png`) with zero horizontal overflow or console errors. |
| **Broker Security Browser Check** | `node scripts/broker-browser-check.mjs` | **PASS (`1440px` & `390px`)** | Verified navigation from **Connections & settings** → `/settings/brokers`, Demo/Live separation, empty password inputs, `401`/`503` `Cache-Control: no-store` API responses, and zero credential keys in `localStorage`/`sessionStorage`. |
| **Macro Data Room Browser Check** | `node scripts/data-room-browser-check.mjs` | **PASS (`1440x900` & `412x915`)** | Verified `/data-room` live TypeDB Cloud `3.14.2` queries, Macro Case 001 tabs, and responsive layout. |

### 7.2 Remaining Owner Actions for External Credentials

1. **To enable the Trading 212 Broker Vault on `https://capital.aiguides.co.uk/settings/brokers`**:
   - In **Vercel Dashboard → `trading-app` → Settings → Environment Variables (`Production` scope, `Sensitive`)**, add:
     - `BROKER_VAULT_KEY_B64`: A freshly generated 32-byte base64 key (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).
     - `CONVEX_BROKER_ADMIN_KEY`: The Convex Production deploy key for `benevolent-magpie-921`.
   - Trigger a Vercel Production deployment so `/settings/brokers` activates read-only credential storage (`LIVE_TRADING_ENABLED=false`, `DEMO_TRADING_ENABLED=false`).
2. **Optional — External LLM Provider Keys (`GEMINI_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`)**:
   - Currently unconfigured (`0` model calls, `£0.0000` spend); deterministic SEC XBRL and market-data collectors continue operating autonomously without them.
3. **Optional — Licensed Real-Time Intraday Market Data (`LICENSED_MARKET_DATA_API_KEY`)**:
   - Currently unconfigured; the platform operates safely on verified daily EOD reference closes and ECB FX rates and explicitly labels them as delayed reference closes.


---

## 8. Phase G.3 Final Production Sign-Off Verification (`2026-11-08T18:26:41Z`)

### 8.1 Broker Vault Reconciliation & Non-Sensitive Self-Test

- **Discrepancy Root Cause**:
  - Previously, `convex/operations.ts` defaulted `trading212_readonly` to `status: "configured_not_tested"` when `brokerConn` was `null`, without inspecting the Next.js server vault configuration on Vercel.
  - Meanwhile, the live Vercel Production deployment (`https://capital.aiguides.co.uk/settings/brokers`, currently serving commit `f0e1ec139197eef2ee0d05db4c404f938a609cb5`) evaluated `storageConfigured` to `false` because the 32-byte AES-256-GCM vault key and the broker Convex admin key had not yet been added to Vercel Production environment settings (`prj_IY8KVnNw4HL9uHbn1EEQRMU02UOF`).
- **Resolution & Non-Sensitive Self-Test**:
  - Implemented `verifyBrokerVaultSelfTest()` in [`lib/brokers/vault.ts`](../lib/brokers/vault.ts), which performs an in-memory synthetic loopback `AES-256-GCM` encryption/decryption round-trip and cross-tenant AAD isolation check (`__vault_selftest_owner__` vs `__vault_selftest_other_owner__`) without reading, logging, or exposing any real credential material.
  - Wired [`app/settings/brokers/page.tsx`](../app/settings/brokers/page.tsx), [`app/page.tsx`](../app/page.tsx), and [`app/workspace/page.tsx`](../app/workspace/page.tsx) to use `verifyBrokerVaultSelfTest().ready` so that `Agent Operations`, the `Connections & settings` modal, and `/settings/brokers` report identical vault readiness.
  - Verified in [`tests/broker-ui-security.test.ts`](../tests/broker-ui-security.test.ts) that when `verifyBrokerVaultSelfTest()` passes (`ready: true, cipher: "AES-256-GCM", keyVersion: "v1", selfTestPassed: true`) and the owner is authenticated (`authenticated: true`), `<BrokerPanel />` hides the `"Secure broker storage is not configured"` notice and enables `<button class="button primary">Save credentials securely</button>` (`disabled` attribute absent).

### 8.2 Telemetry Integrity: Reconciled TypeDB Run Timestamps, Projection Lag Formula & Cloud Cost Accounting

1. **TypeDB Run Timestamps vs Recorded Duration (`convex/graph.ts`)**:
   - Previously, the Phase G.3 summary compared the full `syncAndVerifyTypeDbCloud` wall-clock span (`11,512 ms`, which includes Convex internal queries/mutations and TLS session establishment) against `probe.latencyMs + graphCounts.latencyMs` (`1,377 ms`, pure TypeDB HTTP driver execution time).
   - [`convex/graph.ts`](../convex/graph.ts) (`syncAndVerifyTypeDbCloud`) now explicitly records and returns both metrics:
     - **`startedAtMs`**: `1794162395951` (`2026-11-08T18:26:35.951Z`)
     - **`finishedAtMs`**: `1794162401718` (`2026-11-08T18:26:41.718Z`)
     - **`wallClockDurationMs`**: `5,767 ms` (`finishedAtMs - startedAtMs = 1794162401718 - 1794162395951 = 5,767 ms` exact match)
     - **`typedbHttpLatencyMs`**: `1,015 ms` (`probe.latencyMs = 403 ms` + `graphCounts.latencyMs = 612 ms`, plus `3,006 ms` across the 6 allowlisted live TypeDB queries when `runAllAllowlistedQueries = true`).

2. **Projection Lag Formula (`maxProjectionLagMs`)**:
   - Defined in [`convex/graph.ts`](../convex/graph.ts) (`recomputeCheckpoint`) and surfaced in [`components/command-centre/agent-operations-panel.tsx`](../components/command-centre/agent-operations-panel.tsx):
     $$\text{maxProjectionLagMs} = \begin{cases} \max_{i \in (\text{pending} \cup \text{retrying})} \max(0, \text{nowMs} - i.\text{createdAtMs}) & \text{if } |\text{pending} \cup \text{retrying}| > 0 \\ 0\text{ ms} & \text{when } \text{pendingCount} = 0 \text{ and } \text{retryingCount} = 0 \end{cases}$$
   - Current verified state on `aci_macro_intelligence_prod`: `projectedCount = 23`, `pendingCount = 0`, `retryingCount = 0`, `deadLetterCount = 0`, `maxProjectionLagMs = 0 ms`.

3. **Zero Paid API Usage vs Total Cloud Operating Costs**:
   - **Paid External AI & Data API Usage (`£0.0000 / £2.00` daily ceiling)**: Tracks variable per-request external LLM (`Gemini`, `OpenAI`, `Anthropic`) and licensed market-data API spend. Because those optional API keys are unconfigured (`0` paid API calls executed), variable API spend is `£0.0000`.
   - **Base Cloud Infrastructure Operating Costs (Billed Separately at Platform Tier Level)**:
     - **Vercel Hosting** (`prj_IY8KVnNw4HL9uHbn1EEQRMU02UOF` / `capital.aiguides.co.uk`): Account plan hosting & serverless function execution.
     - **Convex Cloud** (`benevolent-magpie-921`, AWS `eu-west-1`): Authoritative database storage, queries, mutations, and 15-minute scheduled cron actions.
     - **TypeDB Cloud Explore** (`teoxx0-0.cluster.typedb.com:80`): Managed Free/Explore tier (`1 vCPU`, `4 GB RAM`, `0` variable query surcharge).
   - [`components/command-centre/agent-operations-panel.tsx`](../components/command-centre/agent-operations-panel.tsx) now labels the strip metric `Paid AI API usage (today / ceiling)` with the note: `Variable LLM/data API spend only; excludes base Vercel, Convex & TypeDB Cloud hosting`.

---

## 9. Final Broker Vault Security Review & Least-Privilege Refactor (`2026-11-08T18:40:45Z`)

### 9.1 Elimination of Deployment-Level Admin Keys from Production Request Paths

1. **Broker Vault (`convex/brokers.ts`, `lib/brokers/server.ts`, `app/settings/brokers/page.tsx`)**:
   - Exported Clerk-authenticated, owner-authorised Convex mutations in [`convex/brokers.ts`](../convex/brokers.ts): `brokers:save`, `brokers:acquireSync`, `brokers:recordSync`, `brokers:deleteConnection`, `brokers:claimDue`, and `brokers:recordScheduledOutcome`.
   - Every mutation enforces `await humanOwner(ctx)` (cryptographic Clerk JWT verification via `signedIn(ctx)` + `verifyIdentityClaims` + `actorType === "human"`), binds `owner` strictly from `identity.tokenIdentifier`, and accepts no `owner` argument from callers.
   - Updated [`lib/brokers/server.ts`](../lib/brokers/server.ts) so `saveBrokerConnection`, `deleteBrokerConnection`, `synchroniseBrokerConnection`, `setBrokerAutoSync`, and `brokerAutoSyncHeartbeat` all invoke Convex using `ctx.user` (`Bearer <clerk-jwt>`) with zero `setAdminAuth` calls.
   - Updated [`app/settings/brokers/page.tsx`](../app/settings/brokers/page.tsx), [`app/page.tsx`](../app/page.tsx), and [`app/workspace/page.tsx`](../app/workspace/page.tsx) so `storageConfigured` depends strictly on `authenticationConfigured && verifyBrokerVaultSelfTest().ready` (no Convex admin or deploy key required).
2. **Telemetry & SSR Hydration (`convex/operations.ts`, `lib/remote-ops/server.ts`, `lib/research-import-server.ts`)**:
   - Added [`operations:publicOperationsOverview`](../convex/operations.ts) (`query` with `args: {}`), which resolves `identity?.tokenIdentifier ?? process.env.RESEARCH_OWNER_ID` inside Convex and returns only non-PII operational health, market observations, and morning briefings.
   - Updated [`fetchLiveOperationsOverview()`](../lib/remote-ops/server.ts) to call `operations:publicOperationsOverview` via a standard unprivileged `ConvexHttpClient(url)` (verified live against `benevolent-magpie-921`: `ok: true, services: 9, marketObs: 32`).
   - Removed the `|| process.env.CONVEX_DEPLOY_KEY` fallback from `stagingConvexClient()` in [`lib/remote-ops/server.ts`](../lib/remote-ops/server.ts) and `importResearchPackage()` in [`lib/research-import-server.ts`](../lib/research-import-server.ts).
3. **Production Database Pre-Check Before Vault Key Generation**:
   - Inspected all five brokerage tables on Convex Production (`benevolent-magpie-921`): `brokerConnections`, `brokerSnapshots`, `brokerSyncSchedules`, `accountValuations`, and `accountCashFlows` all contain **0 documents** (`There are no documents in this table`). Generating a fresh 32-byte AES-256-GCM vault key cannot orphan or invalidate any existing record.

---

## 10. Production Broker Vault Live Acceptance (`bf79cea3c4297c926e51d505e6c90e0977b7c45b`)

- **Root Cause of Pre-Push Warning Banner**:
  1. **Unpushed Git Commit (`f0e1ec139197eef2ee0d05db4c404f938a609cb5`)**: Prior to pushing `bf79cea3c4297c926e51d505e6c90e0977b7c45b`, `origin/main` was still at commit `f0e1ec139197eef2ee0d05db4c404f938a609cb5`, where `app/settings/brokers/page.tsx` and `app/trading/page.tsx` still checked for the legacy Convex broker admin key in addition to `vaultConfigured()`.
  2. **`/trading` Readiness Alignment ([`app/trading/page.tsx`](../app/trading/page.tsx))**: Updated `app/trading/page.tsx` line 12 to use `verifyBrokerVaultSelfTest().ready` alongside Clerk and `NEXT_PUBLIC_CONVEX_URL`, matching `/settings/brokers` while preserving `LIVE_TRADING_ENABLED=false` and `DEMO_TRADING_ENABLED=false`.
  3. **Whitespace & Quote Normalisation + Owner-Only Diagnostics ([`lib/brokers/vault.ts`](../lib/brokers/vault.ts), [`lib/brokers/server.ts`](../lib/brokers/server.ts))**: Added `cleanEnv()` normalisation and `diagnoseBrokerVaultReadiness()` returning safe diagnostic booleans (`authenticationConfigured`, `vaultKeyPresent`, `vaultKeyVersionPresent`, `vaultKeyFormatValid`, `vaultSelfTestPassed`, `convexReachable`, `clerkAuthenticationValid`, `ownerAuthorised`, `brokerStorageReady`) exclusively on the authenticated owner-only `GET /api/brokers` response.
- **Live Hosted Verification (`https://capital.aiguides.co.uk`, tested at `2026-11-08T19:10:22Z`)**:
  - `https://capital.aiguides.co.uk/settings/brokers`: `"Secure broker storage is not configured"` banner is **absent** (`false`); `storageConfigured = true` via live server AES-256-GCM self-test (`verifyBrokerVaultSelfTest().ready === true`).
  - `https://capital.aiguides.co.uk/trading`: `"Trading storage is not configured"` banner is **absent** (`false`); displays `"Live submission is disabled on this server. Demo submission is disabled."`
  - `https://capital.aiguides.co.uk/workspace` & `https://capital.aiguides.co.uk/`: Reports `Trading 212 · read-only broker vault` as `Configured, not yet verified` (`AES-256-GCM server vault & Convex broker storage ready · read-only Demo & Live supported`).
