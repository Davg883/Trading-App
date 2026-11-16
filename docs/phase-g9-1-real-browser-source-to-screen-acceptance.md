# AI Capital Intelligence — Sprint G9.1: Real Browser & Source-to-Screen Acceptance

**Document Reference:** `docs/phase-g9-1-real-browser-source-to-screen-acceptance.md`
**Release candidate:** commit `9e58c85` on `verify/combined-release-candidate`
**Vercel Preview under test:** `https://trading-lv5p4xqku-david-grannums-projects.vercel.app` (deployment `dpl_GjznQxk6QqJ3uPv3u3bGVY5dBVto`, created 2026-11-15 17:26:12 UTC, matched to `9e58c85` with `vercel ls -m githubCommitSha=…`)
**Backend used by that preview:** Convex dev deployment `prestigious-dragon-8` (eu-west-1); Clerk development instances (see §2)
**Production:** `https://capital.aiguides.co.uk` / Convex `benevolent-magpie-921` — **unchanged**; used only for "before" screenshots
**Execution authority:** `none` throughout (no orders, no credentials entered, no production or WAF changes)
**Assessment window:** 2026-11-15 17:50 UTC → 2026-11-16 11:15 UTC

---

## 1. Executive summary and release recommendation

**Recommendation: DO NOT release `9e58c85` to production yet.**

The Next.js side of the release candidate behaves as specified: the Market Radar, `/stress` and `/settings/brokers` render the persisted 2026-11-13 closes and the separate Live/Demo badges exactly as stored in Convex, state survives refresh and navigation, and every automated suite passes. The blockers are in the environment and in the data behind the screens, not in the page code:

1. **The Vercel Preview is unreachable to any browser or API client.** Every route, including `/api/*`, answers `302 → https://vercel.com/sso-api` (Vercel Deployment Protection). Real-browser acceptance against the preview is therefore **BLOCKED** pending an owner action (§3.1). All browser evidence in this report comes from a local production build of the exact commit (`next build` + `next start` of a detached worktree at `9e58c85`) pointed at the same Convex dev deployment and Clerk development keys. It is labelled **"local RC"** everywhere.
2. **The Convex functions on `prestigious-dragon-8` were never redeployed with `9e58c85`.** The Vercel build command is plain `next build` (no `convex deploy`), no `npx convex dev` process was running, and the persisted data proves it: the SEC facts staged at 2026-11-15 16:49:21 UTC are exactly what the *pre-G9* selector produces on today's EDGAR data (§3.6). The preview is new UI on old backend logic.
3. **Defective SEC capex facts are persisted, promoted and in the 2026-11-15 morning briefing**: NVIDIA "Q2 2020 (YTD) $0.37B" (from a 2020 accession, attached to the 2026 10-Q URL) and Amazon "Q1 2017 $4.9B". The fixed selector cannot self-heal them because the agent skips filing URLs it has already staged.
4. **Clerk issuer mismatch on the preview backend.** The Convex dev deployment accepts only `https://complete-bunny-8662.clerk.accounts.dev`, but `RESEARCH_OWNER_ID` and every owner record (broker connections, schedules, observations, staging items) belong to `https://harmless-akita-9211.clerk.accounts.dev|user_3LjSsuJX398YIJRdss5Q7PqsSH9`. A harmless-akita session is rejected outright (`No auth provider found matching the given token` → `503 storage_unavailable` on `/api/brokers`); a complete-bunny session would see an empty account. Either way the owner's Live Trading 212 connection cannot be exercised on this backend.
5. **Cloud collection is switched off on the dev deployment** (`RESEARCH_SCHEDULER_ENV=disabled`): the 15-minute cron returns `scheduler_env_disabled…`; the only runs on 2026-11-15 (16:49 and 17:23 UTC) were on-demand, nothing has run since, and the 2026-11-16 07:30 UTC briefing did not execute. Despite this, the signed-in health panel and `/workspace` report "Scheduler working — Convex cloud cron (remote) active" and "15-minute unattended cloud scheduler verified" (§3.1b).
6. **The Preview environment has no broker vault key** (`BROKER_VAULT_KEY_B64` exists only in Production), so `/settings/brokers` reports `brokerStorageReady:false` and no save/test/sync can run there at all.
7. **The newest morning briefing is never shown on Market Radar.** The page reads `publicOperationsOverview`, which omits `latestBriefing`, so even the signed-in owner sees the bundled 2026-11-05 record while the 2026-11-15 briefing sits in Convex.

### Status matrix

| # | Check | Status | Summary |
| :- | :- | :-: | :- |
| 1 | Interactive browser tests on the Vercel Preview, Clerk sign-in, two-user isolation | **PARTIAL** (preview, signed-out flows after the owner's Vercel login in the pane; see §3.1a) / **PARTIAL** (local RC) | Preview 302s to Vercel SSO for every non-pane client. Signed-out preview flows PASS and match the local RC. Local RC: dedicated test user signed in by one-time ticket; isolation held only as a fail-closed token rejection (issuer mismatch). Owner sign-in on the preview still outstanding. |
| 2 | `/settings/brokers` Live vs Demo; manual read-only T212 sync | **PASS** (rendering, persistence) / **FAIL** (sync on this preview) | Live and Demo are separate records and separate badges. On the preview the signed-in owner is a different Clerk principal with no connection, and `BROKER_VAULT_KEY_B64` is missing from the Preview environment (`brokerStorageReady:false`), so the sync cannot be exercised (§3.1b). |
| 3 | `brokerSyncSchedules` opt-in | **PASS with WARNING** | Not silently enabled: the one schedule was opted in by the owner on 2026-11-06 15:33:41 UTC. It is dormant: last run 2026-11-06 15:33:55 UTC, next run due 2026-11-06 15:48:55 UTC, no scheduler configured. |
| 4 | News Tracker: latest five stories, `conditionalSkip=true` | **PASS** (skip is legitimate) / **FAIL** (ingestion defect, see #6) / **BLOCKED** (owner UI) | Five latest staged items listed in §3.4. `conditionalSkip=true` at 17:23:40 UTC = 16 provider requests, identical accession cursor, zero candidates. Scheduler now disabled. |
| 5 | 2026-11-13 closes on Market Radar vs `/stress` vs Convex | **PASS** | 8 symbols agree to the cent; provenance `nasdaq_public_historical`, unadjusted, FX 0.75605 (ECB 2026-11-13); drawdowns gated `LICENCE_REQUIRED`. |
| 6 | SEC current-period capex for AMZN and NVDA | **PASS** (code) / **FAIL** (persisted data) | Committed selector picks AMZN Q3 2026 $77.26B and NVDA FY27 Q2 YTD $4.43B from the current 10-Qs. Convex holds Q1 2017 / Q2 2020 values. |
| 7 | Refresh/navigation preserve latest snapshots; no 2026-11-04 fallback | **PASS** (market/stress snapshots) / **FAIL** (briefing panel) | Stable across 3 reloads and away/back navigation on both the local RC and the preview; heading "Research as of 2026-11-13". But the Market Radar briefing panel shows the bundled 2026-11-05 record (facts dated 2026-11-04) to every viewer, including the signed-in owner, while a 2026-11-15 briefing exists in Convex (§3.1b). Historical as-of cases not browser-verified. |
| 8 | Screenshots, timestamps, API outcomes | **DELIVERED** | `docs/screenshots/sprint-g9-1-*.png`, this document. |
| 9 | Lint, TypeScript, Convex, Vitest, Python, build | **PASS** | 0 lint errors (19 warnings), `tsc` clean, Convex `tsc` clean, Vitest 793 tests (4 load-related 5 s timeouts, all pass in isolation), Python 219 OK, `next build` of `9e58c85` OK. No fixes were applied. |
| 10 | Production release recommendation | **NOT READY** | See blockers above and §4. |

---

## 2. Environment facts established

| Item | Value | Evidence |
| :- | :- | :- |
| Preview deployment | `trading-lv5p4xqku…vercel.app`, Ready, Preview, created 2026-11-15 17:26:12 UTC | `vercel ls`, `vercel inspect`, `vercel ls -m githubCommitSha=9e58c85be3e73773985a5a975bb28da479289853` |
| Preview protection | `302 Found` → `https://vercel.com/sso-api?url=…&nonce=…`, `Set-Cookie: _vercel_sso_nonce`, `X-Robots-Tag: noindex` on `/`, `/settings/brokers`, `/stress`, `/api/brokers` | `curl -D -` at 2026-11-15 17:54 UTC |
| Vercel build command | `next build` (Framework preset Next.js, Node 26.x); no `convex deploy` | `vercel project inspect trading-app` |
| Preview env (names) | `NEXT_PUBLIC_CONVEX_URL=https://prestigiou…`, `CONVEX_HTTP_ACTIONS_URL`, `CLERK_JWT_ISSUER_DOMAIN` (encrypted), `CONVEX_DEPLOY_KEY` (Preview), no `BROKER_SCHEDULER_SECRET`, no `VERCEL_AUTOMATION_BYPASS_SECRET` | `vercel env ls preview` |
| Convex dev env | `CLERK_JWT_ISSUER_DOMAIN=https://complete-bunny-8662.clerk.accounts.dev`; `CLERK_ALLOWED_AZP_ORIGINS=http://localhost:3000,https://trading-lv5p4xqku…,https://trading-k0a509nbc…,https://trading-app-git-verify-combined-release-candidate…`; `RESEARCH_OWNER_ID=https://harmless-akita-9211.clerk.accounts.dev\|user_3LjSsuJX398YIJRdss5Q7PqsSH9`; `RESEARCH_SCHEDULER_ENV=disabled` | `npx convex env list --include-values` (dev:prestigious-dragon-8) |
| Local `.env.local` | Clerk publishable key decodes to `harmless-akita-9211.clerk.accounts.dev`; `CLERK_JWT_ISSUER_DOMAIN=https://harmless-akita-9211…`; `CONVEX_DEPLOYMENT=dev:prestigious-dragon-8` | file inspection (values not reproduced) |
| Working tree vs RC | Uncommitted edits exist in `convex/authz.ts` and `lib/clerk-convex-auth.ts` (configured `CLERK_ALLOWED_AZP_ORIGINS` now *replaces* the default list instead of extending it), `lib/research-ratings/sec-xbrl-expansion.ts` (typing), two tests, and four components (timestamp helpers). They are **not** in `9e58c85` and were not tested as part of the RC. | `git diff --stat` |

---

## 3. Check-by-check evidence

### 3.1 Check 1 — Interactive browser tests, Clerk sign-in, two-user isolation

**Vercel Preview: BLOCKED.** Deployment Protection intercepts every request before Next.js runs, so neither the built-in browser pane (which landed on `vercel.com`), Playwright, nor curl can reach the application. Authentication was not bypassed.

**Exact owner action required (any one of):**
1. Vercel → project `trading-app` → *Settings → Deployment Protection* → set **Vercel Authentication** to *Only Production Deployments* (or *Disabled*) for the duration of acceptance; or
2. enable **Protection Bypass for Automation** there and provide the generated secret so requests can carry `x-vercel-protection-bypass`; or
3. sign in to `vercel.com` inside the Claude browser pane (the pane keeps its own cookies) so the SSO redirect completes, then say so.

**Local RC (stand-in):** worktree at `9e58c85`, `npm ci`, `npx next build` (exit 0), `npx next start … -p 3000`, `.env.local` copied. Script: `scripts/sprint-g9-1-browser-acceptance.mjs` (Playwright, Edge channel, 1440×1000, full-page screenshots). Run 2026-11-15 18:15:22–18:16:33 UTC; `pageErrors: []`.

- **Anonymous flows:** PASS (see §3.5, §3.7).
- **User B (dedicated Clerk development test user `aci-ui-layout-test`, `user_3LjpVqVwcwziWWGKnQSiIQRyRtG`):** signed in through a server-minted single-use ticket (`POST /v1/sign_in_tokens`, 900 s expiry, file deleted after use; no credential typed). `Clerk.user.externalId === 'aci-ui-layout-test'` confirmed. `/settings/brokers` showed **Live: Not connected · Demo: Not connected**; `/` showed `kpi-empty` "No account data yet … Connect Trading 212 →" with `data-source="broker"` and no fixture styling. Signed out at the end.
- **Cross-owner probes as User B** against the owner's live connection id `j9743vsaryk8tpe6qgbd53z24n8hqy8p`: `GET /api/brokers?connectionId=…` → `503 {"code":"storage_unavailable"}`; `POST /api/brokers/sync` → `503 {"code":"not_configured"}`. No owner data leaked. **Caveat:** these were fail-closed responses caused by the issuer mismatch (browser console: `Failed to authenticate: "No auth provider found matching the given token … [OIDC(domain=https://complete-bunny-8662.clerk.accounts.dev …`), so they prove rejection of the whole session rather than per-owner authorisation. Per-owner isolation is covered by Vitest `sprint-g9 … 9. Cross-user isolation` (passes: owner B sees 0 connections, `detail` throws `Connection unavailable`).
- **User A (owner):** not performed. The owner must sign in themselves; no sign-in token was minted for the owner's account.

### 3.1a Preview re-test after the owner signed in to Vercel (2026-11-16 10:46–10:50 UTC)

Once the owner completed the Vercel SSO login inside the Claude browser pane, the preview `trading-lv5p4xqku…` became reachable *from that pane only* (curl and Playwright still receive the 302, so the Playwright script could not be re-run; evidence below was read from the live DOM with the pane's JavaScript tool, and the pane's own screenshots are low resolution because the pane was scaled down).

- **Clerk instance on the preview:** `Clerk.frontendApi === 'complete-bunny-8662.clerk.accounts.dev'` (publishable key decodes to the same host). This **matches** the Convex dev deployment's `CLERK_JWT_ISSUER_DOMAIN`, so sessions created on the preview are accepted by Convex. It does **not** match the identity that owns every stored record (`https://harmless-akita-9211.clerk.accounts.dev|user_3LjSsuJX398YIJRdss5Q7PqsSH9`), so an owner signed in on the preview is a different Convex principal and will see no broker connection, schedule or private staging data until those rows are migrated or `RESEARCH_OWNER_ID`/issuer are realigned.
- **Market Radar (signed out):** identical to the local RC — `Research as of 2026-11-13`; "Market observation as of 2026-11-13 · Fundamental & graph cut-off: 2026-11-04"; provenance pill "Persisted EOD observations + deterministic SEC/TypeDB synthesis (live LLM inference NOT IMPLEMENTED)"; "Last refreshed 2026-11-05 14:57 UTC" (static fallback, see §3.7); all seven watchlist rows show the 2026-11-13 closes and GBP values listed in §3.5 with FX 0.7560; no "1D" label; `data-source="broker"`; KPI strip "Signed out — Sign in to see capital, P/L and cash. Nothing is estimated in the meantime."; no console errors.
- **`/stress` (signed out):** identical to the local RC — banner "Convex delayed EOD reference closes connected (8 symbols); licensed split-adjusted drawdown feed unconfigured (LICENCE_REQUIRED)", six rows with `USD <close> (EOD ref) 2026-11-13 · unadjusted close (corporateActionsReviewed=false)` and every window cell "Unavailable — Split-adjusted series & verified calendar required (LICENCE_REQUIRED)".
- **`/settings/brokers` (signed out):** `Live: Not connected` and `Demo: Not connected` badges rendered independently; "Sign in to save encrypted credentials and view your private account."
- **Refresh/navigation persistence:** three consecutive loads of `/` and a `/stress` → back navigation all returned `Research as of 2026-11-13` with the same as-of string; no 2026-11-04 fallback. **PASS on the preview.**
### 3.1b Preview, owner signed in through Clerk in the pane (2026-11-16 11:31–11:35 UTC)

The owner signed in on the preview; Clerk reported `user_3MBf3i3DwR8wReuh0KNUvs1x7iS` on `complete-bunny-8662`, a different principal from the harmless-akita identity that owns the stored data.

- **`/settings/brokers` (owner):** `Live: Not connected`, `Demo: Not connected`. `GET /api/brokers` → `200 {"connections":[],"schedules":[],"diagnostics":{"authenticationConfigured":true,"vaultKeyPresent":false,"vaultKeyVersionPresent":true,"vaultKeyFormatValid":false,"vaultSelfTestPassed":false,"convexReachable":true,"clerkAuthenticationValid":true,"ownerAuthorised":true,"brokerStorageReady":false}}`. Two independent reasons the Live sync cannot run on the preview: the principal owns no connection, and **`BROKER_VAULT_KEY_B64` is absent from the Preview environment** (it exists only in Production), so the vault self-test fails and save/test/sync are disabled. `/workspace` states the same: "Trading 212 · read-only broker vault — Not configured … awaiting 32-byte AES-256-GCM vault key". **Check 2 manual sync: FAIL on this preview as configured** (not merely blocked).
- **Market Radar (owner):** `kpi-empty` "No account data yet — Connect and synchronise Trading 212 (read-only)"; alert `noconn` "No broker connection. No live Trading 212 connection saved."; "Last Broker Sync: Not yet synchronised"; heading and as-of strings unchanged from the signed-out view.
- **Morning intelligence brief panel (owner):** "Morning intelligence brief (2026-11-05) … generated 2026-11-05 14:57 UTC", confirmed facts "QQQ reference_close (2026-11-04): $691.95" and "US-GRID enacted restrictions", interpretation "model: gemini-2.5-flash-preview". This is the bundled fixture, not the 2026-11-15 16:49:21 UTC briefing stored in Convex. The page builds the panel from `publicOperationsOverview`, which never returns `latestBriefing`, so **no viewer, signed in or not, sees the newest briefing on Market Radar** — the obsolete 2026-11-04/05 briefing is still presented while newer approved evidence exists. **Check 7 briefing component: FAIL** (market and stress snapshots themselves PASS).
- **Agent operations & collection health panel (owner):** "System status: Enabled (unattended)", "Scheduler working — Convex cloud cron (remote) active", "All 5 scheduled collector(s) completed without error", per-job freshness `Delayed` ×4 and `Stale` (briefing), last successful runs 2026-11-15 17:23 UTC "18 h ago", next scheduled runs 2026-11-15 17:38 / 17:53 / 18:23 UTC and 2026-11-16 07:30 UTC — all already in the past. News agent row: "10 sources · 10 promoted · 0 reqs · cursor unchanged (0 model calls)"; pending verification "0 staged items". `/workspace` adds "Convex · Checkpoint: 99 promoted facts · 72 EOD observations · 5/5 cloud schedules enabled — 15-minute unattended cloud scheduler verified" and "Morning briefing · Connected but stale · Checkpoint: Briefing 2026-11-16 (0 confirmed facts)". Convex confirms **no run and no briefing after 2026-11-15 17:23:41 UTC** (latest `morningBriefings` row is 2026-11-15; the 2026-11-16 07:30 UTC weekday briefing did not execute) because `RESEARCH_SCHEDULER_ENV=disabled` makes every cron cycle return `scheduler_env_disabled…`. **The health panel reports an active, verified scheduler from job configuration alone, not from observed cron execution** — a reporting defect to fix before release.
- **News Tracker visibility (owner):** individual staged stories are not rendered on Market Radar; they are only available through the private `overview` query, which this principal cannot see because the staged rows belong to the harmless-akita owner. The five stories in §3.4 are therefore verified from Convex only.
- **Two-user isolation on the preview:** the complete-bunny owner principal received an empty connection list and no harmless-akita records (`connections: []`, `schedules: []`, 0 staged items) — a clean per-owner separation at the application layer, this time with a valid, accepted session rather than a rejected token.

### 3.2 Check 2 — `/settings/brokers`: Live identified separately from Demo; manual sync

**Persisted state (Convex export 2026-11-15 17:59 UTC, `brokerConnections`, owner `…user_3LjSsuJX398YIJRdss5Q7PqsSH9`):**

| Environment | Status | Key id | Last attempt | Last verified | Last successful sync | Error |
| :- | :- | :- | :- | :- | :- | :- |
| live | connected | `••••FVft` | 2026-11-06 15:33:55.106 UTC | 2026-11-06 15:33:55.672 UTC | 2026-11-06 15:33:55.672 UTC | — |
| demo | error | `••••FVft` | 2026-11-06 15:09:49.858 UTC | — | — | `invalid_credentials` |

`brokerSnapshots`: one live `sync` snapshot, revision 3, retrieved 2026-11-06 15:33:55.672 UTC, summary retrieved 15:33:55.226 UTC, £250.00 GBP total, 0 positions, 1 cash transaction, no history error. `accountValuations`: live £250.00 at 15:31:14 and 15:33:55 UTC on 2026-11-06.

**Rendering (local RC, anonymous):** the new `broker-env-overview` renders two independent badges, `Live: Not connected` and `Demo: Not connected`, before sign-in; the environment selector and copy state "Demo and Live are separate connections". Both environment badges are driven by separate records (`liveConn`/`demoConn` in `components/broker-settings.tsx`), and the same key being saved for both environments is the exact condition the demo `invalid_credentials` error reflects (`same-key-warning` exists in `broker-sync-panel.tsx`). **PASS** for separation.

**Manual synchronisation: BLOCKED.** `/api/brokers/sync` requires a same-origin signed-in session, and the only stored credentials belong to the harmless-akita owner identity, which the Convex dev deployment currently rejects. The agreement check (provider result ↔ Convex `brokerSnapshots.retrievedAt` ↔ `brokerConnections.lastSuccessfulSyncAt` ↔ Market Radar `broker-last-sync-pill`) could therefore not be executed. The last persisted sync is 9 days old (freshness threshold 15 minutes), so the Market Radar would correctly report the Live snapshot as **STALE** (`evaluateBrokerConnectionSourceHealth`, Vitest G9 test 2).

### 3.3 Check 3 — `brokerSyncSchedules`

Single row (export 2026-11-15 17:59 UTC):

```
environment=live  enabled=true  intervalMinutes=15
optedInAt=2026-11-06T15:33:41.405Z  updatedAt=2026-11-06T15:33:55.836Z
lastRunAt=2026-11-06T15:33:55.836Z  lastOutcome=synchronised
nextRunAt=2026-11-06T15:48:55.836Z  claimedUntil=0  consecutiveFailures=0  pausedReason=null
```

- **Not silently enabled:** rows are created only by `brokers:setAutoSync` from `POST /api/brokers/schedule`, which the owner reaches through the "Turn automatic sync on" button; the panel copy states "Automatic synchronisation is off until you turn it on". The row carries the owner's explicit `optedInAt`.
- **But dormant:** `nextRunAt` has been overdue since 2026-11-06 15:48 UTC. Execution paths are (a) the dashboard heartbeat `POST /api/brokers/auto-sync` (runs only while a signed-in dashboard tab is open) and (b) `POST /api/brokers/scheduled`, bearer-authenticated with `BROKER_SCHEDULER_SECRET`, which is **not set** in any Vercel environment and has no cron. The UI labels this honestly ("Due now (runs while the dashboard is open or by the scheduler)").

**Opt-in process (as implemented):** sign in → `/settings/brokers` → save a read-only key for the environment → in *Saved connections and automatic synchronisation* choose an interval (5/15/30/60/240 min) → *Turn automatic sync on* → `brokerSyncSchedules` row inserted with `enabled=true`; *Turn automatic sync off* sets `enabled=false`; deleting the connection deletes the schedule. Runs respect the per-account lease, cooldown and Trading 212 rate limits; outcomes are recorded in `lastOutcome`/`pausedReason`.

### 3.4 Check 4 — News Tracker

**Latest five staged stories** (`researchStagingItems`, owner rows, newest first; all `validationStatus=promoted`, `isPrimarySource=true`, agent `convex-cloud-remote-agent` unless noted):

| # | Title / claim | Source URL | Published | Source retrieved | Server received / ingested | Promoted |
| :- | :- | :- | :- | :- | :- | :- |
| 1 | NVIDIA 10-Q (0001045810-**20-000147**) — Q2 2020 (YTD): NVDA capex **0.37 bn USD, period Q22020** ⚠ | `…/1045810/000104581026000075/nvda-20260726.htm` | 2026-08-26 20:36:00 UTC | 2026-11-15 16:49:03.134 UTC | 2026-11-15 16:49:21.404 UTC | yes → evidence `md7ccmyj…` |
| 2 | Alphabet 10-Q (0001652044-26-000084) — Q3 2026 (YTD): GOOGL capex 131.95 bn USD | `…/1652044/000165204426000084/goog-20260930.htm` | 2026-10-29 00:29:06 UTC | 2026-11-15 16:49:03.134 UTC | 2026-11-15 16:49:21.404 UTC | yes |
| 3 | CoreWeave 10-Q (0001769628-26-000465) — Q3 2026 (YTD): CRWV capex 23.56 bn USD | `…/1769628/000176962826000465/crwv-20260930.htm` | 2026-11-12 12:20:41 UTC | 2026-11-15 16:49:03.134 UTC | 2026-11-15 16:49:21.404 UTC | yes |
| 4 | Microsoft 10-Q (0001193125-26-436133) — Q1 2027: MSFT capex 39.37 bn USD | `…/789019/000119312526436133/msft-20260930.htm` | 2026-10-28 20:07:39 UTC | 2026-11-15 16:49:03.134 UTC | 2026-11-15 16:49:21.404 UTC | yes |
| 5 | AMD 10-Q (0000002488-26-000191) — Q3 2026: AMD capex 0.75 bn USD (`antigravity-news-research-agent`) | `…/2488/000000248826000191/amd-20260926.htm` | 2026-11-04 16:00:00 UTC | 2026-11-06 17:04:20.290 UTC | 2026-11-06 17:04:27.694 UTC | yes |

(Older: INTC 11.16 bn 2026-11-06; AMZN "Q1 2017 4.9 bn" ⚠ 2026-11-06 17:03:15 UTC; NVDA "Q2 2020 0.24 bn" ⚠ 2026-11-06.) `publishedAt` is always earlier than `serverReceivedAt` (G9 test 7 contract).

**UI visibility:** staged items and the morning brief are `privateRead`-only in `publicOperationsOverview`; the anonymous Market Radar (local RC) renders no story list (`morning-brief-panel` absent) and only the public collector summary (three "cursor unchanged" mentions). The owner's signed-in view could not be captured (§3.1).

**`conditionalSkip=true` — legitimately unchanged source.** Run `cloud-news_discovery_agent` 2026-11-15 17:23:40.556→40.750 UTC: `status=succeeded`, `providerRequestsCount=0` for the agent itself because the headers were shared with `sec_filings_collect` (17:23:27.654→28.050 UTC, **7 SEC submission requests**, `duplicatesSkipped=7`, cursor `sec:v2:AMD:10-Q:0000002488-26-000191|…` unchanged) and `market_data_collect` (17:23:28.104→40.515 UTC, **9 Nasdaq/ECB requests**, 32 duplicates, cursor `…2026-11-13…` unchanged). The agent cursor before and after is identical (`agent:v2:AMD:0000002488-26-000191|AMZN:0001018724-26-000040|CRWV:0001769628-26-000465|GOOGL:0001652044-26-000084|INTC:0000050863-26-000191|MSFT:…|NVDA:…`), `candidates.length===0`, model label `cursor-change-detector-v2 (0 model calls — no new upstream sources)`. The previous cycle (16:49:20 UTC) with `conditionalSkip=false` staged and promoted 4 items. So the skip reflects "no new filings since 16:49", not suppression.

Two qualifications: (1) the skip is based on *filing accession* change detection only, so it can never surface general news, and the health monitor correctly reports `externalNewsFeedCollectionStatus: 'NOT IMPLEMENTED'`; (2) `RESEARCH_SCHEDULER_ENV=disabled` on the dev deployment means no automatic cycle has run since 17:23 UTC, so "job success" after that time cannot even be claimed.

### 3.5 Check 5 — 2026-11-13 market close: Market Radar vs `/stress` vs Convex

`marketObservations` (owner rows, `sessionDate=2026-11-13`): all `eventAt=2026-11-13T21:00:00Z`, `publishedAt=null`, `serverReceivedAt=2026-11-15T16:49:03.134Z`, `provider=nasdaq_public_historical`, `priceBasis` "Public reference display … delayed EOD close, not a licensed live execution quote feed", `currency=USD`, `usdToGbp=0.75605` (ECB reference via Frankfurter, FX session 2026-11-13), `corporateActionsReviewed=false`, `licensed=false`, `declaredDelayMs=900000`, `adjustmentVersion=nasdaq-unadjusted-eod-v1`, `sourceUrl=https://api.nasdaq.com/api/quote/<SYM>/historical?assetclass=stocks|etf&fromdate=2026-11-03&todate=2026-11-15&limit=30`.

| Symbol | Convex close USD | Convex close GBP | Market Radar (local RC) | `/stress` (local RC) |
| :- | -: | -: | :- | :- |
| NVDA | 162.85 | 123.1227 | $162.85 / £123.12, As of 2026-11-13 | USD 162.85 (EOD ref) 2026-11-13 |
| MSFT | 523.88 | 396.0795 | $523.88 / £396.08 | USD 523.88 (EOD ref) |
| AMD | 534.06 | 403.7761 | $534.06 / £403.78 | — (not in six-company universe) |
| GOOGL | 295.77 | 223.6169 | $295.77 / £223.62 | USD 295.77 (EOD ref) |
| AMZN | 266.66 | 201.6083 | $266.66 / £201.61 | USD 266.66 (EOD ref) |
| INTC | 59.66 | 45.1059 | $59.66 / £45.11 | USD 59.66 (EOD ref) |
| CRWV | 53.13 | 40.1689 | $53.13 / £40.17 | USD 53.13 (EOD ref) |
| QQQ | 679.89 | 514.0308 | benchmark (briefing) | relative columns gated |

`/stress` banner: "Observed-data workspace — Convex delayed EOD reference closes connected (8 symbols); licensed split-adjusted drawdown feed unconfigured (LICENCE_REQUIRED)"; chip "8 unadjusted EOD reference closes (LICENCE_REQUIRED for drawdowns)"; every 1-session/30D/90D/52W/vs-QQQ cell reads "Unavailable — Split-adjusted series & verified calendar required (LICENCE_REQUIRED)". **Multi-day drawdowns remain unavailable, as required.** Screenshot: `docs/screenshots/sprint-g9-1-after-rc-9e58c85-stress.png` (before: `…before-production-stress.png` shows "no live provider connected / Awaiting sourced prices").

Observations: (a) the RC watchlist shows **no "1D" figure**, because the live 2026-11-13 override is discontinuous with the bundled bar history (`hasDiscontinuousLiveOverride`); the unchanged production page shows "1D: −21.21 %" for NVDA, which is in fact the move since 2026-11-03 (162.85/206.69) — the RC removes that misleading label. (b) The store holds sessions 11-02…11-06 and 11-10…11-13; **2026-11-09 is missing**, so a future "previous session" computation must not assume contiguity.

### 3.6 Check 6 — SEC current-period capex for Amazon and NVIDIA

**Committed code (`lib/remote-ops/sec-xbrl-fact-selector.ts` at `9e58c85`) on live EDGAR data** (`data.sec.gov` submissions + `companyfacts`, fetched 2026-11-15 18:03 UTC with the project `SEC_USER_AGENT`, selector run with `node --experimental-transform-types`):

| Ticker | Filing | Accession | Filed (acceptance) | Reporting period | Concept | Value | Units | Current? |
| :- | :- | :- | :- | :- | :- | :- | :- | :- |
| NVDA | 10-Q | `0001045810-26-000075` | 2026-08-26 (20:36:00 UTC) | 2026-01-26 → 2026-07-26, FY2027 Q2, `cumulative_ytd` (6-month; the filing carries no 3-month capex frame) | `us-gaap:PaymentsToAcquireProductiveAssets` | 4,434,000,000 → **$4.43 bn (YTD)** | USD | yes (`accessionMatched=true`) |
| AMZN | 10-Q | `0001018724-26-000040` | 2026-10-30 (accepted 2026-10-29 22:20:46 UTC) | 2026-07-01 → 2026-09-30, Q3 2026, `three_month`, frame `CY2026Q3` | `us-gaap:PaymentsToAcquireProductiveAssets` | 77,259,000,000 → **$77.26 bn** | USD | yes |

The obsolete concept `PaymentsToAcquirePropertyPlantAndEquipment` was last used by NVDA in 2020 and by AMZN in 2017; the selector now rejects both. Vitest G9 test 8 (same rule) passes.

**Pre-G9 selector (`9e58c85^`) on the same data:** NVDA → `0001045810-20-000147`, filed 2020-08-19, "Q2 2020 (YTD)", $0.37 bn, `accessionMatched=false`; AMZN → `0001018724-17-000051`, filed 2017-04-28, "Q1 2017", $1.86 bn. **This matches the persisted Convex rows byte-for-byte for NVDA** (title "…SEC Form 10-Q (0001045810-20-000147) — Q2 2020 (YTD)", excerpt "filed 2020-08-19, period ended 2020-07-26 … $0.37 billion … Q2 2020 (YTD)"), proving the 16:49 UTC run executed pre-G9 functions.

**Persisted state: FAIL.** `evidence` holds `NVDA capital_expenditures 0.37 billions_usd Q22020` (received 2026-11-15 16:49:21 UTC) and the 2026-11-15 `morningBriefings` row lists `fact-NVDA-0001045810-20-000147 | $0.37B (10-Q 0001045810-20-000147, filed 2020-08-19) | Q2 2020 (YTD)`. No current-period AMZN fact exists; the only AMZN item is "Q1 2017 $4.9B" from 2026-11-06. Because the agent skips any `docUrl` already in `seenUrls`, redeploying the fix alone will not replace these rows: the defective staging items/evidence must be quarantined (or their URLs removed from the seen set) and the two filings re-ingested.

### 3.7 Check 7 — Refresh and navigation preserve the latest snapshots

Local RC, anonymous, 2026-11-15 18:15 UTC: initial load → `#g6-briefing-title` **"Research as of 2026-11-13"**, `briefing-observation-asof` "Market observation as of 2026-11-13 · Fundamental & graph cut-off: 2026-11-04", provenance pill "Persisted EOD observations + deterministic SEC/TypeDB synthesis (live LLM inference NOT IMPLEMENTED)". After three full reloads and a `/stress` → back navigation the heading and as-of strings were identical (`stable: true`), and no heading ever read 2026-11-04 (`fallbackTo20261104: false`). **PASS.**

Two qualifications:
- The "2026-11-04" that does appear is the *fundamental/graph cut-off* (verified filing anchor), shown deliberately alongside the 2026-11-13 market date ("Cross-cutoff returns are never blended"). It is not the obsolete briefing.
- `briefing-last-refreshed` reads "Last refreshed 2026-11-05 14:57 UTC" and the notice says "morning briefing record generated 2026-11-05 14:57:37 UTC" even though Convex holds a briefing generated 2026-11-15 16:49:21 UTC. `publicOperationsOverview` only returns `latestBriefing` for a private read, so anonymous viewers fall back to the bundled record. The newer approved evidence is therefore **not** shown to signed-out viewers; whether the owner's signed-in view shows the 2026-11-15 record could not be verified (§3.1). Recommend either exposing the briefing date (not its private content) publicly or suppressing the fallback timestamp.
- Historical as-of cases (recovery/consensus/policy-risk registrations) are frozen by construction (registration JSON persisted with its own cutoff; Vitest suites pass) but were not re-opened in the browser.

### 3.8 Check 8 — Artefacts

| File | What it shows |
| :- | :- |
| `docs/screenshots/sprint-g9-1-before-production-market-radar.png` | Production (unchanged), 2026-11-15 18:10 UTC: "Today's Market Briefing", 2026-11-13 closes, misleading "1D" values |
| `docs/screenshots/sprint-g9-1-before-production-stress.png` | Production `/stress`: no provider connected, all cells Unavailable |
| `docs/screenshots/sprint-g9-1-before-production-brokers-anonymous.png` | Production `/settings/brokers` signed out (no env badges) |
| `docs/screenshots/sprint-g9-1-after-rc-9e58c85-market-radar.png` | Local RC: "Research as of 2026-11-13", separated cut-offs, no 1D label |
| `docs/screenshots/sprint-g9-1-after-rc-9e58c85-stress.png` | Local RC: 8 EOD reference closes, LICENCE_REQUIRED gating |
| `docs/screenshots/sprint-g9-1-after-rc-9e58c85-brokers-anonymous.png` | Local RC: Live/Demo badges before sign-in |
| `docs/screenshots/sprint-g9-1-after-rc-9e58c85-brokers-test-user.png` | Local RC: test user signed in, both environments Not connected |
| `docs/screenshots/sprint-g9-1-after-rc-9e58c85-home-test-user.png` | Local RC: test user command centre, empty account state |
| `scripts/sprint-g9-1-browser-acceptance.mjs` | Re-runnable Playwright evidence script (JSON report per run) |

API outcomes recorded: preview `302` on all routes; local RC `/api/brokers` (test user) `503 storage_unavailable`; `/api/brokers?connectionId=<owner>` `503`; `POST /api/brokers/sync` (owner id, test user) `503 not_configured`; production `/`, `/stress`, `/settings/brokers` `200`.

### 3.9 Check 9 — Automated suites (working tree, 2026-11-15 18:01–18:20 UTC)

| Suite | Result |
| :- | :- |
| `npm run lint` | exit 0 — 0 errors, 19 warnings (unused imports/vars) |
| `npm run typecheck` | exit 0 |
| `npx tsc --noEmit -p convex/tsconfig.json` | exit 0 |
| `npx vitest run` (full, 81 files) | 785 passed / 4 failed / 4 skipped — the 4 failures are 5 s timeouts (plus one dependent assertion) in `security-chat-action-budget`, `security-runtime-hardening`, `security-convex-data-isolation` under 81 parallel workers; re-run in isolation: **3 files, 35 tests, all pass**. `tests/sprint-g9-data-freshness-acceptance.test.ts`: 10/10. |
| `npm run test:python` | 219 tests OK (1 skipped) |
| `next build` of `9e58c85` (clean worktree, `npm ci`) | exit 0 |

No code fixes were applied during this sprint; the only repository additions are this document, the screenshots and the evidence script.

---

## 4. Owner actions before a production release can be recommended

1. **Deploy Convex functions in lockstep with the Next.js build** (`npx convex deploy` for production, `npx convex dev --once`/deploy key for the preview backend), and add a release step that fails if the Convex deployment lags the commit.
2. **Quarantine and re-ingest the defective SEC facts** (NVDA `staged-7f5da1f3fb6a672d` 2026-11-15 and `staged-e2523ed83a7c0247` 2026-11-06; AMZN `staged-dcf44b009199d49a` 2026-11-06) and regenerate the 2026-11-15 briefing after the fixed selector is live; verify the result equals §3.6 (NVDA $4.43 bn FY27 Q2 YTD; AMZN $77.26 bn Q3 2026).
3. **Align the preview backend's Clerk issuer** with the owner identity (set `CLERK_JWT_ISSUER_DOMAIN` on `prestigious-dragon-8` to the harmless-akita instance, or migrate `RESEARCH_OWNER_ID` and owner rows), then re-run the signed-in owner checks (§3.2 sync agreement, §3.4 News Tracker visibility, §3.7 private briefing date).
4. **Open the Vercel Preview to acceptance** (§3.1) and re-run `scripts/sprint-g9-1-browser-acceptance.mjs https://trading-lv5p4xqku-david-grannums-projects.vercel.app preview docs/screenshots/preview …`.
5. Decide whether `RESEARCH_SCHEDULER_ENV=disabled` on the dev deployment is intended; if automatic collection is expected on the preview backend, re-enable it.
6. Decide what to do with the dormant live auto-sync schedule: either configure `BROKER_SCHEDULER_SECRET` plus a platform cron hitting `/api/brokers/scheduled`, or turn the schedule off so the UI does not advertise an automation that never runs.
7. Review the uncommitted `authz` azp change (configured origins now replace, rather than extend, the defaults) before it is committed on top of this RC.
8. Add `BROKER_VAULT_KEY_B64` (a Preview-specific 32-byte key, not the Production key) to the Vercel Preview environment if broker flows are meant to be acceptance-tested on previews.
9. Make the scheduler health indicator depend on observed cron execution (e.g. last `researchJobRuns` row within two intervals and `RESEARCH_SCHEDULER_ENV !== 'disabled'`), not on job rows being `enabled`.
10. Surface the latest briefing date (and, for the signed-in owner, its content) on Market Radar instead of the bundled 2026-11-05 fixture.

Nothing in production, no credentials, no trading flag and no WAF rule was changed during this assessment.
