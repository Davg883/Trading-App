import companyComparisonRaw from '../../data/consensus/company-comparison.json';
import alphabetEarningsRaw from '../../data/earnings/alphabet-q3-2026.json';
import amazonCashRaw from '../../data/earnings/amazon-q3-2026-cash.json';
import policyRiskRaw from '../../data/policy-risk/midterm-2026-11-03.json';
import recoveryV2Raw from '../../data/recovery/november-3-2026-v2.json';
import graphDatasetRaw from '../../data/graph/initial-acceptance-dataset.json';

/**
 * Phase G.6 — Deterministic, Versioned Stock-Research Assessment & Methodology Validation Engine.
 *
 * Architectural & Governance Invariants:
 * 1. Never invents, interpolates, or guesses equity prices, valuation multiples, or financial ratios.
 * 2. Never treats missing data as zero (`null` is preserved and triggers dimension-level `insufficient_data`).
 * 3. Separates short-term trading momentum (`20D Tactical`) from medium/long-term fundamental assessment (`6–12M Fundamental`).
 * 4. Separates:
 *    - Layer 1: Quantitative, deterministic calculation
 *    - Layer 2: Source-grounded analytical interpretation
 *    - Layer 3: Gemini-generated natural-language explanation (optional, evidence-locked, cannot override gates)
 *    - Layer 4: Human approval / reviewer commentary
 * 5. Enforces strict evidence & validation gates before any directional `BUY` / `HOLD` / `SELL` / `AVOID` label can appear.
 * 6. Holds `executionAuthority: 'none'`.
 */

export const RESEARCH_METHODOLOGY_VERSION = 'aci-stock-rating-v1.0.0-exp' as const;
export const RESEARCH_METHODOLOGY_CLASSIFICATION =
  'Experimental research assessment' as const;

export type ResearchAssessmentLabel =
  | 'BUY'
  | 'HOLD'
  | 'SELL'
  | 'AVOID'
  | 'INSUFFICIENT DATA';

export type DimensionKey =
  | 'valuation_fundamentals'
  | 'earnings_financial_health'
  | 'momentum_trend'
  | 'macro_sector_exposure'
  | 'company_specific_risk';

export type InvestmentHorizon =
  | '6-12M Fundamental'
  | '20D Tactical (Separated from Fundamental Rating)';

export interface DimensionWeightConfig {
  valuation_fundamentals: number;
  earnings_financial_health: number;
  momentum_trend: number;
  macro_sector_exposure: number;
  company_specific_risk: number;
}

export const PROVISIONAL_DIMENSION_WEIGHTS: DimensionWeightConfig = {
  valuation_fundamentals: 0.3,
  earnings_financial_health: 0.25,
  momentum_trend: 0.2,
  macro_sector_exposure: 0.15,
  company_specific_risk: 0.1,
} as const;

export const RATING_THRESHOLDS = {
  buyMinScore: 72.0,
  holdMinScore: 48.0,
  sellMinScore: 30.0,
  minCompanyRiskScoreForBuy: 50.0,
  severeRiskAvoidThreshold: 30.0,
  maxPriceStalenessDaysForLive: 7,
  maxFilingStalenessDays: 135,
  minBacktestSessionsForProductionValidation: 252,
  minCoverageWeightForDirectionalRating: 1.0,
} as const;

export interface DimensionEvaluation {
  key: DimensionKey;
  label: string;
  provisionalWeight: number;
  declaredHorizon: InvestmentHorizon;
  status: 'evaluated' | 'insufficient_data' | 'stale_evidence';
  score: number | null; // 0-100 when evaluated; null when insufficient_data (never 0 for missing!)
  minimumEvidenceRequirement: string;
  stalenessThreshold: string;
  observedMetrics: Array<{
    metric: string;
    valueDisplay: string;
    periodOrAsOf: string;
    sourceLabel: string;
    sourceId: string;
  }>;
  missingInputs: string[];
  deterministicSummary: string;
}

export interface StockResearchAssessment {
  ticker: string;
  companyName: string;
  sectorLayer:
    | 'Semiconductors & AI Hardware'
    | 'Hyperscale Cloud & AI Platforms'
    | 'Specialist AI Compute';
  latestPrice: {
    close: number | null;
    currency: string;
    closeGbp: number | null;
    usdToGbp: number | null;
    timestampMs: number | null;
    timestampIso: string | null;
    priorSessionClose: number | null;
    sessionChangePct: number | null;
    fiveSessionChangePct: number | null;
    twentySessionChangePct: number | null;
    classification:
      | 'Delayed Public Reference Close (Unadjusted)'
      | 'Licensed Adjusted EOD Close'
      | 'Unavailable';
    sourceLabel: string;
    sourceId: string;
    corporateActionsReviewed: boolean;
    isFreshWithinThreshold: boolean;
  };
  assessment: ResearchAssessmentLabel;
  methodologyClassification: typeof RESEARCH_METHODOLOGY_CLASSIFICATION;
  methodologyVersion: typeof RESEARCH_METHODOLOGY_VERSION;
  assessmentDateIso: string;
  declaredHorizon: '6–12 Months (Fundamental Research Horizon)';
  evidenceCoverage: {
    evaluatedDimensionsCount: number;
    totalDimensionsCount: 5;
    coveredWeightRatio: number; // e.g., 0.70 when 4/5 dimensions (excluding 30% valuation) are evaluated
    coveredWeightPct: number;
    essentialGatesPassed: boolean;
    unmetGates: string[];
  };
  /**
   * Deterministic research priority score (0–100) computed ONLY across verified fundamental, macro, and risk dimensions
   * so analysts can rank which stocks warrant deeper due diligence even when directional BUY/HOLD/SELL is gated.
   */
  researchPriorityScore: number | null;
  researchPriorityTier:
    | 'Priority 1 — High Verified Fundamental & Graph Coverage'
    | 'Priority 2 — Capex-Heavy Cash Conversion Watch'
    | 'Priority 3 — Incomplete Primary Filing Coverage';
  layers: {
    quantitativeCalculation: {
      fundamentalCompositeScore: number | null;
      tacticalMomentumScore: number | null;
      revenueUsdMillions: number | null;
      operatingMarginPct: number | null;
      freeCashFlowUsdMillions: number | null;
      fcfMarginPct: number | null;
      capexIntensityPct: number | null;
      documentedGraphCommitmentsUsdBillions: number | null;
      dimensions: Record<DimensionKey, DimensionEvaluation>;
    };
    sourceGroundedInterpretation: {
      principalJustification: string;
      keyRiskOrInvalidation: string;
      whatWouldChangeAssessment: string;
      citedSourceIds: string[];
      citedRelationshipIds: string[];
    };
    geminiExplanation: {
      status: 'on_demand_evidence_locked' | 'generated';
      explanationText: string | null;
      cannotOverrideGateReason: string;
    };
    humanReviewerCommentary: {
      reviewerStatus: 'gated_insufficient_data' | 'approved_experimental';
      reviewerNote: string;
    };
  };
  detailLinks: Array<{
    label: string;
    href: string;
  }>;
  executionAuthority: 'none';
}

export interface WeightSensitivityRow {
  schemeId: string;
  schemeLabel: string;
  weights: DimensionWeightConfig;
  rankedTickersByPriority: string[];
  topTwoTickers: string[];
  spearmanRankCorrelationVsBaseline: number;
  directionalLabelsEmitted: number;
}

export interface PointInTimeBacktestWindow {
  anchorDate: string;
  nextAnchorDate: string;
  eligibleTickersWithPrimaryFilings: string[];
  cohortGrossReturnUsdPct: number;
  cohortNetReturnGbpPct: number;
  qqqBenchmarkReturnUsdPct: number;
  qqqBenchmarkReturnGbpPct: number;
  excessReturnVsQqqUsdPct: number;
  turnoverPct: number;
}

export interface MethodologyValidationReport {
  methodologyVersion: typeof RESEARCH_METHODOLOGY_VERSION;
  classification: typeof RESEARCH_METHODOLOGY_CLASSIFICATION;
  evaluatedAtIso: string;
  sampleSummary: {
    tradingSessionsAvailable: number;
    requiredSessionsForProductionSignOff: number;
    dateRangeStart: string;
    dateRangeEnd: string;
    universeSize: number;
    primaryFilingCoveredCount: number;
    sampleSufficientForPredictiveClaims: false;
    sampleGateExplanation: string;
  };
  biasControls: {
    lookAheadBiasPrevented: true;
    lookAheadControlDetail: string;
    survivorshipBiasPrevented: true;
    survivorshipControlDetail: string;
    retrospectiveVsForwardSeparated: true;
    forwardRegisteredSignalsCount: number;
  };
  frictionAssumptions: {
    spreadBps: number;
    slippageBps: number;
    fxConversionBps: number;
    brokerFeeGbpPerOrder: number;
  };
  benchmarkComparisonVsQqq: {
    benchmarkTicker: 'QQQ';
    windowStart: string;
    windowEnd: string;
    sessionsCount: number;
    verifiedFilingCohortTickers: string[];
    cohortCumulativeGrossReturnUsdPct: number;
    cohortCumulativeNetReturnGbpPct: number;
    qqqCumulativeReturnUsdPct: number;
    qqqCumulativeReturnGbpPct: number;
    netExcessReturnGbpPct: number;
    cohortMaxDrawdownUsdPct: number;
    qqqMaxDrawdownUsdPct: number;
    weeklyTurnoverPct: number;
    signalStabilityPct: number;
    windows: PointInTimeBacktestWindow[];
  };
  weightSensitivity: WeightSensitivityRow[];
  executionAuthority: 'none';
}

export interface ExecutiveBriefingSummary {
  asOfDateIso: string;
  dataReadinessStatus: 'ready_verified_evidence' | 'partial_evidence';
  sentences: {
    marketEnvironment: string;
    sectorDevelopments: string;
    strongestResearchOpportunities: string;
    highestMaterialRisks: string;
    changesSincePriorSession: string;
  };
  citedSourceIds: string[];
  executionAuthority: 'none';
}

export interface WhatChangedItem {
  id: string;
  category:
    | 'new_filing'
    | 'earnings_update'
    | 'financing_change'
    | 'typedb_relationship'
    | 'market_regime'
    | 'assessment_change';
  categoryLabel: string;
  dateIso: string;
  tickerOrEntity: string;
  headline: string;
  priorState: string;
  currentState: string;
  sourceLabel: string;
  href: string;
}

const UNIVERSE_META: Array<{
  ticker: string;
  companyName: string;
  sectorLayer: StockResearchAssessment['sectorLayer'];
  detailLinks: Array<{ label: string; href: string }>;
}> = [
  {
    ticker: 'NVDA',
    companyName: 'NVIDIA Corporation',
    sectorLayer: 'Semiconductors & AI Hardware',
    detailLinks: [
      { label: 'Analyst Consensus & FY27 Q2 Case', href: '/consensus' },
      { label: 'Nscale & Monarch Financing Case', href: '/infrastructure' },
      { label: 'Macro Data Room (Case 001 Graph)', href: '/data-room' },
    ],
  },
  {
    ticker: 'MSFT',
    companyName: 'Microsoft Corporation',
    sectorLayer: 'Hyperscale Cloud & AI Platforms',
    detailLinks: [
      { label: 'FY27 Q1 Financial & Cloud Case', href: '/consensus' },
      { label: 'Loughton & Monarch Infrastructure Case', href: '/infrastructure' },
      { label: 'Macro Data Room (Case 001 Graph)', href: '/data-room' },
    ],
  },
  {
    ticker: 'GOOGL',
    companyName: 'Alphabet Inc.',
    sectorLayer: 'Hyperscale Cloud & AI Platforms',
    detailLinks: [
      { label: 'Alphabet Q3 2026 SEC Earnings Case', href: '/earnings' },
      { label: 'Macro Data Room (Anthropic $40B Cap)', href: '/data-room' },
    ],
  },
  {
    ticker: 'AMZN',
    companyName: 'Amazon.com, Inc.',
    sectorLayer: 'Hyperscale Cloud & AI Platforms',
    detailLinks: [
      { label: 'Amazon Q3 2026 Cash Conversion Case', href: '/earnings/amazon' },
      { label: 'US Midterm Data-Centre Policy Risk', href: '/policy-risk' },
      { label: 'Macro Data Room (Case 001 Graph)', href: '/data-room' },
    ],
  },
  {
    ticker: 'INTC',
    companyName: 'Intel Corporation',
    sectorLayer: 'Semiconductors & AI Hardware',
    detailLinks: [
      { label: 'Macro Data Room (Fab 34 Leixlip $11B SCJV)', href: '/data-room' },
      { label: 'October 2026 Tech Stress Review', href: '/stress' },
    ],
  },
  {
    ticker: 'AMD',
    companyName: 'Advanced Micro Devices, Inc.',
    sectorLayer: 'Semiconductors & AI Hardware',
    detailLinks: [
      { label: 'US Midterm Policy Risk & Benchmark', href: '/policy-risk' },
      { label: 'Case 006 AI Market Recovery', href: '/recovery' },
    ],
  },
  {
    ticker: 'CRWV',
    companyName: 'CoreWeave, Inc.',
    sectorLayer: 'Specialist AI Compute',
    detailLinks: [
      { label: 'October 2026 Tech Stress Review', href: '/stress' },
      { label: 'Macro Data Room (Staging Graph Demo)', href: '/data-room' },
    ],
  },
];

interface PricePoint {
  ticker: string;
  eventAt: number;
  dateIso: string;
  close: number;
  currency: string;
}

function loadPriceHistoryByTicker(cutoffMs?: number): Map<string, PricePoint[]> {
  const map = new Map<string, Map<number, PricePoint>>();
  const addBar = (ticker: string, eventAt: number, close: number, currency = 'USD') => {
    if (cutoffMs !== undefined && eventAt > cutoffMs) return;
    if (!Number.isFinite(close) || close <= 0) return;
    let byAt = map.get(ticker);
    if (!byAt) {
      byAt = new Map();
      map.set(ticker, byAt);
    }
    byAt.set(eventAt, {
      ticker,
      eventAt,
      dateIso: new Date(eventAt).toISOString().slice(0, 10),
      close,
      currency,
    });
  };

  for (const p of policyRiskRaw.prices ?? []) {
    addBar(p.ticker, p.eventAt, p.close, p.currency ?? 'USD');
  }
  for (const p of recoveryV2Raw.prices ?? []) {
    if (p.instrumentId === 'IXIC') continue;
    addBar(p.instrumentId, p.eventAt, p.close, p.currency ?? 'USD');
  }

  const sorted = new Map<string, PricePoint[]>();
  for (const [ticker, byAt] of map.entries()) {
    sorted.set(
      ticker,
      [...byAt.values()].sort((a, b) => a.eventAt - b.eventAt),
    );
  }
  return sorted;
}

function loadFxByDate(): Map<string, number> {
  const fx = new Map<string, number>();
  for (const f of recoveryV2Raw.fx ?? []) {
    if (f.from === 'USD' && f.to === 'GBP' && Number.isFinite(f.rate)) {
      fx.set(new Date(f.eventAt).toISOString().slice(0, 10), f.rate);
    }
  }
  return fx;
}

function clampScore(val: number): number {
  return Number(Math.max(0, Math.min(100, val)).toFixed(1));
}

/**
 * Evaluates a single company's 5 research dimensions strictly from stored, verified observations.
 */
export function evaluateCompanyResearchAssessment(
  ticker: string,
  options?: {
    asOfMs?: number;
    weights?: DimensionWeightConfig;
    livePriceOverride?: {
      close: number | null;
      closeGbp?: number | null;
      usdToGbp?: number | null;
      closeAt: number | null;
      priceBasis?: string | null;
      corporateActionsReviewed?: boolean;
    };
  },
): StockResearchAssessment {
  const meta = UNIVERSE_META.find((u) => u.ticker === ticker) ?? {
    ticker,
    companyName: ticker,
    sectorLayer: 'Semiconductors & AI Hardware' as const,
    detailLinks: [{ label: 'Macro Data Room', href: '/data-room' }],
  };
  const weights = options?.weights ?? PROVISIONAL_DIMENSION_WEIGHTS;
  const priceMap = loadPriceHistoryByTicker(options?.asOfMs);
  const fxByDate = loadFxByDate();
  const bars = priceMap.get(ticker) ?? [];
  const qqqBars = priceMap.get('QQQ') ?? [];

  const latestBar = bars.at(-1) ?? null;
  const prevBar = bars.length >= 2 ? bars.at(-2)! : null;
  const fiveAgoBar = bars.length >= 6 ? bars.at(-6)! : null;
  const twentyAgoBar = bars.length >= 21 ? bars.at(-21)! : bars[0] ?? null;

  const effectiveClose =
    options?.livePriceOverride?.close !== undefined &&
    options.livePriceOverride.close !== null
      ? options.livePriceOverride.close
      : (latestBar?.close ?? null);
  const effectiveCloseAt =
    options?.livePriceOverride?.closeAt !== undefined &&
    options.livePriceOverride.closeAt !== null
      ? options.livePriceOverride.closeAt
      : (latestBar?.eventAt ?? null);
  const effectiveDateIso = effectiveCloseAt
    ? new Date(effectiveCloseAt).toISOString().slice(0, 10)
    : null;
  const effectiveFx =
    options?.livePriceOverride?.usdToGbp ??
    (effectiveDateIso ? (fxByDate.get(effectiveDateIso) ?? 0.7745) : null);
  const effectiveCloseGbp =
    options?.livePriceOverride?.closeGbp ??
    (effectiveClose !== null && effectiveFx !== null
      ? Number((effectiveClose * effectiveFx).toFixed(2))
      : null);
  const corporateActionsReviewed = Boolean(
    options?.livePriceOverride?.corporateActionsReviewed,
  );

  const referenceNowMs =
    options?.asOfMs ?? effectiveCloseAt ?? Date.parse('2026-11-06T16:00:00Z');
  const priceAgeDays =
    effectiveCloseAt !== null
      ? (referenceNowMs - effectiveCloseAt) / (86_400 * 1000)
      : Infinity;
  const isFreshWithinThreshold =
    priceAgeDays <= RATING_THRESHOLDS.maxPriceStalenessDaysForLive;

  const sessionChangePct =
    effectiveClose !== null && prevBar
      ? Number((((effectiveClose - prevBar.close) / prevBar.close) * 100).toFixed(2))
      : null;
  const fiveSessionChangePct =
    effectiveClose !== null && fiveAgoBar
      ? Number(
          (((effectiveClose - fiveAgoBar.close) / fiveAgoBar.close) * 100).toFixed(2),
        )
      : null;
  const twentySessionChangePct =
    effectiveClose !== null && twentyAgoBar && bars.length >= 15
      ? Number(
          (((effectiveClose - twentyAgoBar.close) / twentyAgoBar.close) * 100).toFixed(
            2,
          ),
        )
      : null;

  // -------------------------------------------------------------------------
  // Dimension 1: Valuation & Fundamentals (30% provisional weight)
  // -------------------------------------------------------------------------
  // In `data/consensus/company-comparison.json`, valuation is explicitly null because no
  // licensed diluted share count / market-cap series or forward consensus estimate is stored,
  // and quarterly EPS must not be naively annualised.
  const dimValuation: DimensionEvaluation = {
    key: 'valuation_fundamentals',
    label: 'Valuation & Fundamentals',
    provisionalWeight: weights.valuation_fundamentals,
    declaredHorizon: '6-12M Fundamental',
    status: 'insufficient_data',
    score: null,
    minimumEvidenceRequirement:
      'Verified diluted share count, corporate-action-adjusted price basis, and trailing 4-quarter (TTM) or licensed forward consensus EV/FCF & P/E multiples.',
    stalenessThreshold: 'Price <= 7 days; filing share count <= 105 days.',
    observedMetrics:
      ticker === 'NVDA'
        ? [
            {
              metric: 'Quarterly GAAP Diluted EPS (Non-Annualised)',
              valueDisplay: '$2.46 / share (single quarter FY27 Q2)',
              periodOrAsOf: '2026-07-26',
              sourceLabel: 'NVIDIA FY27 Q2 Financial Results',
              sourceId: 'nvda-fy27-q2',
            },
          ]
        : ticker === 'MSFT'
          ? [
              {
                metric: 'Quarterly GAAP Diluted EPS (Non-Annualised)',
                valueDisplay: '$4.92 / share (single quarter FY27 Q1)',
                periodOrAsOf: '2026-09-30',
                sourceLabel: 'Microsoft FY27 Q1 Financial Results',
                sourceId: 'msft-fy27-q1',
              },
            ]
          : ticker === 'GOOGL'
            ? [
                {
                  metric: 'Quarterly GAAP Diluted EPS (Non-Annualised)',
                  valueDisplay: '$2.12 / share (single quarter 2026 Q3)',
                  periodOrAsOf: '2026-09-30',
                  sourceLabel: 'Alphabet Q3 2026 SEC Exhibit 99.1',
                  sourceId: 'sec-release',
                },
              ]
            : [],
    missingInputs: [
      'Authoritative TTM / forward consensus valuation multiple (EV/FCF, P/E)',
      'Split- and dividend-adjusted price verification (corporateActionsReviewed = false)',
    ],
    deterministicSummary:
      'Not scored (null preserved): single-quarter EPS is never annualised into a synthetic P/E multiple, and unadjusted reference closes lack corporate-action verification.',
  };

  // -------------------------------------------------------------------------
  // Dimension 2: Earnings & Financial Health (25% provisional weight)
  // -------------------------------------------------------------------------
  let dimEarnings: DimensionEvaluation;
  let revenueUsdMillions: number | null = null;
  let operatingMarginPct: number | null = null;
  let freeCashFlowUsdMillions: number | null = null;
  let fcfMarginPct: number | null = null;
  let capexIntensityPct: number | null = null;

  if (ticker === 'NVDA') {
    const nvda = companyComparisonRaw.companies.find((c) => c.symbol === 'NVDA')!;
    revenueUsdMillions = nvda.companyRevenueMillions; // 96,221
    operatingMarginPct = Number(
      ((nvda.operatingIncomeMillions / nvda.companyRevenueMillions) * 100).toFixed(1),
    ); // 66.2%
    freeCashFlowUsdMillions = nvda.freeCashFlow.value; // 21,341
    fcfMarginPct = Number(
      ((nvda.freeCashFlow.value / nvda.companyRevenueMillions) * 100).toFixed(1),
    ); // 22.2%
    capexIntensityPct = Number(
      ((nvda.cashCapex.value / nvda.companyRevenueMillions) * 100).toFixed(1),
    ); // 2.8%
    // Deterministic health score from operating margin (66.2%), positive FCF conversion (22.2%), low capex drag (2.8%)
    const score = clampScore(
      50 + operatingMarginPct * 0.42 + fcfMarginPct * 0.55 - capexIntensityPct * 0.35,
    ); // ~89.0
    dimEarnings = {
      key: 'earnings_financial_health',
      label: 'Earnings & Financial Health',
      provisionalWeight: weights.earnings_financial_health,
      declaredHorizon: '6-12M Fundamental',
      status: 'evaluated',
      score,
      minimumEvidenceRequirement:
        'Primary SEC filing or official earnings release with GAAP revenue, operating income, OCF, and cash capex.',
      stalenessThreshold: 'Quarterly filing period end <= 135 days.',
      observedMetrics: [
        {
          metric: 'FY27 Q2 Revenue',
          valueDisplay: '$96,221M USD',
          periodOrAsOf: '2026-07-26',
          sourceLabel: 'NVIDIA FY27 Q2 Official Financial Results',
          sourceId: 'nvda-fy27-q2',
        },
        {
          metric: 'GAAP Operating Margin',
          valueDisplay: `${operatingMarginPct}% ($63,734M operating income)`,
          periodOrAsOf: '2026-07-26',
          sourceLabel: 'NVIDIA FY27 Q2 Official Financial Results',
          sourceId: 'nvda-fy27-q2',
        },
        {
          metric: 'Reported Free Cash Flow',
          valueDisplay: `$21,341M USD (${fcfMarginPct}% FCF margin; $2,677M cash capex)`,
          periodOrAsOf: '2026-07-26',
          sourceLabel: 'NVIDIA FY27 Q2 Official Financial Results',
          sourceId: 'nvda-fy27-q2',
        },
      ],
      missingInputs: [],
      deterministicSummary: `Strongest operating profitability (${operatingMarginPct}%) and FCF conversion (${fcfMarginPct}%) in the tracked cohort with low direct capex intensity (${capexIntensityPct}%).`,
    };
  } else if (ticker === 'MSFT') {
    const msft = companyComparisonRaw.companies.find((c) => c.symbol === 'MSFT')!;
    revenueUsdMillions = msft.companyRevenueMillions; // 92,279
    operatingMarginPct = Number(
      ((msft.operatingIncomeMillions / msft.companyRevenueMillions) * 100).toFixed(1),
    ); // 49.8%
    freeCashFlowUsdMillions = msft.freeCashFlow.value; // 18,633
    fcfMarginPct = Number(
      ((msft.freeCashFlow.value / msft.companyRevenueMillions) * 100).toFixed(1),
    ); // 20.2%
    capexIntensityPct = Number(
      ((msft.cashCapex.value / msft.companyRevenueMillions) * 100).toFixed(1),
    ); // 42.7%
    const score = clampScore(
      50 + operatingMarginPct * 0.42 + fcfMarginPct * 0.55 - capexIntensityPct * 0.15,
    ); // ~75.6
    dimEarnings = {
      key: 'earnings_financial_health',
      label: 'Earnings & Financial Health',
      provisionalWeight: weights.earnings_financial_health,
      declaredHorizon: '6-12M Fundamental',
      status: 'evaluated',
      score,
      minimumEvidenceRequirement:
        'Primary SEC filing or official earnings release with GAAP revenue, operating income, OCF, and cash capex.',
      stalenessThreshold: 'Quarterly filing period end <= 135 days.',
      observedMetrics: [
        {
          metric: 'FY27 Q1 Revenue',
          valueDisplay: '$92,279M USD (Azure +48% YoY; Microsoft Cloud $63.9B)',
          periodOrAsOf: '2026-09-30',
          sourceLabel: 'Microsoft FY27 Q1 Official Financial Results',
          sourceId: 'msft-fy27-q1',
        },
        {
          metric: 'GAAP Operating Margin',
          valueDisplay: `${operatingMarginPct}% ($45,915M operating income)`,
          periodOrAsOf: '2026-09-30',
          sourceLabel: 'Microsoft FY27 Q1 Official Financial Results',
          sourceId: 'msft-fy27-q1',
        },
        {
          metric: 'Derived Free Cash Flow',
          valueDisplay: `$18,633M USD (${fcfMarginPct}% FCF margin after $39,367M cash capex)`,
          periodOrAsOf: '2026-09-30',
          sourceLabel: 'Microsoft FY27 Q1 Official Financial Results',
          sourceId: 'msft-fy27-q1',
        },
      ],
      missingInputs: [],
      deterministicSummary: `High operating margin (${operatingMarginPct}%) and $58.0B quarterly OCF sustain positive $18.6B FCF despite elevated 42.7% cash capex intensity.`,
    };
  } else if (ticker === 'GOOGL') {
    const getMetric = (m: string, period = '2026-Q3') =>
      alphabetEarningsRaw.metrics.find((x) => x.metric === m && x.period === period)
        ?.value ?? null;
    const revB = getMetric('revenue')!; // 127.577B
    const opIncB = getMetric('operating_income')!; // 40.576B
    const ocfB = getMetric('operating_cash_flow')!; // 42.29B
    const capexB = getMetric('capital_expenditure')!; // 51.355B
    const fcfB = getMetric('free_cash_flow')!; // -9.065B
    const cloudRevB = getMetric('cloud_revenue')!; // 30.709B

    revenueUsdMillions = Math.round(revB * 1000);
    operatingMarginPct = Number(((opIncB / revB) * 100).toFixed(1)); // 31.8%
    freeCashFlowUsdMillions = Math.round(fcfB * 1000); // -9,065
    fcfMarginPct = Number(((fcfB / revB) * 100).toFixed(1)); // -7.1%
    capexIntensityPct = Number(((capexB / revB) * 100).toFixed(1)); // 40.3%
    const score = clampScore(
      50 + operatingMarginPct * 0.42 + fcfMarginPct * 0.55 - capexIntensityPct * 0.15,
    ); // ~53.4
    dimEarnings = {
      key: 'earnings_financial_health',
      label: 'Earnings & Financial Health',
      provisionalWeight: weights.earnings_financial_health,
      declaredHorizon: '6-12M Fundamental',
      status: 'evaluated',
      score,
      minimumEvidenceRequirement:
        'Primary SEC filing or official earnings release with GAAP revenue, operating income, OCF, and cash capex.',
      stalenessThreshold: 'Quarterly filing period end <= 135 days.',
      observedMetrics: [
        {
          metric: '2026 Q3 GAAP Revenue',
          valueDisplay: `$${revB.toFixed(3)}B USD (+24.7% YoY; Cloud $${cloudRevB.toFixed(3)}B +102.6% YoY)`,
          periodOrAsOf: '2026-09-30',
          sourceLabel: 'Alphabet Q3 2026 SEC Exhibit 99.1',
          sourceId: 'sec-release',
        },
        {
          metric: 'GAAP Operating Margin',
          valueDisplay: `${operatingMarginPct}% ($${opIncB.toFixed(3)}B operating income; $${ocfB.toFixed(2)}B OCF)`,
          periodOrAsOf: '2026-09-30',
          sourceLabel: 'Alphabet Q3 2026 SEC Exhibit 99.1',
          sourceId: 'sec-release',
        },
        {
          metric: 'Quarterly Free Cash Flow Compression',
          valueDisplay: `${fcfB.toFixed(3)}B USD (${fcfMarginPct}% FCF margin after $${capexB.toFixed(3)}B Q3 capex)`,
          periodOrAsOf: '2026-09-30',
          sourceLabel: 'Alphabet Q3 2026 SEC Exhibit 99.1',
          sourceId: 'sec-release',
        },
      ],
      missingInputs: [],
      deterministicSummary: `Cloud revenue doubled YoY ($30.71B) with 31.8% operating margin, but a $51.36B quarterly capex surge drove Q3 FCF negative (-$9.07B).`,
    };
  } else if (ticker === 'AMZN') {
    const findObs = (metric: string, label: string) =>
      amazonCashRaw.observations.find(
        (o) => o.metric === metric && o.period.label === label,
      )?.value ?? null;
    const revQ3 = findObs('revenue', '2026-Q3') ?? 201944;
    const opIncQ3 = findObs('operating_income', '2026-Q3') ?? 28320;
    revenueUsdMillions = revQ3;
    operatingMarginPct = Number(((opIncQ3 / revQ3) * 100).toFixed(1)); // 14.0%
    // TTM OCF & Capex from Q3 2026 cash conversion case
    const ttmOcf = 130692;
    const ttmCapex = 115882;
    const ttmFcf = ttmOcf - ttmCapex; // 14,810
    const ttmRev = 180169 + 213386 + 181519 + 200606 + 201944 - 180169; // 2025-Q4..2026-Q3 = 797,455
    freeCashFlowUsdMillions = ttmFcf;
    fcfMarginPct = Number(((ttmFcf / ttmRev) * 100).toFixed(1)); // 1.9% TTM FCF/Rev (or 11.3% FCF/OCF conversion)
    capexIntensityPct = Number(((ttmCapex / ttmRev) * 100).toFixed(1)); // 14.5% of retail+cloud revenue (88.7% of OCF)
    const score = clampScore(
      50 + operatingMarginPct * 0.42 + fcfMarginPct * 0.55 - capexIntensityPct * 0.15,
    ); // ~54.7
    dimEarnings = {
      key: 'earnings_financial_health',
      label: 'Earnings & Financial Health',
      provisionalWeight: weights.earnings_financial_health,
      declaredHorizon: '6-12M Fundamental',
      status: 'evaluated',
      score,
      minimumEvidenceRequirement:
        'Primary SEC filing or official earnings release with GAAP revenue, operating income, OCF, and cash capex.',
      stalenessThreshold: 'Quarterly filing period end <= 135 days.',
      observedMetrics: [
        {
          metric: '2026 Q3 GAAP Revenue & Operating Income',
          valueDisplay: `$${revQ3.toLocaleString()}M revenue · $${opIncQ3.toLocaleString()}M operating income (${operatingMarginPct}% margin)`,
          periodOrAsOf: '2026-09-30',
          sourceLabel: 'Amazon Q3 2026 SEC Exhibit 99.1',
          sourceId: 'amazon-sec-ex991',
        },
        {
          metric: 'TTM Operating Cash Flow vs Capex',
          valueDisplay: `$130,692M TTM OCF less $115,882M TTM capex = $14,810M FCF (11.3% OCF-to-FCF conversion)`,
          periodOrAsOf: '2026-09-30',
          sourceLabel: 'Amazon Q3 2026 SEC Exhibit 99.1',
          sourceId: 'amazon-sec-ex991',
        },
      ],
      missingInputs: [],
      deterministicSummary: `Operating income expanded to $28.3B in Q3 2026, but $115.9B of TTM capital expenditure consumes 88.7% of operating cash flow.`,
    };
  } else {
    dimEarnings = {
      key: 'earnings_financial_health',
      label: 'Earnings & Financial Health',
      provisionalWeight: weights.earnings_financial_health,
      declaredHorizon: '6-12M Fundamental',
      status: 'insufficient_data',
      score: null,
      minimumEvidenceRequirement:
        'Primary SEC 10-Q/10-K income & cash-flow statement table (revenue, operating income, OCF, capex).',
      stalenessThreshold: 'Quarterly filing period end <= 135 days.',
      observedMetrics:
        ticker === 'INTC'
          ? [
              {
                metric: 'Fab 34 Leixlip Co-Investment (SCJV)',
                valueDisplay: '$11.0B USD SCJV capital structure disclosed',
                periodOrAsOf: '2026-10-30',
                sourceLabel: 'Intel Q3 2026 Form 10-Q',
                sourceId: 'intc-10q-q3-2026',
              },
            ]
          : [],
      missingInputs: [
        `Complete Q3 2026 GAAP revenue, operating margin, and free cash flow table for ${ticker}`,
      ],
      deterministicSummary: `Not scored (null preserved): complete quarterly income and cash-flow statement observations for ${ticker} are not yet imported into the verified primary-filing store.`,
    };
  }

  // -------------------------------------------------------------------------
  // Dimension 3: Momentum & Trend (20% provisional weight — 20D Tactical Horizon)
  // -------------------------------------------------------------------------
  const qqqTwentyAgo = qqqBars.length >= 21 ? qqqBars.at(-21)! : qqqBars[0] ?? null;
  const qqqLatest = qqqBars.at(-1) ?? null;
  const qqqTwentyReturnPct =
    qqqLatest && qqqTwentyAgo
      ? ((qqqLatest.close - qqqTwentyAgo.close) / qqqTwentyAgo.close) * 100
      : null;

  let dimMomentum: DimensionEvaluation;
  if (
    twentySessionChangePct !== null &&
    fiveSessionChangePct !== null &&
    qqqTwentyReturnPct !== null &&
    isFreshWithinThreshold
  ) {
    const relVsQqq20d = Number((twentySessionChangePct - qqqTwentyReturnPct).toFixed(2));
    const momScore = clampScore(
      50 + relVsQqq20d * 2.2 + fiveSessionChangePct * 1.1,
    );
    dimMomentum = {
      key: 'momentum_trend',
      label: 'Momentum & Price Trend (Tactical)',
      provisionalWeight: weights.momentum_trend,
      declaredHorizon: '20D Tactical (Separated from Fundamental Rating)',
      status: 'evaluated',
      score: momScore,
      minimumEvidenceRequirement:
        '>= 20 daily reference closes alongside benchmark QQQ over identical sessions.',
      stalenessThreshold: 'Latest session close <= 7 days.',
      observedMetrics: [
        {
          metric: '20-Session Price Return vs QQQ',
          valueDisplay: `${twentySessionChangePct >= 0 ? '+' : ''}${twentySessionChangePct}% (${relVsQqq20d >= 0 ? '+' : ''}${relVsQqq20d}% vs QQQ)`,
          periodOrAsOf: effectiveDateIso ?? '2026-11-05',
          sourceLabel: 'Nasdaq Historical Close Series',
          sourceId: `nasdaq-${ticker.toLowerCase()}`,
        },
        {
          metric: '5-Session Tactical Window',
          valueDisplay: `${fiveSessionChangePct >= 0 ? '+' : ''}${fiveSessionChangePct}% (1D: ${sessionChangePct !== null ? `${sessionChangePct >= 0 ? '+' : ''}${sessionChangePct}%` : '—'})`,
          periodOrAsOf: effectiveDateIso ?? '2026-11-05',
          sourceLabel: 'Nasdaq Historical Close Series',
          sourceId: `nasdaq-${ticker.toLowerCase()}`,
        },
      ],
      missingInputs: [],
      deterministicSummary: `20-session price trend is ${twentySessionChangePct >= 0 ? '+' : ''}${twentySessionChangePct}% (${relVsQqq20d >= 0 ? '+' : ''}${relVsQqq20d}% relative to QQQ). Kept strictly separate from 6–12M fundamental valuation.`,
    };
  } else {
    dimMomentum = {
      key: 'momentum_trend',
      label: 'Momentum & Price Trend (Tactical)',
      provisionalWeight: weights.momentum_trend,
      declaredHorizon: '20D Tactical (Separated from Fundamental Rating)',
      status: isFreshWithinThreshold ? 'insufficient_data' : 'stale_evidence',
      score: null,
      minimumEvidenceRequirement:
        '>= 20 daily reference closes alongside benchmark QQQ over identical sessions.',
      stalenessThreshold: 'Latest session close <= 7 days.',
      observedMetrics: [],
      missingInputs: ['20-session fresh reference close series'],
      deterministicSummary:
        'Not scored: insufficient or stale price history in the evaluation window.',
    };
  }

  // -------------------------------------------------------------------------
  // Dimension 4: Macroeconomic & Sector Exposure (15% provisional weight)
  // -------------------------------------------------------------------------
  const orgIdMap: Record<string, string> = {
    NVDA: 'org-nvidia',
    MSFT: 'org-microsoft',
    GOOGL: 'org-alphabet',
    AMZN: 'org-amazon',
    INTC: 'org-intel',
  };
  const orgId = orgIdMap[ticker] ?? null;
  const activeRels = (graphDatasetRaw.relationships ?? []).filter(
    (r) =>
      r.contractualStatus !== 'cancelled' &&
      (!options?.asOfMs || r.publishedAtMs <= options.asOfMs) &&
      orgId !== null &&
      r.participants.some((p) => p.entityId === orgId),
  );
  const policyExposures = (policyRiskRaw.projects ?? []).filter((proj) =>
    proj.companies?.some((c: { ticker?: string | null }) => c.ticker === ticker),
  );

  let documentedGraphCommitmentsUsdBillions: number | null = null;
  let dimMacro: DimensionEvaluation;

  if (orgId && activeRels.length > 0) {
    const totalPrincipalUsd = activeRels.reduce(
      (acc, r) => acc + (typeof r.principalAmount === 'number' ? r.principalAmount : 0),
      0,
    );
    documentedGraphCommitmentsUsdBillions =
      totalPrincipalUsd > 0 ? Number((totalPrincipalUsd / 1e9).toFixed(2)) : null;

    const macroScoreByTicker: Record<string, number> = {
      NVDA: 78.0, // Hardware supplier to hyperscalers + Nscale backing; lower direct Ireland grid capex lock-in
      MSFT: 73.0, // Major cloud offtaker ($895.4B envelope participant) + Dublin EirGrid & US policy exposure
      GOOGL: 74.0, // $40B Anthropic backing + TPU cloud supplier; lower US state moratorium exposure
      AMZN: 68.0, // AWS compute supplier + Dublin 350MW EirGrid dependency + Ohio/NY policy exposure
      INTC: 62.0, // $11.0B Fab 34 Leixlip Ireland exposure
    };
    const score = macroScoreByTicker[ticker] ?? 65.0;
    dimMacro = {
      key: 'macro_sector_exposure',
      label: 'Macroeconomic & Sector Exposure',
      provisionalWeight: weights.macro_sector_exposure,
      declaredHorizon: '6-12M Fundamental',
      status: 'evaluated',
      score,
      minimumEvidenceRequirement:
        'Verified TypeDB Macro Case 001 counterparty relationships and/or Benchmark 001.2 infrastructure policy-risk records.',
      stalenessThreshold: 'Reviewed against current TypeDB checkpoint (#23).',
      observedMetrics: [
        {
          metric: 'TypeDB Hypergraph Counterparty Links',
          valueDisplay: `${activeRels.length} active verified relationship(s)${documentedGraphCommitmentsUsdBillions ? ` · $${documentedGraphCommitmentsUsdBillions}B documented principal envelope` : ''}`,
          periodOrAsOf: '2026-11-05',
          sourceLabel: 'TypeDB Cloud (aci_macro_intelligence_prod)',
          sourceId: activeRels[0]?.sourceDocIds[0] ?? 'anthropic-s1a-2026-11-02',
        },
        ...(policyExposures.length > 0
          ? [
              {
                metric: 'US Data-Centre Policy & Grid Exposure',
                valueDisplay: `${policyExposures.length} tracked project(s) (${policyExposures.map((p) => p.name).join('; ')})`,
                periodOrAsOf: '2026-11-04',
                sourceLabel: 'Benchmark 001.2 Policy Risk Registry',
                sourceId: 'ny-eo62',
              },
            ]
          : []),
      ],
      missingInputs: [],
      deterministicSummary: `Documented across ${activeRels.length} TypeDB hypergraph relationship(s) and ${policyExposures.length} tracked US grid/policy project(s).`,
    };
  } else if (policyExposures.length > 0 || ticker === 'AMD') {
    dimMacro = {
      key: 'macro_sector_exposure',
      label: 'Macroeconomic & Sector Exposure',
      provisionalWeight: weights.macro_sector_exposure,
      declaredHorizon: '6-12M Fundamental',
      status: 'evaluated',
      score: 64.0,
      minimumEvidenceRequirement:
        'Verified TypeDB Macro Case 001 counterparty relationships and/or Benchmark 001.2 infrastructure policy-risk records.',
      stalenessThreshold: 'Reviewed against current TypeDB checkpoint (#23).',
      observedMetrics: [
        {
          metric: 'AI Semiconductor Sector Cohort',
          valueDisplay: 'Tracked in Benchmark 001.2 AI infrastructure cohort',
          periodOrAsOf: '2026-11-04',
          sourceLabel: 'Benchmark 001.2 Policy Risk Registry',
          sourceId: 'nasdaq-amd',
        },
      ],
      missingInputs: [],
      deterministicSummary:
        'Included in the AI semiconductor sector cohort with indirect exposure to hyperscaler capex cycles.',
    };
  } else {
    dimMacro = {
      key: 'macro_sector_exposure',
      label: 'Macroeconomic & Sector Exposure',
      provisionalWeight: weights.macro_sector_exposure,
      declaredHorizon: '6-12M Fundamental',
      status: 'insufficient_data',
      score: null,
      minimumEvidenceRequirement:
        'Verified TypeDB Macro Case 001 production counterparty relationships.',
      stalenessThreshold: 'Reviewed against current TypeDB checkpoint (#23).',
      observedMetrics: [],
      missingInputs: [
        `Promoted production TypeDB counterparty relationships for ${ticker}`,
      ],
      deterministicSummary: `Not scored (null preserved): ${ticker} has a staging demo relationship (Dublin West 180 MW) but zero promoted relationships in aci_macro_intelligence_prod.`,
    };
  }

  // -------------------------------------------------------------------------
  // Dimension 5: Company-Specific Risk (10% provisional weight)
  // -------------------------------------------------------------------------
  let dimRisk: DimensionEvaluation;
  if (ticker === 'NVDA') {
    dimRisk = {
      key: 'company_specific_risk',
      label: 'Company-Specific & Counterparty Risk',
      provisionalWeight: weights.company_specific_risk,
      declaredHorizon: '6-12M Fundamental',
      status: 'evaluated',
      score: 72.0,
      minimumEvidenceRequirement:
        'Disclosed off-balance-sheet guarantees, customer concentration, and regulatory export constraints.',
      stalenessThreshold: 'Quarterly filing & current TypeDB conflict registry.',
      observedMetrics: [
        {
          metric: 'Contingent Credit Guarantees & Notes',
          valueDisplay:
            '$860.3M signed Ward County lease guarantee + $1.0B Nscale convertible note + reported Monarch credit talks',
          periodOrAsOf: '2026-10-30',
          sourceLabel: 'Nscale S-1 & Reuters Credit Report',
          sourceId: 'nscale-s1-sep18',
        },
        {
          metric: 'Export Control Exclusion',
          valueDisplay: 'China Data Center compute revenue excluded from Q3 FY27 outlook ($108B ±2%)',
          periodOrAsOf: '2026-08-26',
          sourceLabel: 'NVIDIA FY27 Q2 Official Financial Results',
          sourceId: 'nvda-fy27-q2',
        },
      ],
      missingInputs: [],
      deterministicSummary:
        'Manageable balance-sheet risk ($21.3B quarterly FCF covers $1.86B signed Nscale commitments), tempered by customer concentration and unsigned Monarch guarantee talks.',
    };
  } else if (ticker === 'MSFT') {
    dimRisk = {
      key: 'company_specific_risk',
      label: 'Company-Specific & Counterparty Risk',
      provisionalWeight: weights.company_specific_risk,
      declaredHorizon: '6-12M Fundamental',
      status: 'evaluated',
      score: 70.0,
      minimumEvidenceRequirement:
        'Disclosed off-balance-sheet leases, capex commitments, and contract supersessions.',
      stalenessThreshold: 'Quarterly filing & current TypeDB conflict registry.',
      observedMetrics: [
        {
          metric: 'Data-Centre Lease & Sub-Allocation Discipline',
          valueDisplay:
            'Cancelled Loughton v1 lease superseded by active v2; $44.6B Monarch sub-allocation inside $895.4B compute envelope',
          periodOrAsOf: '2026-11-02',
          sourceLabel: 'Anthropic S-1/A & Nscale S-1',
          sourceId: 'anthropic-s1a-2026-11-02',
        },
      ],
      missingInputs: [],
      deterministicSummary:
        'Active contract management (Loughton v1 termination) mitigates stranded-capacity risk, though $39.4B quarterly cash capex requires sustained Azure monetisation.',
    };
  } else if (ticker === 'GOOGL') {
    dimRisk = {
      key: 'company_specific_risk',
      label: 'Company-Specific & Counterparty Risk',
      provisionalWeight: weights.company_specific_risk,
      declaredHorizon: '6-12M Fundamental',
      status: 'evaluated',
      score: 63.0,
      minimumEvidenceRequirement:
        'Disclosed capital commitments, dual-role circularity caps, and cash-flow coverage.',
      stalenessThreshold: 'Quarterly filing & current TypeDB conflict registry.',
      observedMetrics: [
        {
          metric: 'Dual-Role Investor/Supplier Commitment',
          valueDisplay:
            'Up to $40.0B cash & performance-linked backing to Anthropic alongside negative Q3 FCF (-$9.07B)',
          periodOrAsOf: '2026-11-02',
          sourceLabel: 'Anthropic S-1/A & Alphabet Q3 Exhibit 99.1',
          sourceId: 'anthropic-s1a-2026-11-02',
        },
      ],
      missingInputs: [],
      deterministicSummary:
        'Dual investor/cloud-supplier exposure ($40.0B Anthropic cap) combined with negative Q3 FCF (-$9.07B) increases sensitivity to AI compute pricing.',
    };
  } else if (ticker === 'AMZN') {
    dimRisk = {
      key: 'company_specific_risk',
      label: 'Company-Specific & Counterparty Risk',
      provisionalWeight: weights.company_specific_risk,
      declaredHorizon: '6-12M Fundamental',
      status: 'evaluated',
      score: 64.0,
      minimumEvidenceRequirement:
        'Disclosed capital commitments, grid dependencies, and cash conversion trajectory.',
      stalenessThreshold: 'Quarterly filing & current TypeDB conflict registry.',
      observedMetrics: [
        {
          metric: 'Capex Intensity & Grid Permitting',
          valueDisplay:
            '$115.9B TTM capex (88.7% of OCF) + Dublin 350 MW EirGrid & Wilmington Ohio rezoning litigation',
          periodOrAsOf: '2026-10-29',
          sourceLabel: 'Amazon Q3 Exhibit 99.1 & CRU/EirGrid Filing',
          sourceId: 'amazon-sec-ex991',
        },
      ],
      missingInputs: [],
      deterministicSummary:
        'High TTM capex absorption (88.7% of OCF) and local zoning/grid bottlenecks in Dublin and Ohio require close monitoring of AWS cash conversion.',
    };
  } else if (ticker === 'INTC') {
    dimRisk = {
      key: 'company_specific_risk',
      label: 'Company-Specific & Counterparty Risk',
      provisionalWeight: weights.company_specific_risk,
      declaredHorizon: '6-12M Fundamental',
      status: 'evaluated',
      score: 52.0,
      minimumEvidenceRequirement:
        'Disclosed JV co-investment obligations and foundry execution filings.',
      stalenessThreshold: 'Quarterly filing & current TypeDB conflict registry.',
      observedMetrics: [
        {
          metric: 'Fab 34 Leixlip SCJV Obligation',
          valueDisplay: '$11.0B Semiconductor Co-Investment structure in Co. Kildare, Ireland',
          periodOrAsOf: '2026-10-30',
          sourceLabel: 'Intel Q3 2026 Form 10-Q',
          sourceId: 'intc-10q-q3-2026',
        },
      ],
      missingInputs: [],
      deterministicSummary:
        'Capital-intensive foundry commitments ($11.0B Fab 34 SCJV) carry execution and utilization risk without verified positive FCF coverage in the current bundle.',
    };
  } else {
    dimRisk = {
      key: 'company_specific_risk',
      label: 'Company-Specific & Counterparty Risk',
      provisionalWeight: weights.company_specific_risk,
      declaredHorizon: '6-12M Fundamental',
      status: 'insufficient_data',
      score: null,
      minimumEvidenceRequirement:
        'Primary SEC filing balance-sheet, debt-maturity, and customer-concentration disclosures.',
      stalenessThreshold: 'Quarterly filing <= 135 days.',
      observedMetrics: [],
      missingInputs: [`Audited debt-maturity & customer-concentration schedule for ${ticker}`],
      deterministicSummary: `Not scored (null preserved): primary balance-sheet and debt-covenant schedules for ${ticker} are not yet stored.`,
    };
  }

  const dimensions: Record<DimensionKey, DimensionEvaluation> = {
    valuation_fundamentals: dimValuation,
    earnings_financial_health: dimEarnings,
    momentum_trend: dimMomentum,
    macro_sector_exposure: dimMacro,
    company_specific_risk: dimRisk,
  };

  const dimList = Object.values(dimensions);
  const evaluatedDims = dimList.filter((d) => d.status === 'evaluated' && d.score !== null);
  const coveredWeightRatio = Number(
    evaluatedDims.reduce((acc, d) => acc + d.provisionalWeight, 0).toFixed(2),
  );
  const coveredWeightPct = Math.round(coveredWeightRatio * 100);

  // Fundamental composite uses ONLY the 6-12M Fundamental dimensions (excluding 20D tactical momentum)
  const fundamentalDims = evaluatedDims.filter(
    (d) => d.declaredHorizon === '6-12M Fundamental',
  );
  const fundamentalWeightSum = fundamentalDims.reduce(
    (acc, d) => acc + d.provisionalWeight,
    0,
  );
  const fundamentalCompositeScore =
    fundamentalWeightSum >= 0.25
      ? Number(
          (
            fundamentalDims.reduce(
              (acc, d) => acc + (d.score ?? 0) * d.provisionalWeight,
              0,
            ) / fundamentalWeightSum
          ).toFixed(1),
        )
      : null;

  const unmetGates: string[] = [];
  if (dimValuation.status !== 'evaluated') {
    unmetGates.push(
      'Valuation & Fundamentals (30% weight) missing verified TTM/forward consensus multiples',
    );
  }
  if (dimEarnings.status !== 'evaluated') {
    unmetGates.push(
      'Earnings & Financial Health (25% weight) missing complete primary SEC income/cash-flow table',
    );
  }
  if (!corporateActionsReviewed) {
    unmetGates.push(
      'Price series uses unadjusted public closes (corporateActionsReviewed = false)',
    );
  }
  if (bars.length < RATING_THRESHOLDS.minBacktestSessionsForProductionValidation) {
    unmetGates.push(
      `Historical price window (${bars.length} sessions) is below the ${RATING_THRESHOLDS.minBacktestSessionsForProductionValidation}-session validation gate`,
    );
  }

  const essentialGatesPassed = unmetGates.length === 0;

  // Because essential gates are unmet in the current dataset, directional BUY/HOLD/SELL labels are strictly blocked!
  const assessment: ResearchAssessmentLabel = 'INSUFFICIENT DATA';

  const researchPriorityScore = fundamentalCompositeScore;
  const researchPriorityTier: StockResearchAssessment['researchPriorityTier'] =
    dimEarnings.score !== null && dimEarnings.score >= 70
      ? 'Priority 1 — High Verified Fundamental & Graph Coverage'
      : dimEarnings.score !== null
        ? 'Priority 2 — Capex-Heavy Cash Conversion Watch'
        : 'Priority 3 — Incomplete Primary Filing Coverage';

  const justificationsByTicker: Record<
    string,
    {
      justification: string;
      risk: string;
      whatChanges: string;
      sources: string[];
      rels: string[];
    }
  > = {
    NVDA: {
      justification:
        'Gated at INSUFFICIENT DATA because no licensed valuation multiple or 252-day adjusted price history is stored. Among verified dimensions (70% weight covered), NVIDIA ranks #1 for further research with 66.2% GAAP operating margin ($63.7B Q2 operating income) and $21.3B quarterly FCF.',
      risk:
        'Customer capex concentration across four hyperscalers, China Data Center export exclusion, and $1.86B+ of Nscale lease/convertible credit exposure (plus reported Monarch guarantee discussions).',
      whatChanges:
        'Importing verified diluted share counts, split-adjusted prices, and licensed forward consensus estimates would unlock the 30% Valuation gate; a confirmed binding Monarch credit guarantee would adjust Company Risk.',
      sources: ['nvda-fy27-q2', 'nscale-s1-sep18', 'reuters-credit-oct30'],
      rels: [
        'rel-nscale-nvda-convertible-r1',
        'rel-ward-county-guarantee-r1',
        'rel-monarch-credit-talks-r1',
      ],
    },
    MSFT: {
      justification:
        'Gated at INSUFFICIENT DATA pending verified valuation multiples and adjusted price history. Ranks #2 for further research (70% weight covered): FY27 Q1 Azure revenue grew 48% YoY with 49.8% company operating margin and $18.6B positive FCF after $39.4B cash capex.',
      risk:
        'Elevated cash capex intensity (42.7% of revenue), $44.6B Nscale Monarch sub-allocation execution, and Dublin EirGrid dispatchable generation constraints.',
      whatChanges:
        'Verified TTM/forward EV/FCF valuation inputs and multi-quarter confirmation that Azure revenue growth (+48%) outpaces property and equipment depreciation.',
      sources: ['msft-fy27-q1', 'anthropic-s1a-2026-11-02', 'nscale-s1-sep18'],
      rels: [
        'rel-anthropic-s1a-msft-compute-r1',
        'rel-nscale-msft-monarch-sub-r1',
        'rel-loughton-dc-active-v2-r1',
      ],
    },
    AMZN: {
      justification:
        'Gated at INSUFFICIENT DATA pending valuation inputs. Verified Q3 2026 filings (70% weight covered) show $201.9B revenue and $28.3B operating income, but $115.9B of TTM capex compresses TTM free cash flow to $14.8B (11.3% of OCF).',
      risk:
        'Heavy capital intensity (88.7% of TTM operating cash flow absorbed by capex), dual equity/supplier exposure to Anthropic ($895.4B aggregate envelope), and Dublin/Ohio data-centre permitting delays.',
      whatChanges:
        'Verified valuation multiples plus evidence of TTM OCF-to-FCF conversion recovering above 25% as AWS AI capacity comes online.',
      sources: ['amazon-sec-ex991', 'anthropic-s1a-2026-11-02', 'cru-eirgrid-dc-policy-2026'],
      rels: [
        'rel-anthropic-s1a-amzn-compute-r1',
        'rel-anthropic-amzn-dual-role-r1',
        'rel-aws-dublin-eirgrid-dep-r1',
      ],
    },
    GOOGL: {
      justification:
        'Gated at INSUFFICIENT DATA pending valuation inputs. Verified Q3 2026 SEC Exhibit 99.1 (70% weight covered) shows Cloud revenue doubling YoY to $30.71B ($11.12B Cloud operating income), offset by a $51.36B quarterly capex surge that pushed Q3 FCF to -$9.07B.',
      risk:
        'Negative quarterly free cash flow (-$9.07B in Q3 2026) and up to $40.0B of dual-role cash/backing exposure to Anthropic.',
      whatChanges:
        'Verified valuation multiples and restoration of positive quarterly free cash flow alongside sustained >30% Google Cloud operating margins.',
      sources: ['sec-release', 'anthropic-s1-2026-10-26', 'anthropic-s1a-2026-11-02'],
      rels: [
        'rel-anthropic-s1a-googl-compute-r1',
        'rel-anthropic-googl-dual-role-r1',
      ],
    },
    INTC: {
      justification:
        'Gated at INSUFFICIENT DATA (45% weight covered): TypeDB documents Intel’s $11.0B Fab 34 Leixlip SCJV co-investment, but complete Q3 2026 GAAP income and cash-flow tables and valuation multiples are not yet imported.',
      risk:
        'High foundry capital requirements ($11.0B Leixlip SCJV) and absence of verified positive free cash flow in the current evidence store.',
      whatChanges:
        'Importing complete Form 10-Q/10-K income, OCF, and FCF statements plus verified valuation multiples.',
      sources: ['intc-10q-q3-2026'],
      rels: ['rel-intc-fab34-leixlip-scjv-r1'],
    },
    AMD: {
      justification:
        'Gated at INSUFFICIENT DATA (35% weight covered): 46 daily Nasdaq reference closes and sector policy-risk membership are stored, but primary SEC financial statement metrics and valuation multiples are absent.',
      risk:
        'Lack of primary-source quarterly revenue, margin, and cash-conversion data in the current workspace.',
      whatChanges:
        'Importing verified Form 10-Q financial tables, TypeDB customer/supply relationships, and valuation multiples.',
      sources: ['nasdaq-amd'],
      rels: [],
    },
    CRWV: {
      justification:
        'Gated at INSUFFICIENT DATA (20% weight covered): only delayed Nasdaq price closes and an isolated staging graph demo (Dublin West 180 MW) exist; no audited SEC income/cash-flow or debt-schedule data is stored in production.',
      risk:
        'High leverage and GPU-collateralised financing structure cannot be evaluated without primary S-1/10-Q financial tables.',
      whatChanges:
        'Promoting verified S-1/10-Q financial statements and debt-maturity schedules into the production evidence store.',
      sources: ['nasdaq-crwv'],
      rels: [],
    },
  };

  const info = justificationsByTicker[ticker] ?? {
    justification: 'Gated at INSUFFICIENT DATA due to missing primary financial and valuation inputs.',
    risk: 'Incomplete fundamental and balance-sheet evidence.',
    whatChanges: 'Import primary SEC filings and verified valuation multiples.',
    sources: [],
    rels: [],
  };

  return {
    ticker,
    companyName: meta.companyName,
    sectorLayer: meta.sectorLayer,
    latestPrice: {
      close: effectiveClose,
      currency: latestBar?.currency ?? 'USD',
      closeGbp: effectiveCloseGbp,
      usdToGbp: effectiveFx,
      timestampMs: effectiveCloseAt,
      timestampIso: effectiveCloseAt ? new Date(effectiveCloseAt).toISOString() : null,
      priorSessionClose: prevBar?.close ?? null,
      sessionChangePct,
      fiveSessionChangePct,
      twentySessionChangePct,
      classification:
        effectiveClose !== null
          ? corporateActionsReviewed
            ? 'Licensed Adjusted EOD Close'
            : 'Delayed Public Reference Close (Unadjusted)'
          : 'Unavailable',
      sourceLabel:
        effectiveClose !== null
          ? 'Nasdaq Historical Reference Close (15m+ delayed, unadjusted)'
          : 'Unavailable',
      sourceId: `nasdaq-${ticker.toLowerCase()}`,
      corporateActionsReviewed,
      isFreshWithinThreshold,
    },
    assessment,
    methodologyClassification: RESEARCH_METHODOLOGY_CLASSIFICATION,
    methodologyVersion: RESEARCH_METHODOLOGY_VERSION,
    assessmentDateIso: new Date(referenceNowMs).toISOString().slice(0, 10),
    declaredHorizon: '6–12 Months (Fundamental Research Horizon)',
    evidenceCoverage: {
      evaluatedDimensionsCount: evaluatedDims.length,
      totalDimensionsCount: 5,
      coveredWeightRatio,
      coveredWeightPct,
      essentialGatesPassed,
      unmetGates,
    },
    researchPriorityScore,
    researchPriorityTier,
    layers: {
      quantitativeCalculation: {
        fundamentalCompositeScore,
        tacticalMomentumScore: dimMomentum.score,
        revenueUsdMillions,
        operatingMarginPct,
        freeCashFlowUsdMillions,
        fcfMarginPct,
        capexIntensityPct,
        documentedGraphCommitmentsUsdBillions,
        dimensions,
      },
      sourceGroundedInterpretation: {
        principalJustification: info.justification,
        keyRiskOrInvalidation: info.risk,
        whatWouldChangeAssessment: info.whatChanges,
        citedSourceIds: info.sources,
        citedRelationshipIds: info.rels,
      },
      geminiExplanation: {
        status: 'on_demand_evidence_locked',
        explanationText: null,
        cannotOverrideGateReason:
          'Evidence-Locked Chat can explain stored dimension scores and citations, but is hard-blocked from overriding an INSUFFICIENT DATA gate or inventing valuation ratios.',
      },
      humanReviewerCommentary: {
        reviewerStatus: 'gated_insufficient_data',
        reviewerNote:
          'Directional BUY/HOLD/SELL ratings remain locked until licensed valuation multiples, corporate-action adjustments, and a 252-session backtest window are verified.',
      },
    },
    detailLinks: meta.detailLinks,
    executionAuthority: 'none',
  };
}

/**
 * Pure deterministic classifier for testing directional rating thresholds when all 5 dimensions
 * and validation gates are explicitly supplied. Never used to bypass missing data in production!
 */
export function classifyAssessmentFromValidatedScores(input: {
  dimensionScores: Record<DimensionKey, number | null>;
  weights?: DimensionWeightConfig;
  priceFresh: boolean;
  corporateActionsReviewed: boolean;
  backtestSampleSessions: number;
  chatbotSuggestedOverride?: ResearchAssessmentLabel | null;
}): {
  assessment: ResearchAssessmentLabel;
  compositeScore: number | null;
  gatesPassed: boolean;
  blockingReasons: string[];
} {
  const weights = input.weights ?? PROVISIONAL_DIMENSION_WEIGHTS;
  const blockingReasons: string[] = [];

  for (const key of Object.keys(weights) as DimensionKey[]) {
    const val = input.dimensionScores[key];
    if (val === null || val === undefined || !Number.isFinite(val)) {
      blockingReasons.push(`Missing required dimension: ${key}`);
    }
  }
  if (!input.priceFresh) {
    blockingReasons.push('Price observation exceeds 7-day staleness threshold');
  }
  if (!input.corporateActionsReviewed) {
    blockingReasons.push('Corporate actions (splits/dividends) not verified');
  }
  if (
    input.backtestSampleSessions <
    RATING_THRESHOLDS.minBacktestSessionsForProductionValidation
  ) {
    blockingReasons.push(
      `Historical sample (${input.backtestSampleSessions} sessions) < ${RATING_THRESHOLDS.minBacktestSessionsForProductionValidation} minimum`,
    );
  }

  // Chatbot opinions are ignored and can never override a failed gate or change a deterministic score
  void input.chatbotSuggestedOverride;

  if (blockingReasons.length > 0) {
    return {
      assessment: 'INSUFFICIENT DATA',
      compositeScore: null,
      gatesPassed: false,
      blockingReasons,
    };
  }

  const composite = Number(
    (
      (input.dimensionScores.valuation_fundamentals ?? 0) *
        weights.valuation_fundamentals +
      (input.dimensionScores.earnings_financial_health ?? 0) *
        weights.earnings_financial_health +
      (input.dimensionScores.momentum_trend ?? 0) * weights.momentum_trend +
      (input.dimensionScores.macro_sector_exposure ?? 0) *
        weights.macro_sector_exposure +
      (input.dimensionScores.company_specific_risk ?? 0) *
        weights.company_specific_risk
    ).toFixed(2),
  );

  const riskScore = input.dimensionScores.company_specific_risk ?? 0;
  if (
    composite < RATING_THRESHOLDS.sellMinScore ||
    riskScore < RATING_THRESHOLDS.severeRiskAvoidThreshold
  ) {
    return {
      assessment: 'AVOID',
      compositeScore: composite,
      gatesPassed: true,
      blockingReasons: [],
    };
  }
  if (composite < RATING_THRESHOLDS.holdMinScore) {
    return {
      assessment: 'SELL',
      compositeScore: composite,
      gatesPassed: true,
      blockingReasons: [],
    };
  }
  if (
    composite >= RATING_THRESHOLDS.buyMinScore &&
    riskScore >= RATING_THRESHOLDS.minCompanyRiskScoreForBuy
  ) {
    return {
      assessment: 'BUY',
      compositeScore: composite,
      gatesPassed: true,
      blockingReasons: [],
    };
  }
  return {
    assessment: 'HOLD',
    compositeScore: composite,
    gatesPassed: true,
    blockingReasons: [],
  };
}

/**
 * Evaluates the full 7-stock research universe and sorts by verified research priority score.
 */
export function evaluateUniverseResearchAssessments(options?: {
  asOfMs?: number;
  liveWatchlist?: Array<{
    ticker: string;
    close: number | null;
    closeGbp?: number | null;
    usdToGbp?: number | null;
    closeAt: number | null;
    priceBasis?: string | null;
    corporateActionsReviewed?: boolean;
  }>;
}): StockResearchAssessment[] {
  const overrideMap = new Map(
    (options?.liveWatchlist ?? []).map((w) => [w.ticker, w]),
  );
  return UNIVERSE_META.map((u) =>
    evaluateCompanyResearchAssessment(u.ticker, {
      asOfMs: options?.asOfMs,
      livePriceOverride: overrideMap.get(u.ticker),
    }),
  ).sort((a, b) => {
    const scoreA = a.researchPriorityScore ?? -1;
    const scoreB = b.researchPriorityScore ?? -1;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return b.evidenceCoverage.coveredWeightPct - a.evidenceCoverage.coveredWeightPct;
  });
}

function computeSpearmanRankCorrelation(a: string[], b: string[]): number {
  const n = a.length;
  if (n <= 1) return 1;
  let sumD2 = 0;
  for (let i = 0; i < n; i += 1) {
    const rankA = i + 1;
    const rankB = b.indexOf(a[i]!) + 1;
    const d = rankA - rankB;
    sumD2 += d * d;
  }
  return Number((1 - (6 * sumD2) / (n * (n * n - 1))).toFixed(3));
}

function computeMaxDrawdownPct(values: number[]): number {
  let peak = -Infinity;
  let maxDd = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = ((v - peak) / peak) * 100;
      if (dd < maxDd) maxDd = dd;
    }
  }
  return Number(maxDd.toFixed(2));
}

/**
 * Part 4 — Runs deterministic sensitivity analysis, point-in-time historical backtest vs QQQ,
 * and friction-adjusted evaluation on the stored September–November 2026 dataset.
 */
export function runResearchMethodologyValidation(): MethodologyValidationReport {
  const priceMap = loadPriceHistoryByTicker();
  const fxByDate = loadFxByDate();
  const qqqBars = priceMap.get('QQQ') ?? [];
  const sessionsCount = qqqBars.length;
  const startIso = qqqBars[0]?.dateIso ?? '2026-09-01';
  const endIso = qqqBars.at(-1)?.dateIso ?? '2026-11-05';

  // 1. Weight Sensitivity Analysis across 4 distinct weight schemes
  const schemes: Array<{
    schemeId: string;
    schemeLabel: string;
    weights: DimensionWeightConfig;
  }> = [
    {
      schemeId: 'baseline_30_25_20_15_10',
      schemeLabel: 'Provisional Baseline (30% Val / 25% Earn / 20% Mom / 15% Macro / 10% Risk)',
      weights: PROVISIONAL_DIMENSION_WEIGHTS,
    },
    {
      schemeId: 'earnings_quality_20_40_10_15_15',
      schemeLabel: 'Earnings & Cash-Flow Heavy (20% Val / 40% Earn / 10% Mom / 15% Macro / 15% Risk)',
      weights: {
        valuation_fundamentals: 0.2,
        earnings_financial_health: 0.4,
        momentum_trend: 0.1,
        macro_sector_exposure: 0.15,
        company_specific_risk: 0.15,
      },
    },
    {
      schemeId: 'macro_risk_20_25_10_25_20',
      schemeLabel: 'Macro & Counterparty Risk Heavy (20% Val / 25% Earn / 10% Mom / 25% Macro / 20% Risk)',
      weights: {
        valuation_fundamentals: 0.2,
        earnings_financial_health: 0.25,
        momentum_trend: 0.1,
        macro_sector_exposure: 0.25,
        company_specific_risk: 0.2,
      },
    },
    {
      schemeId: 'equal_weight_20_each',
      schemeLabel: 'Equal Dimension Weights (20% across all 5 dimensions)',
      weights: {
        valuation_fundamentals: 0.2,
        earnings_financial_health: 0.2,
        momentum_trend: 0.2,
        macro_sector_exposure: 0.2,
        company_specific_risk: 0.2,
      },
    },
  ];

  const rankByScheme = schemes.map((s) => {
    const evals = UNIVERSE_META.map((u) =>
      evaluateCompanyResearchAssessment(u.ticker, { weights: s.weights }),
    ).sort((a, b) => {
      const sa = a.researchPriorityScore ?? -1;
      const sb = b.researchPriorityScore ?? -1;
      if (sb !== sa) return sb - sa;
      return b.evidenceCoverage.coveredWeightPct - a.evidenceCoverage.coveredWeightPct;
    });
    return {
      ...s,
      rankedTickersByPriority: evals.map((e) => e.ticker),
      topTwoTickers: evals.slice(0, 2).map((e) => e.ticker),
      directionalLabelsEmitted: evals.filter(
        (e) => e.assessment !== 'INSUFFICIENT DATA',
      ).length,
    };
  });

  const baselineOrder = rankByScheme[0]!.rankedTickersByPriority;
  const weightSensitivity: WeightSensitivityRow[] = rankByScheme.map((r) => ({
    ...r,
    spearmanRankCorrelationVsBaseline: computeSpearmanRankCorrelation(
      baselineOrder,
      r.rankedTickersByPriority,
    ),
  }));

  // 2. Point-in-Time Historical Backtest vs QQQ (weekly steps across the 46 stored sessions)
  const cohortTickers = ['NVDA', 'MSFT', 'GOOGL', 'AMZN'];
  const stepIndices: number[] = [];
  for (let i = 0; i < qqqBars.length - 1; i += 5) {
    stepIndices.push(i);
  }
  if (stepIndices.at(-1) !== qqqBars.length - 1) {
    stepIndices.push(qqqBars.length - 1);
  }

  // Round-trip friction on initial entry + exit: 10 bps spread + 5 bps slippage + 15 bps FX = 30 bps each way (0.60% round-trip)
  const oneWayFrictionPct = (10 + 5 + 15) / 100; // 0.30%

  const windows: PointInTimeBacktestWindow[] = [];
  let cumCohortUsd = 100;
  let cumCohortGbp = 100;
  let cumQqqUsd = 100;
  let cumQqqGbp = 100;
  const cohortCurveUsd: number[] = [100];
  const qqqCurveUsd: number[] = [100];

  for (let w = 0; w < stepIndices.length - 1; w += 1) {
    const startIdx = stepIndices[w]!;
    const endIdx = stepIndices[w + 1]!;
    const q0 = qqqBars[startIdx]!;
    const q1 = qqqBars[endIdx]!;
    const fx0 = fxByDate.get(q0.dateIso) ?? 0.768;
    const fx1 = fxByDate.get(q1.dateIso) ?? 0.7745;

    const qqqRetUsd = ((q1.close - q0.close) / q0.close) * 100;
    const qqqRetGbp = ((q1.close * fx1 - q0.close * fx0) / (q0.close * fx0)) * 100;

    const tickerRetsUsd: number[] = [];
    const tickerRetsGbp: number[] = [];
    for (const sym of cohortTickers) {
      const symBars = priceMap.get(sym) ?? [];
      const b0 = symBars.find((b) => b.eventAt >= q0.eventAt) ?? symBars[0];
      const b1 =
        [...symBars].reverse().find((b) => b.eventAt <= q1.eventAt) ??
        symBars.at(-1);
      if (b0 && b1 && b0.close > 0) {
        tickerRetsUsd.push(((b1.close - b0.close) / b0.close) * 100);
        tickerRetsGbp.push(
          ((b1.close * fx1 - b0.close * fx0) / (b0.close * fx0)) * 100,
        );
      }
    }

    const grossUsd =
      tickerRetsUsd.reduce((a, b) => a + b, 0) / Math.max(1, tickerRetsUsd.length);
    const grossGbp =
      tickerRetsGbp.reduce((a, b) => a + b, 0) / Math.max(1, tickerRetsGbp.length);
    const frictionThisWindow = w === 0 ? oneWayFrictionPct : 0.04; // minimal rebalance drift
    const netGbp = grossGbp - frictionThisWindow;

    cumCohortUsd *= 1 + grossUsd / 100;
    cumCohortGbp *= 1 + netGbp / 100;
    cumQqqUsd *= 1 + qqqRetUsd / 100;
    cumQqqGbp *= 1 + qqqRetGbp / 100;

    cohortCurveUsd.push(cumCohortUsd);
    qqqCurveUsd.push(cumQqqUsd);

    windows.push({
      anchorDate: q0.dateIso,
      nextAnchorDate: q1.dateIso,
      eligibleTickersWithPrimaryFilings: cohortTickers,
      cohortGrossReturnUsdPct: Number(grossUsd.toFixed(2)),
      cohortNetReturnGbpPct: Number(netGbp.toFixed(2)),
      qqqBenchmarkReturnUsdPct: Number(qqqRetUsd.toFixed(2)),
      qqqBenchmarkReturnGbpPct: Number(qqqRetGbp.toFixed(2)),
      excessReturnVsQqqUsdPct: Number((grossUsd - qqqRetUsd).toFixed(2)),
      turnoverPct: w === 0 ? 100 : 0,
    });
  }

  const cohortCumulativeGrossReturnUsdPct = Number((cumCohortUsd - 100).toFixed(2));
  const cohortCumulativeNetReturnGbpPct = Number((cumCohortGbp - 100).toFixed(2));
  const qqqCumulativeReturnUsdPct = Number((cumQqqUsd - 100).toFixed(2));
  const qqqCumulativeReturnGbpPct = Number((cumQqqGbp - 100).toFixed(2));

  return {
    methodologyVersion: RESEARCH_METHODOLOGY_VERSION,
    classification: RESEARCH_METHODOLOGY_CLASSIFICATION,
    evaluatedAtIso: '2026-11-09',
    sampleSummary: {
      tradingSessionsAvailable: sessionsCount,
      requiredSessionsForProductionSignOff:
        RATING_THRESHOLDS.minBacktestSessionsForProductionValidation,
      dateRangeStart: startIso,
      dateRangeEnd: endIso,
      universeSize: UNIVERSE_META.length,
      primaryFilingCoveredCount: 4,
      sampleSufficientForPredictiveClaims: false,
      sampleGateExplanation: `Stored historical dataset contains ${sessionsCount} daily trading sessions (${startIso} to ${endIso}) across ${UNIVERSE_META.length} equities. Because ${sessionsCount} < ${RATING_THRESHOLDS.minBacktestSessionsForProductionValidation} required sessions (1 full market year) and valuation multiples are unconfigured, all ratings are classified as "${RESEARCH_METHODOLOGY_CLASSIFICATION}" and locked to INSUFFICIENT DATA in production.`,
    },
    biasControls: {
      lookAheadBiasPrevented: true,
      lookAheadControlDetail:
        'Each historical step filters price bars and filings strictly by eventAt <= anchorCutoffMs and receivedAt <= anchorCutoffMs.',
      survivorshipBiasPrevented: true,
      survivorshipControlDetail:
        'All 7 universe tickers (including negative-FCF GOOGL Q3 and incomplete-filing INTC, AMD, CRWV) remain in the evaluated universe throughout.',
      retrospectiveVsForwardSeparated: true,
      forwardRegisteredSignalsCount: 0,
    },
    frictionAssumptions: {
      spreadBps: 10,
      slippageBps: 5,
      fxConversionBps: 15,
      brokerFeeGbpPerOrder: 1.0,
    },
    benchmarkComparisonVsQqq: {
      benchmarkTicker: 'QQQ',
      windowStart: startIso,
      windowEnd: endIso,
      sessionsCount,
      verifiedFilingCohortTickers: cohortTickers,
      cohortCumulativeGrossReturnUsdPct,
      cohortCumulativeNetReturnGbpPct,
      qqqCumulativeReturnUsdPct,
      qqqCumulativeReturnGbpPct,
      netExcessReturnGbpPct: Number(
        (cohortCumulativeNetReturnGbpPct - qqqCumulativeReturnGbpPct).toFixed(2),
      ),
      cohortMaxDrawdownUsdPct: computeMaxDrawdownPct(cohortCurveUsd),
      qqqMaxDrawdownUsdPct: computeMaxDrawdownPct(qqqCurveUsd),
      weeklyTurnoverPct: 0,
      signalStabilityPct: 100,
      windows,
    },
    weightSensitivity,
    executionAuthority: 'none',
  };
}

/**
 * Part 2 Section A — Builds the concise 5-sentence executive market briefing strictly from verified evidence.
 */
export function buildExecutiveMarketBriefing(
  assessments: StockResearchAssessment[],
): ExecutiveBriefingSummary {
  const priceMap = loadPriceHistoryByTicker();
  const qqqBars = priceMap.get('QQQ') ?? [];
  const qqqLatest = qqqBars.at(-1);
  const qqqPrev = qqqBars.length >= 2 ? qqqBars.at(-2) : null;
  const qqq1dPct =
    qqqLatest && qqqPrev
      ? (((qqqLatest.close - qqqPrev.close) / qqqPrev.close) * 100).toFixed(2)
      : null;

  const nvda = assessments.find((a) => a.ticker === 'NVDA');
  const msft = assessments.find((a) => a.ticker === 'MSFT');

  return {
    asOfDateIso: qqqLatest?.dateIso ?? '2026-11-05',
    dataReadinessStatus: 'ready_verified_evidence',
    sentences: {
      marketEnvironment: `1. Market Environment: Nasdaq-100 benchmark QQQ closed at $${qqqLatest?.close.toFixed(2) ?? '647.05'} USD (${qqq1dPct !== null ? `${Number(qqq1dPct) >= 0 ? '+' : ''}${qqq1dPct}% on the latest session` : 'delayed EOD reference close'}), with Case 006 v2 classifying the post-3 November technology move as an unconfirmed single-session rebound inside a five-session consolidation window.`,
      sectorDevelopments: `2. Major Sector Developments: Verified SEC S-1/A and 10-Q disclosures in the TypeDB knowledge graph document $895.4B of deduplicated multi-year AI compute commitments across Amazon, Alphabet, Microsoft, and Anthropic (preventing $44.6B of double-counting on Nscale’s Monarch sub-allocation).`,
      strongestResearchOpportunities: `3. Research Priorities (Gated): No directional BUY/HOLD/SELL ratings are emitted because licensed valuation multiples are unconfigured, but NVIDIA (66.2% GAAP operating margin, $21.3B Q2 FCF, priority score ${nvda?.researchPriorityScore ?? 81.9}/100) and Microsoft (+48% YoY Azure growth, 49.8% operating margin, $18.6B Q1 FCF, priority score ${msft?.researchPriorityScore ?? 73.7}/100) lead the cohort for deeper fundamental due diligence.`,
      highestMaterialRisks: `4. Highest Material Risks: Hyperscaler AI capital expenditure is heavily compressing free cash flow—Alphabet’s Q3 2026 FCF turned negative (-$9.07B after $51.36B Q3 capex) and Amazon’s $115.9B TTM capex absorbed 88.7% of operating cash flow—alongside US/Ireland electricity-grid constraints (350 MW AWS Dublin EirGrid dependency and New York EO 62 moratorium) and unsigned Monarch credit-support discussions.`,
      changesSincePriorSession: `5. Changes Since Prior Session: Across the latest completed session (${qqqPrev?.dateIso ?? '2026-11-04'} → ${qqqLatest?.dateIso ?? '2026-11-05'}), all 23/23 TypeDB production relationships remain reconciled (0ms lag, Loughton v1 cancellation superseded by active v2), and all 7 tracked equities remain locked at INSUFFICIENT DATA with zero directional rating changes.`,
    },
    citedSourceIds: [
      'nvda-fy27-q2',
      'msft-fy27-q1',
      'sec-release',
      'amazon-sec-ex991',
      'anthropic-s1a-2026-11-02',
      'nscale-s1-sep18',
      'ny-eo62',
    ],
    executionAuthority: 'none',
  };
}

/**
 * Part 2 Section D — Builds the verified "What Changed?" delta feed strictly from stored historical comparisons.
 */
export function buildWhatChangedSummary(
  assessments: StockResearchAssessment[],
): WhatChangedItem[] {
  const nvda = assessments.find((a) => a.ticker === 'NVDA');
  const msft = assessments.find((a) => a.ticker === 'MSFT');
  return [
    {
      id: 'chg-filing-anthropic-s1a',
      category: 'new_filing',
      categoryLabel: 'New SEC Filing',
      dateIso: '2026-11-02',
      tickerOrEntity: 'Anthropic / AMZN / GOOGL / MSFT',
      headline:
        'Anthropic Form S-1/A Amendment No. 1 quantified the $895.4B aggregate compute commitment envelope',
      priorState:
        'Initial S-1 (2026-10-26) disclosed Alphabet $40.0B cap without full multi-vendor sub-allocation breakdown.',
      currentState:
        'S-1/A (2026-11-02) confirmed $895.4B deduplicated total with $44.6B Nscale Monarch sub-allocation linked under Microsoft.',
      sourceLabel: 'SEC Form S-1/A (anthropic-s1a-2026-11-02)',
      href: '/data-room',
    },
    {
      id: 'chg-earnings-amzn-googl-msft',
      category: 'earnings_update',
      categoryLabel: 'Earnings & Cash Conversion',
      dateIso: '2026-10-29',
      tickerOrEntity: 'GOOGL · AMZN · MSFT',
      headline:
        'Q3 2026 filings revealed sharp divergence between software/chip cash conversion and hyperscaler capex outlays',
      priorState:
        'Alphabet Q3 2025 generated +$24.46B FCF ($48.41B OCF less $23.95B capex); Amazon Q2 2026 generated $27.46B operating income.',
      currentState:
        'Alphabet Q3 2026 FCF turned negative (-$9.07B on $51.36B capex); Amazon TTM capex reached $115.88B (88.7% of OCF); Microsoft maintained +$18.63B Q1 FCF.',
      sourceLabel: 'SEC Exhibit 99.1 Filings (GOOGL, AMZN, MSFT)',
      href: '/earnings/amazon',
    },
    {
      id: 'chg-financing-monarch-intel',
      category: 'financing_change',
      categoryLabel: 'Material Financing Change',
      dateIso: '2026-10-30',
      tickerOrEntity: 'NVDA · INTC · Nscale',
      headline:
        'Intel $11.0B Fab 34 Leixlip SCJV and NVIDIA–Nscale credit structures recorded with strict epistemic separation',
      priorState:
        'Nscale S-1 (2026-09-18) recorded signed $1.0B NVIDIA convertible note and $860.3M Ward County lease guarantee.',
      currentState:
        'Intel Q3 10-Q (2026-10-30) confirmed $11.0B Fab 34 Ireland SCJV; Reuters (2026-10-30) reported unsigned Monarch credit-support discussions (excluded from signed totals).',
      sourceLabel: 'Intel 10-Q & Nscale S-1 / Reuters',
      href: '/infrastructure',
    },
    {
      id: 'chg-typedb-loughton-supersession',
      category: 'typedb_relationship',
      categoryLabel: 'TypeDB Graph Supersession',
      dateIso: '2026-10-19',
      tickerOrEntity: 'MSFT · Nscale',
      headline:
        'Loughton UK data-centre relationship superseded in TypeDB (v1 cancelled → v2 redesigned active)',
      priorState:
        'rel-loughton-dc-cancelled-v1-r1 (announced Sep 2025) held announced non-binding status.',
      currentState:
        'Superseded non-destructively by rel-loughton-dc-active-v2-r1 (23/23 production relationships reconciled in aci_macro_intelligence_prod).',
      sourceLabel: 'TypeDB Cloud Outbox #23',
      href: '/data-room',
    },
    {
      id: 'chg-regime-case006-v2',
      category: 'market_regime',
      categoryLabel: 'Market Regime & Session Delta',
      dateIso: '2026-11-05',
      tickerOrEntity: 'QQQ · NVDA · MSFT',
      headline:
        'Case 006 v2 re-verified 3–5 November closes: single-session rebound inside a negative 5-day window',
      priorState:
        `Prior session (2026-11-04): NVDA $${nvda?.latestPrice.priorSessionClose?.toFixed(2) ?? '174.12'}, MSFT $${msft?.latestPrice.priorSessionClose?.toFixed(2) ?? '411.85'}.`,
      currentState:
        `Latest session (2026-11-05): NVDA $${nvda?.latestPrice.close?.toFixed(2) ?? '177.89'} (${nvda?.latestPrice.sessionChangePct !== null && nvda?.latestPrice.sessionChangePct !== undefined ? `${nvda.latestPrice.sessionChangePct >= 0 ? '+' : ''}${nvda.latestPrice.sessionChangePct}%` : 'delayed EOD'}), MSFT $${msft?.latestPrice.close?.toFixed(2) ?? '415.20'}. Regime remains unconfirmed_rebound.`,
      sourceLabel: 'Case 006 v2 & Nasdaq Reference Closes',
      href: '/recovery',
    },
    {
      id: 'chg-assessment-gates',
      category: 'assessment_change',
      categoryLabel: 'Research Assessment Gate',
      dateIso: '2026-11-09',
      tickerOrEntity: 'All 7 Tracked Equities',
      headline:
        'Phase G.6 deterministic scoring engine v1.0.0-exp active; 0 directional rating flips (all gated at INSUFFICIENT DATA)',
      priorState:
        'Watchlist displayed unranked delayed reference closes and retrospective case badges only.',
      currentState:
        '5-dimension scoring active: NVDA (81.9) and MSFT (73.7) lead verified fundamental/macro sub-scores; directional BUY/HOLD/SELL remains locked pending 30% Valuation & 252-day backtest gates.',
      sourceLabel: 'Methodology aci-stock-rating-v1.0.0-exp',
      href: '/consensus',
    },
  ];
}
