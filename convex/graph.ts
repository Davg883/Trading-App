import { v } from 'convex/values';
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server';
import { mutation, query, type DataModel } from './server';
import { reviewer, signedIn } from './authz';
import {
  MACRO_GRAPH_SCHEMA_VERSION,
  macroRelationshipSchema,
} from '../lib/graph/contracts';
import {
  computeDeterministicProjectionKey,
  computeRetryBackoffMs,
} from '../lib/graph/projection-engine';
import {
  compileEvidentialSupportInsertTypeQl,
  compileRelationshipInsertTypeQl,
} from '../lib/graph/typedb-schema';
import { assertNoBrokerOrPrivateAccountData } from '../lib/graph/query-gateway';

type Ctx = GenericMutationCtx<DataModel> | GenericQueryCtx<DataModel>;

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

    const projectionKey = computeDeterministicProjectionKey(
      owner,
      args.visibility,
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
      compileRelationshipInsertTypeQl(parsedRel, projectionKey, owner, args.visibility),
      ...parsedRel.sourceDocIds.map((docId) =>
        compileEvidentialSupportInsertTypeQl(parsedRel, docId),
      ),
    ];

    const outboxId = await ctx.db.insert('graphProjectionOutbox', {
      owner,
      visibility: args.visibility,
      sequence: nextSequence,
      projectionKey,
      sourceTable: args.sourceTable,
      sourceRecordId: args.sourceRecordId,
      sourceEvidenceIds: parsedRel.sourceDocIds,
      graphSchemaVersion: MACRO_GRAPH_SCHEMA_VERSION,
      relationshipId: parsedRel.relationshipId,
      payloadJson: JSON.stringify(parsedRel),
      typeqlJson: JSON.stringify(statements),
      reviewer: owner,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: Math.min(Math.max(args.maxAttempts ?? 3, 1), 10),
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
    const user = await signedIn(ctx);
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
        lastError: null,
        projectedAtMs: nowMs,
        updatedAtMs: nowMs,
      });
    } else {
      const dead = attemptCount >= item.maxAttempts;
      await ctx.db.patch(item._id, {
        status: dead ? 'dead_letter' : 'retrying',
        attemptCount,
        lastError: args.errorMessage ?? 'TypeDB transaction failed',
        nextAttemptAtMs: dead
          ? item.nextAttemptAtMs
          : nowMs + computeRetryBackoffMs(attemptCount),
        updatedAtMs: nowMs,
      });
    }

    await recomputeCheckpoint(ctx, owner, nowMs);
    return { status: args.succeeded ? 'projected' : attemptCount >= item.maxAttempts ? 'dead_letter' : 'retrying' };
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

    return {
      schemaVersion: MACRO_GRAPH_SCHEMA_VERSION,
      checkpoint,
      outboxItems: items.sort((a, b) => a.sequence - b.sequence),
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
    const user = await signedIn(ctx);
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
