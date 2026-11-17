/**
 * Sprint G9.2 — evidence integrity rules shared by the staging validator, the quarantine ledger and tests.
 *
 * Root cause addressed: SEC companyfacts rows carry the accession of every filing that *re-reports* a value, including
 * prior-year comparative columns. A selector that sorted by `filed` across concepts promoted decade-old or prior-year
 * comparative capex values (e.g. NVDA "Q2 2020", AMZN "Q1 2017", AMD/INTC/GOOGL/MSFT 2025 comparatives) as the
 * current period of a 2026 filing. These rules make that class of claim impossible to promote, independently of the
 * selector that produced it.
 */

/** Periodic reports whose financial-statement facts can be promoted as current-period evidence. */
const PERIODIC_FORMS = new Set(['10-Q', '10-K', '10-Q/A', '10-K/A']);

/** Max days between a reporting period end and its filing date for the fact to count as the filing's current period. */
export const MAX_FILING_LAG_DAYS = 190;

const DAY_MS = 86_400_000;

export type SecClaimIntegrityVerdict =
  | { status: 'ok'; filingAccession: string; citedForm: string; periodEnd: string; filed: string }
  | { status: 'pending'; reasonCode: string; detail: string }
  | { status: 'reject'; reasonCode: string; detail: string };

/** Extracts the accession (`##########-##-######`) from an EDGAR Archives document URL, or null. */
export function accessionFromSecArchiveUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /sec\.gov\/Archives\/edgar\/data\/\d+\/(\d{18})\//i.exec(url);
  if (!m) return null;
  const d = m[1];
  return `${d.slice(0, 10)}-${d.slice(10, 12)}-${d.slice(12)}`;
}

export function isSecArchiveUrl(url: string | null | undefined): boolean {
  return accessionFromSecArchiveUrl(url) !== null;
}

const MONTHS: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

/** "September 30, 2026" → "2026-09-30"; null when not a full English month date. */
function longDateToIso(text: string | null): string | null {
  if (!text) return null;
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const mm = MONTHS[m[1].toLowerCase()];
  return mm ? `${m[3]}-${mm}-${m[2].padStart(2, '0')}` : null;
}

function firstMatch(re: RegExp, texts: string[]): string | null {
  for (const t of texts) {
    const m = re.exec(t);
    if (m) return m[1];
  }
  return null;
}

/**
 * Assesses whether a claim derived from an SEC filing can be promoted as current-period evidence for that filing.
 *
 * - `reject`: the claim cites a different accession than the filing URL it is attached to, its reporting period ends
 *   after the filing date, the period ended more than {@link MAX_FILING_LAG_DAYS} days before the filing (a prior-year
 *   comparative or obsolete fact), or its period label names a year earlier than the filing's prior fiscal year.
 * - `pending`: the claim cannot be bound to a periodic report (8-K or no form cited) or carries no explicit period end,
 *   so it must not promote until a human or a stricter extractor verifies it.
 * - `ok`: all bindings verified.
 */
export function assessSecFilingClaimIntegrity(input: {
  sourceUrl: string;
  title: string;
  text: string;
  claim: { period: string; excerpt?: string | null };
  /** Filing acceptance time; used as the filing date when the text does not state one. */
  publishedAtMs?: number | null;
}): SecClaimIntegrityVerdict {
  const filingAccession = accessionFromSecArchiveUrl(input.sourceUrl);
  if (!filingAccession) {
    return { status: 'pending', reasonCode: 'sec_url_without_accession', detail: 'Source is not an EDGAR Archives filing URL.' };
  }
  const texts = [input.title, input.text, input.claim.excerpt ?? ''];

  const citedAccessions = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(/\b(\d{10}-\d{2}-\d{6})\b/g)) citedAccessions.add(m[1]);
  const foreign = [...citedAccessions].filter((a) => a !== filingAccession);
  if (foreign.length > 0) {
    return {
      status: 'reject',
      reasonCode: 'sec_accession_mismatch',
      detail: `Claim cites accession ${foreign.join(', ')} but is attached to filing ${filingAccession}.`,
    };
  }

  const citedForm = firstMatch(/\bForm\s+(10-Q\/A|10-K\/A|10-Q|10-K|8-K\/A|8-K|S-1\/A|S-1)\b/i, texts)?.toUpperCase() ?? null;
  if (!citedForm || !PERIODIC_FORMS.has(citedForm)) {
    return {
      status: 'pending',
      reasonCode: 'sec_periodic_report_required',
      detail: `Financial-statement facts promote only from 10-Q/10-K filings; cited form: ${citedForm ?? 'none'}.`,
    };
  }

  const filed =
    firstMatch(/\bfiled\s+(\d{4}-\d{2}-\d{2})\b/i, texts) ??
    (input.publishedAtMs != null && Number.isFinite(input.publishedAtMs)
      ? new Date(input.publishedAtMs).toISOString().slice(0, 10)
      : null);
  const periodEnd =
    firstMatch(/\bperiod\s+ended\s+(\d{4}-\d{2}-\d{2})\b/i, texts) ??
    longDateToIso(firstMatch(/\bperiod\s+ended\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/, texts));
  if (!filed || !periodEnd) {
    return {
      status: 'pending',
      reasonCode: 'sec_period_end_missing',
      detail: 'Claim does not state both the filing date and the reporting period end; cannot prove it is the current period.',
    };
  }
  const filedMs = Date.parse(`${filed}T00:00:00Z`);
  const endMs = Date.parse(`${periodEnd}T00:00:00Z`);
  if (!Number.isFinite(filedMs) || !Number.isFinite(endMs)) {
    return { status: 'pending', reasonCode: 'sec_unparseable_dates', detail: `Unparseable dates filed=${filed} periodEnd=${periodEnd}.` };
  }
  if (endMs > filedMs) {
    return { status: 'reject', reasonCode: 'sec_period_after_filing', detail: `Period end ${periodEnd} is after filing date ${filed}.` };
  }
  const lagDays = Math.round((filedMs - endMs) / DAY_MS);
  if (lagDays > MAX_FILING_LAG_DAYS) {
    return {
      status: 'reject',
      reasonCode: 'sec_comparative_or_obsolete_period',
      detail: `Period ended ${periodEnd}, ${lagDays} days before filing ${filed} (> ${MAX_FILING_LAG_DAYS}); this is a comparative or obsolete fact, not the filing's current period.`,
    };
  }

  const filedYear = Number(filed.slice(0, 4));
  const labelYears = [...input.claim.period.matchAll(/(19|20)\d{2}/g)].map((m) => Number(m[0]));
  const staleLabel = labelYears.find((y) => y < filedYear - 1);
  if (staleLabel !== undefined) {
    return {
      status: 'reject',
      reasonCode: 'sec_comparative_or_obsolete_period',
      detail: `Claim period label "${input.claim.period}" names ${staleLabel}, more than one year before filing year ${filedYear}.`,
    };
  }

  return { status: 'ok', filingAccession, citedForm, periodEnd, filed };
}

/** True when a staging item or evidence row has been placed in quarantine. */
export function isQuarantined(doc: { quarantinedAt?: number | null }): boolean {
  return typeof doc.quarantinedAt === 'number';
}

/** Fact identifier the briefing generator uses for SEC-derived facts (`fact-<TICKER>-<accession>`). */
export function briefingFactIdFor(ticker: string, accession: string): string {
  return `fact-${ticker}-${accession}`;
}

/** Deterministic, idempotent quarantine key for one staging item. */
export function quarantineKeyFor(stagingExternalId: string): string {
  return `quarantine:${stagingExternalId}`;
}
