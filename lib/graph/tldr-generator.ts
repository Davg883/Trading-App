import {
  type GraphEdgeView,
  type GraphNodeView,
  type GraphObservation,
  type MacroTldrSummary,
  type TldrStatement,
} from './contracts';

export const NON_CAUSATION_NOTICE =
  'Graph connectivity reflects disclosed or attributed structural relationships only and never constitutes proof of market price causation or trade execution authority.';

function formatMoneyUsd(amount: number | null, currency: string | null): string {
  if (amount === null || currency === null) return 'undisclosed amount';
  if (amount >= 1e9) {
    return `${currency} ${(amount / 1e9).toFixed(2)}B`;
  }
  if (amount >= 1e6) {
    return `${currency} ${(amount / 1e6).toFixed(1)}M`;
  }
  return `${currency} ${amount.toLocaleString('en-US')}`;
}

/**
 * Generates an evidence-bound TL;DR summary exclusively from approved, bounded graph query results.
 * Distinguishes:
 * 1. What changed
 * 2. Why it matters
 * 3. Which entities and sectors are connected
 * 4. What evidence supports the conclusion
 * 5. What remains uncertain
 * 6. What information should be collected next
 *
 * Explicitly labels every statement as `confirmed`, `reported`, `proposed`, `inferred`, or `hypothetical`.
 */
export function generateBoundedGraphTldr(params: {
  nodes: GraphNodeView[];
  edges: GraphEdgeView[];
  observations: GraphObservation[];
  conflicts: Array<{
    conflictGroupId: string;
    logicalEventId: string;
    assertions: GraphEdgeView[];
    resolutionRule: string;
  }>;
  asOfMs: number;
  temporalBasis: 'receipt' | 'publication';
  generatedAtMs?: number;
}): MacroTldrSummary {
  const { nodes, edges, observations, conflicts, asOfMs, temporalBasis } = params;
  const generatedAtMs = params.generatedAtMs ?? asOfMs;

  const whatChanged: TldrStatement[] = [];
  const whyItMatters: TldrStatement[] = [];
  const connectedEntitiesAndSectors: TldrStatement[] = [];
  const supportingEvidence: TldrStatement[] = [];
  const uncertainties: TldrStatement[] = [];
  const nextInformationToCollect: TldrStatement[] = [];

  // 1. What changed (focus on latest revisions, supersessions, and active commitments)
  const sortedEdges = [...edges].sort((a, b) => b.publishedAtMs - a.publishedAtMs);
  for (const edge of sortedEdges.slice(0, 5)) {
    const partySummary = edge.participants.map((p) => `${p.label} (${p.role})`).join(' · ');
    const amountOrCap =
      edge.principalAmount !== null
        ? formatMoneyUsd(edge.principalAmount, edge.currencyCode)
        : edge.capacityQuantity !== null && edge.capacityUnit !== null
          ? `${edge.capacityQuantity} ${edge.capacityUnit}`
          : 'undisclosed financial terms';

    whatChanged.push({
      id: `chg:${edge.relationshipId}`,
      text: `[${edge.epistemicStatus.toUpperCase()} · ${edge.contractualStatus}] ${edge.relationType.replace(/_/g, ' ')} v${edge.version}: ${partySummary} (${amountOrCap}) — ${edge.conditionsSummary}`,
      epistemicStatus: edge.epistemicStatus,
      contractualStatus: edge.contractualStatus,
      relationshipIds: [edge.relationshipId],
      sourceDocIds: edge.sources.map((s) => s.sourceDocId),
    });
  }

  // 2. Why it matters (structural dependency & concentration implications, never market causation)
  const confirmedBinding = edges.filter(
    (e) => e.epistemicStatus === 'confirmed' && e.bindingObligation,
  );
  if (confirmedBinding.length > 0) {
    whyItMatters.push({
      id: 'why:confirmed-obligations',
      text: `${confirmedBinding.length} primary-filing-verified binding relationship(s) establish multi-party capital, guarantee, or grid-power dependencies across the selected subgraph.`,
      epistemicStatus: 'confirmed',
      contractualStatus: 'signed',
      relationshipIds: confirmedBinding.map((e) => e.relationshipId),
      sourceDocIds: [
        ...new Set(confirmedBinding.flatMap((e) => e.sources.map((s) => s.sourceDocId))),
      ],
    });
  }

  const cancelledOrDiscussion = edges.filter((e) =>
    ['cancelled', 'reported_discussion'].includes(e.contractualStatus),
  );
  if (cancelledOrDiscussion.length > 0) {
    whyItMatters.push({
      id: 'why:non-binding-or-terminated',
      text: `${cancelledOrDiscussion.length} relationship(s) reflect unsigned discussions or reported customer terminations; these alter counterparty concentration without establishing executed cash funding.`,
      epistemicStatus: 'reported',
      contractualStatus: cancelledOrDiscussion[0]!.contractualStatus,
      relationshipIds: cancelledOrDiscussion.map((e) => e.relationshipId),
      sourceDocIds: [
        ...new Set(cancelledOrDiscussion.flatMap((e) => e.sources.map((s) => s.sourceDocId))),
      ],
    });
  }

  // 3. Connected entities and sectors
  const orgNodes = nodes.filter((n) => n.kind === 'organisation');
  const projectNodes = nodes.filter((n) => n.kind === 'infrastructure_project');
  const sectorSet = new Set(orgNodes.flatMap((o) => o.sectorIds));
  if (orgNodes.length > 0 || projectNodes.length > 0) {
    const primaryStatus = edges.some((e) => e.epistemicStatus === 'confirmed')
      ? 'confirmed'
      : 'reported';
    connectedEntitiesAndSectors.push({
      id: 'conn:summary',
      text: `Connected network spans ${orgNodes.length} organisation(s) (${orgNodes.map((o) => o.label).join(', ')}), ${projectNodes.length} infrastructure project(s), and ${sectorSet.size} sector classification(s) (${[...sectorSet].join(', ')}).`,
      epistemicStatus: primaryStatus,
      contractualStatus: null,
      relationshipIds: edges.map((e) => e.relationshipId),
      sourceDocIds: [...new Set(edges.flatMap((e) => e.sources.map((s) => s.sourceDocId)))],
    });
  }

  // 4. Supporting evidence
  const uniqueSources = new Map<string, GraphEdgeView['sources'][number]>();
  for (const edge of edges) {
    for (const src of edge.sources) {
      uniqueSources.set(src.sourceDocId, src);
    }
  }
  for (const src of uniqueSources.values()) {
    const relIds = edges
      .filter((e) => e.sources.some((s) => s.sourceDocId === src.sourceDocId))
      .map((e) => e.relationshipId);
    supportingEvidence.push({
      id: `ev:${src.sourceDocId}`,
      text: `${src.title} (${src.authority} ${src.kind}, published ${new Date(src.publishedAtMs).toISOString().slice(0, 10)}, workspace receipt ${new Date(src.receivedAtMs).toISOString().slice(0, 10)}).`,
      epistemicStatus: src.authority === 'primary' ? 'confirmed' : 'reported',
      contractualStatus: null,
      relationshipIds: relIds,
      sourceDocIds: [src.sourceDocId],
    });
  }

  if (observations.length > 0) {
    const firstObs = observations[0]!;
    supportingEvidence.push({
      id: `ev:obs:${firstObs.observationId}`,
      text: `${observations.length} linked financial/operational observation(s), including ${firstObs.metricName} (${firstObs.reportingPeriodLabel}, ${firstObs.accountingBasis}).`,
      epistemicStatus: firstObs.observationKind === 'reported' ? 'confirmed' : 'inferred',
      contractualStatus: null,
      relationshipIds: [],
      sourceDocIds: firstObs.sourceDocIds,
    });
  }

  // 5. What remains uncertain (missing principals, inferred edges, conflicts)
  for (const conflict of conflicts) {
    uncertainties.push({
      id: `unc:conflict:${conflict.conflictGroupId}`,
      text: `Conflicting disclosures on ${conflict.logicalEventId} (${conflict.assertions.length} competing assertions retained pending review): ${conflict.resolutionRule}`,
      epistemicStatus: 'reported',
      contractualStatus: 'reported_discussion',
      relationshipIds: conflict.assertions.map((a) => a.relationshipId),
      sourceDocIds: [
        ...new Set(conflict.assertions.flatMap((a) => a.sources.map((s) => s.sourceDocId))),
      ],
    });
  }

  const missingPrincipalEdges = edges.filter(
    (e) =>
      e.principalAmount === null &&
      ['financing_arrangement', 'guarantee_arrangement', 'procurement_relationship'].includes(
        e.relationType,
      ),
  );
  for (const edge of missingPrincipalEdges) {
    uncertainties.push({
      id: `unc:missing-terms:${edge.relationshipId}`,
      text: `Principal amount and maturity schedule remain undisclosed for ${edge.relationshipId} (${edge.logicalEventId}, status: ${edge.contractualStatus}).`,
      epistemicStatus: edge.epistemicStatus,
      contractualStatus: edge.contractualStatus,
      relationshipIds: [edge.relationshipId],
      sourceDocIds: edge.sources.map((s) => s.sourceDocId),
    });
  }

  const inferredEdges = edges.filter((e) => e.epistemicStatus === 'inferred');
  for (const edge of inferredEdges) {
    uncertainties.push({
      id: `unc:inferred:${edge.relationshipId}`,
      text: `Inferred relationship (${edge.relationshipId}): ${edge.conditionsSummary}`,
      epistemicStatus: 'inferred',
      contractualStatus: edge.contractualStatus,
      relationshipIds: [edge.relationshipId],
      sourceDocIds: edge.sources.map((s) => s.sourceDocId),
    });
  }

  // 6. What information should be collected next
  if (missingPrincipalEdges.length > 0) {
    nextInformationToCollect.push({
      id: 'next:primary-credit-agreements',
      text: 'Collect primary SEC Form 8-K / S-1 amendment exhibits establishing executed principal, maturity date, and covenant terms for unsigned or undisclosed financing/guarantee arrangements.',
      epistemicStatus: 'proposed',
      contractualStatus: null,
      relationshipIds: missingPrincipalEdges.map((e) => e.relationshipId),
      sourceDocIds: [
        ...new Set(missingPrincipalEdges.flatMap((e) => e.sources.map((s) => s.sourceDocId))),
      ],
    });
  }
  if (conflicts.length > 0) {
    nextInformationToCollect.push({
      id: 'next:resolve-tenant-conflict',
      text: 'Await official Form 10-Q / 8-K lease execution disclosure naming the counterparty before resolving conflicting tenant assertions.',
      epistemicStatus: 'proposed',
      contractualStatus: null,
      relationshipIds: conflicts.flatMap((c) => c.assertions.map((a) => a.relationshipId)),
      sourceDocIds: [
        ...new Set(
          conflicts.flatMap((c) =>
            c.assertions.flatMap((a) => a.sources.map((s) => s.sourceDocId)),
          ),
        ),
      ],
    });
  }
  nextInformationToCollect.push({
    id: 'next:energised-mw-verification',
    text: 'Collect utility interconnection and energised-MW commissioning disclosures to distinguish planned MW capacity from commercially available GPU capacity.',
    epistemicStatus: 'proposed',
    contractualStatus: null,
    relationshipIds: edges.map((e) => e.relationshipId),
    sourceDocIds: [...uniqueSources.keys()],
  });

  return {
    generatedAtMs,
    asOfMs,
    temporalBasis,
    nonCausationNotice: NON_CAUSATION_NOTICE,
    whatChanged,
    whyItMatters,
    connectedEntitiesAndSectors,
    supportingEvidence,
    uncertainties,
    nextInformationToCollect,
  };
}
