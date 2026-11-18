import type {
  GraphObservation,
  GraphSourceDocument,
  GraphSourceMode,
  MacroGraphDataset,
  MacroRelationship,
} from './contracts';
import {
  TypeDbSchemaOrHydrationError,
  hydrateMacroDatasetFromLiveTypeDb,
  probeTypeDbServer,
  type TypeDbConnectionConfig,
} from './typedb-driver-adapter';

/**
 * RC002 Workstream D (B-005) — Home (`/`) & Data Room (`/data-room`) NVIDIA Intelligence Alignment.
 *
 * Guarantees:
 * 1. Derives all NVIDIA financial, governance, 13F, and contractual-exposure summary figures strictly from
 *    verified `GraphObservation` and `MacroRelationship` records (zero hardcoded JSX numbers).
 * 2. Ensures `/` and `/data-room` agree on the latest available reported period (`FY2027 Q3` post-earnings
 *    or `FY2027 Q2` at pre-earnings `asOfMs`), preserving historical `as-of` views without hindsight leakage.
 * 3. Fails closed with `GRAPH_UNAVAILABLE` when the TypeDB read path is unreachable or fails validation.
 * 4. Rejects synthetic Macro Case 001 datasets (`Nscale`, `Loughton`, `EirGrid`, `$895.4B`) so synthetic
 *    demo records are NEVER displayed as current NVIDIA financial intelligence.
 */

export function isSyntheticMacroCase001Dataset(dataset: MacroGraphDataset | null | undefined): boolean {
  if (!dataset) return false;
  return dataset.relationships.some(
    (r) =>
      r.relationshipId === 'rel-loughton-msft-r2' ||
      r.relationshipId === 'rel-nscale-nvda-convertible-r1' ||
      r.relationshipId === 'rel-aws-dublin-eirgrid-dep-r1' ||
      r.relationshipId === 'rel-anthropic-s1a-amzn-compute-r1',
  );
}

export interface NvidiaAlignedSourceLink {
  sourceDocId: string;
  title: string;
  url: string;
  publishedAtMs: number;
}

export interface NvidiaDashboardGraphSummary {
  graphSourceMode: GraphSourceMode;
  sourceDatabase: string | null;
  serverVersion: string | null;
  evaluatedAtIso: string;
  asOfMs: number;
  asOfIso: string;
  unavailableReason: string | null;
  latestReportedPeriodLabel: string | null;
  latestReportedPeriodEndIso: string | null;
  isPostEarningsQ3Available: boolean;
  reported: {
    revenueUsd: number | null;
    priorQuarterRevenueUsd: number | null;
    preservedQ3GuidanceMidpointUsd: number | null;
    q3BeatUsd: number | null;
    q3BeatPct: number | null;
    dataCenterRevenueUsd: number | null;
    gaapGrossMarginRatio: number | null;
    nonGaapGrossMarginRatio: number | null;
    gaapOperatingIncomeUsd: number | null;
    gaapNetIncomeUsd: number | null;
    freeCashFlowUsd: number | null;
    cashCapexUsd: number | null;
    customerConcentrationTop3Ratio: number | null;
    accountsReceivableUsd: number | null;
  };
  forwardGuidance: {
    periodLabel: string | null;
    revenueMidpointUsd: number | null;
    grossMarginMidpointRatio: number | null;
    sourceUrl: string | null;
  };
  exposures: {
    directCommitmentsTotalUsd: number | null;
    supplyCommitmentsUsd: number | null;
    contingentNeocloudCapUsd: number | null;
    maxGuaranteesCapUsd: number | null;
    portfolio13fTotalUsd: number | null;
    portfolio13fHoldingCount: number;
    portfolio13fTopHoldingsSummary: string | null;
    anthropicContingentPlacementUsd: number | null;
    anthropicConditionsSummary: string | null;
  };
  governance: {
    leadershipSummary: string | null;
    filingAccession: string | null;
    filingUrl: string | null;
  };
  links: {
    leadership8kUrl: string | null;
    form13fUrl: string | null;
    anthropicS1aUrl: string | null;
    q2Outlook8kUrl: string | null;
    q3Results8kUrl: string | null;
  };
  sourceCount: number;
  observationCount: number;
  relationshipCount: number;
}

export function createUnavailableNvidiaGraphSummary(params: {
  asOfMs: number;
  sourceDatabase?: string | null;
  reason: string;
  evaluatedAtIso?: string;
}): NvidiaDashboardGraphSummary {
  const evaluatedAtIso = params.evaluatedAtIso ?? new Date().toISOString();
  return {
    graphSourceMode: 'GRAPH_UNAVAILABLE',
    sourceDatabase: params.sourceDatabase ?? null,
    serverVersion: null,
    evaluatedAtIso,
    asOfMs: params.asOfMs,
    asOfIso: new Date(params.asOfMs).toISOString(),
    unavailableReason: params.reason,
    latestReportedPeriodLabel: null,
    latestReportedPeriodEndIso: null,
    isPostEarningsQ3Available: false,
    reported: {
      revenueUsd: null,
      priorQuarterRevenueUsd: null,
      preservedQ3GuidanceMidpointUsd: null,
      q3BeatUsd: null,
      q3BeatPct: null,
      dataCenterRevenueUsd: null,
      gaapGrossMarginRatio: null,
      nonGaapGrossMarginRatio: null,
      gaapOperatingIncomeUsd: null,
      gaapNetIncomeUsd: null,
      freeCashFlowUsd: null,
      cashCapexUsd: null,
      customerConcentrationTop3Ratio: null,
      accountsReceivableUsd: null,
    },
    forwardGuidance: {
      periodLabel: null,
      revenueMidpointUsd: null,
      grossMarginMidpointRatio: null,
      sourceUrl: null,
    },
    exposures: {
      directCommitmentsTotalUsd: null,
      supplyCommitmentsUsd: null,
      contingentNeocloudCapUsd: null,
      maxGuaranteesCapUsd: null,
      portfolio13fTotalUsd: null,
      portfolio13fHoldingCount: 0,
      portfolio13fTopHoldingsSummary: null,
      anthropicContingentPlacementUsd: null,
      anthropicConditionsSummary: null,
    },
    governance: {
      leadershipSummary: null,
      filingAccession: null,
      filingUrl: null,
    },
    links: {
      leadership8kUrl: null,
      form13fUrl: null,
      anthropicS1aUrl: null,
      q2Outlook8kUrl: null,
      q3Results8kUrl: null,
    },
    sourceCount: 0,
    observationCount: 0,
    relationshipCount: 0,
  };
}

function formatBillionsOrMillions(usd: number): string {
  if (usd >= 1_000_000_000) {
    return `USD ${(usd / 1_000_000_000).toFixed(2)}B`;
  }
  return `USD ${(usd / 1_000_000).toFixed(1)}M`;
}

/**
 * Computes a point-in-time `NvidiaDashboardGraphSummary` directly from a verified `MacroGraphDataset`
 * at `asOfMs` (using `publishedAtMs <= asOfMs` so historical `as-of` views are strictly preserved).
 */
export function buildNvidiaGraphSummaryFromDataset(
  dataset: MacroGraphDataset,
  options: {
    asOfMs: number;
    graphSourceMode: GraphSourceMode;
    sourceDatabase: string | null;
    serverVersion?: string | null;
    evaluatedAtIso?: string;
  },
): NvidiaDashboardGraphSummary {
  const evaluatedAtIso = options.evaluatedAtIso ?? new Date().toISOString();
  if (isSyntheticMacroCase001Dataset(dataset)) {
    return createUnavailableNvidiaGraphSummary({
      asOfMs: options.asOfMs,
      sourceDatabase: options.sourceDatabase,
      evaluatedAtIso,
      reason:
        'Synthetic Macro Case 001 dataset rejected: synthetic demo figures may never be displayed as current NVIDIA financial intelligence.',
    });
  }

  const eligibleSources: GraphSourceDocument[] = dataset.sources.filter(
    (s) => s.publishedAtMs <= options.asOfMs,
  );
  const sourceById = new Map(eligibleSources.map((s) => [s.sourceDocId, s]));

  const nvdaObservations: GraphObservation[] = dataset.observations
    .filter((o) => o.subjectOrgId === 'org-nvda' && o.publishedAtMs <= options.asOfMs)
    .sort((a, b) => b.periodEndMs - a.periodEndMs || b.publishedAtMs - a.publishedAtMs);

  const eligibleRels: MacroRelationship[] = dataset.relationships.filter(
    (r) =>
      r.publishedAtMs <= options.asOfMs &&
      r.participants.some((p) => p.entityId === 'org-nvda'),
  );

  if (nvdaObservations.length === 0 && eligibleRels.length === 0) {
    return createUnavailableNvidiaGraphSummary({
      asOfMs: options.asOfMs,
      sourceDatabase: options.sourceDatabase,
      evaluatedAtIso,
      reason: `No verified NVIDIA observations or relationships existed at or before ${new Date(options.asOfMs).toISOString()}.`,
    });
  }

  const findObsById = (substr: string) =>
    nvdaObservations.find((o) => o.observationId.includes(substr)) ?? null;
  const findLatestReportedMetric = (metricSubstr: string) =>
    nvdaObservations.find(
      (o) => o.observationKind === 'reported' && o.metricName.includes(metricSubstr),
    ) ?? null;

  const q3RevObs = findObsById('obs-nvda-q3fy27-actual-rev');
  const q2RevObs = findObsById('obs-nvda-q2fy27-actual-rev');
  const latestRevObs = q3RevObs ?? q2RevObs ?? findLatestReportedMetric('revenue_gaap');
  const isPostEarningsQ3Available = Boolean(q3RevObs);

  const q3GuideObs = findObsById('obs-nvda-q3fy27-guidance-rev');
  const q4GuideObs = findObsById('obs-nvda-q4fy27-guidance-rev');
  const q4GuideGmObs = findObsById('obs-nvda-q4fy27-guidance-gm-midpoint');

  const dcRevObs = findObsById('obs-nvda-q3fy27-dc-rev');
  const gaapGmObs = findObsById('obs-nvda-q3fy27-gaap-gm-ratio');
  const nonGaapGmObs = findObsById('obs-nvda-q3fy27-nongaap-gm-ratio');
  const opIncObs = findObsById('obs-nvda-q3fy27-gaap-operating-income');
  const netIncObs = findObsById('obs-nvda-q3fy27-gaap-net-income');
  const fcfObs = findObsById('obs-nvda-q3fy27-fcf');
  const capexObs = findObsById('obs-nvda-q3fy27-capex');
  const custConcObs = findObsById('obs-nvda-q3fy27-top3-customer-rev-concentration');
  const arObs = findObsById('obs-nvda-q3fy27-accounts-receivable');

  const directCommitObs = findObsById('obs-nvda-q3fy27-total-direct-commitments');
  const supplyCommitObs = findObsById('obs-nvda-q3fy27-supply-commitments');
  const neocloudObs = findObsById('obs-nvda-q3fy27-neocloud-contingent-commitments');
  const maxGuarObs = findObsById('obs-nvda-q3fy27-total-guarantees-max');
  const portfolio13fObs = findObsById('obs-nvda-13f-q3-2026-total-portfolio');

  const q3BeatUsd =
    q3RevObs && q3GuideObs ? q3RevObs.metricValue - q3GuideObs.metricValue : null;
  const q3BeatPct =
    q3RevObs && q3GuideObs && q3GuideObs.metricValue > 0
      ? Number((((q3RevObs.metricValue - q3GuideObs.metricValue) / q3GuideObs.metricValue) * 100).toFixed(2))
      : null;

  // 13F holdings derived from verified `ownership_stake` relationships
  const orgLabelMap = new Map(dataset.organisations.map((o) => [o.orgId, o.displayName]));
  const holdings13fRels = eligibleRels
    .filter((r) => r.relationType === 'ownership_stake' && r.category.includes('13f'))
    .sort((a, b) => (b.principalAmount ?? 0) - (a.principalAmount ?? 0));
  const topHoldingsText =
    holdings13fRels.length > 0
      ? holdings13fRels
          .map((r) => {
            const owned = r.participants.find((p) => p.role === 'owned_entity');
            const name = owned ? (orgLabelMap.get(owned.entityId) ?? owned.entityId) : r.relationshipId;
            return `${name} ${r.principalAmount ? formatBillionsOrMillions(r.principalAmount) : 'undisclosed'}`;
          })
          .join(', ')
      : null;

  const anthropicPpRel =
    eligibleRels.find((r) => r.relationshipId.includes('nvda-anthropic-pp')) ?? null;

  const leadershipRels = eligibleRels.filter((r) => r.relationType === 'leadership_appointment');
  const leadershipDoc =
    leadershipRels.flatMap((r) => r.sourceDocIds.map((id) => sourceById.get(id))).find(Boolean) ??
    null;
  const leadershipAccMatch = leadershipDoc
    ? /\b(\d{10}-\d{2}-\d{6})\b/.exec(leadershipDoc.title)?.[1] ??
      (/\/(\d{18})\//.exec(leadershipDoc.url)?.[1]
        ? `${/\/(\d{18})\//.exec(leadershipDoc.url)![1]!.slice(0, 10)}-${/\/(\d{18})\//.exec(leadershipDoc.url)![1]!.slice(10, 12)}-${/\/(\d{18})\//.exec(leadershipDoc.url)![1]!.slice(12)}`
        : null)
    : null;

  const execMap = new Map((dataset.executives ?? []).map((e) => [e.personId, e.displayName]));
  const leadershipSummary =
    leadershipRels.length > 0
      ? leadershipRels
          .map((r) => {
            const officer = r.participants.find((p) => p.entityKind === 'executive_person');
            const name = officer ? (execMap.get(officer.entityId) ?? officer.entityId) : 'Executive';
            if (r.governanceAction === 'resigned') return `${name} resigned`;
            if (r.isInterim) return `${name} appointed ${r.executiveTitle ?? 'Interim CEO'}`;
            return `${name} appointed ${r.executiveTitle ?? 'Board Chair'}`;
          })
          .join('; ')
      : null;

  const findDocUrl = (predicate: (s: GraphSourceDocument) => boolean): string | null =>
    eligibleSources.find(predicate)?.url ?? null;

  const activeGuideObs = isPostEarningsQ3Available ? q4GuideObs : q3GuideObs;
  const activeGuideDocUrl = activeGuideObs
    ? activeGuideObs.sourceDocIds.map((id) => sourceById.get(id)?.url).find(Boolean) ?? null
    : null;

  return {
    graphSourceMode: options.graphSourceMode,
    sourceDatabase: options.sourceDatabase,
    serverVersion: options.serverVersion ?? null,
    evaluatedAtIso,
    asOfMs: options.asOfMs,
    asOfIso: new Date(options.asOfMs).toISOString(),
    unavailableReason: null,
    latestReportedPeriodLabel: latestRevObs?.reportingPeriodLabel ?? null,
    latestReportedPeriodEndIso: latestRevObs
      ? new Date(latestRevObs.periodEndMs).toISOString().slice(0, 10)
      : null,
    isPostEarningsQ3Available,
    reported: {
      revenueUsd: latestRevObs?.metricValue ?? null,
      priorQuarterRevenueUsd: isPostEarningsQ3Available ? (q2RevObs?.metricValue ?? null) : null,
      preservedQ3GuidanceMidpointUsd: q3GuideObs?.metricValue ?? null,
      q3BeatUsd,
      q3BeatPct,
      dataCenterRevenueUsd: dcRevObs?.metricValue ?? null,
      gaapGrossMarginRatio: gaapGmObs?.metricValue ?? null,
      nonGaapGrossMarginRatio: nonGaapGmObs?.metricValue ?? null,
      gaapOperatingIncomeUsd: opIncObs?.metricValue ?? null,
      gaapNetIncomeUsd: netIncObs?.metricValue ?? null,
      freeCashFlowUsd: fcfObs?.metricValue ?? null,
      cashCapexUsd: capexObs?.metricValue ?? null,
      customerConcentrationTop3Ratio: custConcObs?.metricValue ?? null,
      accountsReceivableUsd: arObs?.metricValue ?? null,
    },
    forwardGuidance: {
      periodLabel: activeGuideObs?.reportingPeriodLabel ?? null,
      revenueMidpointUsd: activeGuideObs?.metricValue ?? null,
      grossMarginMidpointRatio: isPostEarningsQ3Available
        ? (q4GuideGmObs?.metricValue ?? null)
        : null,
      sourceUrl: activeGuideDocUrl,
    },
    exposures: {
      directCommitmentsTotalUsd: directCommitObs?.metricValue ?? null,
      supplyCommitmentsUsd: supplyCommitObs?.metricValue ?? null,
      contingentNeocloudCapUsd: neocloudObs?.metricValue ?? null,
      maxGuaranteesCapUsd: maxGuarObs?.metricValue ?? null,
      portfolio13fTotalUsd: portfolio13fObs?.metricValue ?? null,
      portfolio13fHoldingCount: holdings13fRels.length,
      portfolio13fTopHoldingsSummary: topHoldingsText,
      anthropicContingentPlacementUsd: anthropicPpRel?.principalAmount ?? null,
      anthropicConditionsSummary: anthropicPpRel?.conditionsSummary ?? null,
    },
    governance: {
      leadershipSummary,
      filingAccession: leadershipAccMatch,
      filingUrl: leadershipDoc?.url ?? null,
    },
    links: {
      leadership8kUrl: findDocUrl((s) => s.url.includes('000104581026000082') && s.url.endsWith('.htm')),
      form13fUrl: findDocUrl((s) => s.url.includes('000104581026000084')),
      anthropicS1aUrl: findDocUrl((s) => s.url.includes('000162828026072484')),
      q2Outlook8kUrl: findDocUrl((s) => s.url.includes('000104581026000073')),
      q3Results8kUrl: findDocUrl((s) => s.url.includes('000104581026000088') && s.sourceDocId.includes('ex991')),
    },
    sourceCount: eligibleSources.length,
    observationCount: nvdaObservations.length,
    relationshipCount: eligibleRels.length,
  };
}

/**
 * Server-side loader used by `app/page.tsx` so `/` hydrates NVIDIA intelligence from the
 * exact same verified TypeDB read path as `/data-room`, failing closed to `GRAPH_UNAVAILABLE`
 * when TypeDB cannot be reached or contains synthetic Macro Case 001 data.
 */
export async function loadAlignedNvidiaGraphIntelligence(options?: {
  asOfMs?: number;
  typeDbConfig?: TypeDbConnectionConfig;
}): Promise<NvidiaDashboardGraphSummary> {
  const evaluatedAtIso = new Date().toISOString();
  try {
    const probe = await probeTypeDbServer(options?.typeDbConfig);
    if (!probe.reachable || !probe.authenticated || !probe.databaseExists) {
      const fallbackAsOf = options?.asOfMs ?? Date.now();
      return createUnavailableNvidiaGraphSummary({
        asOfMs: fallbackAsOf,
        sourceDatabase: probe.databaseName ?? null,
        evaluatedAtIso,
        reason: probe.error
          ? `Verified TypeDB read path unreachable (${probe.error}).`
          : `Verified TypeDB database '${probe.databaseName}' is unavailable or unconfigured.`,
      });
    }

    const hydrated = await hydrateMacroDatasetFromLiveTypeDb(options?.typeDbConfig, {
      callerOwner: 'public_research',
    });
    if (!hydrated.ok || !hydrated.dataset) {
      return createUnavailableNvidiaGraphSummary({
        asOfMs: options?.asOfMs ?? Date.now(),
        sourceDatabase: probe.databaseName,
        evaluatedAtIso,
        reason: hydrated.error ?? 'Verified TypeDB dataset hydration returned no graph records.',
      });
    }

    // Use the exact same default `asOfMs` selection logic as `app/data-room/page.tsx` so `/` and `/data-room` agree!
    const latestRelMs =
      hydrated.dataset.relationships.length > 0
        ? Math.max(...hydrated.dataset.relationships.map((r) => r.receivedAtMs))
        : 0;
    const defaultAsOfMs =
      latestRelMs > 1794949170000
        ? 1794965700000
        : latestRelMs > 1794146400000
          ? 1794949170000
          : Date.now();
    const effectiveAsOfMs =
      options?.asOfMs !== undefined && Number.isFinite(options.asOfMs)
        ? options.asOfMs
        : defaultAsOfMs;

    return buildNvidiaGraphSummaryFromDataset(hydrated.dataset, {
      asOfMs: effectiveAsOfMs,
      graphSourceMode: 'LIVE_GRAPH',
      sourceDatabase: probe.databaseName,
      serverVersion: hydrated.serverVersion,
      evaluatedAtIso,
    });
  } catch (err) {
    return createUnavailableNvidiaGraphSummary({
      asOfMs: options?.asOfMs ?? Date.now(),
      sourceDatabase: options?.typeDbConfig?.databaseName ?? null,
      evaluatedAtIso,
      reason:
        err instanceof TypeDbSchemaOrHydrationError
          ? err.publicMessage
          : 'Live TypeDB NVIDIA hydration failed closed.',
    });
  }
}
