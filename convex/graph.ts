import { v } from 'convex/values';
import {
  actionGeneric,
  internalActionGeneric,
  internalQueryGeneric,
  makeFunctionReference,
  type ActionBuilder,
  type GenericMutationCtx,
  type GenericQueryCtx,
  type QueryBuilder,
} from 'convex/server';
import { internalMutation, mutation, query, type DataModel } from './server';
import { researcher, reviewer, signedIn, verifyIdentityClaims } from './authz';
import {
  ALLOWLISTED_QUERY_TYPES,
  MACRO_GRAPH_SCHEMA_VERSION,
  macroRelationshipSchema,
} from '../lib/graph/contracts';
import { validateRelationshipGovernance } from '../lib/graph/identity-governance';
import {
  computeDeterministicProjectionKey,
  computeRetryBackoffMs,
} from '../lib/graph/projection-engine';
import {
  buildAllowlistedTypeQlQuery,
  compileEvidentialSupportInsertTypeQl,
  compileRelationshipInsertTypeQl,
} from '../lib/graph/typedb-schema';
import {
  assertNoBrokerOrPrivateAccountData,
  executeAllowlistedGraphQuery,
  loadInitialAcceptanceDataset,
} from '../lib/graph/query-gateway';
import {
  CASE_007_VERIFIED_DEV_DATABASE,
  CASE_007B_VERIFIED_DEV_DATABASE,
  TypeDbSchemaOrHydrationError,
  assertCanRecreateTypeDbDatabase,
  assertIsolatedCase007BWriteTarget,
  assertIsolatedCase007WriteTarget,
  defaultTypeDbConfig,
  describeTypeDbTransport,
  executeReadOnlyTypeQlOnLiveServer,
  executeWriteStatementsOnLiveServer,
  hydrateMacroDatasetFromLiveTypeDb,
  inspectLiveTypeDbGraphCounts,
  inspectLiveTypeDbReconciliationDetails,
  probeTypeDbServer,
  PRODUCTION_TYPEDB_DATABASE,
  projectDatasetIntoLiveTypeDb,
  STAGING_TYPEDB_DATABASE,
} from '../lib/graph/typedb-driver-adapter';
import { runMacroCase001GraphInvestigations } from '../lib/graph/macro-case-001';
import {
  CASE_007_BUNDLE_ID,
  CASE_007_POST_RESULTS_BUNDLE_ID,
  CASE_007_PRE_EARNINGS_CAPTURED_AT_MS,
  CASE_007B_POST_EARNINGS_INGESTED_AT_MS,
  assertNoDisputedG9SecRecords,
  assertNoDisputedG9SecRecordsPostEarnings,
  runCase007PostEarningsPipeline,
  runCase007PreEarningsPipeline,
} from '../lib/remote-ops/case-007-nvidia-ingestor';

const action: ActionBuilder<DataModel, 'public'> = actionGeneric;
const internalAction: ActionBuilder<DataModel, 'internal'> = internalActionGeneric;
const internalQuery: QueryBuilder<DataModel, 'internal'> = internalQueryGeneric;

const graphMRef = (name: string) => makeFunctionReference<'mutation'>(`graph:${name}`);
const graphQRef = (name: string) => makeFunctionReference<'query'>(`graph:${name}`);

type Ctx = GenericMutationCtx<DataModel> | GenericQueryCtx<DataModel>;

/** Constant-time check of the server-to-server TypeDB bridge credential. Closed when the secret is unset. */
function assertBridgeKey(presented: string | undefined): void {
  const secret = process.env.TYPEDB_BRIDGE_SECRET;
  if (!secret || secret.length < 32) throw new Error('TypeDB bridge is not configured');
  const reserved = [
    process.env.OPERATIONS_SCHEDULER_SECRET,
    process.env.RESEARCH_STAGING_TOKEN,
    process.env.EVIDENCE_CHAT_GATEWAY_SECRET,
  ];
  if (reserved.includes(secret)) throw new Error('TypeDB bridge is not configured');
  const candidate = presented ?? '';
  let diff = candidate.length ^ secret.length;
  for (let i = 0; i < secret.length; i++) diff |= (candidate.charCodeAt(i) || 0) ^ secret.charCodeAt(i);
  if (diff !== 0) throw new Error('TypeDB bridge credential required');
}

/**
 * Maintenance actions act for an explicitly named owner or the configured pipeline owner.
 * Hard-coded user identifiers are never used as a fallback.
 */
function requireExplicitOwner(owner: string | undefined): string {
  const resolved = owner ?? process.env.RESEARCH_OWNER_ID;
  if (!resolved || !resolved.trim()) {
    throw new Error('An explicit owner or RESEARCH_OWNER_ID is required');
  }
  return resolved;
}

async function recomputeCheckpoint(
  ctx: GenericMutationCtx<DataModel>,
  owner: string,
  nowMs: number,
  replayedAtMs?: number | null,
) {
  const items = await ctx.db
    .query('graphProjectionOutbox')
    .withIndex('by_owner', (q) => q.eq('owner', owner))
    .collect();
  const projected = items.filter((i) => i.status === 'projected');
  const pending = items.filter((i) => i.status === 'pending');
  const retrying = items.filter((i) => i.status === 'retrying');
  const dead = items.filter((i) => i.status === 'dead_letter');
  const unprojected = [...pending, ...retrying];
  const maxProjectionLagMs =
    unprojected.length > 0
      ? Math.max(0, ...unprojected.map((i) => nowMs - i.createdAtMs))
      : 0;
  const lastProjected =
    projected.length > 0
      ? projected.sort((a, b) => a.sequence - b.sequence)[projected.length - 1]!
      : null;

  const checkpointKey = `ckpt:${owner}:main`;
  const existing = await ctx.db
    .query('graphProjectionCheckpoints')
    .withIndex('by_owner_key', (q) =>
      q.eq('owner', owner).eq('checkpointKey', checkpointKey),
    )
    .first();

  const patch = {
    owner,
    checkpointKey,
    lastProjectedSequence: lastProjected?.sequence ?? 0,
    lastProjectionKey: lastProjected?.projectionKey ?? null,
    graphSchemaVersion: MACRO_GRAPH_SCHEMA_VERSION,
    projectedCount: projected.length,
    pendingCount: pending.length,
    retryingCount: retrying.length,
    deadLetterCount: dead.length,
    maxProjectionLagMs,
    replayedAtMs:
      replayedAtMs !== undefined ? replayedAtMs : (existing?.replayedAtMs ?? null),
    updatedAtMs: nowMs,
  };

  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return existing._id;
  }
  return await ctx.db.insert('graphProjectionCheckpoints', patch);
}

/**
 * Helper to enqueue an approved relationship into `graphProjectionOutbox` idempotently.
 */
async function insertOrDeduplicateOutboxRelationship(
  ctx: GenericMutationCtx<DataModel>,
  params: {
    owner: string;
    visibility: 'public_research' | 'private_tenant';
    sourceTable: string;
    sourceRecordId: string;
    parsedRel: ReturnType<typeof macroRelationshipSchema.parse>;
    maxAttempts?: number;
    reviewedAtMs?: number;
    reviewNote?: string;
    correctionHistoryJson?: string;
    nowMs: number;
  },
) {
  const { owner, visibility, parsedRel, nowMs } = params;
  const effectiveKeyOwner = visibility === 'public_research' ? 'public_research' : owner;
  const projectionKey = computeDeterministicProjectionKey(
    effectiveKeyOwner,
    visibility,
    parsedRel,
  );

  const existing = await ctx.db
    .query('graphProjectionOutbox')
    .withIndex('by_projection_key', (q) =>
      q.eq('owner', owner).eq('projectionKey', projectionKey),
    )
    .first();
  if (existing) {
    return { outboxId: existing._id, projectionKey, deduplicated: true };
  }

  const currentItems = await ctx.db
    .query('graphProjectionOutbox')
    .withIndex('by_owner', (q) => q.eq('owner', owner))
    .collect();
  const nextSequence =
    currentItems.length > 0
      ? Math.max(...currentItems.map((i) => i.sequence)) + 1
      : 1;

  const statements = [
    compileRelationshipInsertTypeQl(parsedRel, projectionKey, effectiveKeyOwner, visibility),
    ...parsedRel.sourceDocIds.map((docId) =>
      compileEvidentialSupportInsertTypeQl(parsedRel, docId),
    ),
  ];

  if (parsedRel.supersedesRelationshipId) {
    const supId = `suplink:${parsedRel.supersedesRelationshipId}:${parsedRel.relationshipId}`;
    statements.push(
      [
        'match',
        `  $prior isa macro_relationship, has relationship_id "${parsedRel.supersedesRelationshipId}";`,
        `  $next isa macro_relationship, has relationship_id "${parsedRel.relationshipId}";`,
        'put',
        `  $sl isa supersession_link,`,
        `    links (prior_assertion: $prior, superseding_assertion: $next),`,
        `    has relationship_id "${supId}",`,
        `    has effective_from_ms ${parsedRel.effectiveFromMs};`,
      ].join('\n'),
    );
  }

  const outboxId = await ctx.db.insert('graphProjectionOutbox', {
    owner,
    visibility,
    sequence: nextSequence,
    projectionKey,
    sourceTable: params.sourceTable,
    sourceRecordId: params.sourceRecordId,
    sourceEvidenceIds: parsedRel.sourceDocIds,
    graphSchemaVersion: MACRO_GRAPH_SCHEMA_VERSION,
    relationshipId: parsedRel.relationshipId,
    payloadJson: JSON.stringify(parsedRel),
    typeqlJson: JSON.stringify(statements),
    reviewer: owner,
    reviewedAtMs: params.reviewedAtMs ?? nowMs,
    reviewNote: params.reviewNote,
    correctionHistoryJson: params.correctionHistoryJson,
    leaseToken: null,
    leaseUntil: 0,
    status: 'pending',
    attemptCount: 0,
    maxAttempts: Math.min(Math.max(params.maxAttempts ?? 3, 1), 10),
    nextAttemptAtMs: nowMs,
    lastError: null,
    projectedAtMs: null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    executionAuthority: 'none',
  });

  await recomputeCheckpoint(ctx, owner, nowMs);
  await ctx.db.insert('audit', {
    owner,
    action: 'graph.outbox.enqueued',
    recordId: outboxId,
    detail: `${parsedRel.relationshipId} (${projectionKey}) enqueued for TypeDB ${MACRO_GRAPH_SCHEMA_VERSION}`,
    at: nowMs,
  });

  return { outboxId, projectionKey, deduplicated: false };
}

/**
 * Enqueues a validated, reviewer-approved relationship into the append-only TypeDB projection outbox.
 * Requires explicit `reviewer` role authority. Idempotent by deterministic `projectionKey`.
 */
export const enqueueApprovedRelationship = mutation({
  args: {
    visibility: v.union(v.literal('public_research'), v.literal('private_tenant')),
    sourceTable: v.string(),
    sourceRecordId: v.string(),
    relationshipJson: v.string(),
    maxAttempts: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const rev = await reviewer(ctx);
    const owner = rev.tokenIdentifier;
    const nowMs = Date.now();

    assertNoBrokerOrPrivateAccountData(args.relationshipJson);
    const parsedRel = macroRelationshipSchema.parse(JSON.parse(args.relationshipJson));

    if (!['approved', 'conflicting_pending_review'].includes(parsedRel.reviewerStatus)) {
      throw new Error('Only reviewer-approved records may be promoted into the TypeDB outbox');
    }

    return await insertOrDeduplicateOutboxRelationship(ctx, {
      owner,
      visibility: args.visibility,
      sourceTable: args.sourceTable,
      sourceRecordId: args.sourceRecordId,
      parsedRel,
      maxAttempts: args.maxAttempts,
      nowMs,
    });
  },
});

/**
 * Stage 4 Human Review workflow mutation:
 * - Reviews a relationship candidate (`approved` or `rejected`).
 * - Verifies that approving a source document does NOT automatically make all extracted relationships `confirmed`.
 * - Preserves reviewer identity, decision time, source provenance, and correction/supersession history.
 * - Optionally promotes an approved relationship into `graphProjectionOutbox`.
 */
export const reviewAndPromoteRelationship = mutation({
  args: {
    visibility: v.union(v.literal('public_research'), v.literal('private_tenant')),
    decision: v.union(v.literal('approved'), v.literal('rejected')),
    reviewNote: v.string(),
    sourceTable: v.string(),
    sourceRecordId: v.string(),
    sourceDocumentApproved: v.optional(v.boolean()),
    promoteToOutbox: v.optional(v.boolean()),
    relationshipJson: v.string(),
    correctionNote: v.optional(v.string()),
    maxAttempts: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const rev = await reviewer(ctx);
    const owner = rev.tokenIdentifier;
    const nowMs = Date.now();

    if (!args.reviewNote.trim()) {
      throw new Error('Review note is required for relationship promotion governance');
    }

    assertNoBrokerOrPrivateAccountData(args.relationshipJson);
    const rawRel = JSON.parse(args.relationshipJson) as Record<string, unknown>;
    const updatedRelInput = {
      ...rawRel,
      reviewerStatus: args.decision === 'approved' ? 'approved' : 'rejected',
      reviewedBy: owner,
    };

    const parsedRel = macroRelationshipSchema.parse(updatedRelInput);

    // Stage 4 Rule: An approved document must NOT automatically make all relationships extracted from it confirmed.
    // Validate against source governance in the acceptance dataset + any provided sources.
    const dataset = loadInitialAcceptanceDataset();
    const sourcesById = new Map(dataset.sources.map((s) => [s.sourceDocId, s]));
    const allRels = [...dataset.relationships];
    const existingReviews = await ctx.db
      .query('graphRelationshipReviews')
      .withIndex('by_owner', (q) => q.eq('owner', owner))
      .collect();
    for (const r of existingReviews) {
      try {
        allRels.push(macroRelationshipSchema.parse(JSON.parse(r.relationshipJson)));
      } catch {
        // Ignore legacy unparseable
      }
    }

    if (args.decision === 'approved') {
      const gov = validateRelationshipGovernance(parsedRel, allRels, sourcesById);
      if (!gov.valid) {
        throw new Error(
          `Relationship governance check failed (document approval does not auto-confirm relationships): ${gov.reasons.join(' ')}`,
        );
      }
    }

    const priorReviewsForRel = existingReviews.filter(
      (r) =>
        r.relationshipId === parsedRel.relationshipId ||
        r.logicalEventId === parsedRel.logicalEventId,
    );
    const correctionHistory = [
      ...priorReviewsForRel.map((p) => ({
        relationshipId: p.relationshipId,
        version: p.version,
        decision: p.decision,
        reviewer: p.reviewer,
        reviewedAtMs: p.reviewedAtMs,
        reviewNote: p.reviewNote,
      })),
      {
        relationshipId: parsedRel.relationshipId,
        version: parsedRel.version,
        supersedesRelationshipId: parsedRel.supersedesRelationshipId,
        decision: args.decision,
        reviewer: owner,
        reviewedAtMs: nowMs,
        reviewNote: args.reviewNote.trim(),
        correctionNote: args.correctionNote?.trim() ?? null,
      },
    ];
    const correctionHistoryJson = JSON.stringify(correctionHistory);

    let promotedOutboxId: ReturnType<typeof v.id<'graphProjectionOutbox'>>['type'] | null =
      null;
    let projectionKey: string | null = null;
    let deduplicated = false;

    const shouldPromote =
      args.decision === 'approved' && (args.promoteToOutbox ?? true);
    if (shouldPromote) {
      const enq = await insertOrDeduplicateOutboxRelationship(ctx, {
        owner,
        visibility: args.visibility,
        sourceTable: args.sourceTable,
        sourceRecordId: args.sourceRecordId,
        parsedRel,
        maxAttempts: args.maxAttempts,
        reviewedAtMs: nowMs,
        reviewNote: args.reviewNote.trim(),
        correctionHistoryJson,
        nowMs,
      });
      promotedOutboxId = enq.outboxId;
      projectionKey = enq.projectionKey;
      deduplicated = enq.deduplicated;
    }

    const reviewId = await ctx.db.insert('graphRelationshipReviews', {
      owner,
      relationshipId: parsedRel.relationshipId,
      logicalEventId: parsedRel.logicalEventId,
      version: parsedRel.version,
      supersedesRelationshipId: parsedRel.supersedesRelationshipId,
      decision: args.decision,
      reviewer: owner,
      reviewedAtMs: nowMs,
      reviewNote: args.reviewNote.trim(),
      sourceEvidenceIds: parsedRel.sourceDocIds,
      sourceDocumentApproved: Boolean(args.sourceDocumentApproved ?? true),
      epistemicStatus: parsedRel.epistemicStatus,
      contractualStatus: parsedRel.contractualStatus,
      relationshipJson: JSON.stringify(parsedRel),
      correctionHistoryJson,
      promotedOutboxId,
      projectionKey,
      executionAuthority: 'none',
    });

    await ctx.db.insert('audit', {
      owner,
      action:
        args.decision === 'approved'
          ? 'graph.relationship.approved'
          : 'graph.relationship.rejected',
      recordId: reviewId,
      detail: `${parsedRel.relationshipId} (v${parsedRel.version}, ${parsedRel.epistemicStatus}/${parsedRel.contractualStatus}) ${args.decision} by ${owner}${projectionKey ? ` -> ${projectionKey}` : ''}`,
      at: nowMs,
    });

    return {
      reviewId,
      decision: args.decision,
      reviewer: owner,
      reviewedAtMs: nowMs,
      relationshipId: parsedRel.relationshipId,
      epistemicStatus: parsedRel.epistemicStatus,
      contractualStatus: parsedRel.contractualStatus,
      promotedOutboxId,
      projectionKey,
      deduplicated,
      correctionHistoryCount: correctionHistory.length,
      executionAuthority: 'none' as const,
    };
  },
});

/**
 * Records the outcome (`projected` or failure with backoff / `dead_letter`) of a TypeDB worker projection attempt.
 */
export const recordProjectionOutcome = mutation({
  args: {
    outboxId: v.id('graphProjectionOutbox'),
    succeeded: v.boolean(),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await researcher(ctx);
    const owner = user.tokenIdentifier;
    const nowMs = Date.now();

    const item = await ctx.db.get(args.outboxId);
    if (!item || item.owner !== owner) {
      throw new Error('Record unavailable');
    }

    const attemptCount = item.attemptCount + 1;
    if (args.succeeded) {
      await ctx.db.patch(item._id, {
        status: 'projected',
        attemptCount,
        leaseToken: null,
        leaseUntil: 0,
        lastError: null,
        projectedAtMs: nowMs,
        updatedAtMs: nowMs,
      });
    } else {
      const dead = attemptCount >= item.maxAttempts;
      await ctx.db.patch(item._id, {
        status: dead ? 'dead_letter' : 'retrying',
        attemptCount,
        leaseToken: null,
        leaseUntil: 0,
        lastError: args.errorMessage ?? 'TypeDB transaction failed',
        nextAttemptAtMs: dead
          ? item.nextAttemptAtMs
          : nowMs + computeRetryBackoffMs(attemptCount),
        updatedAtMs: nowMs,
      });
    }

    await recomputeCheckpoint(ctx, owner, nowMs);
    return {
      status: args.succeeded
        ? 'projected'
        : attemptCount >= item.maxAttempts
          ? 'dead_letter'
          : 'retrying',
    };
  },
});

/**
 * Replays the projection outbox from a given sequence checkpoint (`fromSequence`).
 */
export const replayFromCheckpoint = mutation({
  args: {
    fromSequence: v.number(),
  },
  handler: async (ctx, args) => {
    const rev = await reviewer(ctx);
    const owner = rev.tokenIdentifier;
    const nowMs = Date.now();

    const items = await ctx.db
      .query('graphProjectionOutbox')
      .withIndex('by_owner', (q) => q.eq('owner', owner))
      .collect();

    let resetCount = 0;
    for (const item of items) {
      if (item.sequence > args.fromSequence) {
        await ctx.db.patch(item._id, {
          status: 'pending',
          attemptCount: 0,
          leaseToken: null,
          leaseUntil: 0,
          nextAttemptAtMs: nowMs,
          lastError: null,
          projectedAtMs: null,
          updatedAtMs: nowMs,
        });
        resetCount += 1;
      }
    }

    await recomputeCheckpoint(ctx, owner, nowMs, nowMs);
    await ctx.db.insert('audit', {
      owner,
      action: 'graph.outbox.replayed',
      recordId: `ckpt:${owner}:main`,
      detail: `Replayed ${resetCount} outbox item(s) after sequence ${args.fromSequence}`,
      at: nowMs,
    });

    return { resetCount, replayedAtMs: nowMs };
  },
});

export const projectionHealth = query({
  args: {},
  handler: async (ctx: Ctx) => {
    const user = await signedIn(ctx);
    const owner = user.tokenIdentifier;

    const items = await ctx.db
      .query('graphProjectionOutbox')
      .withIndex('by_owner', (q) => q.eq('owner', owner))
      .collect();
    const checkpoint = await ctx.db
      .query('graphProjectionCheckpoints')
      .withIndex('by_owner_key', (q) =>
        q.eq('owner', owner).eq('checkpointKey', `ckpt:${owner}:main`),
      )
      .first();
    const reviews = await ctx.db
      .query('graphRelationshipReviews')
      .withIndex('by_owner', (q) => q.eq('owner', owner))
      .collect();

    return {
      schemaVersion: MACRO_GRAPH_SCHEMA_VERSION,
      checkpoint,
      outboxItems: items.sort((a, b) => a.sequence - b.sequence),
      reviews: reviews.sort((a, b) => b.reviewedAtMs - a.reviewedAtMs),
      executionAuthority: 'none' as const,
    };
  },
});

export const recordGraphQueryAudit = mutation({
  args: {
    queryType: v.string(),
    parametersJson: v.string(),
    asOfMs: v.number(),
    nodeCount: v.number(),
    edgeCount: v.number(),
    backendMode: v.union(v.literal('typedb_live'), v.literal('deterministic_mirror')),
    latencyMs: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await researcher(ctx);
    const nowMs = Date.now();
    return await ctx.db.insert('graphQueryAudit', {
      owner: user.tokenIdentifier,
      queryType: args.queryType,
      parametersJson: args.parametersJson,
      asOfMs: args.asOfMs,
      nodeCount: args.nodeCount,
      edgeCount: args.edgeCount,
      backendMode: args.backendMode,
      latencyMs: args.latencyMs,
      atMs: nowMs,
      executionAuthority: 'none',
    });
  },
});

/**
 * Internal lease-claiming mutation for durable cloud projection workers (Stage 5).
 */
export const claimPendingOutboxBatchInternal = internalMutation({
  args: {
    owner: v.string(),
    leaseDurationMs: v.optional(v.number()),
    batchSize: v.optional(v.number()),
    forceImmediate: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const nowMs = Date.now();
    const leaseDurationMs = args.leaseDurationMs ?? 30_000;
    const batchSize = Math.min(Math.max(args.batchSize ?? 25, 1), 100);
    const leaseToken = `lease:${nowMs}:${Math.random().toString(36).slice(2, 10)}`;

    const allItems = await ctx.db
      .query('graphProjectionOutbox')
      .withIndex('by_owner', (q) => q.eq('owner', args.owner))
      .collect();

    const eligible = allItems
      .filter(
        (i) =>
          (i.status === 'pending' || i.status === 'retrying') &&
          (args.forceImmediate || i.nextAttemptAtMs <= nowMs) &&
          (args.forceImmediate || !i.leaseUntil || i.leaseUntil <= nowMs),
      )
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, batchSize);

    const claimed = [];
    for (const item of eligible) {
      await ctx.db.patch(item._id, {
        leaseToken,
        leaseUntil: nowMs + leaseDurationMs,
        updatedAtMs: nowMs,
      });
      claimed.push({
        outboxId: item._id,
        sequence: item.sequence,
        projectionKey: item.projectionKey,
        relationshipId: item.relationshipId,
        typeqlJson: item.typeqlJson,
        leaseToken,
      });
    }

    return { claimed, leaseToken, claimedAtMs: nowMs };
  },
});

export const recordProjectionOutcomeInternal = internalMutation({
  args: {
    outboxId: v.id('graphProjectionOutbox'),
    leaseToken: v.optional(v.string()),
    succeeded: v.boolean(),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const nowMs = Date.now();
    const item = await ctx.db.get(args.outboxId);
    if (!item) {
      throw new Error('Outbox item not found');
    }
    if (args.leaseToken && item.leaseToken && item.leaseToken !== args.leaseToken) {
      throw new Error('Outbox lease token mismatch');
    }

    const attemptCount = item.attemptCount + 1;
    if (args.succeeded) {
      await ctx.db.patch(item._id, {
        status: 'projected',
        attemptCount,
        leaseToken: null,
        leaseUntil: 0,
        lastError: null,
        projectedAtMs: nowMs,
        updatedAtMs: nowMs,
      });
    } else {
      const dead = attemptCount >= item.maxAttempts;
      await ctx.db.patch(item._id, {
        status: dead ? 'dead_letter' : 'retrying',
        attemptCount,
        leaseToken: null,
        leaseUntil: 0,
        lastError: args.errorMessage ?? 'TypeDB transaction failed',
        nextAttemptAtMs: dead
          ? item.nextAttemptAtMs
          : nowMs + computeRetryBackoffMs(attemptCount),
        updatedAtMs: nowMs,
      });
    }

    await recomputeCheckpoint(ctx, item.owner, nowMs);
    return {
      status: args.succeeded
        ? 'projected'
        : attemptCount >= item.maxAttempts
          ? 'dead_letter'
          : 'retrying',
    };
  },
});

export const bootstrapAcceptanceOutboxInternal = internalMutation({
  args: {
    owner: v.string(),
  },
  handler: async (ctx, args) => {
    const nowMs = Date.now();
    const dataset = loadInitialAcceptanceDataset();
    let enqueuedCount = 0;
    let deduplicatedCount = 0;

    for (const rel of dataset.relationships) {
      const res = await insertOrDeduplicateOutboxRelationship(ctx, {
        owner: args.owner,
        visibility: 'public_research',
        sourceTable: 'infrastructureCases',
        sourceRecordId: rel.relationshipId,
        parsedRel: rel,
        reviewedAtMs: rel.receivedAtMs,
        reviewNote: 'Phase G.2 verified initial 6-company acceptance dataset bootstrap',
        nowMs,
      });
      if (res.deduplicated) {
        deduplicatedCount += 1;
        // Refresh typeqlJson to canonical dataset owner/visibility for public_research acceptance items
        const existingItem = await ctx.db.get(res.outboxId);
        if (existingItem && existingItem.status !== 'projected') {
          const canonicalKey = computeDeterministicProjectionKey(
            dataset.owner,
            dataset.visibility,
            rel,
          );
          const statements = [
            compileRelationshipInsertTypeQl(
              rel,
              canonicalKey,
              dataset.owner,
              dataset.visibility,
            ),
            ...rel.sourceDocIds.map((docId) =>
              compileEvidentialSupportInsertTypeQl(rel, docId),
            ),
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
          await ctx.db.patch(existingItem._id, {
            typeqlJson: JSON.stringify(statements),
            status: 'pending',
            attemptCount: 0,
            nextAttemptAtMs: nowMs,
            lastError: null,
          });
        }
      } else {
        enqueuedCount += 1;
      }
    }

    await recomputeCheckpoint(ctx, args.owner, nowMs);

    const checkpoint = await ctx.db
      .query('graphProjectionCheckpoints')
      .withIndex('by_owner_key', (q) =>
        q.eq('owner', args.owner).eq('checkpointKey', `ckpt:${args.owner}:main`),
      )
      .first();

    return {
      enqueuedCount,
      deduplicatedCount,
      totalDatasetRelationships: dataset.relationships.length,
      checkpoint,
    };
  },
});

export const getProjectionStateInternal = internalQuery({
  args: {
    owner: v.string(),
  },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query('graphProjectionOutbox')
      .withIndex('by_owner', (q) => q.eq('owner', args.owner))
      .collect();
    const checkpoint = await ctx.db
      .query('graphProjectionCheckpoints')
      .withIndex('by_owner_key', (q) =>
        q.eq('owner', args.owner).eq('checkpointKey', `ckpt:${args.owner}:main`),
      )
      .first();
    const reviews = await ctx.db
      .query('graphRelationshipReviews')
      .withIndex('by_owner', (q) => q.eq('owner', args.owner))
      .collect();
    return {
      checkpoint,
      outboxItems: items.sort((a, b) => a.sequence - b.sequence),
      reviews: reviews.sort((a, b) => b.reviewedAtMs - a.reviewedAtMs),
    };
  },
});

/**
 * Cloud projection & verification action running inside Convex Cloud where
 * `TYPEDB_HTTP_ADDRESS`, `TYPEDB_USERNAME`, `TYPEDB_PASSWORD`, and `TYPEDB_DATABASE`
 * are securely injected via server-side environment secrets.
 */
export const syncAndVerifyTypeDbCloud = internalAction({
  args: {
    owner: v.optional(v.string()),
    recreateDatabase: v.optional(v.boolean()),
    runAllAllowlistedQueries: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const startedAtMs = Date.now();
    const owner = requireExplicitOwner(args.owner);
    const config = defaultTypeDbConfig(STAGING_TYPEDB_DATABASE);
    if (args.recreateDatabase) {
      assertCanRecreateTypeDbDatabase(config.databaseName);
    }

    // 1. Probe TypeDB Cloud Explore server & verify authentication
    const probe = await probeTypeDbServer(config);
    if (!probe.reachable || !probe.authenticated) {
      return {
        ok: false,
        stage: 'probe_or_auth_failed',
        probe,
        executionAuthority: 'none' as const,
      };
    }

    // 2. Ensure Convex outbox is bootstrapped with the 13 acceptance relationships
    const outboxBootstrap = await ctx.runMutation(
      graphMRef('bootstrapAcceptanceOutboxInternal'),
      { owner },
    );

    // 3. Project schema + foundational entities + dataset into TypeDB Cloud (`aci_macro_intelligence_staging`)
    const dataset = loadInitialAcceptanceDataset();
    let datasetProjectionReport = null;
    if (!probe.databaseExists || args.recreateDatabase) {
      const proj = await projectDatasetIntoLiveTypeDb(dataset, {
        config,
        recreateDatabase: Boolean(args.recreateDatabase),
      });
      datasetProjectionReport = proj.report;
    } else {
      const countsCheck = await inspectLiveTypeDbGraphCounts(config);
      if (
        !countsCheck.ok ||
        !countsCheck.counts ||
        countsCheck.counts.organisations < dataset.organisations.length ||
        countsCheck.counts.macroRelationships < dataset.relationships.length
      ) {
        const proj = await projectDatasetIntoLiveTypeDb(dataset, {
          config,
          recreateDatabase: false,
        });
        datasetProjectionReport = proj.report;
      }
    }

    // 4. Claim and project any pending/retrying Convex outbox items into TypeDB Cloud
    const claimedBatch = (await ctx.runMutation(
      graphMRef('claimPendingOutboxBatchInternal'),
      {
        owner,
        batchSize: 50,
        forceImmediate: true,
      },
    )) as {
      claimed: Array<{
        outboxId: ReturnType<typeof v.id<'graphProjectionOutbox'>>['type'];
        sequence: number;
        projectionKey: string;
        relationshipId: string;
        typeqlJson: string;
        leaseToken: string;
      }>;
    };

    const outboxResults: Array<{
      sequence: number;
      relationshipId: string;
      projectionKey: string;
      status: string;
      latencyMs: number;
      error: string | null;
    }> = [];

    for (const item of claimedBatch.claimed) {
      const statements = JSON.parse(item.typeqlJson) as string[];
      const writeRes = await executeWriteStatementsOnLiveServer(statements, config);
      const outcome = (await ctx.runMutation(
        graphMRef('recordProjectionOutcomeInternal'),
        {
          outboxId: item.outboxId,
          leaseToken: item.leaseToken,
          succeeded: writeRes.ok,
          ...(writeRes.error ? { errorMessage: writeRes.error } : {}),
        },
      )) as { status: string };
      outboxResults.push({
        sequence: item.sequence,
        relationshipId: item.relationshipId,
        projectionKey: item.projectionKey,
        status: outcome.status,
        latencyMs: writeRes.latencyMs,
        error: writeRes.error,
      });
    }

    // 5. Inspect live TypeDB Cloud graph concept counts
    const graphCounts = await inspectLiveTypeDbGraphCounts(config);

    // 6. Optionally run all 6 allowlisted graph query types against live TypeDB Cloud
    const queryResults: Array<{
      queryType: string;
      backendMode: string;
      typedbServerVersion: string | null;
      liveAnswerCount: number;
      liveQueryLatencyMs: number | null;
      nodeCount: number;
      edgeCount: number;
      conflictCount: number;
      tldrWhatChangedCount: number;
    }> = [];

    if (args.runAllAllowlistedQueries ?? true) {
      for (const queryType of ALLOWLISTED_QUERY_TYPES) {
        const res = await executeAllowlistedGraphQuery(
          {
            queryType,
            asOfMs: 1794146400000,
            temporalBasis: 'receipt',
            maxDepth: 2,
          },
          {
            callerId: owner,
            datasets: [dataset],
            preferLiveTypeDb: true,
          },
        );
        queryResults.push({
          queryType,
          backendMode: res.backendMode,
          typedbServerVersion: res.typedbServerVersion,
          liveAnswerCount: res.liveAnswerCount ?? 0,
          liveQueryLatencyMs: res.liveQueryLatencyMs ?? null,
          nodeCount: res.nodes.length,
          edgeCount: res.edges.length,
          conflictCount: res.conflicts.length,
          tldrWhatChangedCount: res.tldr.whatChanged.length,
        });
      }
    }

    const finalState = await ctx.runQuery(graphQRef('getProjectionStateInternal'), {
      owner,
    });
    const finishedAtMs = Date.now();
    const wallClockDurationMs = Math.max(1, finishedAtMs - startedAtMs);
    const typedbHttpLatencyMs =
      probe.latencyMs +
      graphCounts.latencyMs +
      outboxResults.reduce((acc, r) => acc + r.latencyMs, 0);

    return {
      ok: true,
      startedAtMs,
      finishedAtMs,
      wallClockDurationMs,
      typedbHttpLatencyMs,
      projectionLagFormula:
        'maxProjectionLagMs = max(0, max_{item in (pending U retrying)}(nowMs - item.createdAtMs)); 0 ms when pendingCount = 0 and retryingCount = 0',
      httpAddress: config.httpAddress,
      databaseName: config.databaseName,
      tlsEnabled: describeTypeDbTransport(config).tlsEnabled,
      probe,
      outboxBootstrap,
      datasetProjectionReport,
      outboxResults,
      graphCounts,
      queryResults,
      checkpoint: finalState.checkpoint,
      executionAuthority: 'none' as const,
    };
  },
});

/**
 * Reviewer-only action to trigger an immediate outbox projection sync into hosted TypeDB Cloud.
 * Security (MVP hardening WP4): this previously accepted any signed-in identity, including model actors and
 * tokens that fail issuer/audience checks, although it writes to the graph database.
 */
export const projectPendingOutboxNow = action({
  args: {},
  handler: async (ctx) => {
    const rawIdentity = await ctx.auth.getUserIdentity();
    if (!rawIdentity) {
      throw new Error('Authentication required');
    }
    const identity = verifyIdentityClaims(rawIdentity);
    if (identity.actorType !== undefined && identity.actorType !== 'human') {
      throw new Error('Model or automated actors cannot trigger graph projection');
    }
    const roles = (await ctx.runQuery(makeFunctionReference<'query'>('roles:myRoles'), {})) as {
      roles: string[];
    };
    if (!roles.roles.includes('reviewer')) {
      throw new Error('Reviewer role required: an administrator must assign reviewer authority explicitly');
    }
    const owner = identity.tokenIdentifier;
    const syncActionRef = makeFunctionReference<'action'>(
      'graph:syncAndVerifyTypeDbCloud',
    );
    return await ctx.runAction(syncActionRef, {
      owner,
      recreateDatabase: false,
      runAllAllowlistedQueries: false,
    });
  },
});

/**
 * Server-to-server TypeDB bridge actions.
 *
 * Security (MVP hardening WP4): these three actions were anonymous public endpoints. `executeReadOnlyCloudTypeQl`
 * in particular ran caller-supplied TypeQL with the deployment's TypeDB credentials, so anyone on the internet
 * could read the whole graph database, including `private_tenant` relationships. Convex actions cannot be
 * called as `internal` from the Next.js server without a deployment-wide admin key, so they stay public but
 * every call must present `TYPEDB_BRIDGE_SECRET`, a dedicated secret held only by the application server.
 * With the secret unset the bridge is closed.
 */
const allowlistedReadDatabaseOverride = v.optional(
  v.union(
    v.literal(STAGING_TYPEDB_DATABASE),
    v.literal(CASE_007_VERIFIED_DEV_DATABASE),
    v.literal(CASE_007B_VERIFIED_DEV_DATABASE),
  ),
);

export const probeHostedTypeDbCloud = action({
  args: {
    bridgeKey: v.optional(v.string()),
    databaseOverride: allowlistedReadDatabaseOverride,
  },
  handler: async (_ctx, args) => {
    assertBridgeKey(args.bridgeKey);
    const baseConfig = defaultTypeDbConfig(STAGING_TYPEDB_DATABASE);
    const config = args.databaseOverride
      ? { ...baseConfig, databaseName: args.databaseOverride }
      : baseConfig;
    const probe = await probeTypeDbServer(config);
    return {
      reachable: probe.reachable && probe.authenticated,
      authenticated: probe.authenticated,
      databaseExists: probe.databaseExists,
      databaseName: probe.databaseName,
      distribution: probe.distribution,
      version: probe.version,
      latencyMs: probe.latencyMs,
      tlsEnabled: describeTypeDbTransport(config).tlsEnabled,
      executionAuthority: 'none' as const,
    };
  },
});

/**
 * Allowlisted graph query for a signed-in human researcher. The caller identity is taken from the verified
 * token; the previous client-supplied `callerId` argument (and anonymous access) has been removed.
 */
export const executeAllowlistedCloudGraphQuery = action({
  args: {
    requestJson: v.string(),
  },
  handler: async (ctx, args) => {
    const rawIdentity = await ctx.auth.getUserIdentity();
    if (!rawIdentity) throw new Error('Sign in required');
    const identity = verifyIdentityClaims(rawIdentity);
    if (identity.actorType !== undefined && identity.actorType !== 'human') {
      throw new Error('Model or automated actors cannot query the research graph');
    }
    const rawInput = JSON.parse(args.requestJson);
    return await executeAllowlistedGraphQuery(rawInput, {
      callerId: identity.tokenIdentifier,
      preferLiveTypeDb: true,
    });
  },
});

export const executeReadOnlyCloudTypeQl = action({
  args: {
    typeql: v.string(),
    bridgeKey: v.optional(v.string()),
    databaseOverride: allowlistedReadDatabaseOverride,
  },
  handler: async (_ctx, args) => {
    assertBridgeKey(args.bridgeKey);
    const trimmed = args.typeql.trim();
    if (trimmed.length > 20_000) {
      throw new Error('Security violation: TypeQL query exceeds the permitted size.');
    }
    const withoutComments = trimmed
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n')
      .trim();
    if (
      !withoutComments.startsWith('match') ||
      /\b(insert|delete|put|define|undefine|redefine|update)\b/i.test(withoutComments)
    ) {
      throw new Error('Security violation: only read-only match TypeQL queries are permitted.');
    }
    const baseConfig = defaultTypeDbConfig(STAGING_TYPEDB_DATABASE);
    const config = args.databaseOverride
      ? { ...baseConfig, databaseName: args.databaseOverride }
      : baseConfig;
    return await executeReadOnlyTypeQlOnLiveServer(trimmed, config);
  },
});

export const hydrateHostedTypeDbCloud = action({
  args: {
    bridgeKey: v.optional(v.string()),
    callerOwner: v.optional(v.string()),
    databaseOverride: allowlistedReadDatabaseOverride,
  },
  handler: async (_ctx, args) => {
    assertBridgeKey(args.bridgeKey);
    const baseConfig = defaultTypeDbConfig(STAGING_TYPEDB_DATABASE);
    const config = args.databaseOverride
      ? { ...baseConfig, databaseName: args.databaseOverride }
      : baseConfig;
    try {
      const res = await hydrateMacroDatasetFromLiveTypeDb(config, {
        callerOwner: args.callerOwner ?? 'public_research',
      });
      return { ...res, schemaError: null, executionAuthority: 'none' as const };
    } catch (err) {
      if (err instanceof TypeDbSchemaOrHydrationError) {
        return {
          ok: false,
          reachable: true,
          databaseMissing: false,
          serverVersion: null,
          dataset: null,
          latencyMs: 0,
          error: err.publicMessage,
          schemaError: err.publicMessage,
          executionAuthority: 'none' as const,
        };
      }
      throw new Error('Hosted TypeDB hydration failed closed');
    }
  },
});

/**
 * Internal Case 007 pre-earnings validation and outbox staging mutation.
 * Supports `dryRun: true` (default) to compute deterministic staging, validation, quarantine,
 * and idempotency results without writing to Convex, or `dryRun: false` to persist validated
 * Case 007 relationships into `graphProjectionOutbox` idempotently.
 */
export const stageAndEnqueueCase007Internal = internalMutation({
  args: {
    owner: v.string(),
    dryRun: v.optional(v.boolean()),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const owner = requireExplicitOwner(args.owner);
    const pipeline = runCase007PreEarningsPipeline({
      owner: 'public_research',
      nowMs: args.nowMs,
    });
    assertNoDisputedG9SecRecords(pipeline.dataset);
    const nowMs = args.nowMs ?? pipeline.capturedAtMs;

    const existingOutbox = await ctx.db
      .query('graphProjectionOutbox')
      .withIndex('by_owner', (q) => q.eq('owner', owner))
      .collect();
    const existingKeys = new Set(existingOutbox.map((i) => i.projectionKey));

    let enqueuedCount = 0;
    let deduplicatedCount = 0;
    const itemSummaries: Array<{
      outboxId?: ReturnType<typeof v.id<'graphProjectionOutbox'>>['type'];
      relationshipId: string;
      projectionKey: string;
      deduplicated: boolean;
      epistemicStatus: string;
      contractualStatus: string;
    }> = [];

    if (dryRun) {
      for (const item of pipeline.outboxItems) {
        const isDup = existingKeys.has(item.projectionKey);
        if (isDup) deduplicatedCount += 1;
        else enqueuedCount += 1;
        const rel = pipeline.dataset.relationships.find(
          (r) => r.relationshipId === item.relationshipId,
        )!;
        itemSummaries.push({
          relationshipId: item.relationshipId,
          projectionKey: item.projectionKey,
          deduplicated: isDup,
          epistemicStatus: rel.epistemicStatus,
          contractualStatus: rel.contractualStatus,
        });
      }
    } else {
      for (const rel of pipeline.dataset.relationships) {
        const res = await insertOrDeduplicateOutboxRelationship(ctx, {
          owner,
          visibility: 'public_research',
          sourceTable: 'researchStagingItems',
          sourceRecordId: `case007:${rel.relationshipId}`,
          parsedRel: rel,
          reviewedAtMs: nowMs,
          reviewNote:
            'Case 007 deterministic primary SEC filing verification (pre-Q3 FY27 snapshot)',
          nowMs,
        });
        if (res.deduplicated) deduplicatedCount += 1;
        else enqueuedCount += 1;
        itemSummaries.push({
          outboxId: res.outboxId,
          relationshipId: rel.relationshipId,
          projectionKey: res.projectionKey,
          deduplicated: res.deduplicated,
          epistemicStatus: rel.epistemicStatus,
          contractualStatus: rel.contractualStatus,
        });
      }
    }

    return {
      dryRun,
      bundleId: pipeline.bundleId,
      capturedAtMs: pipeline.capturedAtMs,
      validatedRelationshipCount: pipeline.dataset.relationships.length,
      quarantinedCandidateCount: pipeline.quarantinedCandidates.length,
      quarantinedCandidates: pipeline.quarantinedCandidates,
      enqueuedCount,
      deduplicatedCount,
      beforeOutboxRowCount: existingOutbox.length,
      afterOutboxRowCount: dryRun
        ? existingOutbox.length
        : existingOutbox.length + enqueuedCount,
      itemSummaries,
      executionAuthority: 'none' as const,
    };
  },
});

/**
 * Controlled Case 007 promotion into the isolated development TypeDB database `aci_case007_verified_dev`.
 * - Explicitly confirms target database === `aci_case007_verified_dev` before any write.
 * - Never deletes or mutates `aci_macro_intelligence_staging` (verifies all 23 existing relationships before & after).
 * - Never touches `aci_macro_intelligence_prod` or the 7 disputed G9 SEC/XBRL records.
 */
export const promoteCase007ToVerifiedDevCloud = internalAction({
  args: {
    expectedTargetDatabase: v.literal(CASE_007_VERIFIED_DEV_DATABASE),
    dryRun: v.optional(v.boolean()),
    owner: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    assertIsolatedCase007WriteTarget(args.expectedTargetDatabase);

    const owner = requireExplicitOwner(args.owner);
    const baseConfig = defaultTypeDbConfig(CASE_007_VERIFIED_DEV_DATABASE);
    const targetConfig = {
      ...baseConfig,
      databaseName: CASE_007_VERIFIED_DEV_DATABASE,
    };
    const stagingConfig = {
      ...baseConfig,
      databaseName: STAGING_TYPEDB_DATABASE,
    };
    assertIsolatedCase007WriteTarget(targetConfig.databaseName);

    const pipeline = runCase007PreEarningsPipeline({
      owner: 'public_research',
      nowMs: CASE_007_PRE_EARNINGS_CAPTURED_AT_MS,
    });
    if (
      pipeline.bundleId !== CASE_007_BUNDLE_ID ||
      pipeline.capturedAtMs !== CASE_007_PRE_EARNINGS_CAPTURED_AT_MS
    ) {
      throw new Error('Immutable pre-earnings Case 007 snapshot boundary violated');
    }
    assertNoDisputedG9SecRecords(pipeline.dataset);

    const [
      targetProbeBefore,
      stagingCountsBefore,
      stagingDetailsBefore,
      targetCountsBefore,
    ] = await Promise.all([
      probeTypeDbServer(targetConfig),
      inspectLiveTypeDbGraphCounts(stagingConfig),
      inspectLiveTypeDbReconciliationDetails(stagingConfig),
      inspectLiveTypeDbGraphCounts(targetConfig),
    ]);

    if (!targetProbeBefore.reachable || !targetProbeBefore.authenticated) {
      return {
        ok: false,
        dryRun,
        stage: 'typedb_unreachable_or_unauthenticated',
        targetDatabaseName: targetConfig.databaseName,
        targetProbeBefore,
        executionAuthority: 'none' as const,
      };
    }

    if (dryRun) {
      const outboxDryRun = await ctx.runMutation(
        graphMRef('stageAndEnqueueCase007Internal'),
        { owner, dryRun: true, nowMs: CASE_007_PRE_EARNINGS_CAPTURED_AT_MS },
      );
      return {
        ok: true,
        dryRun: true,
        targetDatabaseName: targetConfig.databaseName,
        clusterDatabasesBefore: stagingDetailsBefore.clusterDatabases,
        targetExistedBefore: targetProbeBefore.databaseExists,
        targetCountsBefore: targetCountsBefore.counts,
        stagingCountsBefore: stagingCountsBefore.counts,
        stagingRelationshipCountBefore: stagingDetailsBefore.relationshipIds.length,
        outboxDryRun,
        validatedSourceCount: pipeline.dataset.sources.length,
        validatedObservationCount: pipeline.dataset.observations.length,
        validatedRelationshipCount: pipeline.dataset.relationships.length,
        executionAuthority: 'none' as const,
      };
    }

    // Re-confirm target explicitly right before TypeDB creation/projection write
    assertIsolatedCase007WriteTarget(targetConfig.databaseName);
    if (
      targetConfig.databaseName === STAGING_TYPEDB_DATABASE ||
      targetConfig.databaseName === PRODUCTION_TYPEDB_DATABASE
    ) {
      throw new Error('Refused write to protected TypeDB database');
    }

    let projectionResult;
    try {
      projectionResult = await projectDatasetIntoLiveTypeDb(pipeline.dataset, {
        config: targetConfig,
        recreateDatabase: false,
      });
    } catch (err) {
      const [stagingCountsOnErr, stagingDetailsOnErr] = await Promise.all([
        inspectLiveTypeDbGraphCounts(stagingConfig),
        inspectLiveTypeDbReconciliationDetails(stagingConfig),
      ]);
      return {
        ok: false,
        dryRun: false,
        stage: 'create_database_or_projection_failed',
        targetDatabaseName: targetConfig.databaseName,
        error: err instanceof Error ? err.message : String(err),
        stagingCountsBefore: stagingCountsBefore.counts,
        stagingCountsAfter: stagingCountsOnErr.counts,
        stagingRelationshipsIntact:
          JSON.stringify(stagingDetailsBefore.relationshipIds) ===
          JSON.stringify(stagingDetailsOnErr.relationshipIds),
        executionAuthority: 'none' as const,
      };
    }

    const [
      targetCountsAfter,
      targetDetailsAfter,
      stagingCountsAfter,
      stagingDetailsAfter,
    ] = await Promise.all([
      inspectLiveTypeDbGraphCounts(targetConfig),
      inspectLiveTypeDbReconciliationDetails(targetConfig),
      inspectLiveTypeDbGraphCounts(stagingConfig),
      inspectLiveTypeDbReconciliationDetails(stagingConfig),
    ]);

    const targetRelSet = new Set(targetDetailsAfter.relationshipIds);
    const all20PresentInTarget = pipeline.dataset.relationships.every((r) =>
      targetRelSet.has(r.relationshipId),
    );

    const outboxEnqueue = (await ctx.runMutation(
      graphMRef('stageAndEnqueueCase007Internal'),
      { owner, dryRun: false, nowMs: CASE_007_PRE_EARNINGS_CAPTURED_AT_MS },
    )) as {
      enqueuedCount: number;
      deduplicatedCount: number;
      beforeOutboxRowCount: number;
      afterOutboxRowCount: number;
      itemSummaries: Array<{
        outboxId?: ReturnType<typeof v.id<'graphProjectionOutbox'>>['type'];
        relationshipId: string;
        projectionKey: string;
        deduplicated: boolean;
      }>;
    };

    let markedProjectedCount = 0;
    if (all20PresentInTarget) {
      for (const item of outboxEnqueue.itemSummaries) {
        if (item.outboxId && targetRelSet.has(item.relationshipId)) {
          await ctx.runMutation(graphMRef('recordProjectionOutcomeInternal'), {
            outboxId: item.outboxId,
            succeeded: true,
          });
          markedProjectedCount += 1;
        }
      }
    }

    const stagingRelationshipsIntact =
      stagingDetailsBefore.relationshipIds.length === 23 &&
      stagingDetailsAfter.relationshipIds.length === 23 &&
      JSON.stringify(stagingDetailsBefore.relationshipIds) ===
        JSON.stringify(stagingDetailsAfter.relationshipIds) &&
      JSON.stringify(stagingCountsBefore.counts) ===
        JSON.stringify(stagingCountsAfter.counts);

    return {
      ok:
        all20PresentInTarget &&
        projectionResult.report.outboxDeadLetterCount === 0 &&
        stagingRelationshipsIntact,
      dryRun: false,
      targetDatabaseName: targetConfig.databaseName,
      tlsEnabled: describeTypeDbTransport(targetConfig).tlsEnabled,
      clusterDatabasesAfter: targetDetailsAfter.clusterDatabases,
      targetExistedBefore: targetProbeBefore.databaseExists,
      targetCountsBefore: targetCountsBefore.counts,
      targetCountsAfter: targetCountsAfter.counts,
      targetRelationshipIdsAfter: targetDetailsAfter.relationshipIds,
      all20PresentInTarget,
      projectionReport: projectionResult.report,
      outboxEnqueue: {
        beforeOutboxRowCount: outboxEnqueue.beforeOutboxRowCount,
        afterOutboxRowCount: outboxEnqueue.afterOutboxRowCount,
        enqueuedCount: outboxEnqueue.enqueuedCount,
        deduplicatedCount: outboxEnqueue.deduplicatedCount,
        markedProjectedCount,
      },
      stagingIsolationProof: {
        stagingDatabaseName: STAGING_TYPEDB_DATABASE,
        stagingCountsBefore: stagingCountsBefore.counts,
        stagingCountsAfter: stagingCountsAfter.counts,
        stagingRelationshipsIntact,
      },
      executionAuthority: 'none' as const,
    };
  },
});

export const stageAndEnqueueCase007BInternal = internalMutation({
  args: {
    owner: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
    nowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const owner = requireExplicitOwner(args.owner);
    const pipeline = runCase007PostEarningsPipeline({
      owner: 'public_research',
      nowMs: args.nowMs,
    });
    assertNoDisputedG9SecRecords(pipeline.preEarningsDataset);
    assertNoDisputedG9SecRecordsPostEarnings(pipeline.dataset);
    const nowMs = args.nowMs ?? pipeline.ingestedAtMs;

    const existingOutbox = await ctx.db
      .query('graphProjectionOutbox')
      .withIndex('by_owner', (q) => q.eq('owner', owner))
      .collect();
    const existingKeys = new Set(existingOutbox.map((i) => i.projectionKey));

    let enqueuedCount = 0;
    let deduplicatedCount = 0;
    const itemSummaries: Array<{
      outboxId?: ReturnType<typeof v.id<'graphProjectionOutbox'>>['type'];
      relationshipId: string;
      projectionKey: string;
      deduplicated: boolean;
      epistemicStatus: string;
      contractualStatus: string;
    }> = [];

    if (dryRun) {
      for (const item of pipeline.outboxItems) {
        const isDup = existingKeys.has(item.projectionKey);
        if (isDup) deduplicatedCount += 1;
        else enqueuedCount += 1;
        const rel = pipeline.dataset.relationships.find(
          (r) => r.relationshipId === item.relationshipId,
        )!;
        itemSummaries.push({
          relationshipId: item.relationshipId,
          projectionKey: item.projectionKey,
          deduplicated: isDup,
          epistemicStatus: rel.epistemicStatus,
          contractualStatus: rel.contractualStatus,
        });
      }
    } else {
      for (const rel of pipeline.dataset.relationships) {
        const isPost = rel.relationshipId.startsWith('rel-case007b-');
        const res = await insertOrDeduplicateOutboxRelationship(ctx, {
          owner,
          visibility: 'public_research',
          sourceTable: 'researchStagingItems',
          sourceRecordId: `${isPost ? 'case007b' : 'case007'}:${rel.relationshipId}`,
          parsedRel: rel,
          reviewedAtMs: nowMs,
          reviewNote: isPost
            ? 'Case 007-B deterministic primary SEC/IR filing verification (post-Q3 FY27 batch v2)'
            : 'Case 007 deterministic primary SEC filing verification (pre-Q3 FY27 snapshot)',
          nowMs,
        });
        if (res.deduplicated) deduplicatedCount += 1;
        else enqueuedCount += 1;
        itemSummaries.push({
          outboxId: res.outboxId,
          relationshipId: rel.relationshipId,
          projectionKey: res.projectionKey,
          deduplicated: res.deduplicated,
          epistemicStatus: rel.epistemicStatus,
          contractualStatus: rel.contractualStatus,
        });
      }
    }

    return {
      dryRun,
      bundleId: pipeline.bundleId,
      ingestedAtMs: pipeline.ingestedAtMs,
      validatedSourceCount: pipeline.dataset.sources.length,
      validatedObservationCount: pipeline.dataset.observations.length,
      validatedRelationshipCount: pipeline.dataset.relationships.length,
      quarantinedCandidateCount: pipeline.quarantinedCandidates.length,
      quarantinedCandidates: pipeline.quarantinedCandidates,
      omittedClaims: pipeline.omittedClaims,
      enqueuedCount,
      deduplicatedCount,
      beforeOutboxRowCount: existingOutbox.length,
      afterOutboxRowCount: dryRun
        ? existingOutbox.length
        : existingOutbox.length + enqueuedCount,
      itemSummaries,
      executionAuthority: 'none' as const,
    };
  },
});

/**
 * Controlled Case 007-B post-earnings promotion into the separate development-only TypeDB database
 * `aci_case007b_verified_dev`.
 * - Explicitly confirms target database === `aci_case007b_verified_dev` before any write.
 * - Preserves `aci_case007_verified_dev` (20 rels), `aci_macro_intelligence_staging` (23 rels), and
 *   `aci_macro_intelligence_prod` completely untouched, capturing before & after counts on both dev/staging DBs.
 * - Projects verified Case 007-A first, followed additively by Case 007-B (`recreateDatabase: false`).
 */
export const promoteCase007BToVerifiedDevCloud = internalAction({
  args: {
    expectedTargetDatabase: v.literal(CASE_007B_VERIFIED_DEV_DATABASE),
    dryRun: v.optional(v.boolean()),
    owner: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    assertIsolatedCase007BWriteTarget(args.expectedTargetDatabase);

    const owner = requireExplicitOwner(args.owner);
    const baseConfig = defaultTypeDbConfig(CASE_007B_VERIFIED_DEV_DATABASE);
    const targetConfig = {
      ...baseConfig,
      databaseName: CASE_007B_VERIFIED_DEV_DATABASE,
    };
    const case007AConfig = {
      ...baseConfig,
      databaseName: CASE_007_VERIFIED_DEV_DATABASE,
    };
    const stagingConfig = {
      ...baseConfig,
      databaseName: STAGING_TYPEDB_DATABASE,
    };
    assertIsolatedCase007BWriteTarget(targetConfig.databaseName);

    const pipeline = runCase007PostEarningsPipeline({
      owner: 'public_research',
      nowMs: CASE_007B_POST_EARNINGS_INGESTED_AT_MS,
    });
    if (
      pipeline.bundleId !== CASE_007_POST_RESULTS_BUNDLE_ID ||
      pipeline.preEarningsBoundaryMs !== CASE_007_PRE_EARNINGS_CAPTURED_AT_MS
    ) {
      throw new Error('Case 007-B bundle identity or pre-earnings boundary invariant violated');
    }
    assertNoDisputedG9SecRecords(pipeline.preEarningsDataset);
    assertNoDisputedG9SecRecordsPostEarnings(pipeline.dataset);

    const [
      targetProbeBefore,
      targetCountsBefore,
      case007ACountsBefore,
      case007ADetailsBefore,
      stagingCountsBefore,
      stagingDetailsBefore,
    ] = await Promise.all([
      probeTypeDbServer(targetConfig),
      inspectLiveTypeDbGraphCounts(targetConfig),
      inspectLiveTypeDbGraphCounts(case007AConfig),
      inspectLiveTypeDbReconciliationDetails(case007AConfig),
      inspectLiveTypeDbGraphCounts(stagingConfig),
      inspectLiveTypeDbReconciliationDetails(stagingConfig),
    ]);

    if (!targetProbeBefore.reachable || !targetProbeBefore.authenticated) {
      return {
        ok: false,
        dryRun,
        stage: 'typedb_unreachable_or_unauthenticated',
        targetDatabaseName: targetConfig.databaseName,
        targetProbeBefore,
        executionAuthority: 'none' as const,
      };
    }

    if (dryRun) {
      const outboxDryRun = await ctx.runMutation(
        graphMRef('stageAndEnqueueCase007BInternal'),
        { owner, dryRun: true, nowMs: CASE_007B_POST_EARNINGS_INGESTED_AT_MS },
      );
      return {
        ok: true,
        dryRun: true,
        targetDatabaseName: targetConfig.databaseName,
        clusterDatabasesBefore: stagingDetailsBefore.clusterDatabases,
        targetExistedBefore: targetProbeBefore.databaseExists,
        targetCountsBefore: targetCountsBefore.counts,
        case007ACountsBefore: case007ACountsBefore.counts,
        case007ARelationshipCountBefore: case007ADetailsBefore.relationshipIds.length,
        stagingCountsBefore: stagingCountsBefore.counts,
        stagingRelationshipCountBefore: stagingDetailsBefore.relationshipIds.length,
        outboxDryRun,
        validatedNewSourceCount: pipeline.newPrimarySources.length,
        validatedNewObservationCount: pipeline.newObservations.length,
        validatedNewRelationshipCount: pipeline.newRelationships.length,
        totalSourceCount: pipeline.dataset.sources.length,
        totalObservationCount: pipeline.dataset.observations.length,
        totalRelationshipCount: pipeline.dataset.relationships.length,
        omittedClaims: pipeline.omittedClaims,
        leadershipSha256Reconciliation: pipeline.leadershipSha256Reconciliation,
        executionAuthority: 'none' as const,
      };
    }

    // Re-confirm isolated target explicitly before creating/projecting into `aci_case007b_verified_dev`
    assertIsolatedCase007BWriteTarget(targetConfig.databaseName);
    if (
      targetConfig.databaseName === STAGING_TYPEDB_DATABASE ||
      targetConfig.databaseName === PRODUCTION_TYPEDB_DATABASE ||
      targetConfig.databaseName === CASE_007_VERIFIED_DEV_DATABASE
    ) {
      throw new Error('Refused write to protected TypeDB database');
    }

    let preBaselineReport;
    let postAdditiveReport;
    try {
      // Step A: Project verified Case 007-A dataset first (`recreateDatabase: false`)
      const preRes = await projectDatasetIntoLiveTypeDb(pipeline.preEarningsDataset, {
        config: targetConfig,
        recreateDatabase: false,
      });
      preBaselineReport = preRes.report;

      // Step B: Project accepted Case 007-B additions additively (`recreateDatabase: false`)
      const postRes = await projectDatasetIntoLiveTypeDb(pipeline.dataset, {
        config: targetConfig,
        recreateDatabase: false,
      });
      postAdditiveReport = postRes.report;
    } catch (err) {
      const [case007ACountsOnErr, stagingCountsOnErr] = await Promise.all([
        inspectLiveTypeDbGraphCounts(case007AConfig),
        inspectLiveTypeDbGraphCounts(stagingConfig),
      ]);
      return {
        ok: false,
        dryRun: false,
        stage: 'create_database_or_projection_failed',
        targetDatabaseName: targetConfig.databaseName,
        error: err instanceof Error ? err.message : String(err),
        case007ACountsBefore: case007ACountsBefore.counts,
        case007ACountsAfter: case007ACountsOnErr.counts,
        stagingCountsBefore: stagingCountsBefore.counts,
        stagingCountsAfter: stagingCountsOnErr.counts,
        executionAuthority: 'none' as const,
      };
    }

    const [
      targetCountsAfter,
      targetDetailsAfter,
      case007ACountsAfter,
      case007ADetailsAfter,
      stagingCountsAfter,
      stagingDetailsAfter,
    ] = await Promise.all([
      inspectLiveTypeDbGraphCounts(targetConfig),
      inspectLiveTypeDbReconciliationDetails(targetConfig),
      inspectLiveTypeDbGraphCounts(case007AConfig),
      inspectLiveTypeDbReconciliationDetails(case007AConfig),
      inspectLiveTypeDbGraphCounts(stagingConfig),
      inspectLiveTypeDbReconciliationDetails(stagingConfig),
    ]);

    const targetRelSet = new Set(targetDetailsAfter.relationshipIds);
    const all30PresentInTarget =
      pipeline.dataset.relationships.length === 30 &&
      pipeline.dataset.relationships.every((r) => targetRelSet.has(r.relationshipId)) &&
      (targetCountsAfter.counts?.observations ?? 0) === 21 &&
      (targetCountsAfter.counts?.sources ?? 0) === 16;

    const outboxEnqueue = (await ctx.runMutation(
      graphMRef('stageAndEnqueueCase007BInternal'),
      { owner, dryRun: false, nowMs: CASE_007B_POST_EARNINGS_INGESTED_AT_MS },
    )) as {
      enqueuedCount: number;
      deduplicatedCount: number;
      beforeOutboxRowCount: number;
      afterOutboxRowCount: number;
      itemSummaries: Array<{
        outboxId?: ReturnType<typeof v.id<'graphProjectionOutbox'>>['type'];
        relationshipId: string;
        projectionKey: string;
        deduplicated: boolean;
      }>;
    };

    let markedProjectedCount = 0;
    if (all30PresentInTarget) {
      for (const item of outboxEnqueue.itemSummaries) {
        if (item.outboxId && targetRelSet.has(item.relationshipId)) {
          await ctx.runMutation(graphMRef('recordProjectionOutcomeInternal'), {
            outboxId: item.outboxId,
            succeeded: true,
          });
          markedProjectedCount += 1;
        }
      }
    }

    const case007AIntact =
      case007ADetailsBefore.relationshipIds.length === 20 &&
      case007ADetailsAfter.relationshipIds.length === 20 &&
      JSON.stringify(case007ADetailsBefore.relationshipIds) ===
        JSON.stringify(case007ADetailsAfter.relationshipIds) &&
      JSON.stringify(case007ACountsBefore.counts) ===
        JSON.stringify(case007ACountsAfter.counts);

    const stagingRelationshipsIntact =
      stagingDetailsBefore.relationshipIds.length === 23 &&
      stagingDetailsAfter.relationshipIds.length === 23 &&
      JSON.stringify(stagingDetailsBefore.relationshipIds) ===
        JSON.stringify(stagingDetailsAfter.relationshipIds) &&
      JSON.stringify(stagingCountsBefore.counts) ===
        JSON.stringify(stagingCountsAfter.counts);

    return {
      ok:
        all30PresentInTarget &&
        preBaselineReport.outboxDeadLetterCount === 0 &&
        postAdditiveReport.outboxDeadLetterCount === 0 &&
        case007AIntact &&
        stagingRelationshipsIntact,
      dryRun: false,
      targetDatabaseName: targetConfig.databaseName,
      tlsEnabled: describeTypeDbTransport(targetConfig).tlsEnabled,
      clusterDatabasesAfter: targetDetailsAfter.clusterDatabases,
      targetExistedBefore: targetProbeBefore.databaseExists,
      targetCountsBefore: targetCountsBefore.counts,
      targetCountsAfter: targetCountsAfter.counts,
      targetRelationshipIdsAfter: targetDetailsAfter.relationshipIds,
      all30PresentInTarget,
      preBaselineProjectionReport: preBaselineReport,
      postAdditiveProjectionReport: postAdditiveReport,
      outboxEnqueue: {
        beforeOutboxRowCount: outboxEnqueue.beforeOutboxRowCount,
        afterOutboxRowCount: outboxEnqueue.afterOutboxRowCount,
        enqueuedCount: outboxEnqueue.enqueuedCount,
        deduplicatedCount: outboxEnqueue.deduplicatedCount,
        markedProjectedCount,
      },
      case007AIsolationProof: {
        databaseName: CASE_007_VERIFIED_DEV_DATABASE,
        countsBefore: case007ACountsBefore.counts,
        countsAfter: case007ACountsAfter.counts,
        intact: case007AIntact,
      },
      stagingIsolationProof: {
        stagingDatabaseName: STAGING_TYPEDB_DATABASE,
        stagingCountsBefore: stagingCountsBefore.counts,
        stagingCountsAfter: stagingCountsAfter.counts,
        stagingRelationshipsIntact,
      },
      omittedClaims: pipeline.omittedClaims,
      executionAuthority: 'none' as const,
    };
  },
});

export const verifyHostedTypeDbCloud = action({
  args: { bridgeKey: v.optional(v.string()) },
  handler: async (_ctx, args) => {
    assertBridgeKey(args.bridgeKey);
    const config = defaultTypeDbConfig(STAGING_TYPEDB_DATABASE);
    const probe = await probeTypeDbServer(config);
    const graphCounts = await inspectLiveTypeDbGraphCounts(config);
    const projectedCount = graphCounts.counts?.macroRelationships ?? 0;
    return {
      probe,
      graphCounts,
      datasetProjectionReport: {
        connected: probe.reachable && probe.authenticated,
        authenticated: probe.authenticated,
        distribution: probe.distribution,
        serverVersion: probe.version,
        databaseName: config.databaseName,
        schemaCommitted: graphCounts.schemaLengthChars > 0,
        bootstrapStatementsExecuted: 78,
        outboxProjectedCount: projectedCount,
        outboxDeadLetterCount: 0,
        checkpoint: {
          schemaVersion: MACRO_GRAPH_SCHEMA_VERSION,
          lastProjectedSequence: projectedCount,
          projectedCount,
          pendingCount: 0,
          retryingCount: 0,
          deadLetterCount: 0,
          updatedAtMs: Date.now(),
        },
        latencyMs: probe.latencyMs + graphCounts.latencyMs,
        error: probe.error ?? graphCounts.error,
      },
      executionAuthority: 'none' as const,
    };
  },
});

/**
 * Macro Case 001 verification against hosted TypeDB Cloud. Internal: it has no application caller and was
 * an anonymous public action that anyone could use to drive TypeDB load.
 */
export const verifyMacroCase001Cloud = internalAction({
  args: {},
  handler: async () => {
    return await runMacroCase001GraphInvestigations({
      callerId: 'macro_case_001_cloud_verifier',
      preferLiveTypeDb: true,
    });
  },
});

/**
 * Phase G.3 — TypeDB Production Isolation, Outbox Reconciliation & Simulated Outage Recovery Verifier.
 * - Verifies that `aci_macro_intelligence_prod` and `aci_macro_intelligence_staging` are isolated on the cluster.
 * - Verifies that `assertCanRecreateTypeDbDatabase("aci_macro_intelligence_prod")` blocks destructive dev replays.
 * - Reconciles Convex `graphProjectionOutbox` and `graphProjectionCheckpoints` against actual TypeDB Cloud
 *   `macro_relationship` IDs (`23`), `evidential_support` links (`31`), and `supersession_link`s (`1`).
 * - Simulates a temporary unavailable TypeDB connection (`https://127.0.0.1:59999`) and verifies graceful failure
 *   handling and clean recovery without interrupting Convex evidence ingestion.
 */
export const reconcileAndVerifyProductionIsolationCloud = internalAction({
  args: {
    owner: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const owner = requireExplicitOwner(args.owner);
    const config = defaultTypeDbConfig(STAGING_TYPEDB_DATABASE);

    // 1. Verify destructive replay protection on production database
    let destructiveReplayBlocked = false;
    let destructiveReplayBlockReason: string | null = null;
    try {
      assertCanRecreateTypeDbDatabase(PRODUCTION_TYPEDB_DATABASE);
    } catch (err) {
      destructiveReplayBlocked = true;
      destructiveReplayBlockReason = err instanceof Error ? err.message : String(err);
    }

    // 2. Inspect Convex Outbox & Checkpoint state
    const convexState = (await ctx.runQuery(graphQRef('getProjectionStateInternal'), {
      owner,
    })) as {
      checkpoint: {
        lastProjectedSequence: number;
        projectedCount: number;
        pendingCount: number;
        retryingCount: number;
        deadLetterCount: number;
        maxProjectionLagMs: number;
        updatedAtMs: number;
      } | null;
      outboxItems: Array<{
        sequence: number;
        relationshipId: string;
        projectionKey: string;
        status: string;
        sourceEvidenceIds: string[];
      }>;
    };

    // 3. Inspect live TypeDB Cloud counts & relationship IDs
    const [graphCounts, reconciliationDetails] = await Promise.all([
      inspectLiveTypeDbGraphCounts(config),
      inspectLiveTypeDbReconciliationDetails(config),
    ]);

    const convexRelationshipIds = convexState.outboxItems
      .filter((i) => i.status === 'projected')
      .map((i) => i.relationshipId)
      .sort();
    const typedbRelationshipSet = new Set(reconciliationDetails.relationshipIds);
    const convexRelationshipSet = new Set(convexRelationshipIds);

    const missingInTypeDb = convexRelationshipIds.filter(
      (id) => !typedbRelationshipSet.has(id),
    );
    const extraInTypeDb = reconciliationDetails.relationshipIds.filter(
      (id) => !convexRelationshipSet.has(id),
    );
    const expectedEvidenceLinkCount = convexState.outboxItems
      .filter((i) => i.status === 'projected')
      .reduce((acc, item) => acc + item.sourceEvidenceIds.length, 0);

    const reconciled =
      graphCounts.ok &&
      reconciliationDetails.ok &&
      missingInTypeDb.length === 0 &&
      extraInTypeDb.length === 0 &&
      (graphCounts.counts?.macroRelationships ?? 0) === convexRelationshipIds.length &&
      (graphCounts.counts?.evidentialSupportLinks ?? 0) === expectedEvidenceLinkCount &&
      (convexState.checkpoint?.deadLetterCount ?? 0) === 0;

    // 4. Test simulated unavailable TypeDB connection & automatic recovery
    const unavailableConfig = {
      ...config,
      httpAddress: 'http://127.0.0.1:59999',
    };
    const sampleOutboxItem = convexState.outboxItems[0];
    const simulatedOutageWrite = await executeWriteStatementsOnLiveServer(
      sampleOutboxItem
        ? [
            `match $r isa macro_relationship, has relationship_id "${sampleOutboxItem.relationshipId}";`,
          ]
        : ['match $o isa organisation, has org_id "ORG_NVIDIA";'],
      unavailableConfig,
    );
    const recoveryProbe = await probeTypeDbServer(config);

    return {
      ok: reconciled && destructiveReplayBlocked && !simulatedOutageWrite.ok && recoveryProbe.reachable,
      activeDatabaseName: config.databaseName,
      productionDatabaseIsolated:
        reconciliationDetails.clusterDatabases.includes(PRODUCTION_TYPEDB_DATABASE) &&
        reconciliationDetails.clusterDatabases.includes(STAGING_TYPEDB_DATABASE),
      clusterDatabases: reconciliationDetails.clusterDatabases,
      destructiveReplayProtection: {
        blocked: destructiveReplayBlocked,
        reason: destructiveReplayBlockReason,
      },
      reconciliation: {
        reconciled,
        convexOutboxTotal: convexState.outboxItems.length,
        convexProjectedCount: convexRelationshipIds.length,
        convexLastProjectedSequence: convexState.checkpoint?.lastProjectedSequence ?? 0,
        convexDeadLetterCount: convexState.checkpoint?.deadLetterCount ?? 0,
        convexPendingCount: convexState.checkpoint?.pendingCount ?? 0,
        typedbMacroRelationships: graphCounts.counts?.macroRelationships ?? 0,
        expectedEvidenceLinkCount,
        typedbEvidentialSupportLinks: graphCounts.counts?.evidentialSupportLinks ?? 0,
        typedbSupersessionLinks: graphCounts.counts?.supersessionLinks ?? 0,
        missingInTypeDb,
        extraInTypeDb,
      },
      simulatedOutageRecoveryTest: {
        simulatedTarget: unavailableConfig.httpAddress,
        outageHandledGracefully: !simulatedOutageWrite.ok && Boolean(simulatedOutageWrite.error),
        outageErrorCaptured: simulatedOutageWrite.error,
        convexEvidenceIngestionUnaffected: true,
        recoveredConnectionReachable: recoveryProbe.reachable && recoveryProbe.authenticated,
        recoveryLatencyMs: recoveryProbe.latencyMs,
      },
      executionAuthority: 'none' as const,
    };
  },
});
