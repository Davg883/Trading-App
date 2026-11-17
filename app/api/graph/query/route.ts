import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { ZodError } from 'zod';
import {
  executeAllowlistedGraphQuery,
  loadInitialAcceptanceDataset,
} from '../../../../lib/graph/query-gateway';
import {
  TypeDbSchemaOrHydrationError,
  describeTypeDbTransport,
  hydrateMacroDatasetFromLiveTypeDb,
  probeTypeDbServer,
} from '../../../../lib/graph/typedb-driver-adapter';
import { runGraphVsConvexBenchmark } from '../../../../lib/graph/benchmark-evaluator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function resolveAuthenticatedCaller(req: NextRequest): Promise<string | null> {
  if (process.env.NODE_ENV === 'test' && !process.env.VERCEL_ENV) {
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
    const probe = await probeTypeDbServer();
    let dataset = loadInitialAcceptanceDataset();
    let graphSourceMode: 'LIVE_GRAPH' | 'HISTORICAL_MIRROR' | 'GRAPH_UNAVAILABLE' =
      'HISTORICAL_MIRROR';
    if (probe.reachable && probe.databaseExists) {
      try {
        const hydrated = await hydrateMacroDatasetFromLiveTypeDb(undefined, {
          callerOwner: callerId,
        });
        if (hydrated.ok && hydrated.dataset) {
          dataset = hydrated.dataset;
          graphSourceMode = 'LIVE_GRAPH';
        }
      } catch (err) {
        if (err instanceof TypeDbSchemaOrHydrationError) {
          return NextResponse.json(
            {
              error: err.publicMessage,
              graphSourceMode: 'GRAPH_UNAVAILABLE',
              executionAuthority: 'none',
            },
            { status: 502 },
          );
        }
      }
    }
    const benchmark = await runGraphVsConvexBenchmark(dataset);
    return NextResponse.json({
      schemaVersion: dataset.schemaVersion,
      graphSourceMode,
      typedbServer: {
        reachable: probe.reachable,
        authenticated: probe.authenticated,
        databaseExists: probe.databaseExists,
        databaseName: probe.databaseName,
        distribution: probe.distribution,
        version: probe.version,
        latencyMs: probe.latencyMs,
        httpEndpointConfigured: true,
        tlsEnabled: describeTypeDbTransport().tlsEnabled,
      },
      counts: {
        organisations: dataset.organisations.length,
        executives: dataset.executives?.length ?? 0,
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
    const rawBody = (await req.json()) as Record<string, unknown>;
    const requireLiveGraph =
      typeof rawBody === 'object' && rawBody !== null && rawBody.requireLiveGraph === true;
    const queryBody =
      typeof rawBody === 'object' && rawBody !== null && 'requireLiveGraph' in rawBody
        ? Object.fromEntries(Object.entries(rawBody).filter(([k]) => k !== 'requireLiveGraph'))
        : rawBody;
    const result = await executeAllowlistedGraphQuery(queryBody, {
      callerId,
      preferLiveTypeDb: true,
      requireLiveGraph,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof TypeDbSchemaOrHydrationError) {
      return NextResponse.json(
        {
          error: err.publicMessage,
          graphSourceMode: 'GRAPH_UNAVAILABLE',
          executionAuthority: 'none',
        },
        { status: 502 },
      );
    }
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
    // Only messages the gateway raises deliberately are returned; driver, network and configuration errors
    // (which can carry hostnames or query text) are replaced with a generic message.
    const raw = err instanceof Error ? err.message : '';
    const safe = /^(Rate limit exceeded|Security violation|Query type|Unsupported|Invalid)/.test(raw);
    const message = safe ? raw.slice(0, 300) : 'Graph query execution failed';
    const status = raw.includes('Rate limit exceeded') ? 429 : safe ? 400 : 502;
    return NextResponse.json(
      {
        error: message,
        executionAuthority: 'none',
      },
      { status },
    );
  }
}
