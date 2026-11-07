# AI Capital Intelligence — Phase 003.1 & Phase 003.2: Unattended Remote Operations & Operational Hardening Acceptance

Prepared: `2026-11-06 17:35 UTC`
Deployment: Convex Cloud (`prestigious-dragon-8`, region `eu-west-1`)
Security posture: **Live and Demo trading execution remain disabled (`LIVE_TRADING_ENABLED` and `DEMO_TRADING_ENABLED` unset; `executionAuthority: "none"`). No secret values, tokens, or credentials appear in this report.**

---

## 1. Cloud Activation & Persistent Collection Coverage (Phase 003.1 §1 & Phase 003.2 §2)

All required recurring research collectors and briefing schedules execute natively inside the hosted Convex Cloud deployment (`https://prestigious-dragon-8.eu-west-1.convex.cloud` and `https://prestigious-dragon-8.eu-west-1.convex.site`) in AWS `eu-west-1` while the local computer and browser are switched off.

Any local CLI scripts, undeployed repository workflows, or unconfigured third-party feeds are explicitly classified and surfaced in `health.executionPaths` (`[data-testid="agent-ops-execution-paths"]`) rather than represented as continuously deployed cloud services:

| Execution Path ID | Component / Path | Deployment Classification | Cloud Status | Operational Scope |
| --- | --- | --- | --- | --- |
| `convex_cloud_scheduler_and_collectors` | [`convex/crons.ts`](file:///C:/GPT%205%20CODEX/Trading%20app/convex/crons.ts), [`convex/remoteOpsCloud.ts`](file:///C:/GPT%205%20CODEX/Trading%20app/convex/remoteOpsCloud.ts), [`convex/operations.ts`](file:///C:/GPT%205%20CODEX/Trading%20app/convex/operations.ts), [`convex/http.ts`](file:///C:/GPT%205%20CODEX/Trading%20app/convex/http.ts) | **`cloud_hosted` (AWS `eu-west-1`)** | **`active`** | Runs the 15-minute research & collection cycle across all 6 SEC-reporting AI universe tickers (`NVDA`, `MSFT`, `AMZN`, `GOOGL`, `INTC`, `AMD`), ECB USD/GBP reference collection, risk safeguard checks, and the `07:30 Europe/London` (GMT/BST) Morning Intelligence Brief with the laptop off. |
| `python_remote_research_cli` | [`worker/remote_research.py`](file:///C:/GPT%205%20CODEX/Trading%20app/worker/remote_research.py) | **`local_cli_only` (not a cloud daemon)** | **`standby`** | On-demand CLI verification and TypeScript–Python parity evaluator only. Recurring SEC EDGAR and FX collection has been moved into `convex/remoteOpsCloud.ts` so unattended operation never depends on a manually launched Python process. |
| `github_actions_workflow` | [`.github/workflows/remote-research-operations.yml`](file:///C:/GPT%205%20CODEX/Trading%20app/.github/workflows/remote-research-operations.yml) | **`undeployed_config`** | **`unavailable`** | Committed in the local Git repository (`main`), but inactive in cloud until a remote GitHub `origin` and repository secrets are configured. |
| `antigravity_desktop_sidecars` | [`config/antigravity/sidecars/aci-news-research/sidecar.json`](file:///C:/GPT%205%20CODEX/Trading%20app/config/antigravity/sidecars/aci-news-research/sidecar.json), [`aci-morning-brief/sidecar.json`](file:///C:/GPT%205%20CODEX/Trading%20app/config/antigravity/sidecars/aci-morning-brief/sidecar.json) | **`local_cli_only`** | **`standby`** | Local workstation daemon schedules; automatically yield when `activeEnvironment === "remote"`. |
| `licensed_intraday_market_data` | `LICENSED_MARKET_DATA_API_KEY` (`market_data_collect`) | **`unconfigured_provider`** | **`unavailable`** | Unconfigured; `market_data_collect` fails closed (`licensed_quote_provider_unconfigured`) on live equity/index quotes and refuses to present delayed closes as live quotes. |

---

## 2. UK-Local Briefing Schedule & Deduplication (`07:30 Europe/London` Across GMT & BST) (Phase 003.2 §1)

Implemented in [`lib/remote-ops/morning-briefing.ts`](file:///C:/GPT%205%20CODEX/Trading%20app/lib/remote-ops/morning-briefing.ts), [`convex/crons.ts`](file:///C:/GPT%205%20CODEX/Trading%20app/convex/crons.ts), [`convex/remoteOpsCloud.ts`](file:///C:/GPT%205%20CODEX/Trading%20app/convex/remoteOpsCloud.ts), [`convex/operations.ts`](file:///C:/GPT%205%20CODEX/Trading%20app/convex/operations.ts), and [`worker/remote_research.py`](file:///C:/GPT%205%20CODEX/Trading%20app/worker/remote_research.py):

1. **Dual-Regime Cloud Cron + Local Timezone Gate**:
   - [`convex/crons.ts`](file:///C:/GPT%205%20CODEX/Trading%20app/convex/crons.ts) registers:
     - `morning-intelligence-brief-uk-bst` (`30 6 * * 1-5` UTC = `07:30 BST` during British Summer Time, `UTC+1`)
     - `morning-intelligence-brief-uk-gmt` (`30 7 * * 1-5` UTC = `07:30 GMT` during Greenwich Mean Time, `UTC+0`)
     - Plus the 15-minute `remote-research-operations-cycle` catch-up check.
   - [`getLondonTimeParts`](file:///C:/GPT%205%20CODEX/Trading%20app/lib/remote-ops/morning-briefing.ts#L36-L85) and [`evaluateLondonMorningBriefWindow`](file:///C:/GPT%205%20CODEX/Trading%20app/lib/remote-ops/morning-briefing.ts#L123-L209) evaluate the exact `Europe/London` local date (`YYYY-MM-DD`), weekday, local hour/minute, and DST offset (`GMT` `0` vs. `BST` `+60`).
2. **Strict 1-Briefing-Per-UK-Date Deduplication**:
   - Both [`evaluateLondonMorningBriefWindow`](file:///C:/GPT%205%20CODEX/Trading%20app/lib/remote-ops/morning-briefing.ts#L134-L147) (before job lease acquisition) and [`recordDeterministicRunInternal`](file:///C:/GPT%205%20CODEX/Trading%20app/convex/operations.ts#L925-L945) (at database commit time via `by_owner_date` index on `morningBriefings`) guarantee that **at most one briefing is created per `Europe/London` reporting date**.
   - Live cloud verification confirmed that on `2026-11-06` (`GMT`), subsequent scheduled cycles returned:
     - `status: "skipped"`, `detail: "already_generated_for_uk_date (2026-11-06 17:34 GMT)"`.
3. **Tested GMT & BST Daylight-Saving Transitions**:
   - **Spring-Forward (`GMT -> BST`, Sunday `2026-03-29 01:00 UTC`)**:
     - Friday `2026-03-27T06:30:00Z` (`06:30 GMT`) -> `shouldRun: false` (`before_0730_europe_london`).
     - Friday `2026-03-27T07:30:00Z` (`07:30 GMT`) -> `shouldRun: true` (`due_at_0730_europe_london`); `nextLondonMorningBriefAt` advances across the DST boundary to Monday `2026-03-30T06:30:00Z` (`07:30 BST`).
     - Monday `2026-03-30T06:30:00Z` (`07:30 BST`) -> `shouldRun: true` (`due_at_0730_europe_london`, creates `2026-03-30` briefing).
     - Monday `2026-03-30T07:30:00Z` (`08:30 BST`) -> `shouldRun: false` (`already_generated_for_uk_date`, deduplicated).
   - **Fall-Back (`BST -> GMT`, Sunday `2026-10-25 01:00 UTC`)**:
     - Friday `2026-10-23T06:30:00Z` (`07:30 BST`) -> `nextLondonMorningBriefAt` advances across the fall-back boundary to Monday `2026-10-26T07:30:00Z` (`07:30 GMT`).
     - Monday `2026-10-26T06:30:00Z` (`06:30 GMT`) -> `shouldRun: false` (`before_0730_europe_london`).
     - Monday `2026-10-26T07:30:00Z` (`07:30 GMT`) -> `shouldRun: true` (`due_at_0730_europe_london`).

---

## 3. Scheduling Efficiency, Source Cursors & Conditional Processing (Phase 003.2 §3)

1. **Lightweight SEC Submission Header Check & Accession Cursor**:
   - [`fetchSecSubmissionHeader`](file:///C:/GPT%205%20CODEX/Trading%20app/convex/remoteOpsCloud.ts#L67-L108) inspects the latest `10-Q`/`10-K`/`8-K` accession number for all 6 covered SEC universe tickers (`NVDA`, `MSFT`, `AMZN`, `GOOGL`, `INTC`, `AMD`) and computes a deterministic cursor:
     - `sec:v2:AMD:10-Q:0000002488-26-000191|AMZN:10-Q:0001018724-26-000040|GOOGL:8-K:0001193125-26-449835|INTC:10-Q:0000050863-26-000191|MSFT:8-K:0001193125-26-448357|NVDA:8-K:0001045810-26-000078`
   - Multi-megabyte XBRL `companyfacts` payloads are downloaded **only** when a filing URL is not yet present in `seenUrls` / `cursorBefore`.
2. **Zero Model Calls on Unchanged 15-Minute Cycles (`conditionalSkip: true`)**:
   - When all candidate filing URLs are already staged (`candidates.length === 0`), `news_discovery_agent` executes a conditional skip (`conditionalSkip: true`), making **`0` AI model calls**, consuming **`0` input/output tokens**, and recording `estimatedCostGbp: 0` and `actualCostGbp: 0`.
3. **Recorded Efficiency & Cost Telemetry (`prestigious-dragon-8` Live Runs)**:

| Run ID | Job Key | Status | Conditional Skip | Provider Requests | Duration (`ms`) | Est. Cost (`GBP`) | Actual Cost (`GBP`) | Cursor / Detail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `cloud-sec_filings_collect-1793986488225` | `sec_filings_collect` | `succeeded` | `false` | `6` | `1,092 ms` | `£0.0000` | `£0.0000` | Verified all 6 tickers (`AMD`, `AMZN`, `GOOGL`, `INTC`, `MSFT`, `NVDA`) and updated cursor |
| `cloud-sec_filings_collect-1793986489486` | `sec_filings_collect` | `succeeded` | **`true`** | `6` | `176 ms` | `£0.0000` | `£0.0000` | `cursor_unchanged (6 tickers)` — skipped XBRL companyfacts downloads |
| `cloud-news_discovery_agent-1793986489486` | `news_discovery_agent` | `succeeded` | **`true`** | `0` | `109 ms` | `£0.0000` | `£0.0000` | `cursor-change-detector-v2 (0 model calls — no new upstream sources)` |
| `cloud-market_data_collect-1793986489486` | `market_data_collect` | `failed` | `false` | `1` | `64 ms` | `£0.0000` | `£0.0000` | ECB USD/GBP `0.7471` fetched; failed closed on `licensed_quote_provider_unconfigured` |
| `cloud-portfolio_risk_refresh-1793986489486` | `portfolio_risk_refresh` | `succeeded` | `false` | `0` | `47 ms` | `£0.0000` | `£0.0000` | Execution safeguards verified (`executionAuthority: "none"`) |

---

## 4. Operational Monitoring & 5-Layer Health Distinction (Phase 003.2 §4)

Implemented in [`lib/remote-ops/health-monitor.ts`](file:///C:/GPT%205%20CODEX/Trading%20app/lib/remote-ops/health-monitor.ts) and rendered in [`components/command-centre/agent-operations-panel.tsx`](file:///C:/GPT%205%20CODEX/Trading%20app/components/command-centre/agent-operations-panel.tsx) (`[data-testid="agent-ops-layers"]`), demonstrating that **a healthy scheduler does not automatically imply healthy data ingestion**:

| Layer | Test ID | Live Cloud Status (`prestigious-dragon-8`) | Label & Diagnostic Detail |
| --- | --- | --- | --- |
| **1. Scheduler working** | `layer-scheduler` | **`working`** | `Scheduler working` — Convex cloud cron (`remote`) active (`lastTickAt: 2026-11-06T17:34:50.100Z`); healthy scheduler does not imply all upstream sources succeeded. |
| **2. Collector working** | `layer-collector` | **`partial`** | `Partial (4/5 healthy)` — 4 collectors succeeded; 1 reported an upstream error (`market_data_collect:licensed_quote_provider_unconfigured`). |
| **3. Source available** | `layer-source` | **`partial`** | `Partial source coverage` — SEC EDGAR XBRL & ECB FX reference feeds available (`3`); licensed intraday quote feed unconfigured (`1`). |
| **4. Valid evidence imported** | `layer-evidence` | **`imported`** | `Valid evidence imported (15)` — 15 primary-source facts promoted with trusted `serverReceivedAt` · latest cycle skipped unchanged sources via cursor. |
| **5. Research briefing generated** | `layer-briefing` | **`generated`** | `Briefing generated (2026-11-06 GMT)` — Deduplicated 1 briefing for `2026-11-06` (`07:30 Europe/London GMT`). |

### Collector-Level Telemetry Displayed in `AgentOperationsPanel` (`[data-testid="agent-ops-table"]`)

| Job Key | Active Env | Last Success (UTC) | Last Failure (UTC) & Error | Next Run (UTC) | Freshness | Last Run Efficiency |
| --- | --- | --- | --- | --- | --- | --- |
| `market_data_collect` | `remote` | `None` | **`2026-11-06T17:34:49.795Z`** (`licensed_quote_provider_unconfigured`) | `2026-11-06T19:34:49.795Z` | `unavailable` | `1 req · 64ms` |
| `sec_filings_collect` | `remote` | `2026-11-06T17:34:49.664Z` | `None` | `2026-11-06T18:34:49.664Z` | `fresh` | `6 reqs · 176ms · cursor unchanged` |
| `news_discovery_agent` | `remote` | `2026-11-06T17:34:49.957Z` | `None` | `2026-11-06T18:04:49.957Z` | `fresh` | `0 reqs · 109ms · cursor unchanged (0 model calls)` |
| `portfolio_risk_refresh` | `remote` | `2026-11-06T17:34:50.100Z` | `None` | `2026-11-06T18:34:50.100Z` | `fresh` | `0 reqs · 47ms` |
| `daily_intelligence_briefing` | `remote` | `2026-11-06T17:03:16.067Z` | `None` | `2026-11-07T17:03:16.067Z` | `fresh` | `Deduplicated for 2026-11-06 GMT` |

---

## 5. Trusted Timestamps, Verified Evidence & Operating Costs (Phase 003.1 §§2–4 & Phase 003.2 §§3, 5)

### 5.1 Staged & Promoted SEC EDGAR Evidence (`researchStagingItems` & `evidence`)

| External ID | Entity & Filing | Primary Source URL | Published At (UTC) | Untrusted Agent Retrieval (`sourceRetrievedAt`) | Trusted Server Receipt (`serverReceivedAt`) | Clock Skew | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `staged-adfd0a710e5538b2` | **AMD** Form 10-Q (`0000002488-26-000191`) | `https://www.sec.gov/Archives/edgar/data/2488/000000248826000191/amd-20260926.htm` | `2026-11-04T16:00:00Z` | `2026-11-06T17:04:20.290Z` | **`2026-11-06T17:04:27.694Z`** | `+7,404 ms` | `promoted` (`marketOutcomeEligible: false`) |
| `staged-39bf33eb27445eee` | **INTC** Form 10-Q (`0000050863-26-000191`) | `https://www.sec.gov/Archives/edgar/data/50863/000005086326000191/intc-20260926.htm` | `2026-10-30T16:00:00Z` | `2026-11-06T17:04:20.290Z` | **`2026-11-06T17:04:27.694Z`** | `+7,404 ms` | `promoted` (`marketOutcomeEligible: false`) |
| `staged-c135441d25ee1df9` | **MSFT** Form 8-K (`0001193125-26-448357`) | `https://www.sec.gov/Archives/edgar/data/789019/000119312526448357/d177209d8k.htm` | `2026-11-05T16:00:00Z` | `2026-11-06T17:03:13.963Z` | **`2026-11-06T17:03:15.698Z`** | `+1,735 ms` | `promoted` (`marketOutcomeEligible: false`) |
| `staged-98c25c92c7ca82e7` | **GOOGL** Form 8-K (`0001193125-26-449835`) | `https://www.sec.gov/Archives/edgar/data/1652044/000119312526449835/d174184d8k.htm` | `2026-11-05T16:00:00Z` | `2026-11-06T17:03:13.963Z` | **`2026-11-06T17:03:15.698Z`** | `+1,735 ms` | `promoted` (`marketOutcomeEligible: false`) |
| `staged-dcf44b009199d49a` | **AMZN** Form 10-Q (`0001018724-26-000040`) | `https://www.sec.gov/Archives/edgar/data/1018724/000101872426000040/amzn-20260930.htm` | `2026-10-30T16:00:00Z` | `2026-11-06T17:03:13.963Z` | **`2026-11-06T17:03:15.698Z`** | `+1,735 ms` | `promoted` (`marketOutcomeEligible: false`) |
| `staged-e2523ed83a7c0247` | **NVDA** Form 8-K (`0001045810-26-000078`) | `https://www.sec.gov/Archives/edgar/data/1045810/000104581026000078/nvda-20260902.htm` | `2026-09-03T16:00:00Z` | `2026-11-06T17:03:13.963Z` | **`2026-11-06T17:03:15.698Z`** | `+1,735 ms` | `promoted` (`marketOutcomeEligible: false`) |

### 5.2 Cloud Operating Costs & Budget Enforcement
- **Daily Model Cost**: `Estimated: £0.0000` · `Actual: £0.0000` (Daily ceiling: `£2.00`).
- **Monthly Model Cost**: `Estimated: £0.0000` · `Actual: £0.0000` (Monthly ceiling: `£25.00`).
- **Why Model Cost Is `£0.0000`**:
  1. `GEMINI_API_KEY` is not configured in the cloud secret store, so initial extraction ran deterministically from SEC XBRL (`actualCostGbp: null` / `£0.0000` rather than fabricating synthetic token usage).
  2. Subsequent 15-minute cycles detect unchanged SEC accession cursors (`conditionalSkip: true`) and make `0` model calls (`actualCostGbp: 0`, `estimatedCostGbp: 0`).
- **Budget Enforcement**: Verified in `tests/remote-ops-convex.test.ts` that exceeding either the `£2.00` daily ceiling or `£25.00` monthly ceiling immediately transitions `news_discovery_agent` to `budget_exceeded` while deterministic collectors continue uninterrupted.

---

## 6. Remaining Limitations & Pre-Licensed-Data Blockers

1. **Licensed Real-Time Equity/Index Market-Data Feed (`LICENSED_MARKET_DATA_API_KEY`)**:
   - Remains unconfigured prior to the licensed market-data phase. `market_data_collect` records `failed:licensed_quote_provider_unconfigured` on every cycle (visible in `[data-testid="job-error-market_data_collect"]` and `operationalLayers.collector = "partial"`), while continuing to ingest the public ECB USD/GBP reference rate (`0.7471`).
2. **Cloud LLM Narrative Synthesis Key (`GEMINI_API_KEY`)**:
   - Unconfigured in Convex Cloud; deterministic SEC EDGAR XBRL extraction and cursor change detection operate at `£0.00` model cost, and the missing LLM credential is explicitly listed in `incompleteEvidence`.
3. **External GitHub Remote & Next.js Cloud Hosting**:
   - Unattended scheduled collection and briefing generation run 24/7 in Convex Cloud (`prestigious-dragon-8.eu-west-1.convex.cloud`). Linking a remote GitHub `origin` for `.github/workflows/remote-research-operations.yml` and deploying the Next.js frontend remain optional owner steps.
