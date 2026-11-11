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
} from '../../../../lib/graph/evidence-chat-gateway';
import { EVIDENCE_RETRIEVAL_LIMITS } from '../../../../lib/graph/evidence-chat-contracts';

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

async function resolveAuthenticatedCaller(req: NextRequest): Promise<{
  callerId: string;
  convexToken: string | null;
} | null> {
  // Test-runner only. The previous localhost exception trusted the request's Host header on any
  // non-production build, so it has been removed.
  if (process.env.NODE_ENV === 'test' && !process.env.VERCEL_ENV) {
    const testCaller = req.headers.get('x-aci-test-caller');
    if (testCaller && testCaller.trim().length > 0) {
      return { callerId: testCaller.trim(), convexToken: null };
    }
  }
  try {
    const session = await auth();
    if (session?.userId) {
      const token =
        (await session.getToken({ template: 'convex' }).catch(() => null)) ??
        (await session.getToken().catch(() => null));
      return { callerId: session.userId, convexToken: token };
    }
  } catch {
    // Fall through to 401
  }
  return null;
}

export async function GET(req: NextRequest) {
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

  const caller = await resolveAuthenticatedCaller(req);
  if (!caller) {
    return NextResponse.json(
      {
        error: 'Authentication required to access the Evidence-Locked Research Assistant.',
        executionAuthority: 'none',
      },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const shouldVerifyEndpoint = process.env.NODE_ENV !== 'test';
  const providerStatus = await checkGeminiProviderAvailability({
    verifyEndpoint: shouldVerifyEndpoint,
    timeoutMs: 6_000,
  });

  let history: unknown[] = [];
  if (caller.convexToken && process.env.NEXT_PUBLIC_CONVEX_URL) {
    try {
      const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);
      client.setAuth(caller.convexToken);
      const listFn = makeFunctionReference<'query'>('evidenceChat:listChatHistory');
      history = (await client.query(listFn, { limit: 15 })) as unknown[];
    } catch {
      history = [];
    }
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

function unauthenticated() {
  return NextResponse.json(
    {
      error: 'Authentication required to query the Evidence-Locked Research Assistant.',
      executionAuthority: 'none',
    },
    { status: 401, headers: NO_STORE_HEADERS },
  );
}

export async function POST(req: NextRequest) {
  // The acceptance token is a single-use bearer credential minted by the deployment administrator. It is the
  // only acceptance header this route reads: no request header or body field can name the owner of a turn.
  const acceptanceToken = req.headers.get('x-aci-acceptance-nonce')?.trim() || null;
  let caller = await resolveAuthenticatedCaller(req);
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
  if (acceptanceToken) {
    // One attempt, never retried: the nonce is bound to this exact question and is spent by this call.
    const consumed = await consumeAcceptanceNonce(acceptanceToken, parsed.question);
    if (!consumed.ok) {
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
      } catch {
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

    let mergedDataset: MacroGraphDataset | undefined;
    if (retrievalCtx && retrievalCtx.publicProjectedRelationships.length > 0) {
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
      graphDatabaseName: process.env.TYPEDB_DATABASE ?? 'aci_macro_intelligence_prod',
      preferLiveTypeDb: Boolean(process.env.TYPEDB_HTTP_ADDRESS),
    });

    // Pre-merge risk H2: a paid provider call requires an authoritative, atomically reserved budget. When the
    // budget cannot be checked or reserved, no provider call is made: the route fails closed (503), or, when the
    // ceiling is reached, the adapter returns an explicit budget abstention without calling the provider.
    const mode = parsed.mode ?? 'auto';
    const paidCallPossible = serverHasGeminiKey && mode !== 'deterministic_evidence_synthesis';
    let budgetReservation: string | null = null;
    let budgetOverride: { dailySpentGbpSoFar: number; dailyCostCeilingGbp: number } | null = null;
    if (paidCallPossible && !acceptance) {
      if (!caller.convexToken) return budgetUnavailable();
      const reserved = await reserveChatBudget(caller.convexToken);
      if (reserved.ok) {
        // Correction 2: reserved -> in_flight before the provider call. If the start cannot be confirmed, no
        // provider call is made and the unstarted reservation lapses without holding budget.
        const started = await startChatBudget(caller.convexToken, reserved.value.reservation);
        if (!started.ok) return budgetUnavailable();
        budgetReservation = reserved.value.reservation;
        budgetOverride = { dailySpentGbpSoFar: reserved.value.spentGbp, dailyCostCeilingGbp: reserved.value.ceilingGbp };
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
      const rec = await recordAcceptanceTurn(acceptance.token, acceptance.reservation, turnFields);
      if (rec.ok) {
        auditId = rec.value.auditId;
        auditRecorded = 'server_gateway_acceptance';
      }
    } else if (caller.convexToken && budgetReservation) {
      // A paid turn holds a started reservation: it is recorded only through the attested gateway, which
      // settles the reservation. There is no client-credential fallback for it.
      const rec = await recordAuthenticatedTurn(caller.convexToken, turnFields, { budgetReservation });
      if (rec.ok) {
        auditId = rec.value.auditId;
        auditRecorded = 'server_gateway';
      }
    } else if (caller.convexToken) {
      if (gatewayConfigured()) {
        const rec = await recordAuthenticatedTurn(caller.convexToken, turnFields, { budgetReservation });
        if (rec.ok) {
          auditId = rec.value.auditId;
          auditRecorded = 'server_gateway';
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
        } catch {
          auditId = null;
        }
      }
    }

    return NextResponse.json(
      { ...turnResult, ...(auditId ? { auditId } : {}), auditRecorded },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch {
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
