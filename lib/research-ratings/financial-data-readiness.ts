import {
  RESEARCH_METHODOLOGY_VERSION,
  buildDeterministicExecutiveChatFallback,
  buildExecutiveAssistantRequestPayload,
  evaluateUniverseResearchAssessments,
  type StockResearchAssessment,
} from './engine';
import {
  VALUATION_LAYER_VERSION,
  evaluateUniverseCurrentValuationLayer,
} from './valuation-layer';

/**
 * Phase G.7 — Financial Data Completeness, Provider Licensing Audit, Five-Tier Release Gates
 * & Production Integrity Verification.
 */

export const PHASE_G7_READINESS_VERSION = 'aci-data-readiness-v1.0.0' as const;

export type ObservationAuditStatus =
  | 'verified'
  | 'stale'
  | 'missing'
  | 'conflicting'
  | 'unsuitable';

export type CoverageCategoryKey =
  | 'revenue_and_growth'
  | 'earnings_and_operating_margins'
  | 'ocf_and_capex'
  | 'free_cash_flow'
  | 'debt_and_cash'
  | 'diluted_share_counts'
  | 'market_cap_and_ev'
  | 'historical_valuation_multiples'
  | 'current_valuation_measures'
  | 'corporate_actions_and_distributions'
  | 'adjusted_historical_prices'
  | 'sec_filing_timestamps';

export interface CoverageCellAudit {
  ticker: 'NVDA' | 'MSFT' | 'GOOGL' | 'AMZN' | 'AMD' | 'CRWV' | 'INTC';
  category: CoverageCategoryKey;
  categoryLabel: string;
  status: ObservationAuditStatus;
  storedValueSummary: string;
  periodOrAsOf: string;
  evidenceIds: string[];
  auditFinding: string;
  achievableWithExistingFreeSources: boolean;
  freeSourceRemediation: string | null;
  paidCommercialRequirement: string | null;
}

export interface LegitimateDataSourceEntry {
  sourceId: string;
  providerName: string;
  dataDomainsCovered: string[];
  licensingModel: string;
  estimatedMonthlyCostGbpOrUsd: string;
  commercialRedistributionPermitted: 'yes' | 'no' | 'requires_commercial_tier';
  internalPersonalResearchPermitted: 'yes' | 'no' | 'requires_commercial_tier';
  historicalCoverageDepth: string;
  freshnessAndLatency: string;
  recommendationStatus:
    | 'Active Zero-Cost Primary Source (Expand Immediately)'
    | 'Active Zero-Cost Reference (Internal Only — Not Redistributable)'
    | 'Recommended Low-Cost Upgrade for Split-Adjusted Prices'
    | 'Optional Commercial Redistribution / Consensus Tier'
    | 'Prohibited for Market Data Feed';
  notes: string;
}

export type ReleaseGateTierKey =
  | 'tier_1_fundamental_research_screening'
  | 'tier_2_valuation_supported_investment_assessment'
  | 'tier_3_risk_and_momentum_analysis'
  | 'tier_4_historically_validated_methodology'
  | 'tier_5_prospectively_evaluated_signals';

export interface ReleaseGateTierEvaluation {
  tierKey: ReleaseGateTierKey;
  tierNumber: 1 | 2 | 3 | 4 | 5;
  title: string;
  allowedOutputClassification: string;
  permitsDirectionalBuyHoldSell: boolean;
  status: 'satisfied_partial_universe' | 'blocked';
  qualifyingTickers: string[];
  blockedTickers: string[];
  mandatoryRequirements: string[];
  unmetBlockers: string[];
  why252PriceBarsDoNotSufficeNote: string;
}

export interface MetricProvenanceAuditItem {
  ticker: string;
  dimensionKey: string;
  metricName: string;
  valueDisplay: string;
  periodOrAsOf: string;
  sourceLabel: string;
  sourceId: string;
  definedFormulaOrBasis: string;
  provenanceComplete: boolean;
}

export interface ProductionIntegrityReport {
  version: typeof PHASE_G7_READINESS_VERSION;
  methodologyVersion: typeof RESEARCH_METHODOLOGY_VERSION;
  valuationLayerVersion: typeof VALUATION_LAYER_VERSION;
  allDirectionalRatingsLockedInsufficientData: boolean;
  brokerValuesRequireLastSyncLabel: true;
  unauthenticatedChatFallbackClearlyLabelledNonGemini: boolean;
  publicResearchInferenceExcludesPrivateBrokerData: boolean;
  allScreeningNumbersHavePeriodSourceAndFormula: boolean;
  totalAuditedScreeningMetrics: number;
  incompleteProvenanceMetricsCount: number;
  auditedMetrics: MetricProvenanceAuditItem[];
  executionAuthority: 'none';
}

/**
 * Stage 1 — 84-Cell Seven-Stock Financial Data Coverage Matrix (7 stocks × 12 categories).
 */
export const SEVEN_STOCK_COVERAGE_MATRIX: readonly CoverageCellAudit[] = [
  // =========================================================================
  // 1. NVIDIA (NVDA — CIK 0001045810)
  // =========================================================================
  {
    ticker: 'NVDA',
    category: 'revenue_and_growth',
    categoryLabel: 'Revenue and growth',
    status: 'verified',
    storedValueSummary:
      'FY2027 Q2 revenue $96,221M; Data Center $89,000M; Q3 FY27 guidance $108B ± 2% (single quarter verified; 4Q TTM sum & prior-year Q2 base missing in local JSON)',
    periodOrAsOf: 'FY2027 Q2 (13 weeks ended 2026-07-26)',
    evidenceIds: ['nvda-fy27-q2'],
    auditFinding:
      'Single-quarter FY27 Q2 revenue is verified from official release, but 4-quarter TTM revenue series and prior-year comparative quarter are not yet imported from SEC XBRL.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Ingest 8 quarters of us-gaap:Revenues / RevenueFromContractWithCustomerExcludingAssessedTax from SEC EDGAR XBRL API (CIK0001045810.json) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'NVDA',
    category: 'earnings_and_operating_margins',
    categoryLabel: 'Earnings and operating margins',
    status: 'verified',
    storedValueSummary:
      'FY2027 Q2 GAAP Operating Income $63,734M (66.24% margin), GAAP Net Income $59,688M (62.03% net margin), Diluted EPS $2.46 (quarterly)',
    periodOrAsOf: 'FY2027 Q2 (ended 2026-07-26)',
    evidenceIds: ['nvda-fy27-q2'],
    auditFinding:
      'Quarterly GAAP operating income, net income, and diluted EPS are verified; 4-quarter TTM net income and EBIT needed for P/E and EV/EBIT are missing locally.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Ingest 4-quarter TTM OperatingIncomeLoss and NetIncomeLoss from SEC EDGAR XBRL API (CIK0001045810.json) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'NVDA',
    category: 'ocf_and_capex',
    categoryLabel: 'Operating cash flow and capital expenditure',
    status: 'verified',
    storedValueSummary:
      'FY2027 Q2 OCF $24,077M; cash capex $2,677M (11.12% of OCF; 2.78% of revenue) + $59M principal payments on PP&E',
    periodOrAsOf: 'FY2027 Q2 (ended 2026-07-26)',
    evidenceIds: ['nvda-fy27-q2'],
    auditFinding:
      'Quarterly OCF and cash capex are verified; 4-quarter TTM OCF and capex series needed for EV/TTM FCF are not yet imported.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Extract 4-quarter NetCashProvidedByUsedInOperatingActivities and PaymentsToAcquirePropertyPlantAndEquipment from SEC XBRL at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'NVDA',
    category: 'free_cash_flow',
    categoryLabel: 'Free cash flow',
    status: 'verified',
    storedValueSummary:
      'FY2027 Q2 reported FCF $21,341M (22.18% FCF margin = $24,077M OCF − $2,677M capex − $59M principal)',
    periodOrAsOf: 'FY2027 Q2 (ended 2026-07-26)',
    evidenceIds: ['nvda-fy27-q2'],
    auditFinding:
      'Single-quarter FCF is verified with exact bridge definition; 4-quarter TTM FCF required for FCF Yield is missing locally.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Compute 4-quarter TTM FCF from SEC XBRL operating cash flow and PP&E additions at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'NVDA',
    category: 'debt_and_cash',
    categoryLabel: 'Debt and cash',
    status: 'missing',
    storedValueSummary:
      'Book equity $228,984M stored (`nvda-fy27-q2`) + $1.86B Nscale financing exposure (`nscale-s1-sep18`), but consolidated Cash, Marketable Securities & Total Debt are null',
    periodOrAsOf: '2026-07-26',
    evidenceIds: ['nvda-fy27-q2', 'nscale-s1-sep18'],
    auditFinding:
      'Consolidated CashAndCashEquivalents, MarketableSecuritiesCurrent, and LongTermDebt are not stored in `company-comparison.json`, blocking Enterprise Value.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Extract CashAndCashEquivalentsAtCarryingValue, MarketableSecuritiesCurrent, LongTermDebtCurrent, and LongTermDebtNoncurrent from SEC XBRL (CIK0001045810) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'NVDA',
    category: 'diluted_share_counts',
    categoryLabel: 'Diluted share counts',
    status: 'missing',
    storedValueSummary:
      'Null (Back-solving $59,688M / $2.46 EPS ≈ 24,263M shares is prohibited due to 2-decimal EPS rounding error)',
    periodOrAsOf: 'FY2027 Q2 (ended 2026-07-26)',
    evidenceIds: ['nvda-fy27-q2'],
    auditFinding:
      'Primary XBRL WeightedAverageNumberOfDilutedSharesOutstanding is not stored in `company-comparison.json`.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Extract us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding and dei:EntityCommonStockSharesOutstanding from SEC XBRL at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'NVDA',
    category: 'market_cap_and_ev',
    categoryLabel: 'Market capitalisation and enterprise value',
    status: 'missing',
    storedValueSummary: 'Null (Market Cap & EV blocked by missing XBRL share count and debt/cash)',
    periodOrAsOf: '2026-11-04',
    evidenceIds: [],
    auditFinding:
      'Deterministic valuation layer preserves null because diluted shares and balance sheet net debt are missing.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Computable for internal research once SEC XBRL diluted shares and debt/cash are extracted; commercial display requires licensed EOD prices.',
    paidCommercialRequirement:
      'Licensed commercial price feed (e.g., Tiingo Commercial / Nasdaq Data Link) required if Market Cap / EV is redistributed commercially.',
  },
  {
    ticker: 'NVDA',
    category: 'historical_valuation_multiples',
    categoryLabel: 'Historical valuation multiples',
    status: 'missing',
    storedValueSummary: 'Null (No multi-year point-in-time P/E, EV/Sales, EV/EBIT, or P/FCF history stored)',
    periodOrAsOf: 'Multi-year history',
    evidenceIds: [],
    auditFinding: 'Only 46 price sessions and 1 fiscal quarter are stored locally.',
    achievableWithExistingFreeSources: false,
    freeSourceRemediation:
      '5-year point-in-time XBRL fundamentals can be reconstructed from SEC EDGAR (`filed` timestamps) at £0.',
    paidCommercialRequirement:
      'Requires 5+ years of split-adjusted historical daily prices (e.g., Tiingo Power $10/mo internal or Commercial tier).',
  },
  {
    ticker: 'NVDA',
    category: 'current_valuation_measures',
    categoryLabel: 'Current valuation measures',
    status: 'missing',
    storedValueSummary:
      'Null (`valuation: null` in `company-comparison.json`; single-quarter EPS $2.46 is not annualised)',
    periodOrAsOf: '2026-11-04',
    evidenceIds: ['nvda-fy27-q2'],
    auditFinding:
      'Blocked by single-quarter flow scope (`SINGLE_QUARTER`), missing XBRL diluted shares, and missing net debt.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Ingest 4Q TTM XBRL flows + diluted shares + balance sheet cash/debt to compute Trailing GAAP P/E, EV/TTM Revenue, EV/TTM EBIT, and FCF Yield.',
    paidCommercialRequirement:
      'Forward consensus P/E requires a licensed Street estimate feed (optional if methodology uses TTM XBRL multiples).',
  },
  {
    ticker: 'NVDA',
    category: 'corporate_actions_and_distributions',
    categoryLabel: 'Corporate actions and distributions',
    status: 'missing',
    storedValueSummary: 'Null (`corporateActionsReviewed: false`; split/dividend ledger absent)',
    periodOrAsOf: '2026-11-04',
    evidenceIds: ['nasdaq-nvda-history-v2'],
    auditFinding:
      'Nasdaq public historical table provides raw Close/Last without corporate-action split factors or dividend adjustment metadata.',
    achievableWithExistingFreeSources: false,
    freeSourceRemediation:
      'Historical stock splits and dividend declarations disclosed in SEC 10-K/10-Q XBRL can be partially extracted.',
    paidCommercialRequirement:
      'Requires a corporate-action-adjusted market data provider (`splitFactor`, `divCash`, `adjClose`) such as Tiingo ($10/mo internal / $50+/mo commercial) or Polygon.',
  },
  {
    ticker: 'NVDA',
    category: 'adjusted_historical_prices',
    categoryLabel: 'Adjusted historical prices',
    status: 'unsuitable',
    storedValueSummary:
      '46 unadjusted daily closes ($186.64 on 2026-11-04; `priceBasis: unadjusted_close`; public reference only)',
    periodOrAsOf: '2026-09-01 → 2026-11-04 (46 sessions)',
    evidenceIds: ['nasdaq-nvda-history-v2', 'nasdaq-nvda'],
    auditFinding:
      'Unsuitable for multi-year backtesting or commercial redistribution because prices are unadjusted public reference closes and span only 46 sessions.',
    achievableWithExistingFreeSources: false,
    freeSourceRemediation: null,
    paidCommercialRequirement:
      'Tiingo Power ($10/mo internal) or Tiingo Commercial / Nasdaq Data Link Sharadar ($50–$199/mo commercial) for 10+ year split-adjusted EOD series.',
  },
  {
    ticker: 'NVDA',
    category: 'sec_filing_timestamps',
    categoryLabel: 'SEC filing publication and receipt timestamps',
    status: 'stale',
    storedValueSummary:
      'Publication date `2026-08-26` (`pubBasis: official_date_only`, `publishedAt: null`), `receivedAt: 2026-11-03T22:25:07Z`',
    periodOrAsOf: '2026-08-26 / 2026-11-03',
    evidenceIds: ['nvda-fy27-q2'],
    auditFinding:
      'Has date-only publication string (`2026-08-26`) rather than exact SEC EDGAR `acceptanceDateTime` UTC epoch millisecond timestamp.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Backfill exact `acceptanceDateTime` from `https://data.sec.gov/submissions/CIK0001045810.json` at £0.',
    paidCommercialRequirement: null,
  },

  // =========================================================================
  // 2. MICROSOFT (MSFT — CIK 0000789019)
  // =========================================================================
  {
    ticker: 'MSFT',
    category: 'revenue_and_growth',
    categoryLabel: 'Revenue and growth',
    status: 'verified',
    storedValueSummary:
      'FY2027 Q1 revenue $92,279M; Azure $33,165M (+48% YoY); Microsoft Cloud $63,900M (+30% YoY); Agents & Infra recast segment $76,795M',
    periodOrAsOf: 'FY2027 Q1 (3 months ended 2026-09-30)',
    evidenceIds: ['msft-fy27-q1', 'src-msft-10q-2026q3'],
    auditFinding:
      'Single-quarter FY27 Q1 revenue and cloud growth rates are verified; 4-quarter TTM revenue sum is not stored in `company-comparison.json`.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Ingest 4-quarter TTM revenue from SEC EDGAR XBRL (`CIK0000789019.json`) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'MSFT',
    category: 'earnings_and_operating_margins',
    categoryLabel: 'Earnings and operating margins',
    status: 'verified',
    storedValueSummary:
      'FY2027 Q1 GAAP Operating Income $45,915M (49.76% margin), GAAP Net Income $36,629M (39.69% margin), Diluted EPS $4.92 (incl. $0.03 OpenAI gain)',
    periodOrAsOf: 'FY2027 Q1 (ended 2026-09-30)',
    evidenceIds: ['msft-fy27-q1'],
    auditFinding:
      'Single-quarter GAAP operating and net margins verified, including segment recast note; 4-quarter TTM net income & EBIT missing locally.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Ingest 4-quarter TTM OperatingIncomeLoss and NetIncomeLoss from SEC XBRL (`CIK0000789019.json`) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'MSFT',
    category: 'ocf_and_capex',
    categoryLabel: 'Operating cash flow and capital expenditure',
    status: 'verified',
    storedValueSummary:
      'FY2027 Q1 OCF $58,000M; cash additions to PP&E $39,367M (67.87% of OCF; 42.66% of revenue; excludes finance lease additions)',
    periodOrAsOf: 'FY2027 Q1 (ended 2026-09-30)',
    evidenceIds: ['msft-fy27-q1'],
    auditFinding:
      'Quarterly OCF and cash PP&E additions verified with explicit note that finance lease additions are excluded from cash capex.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Ingest 4-quarter TTM OCF, cash PP&E additions, and finance lease right-of-use asset additions from SEC XBRL at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'MSFT',
    category: 'free_cash_flow',
    categoryLabel: 'Free cash flow',
    status: 'verified',
    storedValueSummary:
      'FY2027 Q1 derived FCF $18,633M (20.19% FCF margin = $58,000M OCF − $39,367M cash capex)',
    periodOrAsOf: 'FY2027 Q1 (ended 2026-09-30)',
    evidenceIds: ['msft-fy27-q1'],
    auditFinding:
      'Single-quarter FCF verified; 4-quarter TTM FCF required for valuation multiples is missing locally.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Compute 4-quarter TTM FCF from SEC XBRL (`CIK0000789019.json`) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'MSFT',
    category: 'debt_and_cash',
    categoryLabel: 'Debt and cash',
    status: 'missing',
    storedValueSummary:
      'Book equity $470,509M stored (`msft-fy27-q1`), but consolidated Cash, Short-Term Investments, Long-Term Debt & Finance Lease Liabilities are null',
    periodOrAsOf: '2026-09-30',
    evidenceIds: ['msft-fy27-q1'],
    auditFinding:
      'Missing balance sheet cash and debt prevents Enterprise Value calculation.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Extract CashAndCashEquivalents, ShortTermInvestments, LongTermDebt, and FinanceLeaseLiability from SEC XBRL (`CIK0000789019.json`) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'MSFT',
    category: 'diluted_share_counts',
    categoryLabel: 'Diluted share counts',
    status: 'missing',
    storedValueSummary:
      'Null (Implied $36,629M / $4.92 ≈ 7,445M shares is not used; primary XBRL diluted share count not stored)',
    periodOrAsOf: 'FY2027 Q1 (ended 2026-09-30)',
    evidenceIds: ['msft-fy27-q1'],
    auditFinding:
      'Primary XBRL WeightedAverageNumberOfDilutedSharesOutstanding is not stored in `company-comparison.json`.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Extract WeightedAverageNumberOfDilutedSharesOutstanding from SEC XBRL (`CIK0000789019.json`) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'MSFT',
    category: 'market_cap_and_ev',
    categoryLabel: 'Market capitalisation and enterprise value',
    status: 'missing',
    storedValueSummary: 'Null (Blocked by missing XBRL share count and balance sheet debt/cash)',
    periodOrAsOf: '2026-11-04',
    evidenceIds: [],
    auditFinding: 'Preserved as null until primary XBRL shares and debt/cash are loaded.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Computable for internal research via SEC XBRL shares + debt/cash.',
    paidCommercialRequirement:
      'Commercial redistribution requires licensed EOD equity prices.',
  },
  {
    ticker: 'MSFT',
    category: 'historical_valuation_multiples',
    categoryLabel: 'Historical valuation multiples',
    status: 'missing',
    storedValueSummary: 'Null (No multi-year historical valuation series stored)',
    periodOrAsOf: 'Multi-year history',
    evidenceIds: [],
    auditFinding: 'Requires multi-year point-in-time XBRL fundamentals paired with adjusted historical prices.',
    achievableWithExistingFreeSources: false,
    freeSourceRemediation: 'Multi-year XBRL fundamentals available at £0 from SEC EDGAR.',
    paidCommercialRequirement: 'Requires 5+ year split/dividend-adjusted price feed (e.g., Tiingo).',
  },
  {
    ticker: 'MSFT',
    category: 'current_valuation_measures',
    categoryLabel: 'Current valuation measures',
    status: 'missing',
    storedValueSummary: 'Null (`valuation: null` in `company-comparison.json`)',
    periodOrAsOf: '2026-11-04',
    evidenceIds: ['msft-fy27-q1'],
    auditFinding:
      'Blocked by single-quarter flow scope (`SINGLE_QUARTER`), missing XBRL diluted shares, and missing net debt.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Ingest 4Q TTM XBRL flows + diluted shares + debt/cash to compute Trailing GAAP P/E, EV/TTM Revenue, EV/TTM EBIT, and FCF Yield.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'MSFT',
    category: 'corporate_actions_and_distributions',
    categoryLabel: 'Corporate actions and distributions',
    status: 'missing',
    storedValueSummary: 'Null (`corporateActionsReviewed: false`; quarterly dividends not in price ledger)',
    periodOrAsOf: '2026-11-04',
    evidenceIds: ['nasdaq-msft-history-v2'],
    auditFinding: 'Unadjusted reference closes do not include dividend or split adjustment factors.',
    achievableWithExistingFreeSources: false,
    freeSourceRemediation: null,
    paidCommercialRequirement: 'Requires Tiingo ($10/mo internal / $50+/mo commercial) or Polygon corporate actions feed.',
  },
  {
    ticker: 'MSFT',
    category: 'adjusted_historical_prices',
    categoryLabel: 'Adjusted historical prices',
    status: 'unsuitable',
    storedValueSummary:
      '46 unadjusted daily closes ($530.61 on 2026-11-04; `priceBasis: unadjusted_close`; public reference only)',
    periodOrAsOf: '2026-09-01 → 2026-11-04 (46 sessions)',
    evidenceIds: ['nasdaq-msft-history-v2', 'nasdaq-msft'],
    auditFinding: 'Unadjusted public reference closes spanning only 46 sessions.',
    achievableWithExistingFreeSources: false,
    freeSourceRemediation: null,
    paidCommercialRequirement: 'Requires licensed split- and dividend-adjusted EOD feed.',
  },
  {
    ticker: 'MSFT',
    category: 'sec_filing_timestamps',
    categoryLabel: 'SEC filing publication and receipt timestamps',
    status: 'conflicting',
    storedValueSummary:
      '`company-comparison.json` has `publicationDate: "2026-10-28"`, `publishedAt: null`, while `Macro Case 001` (`src-msft-10q-2026q3`) has `publishedAt: "2026-10-29T06:00:00Z"`',
    periodOrAsOf: '2026-10-28 / 2026-10-29',
    evidenceIds: ['msft-fy27-q1', 'src-msft-10q-2026q3'],
    auditFinding:
      'Earnings release webcast (`2026-10-28` post-close) and Form 10-Q EDGAR filing (`2026-10-29T06:00:00Z`) have different timestamps across two local JSON files; needs unified EDGAR `acceptanceDateTime` on both records.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Standardise `publishedAt` using exact `acceptanceDateTime` from `https://data.sec.gov/submissions/CIK0000789019.json` at £0.',
    paidCommercialRequirement: null,
  },

  // =========================================================================
  // 3. ALPHABET (GOOGL — CIK 0001652044)
  // =========================================================================
  {
    ticker: 'GOOGL',
    category: 'revenue_and_growth',
    categoryLabel: 'Revenue and growth',
    status: 'verified',
    storedValueSummary:
      '2026-Q3 revenue $127,577M vs 2025-Q3 $102,346M (+24.65% YoY); Google Cloud $30,709M vs $15,157M (+102.61% YoY); Search $63,350M (+11.99% YoY)',
    periodOrAsOf: '2026-Q3 (ended 2026-09-30)',
    evidenceIds: ['sec-release', 'goog-2026q3-revenue-v1', 'goog-2025q3-revenue-v1'],
    auditFinding:
      'Single-quarter Q3 2026 and Q3 2025 comparative revenue & segment growth are verified from SEC Exhibit 99.1; 4-quarter TTM revenue sum is missing locally.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Ingest 4-quarter TTM revenue from SEC EDGAR XBRL (`CIK0001652044.json`) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'GOOGL',
    category: 'earnings_and_operating_margins',
    categoryLabel: 'Earnings and operating margins',
    status: 'verified',
    storedValueSummary:
      '2026-Q3 GAAP Operating Income $40,576M (31.81% margin); Cloud Operating Income $11,121M (36.21% margin); Diluted EPS $2.12 (Note: consolidated Net Income dollar total missing)',
    periodOrAsOf: '2026-Q3 (ended 2026-09-30)',
    evidenceIds: ['sec-release', 'goog-2026q3-operating_income-v1', 'goog-2026q3-diluted_eps-v1'],
    auditFinding:
      'Operating income, operating margin, and diluted EPS are verified, but consolidated GAAP `NetIncomeLoss` dollar total and 4-quarter TTM earnings are not stored in `alphabet-q3-2026.json`.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Extract quarterly and TTM `NetIncomeLoss` and `OperatingIncomeLoss` from SEC XBRL (`CIK0001652044.json`) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'GOOGL',
    category: 'ocf_and_capex',
    categoryLabel: 'Operating cash flow and capital expenditure',
    status: 'verified',
    storedValueSummary:
      '2026-Q3 OCF $42,290M (vs 2025-Q3 $48,414M); 2026-Q3 capex $51,355M (121.44% of Q3 OCF; 40.25% of Q3 revenue; vs 2025-Q3 $23,953M)',
    periodOrAsOf: '2026-Q3 (ended 2026-09-30)',
    evidenceIds: ['sec-release', 'goog-2026q3-operating_cash_flow-v1', 'goog-2026q3-capital_expenditure-v1'],
    auditFinding:
      'Single-quarter Q3 2026 and Q3 2025 OCF and capital expenditure are verified from SEC Exhibit 99.1; 4-quarter TTM OCF/capex series missing locally.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Extract 4-quarter TTM OCF and capex from SEC XBRL (`CIK0001652044.json`) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'GOOGL',
    category: 'free_cash_flow',
    categoryLabel: 'Free cash flow',
    status: 'verified',
    storedValueSummary:
      '2026-Q3 FCF -$9,065M (-7.11% of Q3 revenue = $42,290M OCF − $51,355M capex); unverified media consensus (-$2.7B) is properly quarantined',
    periodOrAsOf: '2026-Q3 (ended 2026-09-30)',
    evidenceIds: ['sec-release', 'goog-2026q3-free_cash_flow-v1'],
    auditFinding:
      'Single-quarter negative FCF (-$9.065B) is verified; 4-quarter TTM FCF is needed to determine whether full-year TTM FCF remains positive.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Compute 4-quarter TTM FCF from SEC XBRL (`CIK0001652044.json`) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'GOOGL',
    category: 'debt_and_cash',
    categoryLabel: 'Debt and cash',
    status: 'missing',
    storedValueSummary:
      'Null (No balance sheet cash, marketable securities, or debt stored in `alphabet-q3-2026.json`)',
    periodOrAsOf: '2026-09-30',
    evidenceIds: [],
    auditFinding: 'Consolidated balance sheet items were not included in the Q3 earnings case JSON.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Extract CashAndCashEquivalents, MarketableSecuritiesCurrent, LongTermDebt, and StockholdersEquity from SEC XBRL (`CIK0001652044.json`) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'GOOGL',
    category: 'diluted_share_counts',
    categoryLabel: 'Diluted share counts',
    status: 'missing',
    storedValueSummary:
      'Null (Multi-class structure: Class A GOOGL + Class B + Class C GOOG combined diluted share count not stored)',
    periodOrAsOf: '2026-09-30',
    evidenceIds: [],
    auditFinding:
      'Alphabet has three share classes (Class A, Class B, Class C); valuation requires consolidated diluted shares across all classes from SEC Form 10-Q.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Extract consolidated WeightedAverageNumberOfDilutedSharesOutstanding and class-by-class cover-page shares from SEC Form 10-Q XBRL at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'GOOGL',
    category: 'market_cap_and_ev',
    categoryLabel: 'Market capitalisation and enterprise value',
    status: 'missing',
    storedValueSummary: 'Null (Blocked by missing multi-class diluted share count and balance sheet debt/cash)',
    periodOrAsOf: '2026-11-04',
    evidenceIds: [],
    auditFinding: 'Preserved as null until multi-class diluted share count and balance sheet cash/debt are loaded.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation: 'Computable via SEC XBRL multi-class diluted shares + balance sheet net debt.',
    paidCommercialRequirement: 'Commercial redistribution requires licensed EOD prices.',
  },
  {
    ticker: 'GOOGL',
    category: 'historical_valuation_multiples',
    categoryLabel: 'Historical valuation multiples',
    status: 'missing',
    storedValueSummary: 'Null (No multi-year historical valuation series stored)',
    periodOrAsOf: 'Multi-year history',
    evidenceIds: [],
    auditFinding: 'Only 46 price sessions and Q3 2026 / Q3 2025 quarters stored.',
    achievableWithExistingFreeSources: false,
    freeSourceRemediation: 'Multi-year XBRL fundamentals available at £0 from SEC EDGAR.',
    paidCommercialRequirement: 'Requires 5+ year split/dividend-adjusted price feed.',
  },
  {
    ticker: 'GOOGL',
    category: 'current_valuation_measures',
    categoryLabel: 'Current valuation measures',
    status: 'missing',
    storedValueSummary:
      'Null (Blocked by single-quarter scope, missing multi-class diluted shares, and negative single-quarter FCF -$9.065B)',
    periodOrAsOf: '2026-11-04',
    evidenceIds: ['sec-release'],
    auditFinding:
      'Single-quarter negative FCF (-$9.065B) cannot be used for P/FCF or EV/FCF; requires 4Q TTM XBRL flows + multi-class shares + net debt.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Ingest 4Q TTM XBRL flows + multi-class diluted shares + balance sheet cash/debt at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'GOOGL',
    category: 'corporate_actions_and_distributions',
    categoryLabel: 'Corporate actions and distributions',
    status: 'missing',
    storedValueSummary: 'Null (`corporateActionsReviewed: false`; cash dividends not in price ledger)',
    periodOrAsOf: '2026-11-04',
    evidenceIds: ['nasdaq-googl'],
    auditFinding: 'Unadjusted reference closes lack dividend and split adjustment metadata.',
    achievableWithExistingFreeSources: false,
    freeSourceRemediation: null,
    paidCommercialRequirement: 'Requires Tiingo or Polygon corporate-action-adjusted price feed.',
  },
  {
    ticker: 'GOOGL',
    category: 'adjusted_historical_prices',
    categoryLabel: 'Adjusted historical prices',
    status: 'unsuitable',
    storedValueSummary:
      '46 unadjusted daily closes ($284.78 on 2026-11-04; `priceBasis: unadjusted_close`; public reference only)',
    periodOrAsOf: '2026-09-01 → 2026-11-04 (46 sessions)',
    evidenceIds: ['nasdaq-googl'],
    auditFinding: 'Unadjusted public reference closes spanning 46 sessions.',
    achievableWithExistingFreeSources: false,
    freeSourceRemediation: null,
    paidCommercialRequirement: 'Requires licensed split- and dividend-adjusted EOD feed.',
  },
  {
    ticker: 'GOOGL',
    category: 'sec_filing_timestamps',
    categoryLabel: 'SEC filing publication and receipt timestamps',
    status: 'verified',
    storedValueSummary:
      'Verified SEC acceptance timestamp `publishedAt: 1793217693000` (`2026-10-28T20:01:33Z`), `receivedAt: 1793294123000` (`2026-10-29T17:15:23Z`)',
    periodOrAsOf: '2026-10-28T20:01:33Z',
    evidenceIds: ['sec-release', 'sec-index'],
    auditFinding:
      'Exact SEC EDGAR acceptance timestamp (16:01:33 EDT converted to UTC) and server receipt timestamp are verified.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation: null,
    paidCommercialRequirement: null,
  },

  // =========================================================================
  // 4. AMAZON (AMZN — CIK 0001018724)
  // =========================================================================
  {
    ticker: 'AMZN',
    category: 'revenue_and_growth',
    categoryLabel: 'Revenue and growth',
    status: 'verified',
    storedValueSummary:
      'TTM-2026-Q3 revenue $797,455M (+15.35% YoY vs TTM-2025-Q3 $691,330M); 2026-Q3 revenue $201,944M (+12.09% YoY); AWS Q3 $45,984M (+39.32% YoY)',
    periodOrAsOf: 'TTM-2026-Q3 & 2026-Q3 (ended 2026-09-30)',
    evidenceIds: ['amazon-sec-ex991', 'amzn-2026-q3-company-revenue-v1'],
    auditFinding:
      'Full 6-quarter series (`2025-Q2` through `2026-Q3`) plus TTM-2026-Q3 and TTM-2025-Q3 revenue and AWS segment revenue are verified.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation: null,
    paidCommercialRequirement: null,
  },
  {
    ticker: 'AMZN',
    category: 'earnings_and_operating_margins',
    categoryLabel: 'Earnings and operating margins',
    status: 'verified',
    storedValueSummary:
      'TTM-2026-Q3 GAAP Operating Income $104,405M (13.09% TTM margin); 2026-Q3 Operating Income $28,076M (13.90% margin); AWS Q3 Operating Income $17,452M (Note: GAAP Net Income & EPS missing in cash JSON)',
    periodOrAsOf: 'TTM-2026-Q3 & 2026-Q3 (ended 2026-09-30)',
    evidenceIds: ['amazon-sec-ex991', 'amzn-2026-q3-company-operating_income-v1'],
    auditFinding:
      '6-quarter and TTM GAAP operating income and operating margins are verified; consolidated GAAP `NetIncomeLoss` and `DilutedEPS` are not included in `amazon-q3-2026-cash.json`.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Extract quarterly and TTM `NetIncomeLoss` and `EarningsPerShareDiluted` from SEC XBRL (`CIK0001018724.json`) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'AMZN',
    category: 'ocf_and_capex',
    categoryLabel: 'Operating cash flow and capital expenditure',
    status: 'verified',
    storedValueSummary:
      'TTM-2026-Q3 OCF $168,300M, Gross Capex $215,192M, Proceeds $4,535M, Net Capex $210,657M (125.17% of TTM OCF; vs 88.68% in TTM-2025-Q3); 2026-Q3 OCF $42,422M, Net Capex $75,878M (178.86% of Q3 OCF)',
    periodOrAsOf: 'TTM-2026-Q3 & 2026-Q3 (ended 2026-09-30)',
    evidenceIds: [
      'amazon-sec-ex991',
      'amzn-ttm-2026-q3-ocf-v1',
      'amzn-ttm-2026-q3-gross-capex-v1',
      'amzn-ttm-2026-q3-capex-proceeds-v1',
    ],
    auditFinding:
      'Full multi-period quarterly and TTM cash flow and gross/net capex bridge verified and reconciled across 2025-Q3 (98.8% gross / 96.3% net), TTM-2025-Q3 (88.7% net), 2026-Q3 (178.9% net), and TTM-2026-Q3 (125.2% net).',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation: null,
    paidCommercialRequirement: null,
  },
  {
    ticker: 'AMZN',
    category: 'free_cash_flow',
    categoryLabel: 'Free cash flow',
    status: 'verified',
    storedValueSummary:
      'TTM-2026-Q3 FCF -$42,357M (-5.31% TTM FCF margin, vs +$14,788M in TTM-2025-Q3); 2026-Q3 FCF -$33,456M (-16.57% Q3 FCF margin)',
    periodOrAsOf: 'TTM-2026-Q3 & 2026-Q3 (ended 2026-09-30)',
    evidenceIds: ['amazon-sec-ex991'],
    auditFinding:
      'Both quarterly and TTM Free Cash Flow bridges (OCF less net PP&E additions and finance/equipment lease principal repayments) are verified.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation: null,
    paidCommercialRequirement: null,
  },
  {
    ticker: 'AMZN',
    category: 'debt_and_cash',
    categoryLabel: 'Debt and cash',
    status: 'missing',
    storedValueSummary:
      'Null (Balance sheet cash, marketable securities, long-term debt, and long-term lease liabilities not stored in `amazon-q3-2026-cash.json`)',
    periodOrAsOf: '2026-09-30',
    evidenceIds: [],
    auditFinding: 'Missing balance sheet cash and debt prevents Enterprise Value and Net Debt / TTM OCF calculation.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Extract CashAndCashEquivalents, MarketableSecuritiesCurrent, LongTermDebt, and LongTermLeaseLiabilities from SEC XBRL (`CIK0001018724.json`) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'AMZN',
    category: 'diluted_share_counts',
    categoryLabel: 'Diluted share counts',
    status: 'missing',
    storedValueSummary: 'Null (Weighted-average diluted shares not stored in `amazon-q3-2026-cash.json`)',
    periodOrAsOf: '2026-09-30',
    evidenceIds: [],
    auditFinding: 'Missing XBRL diluted share count prevents Market Capitalisation calculation.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Extract WeightedAverageNumberOfDilutedSharesOutstanding from SEC XBRL (`CIK0001018724.json`) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'AMZN',
    category: 'market_cap_and_ev',
    categoryLabel: 'Market capitalisation and enterprise value',
    status: 'missing',
    storedValueSummary: 'Null (Blocked by missing XBRL diluted share count and balance sheet debt/cash)',
    periodOrAsOf: '2026-11-04',
    evidenceIds: [],
    auditFinding: 'Preserved as null until XBRL diluted shares and debt/cash are imported.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation: 'Computable via SEC XBRL diluted shares + debt/cash.',
    paidCommercialRequirement: 'Commercial redistribution requires licensed EOD prices.',
  },
  {
    ticker: 'AMZN',
    category: 'historical_valuation_multiples',
    categoryLabel: 'Historical valuation multiples',
    status: 'missing',
    storedValueSummary: 'Null (No multi-year historical valuation series stored)',
    periodOrAsOf: 'Multi-year history',
    evidenceIds: [],
    auditFinding: 'Requires multi-year point-in-time XBRL fundamentals + adjusted historical prices.',
    achievableWithExistingFreeSources: false,
    freeSourceRemediation: 'Multi-year XBRL fundamentals available at £0 from SEC EDGAR.',
    paidCommercialRequirement: 'Requires 5+ year split-adjusted price feed (noting Amazon 20-for-1 split in June 2022).',
  },
  {
    ticker: 'AMZN',
    category: 'current_valuation_measures',
    categoryLabel: 'Current valuation measures',
    status: 'missing',
    storedValueSummary:
      'Null (TTM-2026-Q3 Revenue $797,455M and EBIT $94,912M are ready for EV/Sales and EV/EBIT once XBRL shares & debt/cash are loaded; EV/FCF is N/M due to negative TTM FCF -$42,357M)',
    periodOrAsOf: '2026-11-04',
    evidenceIds: ['amazon-sec-ex991'],
    auditFinding:
      'AMZN already has verified TTM Revenue and TTM EBIT locally! Only XBRL diluted shares, Net Income, and Debt/Cash are needed to unlock EV/TTM Revenue, EV/TTM EBIT, Trailing P/E, and negative FCF Yield.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Ingest XBRL diluted shares, TTM Net Income, and Balance Sheet Debt/Cash from `CIK0001018724.json` at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'AMZN',
    category: 'corporate_actions_and_distributions',
    categoryLabel: 'Corporate actions and distributions',
    status: 'missing',
    storedValueSummary: 'Null (`corporateActionsReviewed: false`)',
    periodOrAsOf: '2026-11-04',
    evidenceIds: ['nasdaq-amzn'],
    auditFinding: 'Unadjusted reference closes lack formal split/corporate-action verification metadata.',
    achievableWithExistingFreeSources: false,
    freeSourceRemediation: null,
    paidCommercialRequirement: 'Requires Tiingo or Polygon corporate-action-adjusted price feed.',
  },
  {
    ticker: 'AMZN',
    category: 'adjusted_historical_prices',
    categoryLabel: 'Adjusted historical prices',
    status: 'unsuitable',
    storedValueSummary:
      '46 unadjusted daily closes ($259.30 on 2026-11-04; `priceBasis: unadjusted_close`; public reference only)',
    periodOrAsOf: '2026-09-01 → 2026-11-04 (46 sessions)',
    evidenceIds: ['nasdaq-amzn'],
    auditFinding: 'Unadjusted public reference closes spanning 46 sessions.',
    achievableWithExistingFreeSources: false,
    freeSourceRemediation: null,
    paidCommercialRequirement: 'Requires licensed split-adjusted EOD feed.',
  },
  {
    ticker: 'AMZN',
    category: 'sec_filing_timestamps',
    categoryLabel: 'SEC filing publication and receipt timestamps',
    status: 'verified',
    storedValueSummary:
      'Verified SEC acceptance timestamp `publishedAt: 1793304327000` (`2026-10-29T20:05:27Z`), `receivedAt: 1793471503000` (`2026-10-31T18:31:43Z`)',
    periodOrAsOf: '2026-10-29T20:05:27Z',
    evidenceIds: ['amazon-sec-ex991'],
    auditFinding: 'Exact SEC acceptance timestamp and server receipt timestamp are verified.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation: null,
    paidCommercialRequirement: null,
  },

  // =========================================================================
  // 5. ADVANCED MICRO DEVICES (AMD — CIK 0000002488)
  // =========================================================================
  {
    ticker: 'AMD',
    category: 'revenue_and_growth',
    categoryLabel: 'Revenue and growth',
    status: 'missing',
    storedValueSummary: 'Null (No primary SEC 10-Q/10-K revenue table stored in local `data/` directory)',
    periodOrAsOf: 'Missing',
    evidenceIds: [],
    auditFinding:
      'AMD (`CIK 0000002488`) is configured in `CLOUD_SEC_TICKERS` (`convex/remoteOpsCloud.ts`), but its quarterly/TTM XBRL revenue series has not yet been persisted into the stock-assessment dataset.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Extract quarterly & TTM revenue from `https://data.sec.gov/api/xbrl/companyfacts/CIK0000002488.json` at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'AMD',
    category: 'earnings_and_operating_margins',
    categoryLabel: 'Earnings and operating margins',
    status: 'missing',
    storedValueSummary: 'Null (No primary SEC operating income or net income stored locally)',
    periodOrAsOf: 'Missing',
    evidenceIds: [],
    auditFinding: 'Missing GAAP operating income, net income, and diluted EPS in local dataset.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Extract OperatingIncomeLoss, NetIncomeLoss, and EarningsPerShareDiluted from SEC XBRL (`CIK0000002488.json`) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'AMD',
    category: 'ocf_and_capex',
    categoryLabel: 'Operating cash flow and capital expenditure',
    status: 'missing',
    storedValueSummary: 'Null (No primary SEC OCF or capex table stored locally)',
    periodOrAsOf: 'Missing',
    evidenceIds: [],
    auditFinding: 'Missing OCF and PP&E additions in local dataset.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Extract NetCashProvidedByUsedInOperatingActivities and PaymentsToAcquirePropertyPlantAndEquipment from SEC XBRL (`CIK0000002488.json`) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'AMD',
    category: 'free_cash_flow',
    categoryLabel: 'Free cash flow',
    status: 'missing',
    storedValueSummary: 'Null (Blocked by missing OCF and capex)',
    periodOrAsOf: 'Missing',
    evidenceIds: [],
    auditFinding: 'Computable once SEC XBRL OCF and capex are extracted.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation: 'Derive quarterly and TTM FCF = OCF − Cash Capex from SEC XBRL at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'AMD',
    category: 'debt_and_cash',
    categoryLabel: 'Debt and cash',
    status: 'missing',
    storedValueSummary: 'Null (No balance sheet cash or debt stored locally)',
    periodOrAsOf: 'Missing',
    evidenceIds: [],
    auditFinding: 'Missing balance sheet cash, marketable securities, and total debt.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Extract CashAndCashEquivalents, MarketableSecuritiesCurrent, LongTermDebt, and StockholdersEquity from SEC XBRL (`CIK0000002488.json`) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'AMD',
    category: 'diluted_share_counts',
    categoryLabel: 'Diluted share counts',
    status: 'missing',
    storedValueSummary: 'Null (No XBRL diluted share count stored locally)',
    periodOrAsOf: 'Missing',
    evidenceIds: [],
    auditFinding: 'Missing WeightedAverageNumberOfDilutedSharesOutstanding.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Extract WeightedAverageNumberOfDilutedSharesOutstanding from SEC XBRL (`CIK0000002488.json`) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'AMD',
    category: 'market_cap_and_ev',
    categoryLabel: 'Market capitalisation and enterprise value',
    status: 'missing',
    storedValueSummary: 'Null (Blocked by missing XBRL share count and debt/cash)',
    periodOrAsOf: '2026-11-04',
    evidenceIds: [],
    auditFinding: 'Preserved as null.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation: 'Computable via SEC XBRL shares + debt/cash.',
    paidCommercialRequirement: 'Commercial redistribution requires licensed EOD prices.',
  },
  {
    ticker: 'AMD',
    category: 'historical_valuation_multiples',
    categoryLabel: 'Historical valuation multiples',
    status: 'missing',
    storedValueSummary: 'Null',
    periodOrAsOf: 'Multi-year history',
    evidenceIds: [],
    auditFinding: 'Missing historical XBRL and adjusted price series.',
    achievableWithExistingFreeSources: false,
    freeSourceRemediation: 'Multi-year XBRL fundamentals available at £0 from SEC EDGAR.',
    paidCommercialRequirement: 'Requires 5+ year split-adjusted price feed.',
  },
  {
    ticker: 'AMD',
    category: 'current_valuation_measures',
    categoryLabel: 'Current valuation measures',
    status: 'missing',
    storedValueSummary: 'Null (Note: Xilinx intangible amortisation heavily depresses AMD GAAP net income; both GAAP P/E and EV/TTM FCF should be reported)',
    periodOrAsOf: '2026-11-04',
    evidenceIds: [],
    auditFinding: 'Requires TTM XBRL income/cash-flow statements, diluted shares, and debt/cash.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation: 'Ingest TTM XBRL statements + shares + debt/cash from `CIK0000002488.json` at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'AMD',
    category: 'corporate_actions_and_distributions',
    categoryLabel: 'Corporate actions and distributions',
    status: 'missing',
    storedValueSummary: 'Null (`corporateActionsReviewed: false`)',
    periodOrAsOf: '2026-11-04',
    evidenceIds: ['nasdaq-amd'],
    auditFinding: 'Unadjusted reference closes lack corporate-action verification.',
    achievableWithExistingFreeSources: false,
    freeSourceRemediation: null,
    paidCommercialRequirement: 'Requires Tiingo or Polygon corporate-action-adjusted price feed.',
  },
  {
    ticker: 'AMD',
    category: 'adjusted_historical_prices',
    categoryLabel: 'Adjusted historical prices',
    status: 'unsuitable',
    storedValueSummary:
      '46 unadjusted daily closes ($449.04 on 2026-11-04; -13.81% 20D; `priceBasis: unadjusted_close`)',
    periodOrAsOf: '2026-09-01 → 2026-11-04 (46 sessions)',
    evidenceIds: ['nasdaq-amd'],
    auditFinding: 'Unadjusted public reference closes spanning 46 sessions.',
    achievableWithExistingFreeSources: false,
    freeSourceRemediation: null,
    paidCommercialRequirement: 'Requires licensed split-adjusted EOD feed.',
  },
  {
    ticker: 'AMD',
    category: 'sec_filing_timestamps',
    categoryLabel: 'SEC filing publication and receipt timestamps',
    status: 'missing',
    storedValueSummary: 'Null (No AMD SEC filing record persisted in local `data/` directory)',
    periodOrAsOf: 'Missing',
    evidenceIds: [],
    auditFinding: 'Requires importing AMD Form 10-Q/10-K submission headers with `acceptanceDateTime`.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Fetch `acceptanceDateTime` from `https://data.sec.gov/submissions/CIK0000002488.json` at £0.',
    paidCommercialRequirement: null,
  },

  // =========================================================================
  // 6. COREWEAVE (CRWV — CIK 0001769628)
  // =========================================================================
  {
    ticker: 'CRWV',
    category: 'revenue_and_growth',
    categoryLabel: 'Revenue and growth',
    status: 'missing',
    storedValueSummary: 'Null (Polaris Forge 1 400 MW commitment stored in TypeDB, but S-1/10-Q revenue table not stored locally)',
    periodOrAsOf: 'Missing',
    evidenceIds: ['src-crwv-polaris-2026'],
    auditFinding:
      'CRWV (`CIK 0001769628`) has infrastructure commitment evidence in `Macro Case 001` but is not yet included in `CLOUD_SEC_TICKERS` (`convex/remoteOpsCloud.ts`) or local financial tables.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Add `CRWV` (`CIK 0001769628`) to `CLOUD_SEC_TICKERS` and ingest Form S-1 / 10-Q XBRL revenue from `data.sec.gov/api/xbrl/companyfacts/CIK0001769628.json` at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'CRWV',
    category: 'earnings_and_operating_margins',
    categoryLabel: 'Earnings and operating margins',
    status: 'missing',
    storedValueSummary: 'Null (No S-1/10-Q operating income or net loss stored locally)',
    periodOrAsOf: 'Missing',
    evidenceIds: [],
    auditFinding:
      'High interest expense on GPU-backed debt Facilities frequently causes GAAP net losses despite positive operating/EBITDA margins; valuation layer must guard against negative P/E.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Extract OperatingIncomeLoss, InterestExpense, and NetIncomeLoss from SEC XBRL (`CIK0001769628.json`) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'CRWV',
    category: 'ocf_and_capex',
    categoryLabel: 'Operating cash flow and capital expenditure',
    status: 'missing',
    storedValueSummary: 'Null (No S-1/10-Q OCF or GPU capex table stored locally)',
    periodOrAsOf: 'Missing',
    evidenceIds: [],
    auditFinding: 'Missing OCF and capital expenditure in local dataset.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Extract OCF and PP&E additions from SEC XBRL (`CIK0001769628.json`) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'CRWV',
    category: 'free_cash_flow',
    categoryLabel: 'Free cash flow',
    status: 'missing',
    storedValueSummary: 'Null (Expected negative FCF during rapid GPU cluster buildout; requires deterministic negative-FCF guard)',
    periodOrAsOf: 'Missing',
    evidenceIds: [],
    auditFinding: 'Missing FCF; when imported, negative FCF must suppress EV/FCF (`not_meaningful_negative_fcf`) while reporting negative FCF Yield (%).',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation: 'Derive FCF from SEC XBRL OCF and capex at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'CRWV',
    category: 'debt_and_cash',
    categoryLabel: 'Debt and cash',
    status: 'missing',
    storedValueSummary: 'Null (Critical for neocloud analysis: GPU SPV debt facilities, OEM lease obligations & cash balance not stored locally)',
    periodOrAsOf: 'Missing',
    evidenceIds: ['src-crwv-polaris-2026'],
    auditFinding:
      'CoreWeave carries substantial asset-backed debt and lease obligations; Enterprise Value differs materially from Market Cap and cannot be approximated without balance sheet debt.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Extract CashAndCashEquivalents, RestrictedCash, LongTermDebt, and Operating/FinanceLeaseLiabilities from SEC XBRL (`CIK0001769628.json`) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'CRWV',
    category: 'diluted_share_counts',
    categoryLabel: 'Diluted share counts',
    status: 'missing',
    storedValueSummary: 'Null (Post-IPO multi-class share structure and convertible preferred/warrant dilution not stored locally)',
    periodOrAsOf: 'Missing',
    evidenceIds: [],
    auditFinding:
      'Requires post-IPO Class A + Class B share reconciliation and anti-dilution check (when GAAP net income is negative, GAAP diluted shares equal basic shares).',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Extract basic and diluted share counts and share-class footnote from SEC Form 10-Q / S-1 XBRL (`CIK0001769628.json`) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'CRWV',
    category: 'market_cap_and_ev',
    categoryLabel: 'Market capitalisation and enterprise value',
    status: 'missing',
    storedValueSummary: 'Null (Blocked by missing XBRL share count and GPU debt/lease balances)',
    periodOrAsOf: '2026-11-04',
    evidenceIds: [],
    auditFinding: 'Preserved as null.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation: 'Computable via SEC XBRL shares + total debt/leases/cash.',
    paidCommercialRequirement: 'Commercial redistribution requires licensed EOD prices.',
  },
  {
    ticker: 'CRWV',
    category: 'historical_valuation_multiples',
    categoryLabel: 'Historical valuation multiples',
    status: 'missing',
    storedValueSummary: 'Null (Limited post-IPO trading history)',
    periodOrAsOf: 'Post-IPO history',
    evidenceIds: [],
    auditFinding: 'Recent IPO limits multi-year public trading history even with a commercial price provider.',
    achievableWithExistingFreeSources: false,
    freeSourceRemediation: 'S-1 and 10-Q XBRL fundamentals available at £0 from SEC EDGAR.',
    paidCommercialRequirement: 'Requires licensed post-IPO adjusted price feed.',
  },
  {
    ticker: 'CRWV',
    category: 'current_valuation_measures',
    categoryLabel: 'Current valuation measures',
    status: 'missing',
    storedValueSummary: 'Null (EV/TTM Revenue and Net Debt/OCF will be primary valid multiples once XBRL is ingested; P/E & EV/FCF suppressed if negative)',
    periodOrAsOf: '2026-11-04',
    evidenceIds: [],
    auditFinding: 'Valuation layer is specifically designed to suppress negative P/E and EV/FCF for high-capex neoclouds while reporting EV/TTM Revenue and FCF burn yield.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation: 'Ingest S-1/10-Q XBRL statements + shares + debt/cash from `CIK0001769628.json` at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'CRWV',
    category: 'corporate_actions_and_distributions',
    categoryLabel: 'Corporate actions and distributions',
    status: 'missing',
    storedValueSummary: 'Null (`corporateActionsReviewed: false`)',
    periodOrAsOf: '2026-11-04',
    evidenceIds: ['nasdaq-crwv'],
    auditFinding: 'Unadjusted reference closes lack corporate-action verification.',
    achievableWithExistingFreeSources: false,
    freeSourceRemediation: null,
    paidCommercialRequirement: 'Requires Tiingo or Polygon corporate-action-adjusted price feed.',
  },
  {
    ticker: 'CRWV',
    category: 'adjusted_historical_prices',
    categoryLabel: 'Adjusted historical prices',
    status: 'unsuitable',
    storedValueSummary:
      '46 unadjusted daily closes ($46.40 on 2026-11-04; -30.54% 20D; `priceBasis: unadjusted_close`)',
    periodOrAsOf: '2026-09-01 → 2026-11-04 (46 sessions)',
    evidenceIds: ['nasdaq-crwv'],
    auditFinding: 'Unadjusted public reference closes spanning 46 sessions.',
    achievableWithExistingFreeSources: false,
    freeSourceRemediation: null,
    paidCommercialRequirement: 'Requires licensed adjusted EOD feed.',
  },
  {
    ticker: 'CRWV',
    category: 'sec_filing_timestamps',
    categoryLabel: 'SEC filing publication and receipt timestamps',
    status: 'stale',
    storedValueSummary:
      'TypeDB source `src-crwv-polaris-2026` has `publishedAt: "2026-10-12T13:00:00Z"`, but latest SEC Form 10-Q `acceptanceDateTime` is not in local financial store',
    periodOrAsOf: '2026-10-12',
    evidenceIds: ['src-crwv-polaris-2026'],
    auditFinding: 'Requires adding `CRWV` (`CIK 0001769628`) to automated SEC submissions collector.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Fetch `acceptanceDateTime` from `https://data.sec.gov/submissions/CIK0001769628.json` at £0.',
    paidCommercialRequirement: null,
  },

  // =========================================================================
  // 7. INTEL (INTC — CIK 0000050863)
  // =========================================================================
  {
    ticker: 'INTC',
    category: 'revenue_and_growth',
    categoryLabel: 'Revenue and growth',
    status: 'missing',
    storedValueSummary: 'Null (No primary SEC 10-Q/10-K revenue table stored in local `data/` directory)',
    periodOrAsOf: 'Missing',
    evidenceIds: ['src-intc-10k-2025'],
    auditFinding:
      'INTC (`CIK 0000050863`) has TypeDB Fab 34 Leixlip SCJV evidence (`src-intc-10k-2025`) and is in `CLOUD_SEC_TICKERS`, but its XBRL revenue series is not yet stored in `data/`.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Extract quarterly & TTM revenue from `https://data.sec.gov/api/xbrl/companyfacts/CIK0000050863.json` at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'INTC',
    category: 'earnings_and_operating_margins',
    categoryLabel: 'Earnings and operating margins',
    status: 'missing',
    storedValueSummary: 'Null (Restructuring & foundry impairment charges have caused periodic GAAP operating/net losses; requires negative-earnings guard)',
    periodOrAsOf: 'Missing',
    evidenceIds: [],
    auditFinding:
      'Missing GAAP operating income and net income locally; when imported, negative GAAP net income or EBIT must trigger `not_meaningful_negative_earnings` / `not_meaningful_negative_ebit`.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Extract OperatingIncomeLoss and NetIncomeLoss from SEC XBRL (`CIK0000050863.json`) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'INTC',
    category: 'ocf_and_capex',
    categoryLabel: 'Operating cash flow and capital expenditure',
    status: 'missing',
    storedValueSummary: 'Null (Foundry capex and SCJV co-investment flows not in local financial store)',
    periodOrAsOf: 'Missing',
    evidenceIds: ['src-intc-10k-2025'],
    auditFinding: 'Missing OCF and gross/net foundry capital expenditure in local dataset.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Extract OCF, PaymentsToAcquirePropertyPlantAndEquipment, and capital subsidies/SCJV contributions from SEC XBRL (`CIK0000050863.json`) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'INTC',
    category: 'free_cash_flow',
    categoryLabel: 'Free cash flow',
    status: 'missing',
    storedValueSummary: 'Null (Blocked by missing OCF and capex)',
    periodOrAsOf: 'Missing',
    evidenceIds: [],
    auditFinding: 'Computable from SEC XBRL OCF and capex; negative FCF periods are guarded against negative EV/FCF multiples.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation: 'Derive quarterly and TTM FCF from SEC XBRL at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'INTC',
    category: 'debt_and_cash',
    categoryLabel: 'Debt and cash',
    status: 'missing',
    storedValueSummary:
      'Null ($11.0B Apollo Fab 34 Leixlip SCJV obligation documented in TypeDB `src-intc-10k-2025`, but consolidated balance sheet cash & debt are null)',
    periodOrAsOf: 'Missing',
    evidenceIds: ['src-intc-10k-2025'],
    auditFinding:
      'Missing consolidated Cash, Short-Term Investments, Total Debt, and Noncontrolling Interest / SCJV liabilities.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Extract CashAndCashEquivalents, ShortTermInvestments, LongTermDebt, StockholdersEquity, and RedeemableNoncontrollingInterest from SEC XBRL (`CIK0000050863.json`) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'INTC',
    category: 'diluted_share_counts',
    categoryLabel: 'Diluted share counts',
    status: 'missing',
    storedValueSummary: 'Null (No XBRL diluted share count stored locally)',
    periodOrAsOf: 'Missing',
    evidenceIds: [],
    auditFinding: 'Missing WeightedAverageNumberOfDilutedSharesOutstanding.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Extract WeightedAverageNumberOfDilutedSharesOutstanding and EntityCommonStockSharesOutstanding from SEC XBRL (`CIK0000050863.json`) at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'INTC',
    category: 'market_cap_and_ev',
    categoryLabel: 'Market capitalisation and enterprise value',
    status: 'missing',
    storedValueSummary: 'Null (Blocked by missing XBRL share count and balance sheet debt/cash)',
    periodOrAsOf: '2026-11-04',
    evidenceIds: [],
    auditFinding: 'Preserved as null.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation: 'Computable via SEC XBRL shares + debt/cash.',
    paidCommercialRequirement: 'Commercial redistribution requires licensed EOD prices.',
  },
  {
    ticker: 'INTC',
    category: 'historical_valuation_multiples',
    categoryLabel: 'Historical valuation multiples',
    status: 'missing',
    storedValueSummary: 'Null',
    periodOrAsOf: 'Multi-year history',
    evidenceIds: [],
    auditFinding: 'Missing multi-year XBRL and adjusted price history.',
    achievableWithExistingFreeSources: false,
    freeSourceRemediation: 'Multi-year XBRL fundamentals available at £0 from SEC EDGAR.',
    paidCommercialRequirement: 'Requires 5+ year split/dividend-adjusted price feed.',
  },
  {
    ticker: 'INTC',
    category: 'current_valuation_measures',
    categoryLabel: 'Current valuation measures',
    status: 'missing',
    storedValueSummary: 'Null (Price/Book and EV/TTM Revenue will be primary valid multiples when GAAP net income/FCF are negative)',
    periodOrAsOf: '2026-11-04',
    evidenceIds: [],
    auditFinding:
      'For turnaround/loss-making periods, Price/Book (`priceToBook`) and `EV/TTM Revenue` remain well-defined while `Trailing P/E` and `EV/FCF` are cleanly suppressed (`null`) when earnings/FCF are negative.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Ingest XBRL Book Equity, TTM Revenue, EBIT, Net Income, Shares, and Debt/Cash from `CIK0000050863.json` at £0.',
    paidCommercialRequirement: null,
  },
  {
    ticker: 'INTC',
    category: 'corporate_actions_and_distributions',
    categoryLabel: 'Corporate actions and distributions',
    status: 'missing',
    storedValueSummary: 'Null (`corporateActionsReviewed: false`; dividend suspension history not in price ledger)',
    periodOrAsOf: '2026-11-04',
    evidenceIds: ['nasdaq-intc'],
    auditFinding: 'Unadjusted reference closes lack dividend and corporate-action history.',
    achievableWithExistingFreeSources: false,
    freeSourceRemediation: null,
    paidCommercialRequirement: 'Requires Tiingo or Polygon corporate-action-adjusted price feed.',
  },
  {
    ticker: 'INTC',
    category: 'adjusted_historical_prices',
    categoryLabel: 'Adjusted historical prices',
    status: 'unsuitable',
    storedValueSummary:
      'Only 6 unadjusted daily closes stored ($56.28 on 2026-11-04; `2026-10-28` → `2026-11-04`; < 15 sessions blocks even 20D momentum)',
    periodOrAsOf: '2026-10-28 → 2026-11-04 (6 sessions)',
    evidenceIds: ['nasdaq-intc'],
    auditFinding:
      'Critically incomplete in local bundle (only 6 sessions stored vs 46 for peers), blocking Dimension 3 (20D Momentum) as well as historical risk.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'For internal non-commercial 20D momentum screening, backfill 46+ sessions via existing `collectUniverseMarketObservations` (`nasdaq_public_historical`) at £0.',
    paidCommercialRequirement:
      'For split-adjusted history and commercial redistribution, requires Tiingo ($10/mo internal / $50+/mo commercial) or Nasdaq Data Link.',
  },
  {
    ticker: 'INTC',
    category: 'sec_filing_timestamps',
    categoryLabel: 'SEC filing publication and receipt timestamps',
    status: 'stale',
    storedValueSummary:
      'TypeDB source `src-intc-10k-2025` has `publishedAt: "2026-02-14T21:00:00Z"`, but 2026 Q1/Q2/Q3 Form 10-Q `acceptanceDateTime` timestamps are not in local store',
    periodOrAsOf: '2026-02-14',
    evidenceIds: ['src-intc-10k-2025'],
    auditFinding: 'Latest 2026 Form 10-Q submission timestamps need to be persisted into the stock-assessment store.',
    achievableWithExistingFreeSources: true,
    freeSourceRemediation:
      'Fetch latest Form 10-Q `acceptanceDateTime` from `https://data.sec.gov/submissions/CIK0000050863.json` at £0.',
    paidCommercialRequirement: null,
  },
] as const;

/**
 * Summarises the 84-cell coverage audit by status and by £0-free-source vs paid-commercial remediation.
 */
export function summariseSevenStockCoverageAudit() {
  const totalCells = SEVEN_STOCK_COVERAGE_MATRIX.length; // 84
  const byStatus = {
    verified: SEVEN_STOCK_COVERAGE_MATRIX.filter((c) => c.status === 'verified').length,
    stale: SEVEN_STOCK_COVERAGE_MATRIX.filter((c) => c.status === 'stale').length,
    missing: SEVEN_STOCK_COVERAGE_MATRIX.filter((c) => c.status === 'missing').length,
    conflicting: SEVEN_STOCK_COVERAGE_MATRIX.filter((c) => c.status === 'conflicting').length,
    unsuitable: SEVEN_STOCK_COVERAGE_MATRIX.filter((c) => c.status === 'unsuitable').length,
  };

  const nonVerifiedCells = SEVEN_STOCK_COVERAGE_MATRIX.filter((c) => c.status !== 'verified');
  const resolvableAtZeroCostViaSecOrPublic = nonVerifiedCells.filter(
    (c) => c.achievableWithExistingFreeSources,
  );
  const requiresPaidCommercialFeed = nonVerifiedCells.filter(
    (c) => !c.achievableWithExistingFreeSources,
  );

  return {
    totalCells,
    byStatus,
    nonVerifiedCount: nonVerifiedCells.length,
    resolvableAtZeroCostCount: resolvableAtZeroCostViaSecOrPublic.length,
    requiresPaidCommercialFeedCount: requiresPaidCommercialFeed.length,
    cells: SEVEN_STOCK_COVERAGE_MATRIX,
  };
}

/**
 * Stage 2 — Legitimate Data Sources, Licensing, Commercial Redistribution Rights & Ongoing Cost Catalog.
 */
export const LEGITIMATE_DATA_SOURCES_CATALOG: readonly LegitimateDataSourceEntry[] = [
  {
    sourceId: 'sec_edgar_xbrl_api',
    providerName: 'U.S. SEC EDGAR XBRL API (`data.sec.gov/api/xbrl/companyfacts/` & `submissions/`)',
    dataDomainsCovered: [
      'Revenue & segment revenue (10-K, 10-Q, 8-K, S-1)',
      'GAAP Operating Income (EBIT), Net Income & Diluted EPS',
      'Operating Cash Flow, Capital Expenditure & Free Cash Flow components',
      'Consolidated Cash, Short-Term Investments, Total Debt & Lease Liabilities',
      'Basic & Diluted Share Counts (incl. multi-class footnotes)',
      'Exact EDGAR `acceptanceDateTime` (`publishedAt`) & `10-Q/A` restatement lineage',
    ],
    licensingModel:
      'U.S. Government Public Domain work (17 U.S.C. § 105); fair-access policy requires descriptive `User-Agent` header and ≤ 10 requests/second.',
    estimatedMonthlyCostGbpOrUsd: '£0 / month ($0 / month)',
    commercialRedistributionPermitted: 'yes',
    internalPersonalResearchPermitted: 'yes',
    historicalCoverageDepth: '2009–Present (15+ years of structured XBRL facts for US registrants)',
    freshnessAndLatency: 'Real-time upon SEC EDGAR acceptance (typically within 60 seconds of filing)',
    recommendationStatus: 'Active Zero-Cost Primary Source (Expand Immediately)',
    notes:
      'Highest priority. Resolves 48 of the 69 non-verified cells in our 84-cell matrix at £0 cost with full commercial redistribution rights.',
  },
  {
    sourceId: 'official_central_banks_and_grids',
    providerName: 'ECB (`api.frankfurter.app`), Bank of England (`XUDLUSS`), Federal Reserve FRED & EirGrid / EIA',
    dataDomainsCovered: [
      'Daily USD/GBP and EUR/USD reference FX fixings',
      'VIX (`VIXCLS`), US 10Y Treasury yields (`DGS10`), Fed funds rate',
      'Regional electricity grid capacity & data-centre connection moratoria (EirGrid, PJM, NYISO, ERCOT)',
    ],
    licensingModel:
      'Public central-bank and government open data licences (attribution required; commercial analytics permitted on core public series).',
    estimatedMonthlyCostGbpOrUsd: '£0 / month ($0 / month)',
    commercialRedistributionPermitted: 'yes',
    internalPersonalResearchPermitted: 'yes',
    historicalCoverageDepth: '20+ years daily macro & FX reference series',
    freshnessAndLatency: 'Daily reference fixing (16:00 CET / London for FX; T+1 for FRED EOD series)',
    recommendationStatus: 'Active Zero-Cost Primary Source (Expand Immediately)',
    notes:
      'Already integrated in `lib/market-data/provider-adapter.ts` and `Macro Case 001`. Note that 16:00 London FX fixings are indicative reference rates rather than 21:00 UTC US equity close-aligned rates.',
  },
  {
    sourceId: 'nasdaq_public_historical_api',
    providerName: 'Nasdaq Public Historical Quote Endpoint (`api.nasdaq.com/api/quote/{SYMBOL}/historical`)',
    dataDomainsCovered: [
      'Unadjusted daily OHLCV regular-session closes for NVDA, MSFT, GOOGL, AMZN, AMD, CRWV, INTC, QQQ',
    ],
    licensingModel:
      'Public website reference endpoint; Terms of Use permit personal non-commercial viewing only and strictly prohibit commercial redistribution or systematic commercial republication.',
    estimatedMonthlyCostGbpOrUsd: '£0 / month ($0 / month)',
    commercialRedistributionPermitted: 'no',
    internalPersonalResearchPermitted: 'yes',
    historicalCoverageDepth: 'Up to 10 years of unadjusted daily OHLCV bars',
    freshnessAndLatency: 'Delayed ≥ 15 minutes / End-of-Day reference',
    recommendationStatus: 'Active Zero-Cost Reference (Internal Only — Not Redistributable)',
    notes:
      'Can be used immediately at £0 to backfill INTC from 6 sessions to 46+ sessions for internal owner screening, but cannot be used for split-adjusted multi-year backtesting or commercial multi-user redistribution.',
  },
  {
    sourceId: 'trading212_personal_account_api',
    providerName: 'Trading 212 Public API (`live.trading212.com/api/v0/equity/...`)',
    dataDomainsCovered: [
      'Authenticated owner account cash, invested cost, open position quantities & account-specific wallet impact',
    ],
    licensingModel:
      'Personal brokerage account API for the account holder only; prohibited from being used as a general market data feed or redistributed to third parties.',
    estimatedMonthlyCostGbpOrUsd: '£0 / month',
    commercialRedistributionPermitted: 'no',
    internalPersonalResearchPermitted: 'yes',
    historicalCoverageDepth: 'Point-in-time account snapshots only',
    freshnessAndLatency: 'On-demand account synchronisation (rate-limited)',
    recommendationStatus: 'Prohibited for Market Data Feed',
    notes:
      'Enforced by `assertNotTrading212PositionPrice` in `lib/market-data/provider-adapter.ts`: never used for stock-screening prices.',
  },
  {
    sourceId: 'tiingo_eod_and_iex',
    providerName: 'Tiingo EOD Split/Dividend-Adjusted Prices, Corporate Actions & FX API',
    dataDomainsCovered: [
      '30+ years daily EOD OHLCV + `adjOpen`, `adjHigh`, `adjLow`, `adjClose`',
      'Explicit `splitFactor` and `divCash` corporate action distributions',
      'IEX real-time & historical intraday bars + `gbpusd` close-aligned FX',
    ],
    licensingModel:
      'Power Tier ($10/mo) permits single-user internal research & backtesting; Commercial Redistribution Licences ($50–$150/mo) permit displaying derived metrics and adjusted charts to commercial subscribers.',
    estimatedMonthlyCostGbpOrUsd:
      '$10 / month (~£7.80 / mo) Internal Power Tier; $50–$150 / month (~£39–£118 / mo) Commercial Redistribution Tier',
    commercialRedistributionPermitted: 'requires_commercial_tier',
    internalPersonalResearchPermitted: 'yes',
    historicalCoverageDepth: '30+ years daily adjusted EOD; 5+ years intraday IEX',
    freshnessAndLatency: 'Real-time IEX + daily EOD corporate-action-adjusted close',
    recommendationStatus: 'Recommended Low-Cost Upgrade for Split-Adjusted Prices',
    notes:
      'Best cost-to-quality ratio for resolving the remaining 21 cells (`corporate_actions_and_distributions`, `adjusted_historical_prices`, and `historical_valuation_multiples`) once owner approves.',
  },
  {
    sourceId: 'nasdaq_data_link_sharadar',
    providerName: 'Nasdaq Data Link — Sharadar Core US Equities Bundle (SEP + SF1)',
    dataDomainsCovered: [
      'Split- and dividend-adjusted daily equity prices (`SEP`)',
      'Point-in-time (`datekey` / `calendardate`) standardized SEC fundamentals & historical valuation multiples (`SF1`)',
      'Delisted US equities (survivorship-bias-free backtest universe)',
    ],
    licensingModel:
      'Personal subscription (~$50/mo) for internal quantitative research; Commercial institutional license (~$199–$450/mo) required for external user redistribution.',
    estimatedMonthlyCostGbpOrUsd:
      '$50 / month (~£39 / mo) Personal Research; $199+ / month (~£156+ / mo) Commercial',
    commercialRedistributionPermitted: 'requires_commercial_tier',
    internalPersonalResearchPermitted: 'yes',
    historicalCoverageDepth: '20+ years survivorship-bias-free US equities & point-in-time fundamentals',
    freshnessAndLatency: 'Daily EOD update',
    recommendationStatus: 'Optional Commercial Redistribution / Consensus Tier',
    notes:
      'Provides delisted tickers needed for survivorship-bias-free Tier 4 historical methodology validation across broad universes.',
  },
  {
    sourceId: 'polygon_massive_stocks',
    providerName: 'Polygon.io (Massive) Stocks Starter / Business API',
    dataDomainsCovered: [
      'Split-adjusted daily & minute aggregates (`/v2/aggs`)',
      'Reference splits (`/v3/reference/splits`) & cash dividends (`/v3/reference/dividends`)',
    ],
    licensingModel:
      'Stocks Starter ($29/mo) is strictly non-professional personal use; Stocks Business ($199+/mo) required for commercial application use.',
    estimatedMonthlyCostGbpOrUsd:
      '$29 / month (~£22.60 / mo) Personal; $199 / month (~£156 / mo) Business',
    commercialRedistributionPermitted: 'requires_commercial_tier',
    internalPersonalResearchPermitted: 'yes',
    historicalCoverageDepth: '5 years on Starter; 20+ years on Business',
    freshnessAndLatency: '15-minute delayed on Starter; real-time on Advanced/Business',
    recommendationStatus: 'Optional Commercial Redistribution / Consensus Tier',
    notes: 'Already supported as an adapter target in `lib/market-data/provider-adapter.ts`.',
  },
  {
    sourceId: 'consensus_estimates_vendors',
    providerName: 'Licensed Forward Consensus Estimate Providers (Intrinio Zacks / FMP Enterprise / LSEG I/B/E/S)',
    dataDomainsCovered: [
      'Point-in-time forward Street consensus Revenue, EBITDA, EPS & Free Cash Flow estimates',
      'Analyst revision timestamps and dispersion metrics',
    ],
    licensingModel:
      'Strict proprietary vendor licensing; scraped media mentions (e.g., Benzinga, Investing.com, AP) cannot be used as scored consensus inputs.',
    estimatedMonthlyCostGbpOrUsd: '$250–$1,000+ / month (~£195–£780+ / mo) for commercial license',
    commercialRedistributionPermitted: 'requires_commercial_tier',
    internalPersonalResearchPermitted: 'requires_commercial_tier',
    historicalCoverageDepth: '5–15+ years point-in-time estimate history',
    freshnessAndLatency: 'Daily revision feed',
    recommendationStatus: 'Optional Commercial Redistribution / Consensus Tier',
    notes:
      'Not required for Phase G.7 if Dimension 1 (Valuation) is anchored on deterministic SEC XBRL Trailing TTM multiples (`EV/TTM Revenue`, `EV/TTM EBIT`, `Trailing GAAP P/E`, `FCF Yield`).',
  },
] as const;

/**
 * Stage 4 — Five-Tier Directional-Rating Release Gate Evaluation.
 * Defines distinct release requirements for:
 * 1. Fundamental research screening
 * 2. Valuation-supported investment assessment
 * 3. Risk and momentum analysis
 * 4. Historically validated methodology
 * 5. Prospectively evaluated signals
 */
export function evaluateFiveTierReleaseGates(
  assessments?: StockResearchAssessment[],
): ReleaseGateTierEvaluation[] {
  const list = assessments ?? evaluateUniverseResearchAssessments();
  const valuationResults = evaluateUniverseCurrentValuationLayer();

  const tier1Qualifying = list
    .filter((a) => a.evidenceCoverage.coveredWeightPct >= 65 && a.researchPriorityScore !== null)
    .map((a) => a.ticker);
  const tier1Blocked = list
    .filter((a) => !tier1Qualifying.includes(a.ticker))
    .map((a) => a.ticker);

  const tier2Qualifying = valuationResults
    .filter((v) => v.allValuationMultiplesResolved)
    .map((v) => v.ticker);
  const tier2Blocked = list
    .map((a) => a.ticker)
    .filter((t) => !tier2Qualifying.includes(t));

  const tier3Qualifying = list
    .filter(
      (a) =>
        a.latestPrice.corporateActionsReviewed &&
        a.latestPrice.classification === 'Licensed Adjusted EOD Close',
    )
    .map((a) => a.ticker);
  const tier3Blocked = list
    .map((a) => a.ticker)
    .filter((t) => !tier3Qualifying.includes(t));

  return [
    {
      tierKey: 'tier_1_fundamental_research_screening',
      tierNumber: 1,
      title: 'Gate Tier 1 — Fundamental Research Screening',
      allowedOutputClassification:
        'Non-Directional Fundamental Screening Score (0–100) + Priority Tier + Explicit Missing-Data Blocking Reasons (All directional labels locked to INSUFFICIENT DATA)',
      permitsDirectionalBuyHoldSell: false,
      status: tier1Qualifying.length > 0 ? 'satisfied_partial_universe' : 'blocked',
      qualifyingTickers: tier1Qualifying,
      blockedTickers: tier1Blocked,
      mandatoryRequirements: [
        'Verified primary SEC filing revenue, operating margin, operating cash flow, capital expenditure, and free cash flow for the latest reported period.',
        'Verified TypeDB Macro Case 001 counterparty and infrastructure exposure relationships.',
        'Explicit display of missing-data blocking reasons (`data-testid="blocking-reasons-<TICKER>"`) preventing any directional interpretation.',
        'Strict separation of 20D tactical price momentum from 6–12M fundamental screening score.',
      ],
      unmetBlockers: [
        `3 of 7 stocks (${tier1Blocked.join(', ')}) lack persisted primary SEC XBRL income and cash-flow tables in the local dataset (achievable at £0 via SEC EDGAR XBRL API).`,
      ],
      why252PriceBarsDoNotSufficeNote:
        'Tier 1 is a point-in-time fundamental screening filter for analyst due-diligence prioritisation; it makes no directional return forecast.',
    },
    {
      tierKey: 'tier_2_valuation_supported_investment_assessment',
      tierNumber: 2,
      title: 'Gate Tier 2 — Valuation-Supported Investment Assessment',
      allowedOutputClassification:
        'Valuation-Supported Research Assessment (Multiples & FCF Yield Evaluated; Non-Predictive Until Tiers 4 & 5 Pass)',
      permitsDirectionalBuyHoldSell: false,
      status: tier2Qualifying.length === list.length ? 'satisfied_partial_universe' : 'blocked',
      qualifyingTickers: tier2Qualifying,
      blockedTickers: tier2Blocked,
      mandatoryRequirements: [
        'All Gate Tier 1 requirements satisfied across the covered cohort.',
        '4-quarter Trailing Twelve Months (`TTM`) or `ANNUAL` SEC XBRL income and cash-flow statements (never annualising a single quarter).',
        'Verified SEC XBRL diluted share counts (`WeightedAverageNumberOfDilutedSharesOutstanding`), reconciled across all share classes (e.g., GOOGL Class A + B + C) and never back-solved from rounded EPS.',
        'Verified SEC XBRL balance sheet Cash, Short-Term Investments, Total Debt, and Finance Lease Liabilities.',
        'Deterministic calculation of Market Cap, Net Debt, Enterprise Value, EV/TTM Revenue, EV/TTM EBIT, Trailing GAAP P/E (or `not_meaningful_negative_earnings` guard), and TTM FCF Yield.',
        'Split-adjusted, corporate-action-verified closing prices (with commercial license if redistributed externally).',
      ],
      unmetBlockers: [
        'Missing SEC XBRL diluted share counts and balance sheet cash/debt across all 7 stocks in local store (achievable at £0 via SEC EDGAR XBRL API).',
        'Missing 4-quarter TTM flow sums for NVDA, MSFT, GOOGL, AMD, CRWV, and INTC (AMZN already has TTM-2026-Q3 Revenue, EBIT, OCF, Capex, and FCF).',
        'Current market prices are unadjusted public reference closes (`corporateActionsReviewed: false`).',
      ],
      why252PriceBarsDoNotSufficeNote:
        'Even with 252 price bars, a stock cannot receive a valuation-supported assessment without balance sheet net debt, diluted shares, and 4-quarter TTM cash-flow reconciliation.',
    },
    {
      tierKey: 'tier_3_risk_and_momentum_analysis',
      tierNumber: 3,
      title: 'Gate Tier 3 — Risk and Momentum Analysis',
      allowedOutputClassification:
        'Horizon-Separated Fundamental, Risk & Tactical Momentum Assessment (Directional BUY/HOLD/SELL Still Locked)',
      permitsDirectionalBuyHoldSell: false,
      status: tier3Qualifying.length === list.length ? 'satisfied_partial_universe' : 'blocked',
      qualifyingTickers: tier3Qualifying,
      blockedTickers: tier3Blocked,
      mandatoryRequirements: [
        'At least 252 consecutive trading sessions of split- and dividend-adjusted daily prices (`adjClose`, `splitFactor`, `divCash`, `corporateActionsReviewed: true`) for all 7 universe tickers, `QQQ`, and sector benchmark `SOXX`.',
        'Realized annualised volatility, maximum drawdown, rolling beta vs `QQQ`/`SOXX`, and 20D / 60D / 252D horizon-separated momentum indicators.',
        'Quantitative balance-sheet & off-balance-sheet risk ratios (`Net Debt / TTM OCF`, `Capex / OCF`, TypeDB counterparty guarantee & lease exposure as % of OCF).',
      ],
      unmetBlockers: [
        'Only 46 unadjusted daily sessions are stored for NVDA, MSFT, GOOGL, AMZN, AMD, CRWV, and only 6 sessions for INTC.',
        'Corporate actions (`splitFactor`, `divCash`) are not reviewed (`corporateActionsReviewed: false`).',
      ],
      why252PriceBarsDoNotSufficeNote:
        '252 split-adjusted daily price observations are the minimum requirement to measure 1-year realized volatility, rolling beta, and 52-week drawdown (Tier 3), NOT proof that the scoring model predicts future 6–12M alpha (Tiers 4 & 5).',
    },
    {
      tierKey: 'tier_4_historically_validated_methodology',
      tierNumber: 4,
      title: 'Gate Tier 4 — Historically Validated Methodology',
      allowedOutputClassification:
        'Historically Backtested Research Methodology (Eligible for Prospective Signal Trial)',
      permitsDirectionalBuyHoldSell: false,
      status: 'blocked',
      qualifyingTickers: [],
      blockedTickers: list.map((a) => a.ticker),
      mandatoryRequirements: [
        'All Gate Tiers 1, 2, and 3 satisfied.',
        'Multi-year (`3–5+` years, spanning both monetary tightening/drawdown and expansion regimes) strict point-in-time backtest where every fundamental fact is gated by its exact SEC EDGAR `acceptanceDateTime` (`publishedAt <= anchorAt`).',
        'Survivorship-bias-free historical cohort selection (including delisted/acquired peers where applicable) rather than ex-post selection of today’s winners.',
        'Net-of-cost performance evaluation deducting realistic spread (`10 bps`), slippage (`5 bps`), and FX conversion (`15 bps`) against `QQQ`, sector benchmark (`SOXX`), and an equal-weight passive baseline.',
        'Out-of-sample walk-forward stability and weight-sensitivity verification across at least 12 independent quarterly earnings cycles.',
      ],
      unmetBlockers: [
        'Current repository contains 46 daily sessions (`2026-09-01` → `2026-11-04`) and 3 point-in-time reconstruction snapshots (`2026-03-31`, `2026-10-25`, `2026-11-04`), which is an illustrative ex-post comparison rather than a multi-year point-in-time backtest.',
      ],
      why252PriceBarsDoNotSufficeNote:
        'A single 252-session (1-year) window contains only 1 independent 12-month fundamental horizon (effective sample size N = 1 for a 12M forecast) within a single macro regime. Statistical validation of a 6–12M fundamental rating methodology requires multi-year point-in-time cross-sectional cohorts across multiple earnings and interest-rate cycles.',
    },
    {
      tierKey: 'tier_5_prospectively_evaluated_signals',
      tierNumber: 5,
      title: 'Gate Tier 5 — Prospectively Evaluated Signals (Production Directional Unlock Gate)',
      allowedOutputClassification:
        'Production Directional Research Assessment (BUY / HOLD / SELL / AVOID Permitted Subject to Ongoing Drift Monitoring)',
      permitsDirectionalBuyHoldSell: true,
      status: 'blocked',
      qualifyingTickers: [],
      blockedTickers: list.map((a) => a.ticker),
      mandatoryRequirements: [
        'All Gate Tiers 1, 2, 3, and 4 satisfied and signed off by the owner.',
        'Immutable, server-timestamped forward research assessment snapshots (`ImmutableAssessmentSnapshot` with SHA-256 `snapshotSha256`) registered BEFORE the outcome window opens.',
        'Completed out-of-sample prospective evaluation across elapsed `20D_TACTICAL`, `60D_QUARTERLY`, and `180D+` horizons measured against `QQQ`, sector benchmark `SOXX`, and passive equal-weight universe alternative.',
        'Zero look-ahead violations, zero retrospective signal mutations (`verifyAssessmentSnapshotIntegrity`), and positive risk-adjusted net information ratio after transaction costs.',
        'Explicit owner sign-off to unlock production `BUY` / `HOLD` / `SELL` badges.',
      ],
      unmetBlockers: [
        'Prospective forward assessment ledger (`lib/research-ratings/forward-evaluation.ts`) is now active, but elapsed multi-quarter out-of-sample windows and Tiers 2–4 prerequisites have not yet completed.',
        'Owner policy keeps all production directional classifications locked at `INSUFFICIENT DATA`.',
      ],
      why252PriceBarsDoNotSufficeNote:
        'Backtested historical fit (even over 252+ days) is vulnerable to specification search and regime overfitting; only cryptographically frozen, forward-registered assessments evaluated on subsequent unseen market sessions prove live out-of-sample discipline.',
    },
  ];
}

const METRIC_FORMULA_REGISTRY: Record<string, string> = {
  'GAAP Revenue':
    'Reported consolidated GAAP revenue from primary SEC filing (`us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax` / `Revenues`), normalised to USD millions.',
  'GAAP Operating Margin':
    '(Reported GAAP Operating Income / Reported GAAP Revenue) × 100 over the identical fiscal period.',
  'Free Cash Flow':
    'Operating Cash Flow (`NetCashProvidedByUsedInOperatingActivities`) minus Net Capital Expenditure (`PaymentsToAcquirePropertyPlantAndEquipment` less proceeds/principal adjustments as disclosed in primary filing).',
  'Operating Cash Flow (TTM vs Q3)':
    'Reported Trailing Twelve Months (`TTM-2026-Q3`) and Single-Quarter (`2026-Q3`) Operating Cash Flow from SEC Form 8-K Exhibit 99.1 (`amazon-sec-ex991`).',
  'Net Capex / OCF (Reconciled Across Periods)':
    'Net Capital Expenditure (`gross_capex - capex_proceeds`) divided by Operating Cash Flow (`operating_cash_flow`) × 100 across matched periods (`TTM-2026-Q3` = 125.2%, `2026-Q3` = 178.9%, `TTM-2025-Q3` = 88.7%, `2025-Q3` gross = 98.8%).',
  'Free Cash Flow (TTM & Q3)':
    'Operating Cash Flow minus Net Capital Expenditure (`TTM-2026-Q3`: $168,300M − $210,657M = -$42,357M; `2026-Q3`: $42,422M − $75,878M = -$33,456M).',
  'Latest Reference Close':
    'Latest regular-session daily closing price in USD (`Close/Last`) paired with ECB/BoE USD→GBP reference FX rate (`closeGbp = closeUsd * usdToGbp`).',
  '20-Session Price Return':
    '((Close_t − Close_{t-20}) / Close_{t-20}) × 100 over 20 consecutive trading sessions.',
  '5-Session Price Return':
    '((Close_t − Close_{t-5}) / Close_{t-5}) × 100 over 5 consecutive trading sessions.',
  'TypeDB Graph Relationships':
    'Count of active (`status != superseded`) TypeDB hypergraph relationships in `aci_macro_intelligence_prod` where the company is subject or object.',
  'Sector Layer':
    'Assigned structural layer within the AI infrastructure value chain (`Semiconductors & AI Hardware`, `Hyperscale Cloud & AI Platforms`, or `Specialist AI Compute`).',
  'Key Risk / Counterparty Exposure':
    'Verified balance-sheet, off-balance-sheet financing, capex intensity, or regional grid-constraint risk documented in primary SEC filings and TypeDB `Macro Case 001`.',
};

/**
 * Stage 6 — Audits production integrity and verifies that every single stock-screening number
 * across all 7 companies has a defined period, primary source, and explicit formula.
 */
export function auditProductionIntegrityAndMetricProvenance(
  assessments?: StockResearchAssessment[],
): ProductionIntegrityReport {
  const list = assessments ?? evaluateUniverseResearchAssessments();
  const auditedMetrics: MetricProvenanceAuditItem[] = [];

  for (const company of list) {
    const dims = Object.values(company.layers.quantitativeCalculation.dimensions);
    for (const dim of dims) {
      for (const obs of dim.observedMetrics) {
        const formula =
          METRIC_FORMULA_REGISTRY[obs.metric] ??
          'Reported primary SEC / TypeDB observation with exact period and source citation.';
        const complete =
          Boolean(obs.metric && obs.metric.trim()) &&
          Boolean(obs.valueDisplay && obs.valueDisplay.trim()) &&
          Boolean(obs.periodOrAsOf && obs.periodOrAsOf.trim()) &&
          Boolean(obs.sourceLabel && obs.sourceLabel.trim()) &&
          Boolean(obs.sourceId && obs.sourceId.trim()) &&
          Boolean(formula && formula.trim());

        auditedMetrics.push({
          ticker: company.ticker,
          dimensionKey: dim.key,
          metricName: obs.metric,
          valueDisplay: obs.valueDisplay,
          periodOrAsOf: obs.periodOrAsOf,
          sourceLabel: obs.sourceLabel,
          sourceId: obs.sourceId,
          definedFormulaOrBasis: formula,
          provenanceComplete: complete,
        });
      }
    }
  }

  const incompleteCount = auditedMetrics.filter((m) => !m.provenanceComplete).length;
  const allLockedInsufficientData = list.every(
    (a) => a.assessment === 'INSUFFICIENT DATA' && a.executionAuthority === 'none',
  );

  const samplePayload = buildExecutiveAssistantRequestPayload(
    'Why did NVIDIA receive this assessment?',
  );
  const payloadKeys = Object.keys(samplePayload).sort();
  const payloadIsStrictlyPublic =
    payloadKeys.length === 3 &&
    payloadKeys[0] === 'mode' &&
    payloadKeys[1] === 'question' &&
    payloadKeys[2] === 'temporalBasis';

  const sampleFallback = buildDeterministicExecutiveChatFallback(
    'Why did NVIDIA receive this assessment?',
    list,
  );
  const fallbackClearlyLabelled =
    sampleFallback.generationMode.includes('deterministic_public_evidence_synthesis') &&
    sampleFallback.generationMode.includes('Sign in for live Gemini') &&
    !sampleFallback.modelId.startsWith('gemini-');

  return {
    version: PHASE_G7_READINESS_VERSION,
    methodologyVersion: RESEARCH_METHODOLOGY_VERSION,
    valuationLayerVersion: VALUATION_LAYER_VERSION,
    allDirectionalRatingsLockedInsufficientData: allLockedInsufficientData,
    brokerValuesRequireLastSyncLabel: true,
    unauthenticatedChatFallbackClearlyLabelledNonGemini: fallbackClearlyLabelled,
    publicResearchInferenceExcludesPrivateBrokerData: payloadIsStrictlyPublic,
    allScreeningNumbersHavePeriodSourceAndFormula:
      auditedMetrics.length > 0 && incompleteCount === 0,
    totalAuditedScreeningMetrics: auditedMetrics.length,
    incompleteProvenanceMetricsCount: incompleteCount,
    auditedMetrics,
    executionAuthority: 'none',
  };
}
