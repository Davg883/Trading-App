import { v } from 'convex/values';
import {
  internalMutationGeneric,
  type GenericMutationCtx,
  type MutationBuilder,
} from 'convex/server';
import type { DataModel } from './server';
import type { GenericId } from 'convex/values';
import { EVIDENCE_RETRIEVAL_LIMITS } from '../lib/graph/evidence-chat-contracts';

/**
 * Paid-inference budget reservations (pre-merge risk H2).
 *
 * Previously the daily cost ceiling was read in one request and checked later in another, and the Next.js route
 * proceeded with a spend of zero whenever Convex could not be reached. Now every paid provider call must first
 * take a reservation for the maximum per-request cost in a single Convex transaction that also reads today's
 * recorded spend and every other active reservation. Concurrent requests therefore cannot jointly exceed the
 * ceiling, and when the reservation cannot be taken the caller must not call the provider.
 *
 * A live (`gemini_live`) audit record is accepted only together with an active reservation of the same owner,
 * which it settles. Unsettled reservations keep counting against the ceiling until they expire, so a crash
 * between the provider call and the audit write can never free budget early.
 */
const internalMutation: MutationBuilder<DataModel, 'internal'> = internalMutationGeneric;

export const RESERVATION_TTL_MS = 5 * 60_000;
export const SHARED_CHAT_TURNS_PER_MINUTE = 10;
export const MAX_RESERVATION_COST_GBP = EVIDENCE_RETRIEVAL_LIMITS.maxRequestCostGbp;
const DEFAULT_DAILY_CEILING_GBP = EVIDENCE_RETRIEVAL_LIMITS.defaultDailyBudgetCeilingGbp;
const HEX64 = /^[0-9a-f]{64}$/;

export type ReservationResult =
  | { ok: true; spentGbp: number; ceilingGbp: number; expiresAtMs: number }
  | { ok: false; reason: 'budget_exceeded' | 'rate_limited'; spentGbp: number; ceilingGbp: number };

/** Reads spend and active reservations and inserts a reservation, all within the caller's transaction. */
export async function reserveChatBudget(
  ctx: GenericMutationCtx<DataModel>,
  owner: string,
  reservationSha256: string,
  source: 'gateway' | 'convex_action' | 'acceptance',
  now: number,
): Promise<ReservationResult> {
  if (!HEX64.test(reservationSha256)) throw new Error('Invalid reservation digest');
  if (!owner.trim() || owner.length > 1000) throw new Error('Owner required');
  const settings = await ctx.db.query('operationsSettings').withIndex('by_owner', (q) => q.eq('owner', owner)).first();
  const ceilingGbp = settings?.dailyCostCeilingGbp ?? DEFAULT_DAILY_CEILING_GBP;
  const dayAgo = now - 86_400_000;
  const turns = await ctx.db
    .query('evidenceChatAudit')
    .withIndex('by_owner', (q) => q.eq('owner', owner).gte('createdAtMs', dayAgo))
    .collect();
  const reservations = await ctx.db
    .query('chatBudgetReservations')
    .withIndex('by_owner', (q) => q.eq('owner', owner).gte('createdAtMs', now - RESERVATION_TTL_MS))
    .collect();
  const active = reservations.filter((r) => r.status === 'reserved' && r.expiresAtMs > now);
  const recordedSpend = turns.reduce((s, t) => s + Math.max(t.estimatedCostGbp, t.actualCostGbp ?? 0), 0);
  const reservedSpend = active.reduce((s, r) => s + r.maxCostGbp, 0);
  const spentGbp = Number((recordedSpend + reservedSpend).toFixed(6));

  const lastMinute =
    turns.filter((t) => t.createdAtMs >= now - 60_000).length +
    active.filter((r) => r.createdAtMs >= now - 60_000).length;
  if (lastMinute >= SHARED_CHAT_TURNS_PER_MINUTE) return { ok: false, reason: 'rate_limited', spentGbp, ceilingGbp };
  if (spentGbp + MAX_RESERVATION_COST_GBP > ceilingGbp) return { ok: false, reason: 'budget_exceeded', spentGbp, ceilingGbp };

  const existing = await ctx.db
    .query('chatBudgetReservations')
    .withIndex('by_reservation', (q) => q.eq('reservationSha256', reservationSha256))
    .first();
  if (existing) throw new Error('Reservation identifier collision');
  const expiresAtMs = now + RESERVATION_TTL_MS;
  await ctx.db.insert('chatBudgetReservations', {
    owner,
    reservationSha256,
    source,
    maxCostGbp: MAX_RESERVATION_COST_GBP,
    status: 'reserved',
    createdAtMs: now,
    expiresAtMs,
    settledAtMs: null,
    auditId: null,
    executionAuthority: 'none',
  });
  return { ok: true, spentGbp, ceilingGbp, expiresAtMs };
}

/** Loads an active reservation of this owner, or returns why it cannot be used. */
export async function loadActiveReservation(
  ctx: GenericMutationCtx<DataModel>,
  owner: string,
  reservationSha256: string,
  now: number,
) {
  if (!HEX64.test(reservationSha256)) return { row: null, reason: 'invalid_budget_reservation' as const };
  const row = await ctx.db
    .query('chatBudgetReservations')
    .withIndex('by_reservation', (q) => q.eq('reservationSha256', reservationSha256))
    .first();
  if (!row || row.owner !== owner) return { row: null, reason: 'invalid_budget_reservation' as const };
  if (row.status !== 'reserved') return { row: null, reason: 'budget_reservation_already_settled' as const };
  if (row.expiresAtMs <= now) return { row: null, reason: 'budget_reservation_expired' as const };
  return { row, reason: null };
}

export async function settleReservation(
  ctx: GenericMutationCtx<DataModel>,
  id: GenericId<'chatBudgetReservations'>,
  auditId: GenericId<'evidenceChatAudit'> | null,
  now: number,
) {
  await ctx.db.patch(id, { status: 'settled', settledAtMs: now, auditId });
}

export const reserveChatBudgetInternal = internalMutation({
  args: {
    owner: v.string(),
    reservationSha256: v.string(),
    source: v.union(v.literal('gateway'), v.literal('convex_action')),
  },
  handler: async (ctx, args) => reserveChatBudget(ctx, args.owner, args.reservationSha256, args.source, Date.now()),
});
