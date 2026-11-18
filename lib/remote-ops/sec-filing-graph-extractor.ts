import {
  type GraphInstrument,
  type GraphObservation,
  type GraphOrganisation,
  type GraphSector,
  type GraphSourceDocument,
  type MacroRelationship,
} from '../graph/contracts';
import {
  selectCurrentSecXbrlFact,
  type SecCompanyFactsPayload,
  type SecSubmissionHeaderInput,
} from './sec-xbrl-fact-selector';
import { sha256Hex } from './staging-validator';

/**
 * RC002 Workstream C (B-004) — General-Purpose Deterministic SEC Discovery & Graph Candidate Extractor.
 *
 * Capabilities:
 * 1. Bounded multi-filing SEC EDGAR submission discovery (`discoverSecFilingWindow`) beyond `recent[0]`,
 *    with persistent accession/URL deduplication and safe pagination across EDGAR `filings.files` overflow JSONs.
 * 2. Deterministic periodic XBRL (`10-Q`, `10-K`, `10-Q/A`, `10-K/A`) current-period `GraphObservation` extraction
 *    across revenue, operating income, net income, operating cash flow, capital expenditures, and cash.
 * 3. Deterministic Form `13F-HR` / `13F-HR/A` `information_table.xml` parser emitting verified `GraphSourceDocument`,
 *    portfolio `GraphObservation`, prerequisite `GraphOrganisation`/`GraphInstrument` records, and `pending_review`
 *    `ownership_stake` `MacroRelationship` candidates (enforcing human review before promotion).
 * 4. Deterministic Form `8-K` / `8-K/A` item-type registration (`Items 1.01, 2.02, 2.03, 5.02, 8.01`, etc.) as
 *    review candidates WITHOUT inferring contractual principal amounts or counterparties from unstructured prose.
 */

export interface EdgarSubmissionTabularBlock {
  accessionNumber?: string[];
  filingDate?: string[];
  reportDate?: string[];
  acceptanceDateTime?: string[];
  form?: string[];
  primaryDocument?: string[];
  primaryDocDescription?: string[];
  items?: Array<string | string[]>;
}

export interface EdgarSubmissionsPayload {
  cik?: string;
  name?: string;
  tickers?: string[];
  filings?: {
    recent?: EdgarSubmissionTabularBlock;
    files?: Array<{ name: string; filingCount?: number; filingFrom?: string; filingTo?: string }>;
  };
}

export interface DiscoveredSecFilingHeader extends SecSubmissionHeaderInput {
  primaryDocDescription: string | null;
  secItems: string[];
  sourcePage: 'recent' | string;
}

const DEFAULT_ALLOWED_DISCOVERY_FORMS = new Set([
  '10-Q',
  '10-K',
  '10-Q/A',
  '10-K/A',
  '13F-HR',
  '13F-HR/A',
  '8-K',
  '8-K/A',
  'SC 13G',
  'SC 13G/A',
  'SC 13D',
  'SC 13D/A',
  'S-1',
  'S-1/A',
]);

function parseEdgarItemsField(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x).trim()).filter(Boolean);
  }
  return String(raw)
    .split(/[,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Scans a bounded window of SEC EDGAR submissions beyond `recent[0]`, supporting:
 * - Persistent accession & URL deduplication (`seenAccessions`, `seenUrls`) so routine Form 4 / 8-K filings
 *   at `recent[0]` never mask periodic `10-Q`/`10-K` or `13F-HR` filings deeper in the window.
 * - Optional filing date cutoff (`minFilingDateIso`, `maxFilingDateIso`).
 * - Safe bounded pagination into `sub.filings.files` overflow JSON blocks (`maxOverflowPages`, default `1`, max `3`).
 */
export async function discoverSecFilingWindow(params: {
  ticker: string;
  cik: string;
  entityName: string;
  submissions: EdgarSubmissionsPayload;
  maxFilingsPerCik?: number;
  allowedForms?: ReadonlySet<string>;
  seenAccessions?: ReadonlySet<string>;
  seenUrls?: ReadonlySet<string>;
  minFilingDateIso?: string;
  maxFilingDateIso?: string;
  maxOverflowPages?: number;
  fetchOverflowPage?: (fileName: string) => Promise<EdgarSubmissionTabularBlock | null>;
}): Promise<{
  discovered: DiscoveredSecFilingHeader[];
  skippedDuplicateCount: number;
  skippedFormCount: number;
  overflowPagesFetched: number;
}> {
  const maxFilings = Math.min(Math.max(params.maxFilingsPerCik ?? 25, 1), 100);
  const maxOverflowPages = Math.min(Math.max(params.maxOverflowPages ?? 1, 0), 3);
  const allowedForms = params.allowedForms ?? DEFAULT_ALLOWED_DISCOVERY_FORMS;
  const seenAcc = new Set(params.seenAccessions ?? []);
  const seenUrl = new Set(params.seenUrls ?? []);
  const cikNumeric = String(Number(params.cik));

  const discovered: DiscoveredSecFilingHeader[] = [];
  let skippedDuplicateCount = 0;
  let skippedFormCount = 0;
  let overflowPagesFetched = 0;

  const scanBlock = (block: EdgarSubmissionTabularBlock | undefined, sourcePage: string) => {
    const accList = block?.accessionNumber ?? [];
    const formList = block?.form ?? [];
    const filedList = block?.filingDate ?? [];
    const len = Math.min(accList.length, formList.length, filedList.length);

    for (let i = 0; i < len; i += 1) {
      if (discovered.length >= maxFilings) return;

      const form = (formList[i] ?? '').trim().toUpperCase();
      if (!allowedForms.has(form)) {
        skippedFormCount += 1;
        continue;
      }

      const accession = (accList[i] ?? '').trim();
      const filed = (filedList[i] ?? '').trim();
      if (!/^\d{10}-\d{2}-\d{6}$/.test(accession) || !/^\d{4}-\d{2}-\d{2}$/.test(filed)) {
        continue;
      }
      if (params.minFilingDateIso && filed < params.minFilingDateIso) {
        continue;
      }
      if (params.maxFilingDateIso && filed > params.maxFilingDateIso) {
        continue;
      }

      const accessionNoHyphens = accession.replace(/-/g, '');
      const primaryDoc = block?.primaryDocument?.[i]?.trim() || `${accession}.txt`;
      const docUrl = `https://www.sec.gov/Archives/edgar/data/${cikNumeric}/${accessionNoHyphens}/${primaryDoc}`;

      if (seenAcc.has(accession) || seenUrl.has(docUrl)) {
        skippedDuplicateCount += 1;
        continue;
      }
      seenAcc.add(accession);
      seenUrl.add(docUrl);

      const reportDate = block?.reportDate?.[i]?.trim() || null;
      const acceptanceDateTime = block?.acceptanceDateTime?.[i]?.trim() || null;
      const acceptedMs = acceptanceDateTime ? Date.parse(acceptanceDateTime) : NaN;
      const publishedMs = Number.isFinite(acceptedMs)
        ? acceptedMs
        : Date.parse(`${filed}T16:00:00Z`);

      discovered.push({
        ticker: params.ticker,
        cik: params.cik.padStart(10, '0'),
        name: params.entityName,
        accession,
        form,
        filed,
        reportDate,
        acceptanceDateTime,
        docUrl,
        publishedMs,
        primaryDocDescription: block?.primaryDocDescription?.[i]?.trim() || null,
        secItems: parseEdgarItemsField(block?.items?.[i]),
        sourcePage,
      });
    }
  };

  scanBlock(params.submissions.filings?.recent, 'recent');

  const overflowFiles = params.submissions.filings?.files ?? [];
  if (
    discovered.length < maxFilings &&
    params.fetchOverflowPage &&
    overflowFiles.length > 0 &&
    maxOverflowPages > 0
  ) {
    for (const fileMeta of overflowFiles.slice(0, maxOverflowPages)) {
      if (discovered.length >= maxFilings) break;
      if (!fileMeta?.name || !/^CIK\d+-submissions-\d+\.json$/i.test(fileMeta.name)) {
        continue;
      }
      const block = await params.fetchOverflowPage(fileMeta.name);
      overflowPagesFetched += 1;
      if (block) {
        scanBlock(block, fileMeta.name);
      }
    }
  }

  return {
    discovered,
    skippedDuplicateCount,
    skippedFormCount,
    overflowPagesFetched,
  };
}

const PERIODIC_EXTRACTION_METRICS: ReadonlyArray<{
  conceptNames: readonly string[];
  metricNamePrefix: string;
  accountingBasis: string;
}> = [
  {
    conceptNames: [
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'Revenues',
      'SalesRevenueNet',
    ],
    metricNamePrefix: 'revenue_gaap',
    accountingBasis: 'US_GAAP_SEC_XBRL',
  },
  {
    conceptNames: ['OperatingIncomeLoss'],
    metricNamePrefix: 'operating_income_gaap',
    accountingBasis: 'US_GAAP_SEC_XBRL',
  },
  {
    conceptNames: ['NetIncomeLoss'],
    metricNamePrefix: 'net_income_gaap',
    accountingBasis: 'US_GAAP_SEC_XBRL',
  },
  {
    conceptNames: ['NetCashProvidedByUsedInOperatingActivities'],
    metricNamePrefix: 'operating_cash_flow_gaap',
    accountingBasis: 'US_GAAP_SEC_XBRL_Cash_Flow',
  },
  {
    conceptNames: [
      'PaymentsToAcquirePropertyPlantAndEquipment',
      'PaymentsToAcquireProductiveAssets',
    ],
    metricNamePrefix: 'capital_expenditures_gaap',
    accountingBasis: 'US_GAAP_SEC_XBRL_Cash_Flow',
  },
  {
    conceptNames: ['CashAndCashEquivalentsAtCarryingValue'],
    metricNamePrefix: 'cash_and_equivalents_gaap',
    accountingBasis: 'US_GAAP_SEC_XBRL_Balance_Sheet',
  },
];

/**
 * Deterministic periodic XBRL (`10-Q`/`10-K`) extractor producing verified `GraphSourceDocument`
 * and `GraphObservation[]` strictly for facts matching the filing's current reporting period & accession.
 */
export function extractPeriodicXbrlGraphCandidates(params: {
  header: DiscoveredSecFilingHeader;
  factsPayload: SecCompanyFactsPayload;
  subjectOrg: GraphOrganisation;
  contentSha256?: string;
  receivedAtMs: number;
  ingestedAtMs?: number;
}): {
  sourceDocument: GraphSourceDocument;
  observations: GraphObservation[];
  rejectedConcepts: Array<{ concept: string; reason: string }>;
} {
  const { header, factsPayload, subjectOrg, receivedAtMs } = params;
  const ingestedAtMs = params.ingestedAtMs ?? receivedAtMs;
  const accSlug = header.accession.replace(/-/g, '');
  const sourceDocId = `doc-sec-${header.ticker.toLowerCase()}-${header.form.toLowerCase().replace(/[^a-z0-9]/g, '')}-${accSlug}`;
  const contentSha256 =
    params.contentSha256 ??
    sha256Hex(`${header.docUrl}|${header.accession}|${header.filed}|${JSON.stringify(factsPayload.cik ?? header.cik)}`);

  const sourceDocument: GraphSourceDocument = {
    sourceDocId,
    title: `${header.name} (${header.ticker}) SEC Form ${header.form} (${header.accession}, filed ${header.filed})`,
    url: header.docUrl,
    kind: 'filing',
    authority: 'primary',
    contentSha256,
    publicationBasis: 'sec_edgar_acceptance',
    publishedAtMs: header.publishedMs,
    receivedAtMs: Math.max(receivedAtMs, header.publishedMs),
    ingestedAtMs: Math.max(ingestedAtMs, receivedAtMs, header.publishedMs),
  };

  const observations: GraphObservation[] = [];
  const rejectedConcepts: Array<{ concept: string; reason: string }> = [];

  for (const spec of PERIODIC_EXTRACTION_METRICS) {
    let matchedFact = null;
    for (const conceptName of spec.conceptNames) {
      const sel = selectCurrentSecXbrlFact({
        factsPayload,
        header,
        asOfMs: Math.max(receivedAtMs, header.publishedMs),
        preferredConceptName: conceptName,
      });
      if (
        sel.eligible &&
        sel.isCurrentReportingPeriod &&
        sel.accessionMatched &&
        sel.conceptName === conceptName &&
        sel.val !== null &&
        sel.periodEnd
      ) {
        matchedFact = sel;
        break;
      }
      if (sel.rejectionReason) {
        rejectedConcepts.push({ concept: conceptName, reason: sel.rejectionReason });
      }
    }

    if (!matchedFact || matchedFact.val === null || !matchedFact.periodEnd) {
      continue;
    }

    const endMs = Date.parse(`${matchedFact.periodEnd}T23:59:59.000Z`);
    const startMs = matchedFact.periodStart
      ? Date.parse(`${matchedFact.periodStart}T00:00:00.000Z`)
      : endMs;
    const spanSuffix =
      matchedFact.periodSpanKind === 'full_year'
        ? 'annual_actual'
        : matchedFact.periodSpanKind === 'instant'
          ? 'instant_actual'
          : 'quarterly_actual';
    const obsId = `obs-${header.ticker.toLowerCase()}-${accSlug}-${spec.metricNamePrefix}`;

    observations.push({
      observationId: obsId.slice(0, 120),
      subjectOrgId: subjectOrg.orgId,
      subjectProjectId: null,
      counterpartyOrgId: null,
      metricName: `${spec.metricNamePrefix}_${spanSuffix}`,
      metricValue: matchedFact.val,
      metricUnit: matchedFact.unit === 'USD' ? 'currency' : 'ratio',
      currencyCode: matchedFact.unit === 'USD' ? 'USD' : null,
      reportingPeriodLabel: `${matchedFact.periodLabel ?? header.form} (Period Ended ${matchedFact.periodEnd})`,
      periodStartMs: startMs,
      periodEndMs: endMs,
      accountingBasis: spec.accountingBasis,
      metricDefinition: `SEC XBRL us-gaap:${matchedFact.conceptName} extracted from Form ${header.form} (${header.accession}, filed ${header.filed}, span=${matchedFact.periodSpanKind})`,
      observationKind: 'reported',
      publishedAtMs: header.publishedMs,
      receivedAtMs: Math.max(receivedAtMs, header.publishedMs),
      sourceDocIds: [sourceDocId],
    });
  }

  return { sourceDocument, observations, rejectedConcepts };
}

export interface Parsed13fHoldingRow {
  issuerName: string;
  titleOfClass: string;
  cusip: string;
  valueUsd: number;
  sharesOrPrincipalAmount: number;
  sharesOrPrincipalType: 'SH' | 'PRN';
  putCall: string | null;
  investmentDiscretion: string;
}

function extractXmlTagText(block: string, localTagName: string): string | null {
  const re = new RegExp(
    `<(?:[A-Za-z0-9_-]+:)?${localTagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${localTagName}>`,
    'i',
  );
  const m = re.exec(block);
  if (!m) return null;
  return m[1]!
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Deterministic Form 13F-HR XML `<informationTable>` extractor.
 * Post-Jan-2023 SEC Form 13F XML Technical Specification v1.7 reports `<value>` in exact whole USD (`valueScaleMultiplier = 1`).
 * Emits `pending_review` `ownership_stake` candidates so human review is required before TypeDB promotion.
 */
export function extractForm13fXmlGraphCandidates(params: {
  header: DiscoveredSecFilingHeader;
  infoTableXml: string;
  filerOrg: GraphOrganisation;
  defaultSectorId: string;
  valueScaleMultiplier?: 1 | 1000;
  contentSha256?: string;
  receivedAtMs: number;
  ingestedAtMs?: number;
  issuerRegistry?: ReadonlyMap<string, GraphOrganisation>;
}): {
  sourceDocument: GraphSourceDocument;
  holdings: Parsed13fHoldingRow[];
  totalPortfolioValueUsd: number;
  portfolioObservation: GraphObservation;
  prerequisiteSectors: GraphSector[];
  prerequisiteOrganisations: GraphOrganisation[];
  prerequisiteInstruments: GraphInstrument[];
  candidateRelationships: MacroRelationship[];
} {
  const { header, infoTableXml, filerOrg, receivedAtMs } = params;
  const scale = params.valueScaleMultiplier ?? 1;
  const ingestedAtMs = params.ingestedAtMs ?? receivedAtMs;
  const accSlug = header.accession.replace(/-/g, '');
  const sourceDocId = `doc-sec-${(header.ticker || filerOrg.orgId).toLowerCase()}-13fhr-${accSlug}`;
  const contentSha256 = params.contentSha256 ?? sha256Hex(infoTableXml);

  const infoBlockRe = /<(?:[A-Za-z0-9_-]+:)?infoTable\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?infoTable>/gi;
  const aggregatedByCusip = new Map<string, Parsed13fHoldingRow>();

  for (const match of infoTableXml.matchAll(infoBlockRe)) {
    const inner = match[1]!;
    const issuerName = extractXmlTagText(inner, 'nameOfIssuer');
    const titleOfClass = extractXmlTagText(inner, 'titleOfClass') ?? 'COM';
    const cusip = (extractXmlTagText(inner, 'cusip') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const rawVal = extractXmlTagText(inner, 'value');
    const rawShares = extractXmlTagText(inner, 'sshPrnamt');
    const shTypeRaw = (extractXmlTagText(inner, 'sshPrnamtType') ?? 'SH').toUpperCase();
    const putCall = extractXmlTagText(inner, 'putCall');
    const discretion = extractXmlTagText(inner, 'investmentDiscretion') ?? 'SOLE';

    if (!issuerName || cusip.length < 6 || !rawVal || !rawShares) continue;
    const parsedVal = Number(rawVal.replace(/,/g, ''));
    const parsedShares = Number(rawShares.replace(/,/g, ''));
    if (!Number.isFinite(parsedVal) || parsedVal < 0 || !Number.isFinite(parsedShares) || parsedShares < 0) {
      continue;
    }

    const key = `${cusip}:${putCall ?? 'LONG'}`;
    const scaledUsd = Math.round(parsedVal * scale);
    const existing = aggregatedByCusip.get(key);
    if (existing) {
      existing.valueUsd += scaledUsd;
      existing.sharesOrPrincipalAmount += parsedShares;
    } else {
      aggregatedByCusip.set(key, {
        issuerName,
        titleOfClass,
        cusip,
        valueUsd: scaledUsd,
        sharesOrPrincipalAmount: parsedShares,
        sharesOrPrincipalType: shTypeRaw === 'PRN' ? 'PRN' : 'SH',
        putCall: putCall || null,
        investmentDiscretion: discretion,
      });
    }
  }

  const holdings = Array.from(aggregatedByCusip.values()).sort((a, b) => b.valueUsd - a.valueUsd);
  if (holdings.length === 0) {
    throw new Error(`Form 13F XML (${header.accession}) contained zero valid <infoTable> rows`);
  }

  const totalPortfolioValueUsd = holdings.reduce((acc, h) => acc + h.valueUsd, 0);
  const reportDateIso = header.reportDate ?? header.filed;
  const reportDateMs = Date.parse(`${reportDateIso}T23:59:59.000Z`);

  const sourceDocument: GraphSourceDocument = {
    sourceDocId,
    title: `${header.name} SEC Form ${header.form} (${header.accession}, holdings as of ${reportDateIso})`,
    url: header.docUrl,
    kind: 'filing',
    authority: 'primary',
    contentSha256,
    publicationBasis: 'sec_edgar_acceptance',
    publishedAtMs: header.publishedMs,
    receivedAtMs: Math.max(receivedAtMs, header.publishedMs),
    ingestedAtMs: Math.max(ingestedAtMs, receivedAtMs, header.publishedMs),
  };

  const portfolioObservation: GraphObservation = {
    observationId: `obs-${(header.ticker || '13f').toLowerCase()}-${accSlug}-13f-portfolio`,
    subjectOrgId: filerOrg.orgId,
    subjectProjectId: null,
    counterpartyOrgId: null,
    metricName: 'institutional_equity_portfolio_fair_value',
    metricValue: totalPortfolioValueUsd,
    metricUnit: 'currency',
    currencyCode: 'USD',
    reportingPeriodLabel: `Form 13F Holdings as of ${reportDateIso}`,
    periodStartMs: reportDateMs,
    periodEndMs: reportDateMs,
    accountingBasis: `SEC_Form_13F_Fair_Value_Scale_${scale}x`,
    metricDefinition: `Aggregate Form 13F-HR reported fair value across ${holdings.length} CUSIP position(s) (${header.accession}, filed ${header.filed})`,
    observationKind: 'reported',
    publishedAtMs: header.publishedMs,
    receivedAtMs: Math.max(receivedAtMs, header.publishedMs),
    sourceDocIds: [sourceDocId],
  };

  const prerequisiteSectors: GraphSector[] = [
    {
      sectorId: params.defaultSectorId,
      sectorName: 'Public Equities & Institutional 13F Issuers',
      industryGroup: 'Public & Institutional Capital Markets',
      economicLayer: 'equity_capital_markets',
    },
  ];
  const prerequisiteOrganisationsMap = new Map<string, GraphOrganisation>();
  for (const s of filerOrg.sectorIds) {
    if (s !== params.defaultSectorId) {
      prerequisiteSectors.push({
        sectorId: s,
        sectorName: s,
        industryGroup: 'Institutional Filer Sector',
        economicLayer: 'technology_and_capital',
      });
    }
  }
  prerequisiteOrganisationsMap.set(filerOrg.orgId, filerOrg);
  const prerequisiteInstruments: GraphInstrument[] = [];
  const candidateRelationships: MacroRelationship[] = [];

  for (const h of holdings) {
    const slug = h.issuerName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32);
    const matchedOrg =
      params.issuerRegistry?.get(h.cusip) ??
      params.issuerRegistry?.get(h.issuerName.toUpperCase()) ?? {
        orgId: `org-13f-${h.cusip.toLowerCase()}`,
        legalName: h.issuerName,
        displayName: h.issuerName,
        subtype: 'public_company' as const,
        secCik: null,
        leiCode: null,
        ticker: null,
        jurisdiction: 'US',
        sectorIds: [params.defaultSectorId],
        aliases: [h.issuerName, h.cusip],
      };
    prerequisiteOrganisationsMap.set(matchedOrg.orgId, matchedOrg);

    const instId = `inst-13f-${h.cusip.toLowerCase()}-${(h.putCall ?? 'sh').toLowerCase()}`;
    prerequisiteInstruments.push({
      instrumentId: instId,
      instrumentType: `${h.titleOfClass} (CUSIP ${h.cusip}${h.putCall ? `, ${h.putCall}` : ''})`,
      instrumentCurrency: 'USD',
      ticker: matchedOrg.ticker,
      figiCode: null,
    });

    const relId = `rel-13f-${(header.ticker || slug).toLowerCase()}-${h.cusip.toLowerCase()}-${accSlug.slice(-6)}`;
    candidateRelationships.push({
      relationshipId: relId.slice(0, 115),
      relationType: 'ownership_stake',
      logicalEventId: `evt-13f-${filerOrg.orgId}-${h.cusip.toLowerCase()}-${reportDateIso}`,
      version: 1,
      supersedesRelationshipId: null,
      category: 'reported_13f_equity_holding',
      contractualStatus: 'funded',
      epistemicStatus: 'confirmed',
      extractionStatus: 'verified_primary_filing',
      reviewerStatus: 'pending_review',
      reviewedBy: null,
      conflictGroupId: null,
      economicGroupId: `grp-13f-${filerOrg.orgId}-${reportDateIso}`,
      principalAmount: h.valueUsd,
      currencyCode: 'USD',
      capacityUnit: h.sharesOrPrincipalType === 'SH' ? 'SHARES' : null,
      capacityQuantity: h.sharesOrPrincipalType === 'SH' ? h.sharesOrPrincipalAmount : null,
      conditionsSummary: `Form ${header.form} (${header.accession}, holdings as of ${reportDateIso}): ${filerOrg.displayName} reported ${h.sharesOrPrincipalAmount.toLocaleString('en-US')} ${h.sharesOrPrincipalType} (${h.investmentDiscretion} discretion, CUSIP ${h.cusip}) of ${h.issuerName} (${h.titleOfClass}) valued at USD ${h.valueUsd.toLocaleString('en-US')}.`,
      bindingObligation: false,
      effectiveFromMs: reportDateMs,
      effectiveToMs: null,
      maturityAtMs: null,
      publishedAtMs: header.publishedMs,
      receivedAtMs: Math.max(receivedAtMs, header.publishedMs),
      participants: [
        { role: 'owner_entity', entityId: filerOrg.orgId, entityKind: 'organisation' },
        { role: 'owned_entity', entityId: matchedOrg.orgId, entityKind: 'organisation' },
        { role: 'held_instrument', entityId: instId, entityKind: 'financial_instrument' },
      ],
      sourceDocIds: [sourceDocId],
    });
  }

  return {
    sourceDocument,
    holdings,
    totalPortfolioValueUsd,
    portfolioObservation,
    prerequisiteSectors,
    prerequisiteOrganisations: Array.from(prerequisiteOrganisationsMap.values()),
    prerequisiteInstruments,
    candidateRelationships,
  };
}

export interface Form8kReviewCandidate {
  candidateId: string;
  sourceDocument: GraphSourceDocument;
  subjectOrgId: string;
  accession: string;
  filed: string;
  secItems: string[];
  itemDescriptions: string[];
  reviewStatus: 'pending_human_review';
  requiresHumanFactExtraction: true;
  inferredPrincipalAmount: null;
  inferredCounterpartyOrgId: null;
}

const SEC_8K_ITEM_LABELS: Readonly<Record<string, string>> = {
  '1.01': 'Entry into a Material Definitive Agreement',
  '1.02': 'Termination of a Material Definitive Agreement',
  '2.01': 'Completion of Acquisition or Disposition of Assets',
  '2.02': 'Results of Operations and Financial Condition',
  '2.03': 'Creation of a Direct Financial Obligation or Off-Balance Sheet Arrangement',
  '5.02': 'Departure of Directors or Certain Officers; Election of Directors; Appointment of Certain Officers',
  '7.01': 'Regulation FD Disclosure',
  '8.01': 'Other Events',
  '9.01': 'Financial Statements and Exhibits',
};

/**
 * Registers a newly discovered Form `8-K` / `8-K/A` filing and its item codes as a source-backed
 * human review candidate WITHOUT inferring contractual amounts or counterparties.
 */
export function registerForm8kReviewCandidate(params: {
  header: DiscoveredSecFilingHeader;
  subjectOrg: GraphOrganisation;
  rawFilingText?: string;
  contentSha256?: string;
  receivedAtMs: number;
  ingestedAtMs?: number;
}): Form8kReviewCandidate {
  const { header, subjectOrg, receivedAtMs } = params;
  const ingestedAtMs = params.ingestedAtMs ?? receivedAtMs;
  const accSlug = header.accession.replace(/-/g, '');
  const sourceDocId = `doc-sec-${header.ticker.toLowerCase()}-8k-${accSlug}`;
  const contentSha256 =
    params.contentSha256 ?? sha256Hex(params.rawFilingText ?? `${header.docUrl}|${header.accession}`);

  const detectedItems = new Set<string>(header.secItems);
  if (params.rawFilingText) {
    for (const m of params.rawFilingText.matchAll(/\bItem\s+([1-9]\.0[1-9])\b/gi)) {
      detectedItems.add(m[1]!);
    }
  }
  const secItems = Array.from(detectedItems).sort();
  const itemDescriptions = secItems.map(
    (code) => `Item ${code}: ${SEC_8K_ITEM_LABELS[code] ?? 'Current Report Disclosure'}`,
  );

  const sourceDocument: GraphSourceDocument = {
    sourceDocId,
    title: `${header.name} (${header.ticker}) SEC Form ${header.form} (${header.accession}${secItems.length > 0 ? `, Items ${secItems.join(', ')}` : ''})`,
    url: header.docUrl,
    kind: 'filing',
    authority: 'primary',
    contentSha256,
    publicationBasis: 'sec_edgar_acceptance',
    publishedAtMs: header.publishedMs,
    receivedAtMs: Math.max(receivedAtMs, header.publishedMs),
    ingestedAtMs: Math.max(ingestedAtMs, receivedAtMs, header.publishedMs),
  };

  return {
    candidateId: `cand-8k-${header.ticker.toLowerCase()}-${accSlug}`,
    sourceDocument,
    subjectOrgId: subjectOrg.orgId,
    accession: header.accession,
    filed: header.filed,
    secItems,
    itemDescriptions,
    reviewStatus: 'pending_human_review',
    requiresHumanFactExtraction: true,
    inferredPrincipalAmount: null,
    inferredCounterpartyOrgId: null,
  };
}
