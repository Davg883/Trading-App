import type { BrokerEnvironment } from '../brokers/contracts';

/**
 * Sprint G9 — Unified Source-Health & Freshness Contract
 *
 * Every external or internal data source in AI Capital Intelligence is represented by a single
 * deterministic `SourceHealthRecord` so that:
 * 1. Freshness is evaluated relative to the source's actual update schedule (e.g. US regular session
 *    21:00 UTC Mon–Fri vs 15-minute broker snapshot vs quarterly SEC filings).
 * 2. Weekend/holiday US market closures report `EXPECTED_DELAY` / `HEALTHY` rather than false `STALE`
 *    when Friday's 21:00 UTC regular close is present.
 * 3. Missing licensed real-time or split-adjusted feeds report `LICENCE_REQUIRED` explicitly.
 * 4. Research freshness is strictly separated from broker-account freshness.
 */

export type SourceHealthStatus =
  | 'HEALTHY'
  | 'EXPECTED_DELAY'
  | 'STALE'
  | 'FAILED'
  | 'NOT_CONNECTED'
  | 'LICENCE_REQUIRED'
  | 'UNKNOWN';

export type SourceDataMode =
  | 'LIVE_BROKER_READONLY'
  | 'DEMO_BROKER_READONLY'
  | 'DELAYED_PUBLIC_EOD'
  | 'PRIMARY_REGULATORY_FILING'
  | 'CENTRAL_BANK_REFERENCE_FX'
  | 'DETERMINISTIC_SYNTHESIS'
  | 'KNOWLEDGE_GRAPH_PROJECTION'
  | 'SYNTHETIC_FIXTURE'
  | 'UNCONFIGURED';

export type SourceLicenceState =
  | 'OWNER_CREDENTIAL_READONLY'
  | 'PUBLIC_UNLICENSED_DELAYED'
  | 'PUBLIC_REGULATORY_PRIMARY'
  | 'PUBLIC_CENTRAL_BANK'
  | 'INTERNAL_DETERMINISTIC'
  | 'LICENCE_MISSING_FAIL_CLOSED'
  | 'SYNTHETIC_DEMO_ONLY';

export interface SourceHealthRecord {
  sourceId: string;
  sourceName: string;
  domain: 'broker' | 'market_data' | 'sec_fundamentals' | 'macro_fx' | 'news_research' | 'briefing' | 'stress_monitor' | 'knowledge_graph';
  environment: 'live' | 'demo' | 'remote' | 'local' | 'synthetic' | 'unconfigured';
  dataMode: SourceDataMode;
  latestSourceTimestamp: number | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  latestRecordAt: number | null;
  nextExpectedUpdateAt: number | null;
  staleAfterAt: number | null;
  status: SourceHealthStatus;
  errorCode: string | null;
  provenance: string;
  licenceState: SourceLicenceState;
  detail: string;
}

export const US_REGULAR_CLOSE_UTC_HOUR = 21;
export const BROKER_STALE_THRESHOLD_MS = 15 * 60_000; // 15 minutes

/**
 * Computes the most recent completed US equity regular session close (21:00 UTC Mon–Fri)
 * at or before `nowMs`, plus the next expected US regular session close.
 */
export function resolveUsEquitySessionSchedule(nowMs: number): {
  latestCompletedSessionCloseAtMs: number;
  latestCompletedSessionDateIso: string;
  nextExpectedSessionCloseAtMs: number;
  isWeekendOrAfterCloseWait: boolean;
} {
  const d = new Date(nowMs);
  const utcYear = d.getUTCFullYear();
  const utcMonth = d.getUTCMonth();
  const utcDate = d.getUTCDate();
  const todayCloseMs = Date.UTC(utcYear, utcMonth, utcDate, US_REGULAR_CLOSE_UTC_HOUR, 0, 0, 0);
  const dayOfWeek = d.getUTCDay(); // 0 = Sun, 6 = Sat

  let latestCloseDate = new Date(Date.UTC(utcYear, utcMonth, utcDate, US_REGULAR_CLOSE_UTC_HOUR, 0, 0, 0));
  if (dayOfWeek === 0) {
    // Sunday -> Friday 21:00 UTC (-2 days)
    latestCloseDate = new Date(todayCloseMs - 2 * 86_400_000);
  } else if (dayOfWeek === 6) {
    // Saturday -> Friday 21:00 UTC (-1 day)
    latestCloseDate = new Date(todayCloseMs - 1 * 86_400_000);
  } else if (nowMs < todayCloseMs) {
    // Weekday before 21:00 UTC -> previous weekday
    const backDays = dayOfWeek === 1 ? 3 : 1;
    latestCloseDate = new Date(todayCloseMs - backDays * 86_400_000);
  }

  let nextCloseDate = new Date(todayCloseMs);
  if (dayOfWeek === 6) {
    // Saturday -> Monday (+2 days)
    nextCloseDate = new Date(todayCloseMs + 2 * 86_400_000);
  } else if (dayOfWeek === 0) {
    // Sunday -> Monday (+1 day)
    nextCloseDate = new Date(todayCloseMs + 1 * 86_400_000);
  } else if (nowMs >= todayCloseMs) {
    // Weekday at/after 21:00 UTC -> next weekday
    const forwardDays = dayOfWeek === 5 ? 3 : 1;
    nextCloseDate = new Date(todayCloseMs + forwardDays * 86_400_000);
  }

  return {
    latestCompletedSessionCloseAtMs: latestCloseDate.getTime(),
    latestCompletedSessionDateIso: latestCloseDate.toISOString().slice(0, 10),
    nextExpectedSessionCloseAtMs: nextCloseDate.getTime(),
    isWeekendOrAfterCloseWait: dayOfWeek === 0 || dayOfWeek === 6 || nowMs < todayCloseMs,
  };
}

/**
 * Evaluates US EOD market observation freshness relative to the US regular session calendar.
 * - If no observation exists -> `NOT_CONNECTED` or `FAILED`
 * - If the observation matches the latest completed US session close (e.g. Friday 2026-11-13 21:00 UTC
 *   when evaluated on Sunday 2026-11-15) -> `EXPECTED_DELAY` (public delayed EOD feed) or `HEALTHY` (licensed)
 * - If the observation is within 1 trading session grace window ( collector waiting for post-close EOD publication ) -> `EXPECTED_DELAY`
 * - If older (e.g. 2026-11-04 evaluated on 2026-11-15) -> `STALE`
 */
export function evaluateMarketObservationSourceHealth(input: {
  nowMs: number;
  latestObservationAtMs: number | null;
  latestServerReceivedAtMs: number | null;
  lastAttemptAtMs: number | null;
  lastSuccessAtMs: number | null;
  lastErrorCode: string | null;
  licensedFeedConfigured: boolean;
  corporateActionsReviewed: boolean;
  coveredSymbolsCount: number;
}): SourceHealthRecord {
  const schedule = resolveUsEquitySessionSchedule(input.nowMs);
  // Allow 18 hours after the next session close before marking the prior completed session stale
  const staleAfterAt = schedule.nextExpectedSessionCloseAtMs + 18 * 3600_000;
  const latestObsMs = input.latestObservationAtMs;

  if (latestObsMs === null) {
    return {
      sourceId: 'market_observations_eod',
      sourceName: 'US Equity & Benchmark EOD Market Observations',
      domain: 'market_data',
      environment: 'remote',
      dataMode: 'UNCONFIGURED',
      latestSourceTimestamp: null,
      lastAttemptAt: input.lastAttemptAtMs,
      lastSuccessAt: input.lastSuccessAtMs,
      latestRecordAt: input.latestServerReceivedAtMs,
      nextExpectedUpdateAt: schedule.nextExpectedSessionCloseAtMs,
      staleAfterAt: null,
      status: input.lastErrorCode ? 'FAILED' : 'NOT_CONNECTED',
      errorCode: input.lastErrorCode,
      provenance: 'No stored market observations',
      licenceState: 'LICENCE_MISSING_FAIL_CLOSED',
      detail: 'No market observations stored in Convex.',
    };
  }

  // Latest observation is current if its session date >= latestCompletedSessionDateIso
  // or within 24h of latestCompletedSessionCloseAtMs (accounting for US Thanksgiving/holiday or pre-post close EOD publish lag)
  const obsDateIso = new Date(latestObsMs).toISOString().slice(0, 10);
  const gapFromLatestSessionMs = schedule.latestCompletedSessionCloseAtMs - latestObsMs;
  const isCurrentSession =
    obsDateIso >= schedule.latestCompletedSessionDateIso || gapFromLatestSessionMs <= 28 * 3600_000;

  const status: SourceHealthStatus = input.lastErrorCode
    ? 'FAILED'
    : !isCurrentSession
      ? 'STALE'
      : input.licensedFeedConfigured && input.corporateActionsReviewed
        ? 'HEALTHY'
        : 'EXPECTED_DELAY';

  return {
    sourceId: 'market_observations_eod',
    sourceName: 'US Equity & Benchmark EOD Market Observations',
    domain: 'market_data',
    environment: 'remote',
    dataMode: 'DELAYED_PUBLIC_EOD',
    latestSourceTimestamp: latestObsMs,
    lastAttemptAt: input.lastAttemptAtMs,
    lastSuccessAt: input.lastSuccessAtMs,
    latestRecordAt: input.latestServerReceivedAtMs ?? latestObsMs,
    nextExpectedUpdateAt: schedule.nextExpectedSessionCloseAtMs,
    staleAfterAt: isCurrentSession ? staleAfterAt : schedule.latestCompletedSessionCloseAtMs,
    status,
    errorCode: input.lastErrorCode,
    provenance: `Nasdaq Official Historical Close Feed (${input.coveredSymbolsCount} symbols; latest session ${obsDateIso})`,
    licenceState:
      input.licensedFeedConfigured && input.corporateActionsReviewed
        ? 'PUBLIC_REGULATORY_PRIMARY'
        : 'PUBLIC_UNLICENSED_DELAYED',
    detail: isCurrentSession
      ? `Latest completed US session (${obsDateIso}) stored across ${input.coveredSymbolsCount} symbols. Public EOD reference close (15m+ delayed, unadjusted); next US regular close ${new Date(schedule.nextExpectedSessionCloseAtMs).toISOString().slice(0, 16).replace('T', ' ')} UTC.`
      : `Stored market observations are as of ${obsDateIso}, behind the latest completed US session (${schedule.latestCompletedSessionDateIso}).`,
  };
}

/**
 * Evaluates Trading 212 broker connection health independently for `live` or `demo`.
 * Never conflates a connected Live account with an unconfigured Demo account.
 */
export function evaluateBrokerConnectionSourceHealth(input: {
  environment: BrokerEnvironment;
  nowMs: number;
  connection: {
    status: 'connected' | 'disconnected' | 'error';
    maskedKey: string | null;
    lastAttemptAt: number | null;
    lastVerifiedAt: number | null;
    lastSuccessfulSyncAt: number | null;
    lastErrorCode: string | null;
  } | null;
  summaryRetrievedAtMs: number | null;
  scheduleEnabled?: boolean;
  scheduleIntervalMinutes?: number | null;
  nextScheduledRunAtMs?: number | null;
}): SourceHealthRecord {
  const envLabel = input.environment === 'live' ? 'Live' : 'Demo';
  const dataMode: SourceDataMode =
    input.environment === 'live' ? 'LIVE_BROKER_READONLY' : 'DEMO_BROKER_READONLY';

  if (!input.connection || input.connection.status === 'disconnected') {
    return {
      sourceId: `trading212_${input.environment}`,
      sourceName: `Trading 212 ${envLabel} Account (Read-Only)`,
      domain: 'broker',
      environment: input.environment,
      dataMode,
      latestSourceTimestamp: null,
      lastAttemptAt: input.connection?.lastAttemptAt ?? null,
      lastSuccessAt: input.connection?.lastSuccessfulSyncAt ?? null,
      latestRecordAt: input.summaryRetrievedAtMs,
      nextExpectedUpdateAt: null,
      staleAfterAt: null,
      status: 'NOT_CONNECTED',
      errorCode: input.connection?.lastErrorCode ?? null,
      provenance: `Trading 212 ${envLabel} read-only adapter (unconfigured)`,
      licenceState: 'OWNER_CREDENTIAL_READONLY',
      detail: `No saved Trading 212 ${envLabel} credentials for this owner.`,
    };
  }

  const latestSyncMs = input.summaryRetrievedAtMs ?? input.connection.lastSuccessfulSyncAt ?? null;
  const staleAfterAt = latestSyncMs !== null ? latestSyncMs + BROKER_STALE_THRESHOLD_MS : null;
  const isStale = latestSyncMs === null || input.nowMs - latestSyncMs > BROKER_STALE_THRESHOLD_MS;

  let status: SourceHealthStatus = 'HEALTHY';
  if (input.connection.status === 'error' || input.connection.lastErrorCode) {
    status = 'FAILED';
  } else if (isStale) {
    status = 'STALE';
  }

  const ageMinutes =
    latestSyncMs !== null ? Math.max(0, Math.round((input.nowMs - latestSyncMs) / 60_000)) : null;

  return {
    sourceId: `trading212_${input.environment}`,
    sourceName: `Trading 212 ${envLabel} Account (Read-Only)`,
    domain: 'broker',
    environment: input.environment,
    dataMode,
    latestSourceTimestamp: latestSyncMs,
    lastAttemptAt: input.connection.lastAttemptAt,
    lastSuccessAt: input.connection.lastSuccessfulSyncAt,
    latestRecordAt: latestSyncMs,
    nextExpectedUpdateAt: input.scheduleEnabled ? (input.nextScheduledRunAtMs ?? null) : null,
    staleAfterAt,
    status,
    errorCode: input.connection.lastErrorCode,
    provenance: `Trading 212 ${envLabel} API (${input.connection.maskedKey ?? 'masked key'})`,
    licenceState: 'OWNER_CREDENTIAL_READONLY',
    detail:
      status === 'FAILED'
        ? `Trading 212 ${envLabel} sync recorded error (${input.connection.lastErrorCode ?? 'unknown'}).`
        : status === 'STALE'
          ? `Trading 212 ${envLabel} snapshot is stale (${ageMinutes !== null ? `${ageMinutes}m old` : 'never synced'}; threshold 15m). ${input.scheduleEnabled ? 'Scheduled background sync enabled.' : 'Automatic background sync is not enabled; trigger manual Synchronise now or enable schedule on /settings/brokers.'}`
          : `Trading 212 ${envLabel} snapshot is fresh (${ageMinutes ?? 0}m old).`,
  };
}

/**
 * Evaluates Market Stress Monitor (`/stress`) data-source readiness.
 * Explicitly separates:
 * - Unadjusted public EOD reference closes stored in Convex (`corporateActionsReviewed: false`)
 * - Split-adjusted, calendar-verified multi-session dataset required for authoritative drawdown/stress calculations (`LICENCE_REQUIRED`)
 */
export function evaluateStressMonitorSourceHealth(input: {
  nowMs: number;
  persistedUnadjustedSymbolsCount: number;
  latestPersistedObsAtMs: number | null;
  importedDatasetVerified: boolean;
  importedDatasetAsOfMs: number | null;
  syntheticModeActive: boolean;
}): SourceHealthRecord {
  if (input.syntheticModeActive) {
    return {
      sourceId: 'market_stress_monitor',
      sourceName: 'Market Stress Monitor Drawdown & Valuation Engine',
      domain: 'stress_monitor',
      environment: 'synthetic',
      dataMode: 'SYNTHETIC_FIXTURE',
      latestSourceTimestamp: input.nowMs,
      lastAttemptAt: input.nowMs,
      lastSuccessAt: input.nowMs,
      latestRecordAt: input.nowMs,
      nextExpectedUpdateAt: null,
      staleAfterAt: null,
      status: 'EXPECTED_DELAY',
      errorCode: null,
      provenance: 'Explicit Synthetic Demonstration Mode (illustrative only)',
      licenceState: 'SYNTHETIC_DEMO_ONLY',
      detail: 'Displaying deterministic synthetic stress scenario; never mixed with observed market or broker data.',
    };
  }

  if (input.importedDatasetVerified && input.importedDatasetAsOfMs !== null) {
    const staleAfterAt = input.importedDatasetAsOfMs + 7 * 86_400_000;
    const isStale = input.nowMs > staleAfterAt;
    return {
      sourceId: 'market_stress_monitor',
      sourceName: 'Market Stress Monitor Drawdown & Valuation Engine',
      domain: 'stress_monitor',
      environment: 'remote',
      dataMode: 'PRIMARY_REGULATORY_FILING',
      latestSourceTimestamp: input.importedDatasetAsOfMs,
      lastAttemptAt: input.importedDatasetAsOfMs,
      lastSuccessAt: input.importedDatasetAsOfMs,
      latestRecordAt: input.importedDatasetAsOfMs,
      nextExpectedUpdateAt: null,
      staleAfterAt,
      status: isStale ? 'STALE' : 'HEALTHY',
      errorCode: null,
      provenance: 'Verified corporate-action-adjusted market dataset',
      licenceState: 'PUBLIC_REGULATORY_PRIMARY',
      detail: 'Corporate-action-reviewed price series and verified exchange calendar loaded.',
    };
  }

  return {
    sourceId: 'market_stress_monitor',
    sourceName: 'Market Stress Monitor Drawdown & Valuation Engine',
    domain: 'stress_monitor',
    environment: 'remote',
    dataMode: input.persistedUnadjustedSymbolsCount > 0 ? 'DELAYED_PUBLIC_EOD' : 'UNCONFIGURED',
    latestSourceTimestamp: input.latestPersistedObsAtMs,
    lastAttemptAt: input.latestPersistedObsAtMs,
    lastSuccessAt: input.latestPersistedObsAtMs,
    latestRecordAt: input.latestPersistedObsAtMs,
    nextExpectedUpdateAt: null,
    staleAfterAt: null,
    status: 'LICENCE_REQUIRED',
    errorCode: 'corporate_actions_unverified_for_drawdown_series',
    provenance:
      input.persistedUnadjustedSymbolsCount > 0
        ? `Convex unadjusted EOD reference closes available (${input.persistedUnadjustedSymbolsCount} symbols); split-adjusted multi-day drawdown feed unconfigured`
        : 'No licensed split-adjusted market-data provider connected',
    licenceState: 'LICENCE_MISSING_FAIL_CLOSED',
    detail:
      input.persistedUnadjustedSymbolsCount > 0
        ? `Latest unadjusted EOD reference closes are displayed (${input.persistedUnadjustedSymbolsCount} symbols), but multi-session drawdown, 5D/20D return, and P/E reset columns require a corporate-action-reviewed (split-adjusted) price series and verified exchange calendar.`
        : 'No licensed market-data provider is connected; import a verified split-adjusted JSON dataset or switch to Synthetic demonstration.',
  };
}
