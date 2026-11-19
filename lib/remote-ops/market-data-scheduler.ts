/**
 * RC002.4 — Dedicated Market-Data-Only Recurring Scheduler (Mode B) Policy & Operational Status.
 *
 * Strictly decoupled from `RESEARCH_SCHEDULER_ENV` so general research/SEC/news/briefing/TypeDB jobs
 * remain paused while an independently authorised weekday EOD market-data schedule can operate.
 */

import { MARKET_DATA_SYMBOLS } from '../market-data/provider-adapter';

export type MarketDataSchedulerEnv = 'enabled' | 'disabled';
export type MarketDataTriggerSource = 'manual_on_demand' | 'scheduled_market_data_cron';

/**
 * Maximum weekdays in any Gregorian calendar month is 23 (e.g. a 31-day month starting Mon–Wed).
 * With 2 weekday UTC slots (21:30 UTC + 22:30 UTC), maximum scheduled attempts = 23 * 2 = 46/month.
 * Actual provider requests are lower on US market holidays (0 requests) and when slot 2 skips or
 * deduplicates after slot 1 succeeds.
 */
export const MARKET_DATA_WEEKDAY_SLOTS_UTC = ['21:30 UTC (Mon–Fri)', '22:30 UTC (Mon–Fri)'] as const;
export const MARKET_DATA_MAX_WEEKDAYS_PER_MONTH = 23;
export const MARKET_DATA_SLOTS_PER_WEEKDAY = MARKET_DATA_WEEKDAY_SLOTS_UTC.length;
export const MARKET_DATA_MAX_MONTHLY_SCHEDULED_ATTEMPTS =
  MARKET_DATA_MAX_WEEKDAYS_PER_MONTH * MARKET_DATA_SLOTS_PER_WEEKDAY; // 46
export const MARKET_DATA_PROVIDER_REQUESTS_PER_ATTEMPT = MARKET_DATA_SYMBOLS.length + 1; // 8 symbols + 1 FX = 9
export const MARKET_DATA_MAX_MONTHLY_PROVIDER_REQUESTS =
  MARKET_DATA_MAX_MONTHLY_SCHEDULED_ATTEMPTS * MARKET_DATA_PROVIDER_REQUESTS_PER_ATTEMPT; // 414

/**
 * Observed NYSE / Nasdaq full-day US market holidays (2026–2027).
 * Scheduled Mode B cron attempts exit cleanly before making provider requests on these dates.
 */
export const US_MARKET_HOLIDAYS_ISO: ReadonlySet<string> = new Set([
  // 2026
  '2026-01-01', // New Year's Day
  '2026-01-19', // MLK Jr. Day
  '2026-02-16', // Presidents' Day
  '2026-04-03', // Good Friday
  '2026-05-25', // Memorial Day
  '2026-06-19', // Juneteenth
  '2026-07-03', // Independence Day (observed)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving Day
  '2026-12-25', // Christmas Day
  // 2027
  '2027-01-01', // New Year's Day
  '2027-01-18', // MLK Jr. Day
  '2027-02-15', // Presidents' Day
  '2027-03-26', // Good Friday
  '2027-05-31', // Memorial Day
  '2027-06-18', // Juneteenth (observed)
  '2027-07-05', // Independence Day (observed)
  '2027-09-06', // Labor Day
  '2027-11-25', // Thanksgiving Day
  '2027-12-24', // Christmas Day (observed)
]);

/** Scheduled NYSE / Nasdaq 13:00 America/New_York early-close dates (2026–2027). */
export const US_MARKET_EARLY_CLOSE_ISO: ReadonlySet<string> = new Set([
  '2026-11-27', // Day after Thanksgiving
  '2026-12-24', // Christmas Eve
  '2027-11-26', // Day after Thanksgiving
]);

/**
 * Fail-closed parser for `MARKET_DATA_SCHEDULER_ENV`.
 * Defaults strictly to `'disabled'` whenever unset, empty, or any value other than `'enabled'`.
 */
export function resolveMarketDataSchedulerEnv(raw: string | undefined | null): MarketDataSchedulerEnv {
  return (raw ?? '').trim().toLowerCase() === 'enabled' ? 'enabled' : 'disabled';
}

export interface NewYorkClockParts {
  dateIso: string; // YYYY-MM-DD in America/New_York
  weekday: string; // Mon, Tue, ..., Sun
  isWeekend: boolean;
  hour: number; // 0..23
  minute: number; // 0..59
  minutesSinceMidnight: number;
}

/** Resolves exact America/New_York wall-clock date/time, automatically handling EST (UTC-5) and EDT (UTC-4). */
export function getNewYorkClockParts(nowMs: number): NewYorkClockParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(nowMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const weekday = get('weekday');
  const rawHour = Number(get('hour'));
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(get('minute'));
  return {
    dateIso: `${year}-${month}-${day}`,
    weekday,
    isWeekend: weekday === 'Sat' || weekday === 'Sun',
    hour,
    minute,
    minutesSinceMidnight: hour * 60 + minute,
  };
}

function stepBackOneCalendarDay(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

function isIsoWeekend(dateIso: string): boolean {
  const [y, m, d] = dateIso.split('-').map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return dow === 0 || dow === 6;
}

export function isUsTradingDay(dateIso: string): boolean {
  return !isIsoWeekend(dateIso) && !US_MARKET_HOLIDAYS_ISO.has(dateIso);
}

/** Returns the most recent completed NYSE/Nasdaq trading session date as of `nowMs` (allowing 15m post-close buffer). */
export function expectedLatestCompletedUsSessionDate(nowMs: number): string {
  const ny = getNewYorkClockParts(nowMs);
  const closeMinutes = US_MARKET_EARLY_CLOSE_ISO.has(ny.dateIso) ? 13 * 60 + 15 : 16 * 60 + 15;
  if (isUsTradingDay(ny.dateIso) && ny.minutesSinceMidnight >= closeMinutes) {
    return ny.dateIso;
  }
  let cursor = stepBackOneCalendarDay(ny.dateIso);
  for (let i = 0; i < 10; i += 1) {
    if (isUsTradingDay(cursor)) return cursor;
    cursor = stepBackOneCalendarDay(cursor);
  }
  return cursor;
}

export interface UsMarketEodWindowAssessment {
  eligible: boolean;
  nyDateIso: string;
  nyTimeLabel: string;
  isWeekend: boolean;
  isHoliday: boolean;
  isEarlyClose: boolean;
  expectedLatestCompletedSession: string;
  skippedReason:
    | null
    | 'us_market_closed_weekend'
    | 'us_market_closed_holiday'
    | 'us_regular_session_not_yet_closed';
}

/**
 * Evaluates whether a scheduled Mode B weekday EOD cron tick should run at `nowMs`.
 * Enforces weekend/holiday skips and requires regular US session close + 15m buffer in America/New_York
 * (handles both EST and EDT without manual seasonal cron edits).
 */
export function evaluateUsMarketEodWindow(nowMs: number): UsMarketEodWindowAssessment {
  const ny = getNewYorkClockParts(nowMs);
  const isHoliday = US_MARKET_HOLIDAYS_ISO.has(ny.dateIso);
  const isEarlyClose = US_MARKET_EARLY_CLOSE_ISO.has(ny.dateIso);
  const closeThresholdMinutes = isEarlyClose ? 13 * 60 + 15 : 16 * 60 + 15;
  const expectedLatestCompletedSession = expectedLatestCompletedUsSessionDate(nowMs);
  const nyTimeLabel = `${String(ny.hour).padStart(2, '0')}:${String(ny.minute).padStart(2, '0')} America/New_York`;

  if (ny.isWeekend) {
    return {
      eligible: false,
      nyDateIso: ny.dateIso,
      nyTimeLabel,
      isWeekend: true,
      isHoliday: false,
      isEarlyClose: false,
      expectedLatestCompletedSession,
      skippedReason: 'us_market_closed_weekend',
    };
  }
  if (isHoliday) {
    return {
      eligible: false,
      nyDateIso: ny.dateIso,
      nyTimeLabel,
      isWeekend: false,
      isHoliday: true,
      isEarlyClose: false,
      expectedLatestCompletedSession,
      skippedReason: 'us_market_closed_holiday',
    };
  }
  if (ny.minutesSinceMidnight < closeThresholdMinutes) {
    return {
      eligible: false,
      nyDateIso: ny.dateIso,
      nyTimeLabel,
      isWeekend: false,
      isHoliday: false,
      isEarlyClose,
      expectedLatestCompletedSession,
      skippedReason: 'us_regular_session_not_yet_closed',
    };
  }
  return {
    eligible: true,
    nyDateIso: ny.dateIso,
    nyTimeLabel,
    isWeekend: false,
    isHoliday: false,
    isEarlyClose,
    expectedLatestCompletedSession,
    skippedReason: null,
  };
}

export interface MarketDataOperationalStatus {
  schedulerEnv: MarketDataSchedulerEnv;
  status: 'active' | 'paused' | 'degraded' | 'stale';
  lastAttemptedRunAt: number | null;
  lastAttemptedStatus: string | null;
  lastSuccessfulRunAt: number | null;
  latestCompletedSessionDate: string | null;
  expectedLatestSessionDate: string;
  coveredSymbolsCount: number;
  expectedSymbolsCount: number;
  missingSymbols: string[];
  staleDataWarning: string | null;
  scheduleUtcSlots: readonly string[];
  maxMonthlyScheduledAttempts: number;
  maxMonthlyProviderRequests: number;
  emergencyPauseNote: string;
  executionAuthority: 'none';
}

export function buildMarketDataOperationalStatus(params: {
  marketDataSchedulerEnv: MarketDataSchedulerEnv;
  nowMs: number;
  recentMarketRuns: Array<{ startedAt: number; status: string }>;
  latestBySymbol: Array<{ symbol: string; sessionDate: string }>;
}): MarketDataOperationalStatus {
  const expectedLatestSessionDate = expectedLatestCompletedUsSessionDate(params.nowMs);
  const sortedRuns = [...params.recentMarketRuns].sort((a, b) => b.startedAt - a.startedAt);
  const lastAttempted = sortedRuns[0] ?? null;
  const lastSuccessful = sortedRuns.find((r) => r.status === 'succeeded') ?? null;

  const bySymbol = new Map(params.latestBySymbol.map((s) => [s.symbol, s.sessionDate]));
  const missingSymbols = MARKET_DATA_SYMBOLS.filter((sym) => !bySymbol.has(sym));
  const coveredSymbolsCount = MARKET_DATA_SYMBOLS.length - missingSymbols.length;

  const symbolDates = [...bySymbol.values()].sort();
  // Latest completed session across ALL covered symbols is the minimum of per-symbol latest dates
  // when all 8 are present, or the latest available date if partially covered (with warning).
  const latestCompletedSessionDate =
    coveredSymbolsCount === MARKET_DATA_SYMBOLS.length
      ? (symbolDates[0] ?? null)
      : (symbolDates[symbolDates.length - 1] ?? null);

  const warnings: string[] = [];
  if (missingSymbols.length > 0) {
    warnings.push(`Missing market observations for ${missingSymbols.length} symbol(s): ${missingSymbols.join(', ')}.`);
  }
  if (!latestCompletedSessionDate) {
    warnings.push(`No completed US EOD market sessions stored (expected ${expectedLatestSessionDate}).`);
  } else if (latestCompletedSessionDate < expectedLatestSessionDate) {
    warnings.push(
      `Latest stored EOD session (${latestCompletedSessionDate}) lags expected completed US session (${expectedLatestSessionDate}).`,
    );
  }
  if (lastAttempted && lastAttempted.status === 'failed') {
    warnings.push('Most recent market_data_collect attempt failed; delayed public EOD closes are never fabricated.');
  }

  let status: MarketDataOperationalStatus['status'];
  if (lastAttempted?.status === 'failed') {
    status = 'degraded';
  } else if (params.marketDataSchedulerEnv !== 'enabled') {
    status = 'paused';
  } else if (warnings.length > 0) {
    status = 'stale';
  } else {
    status = 'active';
  }

  return {
    schedulerEnv: params.marketDataSchedulerEnv,
    status,
    lastAttemptedRunAt: lastAttempted?.startedAt ?? null,
    lastAttemptedStatus: lastAttempted?.status ?? null,
    lastSuccessfulRunAt: lastSuccessful?.startedAt ?? null,
    latestCompletedSessionDate,
    expectedLatestSessionDate,
    coveredSymbolsCount,
    expectedSymbolsCount: MARKET_DATA_SYMBOLS.length,
    missingSymbols: [...missingSymbols],
    staleDataWarning: warnings.length > 0 ? warnings.join(' ') : null,
    scheduleUtcSlots: MARKET_DATA_WEEKDAY_SLOTS_UTC,
    maxMonthlyScheduledAttempts: MARKET_DATA_MAX_MONTHLY_SCHEDULED_ATTEMPTS,
    maxMonthlyProviderRequests: MARKET_DATA_MAX_MONTHLY_PROVIDER_REQUESTS,
    emergencyPauseNote:
      'Setting MARKET_DATA_SCHEDULER_ENV=disabled takes effect at the next scheduled cron gate; any already in-flight action finishes cleanly without interrupting persistence.',
    executionAuthority: 'none',
  };
}
