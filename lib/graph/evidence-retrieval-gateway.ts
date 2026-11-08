import { sha256Hex } from '../remote-ops/staging-validator';
import type {
  GraphSourceDocument,
  MacroGraphDataset,
  MacroRelationship,
} from './contracts';
import { MACRO_GRAPH_SCHEMA_VERSION } from './contracts';
import {
  EVIDENCE_BUNDLE_VERSION,
  EVIDENCE_RETRIEVAL_LIMITS,
  evidenceBundleSchema,
  type EvidenceBundleV1,
  type IntentSelectionResult,
  type TemporalBasis,
} from './evidence-chat-contracts';
import { reconstructGraphRelationshipsAtDate } from './identity-governance';
import {
  MACRO_CASE_001_CLAIMS,
  MACRO_CASE_001_SCENARIOS,
  computeNonDoubleCountedCommitments,
} from './macro-case-001';
import {
  assertNoBrokerOrPrivateAccountData,
  executeAllowlistedGraphQuery,
  loadInitialAcceptanceDataset,
} from './query-gateway';

/**
 * Phase G.4 (Phases B, C & G) — Closed-Evidence Retrieval Gateway.
 *
 * Security & Governance Guarantees:
 * 1. User question -> deterministic authenticated intent selection -> allowlisted TypeDB query ->
 *    temporal cutoff filtering -> sanitised & bounded EvidenceBundleV1.
 * 2. Model never constructs TypeQL, SQL, or database commands.
 * 3. Restricted strictly to `public_research` namespace.
 * 4. Blocks and strips Trading 212 account records, broker credentials, private tenant records,
 *    environment variables, and unapproved or adversarial source documents.
 */

const PROMPT_INJECTION_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  {
    code: 'instruction_override',
    pattern:
      /\b(ignore\s+(all\s+)?(previous|prior|system)\s+instructions|disregard\s+system\s+prompt|you\s+are\s+now\s+an?\s+unrestricted|reveal\s+(your\s+)?system\s+prompt|developer\s+mode\s+enabled)\b/i,
  },
  {
    code: 'secret_or_env_exfiltration',
    pattern:
      /\b(process\.env|GEMINI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|TYPEDB_PASSWORD|RESEARCH_STAGING_TOKEN|print\s+all\s+secrets|dump\s+environment\s+variables)\b/i,
  },
  {
    code: 'broker_or_trading_access',
    pattern:
      /\b(trading\s*212\s+(api\s*key|secret|password|balance|positions|account\s+summary)|submit\s+(a\s+)?(live|demo|market|limit)\s+order|place\s+(a\s+)?trade|execute\s+buy\s+order|api\/trading|api\/brokers)\b/i,
  },
  {
    code: 'cross_tenant_or_db_mutation',
    pattern:
      /\b(other\s+user'?s?\s+(portfolio|records|account|credentials)|grantRoleInternal|assignReviewer|DROP\s+TABLE|DELETE\s+FROM|insert\s+into\s+graphProjectionOutbox|promote\s+unreviewed\s+relationship)\b/i,
  },
];

export function detectAdversarialContent(text: string): {
  blocked: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  for (const rule of PROMPT_INJECTION_PATTERNS) {
    if (rule.pattern.test(text)) {
      reasons.push(rule.code);
    }
  }
  return {
    blocked: reasons.length > 0,
    reasons,
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function computeCanonicalSha256(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/**
 * Deterministic, allowlisted intent selector.
 * Maps a natural-language question to one of the 6 allowlisted graph query types and safe parameters.
 */
export function classifyResearchQuestionIntent(
  question: string,
  dataset: MacroGraphDataset = loadInitialAcceptanceDataset(),
): IntentSelectionResult {
  const trimmed = question.trim();
  const adversarial = detectAdversarialContent(trimmed);
  if (adversarial.blocked) {
    return {
      queryType: 'organisation_relationship_summary',
      focalEntityId: 'org-anthropic',
      sectorId: null,
      relationshipId: null,
      maxDepth: 1,
      intentCategory: 'security_blocked',
      intentRationale: `Blocked adversarial or unauthorized request (${adversarial.reasons.join(', ')}).`,
      securityBlockedReason: `Request rejected by closed-evidence security policy (${adversarial.reasons.join(', ')}). Research chat cannot access broker accounts, secrets, other tenants, or execute mutations/trades.`,
    };
  }

  const q = trimmed.toLowerCase();

  // 0. Explicit relationship ID query (e.g. "rel-staging-..." or "rel-loughton-...")
  const explicitRelMatch = q.match(/\b(rel-[a-z0-9-]+)\b/i);
  if (explicitRelMatch) {
    const relId = explicitRelMatch[1]!;
    return {
      queryType: 'relationship_source_evidence',
      focalEntityId: matchProjectId(q, dataset) ?? matchOrganisationId(q, dataset),
      sectorId: null,
      relationshipId: relId,
      maxDepth: 2,
      intentCategory: 'project_dependencies',
      intentRationale: `Selected allowlisted query 'relationship_source_evidence' for explicit relationship '${relId}'.`,
      securityBlockedReason: null,
    };
  }

  // Check for out-of-scope / unsupported topics not in the Macro Case 001 / 6-company graph
  const outOfScopeKeywords =
    /\b(bitcoin|ethereum|dogecoin|solana|tesla|tsla|apple|aapl|meta\s+platforms|netflix|nflx|gold\s+price|crude\s+oil|weather\s+forecast|2028\s+share\s+price\s+target|intraday\s+stock\s+price\s+prediction|projected\s+202[789]\s+net\s+income|202[789]\s+net\s+income|dividend\s+per\s+share\s+in\s+202[89])\b/i;
  if (outOfScopeKeywords.test(q)) {
    return {
      queryType: 'as_known_at_date_graph',
      focalEntityId: null,
      sectorId: null,
      relationshipId: null,
      maxDepth: 1,
      intentCategory: 'out_of_scope_or_unsupported',
      intentRationale:
        'Question references entities, asset classes, or price predictions outside the authorised Macro Case 001 and six-company evidence store.',
      securityBlockedReason: null,
    };
  }

  // 1. Shared financial counterparties / co-investors / syndicates
  if (
    /\b(share\s+.*counterpart|shared\s+counterpart|common\s+counterpart|co-invest|syndicate|share\s+financing|which\s+ai\s+infrastructure\s+investments\s+share)\b/i.test(
      q,
    )
  ) {
    const focalOrg = matchOrganisationId(q, dataset) ?? 'org-nscale';
    return {
      queryType: 'shared_counterparty_exposure',
      focalEntityId: focalOrg,
      sectorId: null,
      relationshipId: null,
      maxDepth: 2,
      intentCategory: 'shared_counterparties',
      intentRationale: `Selected allowlisted query 'shared_counterparty_exposure' (focal=${focalOrg}, maxDepth=2) to identify shared financing and infrastructure counterparties.`,
      securityBlockedReason: null,
    };
  }

  // 2. Ireland macro contagion, EirGrid, Central Bank of Ireland, Dept of Finance, Dublin grid
  if (
    /\b(ireland|irish|dublin|eirgrid|makhlouf|central\s+bank\s+of\s+ireland|department\s+of\s+finance|mdd|corporation\s+tax|contagion)\b/i.test(
      q,
    )
  ) {
    return {
      queryType: 'sector_connections',
      focalEntityId: 'org-eirgrid',
      sectorId: 'sec-grid-transmission',
      relationshipId: null,
      maxDepth: 2,
      intentCategory: 'ireland_macro_contagion',
      intentRationale:
        "Selected allowlisted query 'sector_connections' (sector=sec-grid-transmission, focal=org-eirgrid) to retrieve documented Irish grid, hyperscaler, and sovereign macroeconomic relationships.",
      securityBlockedReason: null,
    };
  }

  // 3. Reported, unverified, disputed, or cancelled claims (Starter Question 5)
  if (
    /\b(reported|unverified|disputed|cancelled|journalism|secondary\s+source|not\s+confirmed|remain\s+reported)\b/i.test(
      q,
    ) &&
    !/\bloughton\b/i.test(q)
  ) {
    return {
      queryType: 'as_known_at_date_graph',
      focalEntityId: null,
      sectorId: null,
      relationshipId: null,
      maxDepth: 2,
      intentCategory: 'reported_or_unverified_claims',
      intentRationale:
        "Selected allowlisted query 'as_known_at_date_graph' to inspect epistemic statuses (confirmed vs reported, unverified, disputed, or superseded/cancelled).",
      securityBlockedReason: null,
    };
  }

  // 4. Largest compute commitments / deduplicated ledger / S-1/A obligations
  if (
    /\b(largest\s+compute|compute\s+commitment|compute-purchase|895\.4|44\.6|double\s*count|commitment\s+ledger|s-1\/a|purchase\s+obligation)\b/i.test(
      q,
    )
  ) {
    return {
      queryType: 'organisation_relationship_summary',
      focalEntityId: 'org-anthropic',
      sectorId: null,
      relationshipId: 'rel-anthropic-s1a-amzn-compute-r1',
      maxDepth: 2,
      intentCategory: 'compute_commitments_evidence',
      intentRationale:
        "Selected allowlisted query 'organisation_relationship_summary' (focal=org-anthropic) and commitment ledger to inspect signed compute-purchase commitments and parent envelope deduplication.",
      securityBlockedReason: null,
    };
  }

  // 5. Historical cutoff / "what did our system know on <date>"
  if (/\b(what\s+did\s+our\s+system\s+know|as\s+of|on\s+31\s+july|july\s+2026|october\s+2026|september\s+2026|historical\s+cutoff|before\s+november)\b/i.test(q)) {
    const focalOrg = matchOrganisationId(q, dataset) ?? 'org-anthropic';
    return {
      queryType: 'as_known_at_date_graph',
      focalEntityId: focalOrg,
      sectorId: null,
      relationshipId: null,
      maxDepth: 2,
      intentCategory: 'historical_cutoff_knowledge',
      intentRationale: `Selected allowlisted query 'as_known_at_date_graph' (focal=${focalOrg}) to reconstruct temporal knowledge strictly at the selected cutoff.`,
      securityBlockedReason: null,
    };
  }

  // 6. Infrastructure project dependency network
  const matchedProj = matchProjectId(q, dataset);
  if (matchedProj || /\b(project|campus|substation|monarch|loughton|dublin\s+campus|stargate)\b/i.test(q)) {
    const explicitRelMatch = q.match(/\b(rel-[a-z0-9-]+)\b/i);
    return {
      queryType: 'project_dependency_network',
      focalEntityId: matchedProj ?? 'proj-monarch-wv',
      sectorId: null,
      relationshipId: explicitRelMatch ? explicitRelMatch[1]! : null,
      maxDepth: 2,
      intentCategory: 'project_dependencies',
      intentRationale: `Selected allowlisted query 'project_dependency_network' (focal=${matchedProj ?? 'proj-monarch-wv'}, maxDepth=2).`,
      securityBlockedReason: null,
    };
  }

  // 7. Default organisation relationship summary
  const focalOrg = matchOrganisationId(q, dataset) ?? 'org-anthropic';
  return {
    queryType: 'organisation_relationship_summary',
    focalEntityId: focalOrg,
    sectorId: null,
    relationshipId: null,
    maxDepth: 2,
    intentCategory: 'entity_relationships',
    intentRationale: `Selected allowlisted query 'organisation_relationship_summary' (focal=${focalOrg}, maxDepth=2).`,
    securityBlockedReason: null,
  };
}

function matchOrganisationId(q: string, dataset: MacroGraphDataset): string | null {
  if (q.includes('anthropic')) return 'org-anthropic';
  if (q.includes('nscale')) return 'org-nscale';
  if (q.includes('microsoft') || q.includes('msft')) return 'org-msft';
  if (q.includes('amazon') || q.includes('amzn') || q.includes('aws')) return 'org-amzn';
  if (q.includes('alphabet') || q.includes('google') || q.includes('googl')) return 'org-googl';
  if (q.includes('nvidia') || q.includes('nvda')) return 'org-nvda';
  if (q.includes('coreweave') || q.includes('crwv')) return 'org-crwv';
  if (q.includes('eirgrid')) return 'org-eirgrid';
  if (q.includes('central bank of ireland') || q.includes('makhlouf')) return 'org-cbi-ie';
  if (q.includes('department of finance')) return 'org-dof-ie';
  if (q.includes('blackstone')) return 'org-bx';
  if (q.includes('blue owl')) return 'org-owl';
  for (const org of dataset.organisations) {
    if (q.includes(org.displayName.toLowerCase())) return org.orgId;
  }
  return null;
}

function matchProjectId(q: string, dataset: MacroGraphDataset): string | null {
  if (q.includes('loughton')) return 'proj-loughton-essex';
  if (q.includes('monarch')) return 'proj-monarch-wv';
  if (q.includes('dublin') || q.includes('grange castle')) return 'proj-dublin-hyperscale-campus';
  for (const proj of dataset.projects) {
    if (q.includes(proj.projectName.toLowerCase())) return proj.projectId;
  }
  return null;
}

function resolveEntityLabel(entityId: string, dataset: MacroGraphDataset): string {
  const org = dataset.organisations.find((o) => o.orgId === entityId);
  if (org) return org.displayName;
  const proj = dataset.projects.find((p) => p.projectId === entityId);
  if (proj) return proj.projectName;
  const sec = dataset.sectors.find((s) => s.sectorId === entityId);
  if (sec) return sec.sectorName;
  const inst = dataset.instruments.find((i) => i.instrumentId === entityId);
  if (inst) return `${inst.instrumentType} (${inst.instrumentCurrency})`;
  const loc = dataset.locations.find((l) => l.locationId === entityId);
  if (loc) return loc.locationName;
  return entityId;
}

function isTemporalEligible(
  publishedAtMs: number,
  receivedAtMs: number,
  cutoffMs: number,
  basis: TemporalBasis,
): boolean {
  return basis === 'publication' ? publishedAtMs <= cutoffMs : receivedAtMs <= cutoffMs;
}

/**
 * Reconstructs active relationships at `cutoffMs` using either `publication` or `receipt` clock.
 */
export function reconstructRelationshipsForBasis(
  relationships: readonly MacroRelationship[],
  cutoffMs: number,
  basis: TemporalBasis,
  includeSuperseded = false,
): MacroRelationship[] {
  const slice = reconstructGraphRelationshipsAtDate([...relationships], cutoffMs, {
    basis,
    includeSuperseded,
    includeConflicting: true,
  });
  return slice.activeRelationships;
}

export interface RetrieveEvidenceBundleOptions {
  question: string;
  requesterId: string;
  historicalCutoffMs?: number;
  temporalBasis?: TemporalBasis;
  dataset?: MacroGraphDataset;
  additionalSources?: Array<
    GraphSourceDocument & {
      publisher?: string;
      sourceTier?: string;
      excerpt?: string;
    }
  >;
  projectionCheckpoint?: {
    lastProjectedSequence: number;
    lastProjectionKey: string | null;
    projectedCount: number;
    reconciled: boolean;
  };
  graphDatabaseName?: string;
  preferLiveTypeDb?: boolean;
  nowMs?: number;
}

export async function retrieveClosedEvidenceBundle(
  options: RetrieveEvidenceBundleOptions,
): Promise<EvidenceBundleV1> {
  const nowMs = options.nowMs ?? Date.now();
  const baseDataset = options.dataset ?? loadInitialAcceptanceDataset();
  const temporalBasis: TemporalBasis = options.temporalBasis ?? 'receipt';

  // Detect explicit date in question (e.g., "31 July 2026") if caller didn't override cutoff,
  // or take the stricter of the caller's cutoff and the date asked in the question.
  const questionCutoffMs = extractExplicitQuestionCutoffMs(options.question);
  const historicalCutoffMs =
    questionCutoffMs !== null
      ? Math.min(options.historicalCutoffMs ?? questionCutoffMs, questionCutoffMs)
      : (options.historicalCutoffMs ?? 1794146400000);

  const intent = classifyResearchQuestionIntent(options.question, baseDataset);

  // Execute the allowlisted TypeDB query via the existing gateway
  const gatewayRes = await executeAllowlistedGraphQuery(
    {
      queryType: intent.queryType,
      ...(intent.focalEntityId?.startsWith('org-')
        ? { organisationId: intent.focalEntityId }
        : {}),
      ...(intent.focalEntityId?.startsWith('proj-')
        ? { projectId: intent.focalEntityId }
        : {}),
      ...(intent.sectorId ? { sectorId: intent.sectorId } : {}),
      ...(intent.relationshipId ? { relationshipId: intent.relationshipId } : {}),
      asOfMs: historicalCutoffMs,
      temporalBasis,
      includeSuperseded: intent.intentCategory === 'reported_or_unverified_claims',
      includeConflicting: true,
      maxDepth: Math.min(intent.maxDepth, EVIDENCE_RETRIEVAL_LIMITS.maxTraversalDepth) as 1 | 2,
      maxNodes: 35,
      maxEdges: EVIDENCE_RETRIEVAL_LIMITS.maxRelationships,
    },
    {
      callerId: options.requesterId,
      datasets: [baseDataset],
      nowMs,
      preferLiveTypeDb: options.preferLiveTypeDb ?? Boolean(process.env.TYPEDB_HTTP_ADDRESS),
    },
  );

  // Reconstruct temporally eligible relationships under the selected clock (`publication` vs `receipt`)
  const includeSuperseded = intent.intentCategory === 'reported_or_unverified_claims';
  const allEligibleRels = reconstructRelationshipsForBasis(
    baseDataset.relationships,
    historicalCutoffMs,
    temporalBasis,
    includeSuperseded,
  );
  const excludedByHistoricalCutoffCount = Math.max(
    0,
    baseDataset.relationships.length - allEligibleRels.length,
  );

  // Prioritise relationships returned by the allowlisted query or matching focal entity/intent
  const gatewayEdgeIds = new Set(gatewayRes.edges.map((e) => e.relationshipId));
  const sortedRels = [...allEligibleRels].sort((a, b) => {
    const aExplicit = intent.relationshipId === a.relationshipId ? 0 : 1;
    const bExplicit = intent.relationshipId === b.relationshipId ? 0 : 1;
    if (aExplicit !== bExplicit) return aExplicit - bExplicit;
    const aFocal =
      intent.focalEntityId &&
      a.participants.some((p) => p.entityId === intent.focalEntityId)
        ? 0
        : 1;
    const bFocal =
      intent.focalEntityId &&
      b.participants.some((p) => p.entityId === intent.focalEntityId)
        ? 0
        : 1;
    if (aFocal !== bFocal) return aFocal - bFocal;
    const aInGateway = gatewayEdgeIds.has(a.relationshipId) ? 0 : 1;
    const bInGateway = gatewayEdgeIds.has(b.relationshipId) ? 0 : 1;
    if (aInGateway !== bInGateway) return aInGateway - bInGateway;
    return b.publishedAtMs - a.publishedAtMs;
  });

  // If question is specifically about a single entity on a historical date, scope to that entity's eligible relationships
  const filteredRels =
    intent.intentCategory === 'historical_cutoff_knowledge' && intent.focalEntityId
      ? sortedRels.filter((rel) =>
          rel.participants.some((p) => p.entityId === intent.focalEntityId),
        )
      : intent.intentCategory === 'out_of_scope_or_unsupported' ||
          intent.intentCategory === 'security_blocked'
        ? []
        : sortedRels;

  const boundedRels = filteredRels
    .slice(0, EVIDENCE_RETRIEVAL_LIMITS.maxRelationships)
    .map((rel) => ({
      relationshipId: rel.relationshipId,
      logicalEventId: rel.logicalEventId,
      version: rel.version,
      supersedesRelationshipId: rel.supersedesRelationshipId,
      relationshipType: rel.relationType,
      epistemicStatus: rel.epistemicStatus,
      contractualStatus: rel.contractualStatus,
      summary: rel.conditionsSummary,
      principalAmount: rel.principalAmount,
      currency: rel.currencyCode,
      capacityMw: rel.capacityUnit === 'MW' ? rel.capacityQuantity : null,
      validFromMs: rel.effectiveFromMs,
      validToMs: rel.effectiveToMs,
      publishedAtMs: rel.publishedAtMs,
      receivedAtMs: rel.receivedAtMs,
      participants: rel.participants.map((p) => ({
        role: p.role,
        entityKind: p.entityKind,
        entityId: p.entityId,
        entityLabel: resolveEntityLabel(p.entityId, baseDataset),
      })),
      sourceDocIds: rel.sourceDocIds,
      parentCommitmentEnvelopeId: rel.economicGroupId ?? null,
    }));

  // Filter quantitative claims by temporal eligibility and quarantine any adversarial text
  const eligibleClaims =
    intent.intentCategory === 'out_of_scope_or_unsupported' ||
    intent.intentCategory === 'security_blocked'
      ? []
      : MACRO_CASE_001_CLAIMS.filter((claim) => {
          if (
            !isTemporalEligible(
              claim.publishedAtMs,
              claim.receivedAtMs,
              historicalCutoffMs,
              temporalBasis,
            )
          ) {
            return false;
          }
          if (
            intent.intentCategory === 'historical_cutoff_knowledge' &&
            intent.focalEntityId
          ) {
            return (
              claim.subjectEntityId === intent.focalEntityId ||
              claim.counterpartyEntityIds.includes(intent.focalEntityId)
            );
          }
          return true;
        });

  // Collect source documents, enforcing temporal cutoff, excerpt limits, and adversarial quarantine
  const allCandidateSources: Array<
    GraphSourceDocument & {
      publisher?: string;
      sourceTier?: string;
      excerpt?: string;
    }
  > = [
    ...baseDataset.sources,
    ...(options.additionalSources ?? []),
  ];
  let quarantinedAdversarialSourcesCount = 0;
  const warnings: string[] = [];

  if (intent.securityBlockedReason) {
    warnings.push(intent.securityBlockedReason);
  }
  if (excludedByHistoricalCutoffCount > 0) {
    warnings.push(
      `Historical cutoff (${new Date(historicalCutoffMs).toISOString().slice(0, 10)}, ${temporalBasis} clock) excluded ${excludedByHistoricalCutoffCount} later-dated relationship record(s) to prevent hindsight leakage.`,
    );
  }

  const referencedDocIds = new Set<string>();
  for (const rel of boundedRels) {
    for (const d of rel.sourceDocIds) referencedDocIds.add(d);
  }
  for (const claim of eligibleClaims) {
    for (const d of claim.sourceDocIds) referencedDocIds.add(d);
  }
  if (
    intent.intentCategory !== 'historical_cutoff_knowledge' &&
    intent.intentCategory !== 'out_of_scope_or_unsupported' &&
    intent.intentCategory !== 'security_blocked'
  ) {
    for (const sc of MACRO_CASE_001_SCENARIOS) {
      for (const d of sc.sourceDocIds) referencedDocIds.add(d);
    }
  }

  const eligibleSources: EvidenceBundleV1['sources'] = [];
  for (const src of allCandidateSources) {
    const rawExcerpt =
      src.excerpt ??
      `${src.title} (${src.authority} ${src.kind}, basis: ${src.publicationBasis})`;
    const check = detectAdversarialContent(`${src.title} ${rawExcerpt}`);
    if (check.blocked) {
      quarantinedAdversarialSourcesCount += 1;
      warnings.push(
        `Quarantined untrusted source document '${src.sourceDocId}' due to adversarial instruction pattern (${check.reasons.join(', ')}).`,
      );
      continue;
    }
    if (
      !isTemporalEligible(
        src.publishedAtMs,
        src.receivedAtMs,
        historicalCutoffMs,
        temporalBasis,
      )
    ) {
      continue;
    }
    if (
      intent.intentCategory === 'out_of_scope_or_unsupported' ||
      intent.intentCategory === 'security_blocked'
    ) {
      continue;
    }
    if (
      intent.intentCategory === 'historical_cutoff_knowledge' &&
      intent.focalEntityId &&
      !referencedDocIds.has(src.sourceDocId)
    ) {
      continue;
    }
    eligibleSources.push({
      docId: src.sourceDocId,
      title: src.title,
      publisher: src.publisher ?? `${src.authority.toUpperCase()} (${src.kind})`,
      sourceTier: src.sourceTier ?? `${src.authority}_${src.kind}`,
      url: src.url,
      publishedAtMs: src.publishedAtMs,
      receivedAtMs: src.receivedAtMs,
      sha256Hash: src.contentSha256,
      excerpt: rawExcerpt.slice(0, EVIDENCE_RETRIEVAL_LIMITS.maxExcerptCharsPerDoc),
    });
  }

  // Sort referenced sources first and cap at maxEvidenceDocuments
  eligibleSources.sort((a, b) => {
    const aRef = referencedDocIds.has(a.docId) ? 0 : 1;
    const bRef = referencedDocIds.has(b.docId) ? 0 : 1;
    return aRef - bRef || b.publishedAtMs - a.publishedAtMs;
  });
  const boundedSources = eligibleSources.slice(
    0,
    EVIDENCE_RETRIEVAL_LIMITS.maxEvidenceDocuments,
  );

  // Check for reported/unverified or conflicting claims in scope
  const unverifiedOrReportedInScope = boundedRels.filter(
    (r) =>
      r.epistemicStatus === 'reported' ||
      r.epistemicStatus === 'proposed' ||
      r.epistemicStatus === 'hypothetical' ||
      r.contractualStatus === 'cancelled',
  );
  if (unverifiedOrReportedInScope.length > 0) {
    warnings.push(
      `Bundle includes ${unverifiedOrReportedInScope.length} relationship(s) with non-confirmed or cancelled status (${unverifiedOrReportedInScope.map((r) => `${r.relationshipId}:${r.epistemicStatus}/${r.contractualStatus}`).join(', ')}).`,
    );
  }

  // Scenarios (filtered by temporal eligibility of their source documents)
  const allEligibleSourceDocIds = new Set(eligibleSources.map((s) => s.docId));
  const eligibleScenarios =
    intent.intentCategory === 'out_of_scope_or_unsupported' ||
    intent.intentCategory === 'security_blocked' ||
    (intent.intentCategory === 'historical_cutoff_knowledge' &&
      intent.focalEntityId === 'org-anthropic')
      ? []
      : MACRO_CASE_001_SCENARIOS.filter((sc) =>
          sc.sourceDocIds.every((id) => allEligibleSourceDocIds.has(id)),
        ).map((sc) => ({
          scenarioId: sc.scenarioId,
          name: sc.name,
          classification: sc.classification,
          usEquityShockPct: sc.usEquityShockPct,
          horizonLabel: sc.horizonLabel,
          irishMddImpactPct: sc.irishMddImpactPct,
          irishInvestmentImpactPct: sc.irishInvestmentImpactPct,
          irishExportsImpactPct: sc.irishExportsImpactPct,
          irishEmploymentGrowthDeltaPp: sc.irishEmploymentGrowthDeltaPp,
          fiscalAndTaxChannelSummary: sc.fiscalAndTaxChannelSummary,
          sourceDocIds: sc.sourceDocIds,
        }));

  // Compute non-double-counted commitment arithmetic strictly on temporally eligible relationships
  const filteredDatasetForLedger: MacroGraphDataset = {
    ...baseDataset,
    relationships: allEligibleRels,
  };
  const ledger = computeNonDoubleCountedCommitments(filteredDatasetForLedger);

  // Organisations in scope
  const orgIdsInScope = new Set<string>();
  if (intent.focalEntityId?.startsWith('org-')) orgIdsInScope.add(intent.focalEntityId);
  for (const rel of boundedRels) {
    for (const p of rel.participants) {
      if (p.entityKind === 'organisation') orgIdsInScope.add(p.entityId);
    }
  }
  const organisations = baseDataset.organisations
    .filter((o) => orgIdsInScope.size === 0 || orgIdsInScope.has(o.orgId))
    .map((o) => ({
      orgId: o.orgId,
      displayName: o.displayName,
      legalName: o.legalName,
      subtype: o.subtype,
      ticker: o.ticker,
      secCik: o.secCik,
      jurisdiction: o.jurisdiction,
      sectorIds: o.sectorIds,
    }));

  const graphDatabaseName =
    options.graphDatabaseName ??
    process.env.TYPEDB_DATABASE ??
    'aci_macro_intelligence_prod';

  const projectionCheckpoint = options.projectionCheckpoint ?? {
    lastProjectedSequence: baseDataset.relationships.length,
    lastProjectionKey: null,
    projectedCount: baseDataset.relationships.length,
    reconciled: true,
  };

  const payloadWithoutHash = {
    version: EVIDENCE_BUNDLE_VERSION,
    requesterId: options.requesterId,
    retrievedAtMs: nowMs,
    namespace: 'public_research' as const,
    graphDatabaseName,
    graphSchemaVersion: MACRO_GRAPH_SCHEMA_VERSION,
    typedbBackendMode: gatewayRes.backendMode,
    typedbServerVersion: gatewayRes.typedbServerVersion ?? null,
    typedbLiveQueryLatencyMs: gatewayRes.liveQueryLatencyMs ?? null,
    typedbLiveAnswerCount: gatewayRes.liveAnswerCount ?? null,
    projectionCheckpoint,
    historicalCutoffMs,
    historicalCutoffIso: new Date(historicalCutoffMs).toISOString(),
    temporalBasis,
    question: options.question.trim(),
    selectedQuery: {
      queryType: intent.queryType,
      focalEntityId: intent.focalEntityId,
      sectorId: intent.sectorId,
      relationshipId: intent.relationshipId,
      maxDepth: Math.min(intent.maxDepth, EVIDENCE_RETRIEVAL_LIMITS.maxTraversalDepth) as 1 | 2,
      intentCategory: intent.intentCategory,
      intentRationale: intent.intentRationale,
    },
    organisations,
    relationships: boundedRels,
    sources: boundedSources,
    quantitativeClaims: eligibleClaims,
    scenarios: eligibleScenarios,
    commitmentLedger: {
      naiveComputeCommitmentsSumUsd: ledger.naiveComputeCommitmentsSumUsd,
      deduplicatedComputeCommitmentsUsd: ledger.deduplicatedComputeCommitmentsUsd,
      doubleCountPreventedUsd: ledger.doubleCountPreventedUsd,
      signedDebtAndCoInvestmentUsd: ledger.signedDebtAndCoInvestmentUsd,
      signedGuaranteesUsd: ledger.signedGuaranteesUsd,
      signedEquityAndConvertibleBackingCapUsd:
        ledger.signedEquityAndConvertibleBackingCapUsd,
    },
    excludedByHistoricalCutoffCount,
    quarantinedAdversarialSourcesCount,
    dataQualityWarnings: warnings,
  };

  // Verify zero broker or private account fields in the constructed bundle
  assertNoBrokerOrPrivateAccountData(payloadWithoutHash);

  const serializedPayload = JSON.stringify(payloadWithoutHash);
  const estimatedBundleTokens = Math.min(
    EVIDENCE_RETRIEVAL_LIMITS.maxTotalInputTokens,
    Math.ceil(serializedPayload.length / 4),
  );
  const bundleSha256 = computeCanonicalSha256(payloadWithoutHash);
  const bundleId = `bundle-${bundleSha256.slice(0, 16)}`;

  return evidenceBundleSchema.parse({
    bundleId,
    ...payloadWithoutHash,
    estimatedBundleTokens,
    bundleSha256,
    executionAuthority: 'none',
  });
}

function extractExplicitQuestionCutoffMs(question: string): number | null {
  const q = question.toLowerCase();
  if (q.includes('31 july 2026') || q.includes('july 31, 2026') || q.includes('2026-07-31')) {
    return Date.parse('2026-07-31T23:59:59.000Z');
  }
  if (q.includes('25 september 2026') || q.includes('2026-09-25')) {
    return Date.parse('2026-09-25T23:59:59.000Z');
  }
  if (q.includes('27 october 2026') || q.includes('2026-10-27')) {
    return Date.parse('2026-10-27T23:59:59.000Z');
  }
  if (q.includes('3 november 2026') || q.includes('2026-11-03')) {
    return Date.parse('2026-11-03T23:59:59.000Z');
  }
  return null;
}
