import { v } from 'convex/values';
import {
  internalMutationGeneric,
  internalQueryGeneric,
  type GenericMutationCtx,
  type MutationBuilder,
  type QueryBuilder,
} from 'convex/server';
import type { DataModel } from './server';
import type { GenericId } from 'convex/values';
import { EVIDENCE_RETRIEVAL_LIMITS } from '../lib/graph/evidence-chat-contracts';

/**
 * Paid-inference budget reservations (pre-merge risk H2; durable accounting, Correction 2).
 *
 * State model
 *
 *   reserved ──start──▶ in_flight ──record(live)──────────────▶ settled          (charge: estimated)
 *      │                   │      ──record(provider error)────▶ provider_failed  (charge: 0, estimated)
 *      │                   │      ──record(timeout/unknown)───▶ unknown          (charge: unknown)
 *      │                   │      ──nonce failed / no record──▶ unknown          (after deadline: computed)
 *      │                   │
 *      │ record(no provider call: budget/rate/security/not_invoked) ──▶ settled (charge: none)
 *      └─start window passes, never started ──▶ expired_unused (computed; no liability)
 *
 *   unknown / in_flight past deadline ──reconcile(operator, audited)──▶ settled | provider_failed
 *   reserved past start window       ──reconcile(operator, audited)──▶ expired_unused
 *
 * Liability rules (what counts against the rolling 24-hour ceiling):
 * - reserved within its start window, in_flight (at any age) and unknown count at `maxCostGbp`.
 *   Expiry never erases a call that may have been made: only a reservation that was NEVER started can lapse.
 * - settled turns count through their audit row; a settled reservation without an audit row (operator
 *   reconciliation) counts its recorded charge.
 * - provider_failed and expired_unused count nothing.
 * - Every liability ages out with the 24-hour window, like recorded spend, so an unresolved call cannot lock a
 *   budget permanently; reconciliation resolves it sooner and is written to the audit table.
 *
 * Charges are labelled: `estimated` (computed from provider-reported usage × a price table), `actual_billing`
 * (entered by an operator from billing evidence), `unknown`, or `none` (no provider call). Provider billing has
 * NOT been reconciled against invoices by this code.
 */
const internalMutation: MutationBuilder<DataModel, 'internal'> = internalMutationGeneric;
const internalQuery: QueryBuilder<DataModel, 'internal'> = internalQueryGeneric;

/** Time allowed between reserving and starting the provider call. */
export const START_WINDOW_MS = 2 * 60_000;
/** After this, an in-flight call without a recorded outcome is reported as unknown (still liable). */
export const IN_FLIGHT_DEADLINE_MS = 5 * 60_000;
export const LIABILITY_WINDOW_MS = 86_400_000;
export const SHARED_CHAT_TURNS_PER_MINUTE = 10;
export const MAX_RESERVATION_COST_GBP = EVIDENCE_RETRIEVAL_LIMITS.maxRequestCostGbp;
const DEFAULT_DAILY_CEILING_GBP = EVIDENCE_RETRIEVAL_LIMITS.defaultDailyBudgetCeilingGbp;
const HEX64 = /^[0-9a-f]{64}$/;

type Reservation = DataModel['chatBudgetReservations']['document'];
type Ctx = GenericMutationCtx<DataModel>;

export type EffectiveStatus = Reservation['status'];

/** Status as of `now`, applying time-based transitions without writing. */
export function effectiveStatus(r: Pick<Reservation, 'status' | 'startExpiresAtMs' | 'inFlightDeadlineMs'>, now: number): EffectiveStatus {
  if (r.status === 'reserved' && now >= r.startExpiresAtMs) return 'expired_unused';
  if (r.status === 'in_flight' && r.inFlightDeadlineMs !== null && now >= r.inFlightDeadlineMs) return 'unknown';
  return r.status;
}

/** Amount this reservation holds against the ceiling, excluding settled turns already counted by their audit row. */
export function reservationLiabilityGbp(r: Reservation, now: number): number {
  const s = effectiveStatus(r, now);
  if (s === 'reserved' || s === 'in_flight' || s === 'unknown') return r.maxCostGbp;
  if (s === 'settled' && r.auditId === null) return r.chargeGbp ?? r.maxCostGbp;
  return 0;
}

export type ReservationResult =
  | { ok: true; spentGbp: number; ceilingGbp: number; startExpiresAtMs: number }
  | { ok: false; reason: 'budget_exceeded' | 'rate_limited'; spentGbp: number; ceilingGbp: number };

/** Reads spend and liabilities and inserts a reservation, all within the caller's transaction. */
export async function reserveChatBudget(
  ctx: Ctx,
  owner: string,
  reservationSha256: string,
  source: 'gateway' | 'convex_action' | 'acceptance',
  now: number,
): Promise<ReservationResult> {
  if (!HEX64.test(reservationSha256)) throw new Error('Invalid reservation digest');
  if (!owner.trim() || owner.length > 1000) throw new Error('Owner required');
  const settings = await ctx.db.query('operationsSettings').withIndex('by_owner', (q) => q.eq('owner', owner)).first();
  const ceilingGbp = settings?.dailyCostCeilingGbp ?? DEFAULT_DAILY_CEILING_GBP;
  const windowStart = now - LIABILITY_WINDOW_MS;
  const turns = await ctx.db
    .query('evidenceChatAudit')
    .withIndex('by_owner', (q) => q.eq('owner', owner).gte('createdAtMs', windowStart))
    .collect();
  const reservations = await ctx.db
    .query('chatBudgetReservations')
    .withIndex('by_owner', (q) => q.eq('owner', owner).gte('createdAtMs', windowStart))
    .collect();
  const recordedSpend = turns.reduce((s, t) => s + Math.max(t.estimatedCostGbp, t.actualCostGbp ?? 0), 0);
  const liability = reservations.reduce((s, r) => s + reservationLiabilityGbp(r, now), 0);
  const spentGbp = Number((recordedSpend + liability).toFixed(6));

  const recentTurns = turns.filter((t) => t.createdAtMs >= now - 60_000).length;
  const recentOpen = reservations.filter((r) => r.createdAtMs >= now - 60_000 && r.auditId === null).length;
  if (recentTurns + recentOpen >= SHARED_CHAT_TURNS_PER_MINUTE) return { ok: false, reason: 'rate_limited', spentGbp, ceilingGbp };
  if (spentGbp + MAX_RESERVATION_COST_GBP > ceilingGbp) return { ok: false, reason: 'budget_exceeded', spentGbp, ceilingGbp };

  const existing = await ctx.db
    .query('chatBudgetReservations')
    .withIndex('by_reservation', (q) => q.eq('reservationSha256', reservationSha256))
    .first();
  if (existing) throw new Error('Reservation identifier collision');
  const startExpiresAtMs = now + START_WINDOW_MS;
  await ctx.db.insert('chatBudgetReservations', {
    owner,
    reservationSha256,
    source,
    maxCostGbp: MAX_RESERVATION_COST_GBP,
    status: 'reserved',
    createdAtMs: now,
    startExpiresAtMs,
    startedAtMs: null,
    inFlightDeadlineMs: null,
    settledAtMs: null,
    auditId: null,
    turnId: null,
    chargeGbp: null,
    chargeBasis: 'unknown',
    resolution: null,
    executionAuthority: 'none',
  });
  return { ok: true, spentGbp, ceilingGbp, startExpiresAtMs };
}

export async function loadReservation(ctx: Ctx, owner: string, reservationSha256: string) {
  if (!HEX64.test(reservationSha256)) return null;
  const row = await ctx.db
    .query('chatBudgetReservations')
    .withIndex('by_reservation', (q) => q.eq('reservationSha256', reservationSha256))
    .first();
  // Cross-owner use is indistinguishable from an unknown reservation.
  if (!row || row.owner !== owner) return null;
  return row;
}

export type StartResult = { ok: true; inFlightDeadlineMs: number } | { ok: false; reason: string };

/** reserved → in_flight. Must succeed before any provider call. Idempotent for an already started reservation. */
export async function startReservation(ctx: Ctx, owner: string, reservationSha256: string, now: number): Promise<StartResult> {
  const row = await loadReservation(ctx, owner, reservationSha256);
  if (!row) return { ok: false, reason: 'invalid_budget_reservation' };
  const s = effectiveStatus(row, now);
  if (s === 'in_flight') return { ok: true, inFlightDeadlineMs: row.inFlightDeadlineMs! };
  if (s !== 'reserved') return { ok: false, reason: s === 'expired_unused' ? 'budget_reservation_expired' : `budget_reservation_${s}` };
  const inFlightDeadlineMs = now + IN_FLIGHT_DEADLINE_MS;
  await ctx.db.patch(row._id, { status: 'in_flight', startedAtMs: now, inFlightDeadlineMs });
  return { ok: true, inFlightDeadlineMs };
}

/** Outcome of a recorded turn, as it bears on provider liability. */
export type TurnOutcome = {
  generationMode: string;
  providerStatus: string;
  providerFailureKind?: 'error_response' | 'timeout_or_transport' | 'simulated' | 'unknown';
  estimatedCostGbp: number;
  actualCostGbp: number | null;
};

const NO_PROVIDER_CALL_STATUSES = new Set([
  'budget_exceeded',
  'rate_limited',
  'security_blocked',
  'not_invoked',
  'disabled_by_default',
  'api_key_not_configured',
]);

export function classifyOutcome(t: TurnOutcome):
  | { status: 'settled'; chargeGbp: number; chargeBasis: 'estimated' | 'none'; providerCall: boolean }
  | { status: 'provider_failed'; chargeGbp: 0; chargeBasis: 'estimated'; providerCall: true }
  | { status: 'unknown'; chargeGbp: null; chargeBasis: 'unknown'; providerCall: true } {
  if (t.generationMode === 'gemini_live' && t.providerStatus === 'succeeded')
    return { status: 'settled', chargeGbp: Math.max(t.estimatedCostGbp, t.actualCostGbp ?? 0), chargeBasis: 'estimated', providerCall: true };
  if (t.providerStatus === 'provider_error') {
    if (t.providerFailureKind === 'error_response' || t.providerFailureKind === 'simulated')
      return { status: 'provider_failed', chargeGbp: 0, chargeBasis: 'estimated', providerCall: true };
    return { status: 'unknown', chargeGbp: null, chargeBasis: 'unknown', providerCall: true };
  }
  if (NO_PROVIDER_CALL_STATUSES.has(t.providerStatus)) return { status: 'settled', chargeGbp: 0, chargeBasis: 'none', providerCall: false };
  // Anything unrecognised is treated as a possible provider call with unknown cost.
  return { status: 'unknown', chargeGbp: null, chargeBasis: 'unknown', providerCall: true };
}

export type SettleResult = { ok: true; status: EffectiveStatus } | { ok: false; reason: string };

/**
 * Applies a recorded turn's outcome to its reservation. Called in the same transaction as the audit insert.
 * Delayed completions (after the in-flight deadline) are accepted and resolve the unknown state.
 */
export async function settleReservationForTurn(
  ctx: Ctx,
  row: Reservation,
  outcome: TurnOutcome,
  auditId: GenericId<'evidenceChatAudit'>,
  turnId: string,
  now: number,
): Promise<SettleResult> {
  const refused = canSettle(row, outcome, now);
  if (refused) return { ok: false, reason: refused };
  const c = classifyOutcome(outcome);
  await ctx.db.patch(row._id, {
    status: c.status,
    settledAtMs: now,
    auditId,
    turnId,
    chargeGbp: c.chargeGbp,
    chargeBasis: c.chargeBasis,
    resolution: c.status === 'unknown' ? 'provider outcome not confirmed; reconciliation required' : 'recorded turn',
  });
  return { ok: true, status: c.status };
}

/** Pre-check used before inserting an audit row, so a refused settlement writes nothing. */
export function canSettle(row: Reservation, outcome: TurnOutcome, now: number): string | null {
  const s = effectiveStatus(row, now);
  const c = classifyOutcome(outcome);
  if (s === 'reserved' && c.providerCall) return 'budget_reservation_not_started';
  if (s === 'expired_unused' && c.providerCall) return 'budget_reservation_expired';
  if (s === 'settled' || s === 'provider_failed' || row.auditId !== null) return 'budget_reservation_already_settled';
  return null;
}

/** Marks a started call whose turn will never be recorded as unknown; an unstarted reservation lapses unused. */
export async function abandonReservation(ctx: Ctx, row: Reservation, reason: string, now: number) {
  const s = effectiveStatus(row, now);
  if (s === 'in_flight' || (s === 'unknown' && row.status === 'in_flight')) {
    await ctx.db.patch(row._id, { status: 'unknown', resolution: reason.slice(0, 200) });
  } else if (s === 'reserved' || (s === 'expired_unused' && row.status === 'reserved')) {
    await ctx.db.patch(row._id, { status: 'expired_unused', resolution: reason.slice(0, 200) });
  }
}

export const reserveChatBudgetInternal = internalMutation({
  args: {
    owner: v.string(),
    reservationSha256: v.string(),
    source: v.union(v.literal('gateway'), v.literal('convex_action')),
  },
  handler: async (ctx, args) => reserveChatBudget(ctx, args.owner, args.reservationSha256, args.source, Date.now()),
});

export const startChatBudgetInternal = internalMutation({
  args: { owner: v.string(), reservationSha256: v.string() },
  handler: async (ctx, args) => startReservation(ctx, args.owner, args.reservationSha256, Date.now()),
});

/**
 * Deployment-administrator reconciliation of an unresolved reservation (unknown, or in flight past its
 * deadline, or reserved past its start window). Every resolution is written to the audit table. Settled or
 * failed reservations cannot be changed; repeating the same resolution is a no-op.
 */
export const reconcileReservationInternal = internalMutation({
  args: {
    reservationSha256: v.string(),
    resolution: v.union(v.literal('settled'), v.literal('provider_failed'), v.literal('expired_unused')),
    chargeGbp: v.number(),
    chargeBasis: v.union(v.literal('actual_billing'), v.literal('estimated'), v.literal('none')),
    operator: v.string(),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.operator.trim() || args.operator.length > 200) throw new Error('Operator name required');
    if (!args.note.trim() || args.note.length > 1000) throw new Error('A reconciliation note is required');
    if (!Number.isFinite(args.chargeGbp) || args.chargeGbp < 0 || args.chargeGbp > 100) throw new Error('Charge out of range');
    if (args.resolution !== 'settled' && args.chargeGbp !== 0) throw new Error('Only a settled reservation can carry a charge');
    const row = await ctx.db
      .query('chatBudgetReservations')
      .withIndex('by_reservation', (q) => q.eq('reservationSha256', args.reservationSha256))
      .first();
    if (!row) throw new Error('Unknown reservation');
    const now = Date.now();
    const s = effectiveStatus(row, now);
    if (row.status === args.resolution && row.resolution?.startsWith('reconciled:') && row.chargeGbp === args.chargeGbp) {
      return { ok: true as const, duplicate: true };
    }
    const allowed =
      (s === 'unknown' && args.resolution !== 'expired_unused') ||
      (s === 'expired_unused' && row.status === 'reserved' && args.resolution === 'expired_unused');
    if (!allowed) throw new Error(`Reservation in state ${s} cannot be reconciled to ${args.resolution}`);
    await ctx.db.patch(row._id, {
      status: args.resolution,
      settledAtMs: now,
      chargeGbp: args.chargeGbp,
      chargeBasis: args.chargeBasis,
      resolution: `reconciled: ${args.note.trim().slice(0, 180)}`,
    });
    await ctx.db.insert('audit', {
      owner: row.owner,
      action: 'graph.evidence_chat.budget.reconciled',
      recordId: row._id,
      detail: `by deployment-admin:${args.operator.trim()}; ${s} -> ${args.resolution}; charge £${args.chargeGbp.toFixed(6)} (${args.chargeBasis}); ${args.note.trim().slice(0, 300)}`,
      at: now,
    });
    return { ok: true as const, duplicate: false };
  },
});

/** Unresolved reservations that still hold budget, for operator review. Never returns digests of other owners' data. */
export const listUnresolvedReservationsInternal = internalQuery({
  args: { owner: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const rows = await ctx.db
      .query('chatBudgetReservations')
      .withIndex('by_owner', (q) => q.eq('owner', args.owner).gte('createdAtMs', now - LIABILITY_WINDOW_MS))
      .collect();
    return rows
      .map((r) => ({ id: r._id, reservationSha256: r.reservationSha256, source: r.source, storedStatus: r.status, effectiveStatus: effectiveStatus(r, now), liabilityGbp: reservationLiabilityGbp(r, now), createdAtMs: r.createdAtMs, startedAtMs: r.startedAtMs, turnId: r.turnId, resolution: r.resolution }))
      .filter((r) => r.effectiveStatus === 'unknown' || r.effectiveStatus === 'in_flight');
  },
});
