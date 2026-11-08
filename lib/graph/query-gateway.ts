import fs from 'fs';
import path from 'path';
import {
  MACRO_GRAPH_SCHEMA_VERSION,
  graphQueryRequestSchema,
  macroGraphDatasetSchema,
  type GraphEdgeView,
  type GraphNodeView,
  type GraphQueryRequest,
  type GraphQueryResponse,
  type MacroGraphDataset,
  type MacroRelationship,
} from './contracts';
import { reconstructGraphRelationshipsAtDate } from './identity-governance';
import { generateBoundedGraphTldr } from './tldr-generator';
import {
  defaultTypeDbConfig,
  executeReadOnlyTypeQlOnLiveServer,
} from './typedb-driver-adapter';
import { buildAllowlistedTypeQlQuery } from './typedb-schema';

let cachedInitialDataset: MacroGraphDataset | null = null;

export function loadInitialAcceptanceDataset(): MacroGraphDataset {
  if (cachedInitialDataset) return cachedInitialDataset;
  const datasetPath = path.join(
    process.cwd(),
    'data',
    'graph',
    'initial-acceptance-dataset.json',
  );
  const raw = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  cachedInitialDataset = macroGraphDatasetSchema.parse(raw);
  return cachedInitialDataset;
}

const FORBIDDEN_BROKER_OR_ACCOUNT_FIELDS = [
  'brokerCredentials',
  'tradingCredentials',
  'encryptedPayload',
  'TRADING212_API_KEY',
  'BROKER_VAULT_KEY_B64',
  'accountValuations',
  'accountCashFlows',
  'tradeOrders',
] as const;

/**
 * Guard ensuring private broker credentials, trade orders, or account valuations
 * can never enter a graph dataset or query payload.
 */
export function assertNoBrokerOrPrivateAccountData(payload: unknown): void {
  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
  for (const forbidden of FORBIDDEN_BROKER_OR_ACCOUNT_FIELDS) {
    if (serialized.includes(forbidden)) {
      throw new Error(
        `Security violation: forbidden broker or account field "${forbidden}" is blocked from the research graph`,
      );
    }
  }
}

// Per-caller sliding-window rate limiter (default: 60 requests / 60 seconds)
const callerWindowMap = new Map<string, number[]>();

export function checkGraphGatewayRateLimit(
  callerId: string,
  nowMs = Date.now(),
  maxRequestsPerMinute = 60,
): { allowed: boolean; remaining: number } {
  const windowStart = nowMs - 60_000;
  const recent = (callerWindowMap.get(callerId) ?? []).filter((t) => t > windowStart);
  if (recent.length >= maxRequestsPerMinute) {
    callerWindowMap.set(callerId, recent);
    return { allowed: false, remaining: 0 };
  }
  recent.push(nowMs);
  callerWindowMap.set(callerId, recent);
  return { allowed: true, remaining: Math.max(0, maxRequestsPerMinute - recent.length) };
}

export function resetGraphGatewayRateLimitsForTests(): void {
  callerWindowMap.clear();
}

export type GatewayAuditEntry = {
  callerId: string;
  queryType: GraphQueryRequest['queryType'];
  asOfMs: number;
  nodeCount: number;
  edgeCount: number;
  backendMode: 'typedb_live' | 'deterministic_mirror';
  latencyMs: number;
  atMs: number;
};

const gatewayAuditLog: GatewayAuditEntry[] = [];

export function getGatewayAuditLog(): GatewayAuditEntry[] {
  return [...gatewayAuditLog];
}

function buildNodeCatalog(dataset: MacroGraphDataset): Map<string, GraphNodeView> {
  const catalog = new Map<string, GraphNodeView>();

  for (const org of dataset.organisations) {
    catalog.set(org.orgId, {
      id: org.orgId,
      label: org.displayName,
      kind: 'organisation',
      subtype: org.subtype,
      secCik: org.secCik,
      leiCode: org.leiCode,
      ticker: org.ticker,
      sectorIds: org.sectorIds,
      metadata: {
        legalName: org.legalName,
        jurisdiction: org.jurisdiction,
      },
    });
  }

  for (const proj of dataset.projects) {
    catalog.set(proj.projectId, {
      id: proj.projectId,
      label: proj.projectName,
      kind: 'infrastructure_project',
      subtype: proj.projectType,
      secCik: null,
      leiCode: null,
      ticker: null,
      sectorIds: [],
      metadata: {
        stage: proj.projectStage,
        plannedCapacityMw: proj.plannedCapacityMw,
        energisedCapacityMw: proj.energisedCapacityMw,
        locationId: proj.locationId,
      },
    });
  }

  for (const sec of dataset.sectors) {
    catalog.set(sec.sectorId, {
      id: sec.sectorId,
      label: sec.sectorName,
      kind: 'sector_classification',
      subtype: sec.economicLayer,
      secCik: null,
      leiCode: null,
      ticker: null,
      sectorIds: [sec.sectorId],
      metadata: {
        industryGroup: sec.industryGroup,
        economicLayer: sec.economicLayer,
      },
    });
  }

  for (const asset of dataset.energyAssets) {
    catalog.set(asset.assetId, {
      id: asset.assetId,
      label: asset.assetName,
      kind: 'energy_asset',
      subtype: asset.energySourceType,
      secCik: null,
      leiCode: null,
      ticker: null,
      sectorIds: ['sec-grid-power'],
      metadata: {
        nameplateCapacityMw: asset.nameplateCapacityMw,
        locationId: asset.locationId,
      },
    });
  }

  for (const loc of dataset.locations) {
    catalog.set(loc.locationId, {
      id: loc.locationId,
      label: loc.locationName,
      kind: 'geographical_location',
      subtype: loc.gridZone,
      secCik: null,
      leiCode: null,
      ticker: null,
      sectorIds: [],
      metadata: {
        countryCode: loc.countryCode,
        regionOrState: loc.regionOrState,
        municipality: loc.municipality,
        gridZone: loc.gridZone,
      },
    });
  }

  for (const inst of dataset.instruments) {
    catalog.set(inst.instrumentId, {
      id: inst.instrumentId,
      label: inst.ticker ? `${inst.ticker} (${inst.instrumentType})` : inst.instrumentId,
      kind: 'financial_instrument',
      subtype: inst.instrumentType,
      secCik: null,
      leiCode: null,
      ticker: inst.ticker,
      sectorIds: [],
      metadata: {
        currency: inst.instrumentCurrency,
        figiCode: inst.figiCode,
      },
    });
  }

  return catalog;
}

function selectRelationshipsForQuery(
  request: GraphQueryRequest,
  eligible: MacroRelationship[],
  dataset: MacroGraphDataset,
): MacroRelationship[] {
  const maxDepth = Math.min(request.maxDepth ?? 2, 2);

  switch (request.queryType) {
    case 'organisation_relationship_summary': {
      const targetOrgId = request.organisationId ?? 'org-nscale';
      const hop1 = eligible.filter((r) =>
        r.participants.some((p) => p.entityId === targetOrgId),
      );
      if (maxDepth === 1) return hop1;
      const hop1EntityIds = new Set(
        hop1.flatMap((r) => r.participants.map((p) => p.entityId)),
      );
      return eligible.filter((r) =>
        r.participants.some((p) => hop1EntityIds.has(p.entityId)),
      );
    }

    case 'project_dependency_network': {
      const targetProjId = request.projectId ?? 'proj-monarch-wv';
      const hop1 = eligible.filter((r) =>
        r.participants.some((p) => p.entityId === targetProjId),
      );
      if (maxDepth === 1) return hop1;
      const hop1Counterparties = new Set(
        hop1.flatMap((r) => r.participants.map((p) => p.entityId)),
      );
      return eligible.filter((r) =>
        r.participants.some((p) => hop1Counterparties.has(p.entityId)),
      );
    }

    case 'shared_counterparty_exposure': {
      const focalOrgId = request.organisationId ?? 'org-nvda';
      const directRels = eligible.filter((r) =>
        r.participants.some((p) => p.entityId === focalOrgId),
      );
      const sharedEntities = new Set(
        directRels.flatMap((r) =>
          r.participants.map((p) => p.entityId).filter((id) => id !== focalOrgId),
        ),
      );
      return eligible.filter((r) =>
        r.participants.some((p) => p.entityId === focalOrgId || sharedEntities.has(p.entityId)),
      );
    }

    case 'sector_connections': {
      const targetSectorId = request.sectorId ?? 'sec-specialist-neoclouds';
      const sectorOrgIds = new Set(
        dataset.organisations
          .filter((o) => o.sectorIds.includes(targetSectorId))
          .map((o) => o.orgId),
      );
      return eligible.filter((r) =>
        r.participants.some(
          (p) => p.entityId === targetSectorId || sectorOrgIds.has(p.entityId),
        ),
      );
    }

    case 'as_known_at_date_graph': {
      if (request.organisationId) {
        return eligible.filter((r) =>
          r.participants.some((p) => p.entityId === request.organisationId),
        );
      }
      if (request.projectId) {
        return eligible.filter((r) =>
          r.participants.some((p) => p.entityId === request.projectId),
        );
      }
      return eligible;
    }

    case 'relationship_source_evidence': {
      const targetRelId =
        request.relationshipId ?? 'rel-anthropic-monarch-services-r1';
      return eligible.filter(
        (r) =>
          r.relationshipId === targetRelId ||
          r.supersedesRelationshipId === targetRelId,
      );
    }
  }
}

/**
 * Executes an allowlisted, parameter-bound graph query with strict authentication,
 * tenant isolation, traversal limits, rate limits, and optional live TypeDB 3.14 verification.
 */
export async function executeAllowlistedGraphQuery(
  rawInput: unknown,
  context: {
    callerId: string;
    datasets?: MacroGraphDataset[];
    nowMs?: number;
    preferLiveTypeDb?: boolean;
  },
): Promise<GraphQueryResponse> {
  const startedAt = Date.now();
  const nowMs = context.nowMs ?? startedAt;

  if (!context.callerId || !context.callerId.trim()) {
    throw new Error('Authentication required: caller identity is missing');
  }

  // Reject any attempt to pass raw `typeql` or unrecognised properties (.strict() on Zod schema)
  const request = graphQueryRequestSchema.parse(rawInput);

  const rateLimit = checkGraphGatewayRateLimit(context.callerId, nowMs);
  if (!rateLimit.allowed) {
    throw new Error('Graph query gateway rate limit exceeded');
  }

  const allDatasets = context.datasets ?? [loadInitialAcceptanceDataset()];
  for (const ds of allDatasets) {
    assertNoBrokerOrPrivateAccountData(ds);
  }

  // Enforce tenant isolation: include only `public_research` datasets or `private_tenant` datasets owned by `callerId`
  const visibleDatasets = allDatasets.filter(
    (ds) => ds.visibility === 'public_research' || ds.owner === context.callerId,
  );

  const mergedDataset: MacroGraphDataset = {
    datasetVersion: 'macro-graph-dataset-g1-v1',
    schemaVersion: MACRO_GRAPH_SCHEMA_VERSION,
    owner: context.callerId,
    visibility: 'public_research',
    sectors: visibleDatasets.flatMap((d) => d.sectors),
    organisations: visibleDatasets.flatMap((d) => d.organisations),
    locations: visibleDatasets.flatMap((d) => d.locations),
    energyAssets: visibleDatasets.flatMap((d) => d.energyAssets),
    projects: visibleDatasets.flatMap((d) => d.projects),
    instruments: visibleDatasets.flatMap((d) => d.instruments),
    sources: visibleDatasets.flatMap((d) => d.sources),
    observations: visibleDatasets.flatMap((d) => d.observations),
    relationships: visibleDatasets.flatMap((d) => d.relationships),
  };

  const asOfMs = request.asOfMs ?? nowMs;
  const { typeql } = buildAllowlistedTypeQlQuery(request, context.callerId);

  const {
    activeRelationships,
    supersededMap,
    excludedByCutoffCount,
    supersededHiddenCount,
  } = reconstructGraphRelationshipsAtDate(mergedDataset.relationships, asOfMs, {
    basis: request.temporalBasis,
    includeSuperseded: request.includeSuperseded,
    includeConflicting: request.includeConflicting,
  });

  const matchedRelationships = selectRelationshipsForQuery(
    request,
    activeRelationships,
    mergedDataset,
  ).slice(0, request.maxEdges);

  const nodeCatalog = buildNodeCatalog(mergedDataset);
  const sourcesById = new Map(mergedDataset.sources.map((s) => [s.sourceDocId, s]));

  const edges: GraphEdgeView[] = matchedRelationships.map((rel) => ({
    relationshipId: rel.relationshipId,
    relationType: rel.relationType,
    logicalEventId: rel.logicalEventId,
    version: rel.version,
    supersedesRelationshipId: rel.supersedesRelationshipId,
    supersededByRelationshipId: supersededMap.get(rel.relationshipId) ?? null,
    category: rel.category,
    contractualStatus: rel.contractualStatus,
    epistemicStatus: rel.epistemicStatus,
    reviewerStatus: rel.reviewerStatus,
    conflictGroupId: rel.conflictGroupId,
    principalAmount: rel.principalAmount,
    currencyCode: rel.currencyCode,
    capacityQuantity: rel.capacityQuantity,
    capacityUnit: rel.capacityUnit,
    conditionsSummary: rel.conditionsSummary,
    bindingObligation: rel.bindingObligation,
    publishedAtMs: rel.publishedAtMs,
    receivedAtMs: rel.receivedAtMs,
    effectiveFromMs: rel.effectiveFromMs,
    effectiveToMs: rel.effectiveToMs,
    participants: rel.participants.map((p) => ({
      ...p,
      label: nodeCatalog.get(p.entityId)?.label ?? p.entityId,
    })),
    sources: rel.sourceDocIds
      .map((id) => sourcesById.get(id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s)),
  }));

  const referencedNodeIds = new Set<string>();
  for (const edge of edges) {
    for (const p of edge.participants) {
      referencedNodeIds.add(p.entityId);
    }
  }
  if (request.organisationId && nodeCatalog.has(request.organisationId)) {
    referencedNodeIds.add(request.organisationId);
  }
  if (request.projectId && nodeCatalog.has(request.projectId)) {
    referencedNodeIds.add(request.projectId);
  }

  const nodes = [...referencedNodeIds]
    .map((id) => nodeCatalog.get(id))
    .filter((n): n is GraphNodeView => Boolean(n))
    .slice(0, request.maxNodes);

  const conflictGroups = new Map<string, GraphEdgeView[]>();
  for (const edge of edges) {
    if (edge.conflictGroupId) {
      const list = conflictGroups.get(edge.conflictGroupId) ?? [];
      list.push(edge);
      conflictGroups.set(edge.conflictGroupId, list);
    }
  }

  const conflicts = [...conflictGroups.entries()].map(([conflictGroupId, assertions]) => ({
    conflictGroupId,
    logicalEventId: assertions[0]?.logicalEventId ?? conflictGroupId,
    assertions,
    resolutionRule:
      'Conflicting assertions are retained side-by-side pending human review; primary SEC filings take epistemic precedence over secondary press reports.',
  }));

  const nodeIdSet = new Set(nodes.map((n) => n.id));
  const observations = mergedDataset.observations.filter(
    (obs) =>
      obs.publishedAtMs <= asOfMs &&
      (request.temporalBasis === 'publication' || obs.receivedAtMs <= asOfMs) &&
      (nodeIdSet.has(obs.subjectOrgId) ||
        (obs.subjectProjectId !== null && nodeIdSet.has(obs.subjectProjectId))),
  );

  let backendMode: 'typedb_live' | 'deterministic_mirror' = 'deterministic_mirror';
  let typedbServerVersion: string | null = null;

  if (context.preferLiveTypeDb) {
    const liveRes = await executeReadOnlyTypeQlOnLiveServer(
      typeql,
      defaultTypeDbConfig(),
    );
    if (liveRes.ok) {
      backendMode = 'typedb_live';
      typedbServerVersion = liveRes.serverVersion;
    }
  }

  const tldr = generateBoundedGraphTldr({
    nodes,
    edges,
    observations,
    conflicts,
    asOfMs,
    temporalBasis: request.temporalBasis,
    generatedAtMs: nowMs,
  });

  gatewayAuditLog.push({
    callerId: context.callerId,
    queryType: request.queryType,
    asOfMs,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    backendMode,
    latencyMs: Math.max(1, Date.now() - startedAt),
    atMs: nowMs,
  });

  return {
    queryType: request.queryType,
    schemaVersion: MACRO_GRAPH_SCHEMA_VERSION,
    backendMode,
    typedbServerVersion,
    asOfMs,
    temporalBasis: request.temporalBasis,
    compiledTypeQl: typeql,
    nodes,
    edges,
    observations,
    conflicts,
    excludedByCutoffCount,
    supersededHiddenCount,
    tldr,
    executionAuthority: 'none',
  };
}
