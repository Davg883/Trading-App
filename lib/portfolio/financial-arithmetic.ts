/**
 * Deterministic portfolio arithmetic and input provenance (MVP hardening, work package 8).
 *
 * All financial figures shown to users are computed here, in code, never by a model. Every market input that
 * feeds a calculation carries an explicit status so the interface can say whether a number is live, delayed,
 * historical, illustrative, unverified or unavailable. Nothing in this module fetches data.
 */
export type InputStatus = 'live' | 'delayed' | 'historical' | 'illustrative' | 'unverified' | 'unavailable';

export type ObservedInput = {
  label: string;
  value: number | null;
  unit: 'percent' | 'years' | 'GBP' | 'USD_per_GBP' | 'GBP_per_USD' | 'ratio';
  status: InputStatus;
  source: string;
  /** When the value was observed at source (ISO date or timestamp), or null when unknown. */
  observedAt: string | null;
  note?: string;
};

/**
 * Reference inputs used by the portfolio risk pilot. They are hand-entered from public sources in early
 * November 2026, are not refreshed automatically, and are therefore `illustrative`. They must not be described
 * as live market data. Replacing them requires a licensed or official feed with stored observation times.
 */
export const ILLUSTRATIVE_GBP_CASH_CARRY: ObservedInput = {
  label: 'Sterling cash carry rate (SONIA reference)',
  value: 3.99,
  unit: 'percent',
  status: 'illustrative',
  source: 'Hand-entered from the Bank of England SONIA series (IUDSOIA) as recorded in the G.8 pilot; not fetched',
  observedAt: '2026-11-06',
  note: 'Not refreshed automatically. Rates change; check the Bank of England database before relying on this value.',
};

export const MULTI_ASSET_INPUT_PROVENANCE = {
  status: 'illustrative' as InputStatus,
  scope: 'Running yields, coupons, effective durations, ongoing charges and ETF look-through weights in PHASE_G8_MULTI_ASSET_UNIVERSE',
  note: 'Hand-entered reference values as of early November 2026. They are not live, not refreshed automatically and have not been independently re-verified. Calculations using them are illustrative.',
};

/** Classifies an observation by age. Missing timestamps are never treated as fresh. */
export function classifyInputFreshness(
  observedAtMs: number | null,
  nowMs: number,
  maxAgeMs: number,
): 'fresh' | 'stale' | 'unavailable' {
  if (observedAtMs === null || !Number.isFinite(observedAtMs)) return 'unavailable';
  if (observedAtMs > nowMs) return 'unavailable';
  return nowMs - observedAtMs <= maxAgeMs ? 'fresh' : 'stale';
}

/** Price return of a bond position for a parallel yield change (decimal, e.g. 0.015 for +150 bp). */
export function durationPriceReturn(modifiedDurationYears: number, yieldChange: number, convexity = 0): number {
  if (!Number.isFinite(modifiedDurationYears) || modifiedDurationYears < 0) throw new Error('Duration must be non-negative');
  if (!Number.isFinite(yieldChange)) throw new Error('Yield change must be finite');
  return -modifiedDurationYears * yieldChange + 0.5 * convexity * yieldChange * yieldChange;
}

/** DV01: change in value (GBP) for a one basis point parallel move, as a positive magnitude. */
export function dv01Gbp(valueGbp: number, modifiedDurationYears: number): number {
  if (!Number.isFinite(valueGbp) || valueGbp < 0) throw new Error('Value must be non-negative');
  return valueGbp * modifiedDurationYears * 0.0001;
}

/**
 * Return in GBP for a GBP-based investor holding a USD asset.
 * `usdChangeVsGbp` is the change in the value of one US dollar measured in sterling (positive when the
 * dollar appreciates, i.e. sterling depreciates). Returns compound; they are not added.
 */
export function gbpReturnOfUsdAsset(localReturn: number, usdChangeVsGbp: number): number {
  return (1 + localReturn) * (1 + usdChangeVsGbp) - 1;
}

/** Converts a GBP/USD quote (US dollars per pound) move into the change in the USD value measured in GBP. */
export function usdChangeVsGbpFromCable(cableBefore: number, cableAfter: number): number {
  if (!(cableBefore > 0) || !(cableAfter > 0)) throw new Error('Exchange rates must be positive');
  return cableBefore / cableAfter - 1;
}

/**
 * Cash under a scenario: an instantaneous market shock leaves nominal sterling cash unchanged; interest is a
 * separate forward accrual over the horizon. The two are reported separately and never merged into one return.
 */
export function cashScenario(cashGbp: number, annualCarryPct: number | null, horizonYears: number) {
  if (!Number.isFinite(cashGbp) || cashGbp < 0) throw new Error('Cash must be non-negative');
  return {
    instantaneousShockGbp: 0,
    forwardCarryGbp: annualCarryPct === null ? null : cashGbp * (annualCarryPct / 100) * horizonYears,
  };
}

/** Market gain or loss over a period, excluding deposits and withdrawals (external flows are not losses). */
export function marketPnlExcludingFlows(startValue: number, endValue: number, netExternalFlows: number): number {
  return endValue - startValue - netExternalFlows;
}

/** Concentration over position values. Positions without a price are reported, not silently dropped. */
export function concentration(positions: Array<{ id: string; valueGbp: number | null }>) {
  const priced = positions.filter((p): p is { id: string; valueGbp: number } => p.valueGbp !== null && Number.isFinite(p.valueGbp) && p.valueGbp >= 0);
  const unpriced = positions.filter((p) => !priced.includes(p as { id: string; valueGbp: number })).map((p) => p.id);
  const total = priced.reduce((s, p) => s + p.valueGbp, 0);
  if (total === 0) return { totalPricedGbp: 0, hhi: null, top3Pct: null, unpricedPositionIds: unpriced, complete: unpriced.length === 0 };
  const weights = priced.map((p) => p.valueGbp / total).sort((a, b) => b - a);
  return {
    totalPricedGbp: total,
    /** Herfindahl–Hirschman index on a 0–10,000 scale. */
    hhi: Math.round(weights.reduce((s, w) => s + (w * 100) ** 2, 0)),
    top3Pct: Number((weights.slice(0, 3).reduce((s, w) => s + w, 0) * 100).toFixed(2)),
    unpricedPositionIds: unpriced,
    complete: unpriced.length === 0,
  };
}
