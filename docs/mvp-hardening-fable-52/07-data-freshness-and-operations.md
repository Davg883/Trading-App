# 07 — Data freshness, TypeDB and operational health

**Work packages:** WP4 (labels, TypeDB configuration; `e7cdf97`), WP7 (pipeline stages; `d0c2e2e`)
**Status:** IMPLEMENTED LOCALLY / PENDING DEPLOYMENT (V2). No production data was read during this review, so no claim is made about what production currently holds.

## 1. What the code establishes

| Pipeline | Cron defined | Collector exists | Stores records | Reconciliation | Shown in UI |
|---|---|---|---|---|---|
| Market data / FX (`market_data_collect`) | Yes (15-minute Convex cycle) | Yes (delayed public EOD closes, ECB FX) | `marketObservations` | No stored check | Homepage watchlist (falls back to static registered packages when the overview is unavailable) |
| SEC filings (`sec_filings_collect`) | Yes | Yes | Staging / evidence | No | Agent operations panel |
| News discovery agent | Yes | Yes (deterministic fallback without model keys) | `researchStagingItems` | Human review | Operations panel |
| Portfolio risk refresh | Yes | Job record only | — | — | Portfolio page uses static pilot data |
| Daily intelligence briefing | Yes (two weekday crons, London 07:30 guard) | Yes | `morningBriefings` | — | Command Centre |
| TypeDB projection | No cron (manual / reviewer action) | Yes | TypeDB + outbox | Internal reconcile action | Data room shows **static repository dataset** |

Whether each cron was invoked, completed and stored fresh data in production is **not verified** here; that needs the owner overview below or the Convex dashboard.

## 2. `/data-room`

The graph views render `loadInitialAcceptanceDataset()` — a JSON file in the repository. The page also runs a TypeDB connectivity probe. Previously the pill read "TypeDB Server: LIVE (3.14.2) · TLS" (TLS inferred from the database name) and the outbox pill read "23/23 Projected (0ms lag)" from the static file. Now:

- "TypeDB server probe: REACHABLE / NOT REACHABLE", with "HTTPS configured" or "no TLS configured" derived from the connection address scheme;
- a separate pill: "Displayed graph: static repository dataset (not a live TypeDB read)";
- the outbox pill states the bundled relationship count and that lag is not measured there.

A successful probe is not evidence that displayed data came from TypeDB. Individual graph query results carry their own `backendMode` (`typedb_live` or `deterministic_mirror`).

## 3. TypeDB configuration (WP4)

`admin`/`password` on `127.0.0.1:8000` is now used only for an unconfigured, non-hosted, loopback target. In production, preview or the Convex cloud runtime, missing settings or the default password produce a blocked configuration and no connection is attempted. The Convex-side detection relies on `CONVEX_CLOUD_URL`, which Convex provides in its runtime; confirm after deployment that hosted actions report a blocked configuration rather than trying local defaults when TypeDB variables are absent.

If the Vercel server holds no TypeDB credentials, the probe and read-only queries go through the Convex bridge, which now requires `TYPEDB_BRIDGE_SECRET` in both environments. Without it the data-room probe will show **NOT REACHABLE** — an accurate statement, and a visible change after deployment.

## 4. Pipeline evidence ladder (WP7)

`assessPipelineStages` reports, per job: cron defined, cron invoked, collector completed, fresh data stored, reconciled, displayed — each `yes`, `no` or `not_measured`, with evidence strings. A stage is never inferred from an earlier one. "Displayed in interface" is always `not_measured` server-side; it needs a browser check. The owner-scoped `operations:overview` returns `pipelineStages`; the public status does not.

Status rows that previously set `lastVerifiedAt` to the time of the read (Vercel, Clerk, execution) now carry `null` and say they are declarative.

## 5. Not yet implemented (plan)

| Item | Plan |
|---|---|
| Stale-data indicators in the UI from `pipelineStages` | Render on the operations panel; mark watchlist prices older than one session as stale |
| Failure alerts | Convex cron that writes an alert row and calls a webhook when a collector misses three intervals |
| Bounded retries | Existing backoff (`nextAllowedAt`, `consecutiveFailures`, `PAUSE_ON_ERRORS`) is in place; add a cap on total retries per day |
| Error monitoring | Add Sentry or Vercel/Convex log drains |
| Backup and restore | Convex snapshot export schedule; TypeDB export; a written restore runbook. **No restore drill has been performed, so backup readiness cannot be claimed.** |
| Source-level provenance | Market observations already store provider, source URL, event and receipt times; extend to briefing items |
