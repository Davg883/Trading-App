import React from 'react';
import MacroDataRoom from '../../components/macro-data-room';
import { loadInitialAcceptanceDataset } from '../../lib/graph/query-gateway';
import { probeTypeDbServer } from '../../lib/graph/typedb-driver-adapter';
import { runGraphVsConvexBenchmark } from '../../lib/graph/benchmark-evaluator';
import './data-room.css';

export const dynamic = 'force-dynamic';

export default async function DataRoomPage() {
  const dataset = loadInitialAcceptanceDataset();
  const [probe, benchmark] = await Promise.all([
    probeTypeDbServer(),
    runGraphVsConvexBenchmark(dataset),
  ]);

  return (
    <MacroDataRoom
      dataset={dataset}
      benchmark={benchmark}
      liveTypeDbStatus={{
        reachable: probe.reachable,
        authenticated: probe.authenticated,
        databaseExists: probe.databaseExists,
        databaseName: probe.databaseName,
        distribution: probe.distribution,
        version: probe.version,
        latencyMs: probe.latencyMs,
        tlsEnabled: Boolean(
          process.env.TYPEDB_TLS_ENABLED === 'true' ||
            (process.env.TYPEDB_HTTP_ADDRESS ?? '').startsWith('https://') ||
            probe.databaseName === 'aci_macro_intelligence_staging',
        ),
      }}
    />
  );
}
