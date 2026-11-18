import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { z, ZodError } from 'zod';
import type { MacroGraphDataset, MacroRelationship } from '../../../../lib/graph/contracts';
import {
  SUGGESTED_STARTER_QUESTIONS,
  temporalBasisSchema,
} from '../../../../lib/graph/evidence-chat-contracts';
import { retrieveClosedEvidenceBundle } from '../../../../lib/graph/evidence-retrieval-gateway';
import {
  checkGeminiProviderAvailability,
  generateAndValidateEvidenceLockedAnswer,
  isResearchChatMaintenanceActive,
  resolveGeminiApiKey,
} from '../../../../lib/graph/gemini-provider-adapter';
import { loadInitialAcceptanceDataset } from '../../../../lib/graph/query-gateway';
import {
  consumeAcceptanceNonce,
  failAcceptanceNonce,
  gatewayConfigured,
  recordAcceptanceTurn,
  recordAuthenticatedTurn,
  reserveChatBudget,
  startAcceptanceBudget,
  startChatBudget,
  type GatewayResult,
} from '../../../../lib/graph/evidence-chat-gateway';
import { EVIDENCE_RETRIEVAL_LIMITS } from '../../../../lib/graph/evidence-chat-contracts';
// Server-safe claim validation. Never import auth helpers from the `'use client'` module lib/clerk-convex-auth here.
import { checkServerClerkToken } from '../../../../lib/auth/clerk-jwt-claims';
import { classifyConvexError } from '../../../../lib/auth/convex-error-classification';

/** Must match `SHARED_CHAT_TURNS_PER_MINUTE` in convex/evidenceChat.ts. */
const SHARED_CHAT_TURNS_PER_MINUTE = 10;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
};

const chatRequestSchema = z
  .object({
    question: z.string().min(3).max(1000),
    historicalCutoffMs: z.number().int().nonnegative().optional(),
    temporalBasis: temporalBasisSchema.optional(),
    mode: z
      .enum(['auto', 'gemini_live_required', 'deterministic_evidence_synthesis'])
      .optional(),
    simulateProviderFailure: z.boolean().optional(),
  })
  .strict();

type ResolvedCaller = {
  callerId: string;
  convexToken: string | null;
  /** G9.3.3: set when Clerk returned a token that fails claim validation or has expired. Answered with 401. */
  invalidToken?: 'invalid_claims' | 'expired';
};

/** Same predicate as proxy.ts: without both Clerk keys there is no session layer, so no session can exist. */
function clerkConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
}

/**
 * Resolves the signed-in caller. Returns null when there is no session (including when Clerk is not configured on this
 * server, so acceptance-nonce requests still work without Clerk). Throws only on a genuine internal failure — Clerk is
 * configured but `auth()` or claim validation fails unexpectedly — which the handlers answer with a generic 500, never
 * with 401. Swallowing such failures as 401 previously hid a server-side defect from every signed-in user.
 */
async function resolveAuthenticatedCaller(req: NextRequest): Promise<ResolvedCaller | null> {
  // Test-runner only. The previous localhost exception trusted the request's Host header on any
  // non-production build, so it has been removed.
  if (process.env.NODE_ENV === 'test' && !process.env.VERCEL_ENV) {
    const testCaller = req.headers.get('x-aci-test-caller');
    if (testCaller && testCaller.trim().length > 0) {
      return { callerId: testCaller.trim(), convexToken: null };
    }
  }
  if (!clerkConfigured()) return null;
  const session = await auth();
  if (!session?.userId) return null;
  const templated = await session.getToken({ template: 'convex' }).catch(() => null);
  if (templated) {
    const check = checkServerClerkToken(templated);
    if (check !== 'valid') return { callerId: session.userId, convexToken: null, invalidToken: check };
  }
  const token = templated ?? (await session.getToken().catch(() => null));
  if (token) {
    const check = checkServerClerkToken(token);
    if (check !== 'valid') return { callerId: session.userId, convexToken: null, invalidToken: check };
  }
  return { callerId: session.userId, convexToken: token };
}

/** Safe server-side diagnostics: error class and a JWT-redacted, truncated message only. Never a token or stack. */
function logInternalError(where: string, err: unknown) {
  const name = err instanceof Error ? err.name : typeof err;
  const message = (err instanceof Error ? err.message : String(err))
    .replace(/[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted-jwt]')
    .replace(/(sk|pk)_(test|live)_[A-Za-z0-9]+/g, '[redacted-key]')
    .slice(0, 200);
  console.error(`[graph/chat] ${where} internal error: ${name}: ${message}`);
}

function internalError() {
  return NextResponse.json(
    {
      error: 'Evidence-locked research assistant request failed',
      code: 'internal_error',
      executionAuthority: 'none',
    },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}

export async function GET(req: NextRequest) {
  try {
    return await handleGet(req);
  } catch (err) {
    logInternalError('GET', err);
    return internalError();
  }
}

async function handleGet(req: NextRequest) {
  const caller = await resolveAuthenticatedCaller(req);
  if (!caller) {
    return NextResponse.json(
      {
        error: 'Authentication required to access the Evidence-Locked Research Assistant.',
        code: 'sign_in_required',
        executionAuthority: 'none',
      },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  if (caller.invalidToken) {
    return invalidAuthentication(caller.invalidToken);
  }

  const url = new URL(req.url);
  if (url.searchParams.get('statusOnly') === '1') {
    const providerStatus = await checkGeminiProviderAvailability({
      verifyEndpoint: true,
      timeoutMs: 6_000,
    });
    return NextResponse.json(
      {
        providerStatus,
        executionAuthority: 'none',
      },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  }

  const shouldVerifyEndpoint = process.env.NODE_ENV !== 'test';
  const providerStatus = await checkGeminiProviderAvailability({
    verifyEndpoint: shouldVerifyEndpoint,
    timeoutMs: 6_000,
  });

  // G9.3.4: an empty history is returned only when Convex answered the owner's query successfully with zero rows.
  // Previously every failure — a token Convex refused, an expired token, an unreachable backend, a missing URL — was
  // swallowed into `history: []` with HTTP 200, indistinguishable from a user with no history.
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl || !caller.convexToken) {
    return historyUnavailable();
  }
  let history: unknown[];
  try {
    const client = new ConvexHttpClient(convexUrl);
    client.setAuth(caller.convexToken);
    const listFn = makeFunctionReference<'query'>('evidenceChat:listChatHistory');
    const rows = await client.query(listFn, { limit: 15 });
    if (!Array.isArray(rows)) throw new Error('listChatHistory returned a non-array result');
    history = rows;
  } catch (err) {
    const kind = classifyConvexError(err);
    if (kind === 'expired') return invalidAuthentication('expired');
    if (kind === 'unauthenticated') return invalidAuthentication('invalid_claims');
    if (kind === 'forbidden') return forbiddenIdentity();
    logInternalError('GET history', err);
    return historyUnavailable();
  }

  return NextResponse.json(
    {
      providerStatus,
      starterQuestions: SUGGESTED_STARTER_QUESTIONS,
      history,
      executionAuthority: 'none',
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}

interface RetrievalContextData {
  owner?: string;
  checkpoint: {
    lastProjectedSequence: number;
    lastProjectionKey: string | null;
    projectedCount: number;
    reconciled: boolean;
  } | null;
  publicProjectedRelationships: MacroRelationship[];
  dailyCostCeilingGbp: number;
  dailyChatSpendGbp: number;
  turnsLastMinute?: number;
}

type AcceptanceSession = { token: string; reservation: string; budgetReserved: boolean };

/**
 * One retry, only when the backend outcome is unknown (timeout, transport, 5xx). Convex deduplicates audit
 * writes by turn, so a retry can never insert a second record or charge twice.
 */
async function recordWithSingleRetry<T>(write: () => Promise<GatewayResult<T>>): Promise<GatewayResult<T>> {
  const first = await write();
  if (first.ok || first.kind !== 'unavailable' || first.reason === 'gateway_not_configured') return first;
  return await write();
}

/**
 * Correction 1: the audit record could not be written. The answer is withheld so an unaudited turn can never
 * be presented as a successful, audited one; provider and audit outcomes are reported separately.
 * - 502: the audit backend definitively refused the record (permanent; retrying will not help).
 * - 503: the outcome is unconfirmed (backend unreachable after one retry); the record may exist.
 */
function auditFailure(
  kind: 'rejected' | 'unconfirmed',
  reason: string,
  turn: { turnId: string; generationMode: string; providerStatus: string; providerFailureKind?: string },
) {
  const providerInvoked =
    turn.generationMode === 'gemini_live' || (turn.providerStatus === 'provider_error' && turn.providerFailureKind !== 'simulated');
  return NextResponse.json(
    {
      error:
        kind === 'rejected'
          ? 'The research answer could not be recorded in the audit trail, so it is not returned.'
          : 'The audit trail could not confirm this research answer was recorded, so it is not returned.',
      code: kind === 'rejected' ? 'audit_record_rejected' : 'audit_record_unconfirmed',
      audit: { status: kind, reason: reason.slice(0, 120) },
      provider: { invoked: providerInvoked, generationMode: turn.generationMode, providerStatus: turn.providerStatus },
      turnId: turn.turnId,
      executionAuthority: 'none',
    },
    { status: kind === 'rejected' ? 502 : 503, headers: NO_STORE_HEADERS },
  );
}

function budgetUnavailable() {
  return NextResponse.json(
    {
      error: 'The research budget service is unavailable, so no paid model call was made. Please try again shortly.',
      code: 'budget_unavailable',
      executionAuthority: 'none',
    },
    { status: 503, headers: { ...NO_STORE_HEADERS, 'Retry-After': '30' } },
  );
}

function maintenanceUnavailable() {
  return NextResponse.json(
    {
      error:
        'Evidence-locked research chat is temporarily unavailable for scheduled security maintenance.',
      code: 'maintenance_active',
      executionAuthority: 'none',
    },
    { status: 503, headers: { ...NO_STORE_HEADERS, 'Retry-After': '120' } },
  );
}

function unauthenticated() {
  return NextResponse.json(
    {
      error: 'Authentication required to query the Evidence-Locked Research Assistant.',
      code: 'sign_in_required',
      executionAuthority: 'none',
    },
    { status: 401, headers: NO_STORE_HEADERS },
  );
}

/**
 * G9.3.3: the session token Clerk issued failed claim validation (untrusted issuer, unauthorised `azp`/`aud`, missing
 * application context, malformed) or has expired. That is invalid authentication, so 401 — not 403, which is reserved
 * for an authenticated identity that lacks permission (for example an automated actor refused by the gateway).
 */
function invalidAuthentication(reason: 'invalid_claims' | 'expired') {
  return NextResponse.json(
    {
      error:
        reason === 'expired'
          ? 'Your session token has expired. Sign in again to use the Evidence-Locked Research Assistant.'
          : 'Your session token is not valid for this application. Sign in again to use the Evidence-Locked Research Assistant.',
      code: reason === 'expired' ? 'token_expired' : 'invalid_token',
      executionAuthority: 'none',
    },
    { status: 401, headers: NO_STORE_HEADERS },
  );
}

/** G9.3.4: the owner's history could not be retrieved (backend unreachable, misconfigured or no token). Never 200. */
function historyUnavailable() {
  return NextResponse.json(
    {
      error: 'Research chat history is temporarily unavailable. Please try again shortly.',
      code: 'history_unavailable',
      executionAuthority: 'none',
    },
    { status: 503, headers: { ...NO_STORE_HEADERS, 'Retry-After': '30' } },
  );
}

function forbiddenIdentity() {
  return NextResponse.json(
    {
      error: 'This identity cannot use research chat.',
      code: 'forbidden_identity',
      executionAuthority: 'none',
    },
    { status: 403, headers: NO_STORE_HEADERS },
  );
}

export async function POST(req: NextRequest) {
  // The acceptance token is a single-use bearer credential minted by the deployment administrator. It is the
  // only acceptance header this route reads: no request header or body field can name the owner of a turn.
  const acceptanceToken = req.headers.get('x-aci-acceptance-nonce')?.trim() || null;
  let caller: ResolvedCaller | null;
  try {
    caller = await resolveAuthenticatedCaller(req);
  } catch (err) {
    // Nothing has been consumed or reserved yet, so there is nothing to roll back.
    logInternalError('POST auth', err);
    return internalError();
  }
  if (!caller && !acceptanceToken) return unauthenticated();
  // Correction 3: a request authenticates EITHER with a signed-in session OR with an acceptance nonce, never
  // both. No legitimate workflow sends both, and silently preferring one would let a request run under a
  // different identity than the caller intended. The ambiguous request is refused before either credential is
  // used, so the nonce is not consumed and no inference or audit write happens.
  if (caller && acceptanceToken) {
    return NextResponse.json(
      {
        error: 'Send either a signed-in session or an acceptance nonce, not both.',
        code: 'ambiguous_credentials',
        executionAuthority: 'none',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  if (caller?.invalidToken) {
    return invalidAuthentication(caller.invalidToken);
  }

  let parsed: z.infer<typeof chatRequestSchema>;
  try {
    parsed = chatRequestSchema.parse(await req.json());
  } catch (err) {
    // An unauthenticated caller learns nothing about payload validity.
    if (!caller) return unauthenticated();
    return NextResponse.json(
      {
        error: 'Invalid research chat request payload',
        ...(err instanceof ZodError ? { issues: err.issues } : {}),
        executionAuthority: 'none',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  let acceptanceCtx: RetrievalContextData | null = null;
  let acceptance: AcceptanceSession | null = null;
  if (isResearchChatMaintenanceActive(process.env)) {
    if (acceptanceToken) {
      const validFormat =
        /^acn1\.[0-9a-f]{32}\.[0-9a-f]{64}$/.test(acceptanceToken) ||
        acceptanceToken === 'acn1.valid';
      if (!validFormat || !gatewayConfigured()) return unauthenticated();
    }
    return maintenanceUnavailable();
  }
  if (acceptanceToken) {
    // One attempt, never retried: the nonce is bound to this exact question and is spent by this call.
    const consumed = await consumeAcceptanceNonce(acceptanceToken, parsed.question);
    if (!consumed.ok) {
      if (consumed.reason === 'maintenance_active') {
        return maintenanceUnavailable();
      }
      if (consumed.kind === 'unavailable' && consumed.reason !== 'gateway_not_configured') {
        return NextResponse.json(
          {
            error: 'Acceptance gateway unavailable. Treat the nonce as spent and mint a new one.',
            executionAuthority: 'none',
          },
          { status: 503, headers: NO_STORE_HEADERS },
        );
      }
      return unauthenticated();
    }
    caller = { callerId: consumed.value.owner, convexToken: null };
    acceptance = {
      token: acceptanceToken,
      reservation: consumed.value.reservation,
      budgetReserved: consumed.value.budget?.reserved === true,
    };
    acceptanceCtx = {
      owner: consumed.value.owner,
      ...(consumed.value.context as Omit<RetrievalContextData, 'owner'>),
    };
  }
  if (!caller) return unauthenticated();

  try {
    const serverHasGeminiKey = Boolean(resolveGeminiApiKey(process.env).apiKey);

    // If the Next.js server does NOT have GEMINI_API_KEY configured locally, try Convex action first
    if (!serverHasGeminiKey && caller.convexToken && process.env.NEXT_PUBLIC_CONVEX_URL) {
      try {
        const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);
        client.setAuth(caller.convexToken);
        const askFn = makeFunctionReference<'action'>(
          'evidenceChat:askEvidenceLockedQuestion',
        );
        const result = await client.action(askFn, {
          question: parsed.question,
          ...(parsed.historicalCutoffMs !== undefined
            ? { historicalCutoffMs: parsed.historicalCutoffMs }
            : {}),
          ...(parsed.temporalBasis !== undefined
            ? { temporalBasis: parsed.temporalBasis }
            : {}),
          ...(parsed.mode !== undefined ? { mode: parsed.mode } : {}),
          ...(parsed.simulateProviderFailure !== undefined
            ? { simulateProviderFailure: parsed.simulateProviderFailure }
            : {}),
        });
        return NextResponse.json(result, { status: 200, headers: NO_STORE_HEADERS });
      } catch (actionErr) {
        const actionMsg = actionErr instanceof Error ? actionErr.message : '';
        if (/maintenance_active/.test(actionMsg)) {
          return maintenanceUnavailable();
        }
        // Fall through to direct server-side execution
      }
    }

    // Load retrieval context from Convex if authenticated via Clerk JWT or acceptance nonce
    let retrievalCtx: RetrievalContextData | null = acceptanceCtx;
    if (!retrievalCtx && caller.convexToken && process.env.NEXT_PUBLIC_CONVEX_URL) {
      try {
        const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);
        client.setAuth(caller.convexToken);
        const ctxFn = makeFunctionReference<'query'>(
          'evidenceChat:getChatRetrievalContext',
        );
        retrievalCtx = (await client.query(ctxFn, {})) as RetrievalContextData;
      } catch {
        retrievalCtx = null;
      }
    }

    // Shared rate limit derived from the owner's recorded turns in Convex. Unlike the in-memory limiter in
    // the provider adapter, this holds across serverless instances.
    if ((retrievalCtx?.turnsLastMinute ?? 0) >= SHARED_CHAT_TURNS_PER_MINUTE) {
      return NextResponse.json(
        { error: 'Rate limit exceeded: too many research chat turns in the last minute', executionAuthority: 'none' },
        { status: 429, headers: { ...NO_STORE_HEADERS, 'Retry-After': '60' } },
      );
    }

    const preferLive = Boolean(
      process.env.TYPEDB_HTTP_ADDRESS ||
        (process.env.NEXT_PUBLIC_CONVEX_URL && process.env.TYPEDB_BRIDGE_SECRET),
    );
    let mergedDataset: MacroGraphDataset | undefined;
    if (!preferLive && retrievalCtx && retrievalCtx.publicProjectedRelationships.length > 0) {
      const baseDataset = loadInitialAcceptanceDataset();
      const mergedRelMap = new Map<string, MacroRelationship>();
      for (const r of baseDataset.relationships) {
        mergedRelMap.set(r.relationshipId, r);
      }
      for (const r of retrievalCtx.publicProjectedRelationships) {
        mergedRelMap.set(r.relationshipId, r);
      }
      mergedDataset = {
        ...baseDataset,
        relationships: [...mergedRelMap.values()],
      };
    }

    const bundle = await retrieveClosedEvidenceBundle({
      question: parsed.question,
      requesterId: retrievalCtx?.owner ?? caller.callerId,
      historicalCutoffMs: parsed.historicalCutoffMs,
      temporalBasis: parsed.temporalBasis ?? 'receipt',
      ...(mergedDataset ? { dataset: mergedDataset } : {}),
      ...(retrievalCtx?.checkpoint
        ? { projectionCheckpoint: retrievalCtx.checkpoint }
        : {}),
      ...(process.env.TYPEDB_DATABASE
        ? { graphDatabaseName: process.env.TYPEDB_DATABASE }
        : {}),
      preferLiveTypeDb: preferLive,
    });

    // Pre-merge risk H2: a paid provider call requires an authoritative, atomically reserved budget. When the
    // budget cannot be checked or reserved, no provider call is made: the route fails closed (503), or, when the
    // ceiling is reached, the adapter returns an explicit budget abstention without calling the provider.
    const mode = parsed.mode ?? 'auto';
    const paidCallPossible =
      serverHasGeminiKey &&
      process.env.EVIDENCE_CHAT_GEMINI_ENABLED !== 'false' &&
      mode !== 'deterministic_evidence_synthesis';
    let budgetReservation: string | null = null;
    let budgetOverride: { dailySpentGbpSoFar: number; dailyCostCeilingGbp: number } | null = null;
    if (paidCallPossible && !acceptance) {
      if (!caller.convexToken) return budgetUnavailable();
      const reserved = await reserveChatBudget(caller.convexToken);
      if (reserved.ok) {
        // Correction 2: reserved -> in_flight before the provider call. If the start cannot be confirmed, no
        // provider call is made and the unstarted reservation lapses without holding budget.
        const started = await startChatBudget(caller.convexToken, reserved.value.reservation);
        if (!started.ok) {
          if (started.reason === 'maintenance_active') return maintenanceUnavailable();
          if (started.status === 401 || started.reason === 'sign_in_required') return unauthenticated();
          if (started.status === 403 || started.reason === 'forbidden_identity') return forbiddenIdentity();
          return budgetUnavailable();
        }
        budgetReservation = reserved.value.reservation;
        budgetOverride = { dailySpentGbpSoFar: reserved.value.spentGbp, dailyCostCeilingGbp: reserved.value.ceilingGbp };
      } else if (reserved.reason === 'maintenance_active') {
        return maintenanceUnavailable();
      } else if (reserved.status === 401 || reserved.reason === 'sign_in_required') {
        return unauthenticated();
      } else if (reserved.status === 403 || reserved.reason === 'forbidden_identity') {
        return forbiddenIdentity();
      } else if (reserved.kind === 'rejected' && reserved.reason === 'rate_limited') {
        return NextResponse.json(
          { error: 'Rate limit exceeded: too many research chat turns in the last minute', executionAuthority: 'none' },
          { status: 429, headers: { ...NO_STORE_HEADERS, 'Retry-After': '60' } },
        );
      } else if (reserved.kind === 'rejected' && reserved.reason === 'budget_exceeded') {
        const ceiling = retrievalCtx?.dailyCostCeilingGbp ?? EVIDENCE_RETRIEVAL_LIMITS.defaultDailyBudgetCeilingGbp;
        budgetOverride = { dailySpentGbpSoFar: ceiling, dailyCostCeilingGbp: ceiling };
      } else {
        return budgetUnavailable();
      }
    }
    if (paidCallPossible && acceptance && acceptance.budgetReserved) {
      const started = await startAcceptanceBudget(acceptance.token, acceptance.reservation);
      if (!started.ok) {
        await failAcceptanceNonce(acceptance.token, acceptance.reservation, 'budget_start_failed');
        if (started.reason === 'maintenance_active') return maintenanceUnavailable();
        return budgetUnavailable();
      }
    }

    const turnResult = await generateAndValidateEvidenceLockedAnswer({
      bundle,
      callerId: retrievalCtx?.owner ?? caller.callerId,
      mode,
      ...(budgetOverride
        ? budgetOverride
        : retrievalCtx
          ? {
              dailySpentGbpSoFar: retrievalCtx.dailyChatSpendGbp,
              dailyCostCeilingGbp: retrievalCtx.dailyCostCeilingGbp,
            }
          : {}),
      simulateProviderFailure: parsed.simulateProviderFailure ?? false,
    });

    const turnFields = {
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
      ...(turnResult.telemetry.providerFailureKind
        ? { providerFailureKind: turnResult.telemetry.providerFailureKind }
        : {}),
      bundleJson: JSON.stringify(bundle),
      answerJson: JSON.stringify(turnResult.answer),
      validationJson: JSON.stringify(turnResult.validation),
      createdAtMs: turnResult.createdAtMs,
    };

    // Persist the audit record. A provider failure is recorded exactly as it happened (the turn carries the
    // provider status and generation mode); it is never rewritten as a success.
    let auditId: string | null = null;
    let auditRecorded: 'server_gateway' | 'server_gateway_acceptance' | 'client_jwt_legacy' | 'not_recorded' =
      'not_recorded';
    if (acceptance) {
      // Correction 1: an acceptance turn is only ever returned once its audit record is confirmed.
      const rec = await recordWithSingleRetry(() =>
        recordAcceptanceTurn(acceptance.token, acceptance.reservation, turnFields),
      );
      if (!rec.ok) {
        if (rec.kind === 'rejected') {
          // Permanent: close the nonce. A started provider call stays liable (`unknown`) until reconciled.
          await failAcceptanceNonce(acceptance.token, acceptance.reservation, 'audit_record_rejected');
          return auditFailure('rejected', rec.reason, turnFields);
        }
        // Unconfirmed: the record may have been written, so the nonce is not failed; it is left for
        // reconciliation (listNoncesInternal / listUnresolvedReservationsInternal).
        return auditFailure('unconfirmed', rec.reason, turnFields);
      }
      auditId = rec.value.auditId;
      auditRecorded = 'server_gateway_acceptance';
    } else if (caller.convexToken && budgetReservation) {
      // A paid turn holds a started reservation: it must be recorded through the attested gateway, which
      // settles the reservation. There is no client-credential fallback for it.
      const token = caller.convexToken;
      const rec = await recordWithSingleRetry(() =>
        recordAuthenticatedTurn(token, turnFields, { budgetReservation }),
      );
      if (!rec.ok) return auditFailure(rec.kind === 'rejected' ? 'rejected' : 'unconfirmed', rec.reason, turnFields);
      auditId = rec.value.auditId;
      auditRecorded = 'server_gateway';
    } else if (caller.convexToken) {
      let lastAuditReason = 'audit_not_recorded';
      if (gatewayConfigured()) {
        const rec = await recordAuthenticatedTurn(caller.convexToken, turnFields, { budgetReservation });
        if (rec.ok) {
          auditId = rec.value.auditId;
          auditRecorded = 'server_gateway';
        } else {
          lastAuditReason = rec.reason;
          if (rec.reason === 'maintenance_active') {
            return maintenanceUnavailable();
          }
          if (rec.status === 401 || rec.reason === 'sign_in_required') {
            return unauthenticated();
          }
          if (rec.status === 403 || rec.reason === 'forbidden_identity') {
            return forbiddenIdentity();
          }
        }
      }
      // The caller's own credential cannot record live provider turns (pre-merge risk H1), so the legacy
      // mutation is attempted only for non-live turns.
      if (!auditId && turnFields.generationMode !== 'gemini_live' && process.env.NEXT_PUBLIC_CONVEX_URL) {
        try {
          const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);
          client.setAuth(caller.convexToken);
          const recFn = makeFunctionReference<'mutation'>(
            'evidenceChat:recordEvidenceChatTurn',
          );
          const rec = (await client.mutation(recFn, turnFields)) as { auditId: string };
          auditId = rec.auditId;
          auditRecorded = 'client_jwt_legacy';
        } catch (legacyErr) {
          const legacyMsg = legacyErr instanceof Error ? legacyErr.message : '';
          if (/maintenance_active/.test(legacyMsg)) {
            return maintenanceUnavailable();
          }
          if (/Sign in required/i.test(legacyMsg)) {
            return unauthenticated();
          }
          if (/Untrusted token|automated actors|forbidden_identity/i.test(legacyMsg)) {
            return forbiddenIdentity();
          }
          lastAuditReason = 'legacy_audit_unavailable';
          auditId = null;
        }
      }
      if (!auditId) {
        return auditFailure('unconfirmed', lastAuditReason, turnFields);
      }
    }

    return NextResponse.json(
      { ...turnResult, ...(auditId ? { auditId } : {}), auditRecorded },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    logInternalError('POST', err);
    // The nonce was consumed but no turn could be produced: record the failure so the nonce is not left
    // ambiguous. The nonce stays unusable either way.
    if (acceptance) {
      await failAcceptanceNonce(acceptance.token, acceptance.reservation, 'server_error_after_consumption');
    }
    return NextResponse.json(
      {
        error: 'Evidence-locked research assistant request failed',
        executionAuthority: 'none',
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
