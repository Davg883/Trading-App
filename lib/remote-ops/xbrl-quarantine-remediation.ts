import {
  accessionFromSecArchiveUrl,
  briefingFactIdFor,
  isQuarantined,
  quarantineKeyFor,
} from './evidence-integrity';

/**
 * RC002 Workstream B (B-003) — SEC/XBRL Quarantine Discovery, Downstream Study Invalidation & Claim-Level Policy.
 *
 * Addresses:
 * 1. All 7 invalid SEC/XBRL disclosures across both Convex Development (`dev:prestigious-dragon-8`) and
 *    Convex Production (`prod:benevolent-magpie-921`), including environment-specific `externalId` variants.
 * 2. Orphaned forward-frozen `evidence` rows (`md7ah8t1nmryeqt0c06wjq9c6x8hpgsb` in Dev,
 *    `ms71z2vm0nhq2850kvr3pym65s8hr3wb` in Prod) created by `storeForwardResearchEventInternal` outside
 *    `researchStagingItems.promotedEvidenceIds`.
 * 3. Complete non-destructive impact mapping across `morningBriefings`, `forwardResearchEvents`, `experiments`,
 *    and `forecasts`.
 * 4. Claim-level quarantine for Form 8-K `0001045810-26-000078` (`nvda-20260902.htm`), keeping the invalid XBRL
 *    `capital_expenditures` extraction blocked while allowing verified Item 8.01 M&A evidence solely as
 *    `proposed` / `contingent_signed` (`bindingObligation: false`).
 */

export const NVDA_HUGGINGFACE_8K_ACCESSION = '0001045810-26-000078' as const;
export const NVDA_HUGGINGFACE_8K_SHA256 =
  '17fe107f9113be5c57673d0a591ea49e87a667ea357de3959eeb91142c49280c' as const;

export interface KnownInvalidSecXbrlRule {
  ruleId: string;
  ticker: string;
  filingAccession: string;
  sourceUrlSuffix: string;
  knownExternalIds: readonly string[];
  reasonCode:
    | 'sec_accession_mismatch_and_obsolete_comparative'
    | 'sec_non_periodic_8k_comparative_xbrl_misattribution'
    | 'sec_ytd_cumulative_mislabelled_as_quarterly';
  reason: string;
  claimedSummary: Record<string, unknown>;
  expectedSummary: Record<string, unknown>;
}

export const KNOWN_INVALID_SEC_XBRL_RULES: readonly KnownInvalidSecXbrlRule[] = [
  {
    ruleId: 'g9-invalid-nvda-000075-10q-q22020-capex',
    ticker: 'NVDA',
    filingAccession: '0001045810-26-000075',
    sourceUrlSuffix: '/000104581026000075/nvda-20260726.htm',
    knownExternalIds: ['staged-7f5da1f3fb6a672d'],
    reasonCode: 'sec_accession_mismatch_and_obsolete_comparative',
    reason:
      'Cross-accession XBRL comparative selector attached Q2 FY2020 YTD capex ($0.37B, accession 0001045810-20-000147) to Q2 FY2027 Form 10-Q (0001045810-26-000075, ended 2026-07-26).',
    claimedSummary: {
      metric: 'capital_expenditures',
      valueBillionsUsd: 0.37,
      period: 'Q22020',
      citedAccession: '0001045810-20-000147',
      attachedFilingAccession: '0001045810-26-000075',
    },
    expectedSummary: {
      formType: '10-Q',
      periodEnded: '2026-07-26',
      actualQ2Fy27CapexUsdMillions: 2677,
    },
  },
  {
    ruleId: 'g9-invalid-nvda-000078-8k-comparative-capex',
    ticker: 'NVDA',
    filingAccession: '0001045810-26-000078',
    sourceUrlSuffix: '/000104581026000078/nvda-20260902.htm',
    knownExternalIds: ['staged-e2523ed83a7c0247'],
    reasonCode: 'sec_non_periodic_8k_comparative_xbrl_misattribution',
    reason:
      'Selector attached obsolete comparative XBRL capex ($0.24B staged / $1.07B forward-frozen) to Item 8.01 Form 8-K (0001045810-26-000078, Hugging Face M&A announcement), which contains zero capex tables.',
    claimedSummary: {
      metric: 'capital_expenditures',
      stagedValueBillionsUsd: 0.24,
      forwardFrozenValueBillionsUsd: 1.07,
      period: 'Q2 2020 / FY2025 comparative',
      attachedForm: '8-K',
    },
    expectedSummary: {
      formType: '8-K',
      secItem: '8.01',
      hasCapexStatement: false,
      claimLevelPolicy: 'block_xbrl_capex_allow_verified_item_801_pending_ma',
    },
  },
  {
    ruleId: 'g9-invalid-amzn-000040-10q-q12017-capex',
    ticker: 'AMZN',
    filingAccession: '0001018724-26-000040',
    sourceUrlSuffix: '/000101872426000040/amzn-20260930.htm',
    knownExternalIds: ['staged-dcf44b009199d49a'],
    reasonCode: 'sec_accession_mismatch_and_obsolete_comparative',
    reason:
      'Companyfacts selector extracted obsolete Q1 2017 capex ($4.9B) and bound it to Q3 2026 Form 10-Q (0001018724-26-000040, ended 2026-09-30).',
    claimedSummary: {
      metric: 'capital_expenditures',
      valueBillionsUsd: 4.9,
      period: 'Q1 2017',
      attachedForm: '10-Q',
    },
    expectedSummary: {
      formType: '10-Q',
      periodEnded: '2026-09-30',
      requiresCurrentQuarterThreeMonthDurationFact: true,
    },
  },
  {
    ruleId: 'g9-invalid-googl-449835-8k-prior-year-capex',
    ticker: 'GOOGL',
    filingAccession: '0001193125-26-449835',
    sourceUrlSuffix: '/000119312526449835/d174184d8k.htm',
    knownExternalIds: ['staged-98c25c92c7ca82e7'],
    reasonCode: 'sec_non_periodic_8k_comparative_xbrl_misattribution',
    reason:
      'Companyfacts selector attached comparative capex ($63.6B) to a non-periodic Form 8-K (0001193125-26-449835) instead of a verified periodic 10-Q/10-K statement.',
    claimedSummary: {
      metric: 'capital_expenditures',
      valueBillionsUsd: 63.6,
      period: 'Q3 2026 (attached to 8-K)',
      attachedForm: '8-K',
    },
    expectedSummary: {
      formType: '8-K',
      periodicReportRequiredForFinancialStatementPromotion: true,
    },
  },
  {
    ruleId: 'g9-invalid-msft-448357-8k-prior-year-capex',
    ticker: 'MSFT',
    filingAccession: '0001193125-26-448357',
    sourceUrlSuffix: '/000119312526448357/d177209d8k.htm',
    knownExternalIds: ['staged-c135441d25ee1df9'],
    reasonCode: 'sec_non_periodic_8k_comparative_xbrl_misattribution',
    reason:
      'Companyfacts selector attached comparative capex ($19.39B) to a non-periodic Form 8-K (0001193125-26-448357) lacking financial statement period verification.',
    claimedSummary: {
      metric: 'capital_expenditures',
      valueBillionsUsd: 19.39,
      period: 'Q1 2027 (attached to 8-K)',
      attachedForm: '8-K',
    },
    expectedSummary: {
      formType: '8-K',
      periodicReportRequiredForFinancialStatementPromotion: true,
    },
  },
  {
    ruleId: 'g9-invalid-intc-000191-10q-ytd-as-q3',
    ticker: 'INTC',
    filingAccession: '0000050863-26-000191',
    sourceUrlSuffix: '/000005086326000191/intc-20260926.htm',
    knownExternalIds: ['staged-adfd0a710e5538b2', 'staged-84349400e88f3423'],
    reasonCode: 'sec_ytd_cumulative_mislabelled_as_quarterly',
    reason:
      'Nine-month YTD cumulative XBRL capex ($11.16B, ~273-day duration) on Q3 2026 Form 10-Q (0000050863-26-000191) was promoted as single-quarter Q3 capex.',
    claimedSummary: {
      metric: 'capital_expenditures',
      valueBillionsUsd: 11.16,
      period: 'Q3 2026 (mislabelled 9M YTD)',
      attachedForm: '10-Q',
    },
    expectedSummary: {
      formType: '10-Q',
      periodEnded: '2026-09-26',
      requiresDurationDaysBetween75And105ForQuarter: true,
    },
  },
  {
    ruleId: 'g9-invalid-amd-000191-10q-ytd-as-q3',
    ticker: 'AMD',
    filingAccession: '0000002488-26-000191',
    sourceUrlSuffix: '/000000248826000191/amd-20260926.htm',
    knownExternalIds: ['staged-39bf33eb27445eee', 'staged-e28936b38824c3e3'],
    reasonCode: 'sec_ytd_cumulative_mislabelled_as_quarterly',
    reason:
      'Nine-month YTD cumulative XBRL capex ($0.75B, ~273-day duration) on Q3 2026 Form 10-Q (0000002488-26-000191) was promoted as single-quarter Q3 capex.',
    claimedSummary: {
      metric: 'capital_expenditures',
      valueBillionsUsd: 0.75,
      period: 'Q3 2026 (mislabelled 9M YTD)',
      attachedForm: '10-Q',
    },
    expectedSummary: {
      formType: '10-Q',
      periodEnded: '2026-09-26',
      requiresDurationDaysBetween75And105ForQuarter: true,
    },
  },
] as const;

export const KNOWN_INVALID_SEC_XBRL_EXTERNAL_ID_SET: ReadonlySet<string> = new Set(
  KNOWN_INVALID_SEC_XBRL_RULES.flatMap((r) => r.knownExternalIds),
);

export interface StagingRowSnapshot {
  _id: string;
  owner: string;
  externalId: string;
  sourceUrl: string;
  title: string;
  entities: string[];
  claimsJson: string;
  validationStatus: string;
  promotedEvidenceIds: string[];
  quarantinedAt?: number | null;
  quarantineId?: string | null;
}

export interface EvidenceRowSnapshot {
  _id: string;
  owner: string;
  source: string;
  symbol: string;
  metric: string;
  value: number;
  unit: string;
  period: string;
  definition: string;
  status: string;
  publishedAt: number;
  receivedAt: number;
  quarantinedAt?: number | null;
  quarantineId?: string | null;
}

export interface BriefingRowSnapshot {
  _id: string;
  owner: string;
  briefingDate: string;
  generatedAt: number;
  confirmedFactsJson: string;
  researchInterpretationJson: string;
  riskChangesJson: string;
  incompleteEvidenceJson: string;
}

export interface ForwardEventRowSnapshot {
  _id: string;
  owner: string;
  eventKey: string;
  name: string;
  symbol: string;
  evidenceJson: string;
  evaluationJson: string;
  experimentId?: string | null;
}

export interface ExperimentRowSnapshot {
  _id: string;
  owner: string;
  name: string;
  cutoff: number;
  evidenceIds: string[];
  protocol: string;
}

export interface ForecastRowSnapshot {
  _id: string;
  owner: string;
  experimentId: string;
  participant: string;
  modelVersion: string;
  evidenceIds: string[];
  decision: string;
  idempotencyKey: string;
}

export interface ExistingQuarantineRowSnapshot {
  _id: string;
  owner: string;
  quarantineKey: string;
  stagingItemId: string;
}

export function matchInvalidSecXbrlRule(doc: {
  externalId: string;
  sourceUrl: string;
  claimsJson?: string;
}): KnownInvalidSecXbrlRule | null {
  for (const rule of KNOWN_INVALID_SEC_XBRL_RULES) {
    if (rule.knownExternalIds.includes(doc.externalId)) {
      return rule;
    }
  }
  const accession = accessionFromSecArchiveUrl(doc.sourceUrl);
  for (const rule of KNOWN_INVALID_SEC_XBRL_RULES) {
    if (
      (accession && accession === rule.filingAccession) ||
      doc.sourceUrl.includes(rule.sourceUrlSuffix)
    ) {
      if (!doc.claimsJson) return rule;
      if (doc.claimsJson.includes('capital_expenditures') || doc.claimsJson.includes('capex')) {
        return rule;
      }
    }
  }
  return null;
}

/**
 * Discovers ALL `evidence` rows tied to a quarantined staging item, including:
 * 1. Direct `doc.promotedEvidenceIds`, AND
 * 2. Orphaned forward-frozen `evidence` rows inserted by `storeForwardResearchEventInternal`
 *    (`Forward experiment (...) frozen sec_xbrl_fact`) or sharing `(sourceUrl/accession, metric/symbol)`
 *    when the claim is quarantined.
 */
export function discoverMatchingEvidenceRowsForStaging(
  doc: {
    owner: string;
    sourceUrl: string;
    entities: string[];
    claimsJson: string;
    promotedEvidenceIds: readonly string[];
  },
  allOwnerEvidenceRows: readonly EvidenceRowSnapshot[],
): {
  allEvidenceIds: string[];
  promotedEvidenceIds: string[];
  orphanEvidenceIds: string[];
} {
  const promotedSet = new Set(doc.promotedEvidenceIds);
  let claimMetrics = new Set<string>();
  const tickerSet = new Set(doc.entities.map((e) => e.toUpperCase()));
  try {
    const parsedClaims = JSON.parse(doc.claimsJson) as Array<{ entity?: string; metric?: string }>;
    for (const c of parsedClaims) {
      if (c.metric) claimMetrics.add(c.metric.toLowerCase());
      if (c.entity) tickerSet.add(c.entity.toUpperCase());
    }
  } catch {
    claimMetrics = new Set(['capital_expenditures']);
  }

  const docAccession = accessionFromSecArchiveUrl(doc.sourceUrl);
  const orphanIds: string[] = [];
  for (const ev of allOwnerEvidenceRows) {
    if (ev.owner !== doc.owner) continue;
    if (promotedSet.has(ev._id)) continue;
    const evAccession = accessionFromSecArchiveUrl(ev.source);
    const sameFilingSource =
      ev.source === doc.sourceUrl || (docAccession !== null && evAccession === docAccession);
    if (!sameFilingSource) continue;

    const isForwardFrozenSecFact =
      ev.definition.includes('Forward experiment (') && ev.definition.includes('sec_xbrl_fact');
    const matchesClaimMetric =
      claimMetrics.size === 0 || claimMetrics.has(ev.metric.toLowerCase());
    const matchesTicker = tickerSet.size === 0 || tickerSet.has(ev.symbol.toUpperCase());

    if ((isForwardFrozenSecFact && matchesTicker) || (matchesClaimMetric && matchesTicker)) {
      orphanIds.push(ev._id);
    }
  }

  const allEvidenceIds = Array.from(new Set([...doc.promotedEvidenceIds, ...orphanIds]));
  return {
    allEvidenceIds,
    promotedEvidenceIds: [...doc.promotedEvidenceIds],
    orphanEvidenceIds: orphanIds,
  };
}

export interface QuarantineDryRunItemImpact {
  ruleId: string;
  quarantineKey: string;
  status: 'would_quarantine' | 'already_quarantined';
  stagingItemId: string;
  stagingExternalId: string;
  ticker: string;
  filingAccession: string | null;
  sourceUrl: string;
  reasonCode: string;
  reason: string;
  claimedJson: string;
  expectedJson: string;
  promotedEvidenceIds: string[];
  orphanEvidenceIds: string[];
  allEvidenceIds: string[];
  affectedBriefings: Array<{ id: string; briefingDate: string }>;
  affectedBriefingFactIds: string[];
  affectedBriefingInterpretationIds: string[];
  affectedForwardEvents: Array<{ id: string; eventKey: string; name: string }>;
  affectedExperiments: Array<{ id: string; name: string; protocol: string }>;
  affectedForecasts: Array<{
    id: string;
    experimentId: string;
    participant: string;
    modelVersion: string;
    decision: string;
  }>;
}

export interface QuarantineDryRunImpactReport {
  dryRun: true;
  evaluatedAtMs: number;
  beforeCounts: {
    totalStagingItems: number;
    activePromotedStagingItems: number;
    quarantinedStagingItems: number;
    totalEvidenceRows: number;
    activeEvidenceRows: number;
    quarantinedEvidenceRows: number;
    totalQuarantineLedgerRows: number;
    totalMorningBriefings: number;
    totalForwardResearchEvents: number;
    totalExperiments: number;
    totalForecasts: number;
  };
  afterCountsIfExecuted: {
    totalStagingItems: number;
    activePromotedStagingItems: number;
    quarantinedStagingItems: number;
    totalEvidenceRows: number;
    activeEvidenceRows: number;
    quarantinedEvidenceRows: number;
    totalQuarantineLedgerRows: number;
    invalidatedMorningBriefingsCount: number;
    invalidatedForwardResearchEventsCount: number;
    invalidatedExperimentsCount: number;
    invalidatedForecastsCount: number;
    rowsDeletedCount: 0;
  };
  items: QuarantineDryRunItemImpact[];
  uniqueAffectedIds: {
    stagingItemIds: string[];
    promotedEvidenceIds: string[];
    orphanEvidenceIds: string[];
    allEvidenceIds: string[];
    morningBriefingIds: string[];
    forwardResearchEventIds: string[];
    experimentIds: string[];
    forecastIds: string[];
  };
  rollbackPlan: {
    requiresSnapshotBeforeWrite: true;
    destructiveDeletesPerformed: false;
    reversiblePatches: string[];
  };
  executionAuthority: 'none';
}

export function containsExactRecordToken(haystack: string, token: string): boolean {
  if (!token) return false;
  if (haystack.includes(`"${token}"`)) return true;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Za-z0-9_-])${escaped}(?=$|[^A-Za-z0-9_-])`).test(haystack);
}

export function discoverXbrlQuarantineImpact(input: {
  stagingItems: readonly StagingRowSnapshot[];
  evidenceRows: readonly EvidenceRowSnapshot[];
  morningBriefings: readonly BriefingRowSnapshot[];
  forwardResearchEvents: readonly ForwardEventRowSnapshot[];
  experiments: readonly ExperimentRowSnapshot[];
  forecasts: readonly ForecastRowSnapshot[];
  existingQuarantines: readonly ExistingQuarantineRowSnapshot[];
  nowMs?: number;
}): QuarantineDryRunImpactReport {
  const nowMs = input.nowMs ?? Date.now();
  const existingByKey = new Map(
    input.existingQuarantines.map((q) => [`${q.owner}::${q.quarantineKey}`, q]),
  );

  const items: QuarantineDryRunItemImpact[] = [];
  for (const doc of input.stagingItems) {
    const rule = matchInvalidSecXbrlRule(doc);
    if (!rule) continue;

    const qKey = quarantineKeyFor(doc.externalId);
    const already = existingByKey.get(`${doc.owner}::${qKey}`);
    const evMatch = discoverMatchingEvidenceRowsForStaging(doc, input.evidenceRows);
    const evIdSet = new Set(evMatch.allEvidenceIds);
    const titleAccession = /\((\d{10}-\d{2}-\d{6})\)/.exec(doc.title)?.[1] ?? null;
    const urlAccession = accessionFromSecArchiveUrl(doc.sourceUrl);
    const accession = urlAccession ?? titleAccession ?? rule.filingAccession;
    const factCandidateIds = Array.from(
      new Set([
        `fact-${doc.externalId}`,
        `interp-${doc.externalId}`,
        ...(titleAccession ? [briefingFactIdFor(rule.ticker, titleAccession)] : []),
        ...(urlAccession ? [briefingFactIdFor(rule.ticker, urlAccession)] : []),
        ...(accession ? [briefingFactIdFor(rule.ticker, accession)] : []),
      ]),
    );

    const tokens = [
      doc._id,
      doc.externalId,
      doc.sourceUrl,
      ...evMatch.allEvidenceIds,
      ...factCandidateIds,
    ];
    const hit = (text: string) => tokens.some((t) => containsExactRecordToken(text, t));

    const ownerBriefings = input.morningBriefings.filter((b) => b.owner === doc.owner);
    const affectedBriefings = ownerBriefings.filter((b) =>
      hit(
        b.confirmedFactsJson +
          b.researchInterpretationJson +
          b.riskChangesJson +
          b.incompleteEvidenceJson,
      ),
    );
    const affectedFactIds = Array.from(
      new Set(
        affectedBriefings.flatMap((b) => {
          try {
            const facts = JSON.parse(b.confirmedFactsJson) as Array<{ id: string }>;
            return facts.filter((f) => hit(JSON.stringify(f))).map((f) => f.id);
          } catch {
            return [];
          }
        }),
      ),
    );
    const affectedInterpIds = Array.from(
      new Set(
        affectedBriefings.flatMap((b) => {
          try {
            const interps = JSON.parse(b.researchInterpretationJson) as Array<{ id: string }>;
            return interps.filter((it) => hit(JSON.stringify(it))).map((it) => it.id);
          } catch {
            return [];
          }
        }),
      ),
    );

    const ownerForward = input.forwardResearchEvents.filter((f) => f.owner === doc.owner);
    const affectedForward = ownerForward.filter((f) => hit(f.evidenceJson));
    const forwardExpIdSet = new Set(
      affectedForward.map((f) => f.experimentId).filter((id): id is string => Boolean(id)),
    );

    const ownerExperiments = input.experiments.filter((e) => e.owner === doc.owner);
    const affectedExperiments = ownerExperiments.filter(
      (e) =>
        forwardExpIdSet.has(e._id) ||
        e.evidenceIds.some((id) => evIdSet.has(id)) ||
        affectedForward.some((f) => e.protocol.includes(f.eventKey) || e.name === f.name),
    );
    const expIdSet = new Set(affectedExperiments.map((e) => e._id));

    const ownerForecasts = input.forecasts.filter((fc) => fc.owner === doc.owner);
    const affectedForecasts = ownerForecasts.filter(
      (fc) => expIdSet.has(fc.experimentId) || fc.evidenceIds.some((id) => evIdSet.has(id)),
    );

    items.push({
      ruleId: rule.ruleId,
      quarantineKey: qKey,
      status: already ? 'already_quarantined' : 'would_quarantine',
      stagingItemId: doc._id,
      stagingExternalId: doc.externalId,
      ticker: rule.ticker,
      filingAccession: accession,
      sourceUrl: doc.sourceUrl,
      reasonCode: rule.reasonCode,
      reason: rule.reason,
      claimedJson: JSON.stringify(rule.claimedSummary),
      expectedJson: JSON.stringify(rule.expectedSummary),
      promotedEvidenceIds: evMatch.promotedEvidenceIds,
      orphanEvidenceIds: evMatch.orphanEvidenceIds,
      allEvidenceIds: evMatch.allEvidenceIds,
      affectedBriefings: affectedBriefings.map((b) => ({
        id: b._id,
        briefingDate: b.briefingDate,
      })),
      affectedBriefingFactIds: affectedFactIds,
      affectedBriefingInterpretationIds: affectedInterpIds,
      affectedForwardEvents: affectedForward.map((f) => ({
        id: f._id,
        eventKey: f.eventKey,
        name: f.name,
      })),
      affectedExperiments: affectedExperiments.map((e) => ({
        id: e._id,
        name: e.name,
        protocol: e.protocol,
      })),
      affectedForecasts: affectedForecasts.map((fc) => ({
        id: fc._id,
        experimentId: fc.experimentId,
        participant: fc.participant,
        modelVersion: fc.modelVersion,
        decision: fc.decision,
      })),
    });
  }

  const uniqueStaging = Array.from(new Set(items.map((i) => i.stagingItemId)));
  const uniquePromotedEv = Array.from(new Set(items.flatMap((i) => i.promotedEvidenceIds)));
  const uniqueOrphanEv = Array.from(new Set(items.flatMap((i) => i.orphanEvidenceIds)));
  const uniqueAllEv = Array.from(new Set(items.flatMap((i) => i.allEvidenceIds)));
  const uniqueBriefings = Array.from(
    new Set(items.flatMap((i) => i.affectedBriefings.map((b) => b.id))),
  );
  const uniqueForward = Array.from(
    new Set(items.flatMap((i) => i.affectedForwardEvents.map((f) => f.id))),
  );
  const uniqueExperiments = Array.from(
    new Set(items.flatMap((i) => i.affectedExperiments.map((e) => e.id))),
  );
  const uniqueForecasts = Array.from(
    new Set(items.flatMap((i) => i.affectedForecasts.map((fc) => fc.id))),
  );

  const wouldQuarantineStagingSet = new Set(
    items.filter((i) => i.status === 'would_quarantine').map((i) => i.stagingItemId),
  );
  const wouldQuarantineEvSet = new Set(
    items.filter((i) => i.status === 'would_quarantine').flatMap((i) => i.allEvidenceIds),
  );

  const beforeActiveStaging = input.stagingItems.filter(
    (s) => s.validationStatus === 'promoted' && !isQuarantined(s),
  ).length;
  const beforeQuarantinedStaging = input.stagingItems.filter((s) => isQuarantined(s)).length;
  const beforeActiveEv = input.evidenceRows.filter((e) => !isQuarantined(e)).length;
  const beforeQuarantinedEv = input.evidenceRows.filter((e) => isQuarantined(e)).length;

  return {
    dryRun: true,
    evaluatedAtMs: nowMs,
    beforeCounts: {
      totalStagingItems: input.stagingItems.length,
      activePromotedStagingItems: beforeActiveStaging,
      quarantinedStagingItems: beforeQuarantinedStaging,
      totalEvidenceRows: input.evidenceRows.length,
      activeEvidenceRows: beforeActiveEv,
      quarantinedEvidenceRows: beforeQuarantinedEv,
      totalQuarantineLedgerRows: input.existingQuarantines.length,
      totalMorningBriefings: input.morningBriefings.length,
      totalForwardResearchEvents: input.forwardResearchEvents.length,
      totalExperiments: input.experiments.length,
      totalForecasts: input.forecasts.length,
    },
    afterCountsIfExecuted: {
      totalStagingItems: input.stagingItems.length,
      activePromotedStagingItems: Math.max(0, beforeActiveStaging - wouldQuarantineStagingSet.size),
      quarantinedStagingItems: beforeQuarantinedStaging + wouldQuarantineStagingSet.size,
      totalEvidenceRows: input.evidenceRows.length,
      activeEvidenceRows: Math.max(0, beforeActiveEv - wouldQuarantineEvSet.size),
      quarantinedEvidenceRows: beforeQuarantinedEv + wouldQuarantineEvSet.size,
      totalQuarantineLedgerRows: input.existingQuarantines.length + wouldQuarantineStagingSet.size,
      invalidatedMorningBriefingsCount: uniqueBriefings.length,
      invalidatedForwardResearchEventsCount: uniqueForward.length,
      invalidatedExperimentsCount: uniqueExperiments.length,
      invalidatedForecastsCount: uniqueForecasts.length,
      rowsDeletedCount: 0,
    },
    items,
    uniqueAffectedIds: {
      stagingItemIds: uniqueStaging,
      promotedEvidenceIds: uniquePromotedEv,
      orphanEvidenceIds: uniqueOrphanEv,
      allEvidenceIds: uniqueAllEv,
      morningBriefingIds: uniqueBriefings,
      forwardResearchEventIds: uniqueForward,
      experimentIds: uniqueExperiments,
      forecastIds: uniqueForecasts,
    },
    rollbackPlan: {
      requiresSnapshotBeforeWrite: true,
      destructiveDeletesPerformed: false,
      reversiblePatches: [
        'Unset quarantinedAt/quarantineId on affected researchStagingItems and evidence rows (including forward-frozen orphan evidence row).',
        'Delete only newly inserted evidenceQuarantines and audit rows matching quarantinedAt timestamp if rollback is ordered, or restore full pre-remediation Convex snapshot.',
      ],
    },
    executionAuthority: 'none',
  };
}

export interface SecClaimQuarantineEvaluationInput {
  accession: string | null;
  sourceUrl?: string | null;
  stagingExternalId?: string | null;
  extractionMethod: 'xbrl' | 'primary_filing_item_text' | 'xml_13f' | 'unknown';
  metricOrClaimType: string;
  secItem?: string | null;
  contentSha256?: string | null;
  epistemicStatus?: 'confirmed' | 'proposed' | 'reported' | 'unverified' | null;
  contractualStatus?: string | null;
  bindingObligation?: boolean | null;
}

export type SecClaimQuarantineDecision =
  | { allowed: true; policyApplied: 'clean' | 'claim_level_verified_item_801_allowed'; note: string }
  | { allowed: false; policyApplied: 'claim_quarantined'; reasonCode: string; detail: string };

/**
 * Claim-level quarantine evaluator (Workstream B.4):
 * - Permanently blocks all 7 disputed SEC/XBRL externalIds and any XBRL / `capital_expenditures` extraction
 *   from `0001045810-26-000078` (`nvda-20260902.htm`).
 * - Permits independently verified Form 8-K Item 8.01 M&A evidence from `0001045810-26-000078` ONLY when:
 *   1. `contentSha256` matches verified EDGAR SHA-256 (`17fe107f9113be5c57673d0a591ea49e87a667ea357de3959eeb91142c49280c`),
 *   2. `extractionMethod === 'primary_filing_item_text'` and `secItem === '8.01'`,
 *   3. `epistemicStatus === 'proposed'`, `contractualStatus === 'contingent_signed'`, and `bindingObligation === false`
 *      (never represented as completed ownership or funded obligation).
 */
export function evaluateSecClaimQuarantine(
  input: SecClaimQuarantineEvaluationInput,
): SecClaimQuarantineDecision {
  if (
    input.stagingExternalId &&
    KNOWN_INVALID_SEC_XBRL_EXTERNAL_ID_SET.has(input.stagingExternalId)
  ) {
    return {
      allowed: false,
      policyApplied: 'claim_quarantined',
      reasonCode: 'quarantined_staging_external_id',
      detail: `Staging item '${input.stagingExternalId}' is permanently quarantined under G9/RC002 SEC XBRL remediation.`,
    };
  }

  const normalizedAcc =
    input.accession ?? accessionFromSecArchiveUrl(input.sourceUrl ?? undefined);
  const metric = input.metricOrClaimType.trim().toLowerCase();

  if (normalizedAcc === NVDA_HUGGINGFACE_8K_ACCESSION) {
    if (
      input.extractionMethod === 'xbrl' ||
      metric.includes('capital_expenditure') ||
      metric.includes('capex') ||
      metric.includes('sec_xbrl')
    ) {
      return {
        allowed: false,
        policyApplied: 'claim_quarantined',
        reasonCode: 'quarantined_000078_xbrl_claim',
        detail:
          'XBRL and capital_expenditures claims on Form 8-K 0001045810-26-000078 remain permanently quarantined (comparative XBRL misattribution).',
      };
    }

    if (
      input.extractionMethod === 'primary_filing_item_text' &&
      input.secItem === '8.01' &&
      input.contentSha256 === NVDA_HUGGINGFACE_8K_SHA256
    ) {
      if (
        input.epistemicStatus !== 'proposed' ||
        input.contractualStatus !== 'contingent_signed' ||
        input.bindingObligation === true
      ) {
        return {
          allowed: false,
          policyApplied: 'claim_quarantined',
          reasonCode: 'pending_ma_cannot_be_completed_ownership',
          detail:
            'Form 8-K 0001045810-26-000078 Item 8.01 describes a pending merger subject to regulatory/closing conditions; it must be represented solely as proposed + contingent_signed with bindingObligation: false.',
        };
      }
      return {
        allowed: true,
        policyApplied: 'claim_level_verified_item_801_allowed',
        note: 'Verified Form 8-K 0001045810-26-000078 Item 8.01 pending M&A disclosure permitted under claim-level quarantine while XBRL capex claims on the same accession remain blocked.',
      };
    }

    return {
      allowed: false,
      policyApplied: 'claim_quarantined',
      reasonCode: 'unverified_000078_claim_requires_hash_and_item801',
      detail:
        'Claims citing accession 0001045810-26-000078 require verified EDGAR SHA-256 and explicit Item 8.01 primary-text extraction.',
    };
  }

  for (const rule of KNOWN_INVALID_SEC_XBRL_RULES) {
    if (
      normalizedAcc === rule.filingAccession &&
      input.extractionMethod === 'xbrl' &&
      (metric.includes('capital_expenditure') || metric.includes('capex'))
    ) {
      return {
        allowed: false,
        policyApplied: 'claim_quarantined',
        reasonCode: rule.reasonCode,
        detail: rule.reason,
      };
    }
  }

  return {
    allowed: true,
    policyApplied: 'clean',
    note: 'No claim-level quarantine rule triggered.',
  };
}
