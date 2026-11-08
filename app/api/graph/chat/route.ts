import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { z, ZodError } from 'zod';
import {
  SUGGESTED_STARTER_QUESTIONS,
  temporalBasisSchema,
} from '../../../../lib/graph/evidence-chat-contracts';
import { retrieveClosedEvidenceBundle } from '../../../../lib/graph/evidence-retrieval-gateway';
import {
  checkGeminiProviderAvailability,
  generateAndValidateEvidenceLockedAnswer,
} from '../../../../lib/graph/gemini-provider-adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

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

  const providerStatus = await checkGeminiProviderAvailability({
    verifyEndpoint: false,
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

export async function POST(req: NextRequest) {
  const caller = await resolveAuthenticatedCaller(req);
  if (!caller) {
    return NextResponse.json(
      {
        error: 'Authentication required to query the Evidence-Locked Research Assistant.',
        executionAuthority: 'none',
      },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const rawBody = await req.json();
    const parsed = chatRequestSchema.parse(rawBody);

    // If caller has a live Clerk->Convex JWT, invoke the Convex Action so the immutable
    // EvidenceBundleV1, Answer, and Validation Report are persisted in `evidenceChatAudit`.
    if (caller.convexToken && process.env.NEXT_PUBLIC_CONVEX_URL) {
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
        // Fall through to direct server-side execution if Convex action transport is unavailable
      }
    }

    const bundle = await retrieveClosedEvidenceBundle({
      question: parsed.question,
      requesterId: caller.callerId,
      historicalCutoffMs: parsed.historicalCutoffMs,
      temporalBasis: parsed.temporalBasis ?? 'receipt',
      graphDatabaseName: process.env.TYPEDB_DATABASE ?? 'aci_macro_intelligence_prod',
      preferLiveTypeDb: Boolean(process.env.TYPEDB_HTTP_ADDRESS),
    });

    const turnResult = await generateAndValidateEvidenceLockedAnswer({
      bundle,
      callerId: caller.callerId,
      mode: parsed.mode ?? 'auto',
      simulateProviderFailure: parsed.simulateProviderFailure ?? false,
    });

    return NextResponse.json(turnResult, { status: 200, headers: NO_STORE_HEADERS });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        {
          error: 'Invalid research chat request payload',
          issues: err.issues,
          executionAuthority: 'none',
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
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
