import { v } from 'convex/values';
import {
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
  type ActionBuilder,
  type GenericMutationCtx,
  type MutationBuilder,
  type QueryBuilder,
} from 'convex/server';
import type { DataModel } from './server';
import type { GenericId } from 'convex/values';
import { sha256HexSync } from '../lib/crypto/sha256';
import {
  abandonReservation,
  canSettle,
  classifyOutcome,
  loadReservation,
  reserveChatBudget,
  settleReservationForTurn,
  startReservation,
} from './chatBudget';
import { macroRelationshipSchema, type MacroRelationship } from '../lib/graph/contracts';
import {
  chatTurnAuditViolations,
  type ChatRecordedVia,
} from '../lib/graph/chat-turn-audit-validation';

/**
 * Acceptance nonces for server-side Evidence-Locked Chat acceptance runs (MVP hardening, work package 2).
 *
 * Trust model
 * - Minting is an internal action: it can be invoked only with deployment-administrator authority
 *   (`npx convex run acceptanceNonces:mintAcceptanceNonce ...`). The operator names the owner and the exact
 *   question; nothing defaults to `RESEARCH_OWNER_ID` or to a shared system identity.
 * - The bearer secret and the reservation are generated with `crypto.getRandomValues` in an action (mutations
 *   use a seeded, non-cryptographic PRNG) and only their SHA-256 digests reach the database.
 * - Consumption and recording are internal mutations reached only through the gateway HTTP actions in
 *   `http.ts`. Each is a single serialisable Convex transaction that reads the nonce row by index and
 *   patches it, so of any number of concurrent attempts exactly one can observe `issued` and commit.
 * - The owner of a turn is always taken from the nonce row. No header, argument or client value names it.
 * - Rows are never deleted or reopened. An `issued` row past `expiresAtMs` is expired; a `consumed` row past
 *   `recordDeadlineMs` is abandoned. Recovery from either is to mint a new nonce.
 */
const internalAction: ActionBuilder<DataModel, 'internal'> = internalActionGeneric;
const internalMutation: MutationBuilder<DataModel, 'internal'> = internalMutationGeneric;
const internalQuery: QueryBuilder<DataModel, 'internal'> = internalQueryGeneric;

export const ACCEPTANCE_PURPOSE = 'evidence_chat_acceptance' as const;
export const DEFAULT_NONCE_TTL_SECONDS = 120;
export const MAX_NONCE_TTL_SECONDS = 600;
/** Time allowed between consumption and the audit record (the chat route's maximum duration is 60 s). */
export const RECORD_WINDOW_MS = 180_000;
const TOKEN_PATTERN = /^acn1\.([0-9a-f]{32})\.([0-9a-f]{64})$/;
const HEX64 = /^[0-9a-f]{64}$/;

const storeRef = makeFunctionReference<'mutation'>('acceptanceNonces:storeIssuedNonceInternal');

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}
export function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return hex(bytes);
}
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
}
/** The question binding is the SHA-256 of the trimmed question, matching `EvidenceBundleV1.question`. */
export async function questionDigest(question: string): Promise<string> {
  return sha256Hex(question.trim());
}
export function parseAcceptanceToken(token: string): { nonceId: string; secret: string } | null {
  const m = TOKEN_PATTERN.exec(token);
  return m ? { nonceId: m[1]!, secret: m[2]! } : null;
}
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function validOwnerIdentifier(owner: string): boolean {
  // Convex token identifiers are `<issuer>|<subject>`; a bare label can never own acceptance records.
  return /^https:\/\/[^|\s]{3,300}\|[^|\s]{1,300}$/.test(owner);
}

/**
 * Deployment-administrator only. Returns the raw token exactly once; it cannot be recovered afterwards.
 * Example: `npx convex run acceptanceNonces:mintAcceptanceNonce '{"owner":"<issuer>|<subject>","question":"...","operator":"<name>"}'`
 */
export const mintAcceptanceNonce = internalAction({
  args: {
    owner: v.string(),
    question: v.string(),
    operator: v.string(),
    ttlSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!validOwnerIdentifier(args.owner)) throw new Error('owner must be a full "<issuer>|<subject>" token identifier');
    const question = args.question.trim();
    if (question.length < 3 || question.length > 1000) throw new Error('question must be 3–1000 characters');
    if (!args.operator.trim() || args.operator.length > 200) throw new Error('operator name required');
    const ttlSeconds = args.ttlSeconds ?? DEFAULT_NONCE_TTL_SECONDS;
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 10 || ttlSeconds > MAX_NONCE_TTL_SECONDS)
      throw new Error(`ttlSeconds must be an integer between 10 and ${MAX_NONCE_TTL_SECONDS}`);

    const nonceId = randomHex(16);
    const secret = randomHex(32);
    const stored = (await ctx.runMutation(storeRef, {
      nonceId,
      secretSha256: await sha256Hex(secret),
      owner: args.owner,
      questionSha256: await questionDigest(question),
      issuedBy: `deployment-admin:${args.operator.trim()}`,
      ttlMs: ttlSeconds * 1000,
    })) as { issuedAtMs: number; expiresAtMs: number };
    return {
      token: `acn1.${nonceId}.${secret}`,
      nonceId,
      owner: args.owner,
      purpose: ACCEPTANCE_PURPOSE,
      issuedAtMs: stored.issuedAtMs,
      expiresAtMs: stored.expiresAtMs,
      executionAuthority: 'none' as const,
    };
  },
});

export const storeIssuedNonceInternal = internalMutation({
  args: {
    nonceId: v.string(),
    secretSha256: v.string(),
    owner: v.string(),
    questionSha256: v.string(),
    issuedBy: v.string(),
    ttlMs: v.number(),
  },
  handler: async (ctx, args) => {
    if (!/^[0-9a-f]{32}$/.test(args.nonceId) || !HEX64.test(args.secretSha256) || !HEX64.test(args.questionSha256))
      throw new Error('Invalid nonce digest');
    if (!validOwnerIdentifier(args.owner)) throw new Error('Invalid nonce owner');
    if (!Number.isInteger(args.ttlMs) || args.ttlMs < 10_000 || args.ttlMs > MAX_NONCE_TTL_SECONDS * 1000)
      throw new Error('Invalid nonce lifetime');
    const existing = await ctx.db
      .query('acceptanceNonces')
      .withIndex('by_nonce_id', (q) => q.eq('nonceId', args.nonceId))
      .unique();
    if (existing) throw new Error('Nonce identifier collision');
    const now = Date.now();
    await ctx.db.insert('acceptanceNonces', {
      nonceId: args.nonceId,
      secretSha256: args.secretSha256,
      owner: args.owner,
      purpose: ACCEPTANCE_PURPOSE,
      questionSha256: args.questionSha256,
      status: 'issued',
      issuedBy: args.issuedBy,
      issuedAtMs: now,
      expiresAtMs: now + args.ttlMs,
      consumedAtMs: null,
      reservationSha256: null,
      recordDeadlineMs: null,
      recordedAtMs: null,
      recordedTurnId: null,
      auditId: null,
      failureCode: null,
      failedAtMs: null,
      executionAuthority: 'none',
    });
    await ctx.db.insert('audit', {
      owner: args.owner,
      action: 'graph.evidence_chat.acceptance_nonce.issued',
      recordId: args.nonceId,
      detail: `by ${args.issuedBy}; ttl ${Math.round(args.ttlMs / 1000)}s; question sha256 ${args.questionSha256.slice(0, 16)}…`,
      at: now,
    });
    return { issuedAtMs: now, expiresAtMs: now + args.ttlMs };
  },
});

export type NonceRejection =
  | 'unknown_nonce'
  | 'invalid_secret'
  | 'expired'
  | 'already_consumed'
  | 'already_recorded'
  | 'already_failed'
  | 'question_mismatch'
  | 'not_consumed'
  | 'invalid_reservation'
  | 'record_window_elapsed'
  | 'invalid_audit_record';

async function loadVerifiedNonce(
  ctx: GenericMutationCtx<DataModel>,
  nonceId: string,
  secretSha256: string,
) {
  const row = await ctx.db
    .query('acceptanceNonces')
    .withIndex('by_nonce_id', (q) => q.eq('nonceId', nonceId))
    .unique();
  if (!row) return { row: null, rejection: 'unknown_nonce' as const };
  if (!constantTimeEqual(row.secretSha256, secretSha256))
    return { row: null, rejection: 'invalid_secret' as const };
  return { row, rejection: null };
}

async function loadRetrievalContext(ctx: GenericMutationCtx<DataModel>, owner: string, now: number) {
  const checkpoint = await ctx.db
    .query('graphProjectionCheckpoints')
    .withIndex('by_owner_key', (q) => q.eq('owner', owner).eq('checkpointKey', `ckpt:${owner}:main`))
    .first();
  const projectedRows = await ctx.db
    .query('graphProjectionOutbox')
    .withIndex('by_owner', (q) => q.eq('owner', owner))
    .take(200);
  const publicProjectedRelationships: MacroRelationship[] = [];
  for (const r of projectedRows) {
    if (r.visibility !== 'public_research' || r.status !== 'projected') continue;
    try {
      publicProjectedRelationships.push(macroRelationshipSchema.parse(JSON.parse(r.payloadJson)));
    } catch {
      // Ignore malformed legacy rows
    }
  }
  const settings = await ctx.db
    .query('operationsSettings')
    .withIndex('by_owner', (q) => q.eq('owner', owner))
    .first();
  const recentChatTurns = await ctx.db
    .query('evidenceChatAudit')
    .withIndex('by_owner', (q) => q.eq('owner', owner))
    .order('desc')
    .take(100);
  let dailyChatSpendGbp = 0;
  for (const t of recentChatTurns) {
    if (t.createdAtMs >= now - 86_400_000)
      dailyChatSpendGbp += Math.max(t.estimatedCostGbp, t.actualCostGbp ?? 0);
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
}

/**
 * Atomic one-time consumption. Every check and the `issued -> consumed` transition happen in one
 * transaction; rejections write nothing, so a failed attempt can neither burn nor extend a nonce.
 */
export const consumeNonceInternal = internalMutation({
  args: {
    nonceId: v.string(),
    secretSha256: v.string(),
    questionSha256: v.string(),
    reservationSha256: v.string(),
  },
  handler: async (ctx, args) => {
    const reject = (reason: NonceRejection) => ({ ok: false as const, reason });
    if (!HEX64.test(args.reservationSha256) || !HEX64.test(args.questionSha256))
      throw new Error('Invalid consumption digest');
    const { row, rejection } = await loadVerifiedNonce(ctx, args.nonceId, args.secretSha256);
    if (!row) return reject(rejection);
    const now = Date.now();
    if (row.status === 'consumed') return reject('already_consumed');
    if (row.status === 'recorded') return reject('already_recorded');
    if (row.status === 'failed') return reject('already_failed');
    if (now > row.expiresAtMs) return reject('expired');
    if (!constantTimeEqual(row.questionSha256, args.questionSha256)) return reject('question_mismatch');

    const recordDeadlineMs = now + RECORD_WINDOW_MS;
    // Reserve paid-inference budget in the same transaction (pre-merge risk H2). If it cannot be reserved the
    // nonce is still consumed, but the returned context forces a budget abstention: no provider call may be made.
    const budgetReservationSha256 = sha256HexSync(`acceptance-budget:${args.reservationSha256}`);
    const budget = await reserveChatBudget(ctx, row.owner, budgetReservationSha256, 'acceptance', now);
    await ctx.db.patch(row._id, {
      status: 'consumed',
      consumedAtMs: now,
      reservationSha256: args.reservationSha256,
      recordDeadlineMs,
      budgetReservationSha256: budget.ok ? budgetReservationSha256 : null,
    });
    await ctx.db.insert('audit', {
      owner: row.owner,
      action: 'graph.evidence_chat.acceptance_nonce.consumed',
      recordId: row.nonceId,
      detail: `record deadline ${new Date(recordDeadlineMs).toISOString()}`,
      at: now,
    });
    const context = await loadRetrievalContext(ctx, row.owner, now);
    return {
      ok: true as const,
      owner: row.owner,
      recordDeadlineMs,
      budget: budget.ok ? { reserved: true as const } : { reserved: false as const, reason: budget.reason },
      context: budget.ok
        ? { ...context, dailyChatSpendGbp: budget.spentGbp, dailyCostCeilingGbp: budget.ceilingGbp }
        : { ...context, dailyChatSpendGbp: Math.max(budget.spentGbp, budget.ceilingGbp), dailyCostCeilingGbp: budget.ceilingGbp },
    };
  },
});

/** The only fields a caller may supply for an audit record. Everything else is set by trusted server code. */
export const turnAuditArgs = {
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
  providerFailureKind: v.optional(
    v.union(v.literal('error_response'), v.literal('timeout_or_transport'), v.literal('simulated'), v.literal('unknown')),
  ),
};

type TurnAudit = Parameters<typeof chatTurnAuditViolations>[0];

export const TURN_AUDIT_FIELDS = Object.keys(turnAuditArgs) as Array<keyof typeof turnAuditArgs>;

/**
 * Copies exactly the allowlisted audit fields from an untrusted object. Any other key (for example `owner`,
 * `recordedVia`, `nonceId` or `turnQuestionSha256`) makes the whole record invalid rather than being ignored,
 * so a caller can never smuggle trusted values through the turn payload. Missing fields are left to the
 * mutation's argument validator.
 */
export function pickTurnAuditFields(
  raw: unknown,
): { ok: true; turn: Record<string, unknown> } | { ok: false; unexpected: string[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, unexpected: ['<turn is not an object>'] };
  const allowed = new Set<string>(TURN_AUDIT_FIELDS);
  const unexpected = Object.keys(raw).filter((k) => !allowed.has(k));
  if (unexpected.length) return { ok: false, unexpected };
  const turn: Record<string, unknown> = {};
  for (const k of TURN_AUDIT_FIELDS) if (k in (raw as Record<string, unknown>)) turn[k] = (raw as Record<string, unknown>)[k];
  return { ok: true, turn };
}

/** Shared, validated insert used by every path that writes an `evidenceChatAudit` row. */
export async function insertValidatedChatTurn(
  ctx: GenericMutationCtx<DataModel>,
  owner: string,
  turn: TurnAudit,
  recordedVia: ChatRecordedVia,
  now: number,
) {
  const violations = chatTurnAuditViolations(turn, now);
  if (violations.length > 0) return { ok: false as const, violations };
  const auditId = await ctx.db.insert('evidenceChatAudit', {
    owner,
    ...turn,
    recordedVia,
    executionAuthority: 'none',
  });
  await ctx.db.insert('audit', {
    owner,
    action: 'graph.evidence_chat.turn',
    recordId: turn.bundleId,
    detail: `q="${turn.question.slice(0, 120)}" support=${turn.supportStatus} valid=${turn.validationValid} mode=${turn.generationMode} provider=${turn.providerStatus} via=${recordedVia} costGbp=${turn.estimatedCostGbp.toFixed(6)}`,
    at: now,
  });
  return { ok: true as const, auditId };
}

type Reservation = DataModel['chatBudgetReservations']['document'];

/**
 * Records a turn and settles its budget reservation in one transaction (Correction 2).
 * - A retry of the same turn (same owner and turnId) returns the original audit id and charges nothing again.
 * - Any turn that involved a real provider call must carry a started reservation of the same owner.
 * - An invalid settlement is refused before anything is written.
 */
export async function recordTurnWithReservation(
  ctx: GenericMutationCtx<DataModel>,
  owner: string,
  turn: TurnAudit,
  recordedVia: ChatRecordedVia,
  reservation: Reservation | null,
  now: number,
): Promise<{ ok: true; auditId: GenericId<'evidenceChatAudit'>; duplicate: boolean } | { ok: false; violations: string[] }> {
  const existing = await ctx.db
    .query('evidenceChatAudit')
    .withIndex('by_turn', (q) => q.eq('owner', owner).eq('turnId', turn.turnId))
    .first();
  if (existing) {
    if (existing.bundleSha256 !== turn.bundleSha256 || existing.generationMode !== turn.generationMode)
      return { ok: false, violations: ['turnId already recorded with different content'] };
    return { ok: true, auditId: existing._id, duplicate: true };
  }
  const outcome = classifyOutcome(turn);
  const needsReservation = outcome.providerCall && turn.providerFailureKind !== 'simulated';
  if (needsReservation && !reservation)
    return { ok: false, violations: ['a provider call requires a started budget reservation'] };
  if (reservation) {
    const refused = canSettle(reservation, turn, now);
    if (refused) return { ok: false, violations: [refused] };
  }
  const inserted = await insertValidatedChatTurn(ctx, owner, turn, recordedVia, now);
  if (!inserted.ok) return inserted;
  if (reservation) await settleReservationForTurn(ctx, reservation, turn, inserted.auditId, turn.turnId, now);
  return { ok: true, auditId: inserted.auditId, duplicate: false };
}

/**
 * Starts the budget reservation taken when an acceptance nonce was consumed. Must succeed before the paid
 * provider call is made for that nonce.
 */
export const startAcceptanceBudgetInternal = internalMutation({
  args: { nonceId: v.string(), secretSha256: v.string(), reservationSha256: v.string() },
  handler: async (ctx, args) => {
    const { row, rejection } = await loadVerifiedNonce(ctx, args.nonceId, args.secretSha256);
    if (!row) return { ok: false as const, reason: rejection };
    if (row.status !== 'consumed') return { ok: false as const, reason: 'not_consumed' };
    if (row.reservationSha256 === null || !constantTimeEqual(row.reservationSha256, args.reservationSha256))
      return { ok: false as const, reason: 'invalid_reservation' };
    if (!row.budgetReservationSha256) return { ok: false as const, reason: 'no_budget_reservation' };
    return await startReservation(ctx, row.owner, row.budgetReservationSha256, Date.now());
  },
});

/**
 * Atomic one-time audit record for a consumed nonce. A repeated call with the same reservation and turn
 * identifier (duplicate callback or client retry) returns the original audit id and writes nothing.
 */
export const recordNonceTurnInternal = internalMutation({
  args: {
    nonceId: v.string(),
    secretSha256: v.string(),
    reservationSha256: v.string(),
    ...turnAuditArgs,
  },
  handler: async (ctx, args) => {
    const reject = (reason: NonceRejection, violations?: string[]) => ({
      ok: false as const,
      reason,
      ...(violations ? { violations } : {}),
    });
    const { nonceId, secretSha256, reservationSha256, ...turn } = args;
    const { row, rejection } = await loadVerifiedNonce(ctx, nonceId, secretSha256);
    if (!row) return reject(rejection);
    const reservationMatches =
      row.reservationSha256 !== null && constantTimeEqual(row.reservationSha256, reservationSha256);
    if (row.status === 'recorded') {
      if (reservationMatches && row.recordedTurnId === turn.turnId && row.auditId !== null)
        return { ok: true as const, auditId: row.auditId, duplicate: true };
      return reject('already_recorded');
    }
    if (row.status === 'failed') return reject('already_failed');
    if (row.status !== 'consumed') return reject('not_consumed');
    if (!reservationMatches) return reject('invalid_reservation');
    const now = Date.now();
    if (row.recordDeadlineMs === null || now > row.recordDeadlineMs) return reject('record_window_elapsed');
    // The question binding is checked against the hash persisted at mint time, computed here from the turn's
    // own question. No caller-supplied hash is accepted.
    if (!constantTimeEqual(row.questionSha256, sha256HexSync(turn.question.trim()))) return reject('question_mismatch');

    const reservation = row.budgetReservationSha256
      ? await loadReservation(ctx, row.owner, row.budgetReservationSha256)
      : null;
    const inserted = await recordTurnWithReservation(ctx, row.owner, turn, 'server_gateway_acceptance', reservation, now);
    if (!inserted.ok) return reject('invalid_audit_record', inserted.violations);
    await ctx.db.patch(row._id, {
      status: 'recorded',
      recordedAtMs: now,
      recordedTurnId: turn.turnId,
      auditId: inserted.auditId,
    });
    return { ok: true as const, auditId: inserted.auditId, duplicate: false };
  },
});

/**
 * Marks a consumed nonce as failed when the server could not produce a turn at all (for example an
 * unhandled error after consumption). The nonce stays unusable; the failure is recorded for the operator.
 */
export const failNonceInternal = internalMutation({
  args: {
    nonceId: v.string(),
    secretSha256: v.string(),
    reservationSha256: v.string(),
    failureCode: v.string(),
  },
  handler: async (ctx, args) => {
    const { row, rejection } = await loadVerifiedNonce(ctx, args.nonceId, args.secretSha256);
    if (!row) return { ok: false as const, reason: rejection };
    if (row.status !== 'consumed') return { ok: false as const, reason: 'not_consumed' as const };
    if (row.reservationSha256 === null || !constantTimeEqual(row.reservationSha256, args.reservationSha256))
      return { ok: false as const, reason: 'invalid_reservation' as const };
    const failureCode = /^[a-z0-9_]{1,60}$/.test(args.failureCode) ? args.failureCode : 'unspecified';
    const now = Date.now();
    await ctx.db.patch(row._id, { status: 'failed', failureCode, failedAtMs: now });
    // A started provider call stays liable as `unknown` until reconciled; an unstarted reservation lapses.
    let budgetOutcome = 'no reservation';
    if (row.budgetReservationSha256) {
      const reservation = await loadReservation(ctx, row.owner, row.budgetReservationSha256);
      if (reservation) {
        await abandonReservation(ctx, reservation, `nonce failed: ${failureCode}`, now);
        budgetOutcome = reservation.status === 'in_flight' ? 'reservation held as unknown' : 'reservation released unused';
      }
    }
    await ctx.db.insert('audit', {
      owner: row.owner,
      action: 'graph.evidence_chat.acceptance_nonce.failed',
      recordId: row.nonceId,
      detail: `failure=${failureCode}; no chat turn was recorded for this nonce; ${budgetOutcome}`,
      at: now,
    });
    return { ok: true as const };
  },
});

/** Deployment-administrator inspection of nonce lifecycle state. Never returns digests or secrets. */
export const listNoncesInternal = internalQuery({
  args: { owner: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const rows = await ctx.db
      .query('acceptanceNonces')
      .withIndex('by_owner', (q) => q.eq('owner', args.owner))
      .order('desc')
      .take(Math.max(1, Math.min(100, args.limit ?? 25)));
    return rows.map((r) => ({
      nonceId: r.nonceId,
      purpose: r.purpose,
      storedStatus: r.status,
      effectiveStatus:
        r.status === 'issued' && now > r.expiresAtMs
          ? ('expired' as const)
          : r.status === 'consumed' && r.recordDeadlineMs !== null && now > r.recordDeadlineMs
            ? ('abandoned' as const)
            : r.status,
      issuedBy: r.issuedBy,
      issuedAtMs: r.issuedAtMs,
      expiresAtMs: r.expiresAtMs,
      consumedAtMs: r.consumedAtMs,
      recordedAtMs: r.recordedAtMs,
      recordedTurnId: r.recordedTurnId,
      failureCode: r.failureCode,
      failedAtMs: r.failedAtMs,
    }));
  },
});
