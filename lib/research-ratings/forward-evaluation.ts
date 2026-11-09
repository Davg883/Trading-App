import { sha256Hex } from '../remote-ops/staging-validator';
import {
  RESEARCH_METHODOLOGY_VERSION,
  evaluateUniverseResearchAssessments,
  type ResearchAssessmentLabel,
  type StockResearchAssessment,
} from './engine';

/**
 * Phase G.7 Stage 5 — Forward Research Evaluation Engine.
 *
 * Guarantees:
 * 1. Timestamped, immutable research assessment snapshots with deterministic canonical SHA-256 content hashes (`snapshotSha256`).
 * 2. Cryptographic tamper detection (`verifyAssessmentSnapshotIntegrity`) preventing retrospective alteration of ratings,
 *    screening scores, timestamps, or evidence citations.
 * 3. Strict look-ahead bias prevention: outcome windows (`anchorAtMs < eventAtMs <= targetEndAtMs`) are evaluated ONLY after
 *    `targetEndAtMs <= evaluationAsOfMs`, and any outcome observation whose `eventAtMs <= snapshot.recordedAtMs` is rejected.
 * 4. Multi-benchmark comparison against:
 *    - `QQQ` (broad Nasdaq-100 passive index ETF)
 *    - Sector benchmark (`SOXX` / AI Semiconductor & Cloud Infrastructure cohort)
 *    - Passive Equal-Weight Universe Alternative (`1/N` buy-and-hold across covered universe)
 * 5. Explicit tracking of signal/score transitions, realized volatility, maximum drawdown, transaction cost assumptions,
 *    and data freshness.
 */

export const FORWARD_EVALUATION_VERSION = 'aci-forward-evaluation-v1.0.0' as const;

export type ForwardHorizonKey = '20D_TACTICAL' | '60D_QUARTERLY' | '126D_SEMIANNUAL' | '252D_ANNUAL';

export interface FrozenCompanyAssessmentEntry {
  ticker: string;
  companyName: string;
  sectorLayer: StockResearchAssessment['sectorLayer'];
  assessmentLabel: ResearchAssessmentLabel;
  researchPriorityScore: number | null;
  priorityRank: number | null;
  coveredWeightPct: number;
  essentialGatesPassed: boolean;
  unmetGates: string[];
  anchorCloseUsd: number | null;
  anchorCloseGbp: number | null;
  anchorPriceTimestampMs: number | null;
  anchorPriceSourceId: string;
  citedSourceIds: string[];
}

export interface ImmutableAssessmentSnapshot {
  snapshotId: string;
  ledgerVersion: typeof FORWARD_EVALUATION_VERSION;
  methodologyVersion: typeof RESEARCH_METHODOLOGY_VERSION;
  recordedAtMs: number;
  recordedAtIso: string;
  horizonKey: ForwardHorizonKey;
  horizonSessions: number;
  targetEndAtMs: number;
  targetEndIso: string;
  entries: FrozenCompanyAssessmentEntry[];
  topPriorityCohortTickers: string[];
  snapshotSha256: string;
  executionAuthority: 'none';
}

export interface ForwardMarketBar {
  symbol: string;
  sessionDate: string;
  eventAtMs: number;
  serverReceivedAtMs: number;
  closeUsd: number;
  usdToGbp: number;
  closeGbp: number;
  priceBasis: 'unadjusted_close' | 'split-adjusted' | 'total-return';
  corporateActionsReviewed: boolean;
  sourceId: string;
}

export interface ForwardTransactionCostConfig {
  spreadBps: number;
  slippageBps: number;
  fxConversionBps: number;
  entryFeeGbpPerPosition: number;
  exitFeeGbpPerPosition: number;
  notionalPortfolioGbp: number;
}

export const DEFAULT_FORWARD_TRANSACTION_COSTS: ForwardTransactionCostConfig = {
  spreadBps: 10,
  slippageBps: 5,
  fxConversionBps: 15,
  entryFeeGbpPerPosition: 0,
  exitFeeGbpPerPosition: 0,
  notionalPortfolioGbp: 10_000,
} as const;

export interface CompanyForwardOutcomeRow {
  ticker: string;
  frozenAssessmentLabel: ResearchAssessmentLabel;
  frozenPriorityScore: number | null;
  anchorCloseUsd: number;
  targetCloseUsd: number;
  grossReturnUsdPct: number;
  grossReturnGbpPct: number;
  netReturnGbpPct: number;
  maxDrawdownUsdPct: number;
  realizedAnnualisedVolatilityPct: number;
  sessionsObserved: number;
}

export interface ForwardAssessmentOutcomeReport {
  snapshotId: string;
  snapshotSha256: string;
  snapshotIntegrityVerified: boolean;
  evaluationStatus:
    | 'evaluated_complete'
    | 'horizon_not_elapsed'
    | 'blocked_look_ahead_violation'
    | 'blocked_tampered_snapshot'
    | 'blocked_missing_post_horizon_prices';
  evaluatedAtMs: number;
  evaluatedAtIso: string;
  horizonKey: ForwardHorizonKey;
  horizonSessions: number;
  recordedAtIso: string;
  targetEndIso: string;
  blockingReasons: string[];
  lookAheadBiasCheck: {
    lookAheadPrevented: boolean;
    earliestOutcomeBarAtMs: number | null;
    snapshotRecordedAtMs: number;
    violationDetail: string | null;
  };
  dataFreshness: {
    expectedSessions: number;
    observedSessions: number;
    missingSessionsCount: number;
    maxPriceStalenessDaysAtTarget: number;
    allBarsCorporateActionsReviewed: boolean;
  };
  transactionCostsApplied: ForwardTransactionCostConfig & {
    roundTripBps: number;
  };
  cohortPerformance: {
    cohortTickers: string[];
    grossReturnUsdPct: number | null;
    grossReturnGbpPct: number | null;
    netReturnGbpPct: number | null;
    maxDrawdownUsdPct: number | null;
    realizedAnnualisedVolatilityPct: number | null;
  };
  benchmarks: {
    qqqBroadMarket: {
      benchmarkSymbol: 'QQQ';
      returnUsdPct: number | null;
      returnGbpPct: number | null;
      maxDrawdownUsdPct: number | null;
      netExcessReturnGbpPct: number | null;
    };
    sectorBenchmark: {
      benchmarkSymbol: string;
      returnUsdPct: number | null;
      returnGbpPct: number | null;
      maxDrawdownUsdPct: number | null;
      netExcessReturnGbpPct: number | null;
    };
    passiveEqualWeightUniverse: {
      constituentTickers: string[];
      grossReturnUsdPct: number | null;
      netReturnGbpPct: number | null;
      maxDrawdownUsdPct: number | null;
      cohortNetExcessVsPassiveEqualWeightGbpPct: number | null;
    };
  };
  companyOutcomes: CompanyForwardOutcomeRow[];
  executionAuthority: 'none';
}

export interface AssessmentTransitionEntry {
  ticker: string;
  priorAssessmentLabel: ResearchAssessmentLabel;
  currentAssessmentLabel: ResearchAssessmentLabel;
  labelChanged: boolean;
  priorPriorityScore: number | null;
  currentPriorityScore: number | null;
  priorityScoreDelta: number | null;
  priorRank: number | null;
  currentRank: number | null;
  rankDelta: number | null;
  priorCoveredWeightPct: number;
  currentCoveredWeightPct: number;
  newlyResolvedGates: string[];
  newlyBlockedGates: string[];
}

export interface AssessmentTransitionLedger {
  priorSnapshotId: string;
  currentSnapshotId: string;
  priorRecordedAtIso: string;
  currentRecordedAtIso: string;
  anyDirectionalLabelChanged: boolean;
  anyPriorityRankChanged: boolean;
  transitions: AssessmentTransitionEntry[];
}

function canonicalJsonString(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonString).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJsonString(v)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function computeCanonicalSnapshotSha256(
  payloadWithoutHash: Omit<ImmutableAssessmentSnapshot, 'snapshotSha256'>,
): string {
  return sha256Hex(canonicalJsonString(payloadWithoutHash));
}

const HORIZON_SESSIONS_MAP: Record<ForwardHorizonKey, number> = {
  '20D_TACTICAL': 20,
  '60D_QUARTERLY': 60,
  '126D_SEMIANNUAL': 126,
  '252D_ANNUAL': 252,
};

/**
 * Creates a timestamped, immutable research assessment snapshot with a SHA-256 content hash.
 */
export function createImmutableAssessmentSnapshot(params?: {
  recordedAtMs?: number;
  horizonKey?: ForwardHorizonKey;
  assessments?: StockResearchAssessment[];
}): ImmutableAssessmentSnapshot {
  const recordedAtMs = params?.recordedAtMs ?? Date.now();
  const horizonKey = params?.horizonKey ?? '60D_QUARTERLY';
  const horizonSessions = HORIZON_SESSIONS_MAP[horizonKey];
  // Approximate calendar days for trading sessions (~1.45 calendar days per trading session)
  const targetEndAtMs = recordedAtMs + Math.round(horizonSessions * 1.45 * 86_400_000);
  const assessments =
    params?.assessments ?? evaluateUniverseResearchAssessments({ asOfMs: recordedAtMs });

  const scoredSorted = [...assessments]
    .filter((a) => a.researchPriorityScore !== null)
    .sort((a, b) => (b.researchPriorityScore ?? -1) - (a.researchPriorityScore ?? -1));

  const rankByTicker = new Map<string, number>();
  scoredSorted.forEach((a, idx) => rankByTicker.set(a.ticker, idx + 1));

  const entries: FrozenCompanyAssessmentEntry[] = assessments.map((a) => ({
    ticker: a.ticker,
    companyName: a.companyName,
    sectorLayer: a.sectorLayer,
    assessmentLabel: a.assessment,
    researchPriorityScore: a.researchPriorityScore,
    priorityRank: rankByTicker.get(a.ticker) ?? null,
    coveredWeightPct: a.evidenceCoverage.coveredWeightPct,
    essentialGatesPassed: a.evidenceCoverage.essentialGatesPassed,
    unmetGates: [...a.evidenceCoverage.unmetGates],
    anchorCloseUsd: a.latestPrice.close,
    anchorCloseGbp: a.latestPrice.closeGbp,
    anchorPriceTimestampMs: a.latestPrice.timestampMs,
    anchorPriceSourceId: a.latestPrice.sourceId,
    citedSourceIds: [...a.layers.sourceGroundedInterpretation.citedSourceIds],
  }));

  const topPriorityCohortTickers = scoredSorted.slice(0, 2).map((a) => a.ticker);
  const recordedAtIso = new Date(recordedAtMs).toISOString();
  const targetEndIso = new Date(targetEndAtMs).toISOString();
  const snapshotId = `aci-snap-${horizonKey.toLowerCase()}-${recordedAtMs}`;

  const payloadWithoutHash: Omit<ImmutableAssessmentSnapshot, 'snapshotSha256'> = {
    snapshotId,
    ledgerVersion: FORWARD_EVALUATION_VERSION,
    methodologyVersion: RESEARCH_METHODOLOGY_VERSION,
    recordedAtMs,
    recordedAtIso,
    horizonKey,
    horizonSessions,
    targetEndAtMs,
    targetEndIso,
    entries,
    topPriorityCohortTickers,
    executionAuthority: 'none',
  };

  const snapshotSha256 = computeCanonicalSnapshotSha256(payloadWithoutHash);
  return {
    ...payloadWithoutHash,
    snapshotSha256,
  };
}

/**
 * Verifies that an immutable snapshot has not been retrospectively modified after registration.
 */
export function verifyAssessmentSnapshotIntegrity(snapshot: ImmutableAssessmentSnapshot): {
  isTamperFree: boolean;
  expectedSha256: string;
  actualSha256: string;
} {
  const { snapshotSha256, ...rest } = snapshot;
  const recomputed = computeCanonicalSnapshotSha256(rest);
  return {
    isTamperFree: recomputed === snapshotSha256,
    expectedSha256: snapshotSha256,
    actualSha256: recomputed,
  };
}

/**
 * Tracks signal, score, rank, and gate transitions between two timestamped snapshots.
 */
export function computeAssessmentTransitionLedger(
  priorSnapshot: ImmutableAssessmentSnapshot,
  currentSnapshot: ImmutableAssessmentSnapshot,
): AssessmentTransitionLedger {
  const priorByTicker = new Map(priorSnapshot.entries.map((e) => [e.ticker, e]));
  const transitions: AssessmentTransitionEntry[] = [];

  for (const curr of currentSnapshot.entries) {
    const prior = priorByTicker.get(curr.ticker);
    if (!prior) continue;

    const priorGates = new Set(prior.unmetGates);
    const currGates = new Set(curr.unmetGates);
    const newlyResolvedGates = prior.unmetGates.filter((g) => !currGates.has(g));
    const newlyBlockedGates = curr.unmetGates.filter((g) => !priorGates.has(g));

    transitions.push({
      ticker: curr.ticker,
      priorAssessmentLabel: prior.assessmentLabel,
      currentAssessmentLabel: curr.assessmentLabel,
      labelChanged: prior.assessmentLabel !== curr.assessmentLabel,
      priorPriorityScore: prior.researchPriorityScore,
      currentPriorityScore: curr.researchPriorityScore,
      priorityScoreDelta:
        prior.researchPriorityScore !== null && curr.researchPriorityScore !== null
          ? Number((curr.researchPriorityScore - prior.researchPriorityScore).toFixed(2))
          : null,
      priorRank: prior.priorityRank,
      currentRank: curr.priorityRank,
      rankDelta:
        prior.priorityRank !== null && curr.priorityRank !== null
          ? prior.priorityRank - curr.priorityRank // positive = moved up in rank
          : null,
      priorCoveredWeightPct: prior.coveredWeightPct,
      currentCoveredWeightPct: curr.coveredWeightPct,
      newlyResolvedGates,
      newlyBlockedGates,
    });
  }

  return {
    priorSnapshotId: priorSnapshot.snapshotId,
    currentSnapshotId: currentSnapshot.snapshotId,
    priorRecordedAtIso: priorSnapshot.recordedAtIso,
    currentRecordedAtIso: currentSnapshot.recordedAtIso,
    anyDirectionalLabelChanged: transitions.some((t) => t.labelChanged),
    anyPriorityRankChanged: transitions.some((t) => (t.rankDelta ?? 0) !== 0),
    transitions,
  };
}

function computeSeriesMaxDrawdownPct(closes: number[]): number {
  if (closes.length < 2) return 0;
  let peak = closes[0]!;
  let maxDd = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    const dd = peak > 0 ? ((c - peak) / peak) * 100 : 0;
    if (dd < maxDd) maxDd = dd;
  }
  return Number(maxDd.toFixed(2));
}

function computeAnnualisedVolatilityPct(closes: number[]): number {
  if (closes.length < 3) return 0;
  const dailyReturns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]!;
    const curr = closes[i]!;
    if (prev > 0) {
      dailyReturns.push(curr / prev - 1);
    }
  }
  if (dailyReturns.length < 2) return 0;
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance =
    dailyReturns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (dailyReturns.length - 1);
  return Number((Math.sqrt(variance) * Math.sqrt(252) * 100).toFixed(2));
}

/**
 * Evaluates subsequent market outcomes for an immutable assessment snapshot against QQQ,
 * a sector benchmark (e.g., `SOXX`), and a passive equal-weight universe alternative.
 */
export function evaluateForwardAssessmentOutcomes(params: {
  snapshot: ImmutableAssessmentSnapshot;
  postSnapshotBars: ForwardMarketBar[];
  evaluationAsOfMs: number;
  sectorBenchmarkSymbol?: string;
  transactionCosts?: ForwardTransactionCostConfig;
}): ForwardAssessmentOutcomeReport {
  const {
    snapshot,
    postSnapshotBars,
    evaluationAsOfMs,
    sectorBenchmarkSymbol = 'SOXX',
    transactionCosts = DEFAULT_FORWARD_TRANSACTION_COSTS,
  } = params;

  const roundTripBps =
    (transactionCosts.spreadBps +
      transactionCosts.slippageBps +
      transactionCosts.fxConversionBps) *
    2;

  // 1. Verify cryptographic integrity of the snapshot
  const integrity = verifyAssessmentSnapshotIntegrity(snapshot);
  if (!integrity.isTamperFree) {
    return {
      snapshotId: snapshot.snapshotId,
      snapshotSha256: snapshot.snapshotSha256,
      snapshotIntegrityVerified: false,
      evaluationStatus: 'blocked_tampered_snapshot',
      evaluatedAtMs: evaluationAsOfMs,
      evaluatedAtIso: new Date(evaluationAsOfMs).toISOString(),
      horizonKey: snapshot.horizonKey,
      horizonSessions: snapshot.horizonSessions,
      recordedAtIso: snapshot.recordedAtIso,
      targetEndIso: snapshot.targetEndIso,
      blockingReasons: [
        `Cryptographic SHA-256 mismatch on snapshot ${snapshot.snapshotId}: expected ${integrity.expectedSha256}, computed ${integrity.actualSha256}. Retrospectively altered snapshots cannot be scored.`,
      ],
      lookAheadBiasCheck: {
        lookAheadPrevented: true,
        earliestOutcomeBarAtMs: null,
        snapshotRecordedAtMs: snapshot.recordedAtMs,
        violationDetail: null,
      },
      dataFreshness: {
        expectedSessions: snapshot.horizonSessions,
        observedSessions: 0,
        missingSessionsCount: snapshot.horizonSessions,
        maxPriceStalenessDaysAtTarget: 0,
        allBarsCorporateActionsReviewed: false,
      },
      transactionCostsApplied: { ...transactionCosts, roundTripBps },
      cohortPerformance: {
        cohortTickers: snapshot.topPriorityCohortTickers,
        grossReturnUsdPct: null,
        grossReturnGbpPct: null,
        netReturnGbpPct: null,
        maxDrawdownUsdPct: null,
        realizedAnnualisedVolatilityPct: null,
      },
      benchmarks: {
        qqqBroadMarket: {
          benchmarkSymbol: 'QQQ',
          returnUsdPct: null,
          returnGbpPct: null,
          maxDrawdownUsdPct: null,
          netExcessReturnGbpPct: null,
        },
        sectorBenchmark: {
          benchmarkSymbol: sectorBenchmarkSymbol,
          returnUsdPct: null,
          returnGbpPct: null,
          maxDrawdownUsdPct: null,
          netExcessReturnGbpPct: null,
        },
        passiveEqualWeightUniverse: {
          constituentTickers: snapshot.entries.map((e) => e.ticker),
          grossReturnUsdPct: null,
          netReturnGbpPct: null,
          maxDrawdownUsdPct: null,
          cohortNetExcessVsPassiveEqualWeightGbpPct: null,
        },
      },
      companyOutcomes: [],
      executionAuthority: 'none',
    };
  }

  // 2. Check for look-ahead violations (any outcome bar dated on or before snapshot.recordedAtMs)
  const sortedBars = [...postSnapshotBars].sort((a, b) => a.eventAtMs - b.eventAtMs);
  const earliestBarAt = sortedBars[0]?.eventAtMs ?? null;
  const lookAheadBar = sortedBars.find(
    (b) => b.eventAtMs <= snapshot.recordedAtMs || b.serverReceivedAtMs <= snapshot.recordedAtMs,
  );
  if (lookAheadBar) {
    const detail = `Outcome bar for ${lookAheadBar.symbol} on ${lookAheadBar.sessionDate} (eventAt=${lookAheadBar.eventAtMs}) is on or before snapshot recordedAt (${snapshot.recordedAtMs}).`;
    return {
      snapshotId: snapshot.snapshotId,
      snapshotSha256: snapshot.snapshotSha256,
      snapshotIntegrityVerified: true,
      evaluationStatus: 'blocked_look_ahead_violation',
      evaluatedAtMs: evaluationAsOfMs,
      evaluatedAtIso: new Date(evaluationAsOfMs).toISOString(),
      horizonKey: snapshot.horizonKey,
      horizonSessions: snapshot.horizonSessions,
      recordedAtIso: snapshot.recordedAtIso,
      targetEndIso: snapshot.targetEndIso,
      blockingReasons: [detail],
      lookAheadBiasCheck: {
        lookAheadPrevented: true,
        earliestOutcomeBarAtMs: earliestBarAt,
        snapshotRecordedAtMs: snapshot.recordedAtMs,
        violationDetail: detail,
      },
      dataFreshness: {
        expectedSessions: snapshot.horizonSessions,
        observedSessions: 0,
        missingSessionsCount: snapshot.horizonSessions,
        maxPriceStalenessDaysAtTarget: 0,
        allBarsCorporateActionsReviewed: false,
      },
      transactionCostsApplied: { ...transactionCosts, roundTripBps },
      cohortPerformance: {
        cohortTickers: snapshot.topPriorityCohortTickers,
        grossReturnUsdPct: null,
        grossReturnGbpPct: null,
        netReturnGbpPct: null,
        maxDrawdownUsdPct: null,
        realizedAnnualisedVolatilityPct: null,
      },
      benchmarks: {
        qqqBroadMarket: {
          benchmarkSymbol: 'QQQ',
          returnUsdPct: null,
          returnGbpPct: null,
          maxDrawdownUsdPct: null,
          netExcessReturnGbpPct: null,
        },
        sectorBenchmark: {
          benchmarkSymbol: sectorBenchmarkSymbol,
          returnUsdPct: null,
          returnGbpPct: null,
          maxDrawdownUsdPct: null,
          netExcessReturnGbpPct: null,
        },
        passiveEqualWeightUniverse: {
          constituentTickers: snapshot.entries.map((e) => e.ticker),
          grossReturnUsdPct: null,
          netReturnGbpPct: null,
          maxDrawdownUsdPct: null,
          cohortNetExcessVsPassiveEqualWeightGbpPct: null,
        },
      },
      companyOutcomes: [],
      executionAuthority: 'none',
    };
  }

  // 3. Check if forward horizon has elapsed
  if (evaluationAsOfMs < snapshot.targetEndAtMs) {
    return {
      snapshotId: snapshot.snapshotId,
      snapshotSha256: snapshot.snapshotSha256,
      snapshotIntegrityVerified: true,
      evaluationStatus: 'horizon_not_elapsed',
      evaluatedAtMs: evaluationAsOfMs,
      evaluatedAtIso: new Date(evaluationAsOfMs).toISOString(),
      horizonKey: snapshot.horizonKey,
      horizonSessions: snapshot.horizonSessions,
      recordedAtIso: snapshot.recordedAtIso,
      targetEndIso: snapshot.targetEndIso,
      blockingReasons: [
        `Forward horizon (${snapshot.horizonKey}, ${snapshot.horizonSessions} sessions) completes at ${snapshot.targetEndIso}, which is after evaluation time ${new Date(evaluationAsOfMs).toISOString()}.`,
      ],
      lookAheadBiasCheck: {
        lookAheadPrevented: true,
        earliestOutcomeBarAtMs: earliestBarAt,
        snapshotRecordedAtMs: snapshot.recordedAtMs,
        violationDetail: null,
      },
      dataFreshness: {
        expectedSessions: snapshot.horizonSessions,
        observedSessions: 0,
        missingSessionsCount: snapshot.horizonSessions,
        maxPriceStalenessDaysAtTarget: 0,
        allBarsCorporateActionsReviewed: false,
      },
      transactionCostsApplied: { ...transactionCosts, roundTripBps },
      cohortPerformance: {
        cohortTickers: snapshot.topPriorityCohortTickers,
        grossReturnUsdPct: null,
        grossReturnGbpPct: null,
        netReturnGbpPct: null,
        maxDrawdownUsdPct: null,
        realizedAnnualisedVolatilityPct: null,
      },
      benchmarks: {
        qqqBroadMarket: {
          benchmarkSymbol: 'QQQ',
          returnUsdPct: null,
          returnGbpPct: null,
          maxDrawdownUsdPct: null,
          netExcessReturnGbpPct: null,
        },
        sectorBenchmark: {
          benchmarkSymbol: sectorBenchmarkSymbol,
          returnUsdPct: null,
          returnGbpPct: null,
          maxDrawdownUsdPct: null,
          netExcessReturnGbpPct: null,
        },
        passiveEqualWeightUniverse: {
          constituentTickers: snapshot.entries.map((e) => e.ticker),
          grossReturnUsdPct: null,
          netReturnGbpPct: null,
          maxDrawdownUsdPct: null,
          cohortNetExcessVsPassiveEqualWeightGbpPct: null,
        },
      },
      companyOutcomes: [],
      executionAuthority: 'none',
    };
  }

  // 4. Group eligible bars (snapshot.recordedAtMs < eventAtMs <= snapshot.targetEndAtMs) by symbol
  const eligibleBars = sortedBars.filter(
    (b) =>
      b.eventAtMs > snapshot.recordedAtMs &&
      b.eventAtMs <= snapshot.targetEndAtMs &&
      b.serverReceivedAtMs <= evaluationAsOfMs,
  );

  const bySymbol = new Map<string, ForwardMarketBar[]>();
  for (const bar of eligibleBars) {
    const list = bySymbol.get(bar.symbol) ?? [];
    list.push(bar);
    bySymbol.set(bar.symbol, list);
  }

  const missingSymbolReasons: string[] = [];
  for (const entry of snapshot.entries) {
    const bars = bySymbol.get(entry.ticker) ?? [];
    const hasAnchor = entry.anchorCloseUsd !== null && entry.anchorCloseGbp !== null;
    if (bars.length === 0 || (!hasAnchor && bars.length < 2)) {
      missingSymbolReasons.push(
        `Missing post-horizon price observations or anchor close for ${entry.ticker}.`,
      );
    }
  }
  if ((bySymbol.get('QQQ') ?? []).length < 2) {
    missingSymbolReasons.push('Missing post-horizon price observations for QQQ benchmark.');
  }
  if ((bySymbol.get(sectorBenchmarkSymbol) ?? []).length < 2) {
    missingSymbolReasons.push(
      `Missing post-horizon price observations for sector benchmark ${sectorBenchmarkSymbol}.`,
    );
  }

  if (missingSymbolReasons.length > 0) {
    return {
      snapshotId: snapshot.snapshotId,
      snapshotSha256: snapshot.snapshotSha256,
      snapshotIntegrityVerified: true,
      evaluationStatus: 'blocked_missing_post_horizon_prices',
      evaluatedAtMs: evaluationAsOfMs,
      evaluatedAtIso: new Date(evaluationAsOfMs).toISOString(),
      horizonKey: snapshot.horizonKey,
      horizonSessions: snapshot.horizonSessions,
      recordedAtIso: snapshot.recordedAtIso,
      targetEndIso: snapshot.targetEndIso,
      blockingReasons: missingSymbolReasons,
      lookAheadBiasCheck: {
        lookAheadPrevented: true,
        earliestOutcomeBarAtMs: earliestBarAt,
        snapshotRecordedAtMs: snapshot.recordedAtMs,
        violationDetail: null,
      },
      dataFreshness: {
        expectedSessions: snapshot.horizonSessions,
        observedSessions: 0,
        missingSessionsCount: snapshot.horizonSessions,
        maxPriceStalenessDaysAtTarget: 0,
        allBarsCorporateActionsReviewed: false,
      },
      transactionCostsApplied: { ...transactionCosts, roundTripBps },
      cohortPerformance: {
        cohortTickers: snapshot.topPriorityCohortTickers,
        grossReturnUsdPct: null,
        grossReturnGbpPct: null,
        netReturnGbpPct: null,
        maxDrawdownUsdPct: null,
        realizedAnnualisedVolatilityPct: null,
      },
      benchmarks: {
        qqqBroadMarket: {
          benchmarkSymbol: 'QQQ',
          returnUsdPct: null,
          returnGbpPct: null,
          maxDrawdownUsdPct: null,
          netExcessReturnGbpPct: null,
        },
        sectorBenchmark: {
          benchmarkSymbol: sectorBenchmarkSymbol,
          returnUsdPct: null,
          returnGbpPct: null,
          maxDrawdownUsdPct: null,
          netExcessReturnGbpPct: null,
        },
        passiveEqualWeightUniverse: {
          constituentTickers: snapshot.entries.map((e) => e.ticker),
          grossReturnUsdPct: null,
          netReturnGbpPct: null,
          maxDrawdownUsdPct: null,
          cohortNetExcessVsPassiveEqualWeightGbpPct: null,
        },
      },
      companyOutcomes: [],
      executionAuthority: 'none',
    };
  }

  const frictionPct = roundTripBps / 100; // e.g., 60 bps = 0.60%
  const companyOutcomes: CompanyForwardOutcomeRow[] = [];

  for (const entry of snapshot.entries) {
    const bars = bySymbol.get(entry.ticker)!;
    const anchorUsd = entry.anchorCloseUsd ?? bars[0]!.closeUsd;
    const anchorGbp = entry.anchorCloseGbp ?? bars[0]!.closeGbp;
    const targetBar = bars.at(-1)!;
    const seriesUsd = [anchorUsd, ...bars.map((b) => b.closeUsd)];

    const grossUsdPct = Number((((targetBar.closeUsd - anchorUsd) / anchorUsd) * 100).toFixed(2));
    const grossGbpPct = Number((((targetBar.closeGbp - anchorGbp) / anchorGbp) * 100).toFixed(2));
    const netGbpPct = Number((grossGbpPct - frictionPct).toFixed(2));

    companyOutcomes.push({
      ticker: entry.ticker,
      frozenAssessmentLabel: entry.assessmentLabel,
      frozenPriorityScore: entry.researchPriorityScore,
      anchorCloseUsd: anchorUsd,
      targetCloseUsd: targetBar.closeUsd,
      grossReturnUsdPct: grossUsdPct,
      grossReturnGbpPct: grossGbpPct,
      netReturnGbpPct: netGbpPct,
      maxDrawdownUsdPct: computeSeriesMaxDrawdownPct(seriesUsd),
      realizedAnnualisedVolatilityPct: computeAnnualisedVolatilityPct(seriesUsd),
      sessionsObserved: bars.length,
    });
  }

  const cohortSet = new Set(snapshot.topPriorityCohortTickers);
  const cohortRows = companyOutcomes.filter((r) => cohortSet.has(r.ticker));
  const avg = (vals: number[]) =>
    vals.length > 0
      ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2))
      : null;

  const cohortGrossUsd = avg(cohortRows.map((r) => r.grossReturnUsdPct));
  const cohortGrossGbp = avg(cohortRows.map((r) => r.grossReturnGbpPct));
  const cohortNetGbp = avg(cohortRows.map((r) => r.netReturnGbpPct));
  const cohortMaxDd = avg(cohortRows.map((r) => r.maxDrawdownUsdPct));
  const cohortVol = avg(cohortRows.map((r) => r.realizedAnnualisedVolatilityPct));

  // Benchmarks: QQQ and sectorBenchmarkSymbol
  const qqqBars = bySymbol.get('QQQ')!;
  const qqqFirst = qqqBars[0]!;
  const qqqLast = qqqBars.at(-1)!;
  const qqqRetUsd = Number((((qqqLast.closeUsd - qqqFirst.closeUsd) / qqqFirst.closeUsd) * 100).toFixed(2));
  const qqqRetGbp = Number((((qqqLast.closeGbp - qqqFirst.closeGbp) / qqqFirst.closeGbp) * 100).toFixed(2));
  const qqqDd = computeSeriesMaxDrawdownPct(qqqBars.map((b) => b.closeUsd));

  const secBars = bySymbol.get(sectorBenchmarkSymbol)!;
  const secFirst = secBars[0]!;
  const secLast = secBars.at(-1)!;
  const secRetUsd = Number((((secLast.closeUsd - secFirst.closeUsd) / secFirst.closeUsd) * 100).toFixed(2));
  const secRetGbp = Number((((secLast.closeGbp - secFirst.closeGbp) / secFirst.closeGbp) * 100).toFixed(2));
  const secDd = computeSeriesMaxDrawdownPct(secBars.map((b) => b.closeUsd));

  // Passive Equal-Weight Universe Alternative (all 7 stocks)
  const passiveGrossUsd = avg(companyOutcomes.map((r) => r.grossReturnUsdPct));
  const passiveNetGbp = avg(companyOutcomes.map((r) => r.netReturnGbpPct));
  const passiveDd = avg(companyOutcomes.map((r) => r.maxDrawdownUsdPct));

  const observedSessions = Math.min(...companyOutcomes.map((r) => r.sessionsObserved));
  const latestTargetAt = Math.max(...eligibleBars.map((b) => b.eventAtMs));
  const stalenessDays = Math.max(
    0,
    Number(((snapshot.targetEndAtMs - latestTargetAt) / 86_400_000).toFixed(1)),
  );
  const allCorpReviewed = eligibleBars.every((b) => b.corporateActionsReviewed);

  return {
    snapshotId: snapshot.snapshotId,
    snapshotSha256: snapshot.snapshotSha256,
    snapshotIntegrityVerified: true,
    evaluationStatus: 'evaluated_complete',
    evaluatedAtMs: evaluationAsOfMs,
    evaluatedAtIso: new Date(evaluationAsOfMs).toISOString(),
    horizonKey: snapshot.horizonKey,
    horizonSessions: snapshot.horizonSessions,
    recordedAtIso: snapshot.recordedAtIso,
    targetEndIso: snapshot.targetEndIso,
    blockingReasons: [],
    lookAheadBiasCheck: {
      lookAheadPrevented: true,
      earliestOutcomeBarAtMs: earliestBarAt,
      snapshotRecordedAtMs: snapshot.recordedAtMs,
      violationDetail: null,
    },
    dataFreshness: {
      expectedSessions: snapshot.horizonSessions,
      observedSessions,
      missingSessionsCount: Math.max(0, snapshot.horizonSessions - observedSessions),
      maxPriceStalenessDaysAtTarget: stalenessDays,
      allBarsCorporateActionsReviewed: allCorpReviewed,
    },
    transactionCostsApplied: { ...transactionCosts, roundTripBps },
    cohortPerformance: {
      cohortTickers: snapshot.topPriorityCohortTickers,
      grossReturnUsdPct: cohortGrossUsd,
      grossReturnGbpPct: cohortGrossGbp,
      netReturnGbpPct: cohortNetGbp,
      maxDrawdownUsdPct: cohortMaxDd,
      realizedAnnualisedVolatilityPct: cohortVol,
    },
    benchmarks: {
      qqqBroadMarket: {
        benchmarkSymbol: 'QQQ',
        returnUsdPct: qqqRetUsd,
        returnGbpPct: qqqRetGbp,
        maxDrawdownUsdPct: qqqDd,
        netExcessReturnGbpPct:
          cohortNetGbp !== null ? Number((cohortNetGbp - qqqRetGbp).toFixed(2)) : null,
      },
      sectorBenchmark: {
        benchmarkSymbol: sectorBenchmarkSymbol,
        returnUsdPct: secRetUsd,
        returnGbpPct: secRetGbp,
        maxDrawdownUsdPct: secDd,
        netExcessReturnGbpPct:
          cohortNetGbp !== null ? Number((cohortNetGbp - secRetGbp).toFixed(2)) : null,
      },
      passiveEqualWeightUniverse: {
        constituentTickers: companyOutcomes.map((r) => r.ticker),
        grossReturnUsdPct: passiveGrossUsd,
        netReturnGbpPct: passiveNetGbp,
        maxDrawdownUsdPct: passiveDd,
        cohortNetExcessVsPassiveEqualWeightGbpPct:
          cohortNetGbp !== null && passiveNetGbp !== null
            ? Number((cohortNetGbp - passiveNetGbp).toFixed(2))
            : null,
      },
    },
    companyOutcomes,
    executionAuthority: 'none',
  };
}
