# Phase 003: Remote Project Setup & Operations Guide

## 1. Current Infrastructure Review

### 1.1 Existing Data Collectors (Non-AI, Deterministic)
Inspection of the repository (`lib/`, `worker/`, `scripts/`) confirms the following existing collectors, which are preserved without duplication:
- **SEC Financial Disclosures (`lib/providers.ts` -> `fetchSecCompanyFacts`)**: Fetches official XBRL company facts from `data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json` with explicit `SEC_USER_AGENT` identification.
- **Macro Series (`lib/providers.ts` -> `fetchFredSeries`)**: Retrieves official macroeconomic series from FRED (`api.stlouisfed.org`) when `FRED_API_KEY` is configured.
- **Market Data Ingestion (`lib/market-data.ts` -> `importMarketData`, `listObservationRecords`)**: Parses CSV/JSON price and volume observations, computes SHA-256 content hashes, validates provenance (`sourceName`, `sourceUrl`, `licenseNote`, `sourceTimestamp`, `ingestedAt`, `delayMinutes`), and rejects synthetic/placeholder rows.
- **News & Disclosure Claim Extraction (`lib/news-ingestion.ts` -> `extractArticleClaims`)**: Deterministically extracts ticker tags, dates, numbers, and source-credibility tiers from structured articles and RSS feeds.
- **Analyst Consensus (`worker/consensus_provider.py` -> `BenzingaConsensusProvider`)**: Queries Benzinga calendar ratings (`api.benzinga.com/api/v2.1/calendar/ratings`) when `BENZINGA_API_KEY` is configured, failing closed when unconfigured.
- **Offline Evidence & Market Capture (`scripts/prepare-recovery-case.py`, `scripts/prepare-recovery-case-v2.py`, `scripts/prepare-policy-risk-case.py`)**: Pulls SEC Submissions/CompanyFacts, Stooq end-of-day CSVs, Frankfurter ECB GBP/USD reference rates, and official RSS items into `data/recovery/` and `data/policy-risk/` with SHA-256 manifests.

### 1.2 Existing Scheduled Broker Jobs
- **Convex Broker Synchronisation (`convex/brokers.ts`)**:
  - `brokerSyncSchedules` table stores per-connection auto-sync settings (`enabled`, `intervalMinutes`, `nextRunAt`, `leasedUntil`, `leaseToken`, `consecutiveFailures`).
  - `setAutoSync` configures interval schedules (5–1440 minutes).
  - `claimDueInternal` and `recordScheduledOutcomeInternal` manage idempotent lease acquisition, backoff on HTTP 429 (`Retry-After`), and audit logging.
- **Broker Sync Routes (`lib/brokers/server.ts`)**:
  - `POST /api/brokers/auto-sync`: Browser-session-authenticated background heartbeat while a signed-in tab is open.
  - `POST /api/brokers/scheduled`: Unattended server-to-server webhook authenticated by `x-broker-scheduler-secret` (`BROKER_SCHEDULER_SECRET`).
- **Preservation Rule**: Phase 003 does **not** duplicate or modify the Trading 212 broker sync service. Instead, the `trading212-sync-health` job in `lib/remote-ops/` monitors its freshness and delegates actual broker synchronisation to the existing read-only broker service.

### 1.3 Processes Requiring the Local Development Server vs Remote Execution
- **Previously Local-Only**:
  - Interactive browser sessions triggering `/api/brokers/auto-sync`.
  - Manual script execution (`scripts/prepare-*.py`, `scripts/import-local-research-convex.mjs`).
  - Local Antigravity desktop sidecars (`"builtin": "schedule"`), which rely on the local `language_server.exe` daemon running on the user's workstation.
- **Now Remote-Capable (Laptop Powered Off)**:
  - `GET /api/research/staging` and `POST /api/research/staging` (authenticated by dedicated `RESEARCH_STAGING_TOKEN`).
  - `POST /api/operations/scheduled` (authenticated by `OPERATIONS_SCHEDULER_SECRET`).
  - GitHub Actions workflow `.github/workflows/remote-research-operations.yml` + Python worker `worker/remote_research.py` running in unattended cloud runners or Antigravity Remote Agent sandboxes against the hosted Convex deployment (`https://focused-Setter-755.eu-west-1.convex.cloud`).

### 1.4 Convex Functions Safely Supporting Remote Ingestion
- **`convex/operations.ts`**:
  - `getStagingStateInternal`: Returns only the approved research universe (`APPROVED_RESEARCH_UNIVERSE`), latest processed event cursor, and active scheduler environment (`local` vs `remote`). Does **not** return broker accounts, positions, orders, or user PII.
  - `acquireJobLeaseInternal`: Enforces environment separation (`activeEnvironment`), idempotency keys, and expiring job leases (`leasedUntil`, `leaseToken`).
  - `submitStagedResearchInternal`: Writes validated candidate claims to `researchStagingItems`, records auditable runs in `researchJobRuns`, updates `researchJobs`, and promotes only validated items (`promoted_to_research`) into `morningBriefings` while quarantining prompt-injection attempts (`quarantined`) and holding unverified secondary claims (`pending_verification`).
  - `recordDeterministicRunInternal`: Records deterministic collector health and updates the Morning Intelligence Brief.

### 1.5 Market-Data Integrations Remaining Unavailable
- **Live Licensed Intraday Equity & Index Feed**: Not yet provisioned. Until a commercial intraday license is configured, `market-data-refresh` reports `degraded` (or `delayed_only` when delayed EOD observations are present), and `validatePricePresentation` blocks any delayed price from being rendered as live (`LIVE` badge forbidden when `delayMinutes > 0`).
- **Live Commercial Intraday FX Feed**: ECB daily reference GBP/USD rates are available for historical conversion, while live portfolio valuation continues to rely on Trading 212 account currency summaries.
- **Paid Consensus Feed (`BENZINGA_API_KEY`)**: Remains optional (`not_configured` by default).

### 1.6 Installed Antigravity Version, Environments, and Permissions
- **Installed Version**: Google Antigravity Desktop `2.0` (`C:\Users\david\AppData\Local\Programs\Antigravity\resources\bin\language_server.exe`, CLI shim `C:\Users\david\.gemini\antigravity\bin\agentapi.bat`).
- **Project Registration**: Registered at `C:\Users\david\.gemini\config\projects\e66bc7cf-436e-4910-bfcd-167d6af7221c.json` (`projectId`: `e66bc7cf-436e-4910-bfcd-167d6af7221c`).
- **Schedule Support Analysis**:
  - In Antigravity 2.0, `/schedule` and `"builtin": "schedule"` sidecar definitions execute inside the local desktop daemon (`language_server.exe`) when the workstation is awake.
  - Antigravity Remote Agents (`https://antigravity.google/docs/remote-agents`) run asynchronously in isolated cloud sandboxes against a connected private Git repository when dispatched via UI, CLI, or webhook.
  - Because local sidecar schedules pause when the laptop is powered off, **persistent unattended scheduling** is implemented via `.github/workflows/remote-research-operations.yml` (or an external hosted cron service) invoking `POST /api/operations/scheduled` and `python -m worker.remote_research`, while local sidecar definitions (`config/antigravity/sidecars/*`) are provided for workstation-assisted runs and guarded by `activeEnvironment: 'remote'` so duplicate jobs never run across local and remote environments.

---

## 2. Private Git Repository & Antigravity Remote Project Setup

### 2.1 Repository Hardening (`.gitignore`)
The repository `.gitignore` explicitly excludes all credentials, local environment files, encrypted vaults, session tokens, and personal financial records:
- `.env*` (with `!.env.example` whitelisted)
- `.convex/`, `.tmp/`, `tmp/tickets/`, `test-results/`, `playwright-report/`
- `*.key`, `*.pem`, `*.p12`, `*.pfx`, `*secret*`, `*credential*`

### 2.2 Configuring the Antigravity Remote Project
1. Push the private repository to GitHub (confirming `git status` shows zero `.env.local` or personal data files).
2. Load the Remote Project manifest at `config/antigravity/remote-project.json`, which binds:
   - Rule: `.agents/rules/remote-research-safety.md` (`always_on`)
   - Skill: `.agents/skills/remote-research-agent/SKILL.md`
   - Allowed Environment Variables: `RESEARCH_STAGING_URL`, `RESEARCH_STAGING_TOKEN`, `SEC_USER_AGENT`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `RESEARCH_SCHEDULER_ENV`
   - Forbidden Environment Variables: `CLERK_SECRET_KEY`, `CONVEX_DEPLOY_KEY`, `BROKER_CREDENTIALS_MASTER_KEY`, `BROKER_SCHEDULER_SECRET`, `TRADING212_API_KEY`, `LIVE_TRADING_ENABLED`, `DEMO_TRADING_ENABLED`

---

## 3. Separation of Deterministic Collection and AI Research

| Workload | Category | Implementation | Authority Boundary |
| --- | --- | --- | --- |
| Equity & index price observations | Deterministic (`deterministic_collector`) | `lib/market-data.ts` + `market-data-refresh` | Only licensed/delayed provider feeds; delayed prices must carry delay badge |
| Permitted GBP/USD rates | Deterministic (`deterministic_collector`) | ECB reference rates / Trading 212 account FX | Never estimated by AI |
| Official SEC financial disclosures | Deterministic (`deterministic_collector`) | `lib/providers.ts` (`fetchSecCompanyFacts`) + `sec-filings-Refresh` | Primary `sec.gov` filings only |
| Read-only Trading 212 sync | Deterministic (`deterministic_collector`) | Existing `convex/brokers.ts` + `lib/brokers/server.ts` | Isolated from remote agents |
| Financial news & AI infrastructure discovery | AI Research (`ai_research_agent`) | `lib/remote-ops/news-agent.ts` + `worker/remote_research.py` | Submits to `/api/research/staging`; cannot write authoritative prices |
| Morning Intelligence Brief | Hybrid synthesis (`ai_research_agent`) | `lib/remote-ops/morning-briefing.ts` | Separates confirmed facts, interpretation, risk changes, and incomplete evidence |

---

## 4. Least-Privilege Security Model

### 4.1 Dedicated Machine Identity (`research-staging-agent`)
Remote agents authenticate exclusively to `/api/research/staging` using:
- Header: `x-research-staging-token: <RESEARCH_STAGING_TOKEN>` (or `Authorization: Bearer <RESEARCH_STAGING_TOKEN>`)
- Header: `x-agent-identity: research-staging-agent`

### 4.2 Enforced Denials (`lib/remote-ops/server.ts`)
Any request to `/api/research/staging` is immediately rejected with HTTP `403` if:
- The token is missing or does not match `RESEARCH_STAGING_TOKEN` via constant-time comparison (`crypto.timingSafeEqual`).
- The caller passes a privileged identity (`admin`, `reviewer`, `operator`, `clerk-session`, `convex-admin`, `broker-vault`).
- The request includes forbidden headers (`x-clerk-auth-token`, `x-broker-scheduler-secret`, `x-convex-admin-key`, `x-trading212-key`).
- The payload contains forbidden operational keys (`trading212ApiKey`, `brokerCredentialsMasterKey`, `convexAdminKey`, `clerkSecretKey`, `liveTradingEnabled`, `demoTradingEnabled`, `submitOrder`, `roleOverride`).

---

## 5. Persistent Scheduling & De-Duplication

| Job Key | Schedule | Cadence | Environment Lock |
| --- | --- | --- | --- |
| `market-data-refresh` | `*/15 8-21 * * 1-5` | Every 15 min (weekday market hours) | `activeEnvironment` + Convex lease |
| `news-discovery` | `*/30 * * * *` | Every 30 min | `activeEnvironment` + Convex lease |
| `sec-filings-refresh` | `5 * * * *` | Hourly with change detection | `activeEnvironment` + Convex lease |
| `portfolio-risk-refresh` | `20 * * * *` | Hourly after validated data refresh | `activeEnvironment` + Convex lease |
| `morning-intelligence-brief` | `30 7 * * 1-5` | 07:30 `Europe/London` weekdays | `activeEnvironment` + Convex lease |
| `trading212-sync-health` | `*/15 * * * *` | Every 15 min freshness check | `activeEnvironment` + Convex lease |
