import React from 'react';
import MacroDataRoom from '../../components/macro-data-room';
import type { GraphSourceMode, MacroGraphDataset } from '../../lib/graph/contracts';
import { loadInitialAcceptanceDataset } from '../../lib/graph/query-gateway';
import {
  TypeDbSchemaOrHydrationError,
  describeTypeDbTransport,
  hydrateMacroDatasetFromLiveTypeDb,
  probeTypeDbServer,
} from '../../lib/graph/typedb-driver-adapter';
import { runGraphVsConvexBenchmark } from '../../lib/graph/benchmark-evaluator';
import './data-room.css';

export const dynamic = 'force-dynamic';

export default async function DataRoomPage({
  searchParams,
}: {
  searchParams?: Promise<{ focal?: string; asOf?: string; view?: string }>;
}) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const fallbackDataset = loadInitialAcceptanceDataset();
  const probe = await probeTypeDbServer();
  const requireLive = process.env.ACI_REQUIRE_LIVE_TYPEDB === '1';

  let activeDataset: MacroGraphDataset = fallbackDataset;
  let graphSourceMode: GraphSourceMode = requireLive
    ? 'GRAPH_UNAVAILABLE'
    : 'HISTORICAL_MIRROR';
  let sourceModeDetail = requireLive
    ? 'Live TypeDB graph is unavailable; static fallback disabled'
    : 'Displaying static historical mirror dataset (live TypeDB unconfigured or unreachable)';

  if (probe.reachable && probe.databaseExists) {
    try {
      const hydrated = await hydrateMacroDatasetFromLiveTypeDb(undefined, {
        callerOwner: 'public_research',
      });
      if (hydrated.ok && hydrated.dataset) {
        activeDataset = hydrated.dataset;
        graphSourceMode = 'LIVE_GRAPH';
        sourceModeDetail = `Hydrated from live TypeDB ${hydrated.serverVersion ?? ''} (${probe.databaseName})`.trim();
      }
    } catch (err) {
      graphSourceMode = 'GRAPH_UNAVAILABLE';
      sourceModeDetail =
        err instanceof TypeDbSchemaOrHydrationError
          ? err.publicMessage
          : 'Live TypeDB graph failed closed during schema/concept validation';
    }
  }

  const benchmark = await runGraphVsConvexBenchmark(fallbackDataset);
  const parsedAsOf = resolvedParams?.asOf ? Number(resolvedParams.asOf) : undefined;
  const latestRelMs =
    graphSourceMode === 'LIVE_GRAPH' && activeDataset.relationships.length > 0
      ? Math.max(...activeDataset.relationships.map((r) => r.receivedAtMs))
      : undefined;

  return (
    <MacroDataRoom
      dataset={activeDataset}
      benchmark={benchmark}
      graphSourceMode={graphSourceMode}
      sourceModeDetail={sourceModeDetail}
      initialFocalId={
        resolvedParams?.focal ??
        (graphSourceMode === 'LIVE_GRAPH' &&
        activeDataset.organisations.some((o) => o.orgId === 'org-nvda') &&
        !activeDataset.relationships.some((r) =>
          r.participants.some((p) => p.entityId === 'org-nscale'),
        )
          ? 'org-nvda'
          : undefined)
      }
      initialAsOfMs={
        parsedAsOf && Number.isFinite(parsedAsOf)
          ? parsedAsOf
          : latestRelMs && latestRelMs > 1794146400000
            ? 1794949170000
            : undefined
      }
      initialSelectedRelationshipId={
        graphSourceMode === 'LIVE_GRAPH' &&
        !activeDataset.relationships.some((r) => r.relationshipId === 'rel-loughton-msft-r2')
          ? activeDataset.relationships[0]?.relationshipId
          : undefined
      }
      liveTypeDbStatus={{
        reachable: probe.reachable,
        authenticated: probe.authenticated,
        databaseExists: probe.databaseExists,
        databaseName: probe.databaseName,
        distribution: probe.distribution,
        version: probe.version,
        latencyMs: probe.latencyMs,
        tlsEnabled: describeTypeDbTransport().tlsEnabled,
      }}
    />
  );
}
