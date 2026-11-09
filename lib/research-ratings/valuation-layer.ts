import companyComparisonRaw from '../../data/consensus/company-comparison.json';
import alphabetEarningsRaw from '../../data/earnings/alphabet-q3-2026.json';
import amazonCashRaw from '../../data/earnings/amazon-q3-2026-cash.json';
import policyRiskRaw from '../../data/policy-risk/midterm-2026-11-03.json';
import recoveryV2Raw from '../../data/recovery/november-3-2026-v2.json';

/**
 * Phase G.7 Stage 3 — Deterministic, Versioned Financial Valuation Layer.
 *
 * Design & Governance Invariants:
 * 1. Exact arithmetic formulas with explicit numerator/denominator definitions.
 * 2. Strict financial period consistency:
 *    - Valuation multiples combining a point-in-time stock variable (Market Cap, Enterprise Value)
 *      with an income/cash-flow statement variable (Revenue, EBIT, Net Income, OCF, FCF)
 *      MUST use a 4-quarter Trailing Twelve Months (`TTM`) or full fiscal year (`ANNUAL`) flow.
 *    - Single-quarter flows (`SINGLE_QUARTER`) are NEVER divided into Market Cap / EV and are NEVER
 *      naively multiplied by 4 (`annualised`), returning `null` with `status: 'blocked_period_mismatch_requires_ttm'`.
 * 3. Currency and unit normalisation: all monetary inputs are normalised to `USD millions` (`$M`) before calculation.
 * 4. Share-count reconciliation:
 *    - Rejects share counts back-solved from rounded EPS (`derivedFromRoundedEps: true`) for authoritative valuation.
 *    - Supports multi-class common stock summation (e.g., Alphabet Class A + Class B + Class C total diluted shares).
 * 5. Loss-making & negative cash-flow safeguards:
 *    - When `Net Income <= 0`, `Trailing P/E` returns `null` with `status: 'not_meaningful_negative_earnings'`.
 *    - When `Operating Income (EBIT) <= 0`, `EV / EBIT` returns `null` with `status: 'not_meaningful_negative_ebit'`.
 *    - When `Free Cash Flow <= 0`, `EV / FCF` and `P / FCF` return `null` with `status: 'not_meaningful_negative_fcf'`,
 *      while `FCF Yield (%)` is preserved as a signed percentage with `classification: 'negative_cash_burn_yield'`.
 *    - When `Book Equity <= 0`, `Price / Book` returns `null` with `status: 'not_meaningful_negative_book_equity'`.
 * 6. Restatement and point-in-time cutoff awareness (`publishedAtMs <= asOfMs`, `isRestated`, `supersedesEvidenceId`).
 * 7. Every output ratio carries its exact formula, period label, and component `evidenceIds`.
 */

export const VALUATION_LAYER_VERSION = 'aci-valuation-layer-v1.0.0' as const;

export type MonetaryUnit = 'ones' | 'thousands' | 'millions' | 'billions';
export type PeriodScope = 'SINGLE_QUARTER' | 'TTM' | 'ANNUAL';

export type ValuationMetricStatus =
  | 'computed_verified'
  | 'computed_unadjusted_reference_price'
  | 'missing_essential_input'
  | 'blocked_period_mismatch_requires_ttm'
  | 'blocked_derived_share_count_unsuitable'
  | 'blocked_look_ahead_timestamp'
  | 'not_meaningful_negative_earnings'
  | 'not_meaningful_negative_ebit'
  | 'not_meaningful_negative_fcf'
  | 'not_meaningful_negative_book_equity'
  | 'not_meaningful_non_positive_ev';

export interface ValuationPriceInput {
  closeUsd: number | null;
  sessionDate: string | null;
  eventAtMs: number | null;
  priceBasis: 'unadjusted_close' | 'split-adjusted' | 'total-return' | 'unavailable';
  corporateActionsReviewed: boolean;
  commerciallyLicensedForRedistribution: boolean;
  sourceId: string | null;
  sourceLabel: string | null;
}

export interface ValuationShareCountInput {
  dilutedSharesMillions: number | null;
  basicSharesMillions: number | null;
  shareClassesIncluded: string[]; // e.g. ['Class A (GOOGL)', 'Class B', 'Class C (GOOG)']
  multiClassReconciled: boolean;
  derivedFromRoundedEps: boolean;
  periodEnd: string | null;
  publishedAtMs: number | null;
  receivedAtMs: number | null;
  sourceId: string | null;
  xbrlConcept: string | null;
}

export interface ValuationBalanceSheetInput {
  cashAndEquivalentsMillions: number | null;
  shortTermInvestmentsMillions: number | null;
  totalDebtMillions: number | null;
  financeLeaseLiabilitiesMillions: number | null;
  bookEquityMillions: number | null;
  periodEnd: string | null;
  publishedAtMs: number | null;
  receivedAtMs: number | null;
  isRestated: boolean;
  supersedesEvidenceId: string | null;
  sourceIds: string[];
}

export interface ValuationFlowStatementInput {
  periodScope: PeriodScope;
  periodLabel: string;
  periodStart: string | null;
  periodEnd: string | null;
  revenueMillions: number | null;
  priorYearRevenueMillions: number | null;
  operatingIncomeMillions: number | null;
  netIncomeMillions: number | null;
  operatingCashFlowMillions: number | null;
  grossCapexMillions: number | null;
  capexProceedsMillions: number | null;
  netCapexMillions: number | null;
  freeCashFlowMillions: number | null;
  publishedAtMs: number | null;
  receivedAtMs: number | null;
  isRestated: boolean;
  restatementNote: string | null;
  supersedesEvidenceId: string | null;
  sourceIds: string[];
}

export interface ValuationInputBundle {
  ticker: string;
  companyName: string;
  currency: 'USD';
  asOfMs?: number | null;
  price: ValuationPriceInput;
  shareCount: ValuationShareCountInput;
  balanceSheet: ValuationBalanceSheetInput;
  primaryFlow: ValuationFlowStatementInput;
  secondarySingleQuarterFlow?: ValuationFlowStatementInput | null;
}

export interface ComputedValuationMetric {
  metricKey: string;
  label: string;
  value: number | null;
  unit: 'USD_millions' | 'multiple_x' | 'percent' | 'shares_millions';
  formattedDisplay: string;
  status: ValuationMetricStatus;
  formula: string;
  periodLabel: string;
  periodScope: PeriodScope | 'POINT_IN_TIME';
  isRestated: boolean;
  supersedesEvidenceId: string | null;
  componentEvidenceIds: string[];
  missingOrBlockingReasons: string[];
}

export interface DeterministicCompanyValuationResult {
  version: typeof VALUATION_LAYER_VERSION;
  ticker: string;
  companyName: string;
  asOfMs: number | null;
  priceQuality: {
    hasPrice: boolean;
    priceBasis: ValuationPriceInput['priceBasis'];
    corporateActionsReviewed: boolean;
    commerciallyLicensedForRedistribution: boolean;
    suitableForProductionValuation: boolean;
  };
  shareCountReconciliation: {
    hasAuthoritativeShareCount: boolean;
    dilutedSharesMillions: number | null;
    basicSharesMillions: number | null;
    derivedFromRoundedEps: boolean;
    multiClassReconciled: boolean;
    shareClassesIncluded: string[];
    blockingReason: string | null;
  };
  metrics: {
    marketCapUsdMillions: ComputedValuationMetric;
    netDebtUsdMillions: ComputedValuationMetric;
    enterpriseValueUsdMillions: ComputedValuationMetric;
    priceToBook: ComputedValuationMetric;
    trailingGaapPe: ComputedValuationMetric;
    evToTtmRevenue: ComputedValuationMetric;
    evToTtmEbit: ComputedValuationMetric;
    evToTtmFcf: ComputedValuationMetric;
    fcfYieldOnMarketCapPct: ComputedValuationMetric;
    fcfYieldOnEvPct: ComputedValuationMetric;
    netDebtToTtmOcf: ComputedValuationMetric;
    revenueYoYGrowthPct: ComputedValuationMetric;
    gaapOperatingMarginPct: ComputedValuationMetric;
    gaapNetMarginPct: ComputedValuationMetric;
    fcfMarginPct: ComputedValuationMetric;
    netCapexToOcfPct: ComputedValuationMetric;
    netCapexToRevenuePct: ComputedValuationMetric;
  };
  allValuationMultiplesResolved: boolean;
  blockingSummary: string[];
  executionAuthority: 'none';
}

/**
 * Converts a monetary amount into USD millions (`$M`).
 * Throws on unsupported currencies or non-finite values so silent unit corruption cannot occur.
 */
export function normaliseToUsdMillions(
  value: number | null | undefined,
  unit: MonetaryUnit,
  currency: string = 'USD',
): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) {
    throw new Error(`Non-finite monetary value passed to normaliseToUsdMillions: ${String(value)}`);
  }
  if (currency !== 'USD') {
    throw new Error(
      `Unsupported currency "${currency}" in normaliseToUsdMillions; explicit FX conversion required prior to USD normalisation.`,
    );
  }
  switch (unit) {
    case 'billions':
      return Number((value * 1_000).toFixed(4));
    case 'millions':
      return Number(value.toFixed(4));
    case 'thousands':
      return Number((value / 1_000).toFixed(6));
    case 'ones':
      return Number((value / 1_000_000).toFixed(6));
  }
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

function dedupeIds(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id && id.trim().length > 0)))];
}

/**
 * Executes the Stage 3 Deterministic Valuation Layer for a single company input bundle.
 */
export function computeDeterministicValuationMetrics(
  bundle: ValuationInputBundle,
): DeterministicCompanyValuationResult {
  const { ticker, companyName, asOfMs = null, price, shareCount, balanceSheet, primaryFlow } = bundle;

  // 1. Point-in-time look-ahead checks
  const shareLookAhead =
    asOfMs !== null && shareCount.publishedAtMs !== null && shareCount.publishedAtMs > asOfMs;
  const bsLookAhead =
    asOfMs !== null && balanceSheet.publishedAtMs !== null && balanceSheet.publishedAtMs > asOfMs;
  const flowLookAhead =
    asOfMs !== null && primaryFlow.publishedAtMs !== null && primaryFlow.publishedAtMs > asOfMs;
  const priceLookAhead =
    asOfMs !== null && price.eventAtMs !== null && price.eventAtMs > asOfMs;

  // 2. Share-count reconciliation
  const shareCountBlockedByEpsDerivation = shareCount.derivedFromRoundedEps === true;
  const hasValidDilutedShares =
    !shareLookAhead &&
    !shareCountBlockedByEpsDerivation &&
    shareCount.multiClassReconciled &&
    shareCount.dilutedSharesMillions !== null &&
    Number.isFinite(shareCount.dilutedSharesMillions) &&
    shareCount.dilutedSharesMillions > 0;

  let shareBlockingReason: string | null = null;
  if (shareLookAhead) {
    shareBlockingReason = `Share-count filing publishedAt (${shareCount.publishedAtMs}) is after evaluation cutoff (${asOfMs}).`;
  } else if (shareCountBlockedByEpsDerivation) {
    shareBlockingReason =
      'Share count back-solved from rounded diluted EPS is rejected for authoritative valuation; primary SEC XBRL WeightedAverageNumberOfDilutedSharesOutstanding is required.';
  } else if (!shareCount.multiClassReconciled) {
    shareBlockingReason =
      'Multi-class share structure (e.g., Class A + Class B + Class C) has not been reconciled to total economic diluted shares.';
  } else if (shareCount.dilutedSharesMillions === null || shareCount.dilutedSharesMillions <= 0) {
    shareBlockingReason =
      'Missing primary SEC XBRL diluted share count (WeightedAverageNumberOfDilutedSharesOutstanding / EntityCommonStockSharesOutstanding).';
  }

  const hasValidPrice =
    !priceLookAhead && price.closeUsd !== null && Number.isFinite(price.closeUsd) && price.closeUsd > 0;
  const priceIsFullyAdjustedAndLicensed =
    hasValidPrice &&
    (price.priceBasis === 'split-adjusted' || price.priceBasis === 'total-return') &&
    price.corporateActionsReviewed &&
    price.commerciallyLicensedForRedistribution;

  // 3. Market Capitalisation = Price (USD) * Diluted Shares (millions)
  let marketCapValue: number | null = null;
  let marketCapStatus: ValuationMetricStatus = 'missing_essential_input';
  const marketCapReasons: string[] = [];
  if (priceLookAhead || shareLookAhead) {
    marketCapStatus = 'blocked_look_ahead_timestamp';
    if (priceLookAhead) marketCapReasons.push('Price observation timestamp is after asOf cutoff.');
    if (shareLookAhead) marketCapReasons.push(shareBlockingReason!);
  } else if (shareCountBlockedByEpsDerivation) {
    marketCapStatus = 'blocked_derived_share_count_unsuitable';
    marketCapReasons.push(shareBlockingReason!);
  } else if (!hasValidPrice || !hasValidDilutedShares) {
    marketCapStatus = 'missing_essential_input';
    if (!hasValidPrice) marketCapReasons.push('Missing verified closing price in USD.');
    if (shareBlockingReason) marketCapReasons.push(shareBlockingReason);
  } else {
    marketCapValue = round2(price.closeUsd! * shareCount.dilutedSharesMillions!);
    marketCapStatus = priceIsFullyAdjustedAndLicensed
      ? 'computed_verified'
      : 'computed_unadjusted_reference_price';
    if (!priceIsFullyAdjustedAndLicensed) {
      marketCapReasons.push(
        `Computed using ${price.priceBasis} reference price (corporateActionsReviewed=${price.corporateActionsReviewed}, commerciallyLicensed=${price.commerciallyLicensedForRedistribution}).`,
      );
    }
  }

  const marketCapMetric: ComputedValuationMetric = {
    metricKey: 'market_cap_usd_millions',
    label: 'Market Capitalisation (Diluted)',
    value: marketCapValue,
    unit: 'USD_millions',
    formattedDisplay: marketCapValue !== null ? `$${marketCapValue.toLocaleString('en-US')}M` : 'Unavailable (null)',
    status: marketCapStatus,
    formula: 'Close Price (USD) × Weighted-Average Diluted Shares (Millions)',
    periodLabel: price.sessionDate ?? shareCount.periodEnd ?? 'Point-in-Time',
    periodScope: 'POINT_IN_TIME',
    isRestated: false,
    supersedesEvidenceId: null,
    componentEvidenceIds: dedupeIds([price.sourceId, shareCount.sourceId]),
    missingOrBlockingReasons: marketCapReasons,
  };

  // 4. Net Debt = Total Debt (incl. finance leases if separate) - (Cash & Equivalents + Short-Term Investments)
  let netDebtValue: number | null = null;
  let netDebtStatus: ValuationMetricStatus = 'missing_essential_input';
  const netDebtReasons: string[] = [];
  if (bsLookAhead) {
    netDebtStatus = 'blocked_look_ahead_timestamp';
    netDebtReasons.push(
      `Balance sheet filing publishedAt (${balanceSheet.publishedAtMs}) is after evaluation cutoff (${asOfMs}).`,
    );
  } else if (
    balanceSheet.totalDebtMillions === null ||
    balanceSheet.cashAndEquivalentsMillions === null
  ) {
    netDebtStatus = 'missing_essential_input';
    if (balanceSheet.totalDebtMillions === null) {
      netDebtReasons.push(
        'Missing SEC XBRL consolidated debt (LongTermDebtCurrent + LongTermDebtNoncurrent / ShortTermBorrowings).',
      );
    }
    if (balanceSheet.cashAndEquivalentsMillions === null) {
      netDebtReasons.push(
        'Missing SEC XBRL CashAndCashEquivalentsAtCarryingValue / MarketableSecuritiesCurrent.',
      );
    }
  } else {
    const totalCash =
      balanceSheet.cashAndEquivalentsMillions + (balanceSheet.shortTermInvestmentsMillions ?? 0);
    const totalDebt =
      balanceSheet.totalDebtMillions + (balanceSheet.financeLeaseLiabilitiesMillions ?? 0);
    netDebtValue = round2(totalDebt - totalCash);
    netDebtStatus = 'computed_verified';
  }

  const netDebtMetric: ComputedValuationMetric = {
    metricKey: 'net_debt_usd_millions',
    label: 'Net Debt / (Net Cash)',
    value: netDebtValue,
    unit: 'USD_millions',
    formattedDisplay:
      netDebtValue !== null
        ? netDebtValue < 0
          ? `-$${Math.abs(netDebtValue).toLocaleString('en-US')}M (Net Cash)`
          : `$${netDebtValue.toLocaleString('en-US')}M`
        : 'Unavailable (null)',
    status: netDebtStatus,
    formula:
      '(Total Short- & Long-Term Debt + Finance Lease Liabilities) − (Cash & Equivalents + Short-Term Marketable Securities)',
    periodLabel: balanceSheet.periodEnd ?? 'Point-in-Time',
    periodScope: 'POINT_IN_TIME',
    isRestated: balanceSheet.isRestated,
    supersedesEvidenceId: balanceSheet.supersedesEvidenceId,
    componentEvidenceIds: dedupeIds(balanceSheet.sourceIds),
    missingOrBlockingReasons: netDebtReasons,
  };

  // 5. Enterprise Value (EV) = Market Capitalisation + Net Debt
  let evValue: number | null = null;
  let evStatus: ValuationMetricStatus = 'missing_essential_input';
  const evReasons: string[] = [];
  if (marketCapStatus === 'blocked_look_ahead_timestamp' || netDebtStatus === 'blocked_look_ahead_timestamp') {
    evStatus = 'blocked_look_ahead_timestamp';
    evReasons.push(...marketCapReasons, ...netDebtReasons);
  } else if (marketCapStatus === 'blocked_derived_share_count_unsuitable') {
    evStatus = 'blocked_derived_share_count_unsuitable';
    evReasons.push(...marketCapReasons);
  } else if (marketCapValue === null || netDebtValue === null) {
    evStatus = 'missing_essential_input';
    if (marketCapValue === null) evReasons.push('Market Capitalisation is null.');
    if (netDebtValue === null) evReasons.push(...netDebtReasons);
  } else {
    evValue = round2(marketCapValue + netDebtValue);
    evStatus = priceIsFullyAdjustedAndLicensed
      ? 'computed_verified'
      : 'computed_unadjusted_reference_price';
    if (!priceIsFullyAdjustedAndLicensed) {
      evReasons.push(...marketCapReasons);
    }
  }

  const evMetric: ComputedValuationMetric = {
    metricKey: 'enterprise_value_usd_millions',
    label: 'Enterprise Value (EV)',
    value: evValue,
    unit: 'USD_millions',
    formattedDisplay: evValue !== null ? `$${evValue.toLocaleString('en-US')}M` : 'Unavailable (null)',
    status: evStatus,
    formula: 'Market Capitalisation + Net Debt',
    periodLabel: balanceSheet.periodEnd ?? price.sessionDate ?? 'Point-in-Time',
    periodScope: 'POINT_IN_TIME',
    isRestated: balanceSheet.isRestated,
    supersedesEvidenceId: balanceSheet.supersedesEvidenceId,
    componentEvidenceIds: dedupeIds([
      ...marketCapMetric.componentEvidenceIds,
      ...netDebtMetric.componentEvidenceIds,
    ]),
    missingOrBlockingReasons: evReasons,
  };

  // 6. Price / Book Equity = Market Cap / Book Equity
  let pbValue: number | null = null;
  let pbStatus: ValuationMetricStatus = 'missing_essential_input';
  const pbReasons: string[] = [];
  if (marketCapStatus === 'blocked_look_ahead_timestamp' || bsLookAhead) {
    pbStatus = 'blocked_look_ahead_timestamp';
    pbReasons.push('Point-in-time cutoff exceeded.');
  } else if (marketCapValue === null || balanceSheet.bookEquityMillions === null) {
    pbStatus =
      marketCapStatus === 'blocked_derived_share_count_unsuitable'
        ? 'blocked_derived_share_count_unsuitable'
        : 'missing_essential_input';
    if (marketCapValue === null) pbReasons.push(...marketCapReasons);
    if (balanceSheet.bookEquityMillions === null) {
      pbReasons.push('Missing SEC XBRL StockholdersEquity (book equity).');
    }
  } else if (balanceSheet.bookEquityMillions <= 0) {
    pbStatus = 'not_meaningful_negative_book_equity';
    pbReasons.push(
      `Book equity is non-positive ($${balanceSheet.bookEquityMillions}M); Price/Book is not meaningful.`,
    );
  } else {
    pbValue = round2(marketCapValue / balanceSheet.bookEquityMillions);
    pbStatus = priceIsFullyAdjustedAndLicensed
      ? 'computed_verified'
      : 'computed_unadjusted_reference_price';
  }

  const priceToBookMetric: ComputedValuationMetric = {
    metricKey: 'price_to_book',
    label: 'Price / Book Equity (P/B)',
    value: pbValue,
    unit: 'multiple_x',
    formattedDisplay: pbValue !== null ? `${pbValue.toFixed(2)}x` : 'Unavailable (null)',
    status: pbStatus,
    formula: 'Market Capitalisation / Consolidated Stockholders Equity',
    periodLabel: balanceSheet.periodEnd ?? 'Point-in-Time',
    periodScope: 'POINT_IN_TIME',
    isRestated: balanceSheet.isRestated,
    supersedesEvidenceId: balanceSheet.supersedesEvidenceId,
    componentEvidenceIds: dedupeIds([
      ...marketCapMetric.componentEvidenceIds,
      ...balanceSheet.sourceIds,
    ]),
    missingOrBlockingReasons: pbReasons,
  };

  // Helper to check if flow is TTM or ANNUAL for stock-to-flow valuation ratios
  const isFullYearFlow =
    primaryFlow.periodScope === 'TTM' || primaryFlow.periodScope === 'ANNUAL';

  // 7. Trailing GAAP P/E = Market Cap / TTM GAAP Net Income
  let peValue: number | null = null;
  let peStatus: ValuationMetricStatus = 'missing_essential_input';
  const peReasons: string[] = [];
  if (flowLookAhead || marketCapStatus === 'blocked_look_ahead_timestamp') {
    peStatus = 'blocked_look_ahead_timestamp';
    peReasons.push('Filing or price observation is after point-in-time cutoff.');
  } else if (!isFullYearFlow) {
    peStatus = 'blocked_period_mismatch_requires_ttm';
    peReasons.push(
      `Primary flow period (${primaryFlow.periodLabel}) has scope=${primaryFlow.periodScope}; Trailing P/E requires 4-quarter TTM or ANNUAL GAAP Net Income and never annualises a single quarter.`,
    );
  } else if (marketCapValue === null || primaryFlow.netIncomeMillions === null) {
    peStatus =
      marketCapStatus === 'blocked_derived_share_count_unsuitable'
        ? 'blocked_derived_share_count_unsuitable'
        : 'missing_essential_input';
    if (marketCapValue === null) peReasons.push(...marketCapReasons);
    if (primaryFlow.netIncomeMillions === null) {
      peReasons.push(`Missing TTM GAAP NetIncomeLoss for ${primaryFlow.periodLabel}.`);
    }
  } else if (primaryFlow.netIncomeMillions <= 0) {
    peStatus = 'not_meaningful_negative_earnings';
    peReasons.push(
      `TTM GAAP Net Income is non-positive ($${primaryFlow.netIncomeMillions}M); negative P/E is suppressed to prevent misleading "cheap" valuation ranking for loss-making firms.`,
    );
  } else {
    peValue = round2(marketCapValue / primaryFlow.netIncomeMillions);
    peStatus = priceIsFullyAdjustedAndLicensed
      ? 'computed_verified'
      : 'computed_unadjusted_reference_price';
  }

  const trailingPeMetric: ComputedValuationMetric = {
    metricKey: 'trailing_gaap_pe',
    label: 'Trailing GAAP P/E (TTM)',
    value: peValue,
    unit: 'multiple_x',
    formattedDisplay:
      peValue !== null
        ? `${peValue.toFixed(2)}x`
        : peStatus === 'not_meaningful_negative_earnings'
          ? 'N/M (Loss-Making)'
          : 'Unavailable (null)',
    status: peStatus,
    formula: 'Market Capitalisation / TTM GAAP Net Income (requires Net Income > 0)',
    periodLabel: primaryFlow.periodLabel,
    periodScope: primaryFlow.periodScope,
    isRestated: primaryFlow.isRestated,
    supersedesEvidenceId: primaryFlow.supersedesEvidenceId,
    componentEvidenceIds: dedupeIds([
      ...marketCapMetric.componentEvidenceIds,
      ...primaryFlow.sourceIds,
    ]),
    missingOrBlockingReasons: peReasons,
  };

  // 8. EV / TTM Revenue
  let evRevValue: number | null = null;
  let evRevStatus: ValuationMetricStatus = 'missing_essential_input';
  const evRevReasons: string[] = [];
  if (flowLookAhead || evStatus === 'blocked_look_ahead_timestamp') {
    evRevStatus = 'blocked_look_ahead_timestamp';
    evRevReasons.push('Filing or EV component is after point-in-time cutoff.');
  } else if (!isFullYearFlow) {
    evRevStatus = 'blocked_period_mismatch_requires_ttm';
    evRevReasons.push(
      `Primary flow (${primaryFlow.periodLabel}) is ${primaryFlow.periodScope}; EV/Revenue requires 4-quarter TTM or ANNUAL revenue.`,
    );
  } else if (evValue === null || primaryFlow.revenueMillions === null || primaryFlow.revenueMillions <= 0) {
    evRevStatus =
      evStatus === 'blocked_derived_share_count_unsuitable'
        ? 'blocked_derived_share_count_unsuitable'
        : 'missing_essential_input';
    if (evValue === null) evRevReasons.push(...evReasons);
    if (primaryFlow.revenueMillions === null || primaryFlow.revenueMillions <= 0) {
      evRevReasons.push('Missing positive TTM revenue.');
    }
  } else if (evValue <= 0) {
    evRevStatus = 'not_meaningful_non_positive_ev';
    evRevReasons.push(`Enterprise Value is non-positive ($${evValue}M).`);
  } else {
    evRevValue = round2(evValue / primaryFlow.revenueMillions);
    evRevStatus = priceIsFullyAdjustedAndLicensed
      ? 'computed_verified'
      : 'computed_unadjusted_reference_price';
  }

  const evToRevMetric: ComputedValuationMetric = {
    metricKey: 'ev_to_ttm_revenue',
    label: 'EV / TTM Revenue',
    value: evRevValue,
    unit: 'multiple_x',
    formattedDisplay: evRevValue !== null ? `${evRevValue.toFixed(2)}x` : 'Unavailable (null)',
    status: evRevStatus,
    formula: 'Enterprise Value / TTM Revenue',
    periodLabel: primaryFlow.periodLabel,
    periodScope: primaryFlow.periodScope,
    isRestated: primaryFlow.isRestated,
    supersedesEvidenceId: primaryFlow.supersedesEvidenceId,
    componentEvidenceIds: dedupeIds([...evMetric.componentEvidenceIds, ...primaryFlow.sourceIds]),
    missingOrBlockingReasons: evRevReasons,
  };

  // 9. EV / TTM Operating Income (EBIT)
  let evEbitValue: number | null = null;
  let evEbitStatus: ValuationMetricStatus = 'missing_essential_input';
  const evEbitReasons: string[] = [];
  if (flowLookAhead || evStatus === 'blocked_look_ahead_timestamp') {
    evEbitStatus = 'blocked_look_ahead_timestamp';
    evEbitReasons.push('Filing or EV component is after point-in-time cutoff.');
  } else if (!isFullYearFlow) {
    evEbitStatus = 'blocked_period_mismatch_requires_ttm';
    evEbitReasons.push(
      `Primary flow (${primaryFlow.periodLabel}) is ${primaryFlow.periodScope}; EV/EBIT requires 4-quarter TTM or ANNUAL operating income.`,
    );
  } else if (evValue === null || primaryFlow.operatingIncomeMillions === null) {
    evEbitStatus =
      evStatus === 'blocked_derived_share_count_unsuitable'
        ? 'blocked_derived_share_count_unsuitable'
        : 'missing_essential_input';
    if (evValue === null) evEbitReasons.push(...evReasons);
    if (primaryFlow.operatingIncomeMillions === null) {
      evEbitReasons.push('Missing TTM GAAP OperatingIncomeLoss.');
    }
  } else if (evValue <= 0) {
    evEbitStatus = 'not_meaningful_non_positive_ev';
    evEbitReasons.push(`Enterprise Value is non-positive ($${evValue}M).`);
  } else if (primaryFlow.operatingIncomeMillions <= 0) {
    evEbitStatus = 'not_meaningful_negative_ebit';
    evEbitReasons.push(
      `TTM GAAP Operating Income is non-positive ($${primaryFlow.operatingIncomeMillions}M); EV/EBIT is not meaningful for operating-loss firms.`,
    );
  } else {
    evEbitValue = round2(evValue / primaryFlow.operatingIncomeMillions);
    evEbitStatus = priceIsFullyAdjustedAndLicensed
      ? 'computed_verified'
      : 'computed_unadjusted_reference_price';
  }

  const evToEbitMetric: ComputedValuationMetric = {
    metricKey: 'ev_to_ttm_ebit',
    label: 'EV / TTM Operating Income (EBIT)',
    value: evEbitValue,
    unit: 'multiple_x',
    formattedDisplay:
      evEbitValue !== null
        ? `${evEbitValue.toFixed(2)}x`
        : evEbitStatus === 'not_meaningful_negative_ebit'
          ? 'N/M (Operating Loss)'
          : 'Unavailable (null)',
    status: evEbitStatus,
    formula: 'Enterprise Value / TTM GAAP Operating Income (requires Operating Income > 0)',
    periodLabel: primaryFlow.periodLabel,
    periodScope: primaryFlow.periodScope,
    isRestated: primaryFlow.isRestated,
    supersedesEvidenceId: primaryFlow.supersedesEvidenceId,
    componentEvidenceIds: dedupeIds([...evMetric.componentEvidenceIds, ...primaryFlow.sourceIds]),
    missingOrBlockingReasons: evEbitReasons,
  };

  // 10. EV / TTM Free Cash Flow
  let evFcfValue: number | null = null;
  let evFcfStatus: ValuationMetricStatus = 'missing_essential_input';
  const evFcfReasons: string[] = [];
  if (flowLookAhead || evStatus === 'blocked_look_ahead_timestamp') {
    evFcfStatus = 'blocked_look_ahead_timestamp';
    evFcfReasons.push('Filing or EV component is after point-in-time cutoff.');
  } else if (!isFullYearFlow) {
    evFcfStatus = 'blocked_period_mismatch_requires_ttm';
    evFcfReasons.push(
      `Primary flow (${primaryFlow.periodLabel}) is ${primaryFlow.periodScope}; EV/FCF requires 4-quarter TTM or ANNUAL Free Cash Flow.`,
    );
  } else if (evValue === null || primaryFlow.freeCashFlowMillions === null) {
    evFcfStatus =
      evStatus === 'blocked_derived_share_count_unsuitable'
        ? 'blocked_derived_share_count_unsuitable'
        : 'missing_essential_input';
    if (evValue === null) evFcfReasons.push(...evReasons);
    if (primaryFlow.freeCashFlowMillions === null) {
      evFcfReasons.push('Missing TTM Free Cash Flow.');
    }
  } else if (evValue <= 0) {
    evFcfStatus = 'not_meaningful_non_positive_ev';
    evFcfReasons.push(`Enterprise Value is non-positive ($${evValue}M).`);
  } else if (primaryFlow.freeCashFlowMillions <= 0) {
    evFcfStatus = 'not_meaningful_negative_fcf';
    evFcfReasons.push(
      `TTM Free Cash Flow is non-positive ($${primaryFlow.freeCashFlowMillions}M); EV/FCF multiple is suppressed because negative FCF produces a negative ratio.`,
    );
  } else {
    evFcfValue = round2(evValue / primaryFlow.freeCashFlowMillions);
    evFcfStatus = priceIsFullyAdjustedAndLicensed
      ? 'computed_verified'
      : 'computed_unadjusted_reference_price';
  }

  const evToFcfMetric: ComputedValuationMetric = {
    metricKey: 'ev_to_ttm_fcf',
    label: 'EV / TTM Free Cash Flow',
    value: evFcfValue,
    unit: 'multiple_x',
    formattedDisplay:
      evFcfValue !== null
        ? `${evFcfValue.toFixed(2)}x`
        : evFcfStatus === 'not_meaningful_negative_fcf'
          ? 'N/M (Negative TTM FCF)'
          : 'Unavailable (null)',
    status: evFcfStatus,
    formula: 'Enterprise Value / TTM Free Cash Flow (requires TTM FCF > 0)',
    periodLabel: primaryFlow.periodLabel,
    periodScope: primaryFlow.periodScope,
    isRestated: primaryFlow.isRestated,
    supersedesEvidenceId: primaryFlow.supersedesEvidenceId,
    componentEvidenceIds: dedupeIds([...evMetric.componentEvidenceIds, ...primaryFlow.sourceIds]),
    missingOrBlockingReasons: evFcfReasons,
  };

  // 11. FCF Yield on Market Cap (%) = (TTM FCF / Market Cap) * 100
  let fcfYieldMcValue: number | null = null;
  let fcfYieldMcStatus: ValuationMetricStatus = 'missing_essential_input';
  const fcfYieldMcReasons: string[] = [];
  if (flowLookAhead || marketCapStatus === 'blocked_look_ahead_timestamp') {
    fcfYieldMcStatus = 'blocked_look_ahead_timestamp';
    fcfYieldMcReasons.push('Filing or Market Cap component is after point-in-time cutoff.');
  } else if (!isFullYearFlow) {
    fcfYieldMcStatus = 'blocked_period_mismatch_requires_ttm';
    fcfYieldMcReasons.push(
      `Primary flow (${primaryFlow.periodLabel}) is ${primaryFlow.periodScope}; FCF Yield requires 4-quarter TTM or ANNUAL Free Cash Flow.`,
    );
  } else if (marketCapValue === null || primaryFlow.freeCashFlowMillions === null) {
    fcfYieldMcStatus =
      marketCapStatus === 'blocked_derived_share_count_unsuitable'
        ? 'blocked_derived_share_count_unsuitable'
        : 'missing_essential_input';
    if (marketCapValue === null) fcfYieldMcReasons.push(...marketCapReasons);
    if (primaryFlow.freeCashFlowMillions === null) fcfYieldMcReasons.push('Missing TTM Free Cash Flow.');
  } else {
    fcfYieldMcValue = round2((primaryFlow.freeCashFlowMillions / marketCapValue) * 100);
    fcfYieldMcStatus = priceIsFullyAdjustedAndLicensed
      ? 'computed_verified'
      : 'computed_unadjusted_reference_price';
    if (primaryFlow.freeCashFlowMillions < 0) {
      fcfYieldMcReasons.push(
        `Negative TTM FCF ($${primaryFlow.freeCashFlowMillions}M) produces a negative cash burn yield (${fcfYieldMcValue.toFixed(2)}%).`,
      );
    }
  }

  const fcfYieldMcMetric: ComputedValuationMetric = {
    metricKey: 'fcf_yield_market_cap_pct',
    label: 'TTM FCF Yield on Market Cap (%)',
    value: fcfYieldMcValue,
    unit: 'percent',
    formattedDisplay:
      fcfYieldMcValue !== null
        ? `${fcfYieldMcValue >= 0 ? '+' : ''}${fcfYieldMcValue.toFixed(2)}%${fcfYieldMcValue < 0 ? ' (Cash Burn)' : ''}`
        : 'Unavailable (null)',
    status: fcfYieldMcStatus,
    formula: '(TTM Free Cash Flow / Market Capitalisation) × 100',
    periodLabel: primaryFlow.periodLabel,
    periodScope: primaryFlow.periodScope,
    isRestated: primaryFlow.isRestated,
    supersedesEvidenceId: primaryFlow.supersedesEvidenceId,
    componentEvidenceIds: dedupeIds([
      ...marketCapMetric.componentEvidenceIds,
      ...primaryFlow.sourceIds,
    ]),
    missingOrBlockingReasons: fcfYieldMcReasons,
  };

  // 12. FCF Yield on Enterprise Value (%) = (TTM FCF / EV) * 100
  let fcfYieldEvValue: number | null = null;
  let fcfYieldEvStatus: ValuationMetricStatus = 'missing_essential_input';
  const fcfYieldEvReasons: string[] = [];
  if (flowLookAhead || evStatus === 'blocked_look_ahead_timestamp') {
    fcfYieldEvStatus = 'blocked_look_ahead_timestamp';
    fcfYieldEvReasons.push('Filing or EV component is after point-in-time cutoff.');
  } else if (!isFullYearFlow) {
    fcfYieldEvStatus = 'blocked_period_mismatch_requires_ttm';
    fcfYieldEvReasons.push(
      `Primary flow (${primaryFlow.periodLabel}) is ${primaryFlow.periodScope}; EV FCF Yield requires 4-quarter TTM or ANNUAL Free Cash Flow.`,
    );
  } else if (evValue === null || primaryFlow.freeCashFlowMillions === null) {
    fcfYieldEvStatus =
      evStatus === 'blocked_derived_share_count_unsuitable'
        ? 'blocked_derived_share_count_unsuitable'
        : 'missing_essential_input';
    if (evValue === null) fcfYieldEvReasons.push(...evReasons);
    if (primaryFlow.freeCashFlowMillions === null) fcfYieldEvReasons.push('Missing TTM Free Cash Flow.');
  } else if (evValue <= 0) {
    fcfYieldEvStatus = 'not_meaningful_non_positive_ev';
    fcfYieldEvReasons.push(`Enterprise Value is non-positive ($${evValue}M).`);
  } else {
    fcfYieldEvValue = round2((primaryFlow.freeCashFlowMillions / evValue) * 100);
    fcfYieldEvStatus = priceIsFullyAdjustedAndLicensed
      ? 'computed_verified'
      : 'computed_unadjusted_reference_price';
  }

  const fcfYieldEvMetric: ComputedValuationMetric = {
    metricKey: 'fcf_yield_ev_pct',
    label: 'TTM FCF Yield on Enterprise Value (%)',
    value: fcfYieldEvValue,
    unit: 'percent',
    formattedDisplay:
      fcfYieldEvValue !== null
        ? `${fcfYieldEvValue >= 0 ? '+' : ''}${fcfYieldEvValue.toFixed(2)}%${fcfYieldEvValue < 0 ? ' (Cash Burn)' : ''}`
        : 'Unavailable (null)',
    status: fcfYieldEvStatus,
    formula: '(TTM Free Cash Flow / Enterprise Value) × 100',
    periodLabel: primaryFlow.periodLabel,
    periodScope: primaryFlow.periodScope,
    isRestated: primaryFlow.isRestated,
    supersedesEvidenceId: primaryFlow.supersedesEvidenceId,
    componentEvidenceIds: dedupeIds([...evMetric.componentEvidenceIds, ...primaryFlow.sourceIds]),
    missingOrBlockingReasons: fcfYieldEvReasons,
  };

  // 13. Net Debt / TTM Operating Cash Flow
  let ndOcfValue: number | null = null;
  let ndOcfStatus: ValuationMetricStatus = 'missing_essential_input';
  const ndOcfReasons: string[] = [];
  if (flowLookAhead || netDebtStatus === 'blocked_look_ahead_timestamp') {
    ndOcfStatus = 'blocked_look_ahead_timestamp';
    ndOcfReasons.push('Filing or Net Debt component is after point-in-time cutoff.');
  } else if (!isFullYearFlow) {
    ndOcfStatus = 'blocked_period_mismatch_requires_ttm';
    ndOcfReasons.push(
      `Primary flow (${primaryFlow.periodLabel}) is ${primaryFlow.periodScope}; Net Debt / OCF requires 4-quarter TTM or ANNUAL OCF.`,
    );
  } else if (
    netDebtValue === null ||
    primaryFlow.operatingCashFlowMillions === null ||
    primaryFlow.operatingCashFlowMillions <= 0
  ) {
    ndOcfStatus = 'missing_essential_input';
    if (netDebtValue === null) ndOcfReasons.push(...netDebtReasons);
    if (primaryFlow.operatingCashFlowMillions === null || primaryFlow.operatingCashFlowMillions <= 0) {
      ndOcfReasons.push('Missing positive TTM Operating Cash Flow.');
    }
  } else {
    ndOcfValue = round2(netDebtValue / primaryFlow.operatingCashFlowMillions);
    ndOcfStatus = 'computed_verified';
  }

  const netDebtToOcfMetric: ComputedValuationMetric = {
    metricKey: 'net_debt_to_ttm_ocf',
    label: 'Net Debt / TTM Operating Cash Flow',
    value: ndOcfValue,
    unit: 'multiple_x',
    formattedDisplay: ndOcfValue !== null ? `${ndOcfValue.toFixed(2)}x` : 'Unavailable (null)',
    status: ndOcfStatus,
    formula: 'Net Debt / TTM Operating Cash Flow',
    periodLabel: primaryFlow.periodLabel,
    periodScope: primaryFlow.periodScope,
    isRestated: primaryFlow.isRestated || balanceSheet.isRestated,
    supersedesEvidenceId: primaryFlow.supersedesEvidenceId ?? balanceSheet.supersedesEvidenceId,
    componentEvidenceIds: dedupeIds([
      ...netDebtMetric.componentEvidenceIds,
      ...primaryFlow.sourceIds,
    ]),
    missingOrBlockingReasons: ndOcfReasons,
  };

  // 14. Same-period internal financial health & cash-conversion ratios (valid on both SINGLE_QUARTER and TTM)
  const revYoYValue =
    !flowLookAhead &&
    primaryFlow.revenueMillions !== null &&
    primaryFlow.priorYearRevenueMillions !== null &&
    primaryFlow.priorYearRevenueMillions > 0
      ? round2(
          ((primaryFlow.revenueMillions - primaryFlow.priorYearRevenueMillions) /
            primaryFlow.priorYearRevenueMillions) *
            100,
        )
      : null;

  const revenueYoYMetric: ComputedValuationMetric = {
    metricKey: 'revenue_yoy_growth_pct',
    label: 'Revenue YoY Growth (%)',
    value: revYoYValue,
    unit: 'percent',
    formattedDisplay:
      revYoYValue !== null
        ? `${revYoYValue >= 0 ? '+' : ''}${revYoYValue.toFixed(2)}%`
        : 'Unavailable (null)',
    status: flowLookAhead
      ? 'blocked_look_ahead_timestamp'
      : revYoYValue !== null
        ? 'computed_verified'
        : 'missing_essential_input',
    formula: '((Current Period Revenue − Prior-Year Same-Period Revenue) / Prior-Year Same-Period Revenue) × 100',
    periodLabel: primaryFlow.periodLabel,
    periodScope: primaryFlow.periodScope,
    isRestated: primaryFlow.isRestated,
    supersedesEvidenceId: primaryFlow.supersedesEvidenceId,
    componentEvidenceIds: dedupeIds(primaryFlow.sourceIds),
    missingOrBlockingReasons:
      revYoYValue === null
        ? ['Missing prior-year comparative period revenue in stored filing bundle.']
        : [],
  };

  const opMarginValue =
    !flowLookAhead &&
    primaryFlow.revenueMillions !== null &&
    primaryFlow.revenueMillions > 0 &&
    primaryFlow.operatingIncomeMillions !== null
      ? round2((primaryFlow.operatingIncomeMillions / primaryFlow.revenueMillions) * 100)
      : null;

  const opMarginMetric: ComputedValuationMetric = {
    metricKey: 'gaap_operating_margin_pct',
    label: 'GAAP Operating Margin (%)',
    value: opMarginValue,
    unit: 'percent',
    formattedDisplay: opMarginValue !== null ? `${opMarginValue.toFixed(2)}%` : 'Unavailable (null)',
    status: flowLookAhead
      ? 'blocked_look_ahead_timestamp'
      : opMarginValue !== null
        ? 'computed_verified'
        : 'missing_essential_input',
    formula: '(GAAP Operating Income / GAAP Revenue) × 100 (matched period)',
    periodLabel: primaryFlow.periodLabel,
    periodScope: primaryFlow.periodScope,
    isRestated: primaryFlow.isRestated,
    supersedesEvidenceId: primaryFlow.supersedesEvidenceId,
    componentEvidenceIds: dedupeIds(primaryFlow.sourceIds),
    missingOrBlockingReasons:
      opMarginValue === null ? ['Missing matched-period GAAP Operating Income or Revenue.'] : [],
  };

  const netMarginValue =
    !flowLookAhead &&
    primaryFlow.revenueMillions !== null &&
    primaryFlow.revenueMillions > 0 &&
    primaryFlow.netIncomeMillions !== null
      ? round2((primaryFlow.netIncomeMillions / primaryFlow.revenueMillions) * 100)
      : null;

  const netMarginMetric: ComputedValuationMetric = {
    metricKey: 'gaap_net_margin_pct',
    label: 'GAAP Net Profit Margin (%)',
    value: netMarginValue,
    unit: 'percent',
    formattedDisplay: netMarginValue !== null ? `${netMarginValue.toFixed(2)}%` : 'Unavailable (null)',
    status: flowLookAhead
      ? 'blocked_look_ahead_timestamp'
      : netMarginValue !== null
        ? 'computed_verified'
        : 'missing_essential_input',
    formula: '(GAAP Net Income / GAAP Revenue) × 100 (matched period)',
    periodLabel: primaryFlow.periodLabel,
    periodScope: primaryFlow.periodScope,
    isRestated: primaryFlow.isRestated,
    supersedesEvidenceId: primaryFlow.supersedesEvidenceId,
    componentEvidenceIds: dedupeIds(primaryFlow.sourceIds),
    missingOrBlockingReasons:
      netMarginValue === null ? ['Missing matched-period GAAP Net Income or Revenue.'] : [],
  };

  const fcfMarginValue =
    !flowLookAhead &&
    primaryFlow.revenueMillions !== null &&
    primaryFlow.revenueMillions > 0 &&
    primaryFlow.freeCashFlowMillions !== null
      ? round2((primaryFlow.freeCashFlowMillions / primaryFlow.revenueMillions) * 100)
      : null;

  const fcfMarginMetric: ComputedValuationMetric = {
    metricKey: 'fcf_margin_pct',
    label: 'Free Cash Flow Margin (%)',
    value: fcfMarginValue,
    unit: 'percent',
    formattedDisplay: fcfMarginValue !== null ? `${fcfMarginValue.toFixed(2)}%` : 'Unavailable (null)',
    status: flowLookAhead
      ? 'blocked_look_ahead_timestamp'
      : fcfMarginValue !== null
        ? 'computed_verified'
        : 'missing_essential_input',
    formula: '(Free Cash Flow / GAAP Revenue) × 100 (matched period)',
    periodLabel: primaryFlow.periodLabel,
    periodScope: primaryFlow.periodScope,
    isRestated: primaryFlow.isRestated,
    supersedesEvidenceId: primaryFlow.supersedesEvidenceId,
    componentEvidenceIds: dedupeIds(primaryFlow.sourceIds),
    missingOrBlockingReasons:
      fcfMarginValue === null ? ['Missing matched-period Free Cash Flow or Revenue.'] : [],
  };

  const capexToOcfValue =
    !flowLookAhead &&
    primaryFlow.operatingCashFlowMillions !== null &&
    primaryFlow.operatingCashFlowMillions > 0 &&
    primaryFlow.netCapexMillions !== null
      ? round2((primaryFlow.netCapexMillions / primaryFlow.operatingCashFlowMillions) * 100)
      : null;

  const capexToOcfMetric: ComputedValuationMetric = {
    metricKey: 'net_capex_to_ocf_pct',
    label: 'Net Capex / Operating Cash Flow (%)',
    value: capexToOcfValue,
    unit: 'percent',
    formattedDisplay: capexToOcfValue !== null ? `${capexToOcfValue.toFixed(2)}%` : 'Unavailable (null)',
    status: flowLookAhead
      ? 'blocked_look_ahead_timestamp'
      : capexToOcfValue !== null
        ? 'computed_verified'
        : 'missing_essential_input',
    formula: '(Net Capital Expenditure / Operating Cash Flow) × 100 (matched period)',
    periodLabel: primaryFlow.periodLabel,
    periodScope: primaryFlow.periodScope,
    isRestated: primaryFlow.isRestated,
    supersedesEvidenceId: primaryFlow.supersedesEvidenceId,
    componentEvidenceIds: dedupeIds(primaryFlow.sourceIds),
    missingOrBlockingReasons:
      capexToOcfValue === null ? ['Missing matched-period Net Capex or Operating Cash Flow.'] : [],
  };

  const capexToRevValue =
    !flowLookAhead &&
    primaryFlow.revenueMillions !== null &&
    primaryFlow.revenueMillions > 0 &&
    primaryFlow.netCapexMillions !== null
      ? round2((primaryFlow.netCapexMillions / primaryFlow.revenueMillions) * 100)
      : null;

  const capexToRevMetric: ComputedValuationMetric = {
    metricKey: 'net_capex_to_revenue_pct',
    label: 'Net Capex Intensity (% of Revenue)',
    value: capexToRevValue,
    unit: 'percent',
    formattedDisplay: capexToRevValue !== null ? `${capexToRevValue.toFixed(2)}%` : 'Unavailable (null)',
    status: flowLookAhead
      ? 'blocked_look_ahead_timestamp'
      : capexToRevValue !== null
        ? 'computed_verified'
        : 'missing_essential_input',
    formula: '(Net Capital Expenditure / GAAP Revenue) × 100 (matched period)',
    periodLabel: primaryFlow.periodLabel,
    periodScope: primaryFlow.periodScope,
    isRestated: primaryFlow.isRestated,
    supersedesEvidenceId: primaryFlow.supersedesEvidenceId,
    componentEvidenceIds: dedupeIds(primaryFlow.sourceIds),
    missingOrBlockingReasons:
      capexToRevValue === null ? ['Missing matched-period Net Capex or Revenue.'] : [],
  };

  const allValuationMultiplesResolved =
    marketCapMetric.status === 'computed_verified' &&
    evMetric.status === 'computed_verified' &&
    evToRevMetric.status === 'computed_verified' &&
    (evToEbitMetric.status === 'computed_verified' ||
      evToEbitMetric.status === 'not_meaningful_negative_ebit') &&
    (trailingPeMetric.status === 'computed_verified' ||
      trailingPeMetric.status === 'not_meaningful_negative_earnings') &&
    fcfYieldMcMetric.status === 'computed_verified';

  const blockingSummary = dedupeIds([
    shareBlockingReason,
    ...marketCapReasons,
    ...netDebtReasons,
    ...trailingPeMetric.missingOrBlockingReasons,
    ...evToRevMetric.missingOrBlockingReasons,
  ]);

  return {
    version: VALUATION_LAYER_VERSION,
    ticker,
    companyName,
    asOfMs,
    priceQuality: {
      hasPrice: hasValidPrice,
      priceBasis: price.priceBasis,
      corporateActionsReviewed: price.corporateActionsReviewed,
      commerciallyLicensedForRedistribution: price.commerciallyLicensedForRedistribution,
      suitableForProductionValuation: priceIsFullyAdjustedAndLicensed,
    },
    shareCountReconciliation: {
      hasAuthoritativeShareCount: hasValidDilutedShares,
      dilutedSharesMillions: hasValidDilutedShares ? shareCount.dilutedSharesMillions : null,
      basicSharesMillions: shareCount.basicSharesMillions,
      derivedFromRoundedEps: shareCount.derivedFromRoundedEps,
      multiClassReconciled: shareCount.multiClassReconciled,
      shareClassesIncluded: shareCount.shareClassesIncluded,
      blockingReason: shareBlockingReason,
    },
    metrics: {
      marketCapUsdMillions: marketCapMetric,
      netDebtUsdMillions: netDebtMetric,
      enterpriseValueUsdMillions: evMetric,
      priceToBook: priceToBookMetric,
      trailingGaapPe: trailingPeMetric,
      evToTtmRevenue: evToRevMetric,
      evToTtmEbit: evToEbitMetric,
      evToTtmFcf: evToFcfMetric,
      fcfYieldOnMarketCapPct: fcfYieldMcMetric,
      fcfYieldOnEvPct: fcfYieldEvMetric,
      netDebtToTtmOcf: netDebtToOcfMetric,
      revenueYoYGrowthPct: revenueYoYMetric,
      gaapOperatingMarginPct: opMarginMetric,
      gaapNetMarginPct: netMarginMetric,
      fcfMarginPct: fcfMarginMetric,
      netCapexToOcfPct: capexToOcfMetric,
      netCapexToRevenuePct: capexToRevMetric,
    },
    allValuationMultiplesResolved,
    blockingSummary,
    executionAuthority: 'none',
  };
}

function getLatestStoredReferencePrice(ticker: string): ValuationPriceInput {
  const prPrices =
    (
      policyRiskRaw as {
        prices?: Array<{
          ticker: string;
          eventAt: number;
          close: number;
          sourceId?: string;
        }>;
      }
    ).prices ?? [];
  const recPrices =
    (
      recoveryV2Raw as {
        prices?: Array<{
          instrumentId: string;
          eventAt: number;
          close: number;
          sourceId?: string;
        }>;
      }
    ).prices ?? [];

  const merged = [
    ...prPrices
      .filter((p) => p.ticker === ticker && Number.isFinite(p.close))
      .map((p) => ({
        at: p.eventAt,
        close: p.close,
        sourceId: p.sourceId ?? `nasdaq-${ticker.toLowerCase()}`,
      })),
    ...recPrices
      .filter((p) => p.instrumentId === ticker && Number.isFinite(p.close))
      .map((p) => ({
        at: p.eventAt,
        close: p.close,
        sourceId: p.sourceId ?? `nasdaq-${ticker.toLowerCase()}-history-v2`,
      })),
  ].sort((a, b) => a.at - b.at);
  const latest = merged.at(-1);
  if (!latest) {
    return {
      closeUsd: null,
      sessionDate: null,
      eventAtMs: null,
      priceBasis: 'unavailable',
      corporateActionsReviewed: false,
      commerciallyLicensedForRedistribution: false,
      sourceId: null,
      sourceLabel: null,
    };
  }
  return {
    closeUsd: latest.close,
    sessionDate: new Date(latest.at).toISOString().slice(0, 10),
    eventAtMs: latest.at,
    priceBasis: 'unadjusted_close',
    corporateActionsReviewed: false,
    commerciallyLicensedForRedistribution: false,
    sourceId: latest.sourceId,
    sourceLabel: `Nasdaq Historical Public Reference Close (${latest.sourceId})`,
  };
}

/**
 * Evaluates the deterministic valuation layer across all 7 stocks (`NVDA`, `MSFT`, `GOOGL`, `AMZN`, `AMD`, `CRWV`, `INTC`)
 * using ONLY the primary evidence currently stored in the repository.
 * Demonstrates exact same-period ratios that are verified right now and exact missing XBRL/price inputs keeping multiples `null`.
 */
export function evaluateUniverseCurrentValuationLayer(): DeterministicCompanyValuationResult[] {
  const companies = (
    companyComparisonRaw as {
      companies: Array<{
        symbol: string;
        name: string;
        periodLabel: string;
        periodStart: string;
        periodEnd: string;
        companyRevenueMillions: number;
        operatingIncomeMillions: number;
        netIncomeMillions: number;
        ocf: { value: number };
        cashCapex: { value: number };
        freeCashFlow: { value: number };
        bookEquity: { valueMillions: number; asOf: string; sourceIds: string[] };
        sourceIds: string[];
      }>;
    }
  ).companies;

  const nvda = companies.find((c) => c.symbol === 'NVDA')!;
  const msft = companies.find((c) => c.symbol === 'MSFT')!;

  const googMetrics = (
    alphabetEarningsRaw as {
      releaseAt: number;
      receivedAt: number;
      metrics: Array<{
        id: string;
        metric: string;
        value: number;
        unit: string;
        period: string;
        role: string;
      }>;
    }
  ).metrics.filter((m) => m.role === 'actual');
  const gMetric = (metric: string, period: string) =>
    googMetrics.find((m) => m.metric === metric && m.period === period)?.value ?? null;

  const amznObs = (
    amazonCashRaw as {
      observations: Array<{
        id: string;
        metric: string;
        scope: string;
        period: { label: string; start: string; end: string };
        value: number;
      }>;
    }
  ).observations;
  const aVal = (metric: string, label: string) =>
    amznObs.find((o) => o.scope === 'company' && o.metric === metric && o.period.label === label)
      ?.value ?? null;

  const ttm26Quarters = ['2025-Q4', '2026-Q1', '2026-Q2', '2026-Q3'] as const;
  const ttm25Quarters = ['2024-Q4', '2025-Q1', '2025-Q2', '2025-Q3'] as const;
  const sumAmzn = (metric: string, labels: readonly string[]) => {
    const vals = labels.map((l) => aVal(metric, l));
    if (vals.some((v) => v === null)) return null;
    return (vals as number[]).reduce((acc, v) => acc + v, 0);
  };

  const amznTtm26Rev = sumAmzn('revenue', ttm26Quarters);
  const amznTtm25Rev = sumAmzn('revenue', ttm25Quarters);
  const amznTtm26OpInc = sumAmzn('operating_income', ttm26Quarters);
  const amznTtm26Ocf = aVal('operating_cash_flow', 'TTM-2026-Q3');
  const amznTtm26GrossCapex = aVal('gross_capex', 'TTM-2026-Q3');
  const amznTtm26Proceeds = aVal('capex_proceeds', 'TTM-2026-Q3');
  const amznTtm26NetCapex =
    amznTtm26GrossCapex !== null && amznTtm26Proceeds !== null
      ? amznTtm26GrossCapex - amznTtm26Proceeds
      : null;
  const amznTtm26Fcf =
    amznTtm26Ocf !== null && amznTtm26NetCapex !== null
      ? amznTtm26Ocf - amznTtm26NetCapex
      : null;

  const bundles: ValuationInputBundle[] = [
    {
      ticker: 'NVDA',
      companyName: 'NVIDIA Corporation',
      currency: 'USD',
      price: getLatestStoredReferencePrice('NVDA'),
      shareCount: {
        dilutedSharesMillions: null,
        basicSharesMillions: null,
        shareClassesIncluded: ['Common Stock (Single Class)'],
        multiClassReconciled: true,
        derivedFromRoundedEps: false,
        periodEnd: nvda.periodEnd,
        publishedAtMs: Date.parse('2026-08-26T20:00:00Z'),
        receivedAtMs: Date.parse('2026-11-03T22:25:07Z'),
        sourceId: 'nvda-fy27-q2',
        xbrlConcept: null,
      },
      balanceSheet: {
        cashAndEquivalentsMillions: null,
        shortTermInvestmentsMillions: null,
        totalDebtMillions: null,
        financeLeaseLiabilitiesMillions: null,
        bookEquityMillions: nvda.bookEquity.valueMillions,
        periodEnd: nvda.bookEquity.asOf,
        publishedAtMs: Date.parse('2026-08-26T20:00:00Z'),
        receivedAtMs: Date.parse('2026-11-03T22:25:07Z'),
        isRestated: false,
        supersedesEvidenceId: null,
        sourceIds: nvda.bookEquity.sourceIds,
      },
      primaryFlow: {
        periodScope: 'SINGLE_QUARTER',
        periodLabel: nvda.periodLabel,
        periodStart: nvda.periodStart,
        periodEnd: nvda.periodEnd,
        revenueMillions: nvda.companyRevenueMillions,
        priorYearRevenueMillions: null,
        operatingIncomeMillions: nvda.operatingIncomeMillions,
        netIncomeMillions: nvda.netIncomeMillions,
        operatingCashFlowMillions: nvda.ocf.value,
        grossCapexMillions: nvda.cashCapex.value,
        capexProceedsMillions: 0,
        netCapexMillions: nvda.cashCapex.value,
        freeCashFlowMillions: nvda.freeCashFlow.value,
        publishedAtMs: Date.parse('2026-08-26T20:00:00Z'),
        receivedAtMs: Date.parse('2026-11-03T22:25:07Z'),
        isRestated: false,
        restatementNote: null,
        supersedesEvidenceId: null,
        sourceIds: nvda.sourceIds,
      },
    },
    {
      ticker: 'MSFT',
      companyName: 'Microsoft Corporation',
      currency: 'USD',
      price: getLatestStoredReferencePrice('MSFT'),
      shareCount: {
        dilutedSharesMillions: null,
        basicSharesMillions: null,
        shareClassesIncluded: ['Common Stock (Single Class)'],
        multiClassReconciled: true,
        derivedFromRoundedEps: false,
        periodEnd: msft.periodEnd,
        publishedAtMs: Date.parse('2026-10-28T20:00:00Z'),
        receivedAtMs: Date.parse('2026-11-03T22:25:07Z'),
        sourceId: 'msft-fy27-q1',
        xbrlConcept: null,
      },
      balanceSheet: {
        cashAndEquivalentsMillions: null,
        shortTermInvestmentsMillions: null,
        totalDebtMillions: null,
        financeLeaseLiabilitiesMillions: null,
        bookEquityMillions: msft.bookEquity.valueMillions,
        periodEnd: msft.bookEquity.asOf,
        publishedAtMs: Date.parse('2026-10-28T20:00:00Z'),
        receivedAtMs: Date.parse('2026-11-03T22:25:07Z'),
        isRestated: false,
        supersedesEvidenceId: null,
        sourceIds: msft.bookEquity.sourceIds,
      },
      primaryFlow: {
        periodScope: 'SINGLE_QUARTER',
        periodLabel: msft.periodLabel,
        periodStart: msft.periodStart,
        periodEnd: msft.periodEnd,
        revenueMillions: msft.companyRevenueMillions,
        priorYearRevenueMillions: null,
        operatingIncomeMillions: msft.operatingIncomeMillions,
        netIncomeMillions: msft.netIncomeMillions,
        operatingCashFlowMillions: msft.ocf.value,
        grossCapexMillions: msft.cashCapex.value,
        capexProceedsMillions: 0,
        netCapexMillions: msft.cashCapex.value,
        freeCashFlowMillions: msft.freeCashFlow.value,
        publishedAtMs: Date.parse('2026-10-28T20:00:00Z'),
        receivedAtMs: Date.parse('2026-11-03T22:25:07Z'),
        isRestated: true,
        restatementNote:
          'FY2027 Q1 segment presentation recast to Agents and Infra and Devices and Consumer; prior comparative segment periods recast in release.',
        supersedesEvidenceId: null,
        sourceIds: msft.sourceIds,
      },
    },
    {
      ticker: 'GOOGL',
      companyName: 'Alphabet Inc.',
      currency: 'USD',
      price: getLatestStoredReferencePrice('GOOGL'),
      shareCount: {
        dilutedSharesMillions: null,
        basicSharesMillions: null,
        shareClassesIncluded: ['Class A (GOOGL)', 'Class B (Super-Voting)', 'Class C (GOOG)'],
        multiClassReconciled: false,
        derivedFromRoundedEps: false,
        periodEnd: '2026-09-30',
        publishedAtMs: 1793217693000,
        receivedAtMs: 1793294123000,
        sourceId: 'sec-release',
        xbrlConcept: null,
      },
      balanceSheet: {
        cashAndEquivalentsMillions: null,
        shortTermInvestmentsMillions: null,
        totalDebtMillions: null,
        financeLeaseLiabilitiesMillions: null,
        bookEquityMillions: null,
        periodEnd: '2026-09-30',
        publishedAtMs: 1793217693000,
        receivedAtMs: 1793294123000,
        isRestated: false,
        supersedesEvidenceId: null,
        sourceIds: ['sec-release', 'sec-index'],
      },
      primaryFlow: {
        periodScope: 'SINGLE_QUARTER',
        periodLabel: '2026-Q3 (Three months ended 30 September 2026)',
        periodStart: '2026-07-01',
        periodEnd: '2026-09-30',
        revenueMillions: normaliseToUsdMillions(gMetric('revenue', '2026-Q3'), 'billions', 'USD'),
        priorYearRevenueMillions: normaliseToUsdMillions(
          gMetric('revenue', '2025-Q3'),
          'billions',
          'USD',
        ),
        operatingIncomeMillions: normaliseToUsdMillions(
          gMetric('operating_income', '2026-Q3'),
          'billions',
          'USD',
        ),
        netIncomeMillions: null,
        operatingCashFlowMillions: normaliseToUsdMillions(
          gMetric('operating_cash_flow', '2026-Q3'),
          'billions',
          'USD',
        ),
        grossCapexMillions: normaliseToUsdMillions(
          gMetric('capital_expenditure', '2026-Q3'),
          'billions',
          'USD',
        ),
        capexProceedsMillions: 0,
        netCapexMillions: normaliseToUsdMillions(
          gMetric('capital_expenditure', '2026-Q3'),
          'billions',
          'USD',
        ),
        freeCashFlowMillions: normaliseToUsdMillions(
          gMetric('free_cash_flow', '2026-Q3'),
          'billions',
          'USD',
        ),
        publishedAtMs: 1793217693000,
        receivedAtMs: 1793294123000,
        isRestated: false,
        restatementNote: null,
        supersedesEvidenceId: null,
        sourceIds: ['sec-release', 'sec-index', 'goog-2026q3-revenue-v1', 'goog-2026q3-free_cash_flow-v1'],
      },
    },
    {
      ticker: 'AMZN',
      companyName: 'Amazon.com, Inc.',
      currency: 'USD',
      price: getLatestStoredReferencePrice('AMZN'),
      shareCount: {
        dilutedSharesMillions: null,
        basicSharesMillions: null,
        shareClassesIncluded: ['Common Stock (Single Class)'],
        multiClassReconciled: true,
        derivedFromRoundedEps: false,
        periodEnd: '2026-09-30',
        publishedAtMs: 1793304327000,
        receivedAtMs: 1793471503000,
        sourceId: 'amazon-sec-ex991',
        xbrlConcept: null,
      },
      balanceSheet: {
        cashAndEquivalentsMillions: null,
        shortTermInvestmentsMillions: null,
        totalDebtMillions: null,
        financeLeaseLiabilitiesMillions: null,
        bookEquityMillions: null,
        periodEnd: '2026-09-30',
        publishedAtMs: 1793304327000,
        receivedAtMs: 1793471503000,
        isRestated: false,
        supersedesEvidenceId: null,
        sourceIds: ['amazon-sec-ex991'],
      },
      primaryFlow: {
        periodScope: 'TTM',
        periodLabel: 'TTM-2026-Q3 (Twelve months ended 30 September 2026)',
        periodStart: '2025-10-01',
        periodEnd: '2026-09-30',
        revenueMillions: amznTtm26Rev,
        priorYearRevenueMillions: amznTtm25Rev,
        operatingIncomeMillions: amznTtm26OpInc,
        netIncomeMillions: null,
        operatingCashFlowMillions: amznTtm26Ocf,
        grossCapexMillions: amznTtm26GrossCapex,
        capexProceedsMillions: amznTtm26Proceeds,
        netCapexMillions: amznTtm26NetCapex,
        freeCashFlowMillions: amznTtm26Fcf,
        publishedAtMs: 1793304327000,
        receivedAtMs: 1793471503000,
        isRestated: false,
        restatementNote: null,
        supersedesEvidenceId: null,
        sourceIds: [
          'amazon-sec-ex991',
          'amzn-ttm-2026-q3-ocf-v1',
          'amzn-ttm-2026-q3-gross-capex-v1',
          'amzn-ttm-2026-q3-capex-proceeds-v1',
        ],
      },
    },
    ...(['AMD', 'CRWV', 'INTC'] as const).map((sym): ValuationInputBundle => {
      const names: Record<typeof sym, string> = {
        AMD: 'Advanced Micro Devices, Inc.',
        CRWV: 'CoreWeave, Inc.',
        INTC: 'Intel Corporation',
      };
      return {
        ticker: sym,
        companyName: names[sym],
        currency: 'USD',
        price: getLatestStoredReferencePrice(sym),
        shareCount: {
          dilutedSharesMillions: null,
          basicSharesMillions: null,
          shareClassesIncluded: ['Common Stock'],
          multiClassReconciled: sym !== 'CRWV',
          derivedFromRoundedEps: false,
          periodEnd: null,
          publishedAtMs: null,
          receivedAtMs: null,
          sourceId: null,
          xbrlConcept: null,
        },
        balanceSheet: {
          cashAndEquivalentsMillions: null,
          shortTermInvestmentsMillions: null,
          totalDebtMillions: null,
          financeLeaseLiabilitiesMillions: null,
          bookEquityMillions: null,
          periodEnd: null,
          publishedAtMs: null,
          receivedAtMs: null,
          isRestated: false,
          supersedesEvidenceId: null,
          sourceIds: [],
        },
        primaryFlow: {
          periodScope: 'TTM',
          periodLabel: 'Unimported SEC XBRL Period',
          periodStart: null,
          periodEnd: null,
          revenueMillions: null,
          priorYearRevenueMillions: null,
          operatingIncomeMillions: null,
          netIncomeMillions: null,
          operatingCashFlowMillions: null,
          grossCapexMillions: null,
          capexProceedsMillions: null,
          netCapexMillions: null,
          freeCashFlowMillions: null,
          publishedAtMs: null,
          receivedAtMs: null,
          isRestated: false,
          restatementNote: null,
          supersedesEvidenceId: null,
          sourceIds: [],
        },
      };
    }),
  ];

  return bundles.map(computeDeterministicValuationMetrics);
}
