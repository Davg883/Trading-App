import {
  MACRO_GRAPH_SCHEMA_VERSION,
  macroGraphDatasetSchema,
  type MacroGraphDataset,
  type MacroRelationship,
  type VisibilityScope,
} from './contracts';
import { sha256Hex } from '../remote-ops/staging-validator';
import { validateRelationshipGovernance } from './identity-governance';
import {
  compileEnergyAssetPutTypeQl,
  compileEvidentialSupportInsertTypeQl,
  compileInstrumentPutTypeQl,
  compileLocationPutTypeQl,
  compileObservationPutTypeQl,
  compileOrganisationPutTypeQl,
  compileProjectPutTypeQl,
  compileRelationshipInsertTypeQl,
  compileSectorPutTypeQl,
  compileSourceDocumentPutTypeQl,
} from './typedb-schema';

export type OutboxStatus = 'pending' | 'retrying' | 'projected' | 'dead_letter';

export type OutboxProjectionItem = {
  sequence: number;
  projectionKey: string;
  owner: string;
  visibility: VisibilityScope;
  sourceTable: string;
  sourceRecordId: string;
  sourceEvidenceIds: string[];
  graphSchemaVersion: typeof MACRO_GRAPH_SCHEMA_VERSION;
  relationshipId: string;
  typeqlStatements: string[];
  status: OutboxStatus;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAtMs: number;
  lastError: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  projectedAtMs: number | null;
  executionAuthority: 'none';
};

export type ProjectionCheckpoint = {
  checkpointKey: string;
  owner: string;
  lastProjectedSequence: number;
  lastProjectionKey: string | null;
  graphSchemaVersion: typeof MACRO_GRAPH_SCHEMA_VERSION;
  projectedCount: number;
  pendingCount: number;
  retryingCount: number;
  deadLetterCount: number;
  maxProjectionLagMs: number;
  replayedAtMs: number | null;
  updatedAtMs: number;
};

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

/**
 * Generates a deterministic SHA-256 projection key from the schema version, tenant owner,
 * and canonical relationship payload. Re-projecting the same record produces the exact same key.
 */
export function computeDeterministicProjectionKey(
  owner: string,
  visibility: VisibilityScope,
  relationship: MacroRelationship,
): string {
  const payload = canonicalJson({
    schemaVersion: MACRO_GRAPH_SCHEMA_VERSION,
    owner,
    visibility,
    relationshipId: relationship.relationshipId,
    logicalEventId: relationship.logicalEventId,
    version: relationship.version,
    supersedesRelationshipId: relationship.supersedesRelationshipId,
    contractualStatus: relationship.contractualStatus,
    epistemicStatus: relationship.epistemicStatus,
    principalAmount: relationship.principalAmount,
    currencyCode: relationship.currencyCode,
    participants: relationship.participants,
    sourceDocIds: relationship.sourceDocIds,
    publishedAtMs: relationship.publishedAtMs,
    receivedAtMs: relationship.receivedAtMs,
  });
  return `proj:${sha256Hex(payload)}`;
}

export function computeRetryBackoffMs(attemptCount: number, baseMs = 5_000): number {
  const exp = Math.min(Math.max(0, attemptCount - 1), 6);
  return baseMs * Math.pow(2, exp);
}

/**
 * Compiles all foundational entity `put` statements for a validated dataset.
 */
export function compileDatasetEntityBootstrapStatements(dataset: MacroGraphDataset): string[] {
  const parsed = macroGraphDatasetSchema.parse(dataset);
  const statements: string[] = [];

  for (const sector of parsed.sectors) {
    statements.push(compileSectorPutTypeQl(sector));
  }
  for (const loc of parsed.locations) {
    statements.push(compileLocationPutTypeQl(loc));
  }
  for (const asset of parsed.energyAssets) {
    statements.push(compileEnergyAssetPutTypeQl(asset));
  }
  for (const org of parsed.organisations) {
    statements.push(compileOrganisationPutTypeQl(org, parsed.owner, parsed.visibility));
    for (const secId of org.sectorIds) {
      const partId = `secpart:${org.orgId}:${secId}`;
      statements.push(
        [
          'match',
          `  $org isa organisation, has org_id "${org.orgId}";`,
          `  $sec isa sector_classification, has sector_id "${secId}";`,
          'put',
          `  $sp isa sector_participation,`,
          `    links (participant_organisation: $org, target_sector: $sec),`,
          `    has relationship_id "${partId}",`,
          `    has relationship_version 1,`,
          `    has epistemic_status "confirmed",`,
          `    has published_at_ms 1758058200000,`,
          `    has received_at_ms 1793452739000,`,
          `    has tenant_owner "${parsed.owner}",`,
          `    has visibility_scope "${parsed.visibility}";`,
        ].join('\n'),
      );
    }
  }
  for (const proj of parsed.projects) {
    statements.push(compileProjectPutTypeQl(proj, parsed.owner, parsed.visibility));
  }
  for (const inst of parsed.instruments) {
    statements.push(compileInstrumentPutTypeQl(inst));
  }
  for (const doc of parsed.sources) {
    statements.push(compileSourceDocumentPutTypeQl(doc, parsed.owner, parsed.visibility));
  }
  for (const obs of parsed.observations) {
    statements.push(compileObservationPutTypeQl(obs, parsed.owner, parsed.visibility));
  }

  return statements;
}

/**
 * Builds append-only outbox projection items for a dataset, enforcing that only
 * validated and reviewer-approved (`approved` or `conflicting_pending_review`) records
 * are eligible for promotion into TypeDB.
 */
export function buildOutboxItemsFromDataset(
  dataset: MacroGraphDataset,
  nowMs = Date.now(),
  maxAttempts = 3,
): {
  accepted: OutboxProjectionItem[];
  rejected: Array<{ relationshipId: string; reasons: string[] }>;
} {
  const parsed = macroGraphDatasetSchema.parse(dataset);
  const sourcesById = new Map(parsed.sources.map((s) => [s.sourceDocId, s]));
  const accepted: OutboxProjectionItem[] = [];
  const rejected: Array<{ relationshipId: string; reasons: string[] }> = [];
  const seenKeys = new Set<string>();

  let seq = 1;
  for (const rel of parsed.relationships) {
    if (!['approved', 'conflicting_pending_review'].includes(rel.reviewerStatus)) {
      rejected.push({
        relationshipId: rel.relationshipId,
        reasons: [`Unapproved record (${rel.reviewerStatus}) cannot be promoted into TypeDB.`],
      });
      continue;
    }

    const gov = validateRelationshipGovernance(rel, parsed.relationships, sourcesById);
    if (!gov.valid) {
      rejected.push({
        relationshipId: rel.relationshipId,
        reasons: gov.reasons,
      });
      continue;
    }

    const projectionKey = computeDeterministicProjectionKey(
      parsed.owner,
      parsed.visibility,
      rel,
    );
    if (seenKeys.has(projectionKey)) {
      continue;
    }
    seenKeys.add(projectionKey);

    const statements: string[] = [
      compileRelationshipInsertTypeQl(rel, projectionKey, parsed.owner, parsed.visibility),
      ...rel.sourceDocIds.map((docId) => compileEvidentialSupportInsertTypeQl(rel, docId)),
    ];

    if (rel.supersedesRelationshipId) {
      const supId = `suplink:${rel.supersedesRelationshipId}:${rel.relationshipId}`;
      statements.push(
        [
          'match',
          `  $prior isa macro_relationship, has relationship_id "${rel.supersedesRelationshipId}";`,
          `  $next isa macro_relationship, has relationship_id "${rel.relationshipId}";`,
          'put',
          `  $sl isa supersession_link,`,
          `    links (prior_assertion: $prior, superseding_assertion: $next),`,
          `    has relationship_id "${supId}",`,
          `    has effective_from_ms ${rel.effectiveFromMs};`,
        ].join('\n'),
      );
    }

    accepted.push({
      sequence: seq++,
      projectionKey,
      owner: parsed.owner,
      visibility: parsed.visibility,
      sourceTable: 'infrastructureCases',
      sourceRecordId: rel.relationshipId,
      sourceEvidenceIds: rel.sourceDocIds,
      graphSchemaVersion: MACRO_GRAPH_SCHEMA_VERSION,
      relationshipId: rel.relationshipId,
      typeqlStatements: statements,
      status: 'pending',
      attemptCount: 0,
      maxAttempts,
      nextAttemptAtMs: nowMs,
      lastError: null,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      projectedAtMs: null,
      executionAuthority: 'none',
    });
  }

  return { accepted, rejected };
}

/**
 * Processes an outbox batch against a provided executor function with idempotent writes,
 * exponential retry backoff, dead-letter transitions, and checkpoint tracking.
 */
export async function processProjectionOutboxBatch(
  outbox: OutboxProjectionItem[],
  executor: (item: OutboxProjectionItem) => Promise<void>,
  nowMs = Date.now(),
): Promise<{
  updatedOutbox: OutboxProjectionItem[];
  checkpoint: ProjectionCheckpoint;
}> {
  const updatedOutbox = outbox.map((item) => ({ ...item }));

  for (const item of updatedOutbox) {
    if (item.status === 'projected' || item.status === 'dead_letter') {
      continue;
    }
    if (item.nextAttemptAtMs > nowMs) {
      continue;
    }

    item.attemptCount += 1;
    item.updatedAtMs = nowMs;

    try {
      await executor(item);
      item.status = 'projected';
      item.projectedAtMs = nowMs;
      item.lastError = null;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      item.lastError = msg;
      if (item.attemptCount >= item.maxAttempts) {
        item.status = 'dead_letter';
      } else {
        item.status = 'retrying';
        item.nextAttemptAtMs = nowMs + computeRetryBackoffMs(item.attemptCount);
      }
    }
  }

  const projectedItems = updatedOutbox.filter((i) => i.status === 'projected');
  const unprojectedItems = updatedOutbox.filter(
    (i) => i.status === 'pending' || i.status === 'retrying',
  );
  const maxProjectionLagMs =
    unprojectedItems.length > 0
      ? Math.max(0, ...unprojectedItems.map((i) => nowMs - i.createdAtMs))
      : 0;
  const lastProjected =
    projectedItems.length > 0 ? projectedItems[projectedItems.length - 1]! : null;

  const checkpoint: ProjectionCheckpoint = {
    checkpointKey: `ckpt:${updatedOutbox[0]?.owner ?? 'public_research'}:main`,
    owner: updatedOutbox[0]?.owner ?? 'public_research',
    lastProjectedSequence: lastProjected?.sequence ?? 0,
    lastProjectionKey: lastProjected?.projectionKey ?? null,
    graphSchemaVersion: MACRO_GRAPH_SCHEMA_VERSION,
    projectedCount: projectedItems.length,
    pendingCount: updatedOutbox.filter((i) => i.status === 'pending').length,
    retryingCount: updatedOutbox.filter((i) => i.status === 'retrying').length,
    deadLetterCount: updatedOutbox.filter((i) => i.status === 'dead_letter').length,
    maxProjectionLagMs,
    replayedAtMs: null,
    updatedAtMs: nowMs,
  };

  return { updatedOutbox, checkpoint };
}

/**
 * Resets outbox items after `fromSequence` so the graph can be deterministically replayed
 * and rebuilt from a known checkpoint.
 */
export function replayOutboxFromCheckpoint(
  outbox: OutboxProjectionItem[],
  fromSequence = 0,
  nowMs = Date.now(),
): OutboxProjectionItem[] {
  return outbox.map((item) => {
    if (item.sequence <= fromSequence) return item;
    return {
      ...item,
      status: 'pending' as const,
      attemptCount: 0,
      nextAttemptAtMs: nowMs,
      lastError: null,
      projectedAtMs: null,
      updatedAtMs: nowMs,
    };
  });
}
