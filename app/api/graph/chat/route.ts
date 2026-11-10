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
} from '../../../../lib/graph/evidence-chat-gateway';

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
  if (
    process.env.NODE_ENV === 'test' ||
    (process.env.NODE_ENV !== 'production' &&
      ['localhost', '127.0.0.1'].includes(new URL(req.url).hostname))
  ) {
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
}

type AcceptanceSession = { token: string; reservation: string };

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
  if (!caller && acceptanceToken) {
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
    acceptance = { token: acceptanceToken, reservation: consumed.value.reservation };
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

    const turnResult = await generateAndValidateEvidenceLockedAnswer({
      bundle,
      callerId: retrievalCtx?.owner ?? caller.callerId,
      mode: parsed.mode ?? 'auto',
      ...(retrievalCtx
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
    } else if (caller.convexToken) {
      if (gatewayConfigured()) {
        const rec = await recordAuthenticatedTurn(caller.convexToken, turnFields);
        if (rec.ok) {
          auditId = rec.value.auditId;
          auditRecorded = 'server_gateway';
        }
      }
      if (!auditId && process.env.NEXT_PUBLIC_CONVEX_URL) {
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
