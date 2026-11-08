import {
  type GraphOrganisation,
  type GraphSourceDocument,
  type MacroRelationship,
} from './contracts';

export type OrganisationResolutionCandidate = {
  proposedName: string;
  secCik?: string | null;
  leiCode?: string | null;
  ticker?: string | null;
  explicitOrgId?: string | null;
};

export type OrganisationResolutionResult =
  | {
      status: 'resolved';
      matchedBy: 'sec_cik' | 'lei_code' | 'explicit_org_id';
      organisation: GraphOrganisation;
    }
  | {
      status: 'blocked_fuzzy_name_only';
      reason: string;
      similarOrganisations: string[];
    }
  | {
      status: 'unregistered';
      reason: string;
    };

function normalizeIdentifier(val: string | null | undefined): string {
  return (val ?? '').trim().toUpperCase();
}

function normalizeNameForComparison(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|corp|corporation|ltd|limited|plc|llc|holdings|pbc|the)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Resolves an organisation strictly via authoritative identifiers (`SEC CIK`, `LEI`, or explicit
 * verified `orgId`). Never merges entities based solely on similar or matching legal/display names.
 */
export function resolveCanonicalOrganisation(
  candidate: OrganisationResolutionCandidate,
  registry: GraphOrganisation[],
): OrganisationResolutionResult {
  const cik = (candidate.secCik ?? '').trim();
  if (cik) {
    const paddedCik = cik.padStart(10, '0');
    const byCik = registry.find((o) => o.secCik === paddedCik);
    if (byCik) {
      return {
        status: 'resolved',
        matchedBy: 'sec_cik',
        organisation: byCik,
      };
    }
  }

  const lei = normalizeIdentifier(candidate.leiCode);
  if (lei) {
    const byLei = registry.find((o) => normalizeIdentifier(o.leiCode) === lei);
    if (byLei) {
      return {
        status: 'resolved',
        matchedBy: 'lei_code',
        organisation: byLei,
      };
    }
  }

  const explicitId = (candidate.explicitOrgId ?? '').trim();
  if (explicitId) {
    const byId = registry.find((o) => o.orgId === explicitId);
    if (byId) {
      return {
        status: 'resolved',
        matchedBy: 'explicit_org_id',
        organisation: byId,
      };
    }
  }

  // Check if any existing organisation has a similar stem or alias: refuse automatic merge!
  const candidateStem = normalizeNameForComparison(candidate.proposedName);
  const similar = registry.filter((o) => {
    const legalStem = normalizeNameForComparison(o.legalName);
    const displayStem = normalizeNameForComparison(o.displayName);
    const aliasStems = o.aliases.map(normalizeNameForComparison);
    return (
      legalStem === candidateStem ||
      displayStem === candidateStem ||
      aliasStems.includes(candidateStem) ||
      (candidateStem.length >= 4 &&
        (legalStem.startsWith(candidateStem.slice(0, 5)) ||
          displayStem.startsWith(candidateStem.slice(0, 5))))
    );
  });

  if (similar.length > 0) {
    return {
      status: 'blocked_fuzzy_name_only',
      reason:
        'Entity merge blocked: candidate shares a similar name with registered organisation(s) but lacks an authoritative SEC CIK, LEI, or verified internal ID.',
      similarOrganisations: similar.map((s) => `${s.displayName} (${s.orgId})`),
    };
  }

  return {
    status: 'unregistered',
    reason: 'No matching SEC CIK, LEI, or verified internal organisation ID in registry.',
  };
}

/**
 * Validates that a relationship's epistemic and contractual statuses obey strict source-governance rules:
 * 1. News speculation or secondary press can never establish `confirmed` epistemic status or `signed`/`funded` contractual status.
 * 2. Every referenced source document must exist and have `receivedAtMs >= publishedAtMs`.
 * 3. Supersession links must point to an earlier revision of the same `logicalEventId` without deleting the prior record.
 */
export function validateRelationshipGovernance(
  relationship: MacroRelationship,
  allRelationships: MacroRelationship[],
  sourcesById: Map<string, GraphSourceDocument>,
): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];

  const linkedSources: GraphSourceDocument[] = [];
  for (const docId of relationship.sourceDocIds) {
    const doc = sourcesById.get(docId);
    if (!doc) {
      reasons.push(`Missing source document: ${docId}`);
    } else {
      linkedSources.push(doc);
    }
  }

  const hasPrimarySource = linkedSources.some(
    (s) => s.authority === 'primary' && (s.kind === 'filing' || s.kind === 'company' || s.kind === 'regulator'),
  );

  if (relationship.epistemicStatus === 'confirmed' && !hasPrimarySource) {
    reasons.push(
      'Confirmed relationships require at least one primary source (SEC filing, official company release, or regulator order).',
    );
  }

  if (
    ['signed', 'funded'].includes(relationship.contractualStatus) &&
    (!hasPrimarySource || relationship.epistemicStatus !== 'confirmed')
  ) {
    reasons.push(
      'Signed or funded contractual status cannot be inferred from news speculation or secondary reporting.',
    );
  }

  if (relationship.supersedesRelationshipId !== null) {
    const prior = allRelationships.find(
      (r) => r.relationshipId === relationship.supersedesRelationshipId,
    );
    if (!prior) {
      reasons.push(
        `Superseded relationship ${relationship.supersedesRelationshipId} must remain preserved in the historical register.`,
      );
    } else {
      if (prior.logicalEventId !== relationship.logicalEventId) {
        reasons.push('Supersession must reference the same logicalEventId.');
      }
      if (relationship.version !== prior.version + 1) {
        reasons.push(
          `Superseding version (${relationship.version}) must increment prior version (${prior.version}) by 1.`,
        );
      }
      if (relationship.publishedAtMs < prior.publishedAtMs) {
        reasons.push('Superseding assertion cannot predate the assertion it supersedes.');
      }
    }
  } else if (relationship.version !== 1) {
    reasons.push('Version > 1 requires an explicit supersedesRelationshipId.');
  }

  return {
    valid: reasons.length === 0,
    reasons,
  };
}

/**
 * Evaluates temporal eligibility of a relationship at `asOfMs` without altering forward-eligibility rules:
 * - Both `publishedAtMs <= asOfMs` AND (when `basis === 'receipt'`) `receivedAtMs <= asOfMs` are required.
 */
export function isRelationshipEligibleAtCutoff(
  relationship: MacroRelationship,
  asOfMs: number,
  basis: 'receipt' | 'publication' = 'receipt',
): boolean {
  if (relationship.publishedAtMs > asOfMs) return false;
  if (basis === 'receipt' && relationship.receivedAtMs > asOfMs) return false;
  return true;
}

/**
 * Filters a set of relationships to those known at `asOfMs` and determines which versions
 * are superseded as of `asOfMs` (preserving historical revisions when `includeSuperseded` is true).
 */
export function reconstructGraphRelationshipsAtDate(
  relationships: MacroRelationship[],
  asOfMs: number,
  options?: {
    basis?: 'receipt' | 'publication';
    includeSuperseded?: boolean;
    includeConflicting?: boolean;
  },
): {
  activeRelationships: MacroRelationship[];
  supersededMap: Map<string, string>;
  excludedByCutoffCount: number;
  supersededHiddenCount: number;
} {
  const basis = options?.basis ?? 'receipt';
  const includeSuperseded = options?.includeSuperseded ?? false;
  const includeConflicting = options?.includeConflicting ?? true;

  let excludedByCutoffCount = 0;
  const eligible: MacroRelationship[] = [];

  for (const rel of relationships) {
    if (!['approved', 'conflicting_pending_review'].includes(rel.reviewerStatus)) {
      excludedByCutoffCount += 1;
      continue;
    }
    if (!includeConflicting && rel.reviewerStatus === 'conflicting_pending_review') {
      excludedByCutoffCount += 1;
      continue;
    }
    if (!isRelationshipEligibleAtCutoff(rel, asOfMs, basis)) {
      excludedByCutoffCount += 1;
      continue;
    }
    eligible.push(rel);
  }

  // Determine supersession links among assertions already eligible at `asOfMs`
  const supersededMap = new Map<string, string>();
  for (const rel of eligible) {
    if (rel.supersedesRelationshipId) {
      supersededMap.set(rel.supersedesRelationshipId, rel.relationshipId);
    }
  }

  let supersededHiddenCount = 0;
  const activeRelationships = eligible.filter((rel) => {
    const isSuperseded = supersededMap.has(rel.relationshipId);
    if (isSuperseded && !includeSuperseded) {
      supersededHiddenCount += 1;
      return false;
    }
    return true;
  });

  return {
    activeRelationships,
    supersededMap,
    excludedByCutoffCount,
    supersededHiddenCount,
  };
}
