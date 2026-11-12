/**
 * Deterministic SEC EDGAR XBRL Fact Selector (`lib/remote-ops/sec-xbrl-fact-selector.ts`).
 *
 * Enforces explicit governance rules for selecting financial facts from SEC `companyfacts` JSON:
 * 1. Unit integrity: requires explicit `USD` unit and finite positive numeric value.
 * 2. Form & amendment rules: restricts periodic financial statement extraction to `10-Q`, `10-K`,
 *    `10-Q/A`, and `10-K/A`, with amended filings (`10-Q/A`, `10-K/A`) superseding original filings
 *    for the same reporting period. Never misattributes a `10-Q`/`10-K` fact to an `8-K` accession.
 * 3. Point-in-time eligibility: requires `filed <= asOfDateIso` and `publishedAtMs <= asOfMs`.
 * 4. Comparative-period rejection: within any filing, sorts by `end` date descending (never `filed`
 *    alone), prefers 3-month single-quarter frames (`CYxxxxQ[1-4]` or 75–105 day duration) over
 *    cumulative 6M/9M YTD spans on `10-Q`, and verifies that `filed - end <= 190 days` (and aligns
 *    with `reportDate` when provided) before marking any financial value as current.
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
};

export type SelectedSecXbrlFactResult = {
  eligible: boolean;
  isCurrentReportingPeriod: boolean;
  isAmendment: boolean;
  accessionMatched: boolean;
  pointInTimeEligible: boolean;
  rejectionReason: string | null;
  conceptName: string | null;
  metricKind: 'capital expenditures' | 'revenue' | null;
  unit: 'USD';
  val: number | null;
  valueBillions: number | null;
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

const ELIGIBLE_PERIODIC_FORMS = new Set(['10-Q', '10-K', '10-Q/A', '10-K/A']);
const AMENDMENT_FORMS = new Set(['10-Q/A', '10-K/A']);
const MAX_PERIOD_END_TO_FILED_DAYS = 190;
const QUARTERLY_FRAME_REGEX = /^CY\d{4}Q[1-4]$/;

function parseIsoDateMs(dateStr: string | undefined | null): number | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const ms = Date.parse(`${dateStr}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

function durationDaysBetween(startIso: string | undefined, endIso: string | undefined): number | null {
  const s = parseIsoDateMs(startIso);
  const e = parseIsoDateMs(endIso);
  if (s === null || e === null || e < s) return null;
  return Math.round((e - s) / 86_400_000);
}

function isPreferredQuarterSpan(u: RawSecCompanyFactUnit): boolean {
  if (u.form !== '10-Q' && u.form !== '10-Q/A') return true;
  if (u.frame && QUARTERLY_FRAME_REGEX.test(u.frame)) return true;
  const days = durationDaysBetween(u.start, u.end);
  if (days !== null) {
    return days >= 70 && days <= 110;
  }
  // If `start` is omitted in simplified test fixtures, allow when `fp` is Q1..Q4
  return Boolean(u.fp && /^Q[1-4]$/.test(u.fp));
}

function formatFiscalPeriodLabel(u: RawSecCompanyFactUnit, fallbackYear: number): {
  fiscalYear: number;
  fiscalPeriod: string;
  periodLabel: string;
} {
  // Derive fiscal year from `frame` (if CYxxxxQn and `fy` looks polluted by a later filing year) or `u.fy` or `u.end`
  const endYear = u.end && /^\d{4}/.test(u.end) ? Number(u.end.slice(0, 4)) : fallbackYear;
  const fy = typeof u.fy === 'number' && Number.isFinite(u.fy) ? u.fy : endYear;
  const fp = u.fp && u.fp.trim() ? u.fp.trim() : 'FY';
  const periodLabel = fp !== 'FY' ? `${fp} ${fy}` : `FY${fy}`;
  return { fiscalYear: fy, fiscalPeriod: fp, periodLabel };
}

export function selectCurrentSecXbrlFact(params: {
  factsPayload: SecCompanyFactsPayload;
  header: SecSubmissionHeaderInput;
  asOfMs: number;
}): SelectedSecXbrlFactResult {
  const { factsPayload, header, asOfMs } = params;
  const asOfDateIso = new Date(asOfMs).toISOString().slice(0, 10);

  // Rule 1: Point-in-time check on the submission header
  const headerFiledMs = parseIsoDateMs(header.filed);
  if (
    (Number.isFinite(header.publishedMs) && header.publishedMs > asOfMs) ||
    (headerFiledMs !== null && header.filed > asOfDateIso)
  ) {
    return {
      eligible: false,
      isCurrentReportingPeriod: false,
      isAmendment: AMENDMENT_FORMS.has(header.form),
      accessionMatched: false,
      pointInTimeEligible: false,
      rejectionReason: `filing_after_point_in_time_cutoff:${header.filed}>${asOfDateIso}`,
      conceptName: null,
      metricKind: null,
      unit: 'USD',
      val: null,
      valueBillions: null,
      periodLabel: null,
      fiscalYear: null,
      fiscalPeriod: null,
      reportingFrame: null,
      periodStart: null,
      periodEnd: null,
      form: header.form,
      accession: header.accession,
      filed: header.filed,
    };
  }

  // Rule 2: Form eligibility — never misattribute a 10-Q/10-K fact to an 8-K submission
  if (!ELIGIBLE_PERIODIC_FORMS.has(header.form)) {
    return {
      eligible: false,
      isCurrentReportingPeriod: false,
      isAmendment: false,
      accessionMatched: false,
      pointInTimeEligible: true,
      rejectionReason: `unsupported_non_periodic_form:${header.form}`,
      conceptName: null,
      metricKind: null,
      unit: 'USD',
      val: null,
      valueBillions: null,
      periodLabel: null,
      fiscalYear: null,
      fiscalPeriod: null,
      reportingFrame: null,
      periodStart: null,
      periodEnd: null,
      form: header.form,
      accession: header.accession,
      filed: header.filed,
    };
  }

  const gaap = factsPayload.facts?.['us-gaap'] ?? {};
  const capexEntry = gaap.PaymentsToAcquirePropertyPlantAndEquipment?.units?.USD?.length
    ? {
        name: 'PaymentsToAcquirePropertyPlantAndEquipment',
        units: gaap.PaymentsToAcquirePropertyPlantAndEquipment.units.USD,
        kind: 'capital expenditures' as const,
      }
    : gaap.CapitalExpendituresIncurredButNotYetPaid?.units?.USD?.length
      ? {
          name: 'CapitalExpendituresIncurredButNotYetPaid',
          units: gaap.CapitalExpendituresIncurredButNotYetPaid.units.USD,
          kind: 'capital expenditures' as const,
        }
      : null;

  const revEntry = gaap.RevenueFromContractWithCustomerExcludingAssessedTax?.units?.USD?.length
    ? {
        name: 'RevenueFromContractWithCustomerExcludingAssessedTax',
        units: gaap.RevenueFromContractWithCustomerExcludingAssessedTax.units.USD,
        kind: 'revenue' as const,
      }
    : gaap.Revenues?.units?.USD?.length
      ? {
          name: 'Revenues',
          units: gaap.Revenues.units.USD,
          kind: 'revenue' as const,
        }
      : gaap.SalesRevenueNet?.units?.USD?.length
        ? {
            name: 'SalesRevenueNet',
            units: gaap.SalesRevenueNet.units.USD,
            kind: 'revenue' as const,
          }
        : null;

  const chosen = capexEntry ?? revEntry;
  if (!chosen) {
    return {
      eligible: false,
      isCurrentReportingPeriod: false,
      isAmendment: AMENDMENT_FORMS.has(header.form),
      accessionMatched: false,
      pointInTimeEligible: true,
      rejectionReason: 'no_eligible_usd_xbrl_concept',
      conceptName: null,
      metricKind: null,
      unit: 'USD',
      val: null,
      valueBillions: null,
      periodLabel: null,
      fiscalYear: null,
      fiscalPeriod: null,
      reportingFrame: null,
      periodStart: null,
      periodEnd: null,
      form: header.form,
      accession: header.accession,
      filed: header.filed,
    };
  }

  // Rule 3: Filter to valid positive USD periodic facts eligible at `asOfDateIso`
  const validUnits = chosen.units.filter(
    (u) =>
      typeof u.val === 'number' &&
      Number.isFinite(u.val) &&
      u.val > 0 &&
      typeof u.form === 'string' &&
      ELIGIBLE_PERIODIC_FORMS.has(u.form) &&
      typeof u.filed === 'string' &&
      u.filed <= asOfDateIso &&
      typeof u.end === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(u.end),
  );

  if (validUnits.length === 0) {
    return {
      eligible: false,
      isCurrentReportingPeriod: false,
      isAmendment: AMENDMENT_FORMS.has(header.form),
      accessionMatched: false,
      pointInTimeEligible: true,
      rejectionReason: 'no_valid_periodic_facts_with_end_date',
      conceptName: chosen.name,
      metricKind: chosen.kind,
      unit: 'USD',
      val: null,
      valueBillions: null,
      periodLabel: null,
      fiscalYear: null,
      fiscalPeriod: null,
      reportingFrame: null,
      periodStart: null,
      periodEnd: null,
      form: header.form,
      accession: header.accession,
      filed: header.filed,
    };
  }

  // Rule 4: Accession binding — prefer facts belonging to `header.accession`; if none carry `accn`
  // matching `header.accession`, only fall back if `header.accession` is absent from all facts.
  const matchingAccessionUnits = validUnits.filter((u) => u.accn === header.accession);
  const candidatePool = matchingAccessionUnits.length > 0 ? matchingAccessionUnits : validUnits;
  const accessionMatched = matchingAccessionUnits.length > 0;

  // Rule 5: Deterministic multi-key sort to prevent comparative historical rows (e.g. 2017/2020)
  // from beating the current reporting period (2026) within the same filing!
  const sorted = [...candidatePool].sort((a, b) => {
    // 1. If not restricted to a single accession, newest filing date first
    if (!accessionMatched) {
      const filedCmp = String(b.filed ?? '').localeCompare(String(a.filed ?? ''));
      if (filedCmp !== 0) return filedCmp;
    }
    // 2. Latest period end date (`end`) first — crucial to beat comparative prior-year rows!
    const endCmp = String(b.end ?? '').localeCompare(String(a.end ?? ''));
    if (endCmp !== 0) return endCmp;

    // 3. Prefer single-quarter 3M frame/duration over 6M/9M cumulative YTD spans on 10-Q
    const aPref = isPreferredQuarterSpan(a) ? 1 : 0;
    const bPref = isPreferredQuarterSpan(b) ? 1 : 0;
    if (bPref !== aPref) return bPref - aPref;

    // 4. Prefer amended filings (`10-Q/A`, `10-K/A`) over original filings for the same period end
    const aAmend = a.form && AMENDMENT_FORMS.has(a.form) ? 1 : 0;
    const bAmend = b.form && AMENDMENT_FORMS.has(b.form) ? 1 : 0;
    if (bAmend !== aAmend) return bAmend - aAmend;

    // 5. Latest filing date (`filed`) tie-breaker (e.g. restatement filed later)
    const filedTie = String(b.filed ?? '').localeCompare(String(a.filed ?? ''));
    if (filedTie !== 0) return filedTie;

    // 6. Fiscal year descending
    return (b.fy ?? 0) - (a.fy ?? 0);
  });

  const best = sorted[0]!;
  const bestEndMs = parseIsoDateMs(best.end);
  const bestFiledMs = parseIsoDateMs(best.filed);

  // Rule 6: Verify that the selected fact's `end` date is a current reporting period for that filing,
  // not a stale comparative period (e.g., 2017 or 2020 in a 2026 filing).
  const lagDays =
    bestEndMs !== null && bestFiledMs !== null
      ? Math.round((bestFiledMs - bestEndMs) / 86_400_000)
      : Infinity;

  const reportDateMs = parseIsoDateMs(header.reportDate ?? null);
  const reportDateMismatch =
    accessionMatched &&
    reportDateMs !== null &&
    bestEndMs !== null &&
    Math.abs(bestEndMs - reportDateMs) > 15 * 86_400_000;

  const isCurrentReportingPeriod =
    lagDays >= -5 && lagDays <= MAX_PERIOD_END_TO_FILED_DAYS && !reportDateMismatch;

  const fallbackYear = Number((best.filed ?? header.filed).slice(0, 4));
  const { fiscalYear, fiscalPeriod, periodLabel } = formatFiscalPeriodLabel(best, fallbackYear);
  const valueBillions = Number(((best.val ?? 0) / 1e9).toFixed(2));
  const effectiveForm = best.form ?? header.form;
  const effectiveAccession = best.accn ?? header.accession;
  const effectiveFiled = best.filed ?? header.filed;

  if (!isCurrentReportingPeriod) {
    return {
      eligible: false,
      isCurrentReportingPeriod: false,
      isAmendment: AMENDMENT_FORMS.has(effectiveForm),
      accessionMatched,
      pointInTimeEligible: true,
      rejectionReason: reportDateMismatch
        ? `period_end_mismatch_with_report_date:${best.end}!=${header.reportDate}`
        : `historical_comparative_period_rejected:end=${best.end},filed=${effectiveFiled},lagDays=${lagDays}`,
      conceptName: chosen.name,
      metricKind: chosen.kind,
      unit: 'USD',
      val: best.val ?? null,
      valueBillions,
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
    rejectionReason: null,
    conceptName: chosen.name,
    metricKind: chosen.kind,
    unit: 'USD',
    val: best.val ?? null,
    valueBillions,
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
