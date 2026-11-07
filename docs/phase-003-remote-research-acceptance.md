# AI Capital Intelligence — Phase 003: Remote Research Operations Acceptance Report

## 1. Executive Summary

Phase 003 integrates **Google Antigravity Remote Agents** and persistent unattended research operations into the AI Capital Intelligence architecture (`Next.js 15`, `Clerk`, `Convex`, and `Python 3.13` worker) so that financial news discovery, SEC disclosure tracking, market-data freshness monitoring, portfolio risk refreshes, and the weekday 07:30 `Europe/London` Morning Intelligence Brief operate without the user's laptop remaining powered on.

All existing research, broker, role, audit, and execution safeguards remain strictly enforced:
- `LIVE_TRADING_ENABLED` and `DEMO_TRADING_ENABLED` remain unset (`false`).
- Remote agents authenticate exclusively with a dedicated least-privilege staging token (`RESEARCH_STAGING_TOKEN`) and never receive Trading 212 API credentials, broker vault encryption keys (`BROKER_VAULT_KEY_B64`), Convex broker admin keys (`CONVEX_BROKER_ADMIN_KEY`), Clerk session credentials, reviewer/administrator roles, or order-submission permissions.
- Deterministic collectors (`market_data_collect`, `sec_filings_monitor`, `trading212_sync_health`, `portfolio_risk_refresh`) are strictly separated from AI research agents (`news_discovery_agent`, `daily_intelligence_briefing`).

---

## 2. Deliverables Matrix

| # | Deliverable | Implementation Paths | Verification Status |
| --- | --- | --- | --- |
| 1 | Remote project setup guide | `docs/remote-project-setup.md`, `.gitignore`, `.env.example`, `config/antigravity/remote-project.json`, `.agents/rules/remote-research-safety.md`, `.agents/skills/remote-research-agent/SKILL.md` | Verified (`git status --ignored` confirms `.env.local` and credentials excluded) |
| 2 | Secure research-staging API | `app/api/research/staging/route.ts`, `lib/remote-ops/server.ts`, `lib/remote-ops/staging-validator.ts`, `convex/operations.ts`, `convex/operationsValidators.ts`, `convex/schema.ts` | Verified (`tests/remote-ops-server-security.test.ts`, `tests/remote-ops-convex.test.ts`) |
| 3 | Persistent scheduling implementation | `app/api/operations/scheduled/route.ts`, `app/api/operations/settings/route.ts`, `.github/workflows/remote-research-operations.yml`, `config/antigravity/sidecars/aci-news-research/sidecar.json`, `config/antigravity/sidecars/aci-morning-brief/sidecar.json` | Verified (lease locking, idempotency keys, local vs remote de-duplication) |
| 4 | Working news research agent | `lib/remote-ops/news-agent.ts`, `worker/remote_research.py`, `worker/test_remote_research.py` | Verified (10-step workflow parity between TypeScript and Python) |
| 5 | Market-data collection health monitor | `lib/remote-ops/health-monitor.ts` | Verified (freshness tracking, delayed-price badge enforcement) |
| 6 | Daily briefing generator | `lib/remote-ops/morning-briefing.ts`, `convex/operations.ts` (`morningBriefings` table) | Verified (strict 4-part separation: confirmed facts, research interpretation, risk changes, incomplete evidence) |
| 7 | Agent activity and cost monitoring | `components/command-centre/agent-operations-panel.tsx`, `components/command-centre/morning-brief-panel.tsx`, `components/command-centre/command-centre.tsx`, `lib/portfolio/research-feed.ts` | Verified (Playwright browser checks at `390`, `768`, `1440`, `1920` px) |
| 8 | Acceptance report | `docs/phase-003-remote-research-acceptance.md` | Verified |

---

## 3. Acceptance Criteria Verification (Section 9)

| # | Acceptance Requirement | Test / Verification Coverage | Result |
| --- | --- | --- | --- |
| 1 | Research jobs continue when the local development server is off | `tests/remote-ops-convex.test.ts` (`continues unattended research staging & promotion when no browser session is active`) + `.github/workflows/remote-research-operations.yml` + `POST /api/operations/scheduled` | **PASS** |
| 2 | Duplicate articles and duplicate financial facts are rejected or merged cleanly | `tests/remote-ops-staging.test.ts` (`deduplicates previously processed URLs, content hashes and duplicate financial facts`) + `worker/test_remote_research.py` (`test_deduplication_and_primary_source_promotion`) | **PASS** |
| 3 | Untrusted article instructions cannot alter permissions, schedules, broker settings or trading controls | `tests/remote-ops-staging.test.ts` (`treats untrusted webpages and articles as data and quarantines prompt-injection attempts`) + `tests/remote-ops-convex.test.ts` (`forbids remote agents and models from changing operations settings, broker sync, roles or trading controls`) | **PASS** |
| 4 | Unverified claims do not enter the evidence store as confirmed facts | `tests/remote-ops-staging.test.ts` (`promotes only primary-source-backed observed/reported claims and holds secondary or unverified claims pending`) + `tests/remote-ops-convex.test.ts` | **PASS** |
| 5 | Delayed prices are never presented as live prices | `tests/remote-ops-staging.test.ts` (`prevents delayed prices from ever being presented as live quotes and monitors collection health`) + `worker/test_remote_research.py` (`test_delayed_prices_cannot_be_presented_as_live_quotes`) | **PASS** |
| 6 | Missing sources and provider outages are surfaced clearly | `lib/remote-ops/health-monitor.ts` (`evaluateCollectionHealth`) + `components/command-centre/agent-operations-panel.tsx` + `components/command-centre/morning-brief-panel.tsx` (`incompleteEvidence` section) | **PASS** |
| 7 | Model failures do not stop deterministic market-data or filing collection | `tests/remote-ops-server-security.test.ts` (`keeps deterministic market-data, filing, risk and briefing jobs running when AI models fail`) + `tests/remote-ops-convex.test.ts` (`enforces cost ceilings on AI agent jobs while deterministic market-data collectors continue unaffected`) | **PASS** |
| 8 | All runs have timestamps, source URLs, hashes and status records | `convex/operations.ts` (`submitStagedResearchInternal`, `recordDeterministicRunInternal`) + `researchStagingItems` & `researchJobRuns` schema | **PASS** |
| 9 | Broker credentials and encryption keys remain outside the remote agent environment | `tests/remote-ops-server-security.test.ts` (`contains zero references to broker vault keys, broker admin keys or order submission in remote-ops modules`) + `worker/test_remote_research.py` (`test_least_privilege_refuses_broker_or_trading_secrets`) | **PASS** |
| 10 | Live and Demo trading remain unchanged unless separately authorised | `process.env.LIVE_TRADING_ENABLED` and `process.env.DEMO_TRADING_ENABLED` unset; `execution-widget` verified in browser check (`Live submission: disabled`) | **PASS** |
| 11 | All TypeScript, Convex, Python and browser checks pass | `npm run typecheck` (0 errors), `npm test` (45 files, 426 passed), `npm run test:python` (215 passed), browser suite passed at `390/768/1440/1920` px | **PASS** |

---

## 4. Remaining Limitations & Operational Notes

1. **Licensed Intraday Equity & Index Quote Feed**:
   - No commercial real-time equity/index quote license is currently provisioned. The `market_data_collect` collector and `Agent Operations` panel explicitly surface this gap as `degraded` (`Licensed intraday equity & index quote feed not yet configured`), and `validatePricePresentation` blocks delayed EOD reference closes from ever displaying as live quotes.
2. **External GitHub Remote Push & Secrets Configuration**:
   - The local Git repository has been initialized on branch `main` with a hardened `.gitignore` that excludes `.env.local`, `.env.test.local`, `.tmp/`, and all secret patterns.
   - To activate the hosted GitHub Actions scheduler (`.github/workflows/remote-research-operations.yml`) and connect the cloud Antigravity Remote Project (`config/antigravity/remote-project.json`), push the repository to a private GitHub remote and configure the repository secrets listed in `docs/remote-project-setup.md` (`RESEARCH_STAGING_URL`, `RESEARCH_STAGING_TOKEN`, `OPERATIONS_SCHEDULER_SECRET`, `SEC_USER_AGENT`, `GEMINI_API_KEY`).
3. **Human-Only Governance & Execution Controls**:
   - Remote agents operate under `actorType: 'agent'` / `executionAuthority: 'none'`. Promoting `pending_verification` secondary claims, altering cost ceilings, toggling `activeEnvironment`, or enabling Demo/Live trading requires explicit authenticated human owner action.
