import React from 'react';
import MacroDataRoom from '../../components/macro-data-room';
import { loadInitialAcceptanceDataset } from '../../lib/graph/query-gateway';
import { describeTypeDbTransport, probeTypeDbServer } from '../../lib/graph/typedb-driver-adapter';
import { runGraphVsConvexBenchmark } from '../../lib/graph/benchmark-evaluator';
import '../data-room/data-room.css';

export const dynamic = 'force-dynamic';

export default async function ResearchChatPage() {
  const dataset = loadInitialAcceptanceDataset();
  const [probe, benchmark] = await Promise.all([
    probeTypeDbServer(),
    runGraphVsConvexBenchmark(dataset),
  ]);

  return (
    <MacroDataRoom
      dataset={dataset}
      benchmark={benchmark}
      initialView="evidence_chat"
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
