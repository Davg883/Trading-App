import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { ZodError } from 'zod';
import {
  executeAllowlistedGraphQuery,
  loadInitialAcceptanceDataset,
} from '../../../../lib/graph/query-gateway';
import { probeTypeDbServer } from '../../../../lib/graph/typedb-driver-adapter';
import { runGraphVsConvexBenchmark } from '../../../../lib/graph/benchmark-evaluator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function resolveAuthenticatedCaller(req: NextRequest): Promise<string | null> {
  if (process.env.NODE_ENV === 'test') {
    const testCaller = req.headers.get('x-aci-test-caller');
    if (testCaller && testCaller.trim().length > 0) {
      return testCaller.trim();
    }
  }
  try {
    const session = await auth();
    if (session?.userId) {
      return session.userId;
    }
  } catch {
    // Fall through to unauthorized response
  }
  return null;
}

export async function GET(req: NextRequest) {
  const callerId = await resolveAuthenticatedCaller(req);
  if (!callerId) {
    return NextResponse.json(
      {
        error: 'Authentication required to access the Macro Intelligence Graph Gateway.',
        executionAuthority: 'none',
      },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action') ?? 'metadata';

  if (action === 'metadata') {
    const dataset = loadInitialAcceptanceDataset();
    const probe = await probeTypeDbServer();
    const benchmark = await runGraphVsConvexBenchmark(dataset);
    return NextResponse.json({
      schemaVersion: dataset.schemaVersion,
      typedbServer: {
        reachable: probe.reachable,
        version: probe.version,
        httpEndpointConfigured: true,
        tlsEnabled: Boolean(process.env.TYPEDB_TLS_ENABLED === 'true'),
      },
      counts: {
        organisations: dataset.organisations.length,
        sectors: dataset.sectors.length,
        projects: dataset.projects.length,
        energyAssets: dataset.energyAssets.length,
        instruments: dataset.instruments.length,
        sources: dataset.sources.length,
        relationships: dataset.relationships.length,
      },
      benchmark,
      executionAuthority: 'none',
    });
  }

  return NextResponse.json(
    { error: `Unsupported GET action: ${action}`, executionAuthority: 'none' },
    { status: 400 },
  );
}

export async function POST(req: NextRequest) {
  const callerId = await resolveAuthenticatedCaller(req);
  if (!callerId) {
    return NextResponse.json(
      {
        error: 'Authentication required to execute Macro Intelligence Graph queries.',
        executionAuthority: 'none',
      },
      { status: 401 },
    );
  }

  try {
    const body = await req.json();
    const result = await executeAllowlistedGraphQuery(body, {
      callerId,
      preferLiveTypeDb: true,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        {
          error: 'Invalid or non-allowlisted graph query parameters.',
          issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          executionAuthority: 'none',
        },
        { status: 400 },
      );
    }
    const message = err instanceof Error ? err.message : 'Graph query execution failed';
    const status = message.includes('Rate limit exceeded') ? 429 : 400;
    return NextResponse.json(
      {
        error: message,
        executionAuthority: 'none',
      },
      { status },
    );
  }
}
