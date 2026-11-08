import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildWorkspaceConnectionsReport,
  formatUtcTimestamp,
  type LiveOperationsSnapshot,
} from '../lib/remote-ops/workspace-connections';
import { evaluateCollectionHealth } from '../lib/remote-ops/health-monitor';
import { REMOTE_OPS_VERSION } from '../lib/remote-ops/contracts';

const NOW = Date.parse('2026-11-08T17:15:00Z');

function sampleLiveOperationsSnapshot(): LiveOperationsSnapshot {
  const health = evaluateCollectionHealth({
    now: NOW,
    systemEnabled: true,
    activeEnvironment: 'remote',
    dailyCostCeilingGbp: 2,
    monthlyCostCeilingGbp: 25,
    dailyEstimatedCostGbp: 0,
    dailyActualCostGbp: 0,
    monthlyEstimatedCostGbp: 0,
    monthlyActualCostGbp: 0,
    pendingVerificationCount: 0,
    latestBriefingDate: '2026-11-07',
    latestBriefingGeneratedAt: NOW - 36 * 3_600_000,
    jobs: [
      {
        jobKey: 'market_data_collect',
        environment: 'remote',
        intervalMinutes: 15,
        enabled: true,
        pausedReason: null,
        lastSuccessAt: NOW - 300_000,
        lastFailureAt: null,
        lastRunAt: NOW - 300_000,
        nextRunAt: NOW + 600_000,
        sourcesAddedTotal: 32,
        evidenceAddedTotal: 32,
        estimatedCostGbpTotal: 0,
        actualCostGbpTotal: 0,
        lastOutcome: 'succeeded',
        lastErrorCode: null,
      },
      {
        jobKey: 'sec_filings_collect',
        environment: 'remote',
        intervalMinutes: 15,
        enabled: true,
        pausedReason: null,
        lastSuccessAt: NOW - 300_000,
        lastFailureAt: null,
        lastRunAt: NOW - 300_000,
        nextRunAt: NOW + 600_000,
        sourcesAddedTotal: 6,
        evidenceAddedTotal: 45,
        estimatedCostGbpTotal: 0,
        actualCostGbpTotal: 0,
        lastOutcome: 'succeeded',
        lastErrorCode: null,
      },
      {
        jobKey: 'news_discovery_agent',
        environment: 'remote',
        intervalMinutes: 30,
        enabled: true,
        pausedReason: null,
        lastSuccessAt: NOW - 300_000,
        lastFailureAt: null,
        lastRunAt: NOW - 300_000,
        nextRunAt: NOW + 1_500_000,
        sourcesAddedTotal: 6,
        evidenceAddedTotal: 0,
        estimatedCostGbpTotal: 0,
        actualCostGbpTotal: 0,
        lastOutcome: 'succeeded',
        lastErrorCode: null,
      },
      {
        jobKey: 'portfolio_risk_refresh',
        environment: 'remote',
        intervalMinutes: 15,
        enabled: true,
        pausedReason: null,
        lastSuccessAt: NOW - 300_000,
        lastFailureAt: null,
        lastRunAt: NOW - 300_000,
        nextRunAt: NOW + 600_000,
        sourcesAddedTotal: 1,
        evidenceAddedTotal: 0,
        estimatedCostGbpTotal: 0,
        actualCostGbpTotal: 0,
        lastOutcome: 'succeeded',
        lastErrorCode: null,
      },
      {
        jobKey: 'daily_intelligence_briefing',
        environment: 'remote',
        intervalMinutes: 1440,
        enabled: true,
        pausedReason: null,
        lastSuccessAt: NOW - 36 * 3_600_000,
        lastFailureAt: null,
        lastRunAt: NOW - 36 * 3_600_000,
        nextRunAt: NOW + 12 * 3_600_000,
        sourcesAddedTotal: 6,
        evidenceAddedTotal: 6,
        estimatedCostGbpTotal: 0,
        actualCostGbpTotal: 0,
        lastOutcome: 'succeeded',
        lastErrorCode: null,
      },
      {
        jobKey: 'typedb_outbox_project',
        environment: 'remote',
        intervalMinutes: 15,
        enabled: true,
        pausedReason: null,
        lastSuccessAt: NOW - 300_000,
        lastFailureAt: null,
        lastRunAt: NOW - 300_000,
        nextRunAt: NOW + 600_000,
        sourcesAddedTotal: 23,
        evidenceAddedTotal: 23,
        estimatedCostGbpTotal: 0,
        actualCostGbpTotal: 0,
        lastOutcome: 'succeeded',
        lastErrorCode: null,
      },
    ],
    graphProjection: {
      databaseName: 'aci_macro_intelligence_prod',
      productionIsolated: true,
      schemaVersion: '3.14.0-g1.0',
      lastProjectedSequence: 23,
      projectedCount: 23,
      pendingCount: 0,
      retryingCount: 0,
      deadLetterCount: 0,
      maxProjectionLagMs: 0,
      humanReviewCount: 5,
      reconciled: true,
      updatedAtMs: NOW - 300_000,
    },
  });

  return {
    health,
    latestBriefing: {
      briefingDate: '2026-11-07',
      generatedAt: NOW - 36 * 3_600_000,
      timezone: 'Europe/London',
      confirmedFacts: [],
      researchInterpretation: [],
      riskChanges: [],
      incompleteEvidence: [],
      modelVersion: null,
      executionAuthority: 'none',
      version: REMOTE_OPS_VERSION,
    },
    marketData: {
      totalObservationsStored: 32,
      coveredSymbols: ['NVDA', 'MSFT', 'GOOGL', 'AMZN', 'AMD', 'INTC'],
      latestBySymbol: [],
    },
  };
}

describe('WorkspaceConnectionsReport status derivation (Stage 1-4 audit)', () => {
  it('derives genuine verified production statuses when live Convex & TypeDB telemetry is present', () => {
    const report = buildWorkspaceConnectionsReport({
      liveOps: sampleLiveOperationsSnapshot(),
      convexUrlConfigured: true,
      convexIsProduction: true,
      authenticationConfigured: true,
      clerkIsProduction: true,
      secUserAgentConfigured: true,
      typedbConfigured: true,
      typedbDatabase: 'aci_macro_intelligence_prod',
      licensedMarketDataConfigured: false,
      modelProviderConfigured: false,
      brokerVaultKeyConfigured: false,
      brokerStorageConfigured: false,
      liveTradingEnabled: false,
      demoTradingEnabled: false,
      now: NOW,
    });

    expect(report.liveTelemetryConnected).toBe(true);
    const byId = new Map(report.services.map((s) => [s.id, s]));

    expect(byId.get('convex_database')?.status).toBe('Connected and healthy');
    expect(byId.get('convex_database')?.environment).toBe('Production');
    expect(byId.get('convex_database')?.checkpoint).toContain('32 EOD observations');

    expect(byId.get('sec_edgar')?.status).toBe('Connected and healthy');
    expect(byId.get('sec_edgar')?.environment).toBe('Production');

    expect(byId.get('market_data_eod')?.status).toBe('Connected and healthy');
    expect(byId.get('market_data_eod')?.detail).toContain('never live quotes');

    expect(byId.get('typedb_cloud')?.status).toBe('Connected and healthy');
    expect(byId.get('typedb_cloud')?.checkpoint).toContain('23/23 relationships projected');

    expect(byId.get('clerk_auth')?.status).toBe('Connected and healthy');
    expect(byId.get('clerk_auth')?.environment).toBe('Production');

    // Weekend morning briefing is honestly reported as Connected but stale
    expect(byId.get('morning_briefing')?.status).toBe('Connected but stale');
    expect(byId.get('morning_briefing')?.tone).toBe('amber');

    // Broker vault without server vault key is honestly reported as Not configured
    expect(byId.get('trading212_broker')?.status).toBe('Not configured');
    expect(byId.get('trading212_broker')?.tone).toBe('amber');

    // Unconfigured paid intraday feed and external LLMs are honestly reported as Not configured
    expect(byId.get('market_data_intraday')?.status).toBe('Not configured');
    expect(byId.get('model_providers')?.status).toBe('Not configured');

    // Order execution is Intentionally disabled
    expect(byId.get('trade_execution')?.status).toBe('Intentionally disabled');
    expect(byId.get('trade_execution')?.environment).toBe('Disabled');

    // Benchmark 001 lab is Synthetic/demo only
    expect(byId.get('synthetic_lab')?.status).toBe('Synthetic/demo only');
    expect(byId.get('synthetic_lab')?.environment).toBe('Demo');
  });

  it('transitions Trading 212 broker status to Configured, not yet verified once the server vault is configured', () => {
    const report = buildWorkspaceConnectionsReport({
      liveOps: sampleLiveOperationsSnapshot(),
      convexUrlConfigured: true,
      convexIsProduction: true,
      authenticationConfigured: true,
      clerkIsProduction: true,
      brokerVaultKeyConfigured: true,
      brokerStorageConfigured: true,
      now: NOW,
    });
    const broker = report.services.find((s) => s.id === 'trading212_broker');
    expect(broker?.status).toBe('Configured, not yet verified');
    expect(broker?.environment).toBe('Demo');
  });

  it('reports Failed when a collector or graph projection has failures, and fails closed when unconfigured', () => {
    const snapshot = sampleLiveOperationsSnapshot();
    snapshot.health.graphProjection!.deadLetterCount = 1;
    const secJob = snapshot.health.jobs.find((j) => j.jobKey === 'sec_filings_collect')!;
    secJob.lastErrorCode = 'http_503';

    const report = buildWorkspaceConnectionsReport({
      liveOps: snapshot,
      convexUrlConfigured: true,
      convexIsProduction: true,
      now: NOW,
    });
    const byId = new Map(report.services.map((s) => [s.id, s]));
    expect(byId.get('typedb_cloud')?.status).toBe('Failed');
    expect(byId.get('typedb_cloud')?.tone).toBe('red');
    expect(byId.get('sec_edgar')?.status).toBe('Failed');
    expect(byId.get('sec_edgar')?.tone).toBe('red');

    const emptyReport = buildWorkspaceConnectionsReport({ now: NOW });
    expect(emptyReport.liveTelemetryConnected).toBe(false);
    expect(emptyReport.counts.healthy).toBe(0);
    expect(formatUtcTimestamp(null)).toBe('Not yet verified');
  });

  it('contains zero references to forbidden secret environment variable names', () => {
    const src = readFileSync('lib/remote-ops/workspace-connections.ts', 'utf8');
    expect(src).not.toMatch(
      /BROKER_VAULT_KEY_B64|CONVEX_BROKER_ADMIN_KEY|CLERK_SECRET_KEY|TRADING212_API_KEY/,
    );
  });
});
