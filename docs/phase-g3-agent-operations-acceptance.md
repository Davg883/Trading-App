# AI Capital Intelligence — Phase G.3: Live Agent Operations Acceptance Report

- **Acceptance Date:** 8 November 2026 (`2026-11-08T17:20:37Z`)
- **Production Convex Deployment:** `benevolent-magpie-921` (`https://benevolent-magpie-921.eu-west-1.convex.cloud`, AWS `eu-west-1`)
- **Development Convex Deployment:** `prestigious-dragon-8` (`https://prestigious-dragon-8.eu-west-1.convex.cloud`, AWS `eu-west-1`)
- **TypeDB Cloud Cluster:** `https://teoxx0-0.cluster.typedb.com:80` (TypeDB `3.14.2`, TLS enabled)
  - **Production Graph Database:** `aci_macro_intelligence_prod`
  - **Staging / Test Graph Database:** `aci_macro_intelligence_staging`
- **Execution Authority:** `executionAuthority: "none"` (`LIVE_TRADING_ENABLED=false`, `DEMO_TRADING_ENABLED=false`)

---

## 1. Production Environment Audit

Every production connection was inspected and tested against live cloud endpoints rather than inferred from configuration files.

| Service ID | Service Name | Deployed Target / Endpoint | Classification | Last Verified (UTC) | Verification Evidence & Notes |
| --- | --- | --- | --- | --- | --- |
| `vercel_production` | Vercel Production Hosting | `https://capital.aiguides.co.uk` | **`connected`** | `2026-11-08T17:20:37Z` | Next.js `16.4.3` production build serving Command Centre (`/`) and Macro Data Room (`/data-room`) with server-side Convex & TypeDB Cloud gateways. |
| `clerk_production` | Clerk Authentication & Tenant Isolation | `clerk.capital.aiguides.co.uk` / `harmless-akita-9211.clerk.accounts.dev` | **`connected`** | `2026-11-08T17:20:37Z` | Owner token identifier (`https://harmless-akita-9211.clerk.accounts.dev\|user_3LjSsuJX398YIJRdss5Q7PqsSH9`) verified; RBAC and two-user isolation (`owner` vs `other`) enforced across all Convex queries/mutations and server routes. |
| `convex_production` | Convex Cloud Persistence & Scheduler | `benevolent-magpie-921.eu-west-1.convex.cloud` | **`connected`** | `2026-11-08T17:20:37Z` | Authoritative evidence store and unattended cloud cron (`remote-research-operations-cycle` every 15 minutes + `daily-morning-intelligence-briefing-0730-gmt`/`bst`) executing continuously in AWS `eu-west-1`. |
| `typedb_cloud` | TypeDB Cloud `3.14.2` Knowledge Graph | `https://teoxx0-0.cluster.typedb.com:80` (`aci_macro_intelligence_prod`) | **`connected`** | `2026-11-08T17:19:45Z` | Authenticated via `@typedb/driver-http@3.14.0` over TLS; `23/23` relationships and `31/31` evidential support links reconciled (`0` dead-letter, `0 ms` lag). Isolated from `aci_macro_intelligence_staging`. |
| `financial_collectors` | Deterministic Financial Collectors (SEC EDGAR + ECB FX + Nasdaq EOD) | `data.sec.gov` · `api.frankfurter.app` · `api.nasdaq.com` | **`connected`** | `2026-11-08T16:55:40Z` | SEC EDGAR XBRL collector (`6` primary facts promoted across `NVDA`, `MSFT`, `GOOGL`, `AMZN`, `INTC`, `AMD`), ECB USD/GBP (`0.74711`), and Nasdaq historical EOD (`32` delayed closes stored; never presented as live quotes). |
| `licensed_intraday_quotes` | Licensed Real-Time Intraday Quote Feed | `LICENSED_MARKET_DATA_API_KEY` | **`unavailable`** | — | Secret is not set in Convex Production or Vercel Production; system uses delayed EOD reference closes and blocks live quote presentation. Never displayed as green. |
| `remote_ai_models` | Remote AI Model Providers (Gemini / OpenAI / Anthropic) | `GEMINI_API_KEY` · `OPENAI_API_KEY` · `ANTHROPIC_API_KEY` | **`unavailable`** | — | Cloud LLM API keys are not set in Convex Production; `0` paid LLM calls have executed (`£0.00` cost). `news_discovery_agent` runs its deterministic SEC XBRL extractor fallback (`deterministic-sec-xbrl-extractor-v1`), and forward-study AI participants (`openai`, `anthropic`) record `status: "configuration_missing"`. Never displayed as green. |
| `trading212_readonly` | Trading 212 Read-Only Portfolio Integration | `live.trading212.com` (read-only account & positions) | **`configured_not_tested`** | — | AES-256-GCM broker vault and read-only sync routes (`lib/brokers/vault.ts`, `convex/brokers.ts`) are deployed and verified by automated suites, awaiting owner read-only API key entry in production (`brokerConnections` has `0` production rows). |
| `live_demo_execution` | Live & Demo Order Execution Authority | `LIVE_TRADING_ENABLED=false` · `DEMO_TRADING_ENABLED=false` | **`intentionally_disabled`** | `2026-11-08T17:20:37Z` | Hard-disabled across all cloud crons, research agents, and server routes (`executionAuthority: "none"`). |

---

## 2. Scheduled Execution Verification & Unattended Cloud Cycles

### 2.1 Production Job Status Summary (`benevolent-magpie-921`)

| Job Key | Schedule | Last Scheduled / Started (UTC) | Last Completed (UTC) | Duration | Outcome & Error | Records Processed (`sourcesAdded`) | Evidence Created / Skipped | Next Scheduled Run (UTC) | Data Freshness / Age | Provider / Model Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `market_data_collect` | Every 15m (`*/15 * * * *`) | `2026-11-08T16:55:22.591Z` | `2026-11-08T16:55:40.990Z` | `18,399 ms` | `succeeded:cursor_unchanged` (`errorCode: null`) | `468` cumulative (`9` in last run) | `32` EOD observations promoted (`32` duplicates skipped on unchanged session `2026-11-06`) | `2026-11-08T17:10:40.990Z` | **`fresh`** (`24m 56s`) | `£0.0000` (deterministic, `9` HTTP reqs) |
| `sec_filings_collect` | Hourly (`0 * * * *`) | `2026-11-08T16:25:22.550Z` | `2026-11-08T16:25:23.174Z` | `624 ms` | `succeeded:cursor_unchanged` (`errorCode: null`) | `126` cumulative (`6` in last run) | `6` primary SEC XBRL facts promoted (`6` skipped on unchanged accession cursor) | `2026-11-08T17:25:23.174Z` | **`fresh`** (`55m 13s`) | `£0.0000` (deterministic, `6` SEC header checks) |
| `news_discovery_agent` | Every 30m (`*/30 * * * *`) | `2026-11-08T16:55:41.024Z` | `2026-11-08T16:55:41.470Z` | `446 ms` | `succeeded:cursor_unchanged` (`errorCode: null`) | `6` cumulative (`0` new in last run) | `6` staged & promoted (`conditionalSkip: true` on unchanged upstream cursor) | `2026-11-08T17:25:41.470Z` | **`fresh`** (`24m 55s`) | `£0.0000` (`0` LLM calls; deterministic cursor check) |
| `portfolio_risk_refresh` | Hourly (`10 * * * *`) | `2026-11-08T16:55:41.552Z` | `2026-11-08T16:55:41.649Z` | `97 ms` | `succeeded` (`errorCode: null`) | `23` cumulative (`1` in last run) | `1` forward event registered (`forward-004-nvda-qqq-5d-2026-11-05`) | `2026-11-08T17:55:41.649Z` | **`fresh`** (`24m 55s`) | `£0.0000` (deterministic) |
| `daily_intelligence_briefing` | Weekdays `07:30 Europe/London` (`30 7 * * 1-5`) | `2026-11-07T15:29:42.034Z` | `2026-11-07T15:29:42.172Z` | `138 ms` | `succeeded` (`errorCode: null`) | `7` cumulative | `1` deduplicated UK briefing (`briefingDate: "2026-11-07"`) | `2026-11-09T07:30:00.000Z` | **`stale`** (`25h 50m` — prior UK date on Sunday) | `£0.0000` (deterministic) |
| `typedb_outbox_project` | Every 15m (Step 6 of cloud cycle) | `2026-11-08T17:19:34.000Z` | `2026-11-08T17:19:45.512Z` | `1,377 ms` | `succeeded` (`error: null`) | `23` outbox relationships | `23` projected into `aci_macro_intelligence_prod` (`23` deduplicated, `0` dead-letter) | `2026-11-08T17:25:22.000Z` | **`fresh`** (`0 ms` projection lag) | `£0.0000` (TypeDB Cloud Explore free tier) |

### 2.2 Unattended Cloud Cycles Verified (Local Dev Server Switched Off)

With no local `next dev` or `convex dev` process running, Convex Production (`benevolent-magpie-921`) executed three consecutive unattended cycles:

1. **Unattended Cycle A (`2026-11-08T15:55:22.552Z`, tick `1794153322552`):**
   - `cloud-market_data_collect-1794153322552`: `15,451 ms`, `9` provider requests, cursor `mkt:v4:nasdaq_public_historical:2026-11-06:...` unchanged, `32` duplicate observations skipped.
   - `cloud-news_discovery_agent-1794153322552`: `632 ms`, `6` upstream SEC checks, `conditionalSkip: true`, `0` model calls.
   - `cloud-portfolio_risk_refresh-1794153322552`: `102 ms`, verified `LIVE_TRADING_ENABLED=false`, `DEMO_TRADING_ENABLED=false`, `executionAuthority=none`.
2. **Unattended Cycle B (`2026-11-08T16:25:22.548Z`, tick `1794155122548`):**
   - `cloud-sec_filings_collect-1794155122548`: `624 ms`, `6` SEC EDGAR header checks across `AMD`, `AMZN`, `GOOGL`, `INTC`, `MSFT`, `NVDA`, cursor `sec:v2:AMD:10-Q:0000002488-26-000191|...` unchanged.
   - `cloud-market_data_collect-1794155122548`: `17,433 ms`, `9` provider requests, `32` duplicate observations skipped.
   - `cloud-news_discovery_agent-1794155122548`: `152 ms`, `conditionalSkip: true`, `0` model calls.
3. **Unattended Cycle C (`2026-11-08T16:55:22.550Z`, tick `1794156922550`):**
   - `cloud-market_data_collect-1794156922550`: `18,399 ms`, `9` provider requests, `2` completed research windows scored, `1` incomplete future window blocked.
   - `cloud-news_discovery_agent-1794156922550`: `446 ms`, `6` upstream checks, `conditionalSkip: true`, `0` model calls.
   - `cloud-portfolio_risk_refresh-1794156922550`: `97 ms`, verified execution safeguards and forward study state.

---

## 3. TypeDB Production Isolation, Reconciliation & Outage Recovery

### 3.1 Production vs Staging Database Separation
- **Convex Production (`benevolent-magpie-921`)** is configured with `TYPEDB_DATABASE=aci_macro_intelligence_prod`.
- **Convex Development (`prestigious-dragon-8`)** and all automated test suites (`tests/typedb-graph.test.ts`) target `aci_macro_intelligence_staging`.
- **Destructive Replay Guard (`assertCanRecreateTypeDbDatabase`)**: Calling `projectDatasetIntoLiveTypeDb(..., { recreateDatabase: true })` or `syncAndVerifyTypeDbCloud({ recreateDatabase: true })` against `aci_macro_intelligence_prod` throws:
  > `Security violation: destructive recreateDatabase is forbidden on production TypeDB database "aci_macro_intelligence_prod". Development/test replays may only recreate staging databases.`

### 3.2 Outbox-to-TypeDB Production Reconciliation (`npx convex run graph:reconcileAndVerifyProductionIsolationCloud '{}' --prod`)
- **Cluster Databases Present:** `["aci_macro_intelligence_prod", "aci_macro_intelligence_staging", "cti"]` (`productionDatabaseIsolated: true`)
- **Convex Production Outbox (`graphProjectionOutbox`):** `23` total items, `23` `projected`, `0` `pending`, `0` `retrying`, `0` `dead_letter`
- **Convex Production Checkpoint (`graphProjectionCheckpoints`):** `lastProjectedSequence: 23`, `lastProjectionKey: "proj:5c7d9964b99a25d6e501d5189d307ab115f6595a84de6da66b566ba2536587a9"`, `maxProjectionLagMs: 0`
- **Live TypeDB Cloud (`aci_macro_intelligence_prod`) Counts:**
  - `macro_relationship`: `23` (`missingInTypeDb: []`, `extraInTypeDb: []`)
  - `evidential_support`: `31` (exact match to `expectedEvidenceLinkCount: 31`)
  - `supersession_link`: `1` (`rel-anthropic-google-compute-v2` superseding `rel-anthropic-google-compute-v1`)
  - `organisation`: `18`, `infrastructure_project`: `13`, `financial_instrument`: `11`, `source_document`: `21`, `financial_observation`: `13`
  - **Reconciliation Verdict:** `reconciled: true`

### 3.3 Simulated Outage & Recovery Verification
- Simulated an unreachable TypeDB endpoint (`http://127.0.0.1:59999`) inside `reconcileAndVerifyProductionIsolationCloud`:
  - `executeWriteStatementsOnLiveServer` captured `HDR1: Cannot connect to any server` (`outageHandledGracefully: true`) without throwing an unhandled exception or interrupting Convex evidence collection.
  - Restoring the production TypeDB Cloud configuration (`https://teoxx0-0.cluster.typedb.com:80`) immediately recovered connectivity (`recoveredConnectionReachable: true`, `recoveryLatencyMs: 401 ms`) with `0` dead-letter items.

---

## 4. AI Agent vs Deterministic Collector Verification

| Workflow / Participant | Execution Mode | Configured Provider & Model Version | Latest Invocation Timestamp | Input Evidence Bundle Hash (`evidenceSha256`) | Token Usage & Cost | Failure Handling & Human Review |
| --- | --- | --- | --- | --- | --- | --- |
| `sec_filings_collect` | **Deterministic collector** (`usesAiModel: false`) | SEC EDGAR Submissions & XBRL API (`data.sec.gov`) | `2026-11-08T16:25:23.174Z` | Accession cursor `sec:v2:AMD:10-Q:0000002488-26-000191\|...` | `0` tokens · `£0.00` | Fails closed on HTTP/schema errors; primary SEC XBRL facts auto-promote with `serverReceivedAt`. |
| `market_data_collect` | **Deterministic collector** (`usesAiModel: false`) | Nasdaq Historical Close + ECB Frankfurter USD/GBP | `2026-11-08T16:55:40.990Z` | Cursor `mkt:v4:nasdaq_public_historical:2026-11-06:...` | `0` tokens · `£0.00` | Rejects live quote presentation for delayed closes; blocks incomplete outcome windows. |
| `portfolio_risk_refresh` | **Deterministic evaluator** (`usesAiModel: false`) | Deterministic policy & forward-study registrar | `2026-11-08T16:55:41.649Z` | `4f452e0d8a2acebb0460f28d689beb296cdf31ea48d31650a7ad3e20817fbb67` | `0` tokens · `£0.00` | Verifies `LIVE_TRADING_ENABLED=false` and `DEMO_TRADING_ENABLED=false` on every cycle. |
| `daily_intelligence_briefing` | **Deterministic generator** (`usesAiModel: false`) | `deterministic-cloud-briefing-v1` (`GEMINI_API_KEY` unset) | `2026-11-07T15:29:42.172Z` | — | `0` tokens · `£0.00` | Deduplicated per UK date (`Europe/London` GMT/BST); marked `stale` when `briefingDate !== ukDate`. |
| `news_discovery_agent` | **Hybrid AI / Deterministic fallback** (`usesAiModel: true`) | `GEMINI_API_KEY` **unconfigured in cloud** → ran `deterministic-sec-xbrl-extractor-v1` (initial run `1794065364212`) and `cursor-change-detector-v2 (0 model calls)` on subsequent runs | `2026-11-08T16:55:41.470Z` | Cursor `agent:v2:AMD:0000002488-26-000191\|...` | `0` input / `0` output tokens · Est. `£0.0000` / Actual `£0.0000` | Secondary/news claims remain `pending_verification` requiring human reviewer approval via `reviewAndPromoteRelationship`; prompt-injection strings are quarantined (`quarantined_injection`). |
| Forward Study Participant: `openai` | **Configured in code, never executed** | `gpt-4o-mini (unconfigured)` (`OPENAI_API_KEY` unset) | `2026-11-07T15:29:24.212Z` (recorded `configuration_missing`) | `4f452e0d8a2acebb0460f28d689beb296cdf31ea48d31650a7ad3e20817fbb67` | `0` tokens · `£0.00` (`unavailable; set OPENAI_API_KEY`) | Isolated from deterministic baselines; records `status: "configuration_missing"` without blocking the study. |
| Forward Study Participant: `anthropic` | **Configured in code, never executed** | `claude-3-5-sonnet-latest (unconfigured)` (`ANTHROPIC_API_KEY` unset) | `2026-11-07T15:29:24.212Z` (recorded `configuration_missing`) | `4f452e0d8a2acebb0460f28d689beb296cdf31ea48d31650a7ad3e20817fbb67` | `0` tokens · `£0.00` (`unavailable; set ANTHROPIC_API_KEY`) | Isolated from deterministic baselines; records `status: "configuration_missing"` without blocking the study. |
| Forward Study Baselines: `equal_weight_benchmark`, `momentum_sign_baseline`, `neutral_baseline` | **Deterministic baselines** | `equal-weight-qqq-v1`, `prior-session-sign-v1`, `neutral-abstention-v1` | `2026-11-07T15:29:24.212Z` | `4f452e0d8a2acebb0460f28d689beb296cdf31ea48d31650a7ad3e20817fbb67` | `0` tokens · `£0.00` | All 3 deterministic baselines succeeded and locked pre-cutoff forecasts against the SHA-256 evidence bundle. |

---

## 5. Authentication, Two-User Isolation & Brokerage Acceptance

1. **Clerk Production & Convex Owner Session:**
   - Verified owner identity `https://harmless-akita-9211.clerk.accounts.dev|user_3LjSsuJX398YIJRdss5Q7PqsSH9` and automated RBAC enforcement in `tests/clerk-convex-auth.test.ts`, `tests/roles-convex.test.ts`, and `tests/remote-ops-convex.test.ts`.
2. **Two-User Tenant Isolation (`owner` vs `other`):**
   - Verified across `operations:overview`, `graph:projectionHealth`, `brokers:overview`, and `trading:overview`: a second authenticated user (`other`) receives `0` runs, `null` checkpoint, `0` outbox items, and cannot read or mutate the owner's records.
   - Automated/model actors (`actorType: "agent"` / `"model"`) are blocked from `configureSettings`, `setJobEnabled`, `brokers:setAutoSync`, `trading:createDraft`, and `roles:assignReviewer`.
3. **Production Brokerage Status & Execution Safeguards:**
   - Production `brokerConnections` has `0` saved connections (`status: "configured_not_tested"` in the Environment Audit panel); the Command Centre honestly displays `No broker positions loaded — Nothing is shown as owned until Trading 212 reports it`.
   - `LIVE_TRADING_ENABLED=false`, `DEMO_TRADING_ENABLED=false`, and `executionAuthority: "none"` remain enforced across all environments.

---

## 6. Operations Dashboard Extensions (`components/command-centre/agent-operations-panel.tsx`)

Extended the existing `AgentOperationsPanel` (`#agent-operations`) without creating a duplicate page:
1. **TypeDB Graph Outbox & Production Isolation Strip (`data-testid="agent-ops-graph-projection"`):**
   - Displays active database (`aci_macro_intelligence_prod` — `production isolated`), reconciled outbox count (`23 projected · seq #23 · Reconciled`), projection lag (`0ms lag · 0 dead-letter · 0 pending`), human review count, and direct link to `/data-room`.
2. **Production Environment Connection Audit Grid (`data-testid="agent-ops-environment-audit"`):**
   - Renders all 9 production services with their exact status (`connected`, `configured_not_tested`, `degraded`, `unavailable`, `intentionally_disabled`).
   - Never renders green (`cc-ok`) for `unavailable` (`licensed_intraday_quotes`, `remote_ai_models`), `configured_not_tested` (`trading212_readonly`), or `intentionally_disabled` (`live_demo_execution`).
3. **Honest Staleness & Provider Status:**
   - `daily_intelligence_briefing` displays `Stale` (`cc-stale`) when `briefingDate` is from a prior UK date (`2026-11-07` on `2026-11-08`).
   - `antigravity_remote_agent` displays `unconfigured` (`cc-warn`) when cloud LLM keys are unset.
4. **Expandable Run Audit Trail (`data-testid="agent-ops-run-audit-trail"`):**
   - Provides expandable `<details data-testid="run-audit-<runId>">` rows for the most recent cloud executions showing start/finish timestamps, environment, cursor transition (`cursorBefore` → `cursorAfter`), records discovered/staged/promoted/skipped, HTTP request count, model/collector version, cost, and summary.

---

## 7. Operating Costs & Regression Verification

### 7.1 Actual Cloud Operating Costs
| Resource / Provider | Current Tier / Usage | Daily Cost (GBP) | Monthly Run-Rate (GBP) | Configured Ceiling |
| --- | --- | --- | --- | --- |
| **Convex Production (`benevolent-magpie-921`)** | 15m research cron + weekday briefing + TypeDB outbox sync | `£0.00` | `£0.00` (within included plan quota) | — |
| **TypeDB Cloud Explore (`teoxx0-0.cluster.typedb.com`)** | `3.14.2` (`aci_macro_intelligence_prod` + `aci_macro_intelligence_staging`) | `£0.00` | `£0.00` (Explore tier) | — |
| **SEC EDGAR (`data.sec.gov`) & ECB FX (`api.frankfurter.app`) & Nasdaq EOD** | Public primary regulatory & delayed reference feeds (`15` HTTP reqs / 15m cycle) | `£0.00` | `£0.00` | — |
| **Remote AI Models (`Gemini` / `OpenAI` / `Anthropic`)** | `0` invocations (API keys unconfigured; deterministic fallback + cursor skip active) | `£0.0000` | `£0.0000` | `£2.00 / day` · `£25.00 / month` |

### 7.2 Regression Suite Verification
- **TypeScript (`npm run typecheck`):** PASS (`0` errors)
- **Vitest (`npm test`):** PASS (all 48 test files including `typedb-graph.test.ts`, `remote-ops-convex.test.ts`, `remote-ops-staging.test.ts`, `remote-ops-server-security.test.ts`)
- **Python (`npm run test:python`):** PASS (`219/219` unit tests)
- **Browser Acceptance (`scripts/command-centre-browser-check.mjs` & `scripts/data-room-browser-check.mjs`):** PASS across desktop (`1440×1000`, `1920×1000`) and mobile (`390×1000`, `412×915`, `768×1000`) viewports with zero horizontal overflow and zero console errors.
