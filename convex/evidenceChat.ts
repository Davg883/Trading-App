import { v } from 'convex/values';
import {
  actionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
  type ActionBuilder,
  type MutationBuilder,
  type QueryBuilder,
} from 'convex/server';
import { query, mutation, type DataModel } from './server';
import { researcher, verifyIdentityClaims } from './authz';
import {
  macroRelationshipSchema,
  type MacroGraphDataset,
  type MacroRelationship,
} from '../lib/graph/contracts';
import { loadInitialAcceptanceDataset } from '../lib/graph/query-gateway';
import { retrieveClosedEvidenceBundle } from '../lib/graph/evidence-retrieval-gateway';
import {
  checkGeminiProviderAvailability,
  generateAndValidateEvidenceLockedAnswer,
} from '../lib/graph/gemini-provider-adapter';
import type { TemporalBasis } from '../lib/graph/evidence-chat-contracts';

const action: ActionBuilder<DataModel, 'public'> = actionGeneric;
const internalQuery: QueryBuilder<DataModel, 'internal'> = internalQueryGeneric;
const internalMutation: MutationBuilder<DataModel, 'internal'> = internalMutationGeneric;

const iqRef = (name: string) => makeFunctionReference<'query'>(`evidenceChat:${name}`);
const imRef = (name: string) => makeFunctionReference<'mutation'>(`evidenceChat:${name}`);

function validOwner(owner: string) {
  if (!owner.trim() || owner.length > 1000) throw new Error('Owner required');
}

/**
 * Internal query to load the caller's current TypeDB projection checkpoint,
 * any additional approved `public_research` relationships from `graphProjectionOutbox`,
 * and the caller's daily model spend so far.
 */
export const getChatRetrievalContextInternal = internalQuery({
  args: { owner: v.string() },
  handler: async (ctx, args) => {
    validOwner(args.owner);
    const checkpoint = await ctx.db
      .query('graphProjectionCheckpoints')
      .withIndex('by_owner_key', (q) =>
        q.eq('owner', args.owner).eq('checkpointKey', `ckpt:${args.owner}:main`),
      )
      .first();

    const projectedRows = await ctx.db
      .query('graphProjectionOutbox')
      .withIndex('by_owner', (q) => q.eq('owner', args.owner))
      .take(200);

    const publicProjectedRelationships: MacroRelationship[] = [];
    for (const row of projectedRows) {
      if (row.visibility !== 'public_research' || row.status !== 'projected') continue;
      try {
        const parsed = macroRelationshipSchema.parse(JSON.parse(row.payloadJson));
        publicProjectedRelationships.push(parsed);
      } catch {
        // Ignore malformed legacy rows
      }
    }

    const settings = await ctx.db
      .query('operationsSettings')
      .withIndex('by_owner', (q) => q.eq('owner', args.owner))
      .first();

    const dayStartMs = Date.now() - 86_400_000;
    const recentChatTurns = await ctx.db
      .query('evidenceChatAudit')
      .withIndex('by_owner', (q) => q.eq('owner', args.owner))
      .order('desc')
      .take(100);

    let dailyChatSpendGbp = 0;
    for (const t of recentChatTurns) {
      if (t.createdAtMs >= dayStartMs) {
        dailyChatSpendGbp += Math.max(t.estimatedCostGbp, t.actualCostGbp ?? 0);
      }
    }

    return {
      checkpoint: checkpoint
        ? {
            lastProjectedSequence: checkpoint.lastProjectedSequence,
            lastProjectionKey: checkpoint.lastProjectionKey,
            projectedCount: checkpoint.projectedCount,
            reconciled:
              checkpoint.pendingCount === 0 &&
              checkpoint.retryingCount === 0 &&
              checkpoint.deadLetterCount === 0,
          }
        : null,
      publicProjectedRelationships,
      dailyCostCeilingGbp: settings?.dailyCostCeilingGbp ?? 2.0,
      dailyChatSpendGbp,
    };
  },
});

export const recordEvidenceChatTurnInternal = internalMutation({
  args: {
    owner: v.string(),
    turnId: v.string(),
    bundleId: v.string(),
    bundleSha256: v.string(),
    question: v.string(),
    queryType: v.string(),
    intentCategory: v.string(),
    historicalCutoffMs: v.number(),
    temporalBasis: v.union(v.literal('publication'), v.literal('receipt')),
    graphDatabaseName: v.string(),
    graphSchemaVersion: v.string(),
    lastProjectedSequence: v.number(),
    supportStatus: v.union(
      v.literal('fully_supported'),
      v.literal('partially_supported'),
      v.literal('unsupported'),
    ),
    validationValid: v.boolean(),
    validationAction: v.string(),
    modelId: v.string(),
    generationMode: v.string(),
    providerStatus: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cachedTokens: v.number(),
    estimatedCostGbp: v.number(),
    actualCostGbp: v.union(v.number(), v.null()),
    latencyMs: v.number(),
    bundleJson: v.string(),
    answerJson: v.string(),
    validationJson: v.string(),
    createdAtMs: v.number(),
  },
  handler: async (ctx, args) => {
    validOwner(args.owner);
    const id = await ctx.db.insert('evidenceChatAudit', {
      ...args,
      executionAuthority: 'none',
    });
    await ctx.db.insert('audit', {
      owner: args.owner,
      action: 'graph.evidence_chat.turn',
      recordId: args.bundleId,
      detail: `q="${args.question.slice(0, 120)}" support=${args.supportStatus} valid=${args.validationValid} mode=${args.generationMode} costGbp=${args.estimatedCostGbp.toFixed(6)}`,
      at: args.createdAtMs,
    });
    return { auditId: id };
  },
});

/**
 * Owner-scoped query returning the authenticated user's Evidence-Locked Chat history.
 * Strictly isolated by `user.tokenIdentifier` — never returns another user's turns or bundles.
 */
export const listChatHistory = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await researcher(ctx);
    const owner = user.tokenIdentifier;
    const takeCount = Math.max(1, Math.min(50, args.limit ?? 20));
    const rows = await ctx.db
      .query('evidenceChatAudit')
      .withIndex('by_owner', (q) => q.eq('owner', owner))
      .order('desc')
      .take(takeCount);

    return rows.map((r) => ({
      turnId: r.turnId,
      bundleId: r.bundleId,
      bundleSha256: r.bundleSha256,
      question: r.question,
      queryType: r.queryType,
      intentCategory: r.intentCategory,
      historicalCutoffMs: r.historicalCutoffMs,
      temporalBasis: r.temporalBasis,
      graphDatabaseName: r.graphDatabaseName,
      lastProjectedSequence: r.lastProjectedSequence,
      supportStatus: r.supportStatus,
      validationValid: r.validationValid,
      validationAction: r.validationAction,
      modelId: r.modelId,
      generationMode: r.generationMode,
      providerStatus: r.providerStatus,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cachedTokens: r.cachedTokens,
      estimatedCostGbp: r.estimatedCostGbp,
      actualCostGbp: r.actualCostGbp,
      latencyMs: r.latencyMs,
      bundle: JSON.parse(r.bundleJson),
      answer: JSON.parse(r.answerJson),
      validation: JSON.parse(r.validationJson),
      createdAtMs: r.createdAtMs,
      executionAuthority: 'none' as const,
    }));
  },
});

/**
 * Owner-scoped query to retrieve a specific immutable EvidenceBundleV1 by bundleId.
 */
export const getEvidenceBundleById = query({
  args: { bundleId: v.string() },
  handler: async (ctx, args) => {
    const user = await researcher(ctx);
    const owner = user.tokenIdentifier;
    const row = await ctx.db
      .query('evidenceChatAudit')
      .withIndex('by_bundle', (q) => q.eq('owner', owner).eq('bundleId', args.bundleId))
      .first();
    if (!row || row.owner !== owner) {
      throw new Error('Evidence bundle not found or unauthorized for this tenant');
    }
    return {
      turnId: row.turnId,
      bundleId: row.bundleId,
      bundleSha256: row.bundleSha256,
      bundle: JSON.parse(row.bundleJson),
      answer: JSON.parse(row.answerJson),
      validation: JSON.parse(row.validationJson),
      createdAtMs: row.createdAtMs,
      executionAuthority: 'none' as const,
    };
  },
});

/**
 * Convex Action: Authenticated Evidence-Locked Research Question Handler.
 * Executes:
 *   User question -> authenticated intent selection -> allowlisted TypeDB/Convex retrieval ->
 *   authorised EvidenceBundleV1 -> Gemini inference -> independent validation -> cited answer + audit log.
 */
export const askEvidenceLockedQuestion = action({
  args: {
    question: v.string(),
    historicalCutoffMs: v.optional(v.number()),
    temporalBasis: v.optional(v.union(v.literal('publication'), v.literal('receipt'))),
    mode: v.optional(
      v.union(
        v.literal('auto'),
        v.literal('gemini_live_required'),
        v.literal('deterministic_evidence_synthesis'),
      ),
    ),
    simulateProviderFailure: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const rawIdentity = await ctx.auth.getUserIdentity();
    if (!rawIdentity) {
      throw new Error('Sign in required before querying the Evidence-Locked Research Assistant');
    }
    const identity = verifyIdentityClaims(rawIdentity);
    if (identity.actorType !== undefined && identity.actorType !== 'human') {
      throw new Error('Automated actors cannot invoke interactive research chat');
    }
    const owner = identity.tokenIdentifier;

    const retrievalCtx = (await ctx.runQuery(iqRef('getChatRetrievalContextInternal'), {
      owner,
    })) as {
      checkpoint: {
        lastProjectedSequence: number;
        lastProjectionKey: string | null;
        projectedCount: number;
        reconciled: boolean;
      } | null;
      publicProjectedRelationships: MacroRelationship[];
      dailyCostCeilingGbp: number;
      dailyChatSpendGbp: number;
    };

    // Merge base acceptance dataset with any additional projected `public_research` relationships
    const baseDataset = loadInitialAcceptanceDataset();
    const mergedRelMap = new Map<string, MacroRelationship>();
    for (const r of baseDataset.relationships) {
      mergedRelMap.set(r.relationshipId, r);
    }
    for (const r of retrievalCtx.publicProjectedRelationships) {
      mergedRelMap.set(r.relationshipId, r);
    }
    const mergedDataset: MacroGraphDataset = {
      ...baseDataset,
      relationships: [...mergedRelMap.values()],
    };

    const temporalBasis: TemporalBasis = args.temporalBasis ?? 'receipt';
    const bundle = await retrieveClosedEvidenceBundle({
      question: args.question,
      requesterId: owner,
      historicalCutoffMs: args.historicalCutoffMs,
      temporalBasis,
      dataset: mergedDataset,
      projectionCheckpoint: retrievalCtx.checkpoint ?? undefined,
      graphDatabaseName: process.env.TYPEDB_DATABASE ?? 'aci_macro_intelligence_prod',
      preferLiveTypeDb: Boolean(process.env.TYPEDB_HTTP_ADDRESS),
    });

    const turnResult = await generateAndValidateEvidenceLockedAnswer({
      bundle,
      callerId: owner,
      mode: args.mode ?? 'auto',
      dailySpentGbpSoFar: retrievalCtx.dailyChatSpendGbp,
      dailyCostCeilingGbp: retrievalCtx.dailyCostCeilingGbp,
      simulateProviderFailure: args.simulateProviderFailure ?? false,
    });

    await ctx.runMutation(imRef('recordEvidenceChatTurnInternal'), {
      owner,
      turnId: turnResult.turnId,
      bundleId: bundle.bundleId,
      bundleSha256: bundle.bundleSha256,
      question: bundle.question,
      queryType: bundle.selectedQuery.queryType,
      intentCategory: bundle.selectedQuery.intentCategory,
      historicalCutoffMs: bundle.historicalCutoffMs,
      temporalBasis: bundle.temporalBasis,
      graphDatabaseName: bundle.graphDatabaseName,
      graphSchemaVersion: bundle.graphSchemaVersion,
      lastProjectedSequence: bundle.projectionCheckpoint.lastProjectedSequence,
      supportStatus: turnResult.answer.supportStatus,
      validationValid: turnResult.validation.valid,
      validationAction: turnResult.validation.actionTaken,
      modelId: turnResult.telemetry.modelId,
      generationMode: turnResult.telemetry.generationMode,
      providerStatus: turnResult.telemetry.providerStatus,
      inputTokens: turnResult.telemetry.inputTokens,
      outputTokens: turnResult.telemetry.outputTokens,
      cachedTokens: turnResult.telemetry.cachedTokens,
      estimatedCostGbp: turnResult.telemetry.estimatedCostGbp,
      actualCostGbp: turnResult.telemetry.actualCostGbp,
      latencyMs: turnResult.telemetry.latencyMs,
      bundleJson: JSON.stringify(bundle),
      answerJson: JSON.stringify(turnResult.answer),
      validationJson: JSON.stringify(turnResult.validation),
      createdAtMs: turnResult.createdAtMs,
    });

    return turnResult;
  },
});

/**
 * Owner-scoped Evidence Chat telemetry summary.
 *
 * Security (MVP hardening): this query previously accepted anonymous callers, substituted `RESEARCH_OWNER_ID`
 * for the missing identity and, when that owner had no rows, scanned the whole `evidenceChatAudit` table.
 * It now requires a verified human identity and reads only that identity's rows through the owner index.
 */
export const getChatOperationsTelemetry = query({
  args: {},
  handler: async (ctx) => {
    const user = await researcher(ctx);
    const owner = user.tokenIdentifier;

    const recentTurns = await ctx.db
      .query('evidenceChatAudit')
      .withIndex('by_owner', (q) => q.eq('owner', owner))
      .order('desc')
      .take(50);

    const dayStartMs = Date.now() - 86_400_000;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let dailySpendGbp = 0;
    let abstentionCount = 0;
    let validationRejectedCount = 0;

    for (const t of recentTurns) {
      totalInputTokens += t.inputTokens;
      totalOutputTokens += t.outputTokens;
      if (t.createdAtMs >= dayStartMs) {
        dailySpendGbp += Math.max(t.estimatedCostGbp, t.actualCostGbp ?? 0);
      }
      if (t.supportStatus === 'unsupported') abstentionCount += 1;
      if (!t.validationValid) validationRejectedCount += 1;
    }

    const latestGeminiLiveTurn =
      recentTurns.find(
        (t) => t.generationMode === 'gemini_live' && t.providerStatus === 'succeeded',
      ) ?? null;

    const geminiConfigured = Boolean(
      process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY ||
        process.env.GOOGLE_GEMINI_API_KEY ||
        process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
        latestGeminiLiveTurn,
    );
    const geminiEnabled = Boolean(
      process.env.EVIDENCE_CHAT_GEMINI_ENABLED === 'true' || latestGeminiLiveTurn,
    );

    return {
      modelId:
        latestGeminiLiveTurn?.modelId ??
        process.env.GEMINI_MODEL_ID ??
        'gemini-2.5-flash',
      geminiConfigured,
      geminiEnabled,
      totalTurnsRecorded: recentTurns.length,
      totalInputTokens,
      totalOutputTokens,
      dailySpendGbp: Number(dailySpendGbp.toFixed(6)),
      abstentionCount,
      validationRejectedCount,
      unsupportedAnswerRate:
        recentTurns.length > 0
          ? Number((abstentionCount / recentTurns.length).toFixed(4))
          : 0,
      lastTurnAtMs: recentTurns[0]?.createdAtMs ?? null,
      executionAuthority: 'none' as const,
    };
  },
});

/**
 * Owner-authenticated query to load retrieval context (TypeDB checkpoint, projected relationships, daily spend)
 * when inference executes on the Next.js server route (`app/api/graph/chat/route.ts`).
 */
export const getChatRetrievalContext = query({
  args: {},
  handler: async (ctx) => {
    const user = await researcher(ctx);
    const owner = user.tokenIdentifier;
    const checkpoint = await ctx.db
      .query('graphProjectionCheckpoints')
      .withIndex('by_owner_key', (q) =>
        q.eq('owner', owner).eq('checkpointKey', `ckpt:${owner}:main`),
      )
      .first();

    const projectedRows = await ctx.db
      .query('graphProjectionOutbox')
      .withIndex('by_owner', (q) => q.eq('owner', owner))
      .take(200);

    const publicProjectedRelationships: MacroRelationship[] = [];
    for (const row of projectedRows) {
      if (row.visibility !== 'public_research' || row.status !== 'projected') continue;
      try {
        const parsed = macroRelationshipSchema.parse(JSON.parse(row.payloadJson));
        publicProjectedRelationships.push(parsed);
      } catch {
        // Ignore malformed legacy rows
      }
    }

    const settings = await ctx.db
      .query('operationsSettings')
      .withIndex('by_owner', (q) => q.eq('owner', owner))
      .first();

    const dayStartMs = Date.now() - 86_400_000;
    const recentChatTurns = await ctx.db
      .query('evidenceChatAudit')
      .withIndex('by_owner', (q) => q.eq('owner', owner))
      .order('desc')
      .take(100);

    let dailyChatSpendGbp = 0;
    for (const t of recentChatTurns) {
      if (t.createdAtMs >= dayStartMs) {
        dailyChatSpendGbp += Math.max(t.estimatedCostGbp, t.actualCostGbp ?? 0);
      }
    }

    return {
      owner,
      checkpoint: checkpoint
        ? {
            lastProjectedSequence: checkpoint.lastProjectedSequence,
            lastProjectionKey: checkpoint.lastProjectionKey,
            projectedCount: checkpoint.projectedCount,
            reconciled:
              checkpoint.pendingCount === 0 &&
              checkpoint.retryingCount === 0 &&
              checkpoint.deadLetterCount === 0,
          }
        : null,
      publicProjectedRelationships,
      dailyCostCeilingGbp: settings?.dailyCostCeilingGbp ?? 2.0,
      dailyChatSpendGbp,
    };
  },
});

/**
 * Owner-authenticated mutation to record a completed Evidence-Locked Chat turn executed on the Next.js server.
 */
export const recordEvidenceChatTurn = mutation({
  args: {
    turnId: v.string(),
    bundleId: v.string(),
    bundleSha256: v.string(),
    question: v.string(),
    queryType: v.string(),
    intentCategory: v.string(),
    historicalCutoffMs: v.number(),
    temporalBasis: v.union(v.literal('publication'), v.literal('receipt')),
    graphDatabaseName: v.string(),
    graphSchemaVersion: v.string(),
    lastProjectedSequence: v.number(),
    supportStatus: v.union(
      v.literal('fully_supported'),
      v.literal('partially_supported'),
      v.literal('unsupported'),
    ),
    validationValid: v.boolean(),
    validationAction: v.string(),
    modelId: v.string(),
    generationMode: v.string(),
    providerStatus: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cachedTokens: v.number(),
    estimatedCostGbp: v.number(),
    actualCostGbp: v.union(v.number(), v.null()),
    latencyMs: v.number(),
    bundleJson: v.string(),
    answerJson: v.string(),
    validationJson: v.string(),
    createdAtMs: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await researcher(ctx);
    const owner = user.tokenIdentifier;
    const id = await ctx.db.insert('evidenceChatAudit', {
      owner,
      ...args,
      executionAuthority: 'none',
    });
    await ctx.db.insert('audit', {
      owner,
      action: 'graph.evidence_chat.turn',
      recordId: args.bundleId,
      detail: `q="${args.question.slice(0, 120)}" support=${args.supportStatus} valid=${args.validationValid} mode=${args.generationMode} costGbp=${args.estimatedCostGbp.toFixed(6)}`,
      at: args.createdAtMs,
    });
    return { auditId: id };
  },
});

/**
 * Internal mutation (callable only via deployment admin / `npx convex run`) to mint a single-use,
 * 120-second acceptance nonce for verifying server-side Gemini inference on Vercel Production.
 */
export const mintServerAcceptanceTokenInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const owner = process.env.RESEARCH_OWNER_ID ?? 'system_acceptance';
    const now = Date.now();
    const randomPart = Array.from({ length: 4 }, () =>
      Math.floor(Math.random() * 0xffffffff)
        .toString(16)
        .padStart(8, '0'),
    ).join('');
    const nonce = `aci-accept-${now}-${randomPart}`;
    await ctx.db.insert('audit', {
      owner,
      action: 'graph.evidence_chat.acceptance_nonce',
      recordId: nonce,
      detail: 'issued',
      at: now,
    });
    return { nonce, owner, expiresAtMs: now + 120_000 };
  },
});

export const consumeAcceptanceNonceAndGetContext = mutation({
  args: { nonce: v.string() },
  handler: async (ctx, args) => {
    const owner = process.env.RESEARCH_OWNER_ID ?? 'system_acceptance';
    const now = Date.now();
    const recentAudits = await ctx.db
      .query('audit')
      .withIndex('by_owner', (q) => q.eq('owner', owner))
      .order('desc')
      .take(40);
    const match = recentAudits.find(
      (a) =>
        a.action === 'graph.evidence_chat.acceptance_nonce' &&
        a.recordId === args.nonce &&
        a.detail === 'issued' &&
        now - a.at <= 120_000,
    );
    if (!match) {
      return { valid: false as const };
    }
    await ctx.db.patch(match._id, { detail: 'consumed' });

    const checkpoint = await ctx.db
      .query('graphProjectionCheckpoints')
      .withIndex('by_owner_key', (q) =>
        q.eq('owner', owner).eq('checkpointKey', `ckpt:${owner}:main`),
      )
      .first();

    const projectedRows = await ctx.db
      .query('graphProjectionOutbox')
      .withIndex('by_owner', (q) => q.eq('owner', owner))
      .take(200);

    const publicProjectedRelationships: MacroRelationship[] = [];
    for (const row of projectedRows) {
      if (row.visibility !== 'public_research' || row.status !== 'projected') continue;
      try {
        const parsed = macroRelationshipSchema.parse(JSON.parse(row.payloadJson));
        publicProjectedRelationships.push(parsed);
      } catch {
        // Ignore malformed legacy rows
      }
    }

    const settings = await ctx.db
      .query('operationsSettings')
      .withIndex('by_owner', (q) => q.eq('owner', owner))
      .first();

    const dayStartMs = now - 86_400_000;
    const recentChatTurns = await ctx.db
      .query('evidenceChatAudit')
      .withIndex('by_owner', (q) => q.eq('owner', owner))
      .order('desc')
      .take(100);

    let dailyChatSpendGbp = 0;
    for (const t of recentChatTurns) {
      if (t.createdAtMs >= dayStartMs) {
        dailyChatSpendGbp += Math.max(t.estimatedCostGbp, t.actualCostGbp ?? 0);
      }
    }

    return {
      valid: true as const,
      owner,
      checkpoint: checkpoint
        ? {
            lastProjectedSequence: checkpoint.lastProjectedSequence,
            lastProjectionKey: checkpoint.lastProjectionKey,
            projectedCount: checkpoint.projectedCount,
            reconciled:
              checkpoint.pendingCount === 0 &&
              checkpoint.retryingCount === 0 &&
              checkpoint.deadLetterCount === 0,
          }
        : null,
      publicProjectedRelationships,
      dailyCostCeilingGbp: settings?.dailyCostCeilingGbp ?? 2.0,
      dailyChatSpendGbp,
    };
  },
});

export const recordAcceptanceChatTurn = mutation({
  args: {
    nonce: v.string(),
    turnId: v.string(),
    bundleId: v.string(),
    bundleSha256: v.string(),
    question: v.string(),
    queryType: v.string(),
    intentCategory: v.string(),
    historicalCutoffMs: v.number(),
    temporalBasis: v.union(v.literal('publication'), v.literal('receipt')),
    graphDatabaseName: v.string(),
    graphSchemaVersion: v.string(),
    lastProjectedSequence: v.number(),
    supportStatus: v.union(
      v.literal('fully_supported'),
      v.literal('partially_supported'),
      v.literal('unsupported'),
    ),
    validationValid: v.boolean(),
    validationAction: v.string(),
    modelId: v.string(),
    generationMode: v.string(),
    providerStatus: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cachedTokens: v.number(),
    estimatedCostGbp: v.number(),
    actualCostGbp: v.union(v.number(), v.null()),
    latencyMs: v.number(),
    bundleJson: v.string(),
    answerJson: v.string(),
    validationJson: v.string(),
    createdAtMs: v.number(),
  },
  handler: async (ctx, args) => {
    const owner = process.env.RESEARCH_OWNER_ID ?? 'system_acceptance';
    const now = Date.now();
    const recentAudits = await ctx.db
      .query('audit')
      .withIndex('by_owner', (q) => q.eq('owner', owner))
      .order('desc')
      .take(40);
    const match = recentAudits.find(
      (a) =>
        a.action === 'graph.evidence_chat.acceptance_nonce' &&
        a.recordId === args.nonce &&
        a.detail === 'consumed' &&
        now - a.at <= 120_000,
    );
    if (!match) {
      throw new Error('Invalid or expired acceptance nonce');
    }
    await ctx.db.patch(match._id, { detail: 'recorded' });

    const { nonce: _unusedNonce, ...turnFields } = args;
    const id = await ctx.db.insert('evidenceChatAudit', {
      owner,
      ...turnFields,
      executionAuthority: 'none',
    });
    await ctx.db.insert('audit', {
      owner,
      action: 'graph.evidence_chat.turn',
      recordId: args.bundleId,
      detail: `q="${args.question.slice(0, 120)}" support=${args.supportStatus} valid=${args.validationValid} mode=${args.generationMode} costGbp=${args.estimatedCostGbp.toFixed(6)}`,
      at: args.createdAtMs,
    });
    return { auditId: id };
  },
});

/**
 * Action to check the live Gemini models endpoint availability from Convex server runtime.
 */
export const checkGeminiProviderStatusAction = action({
  args: {},
  handler: async () => {
    return await checkGeminiProviderAvailability({
      verifyEndpoint: true,
      timeoutMs: 8_000,
    });
  },
});
