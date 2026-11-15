/**
 * Deterministic SEC EDGAR XBRL Fact Selector (`lib/remote-ops/sec-xbrl-fact-selector.ts`).
 *
 * Enforces explicit governance rules for selecting financial facts from SEC `companyfacts` JSON:
 * 1. Unit & sign integrity: requires explicit target unit (`USD` or `shares`) and finite numeric value
 *    (supporting negative cash flows/losses and zero-value facts; strictly non-negative concepts such
 *    as revenue or share counts reject negative values).
 * 2. Form & amendment rules: restricts periodic financial statement extraction to `10-Q`, `10-K`,
 *    `10-Q/A`, and `10-K/A`, with amended filings (`10-Q/A`, `10-K/A`) superseding original filings
 *    for the same reporting period. Never misattributes a `10-Q`/`10-K` fact to an `8-K` accession.
 * 3. Point-in-time & receipt eligibility: requires `filed <= asOfDateIso`, `publishedAtMs <= asOfMs`,
 *    and `receivedAtMs <= asOfMs` (when provided).
 * 4. Period duration & instant classification: explicitly distinguishes `three_month` (`3M`),
 *    `cumulative_ytd` (`6M`/`9M`), `full_year` (`12M`/`FY`), and `instant` (point-in-time balance
 *    sheet / share count facts with `end` only and no `start`).
 * 5. Comparative-period rejection: within any filing, sorts by `end` date descending (never `filed`
 *    alone), prefers 3-month single-quarter frames (`CYxxxxQ[1-4]` or 70–110 day duration) over
 *    cumulative 6M/9M YTD spans on `10-Q`, supports non-calendar fiscal years (e.g., NVDA FY27 Q2
 *    ended 2026-07-26, MSFT FY27 Q1 ended 2026-09-30), and verifies that `filed - end <= 190 days`
 *    (and aligns with `reportDate` when provided) before marking any financial value as current.
 * 6. Duplicate & conflict detection: deduplicates exact duplicate rows and rejects conflicting values
 *    for the same accession, form, period (`start`/`end`), and frame.
 */

export type RawSecCompanyFactUnit = {
  val?: number;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  accn?: string;
  frame?: string;
  start?: string;
  end?: string;
};

export type SecCompanyFactsPayload = {
  cik?: number | string;
  entityName?: string;
  facts?: {
    'us-gaap'?: Record<
      string,
      {
        label?: string;
        units?: Record<string, RawSecCompanyFactUnit[]>;
      }
    >;
    dei?: Record<
      string,
      {
        label?: string;
        units?: Record<string, RawSecCompanyFactUnit[]>;
      }
    >;
  };
};

export type SecSubmissionHeaderInput = {
  ticker: string;
  cik: string;
  name: string;
  accession: string;
  form: string;
  filed: string;
  reportDate?: string | null;
  acceptanceDateTime?: string | null;
  docUrl: string;
  publishedMs: number;
  receivedMs?: number | null;
};

export type SecXbrlPeriodSpanKind =
  | 'three_month'
  | 'cumulative_ytd'
  | 'full_year'
  | 'instant'
  | 'other_duration';

export type SecXbrlConceptTiming = 'duration' | 'instant';

export type SecXbrlMetricKind =
  | 'capital expenditures'
  | 'revenue'
  | 'operating income (loss)'
  | 'net income (loss)'
  | 'operating cash flow'
  | 'free cash flow'
  | 'cash and cash equivalents'
  | 'common shares outstanding';

export type SelectedSecXbrlFactResult = {
  eligible: boolean;
  isCurrentReportingPeriod: boolean;
  isAmendment: boolean;
  accessionMatched: boolean;
  pointInTimeEligible: boolean;
  hasConflictingDuplicate: boolean;
  deduplicatedExactDuplicatesCount: number;
  rejectionReason: string | null;
  conceptName: string | null;
  conceptTiming: SecXbrlConceptTiming | null;
  periodSpanKind: SecXbrlPeriodSpanKind | null;
  metricKind: SecXbrlMetricKind | null;
  unit: 'USD' | 'shares';
  val: number | null;
  valueBillions: number | null;
  isNegativeValue: boolean;
  isZeroValue: boolean;
  periodLabel: string | null;
  fiscalYear: number | null;
  fiscalPeriod: string | null;
  reportingFrame: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  form: string | null;
  accession: string | null;
  filed: string | null;
};

type ConceptCandidateDescriptor = {
  namespace: 'us-gaap' | 'dei';
  name: string;
  kind: SecXbrlMetricKind;
  timing: SecXbrlConceptTiming;
  unit: 'USD' | 'shares';
  allowNegative: boolean;
};

const DEFAULT_CONCEPT_PRIORITY: readonly ConceptCandidateDescriptor[] = [
  {
    namespace: 'us-gaap',
    name: 'PaymentsToAcquirePropertyPlantAndEquipment',
    kind: 'capital expenditures',
    timing: 'duration',
    unit: 'USD',
    allowNegative: false,
  },
  {
    namespace: 'us-gaap',
    name: 'PaymentsToAcquireProductiveAssets',
    kind: 'capital expenditures',
    timing: 'duration',
    unit: 'USD',
    allowNegative: false,
  },
  {
    namespace: 'us-gaap',
    name: 'CapitalExpendituresIncurredButNotYetPaid',
    kind: 'capital expenditures',
    timing: 'duration',
    unit: 'USD',
    allowNegative: false,
  },
  {
    namespace: 'us-gaap',
    name: 'RevenueFromContractWithCustomerExcludingAssessedTax',
    kind: 'revenue',
    timing: 'duration',
    unit: 'USD',
    allowNegative: false,
  },
  {
    namespace: 'us-gaap',
    name: 'Revenues',
    kind: 'revenue',
    timing: 'duration',
    unit: 'USD',
    allowNegative: false,
  },
  {
    namespace: 'us-gaap',
    name: 'SalesRevenueNet',
    kind: 'revenue',
    timing: 'duration',
    unit: 'USD',
    allowNegative: false,
  },
  {
    namespace: 'us-gaap',
    name: 'OperatingIncomeLoss',
    kind: 'operating income (loss)',
    timing: 'duration',
    unit: 'USD',
    allowNegative: true,
  },
  {
    namespace: 'us-gaap',
    name: 'NetIncomeLoss',
    kind: 'net income (loss)',
    timing: 'duration',
    unit: 'USD',
    allowNegative: true,
  },
  {
    namespace: 'us-gaap',
    name: 'NetCashProvidedByUsedInOperatingActivities',
    kind: 'operating cash flow',
    timing: 'duration',
    unit: 'USD',
    allowNegative: true,
  },
  {
    namespace: 'us-gaap',
    name: 'CashAndCashEquivalentsAtCarryingValue',
    kind: 'cash and cash equivalents',
    timing: 'instant',
    unit: 'USD',
    allowNegative: false,
  },
  {
    namespace: 'us-gaap',
    name: 'CommonStockSharesOutstanding',
    kind: 'common shares outstanding',
    timing: 'instant',
    unit: 'shares',
    allowNegative: false,
  },
  {
    namespace: 'dei',
    name: 'EntityCommonStockSharesOutstanding',
    kind: 'common shares outstanding',
    timing: 'instant',
    unit: 'shares',
    allowNegative: false,
  },
];

const ELIGIBLE_PERIODIC_FORMS = new Set(['10-Q', '10-K', '10-Q/A', '10-K/A']);
const AMENDMENT_FORMS = new Set(['10-Q/A', '10-K/A']);
const MAX_PERIOD_END_TO_FILED_DAYS = 190;
const QUARTERLY_DURATION_FRAME_REGEX = /^CY\d{4}Q[1-4]$/;
const INSTANT_FRAME_REGEX = /^CY\d{4}Q[1-4]I$/;
const ANNUAL_FRAME_REGEX = /^CY\d{4}$/;

function parseIsoDateMs(dateStr: string | undefined | null): number | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const ms = Date.parse(`${dateStr}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

export function durationDaysBetween(
  startIso: string | undefined,
  endIso: string | undefined,
): number | null {
  const s = parseIsoDateMs(startIso);
  const e = parseIsoDateMs(endIso);
  if (s === null || e === null || e < s) return null;
  return Math.round((e - s) / 86_400_000);
}

export function classifySecFactPeriodSpan(
  u: RawSecCompanyFactUnit,
  conceptTiming: SecXbrlConceptTiming,
): SecXbrlPeriodSpanKind {
  if (conceptTiming === 'instant' || (!u.start && Boolean(u.end) && INSTANT_FRAME_REGEX.test(u.frame ?? ''))) {
    return 'instant';
  }
  const days = durationDaysBetween(u.start, u.end);
  if (days !== null) {
    if (days >= 70 && days <= 110) return 'three_month';
    if (days >= 160 && days <= 295) return 'cumulative_ytd';
    if (days >= 340 && days <= 385) return 'full_year';
    return 'other_duration';
  }
  if (u.frame && QUARTERLY_DURATION_FRAME_REGEX.test(u.frame)) {
    return 'three_month';
  }
  if (u.frame && ANNUAL_FRAME_REGEX.test(u.frame)) {
    return 'full_year';
  }
  if (u.fp === 'FY' || u.form === '10-K' || u.form === '10-K/A') {
    return 'full_year';
  }
  if (u.fp && /^Q[1-4]$/.test(u.fp)) {
    return 'three_month';
  }
  return 'other_duration';
}

function spanPreferenceRank(
  span: SecXbrlPeriodSpanKind,
  form: string | undefined,
  preferredSpan?: SecXbrlPeriodSpanKind,
): number {
  if (preferredSpan) {
    return span === preferredSpan ? 3 : 0;
  }
  if (span === 'instant') return 3;
  if (form === '10-K' || form === '10-K/A') {
    if (span === 'full_year') return 3;
    if (span === 'three_month') return 2;
    return 1;
  }
  // On 10-Q / 10-Q/A, prefer 3-month single-quarter over cumulative YTD
  if (span === 'three_month') return 3;
  if (span === 'cumulative_ytd') return 1;
  return 0;
}

function formatFiscalPeriodLabel(
  u: RawSecCompanyFactUnit,
  fallbackYear: number,
  spanKind: SecXbrlPeriodSpanKind,
): {
  fiscalYear: number;
  fiscalPeriod: string;
  periodLabel: string;
} {
  const endYear = u.end && /^\d{4}/.test(u.end) ? Number(u.end.slice(0, 4)) : fallbackYear;
  const fy = typeof u.fy === 'number' && Number.isFinite(u.fy) ? u.fy : endYear;
  const rawFp = u.fp && u.fp.trim() ? u.fp.trim() : spanKind === 'full_year' ? 'FY' : 'Q4';
  const baseLabel = rawFp !== 'FY' ? `${rawFp} ${fy}` : `FY${fy}`;
  const periodLabel =
    spanKind === 'cumulative_ytd' && !baseLabel.includes('YTD')
      ? `${baseLabel} (YTD)`
      : baseLabel;
  return { fiscalYear: fy, fiscalPeriod: rawFp, periodLabel };
}

export function selectCurrentSecXbrlFact(params: {
  factsPayload: SecCompanyFactsPayload;
  header: SecSubmissionHeaderInput;
  asOfMs: number;
  preferredConceptName?: string;
  preferredSpan?: SecXbrlPeriodSpanKind;
}): SelectedSecXbrlFactResult {
  const { factsPayload, header, asOfMs, preferredConceptName, preferredSpan } = params;
  const asOfDateIso = new Date(asOfMs).toISOString().slice(0, 10);

  const emptyFailure = (
    reason: string,
    overrides: Partial<SelectedSecXbrlFactResult> = {},
  ): SelectedSecXbrlFactResult => ({
    eligible: false,
    isCurrentReportingPeriod: false,
    isAmendment: AMENDMENT_FORMS.has(header.form),
    accessionMatched: false,
    pointInTimeEligible: true,
    hasConflictingDuplicate: false,
    deduplicatedExactDuplicatesCount: 0,
    rejectionReason: reason,
    conceptName: null,
    conceptTiming: null,
    periodSpanKind: null,
    metricKind: null,
    unit: 'USD',
    val: null,
    valueBillions: null,
    isNegativeValue: false,
    isZeroValue: false,
    periodLabel: null,
    fiscalYear: null,
    fiscalPeriod: null,
    reportingFrame: null,
    periodStart: null,
    periodEnd: null,
    form: header.form,
    accession: header.accession,
    filed: header.filed,
    ...overrides,
  });

  // Rule 1: Point-in-time check on BOTH publication (`publishedMs` / `filed`) and receipt (`receivedMs`)
  const headerFiledMs = parseIsoDateMs(header.filed);
  if (
    (Number.isFinite(header.publishedMs) && header.publishedMs > asOfMs) ||
    (headerFiledMs !== null && header.filed > asOfDateIso)
  ) {
    return emptyFailure(
      `filing_after_point_in_time_cutoff:${header.filed}>${asOfDateIso}`,
      { pointInTimeEligible: false },
    );
  }
  if (
    typeof header.receivedMs === 'number' &&
    Number.isFinite(header.receivedMs) &&
    header.receivedMs > asOfMs
  ) {
    return emptyFailure(
      `receipt_after_point_in_time_cutoff:${header.receivedMs}>${asOfMs}`,
      { pointInTimeEligible: false },
    );
  }

  // Rule 2: Form eligibility — never misattribute a 10-Q/10-K fact to an 8-K submission
  if (!ELIGIBLE_PERIODIC_FORMS.has(header.form)) {
    return emptyFailure(`unsupported_non_periodic_form:${header.form}`, {
      isAmendment: false,
    });
  }

  const gaap = factsPayload.facts?.['us-gaap'] ?? {};
  const dei = factsPayload.facts?.dei ?? {};

  const descriptorsToSearch = preferredConceptName
    ? [
        ...DEFAULT_CONCEPT_PRIORITY.filter((d) => d.name === preferredConceptName),
        ...(DEFAULT_CONCEPT_PRIORITY.some((d) => d.name === preferredConceptName)
          ? []
          : [
              {
                namespace: 'us-gaap' as const,
                name: preferredConceptName,
                kind: 'operating income (loss)' as const,
                timing: 'duration' as const,
                unit: 'USD' as const,
                allowNegative: true,
              },
            ]),
      ]
    : DEFAULT_CONCEPT_PRIORITY;

  const candidateDescriptors: Array<{
    descriptor: ConceptCandidateDescriptor;
    units: RawSecCompanyFactUnit[];
  }> = [];

  for (const desc of descriptorsToSearch) {
    const bucket = desc.namespace === 'dei' ? dei[desc.name] : gaap[desc.name];
    const unitArr = bucket?.units?.[desc.unit];
    if (Array.isArray(unitArr) && unitArr.length > 0) {
      candidateDescriptors.push({ descriptor: desc, units: unitArr });
    }
  }

  if (candidateDescriptors.length === 0) {
    return emptyFailure('no_eligible_usd_xbrl_concept');
  }

  const evaluateConceptCandidate = (chosen: {
    descriptor: ConceptCandidateDescriptor;
    units: RawSecCompanyFactUnit[];
  }): SelectedSecXbrlFactResult => {
    const { descriptor } = chosen;

    // Rule 3: Filter to valid periodic facts eligible at `asOfDateIso`
    // Supports zero (`val === 0`) and negative (`val < 0`) when `descriptor.allowNegative` is true.
    // For `instant` concepts, `start` must be absent/undefined; for `duration` concepts, `end` is required.
    const validUnits = chosen.units.filter((u) => {
      if (typeof u.val !== 'number' || !Number.isFinite(u.val)) return false;
      if (!descriptor.allowNegative && u.val < 0) return false;
      if (typeof u.form !== 'string' || !ELIGIBLE_PERIODIC_FORMS.has(u.form)) return false;
      if (typeof u.filed !== 'string' || u.filed > asOfDateIso) return false;
      if (typeof u.end !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(u.end)) return false;
      if (descriptor.timing === 'instant' && u.start) return false;
      return true;
    });

    if (validUnits.length === 0) {
      return emptyFailure('no_valid_periodic_facts_with_end_date', {
        conceptName: descriptor.name,
        conceptTiming: descriptor.timing,
        metricKind: descriptor.kind,
        unit: descriptor.unit,
      });
    }

    // Rule 4: Accession binding — prefer facts belonging to `header.accession`
    const matchingAccessionUnits = validUnits.filter((u) => u.accn === header.accession);
    const rawCandidatePool =
      matchingAccessionUnits.length > 0 ? matchingAccessionUnits : validUnits;
    const accessionMatched = matchingAccessionUnits.length > 0;

    // Rule 5: Deduplicate exact duplicates & detect conflicting values for the same period/frame/accession
    const bySlotKey = new Map<
      string,
      { representative: RawSecCompanyFactUnit; distinctVals: Set<number>; count: number }
    >();
    let deduplicatedExactDuplicatesCount = 0;

    for (const u of rawCandidatePool) {
      const slotKey = `${u.accn ?? ''}|${u.form ?? ''}|${u.filed ?? ''}|${u.start ?? 'INSTANT'}|${u.end ?? ''}|${u.frame ?? ''}`;
      const existing = bySlotKey.get(slotKey);
      if (!existing) {
        bySlotKey.set(slotKey, {
          representative: u,
          distinctVals: new Set([u.val!]),
          count: 1,
        });
      } else {
        existing.count += 1;
        if (existing.distinctVals.has(u.val!)) {
          deduplicatedExactDuplicatesCount += 1;
        } else {
          existing.distinctVals.add(u.val!);
        }
      }
    }

    const deduplicatedPool = [...bySlotKey.values()].map((entry) => entry.representative);

    // Rule 6: Deterministic multi-key sort to prevent comparative historical rows (e.g. 2017/2020)
    // from beating the current reporting period (2026) within the same filing!
    const sorted = [...deduplicatedPool].sort((a, b) => {
      // 1. If not restricted to a single accession, newest filing date first
      if (!accessionMatched) {
        const filedCmp = String(b.filed ?? '').localeCompare(String(a.filed ?? ''));
        if (filedCmp !== 0) return filedCmp;
      }
      // 2. Latest period end date (`end`) first — crucial to beat comparative prior-year rows!
      const endCmp = String(b.end ?? '').localeCompare(String(a.end ?? ''));
      if (endCmp !== 0) return endCmp;

      // 3. Prefer single-quarter 3M frame/duration over 6M/9M cumulative YTD spans on 10-Q (or caller's preferredSpan)
      const aSpan = classifySecFactPeriodSpan(a, descriptor.timing);
      const bSpan = classifySecFactPeriodSpan(b, descriptor.timing);
      const aPref = spanPreferenceRank(aSpan, a.form, preferredSpan);
      const bPref = spanPreferenceRank(bSpan, b.form, preferredSpan);
      if (bPref !== aPref) return bPref - aPref;

      // 4. Prefer explicit calendar/reporting frame over unframed rows when period spans are equal
      const aHasFrame = Boolean(a.frame) ? 1 : 0;
      const bHasFrame = Boolean(b.frame) ? 1 : 0;
      if (bHasFrame !== aHasFrame) return bHasFrame - aHasFrame;

      // 5. Prefer amended filings (`10-Q/A`, `10-K/A`) over original filings for the same period end
      const aAmend = a.form && AMENDMENT_FORMS.has(a.form) ? 1 : 0;
      const bAmend = b.form && AMENDMENT_FORMS.has(b.form) ? 1 : 0;
      if (bAmend !== aAmend) return bAmend - aAmend;

      // 6. Latest filing date (`filed`) tie-breaker (e.g. restatement filed later)
      const filedTie = String(b.filed ?? '').localeCompare(String(a.filed ?? ''));
      if (filedTie !== 0) return filedTie;

      // 7. Fiscal year descending
      return (b.fy ?? 0) - (a.fy ?? 0);
    });

    const best = sorted[0]!;
    const bestSlotKey = `${best.accn ?? ''}|${best.form ?? ''}|${best.filed ?? ''}|${best.start ?? 'INSTANT'}|${best.end ?? ''}|${best.frame ?? ''}`;
    const bestSlotMeta = bySlotKey.get(bestSlotKey);
    const hasConflictingDuplicate = Boolean(bestSlotMeta && bestSlotMeta.distinctVals.size > 1);

    const bestSpanKind = classifySecFactPeriodSpan(best, descriptor.timing);
    const bestEndMs = parseIsoDateMs(best.end);
    const bestFiledMs = parseIsoDateMs(best.filed);

    const fallbackYear = Number((best.filed ?? header.filed).slice(0, 4));
    const { fiscalYear, fiscalPeriod, periodLabel } = formatFiscalPeriodLabel(
      best,
      fallbackYear,
      bestSpanKind,
    );
    const val = best.val ?? 0;
    const valueBillions = Number((val / 1e9).toFixed(4)) === 0
      ? Number((val / 1e9).toFixed(2))
      : Number((val / 1e9).toFixed(2));
    const effectiveForm = best.form ?? header.form;
    const effectiveAccession = best.accn ?? header.accession;
    const effectiveFiled = best.filed ?? header.filed;

    if (hasConflictingDuplicate) {
      return {
        eligible: false,
        isCurrentReportingPeriod: false,
        isAmendment: AMENDMENT_FORMS.has(effectiveForm),
        accessionMatched,
        pointInTimeEligible: true,
        hasConflictingDuplicate: true,
        deduplicatedExactDuplicatesCount,
        rejectionReason: `conflicting_duplicate_facts_for_same_period:${best.end}`,
        conceptName: descriptor.name,
        conceptTiming: descriptor.timing,
        periodSpanKind: bestSpanKind,
        metricKind: descriptor.kind,
        unit: descriptor.unit,
        val: null,
        valueBillions: null,
        isNegativeValue: false,
        isZeroValue: false,
        periodLabel,
        fiscalYear,
        fiscalPeriod,
        reportingFrame: best.frame ?? null,
        periodStart: best.start ?? null,
        periodEnd: best.end ?? null,
        form: effectiveForm,
        accession: effectiveAccession,
        filed: effectiveFiled,
      };
    }

    // Rule 7: Verify that the selected fact's `end` date is a current reporting period for THAT filing
    // (checking both the fact's own `filed` date AND `header.filed` so an obsolete XBRL tag last reported
    // in 2017 or 2020 is never accepted as current for a 2026 submission header!).
    const factLagDays =
      bestEndMs !== null && bestFiledMs !== null
        ? Math.round((bestFiledMs - bestEndMs) / 86_400_000)
        : Infinity;
    const headerLagDays =
      bestEndMs !== null && headerFiledMs !== null
        ? Math.round((headerFiledMs - bestEndMs) / 86_400_000)
        : factLagDays;
    const lagDays = Math.max(factLagDays, headerLagDays);

    const reportDateMs = parseIsoDateMs(header.reportDate ?? null);
    const reportDateMismatch =
      accessionMatched &&
      reportDateMs !== null &&
      bestEndMs !== null &&
      Math.abs(bestEndMs - reportDateMs) > 15 * 86_400_000;

    const isCurrentReportingPeriod =
      factLagDays >= -5 &&
      factLagDays <= MAX_PERIOD_END_TO_FILED_DAYS &&
      headerLagDays >= -5 &&
      headerLagDays <= MAX_PERIOD_END_TO_FILED_DAYS &&
      !reportDateMismatch;

    if (!isCurrentReportingPeriod) {
      return {
        eligible: false,
        isCurrentReportingPeriod: false,
        isAmendment: AMENDMENT_FORMS.has(effectiveForm),
        accessionMatched,
        pointInTimeEligible: true,
        hasConflictingDuplicate: false,
        deduplicatedExactDuplicatesCount,
        rejectionReason: reportDateMismatch
          ? `period_end_mismatch_with_report_date:${best.end}!=${header.reportDate}`
          : `historical_comparative_period_rejected:end=${best.end},filed=${effectiveFiled},headerFiled=${header.filed},lagDays=${lagDays}`,
        conceptName: descriptor.name,
        conceptTiming: descriptor.timing,
        periodSpanKind: bestSpanKind,
        metricKind: descriptor.kind,
        unit: descriptor.unit,
        val,
        valueBillions,
        isNegativeValue: val < 0,
        isZeroValue: val === 0,
        periodLabel,
        fiscalYear,
        fiscalPeriod,
        reportingFrame: best.frame ?? null,
        periodStart: best.start ?? null,
        periodEnd: best.end ?? null,
        form: effectiveForm,
        accession: effectiveAccession,
        filed: effectiveFiled,
      };
    }

    return {
      eligible: true,
      isCurrentReportingPeriod: true,
      isAmendment: AMENDMENT_FORMS.has(effectiveForm),
      accessionMatched,
      pointInTimeEligible: true,
      hasConflictingDuplicate: false,
      deduplicatedExactDuplicatesCount,
      rejectionReason: null,
      conceptName: descriptor.name,
      conceptTiming: descriptor.timing,
      periodSpanKind: bestSpanKind,
      metricKind: descriptor.kind,
      unit: descriptor.unit,
      val,
      valueBillions,
      isNegativeValue: val < 0,
      isZeroValue: val === 0,
      periodLabel,
      fiscalYear,
      fiscalPeriod,
      reportingFrame: best.frame ?? null,
      periodStart: best.start ?? null,
      periodEnd: best.end ?? null,
      form: effectiveForm,
      accession: effectiveAccession,
      filed: effectiveFiled,
    };
  };

  const evaluatedCandidates = candidateDescriptors.map(evaluateConceptCandidate);
  // 1. Prefer the highest-priority concept that is eligible AND matches the submission accession
  const accessionMatchedEligible = evaluatedCandidates.find(
    (c) => c.eligible && c.accessionMatched,
  );
  if (accessionMatchedEligible) return accessionMatchedEligible;

  // 2. Otherwise prefer the highest-priority concept that is eligible for the current reporting period
  const anyEligible = evaluatedCandidates.find((c) => c.eligible);
  if (anyEligible) return anyEligible;

  // 3. If none are eligible (e.g. comparative-only or conflicting duplicate), return the first candidate's diagnostic failure
  return evaluatedCandidates[0]!;
}
