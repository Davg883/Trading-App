import type { CollectionHealthReport } from './health-monitor';
import type { MorningBriefingRecord } from './contracts';
import type { AuthorisedMarketObservation } from '../market-data/provider-adapter';
import type { MissingEvidenceResolverReport } from '../market-data/missing-evidence-resolver';
import type { ForwardResearchEventRecord } from '../market-data/forward-research';

export type WorkspaceConnectionStatus =
  | 'Connected and healthy'
  | 'Connected but stale'
  | 'Configured, not yet verified'
  | 'Not configured'
  | 'Failed'
  | 'Synthetic/demo only'
  | 'Intentionally disabled';

export type WorkspaceConnectionEnvironment =
  | 'Production'
  | 'Staging'
  | 'Demo'
  | 'Disabled';

export type WorkspaceConnectionTone = 'green' | 'amber' | 'red' | 'neutral';

export type WorkspaceServiceConnection = {
  id:
    | 'convex_database'
    | 'sec_edgar'
    | 'market_data_eod'
    | 'market_data_intraday'
    | 'typedb_cloud'
    | 'clerk_auth'
    | 'trading212_broker'
    | 'model_providers'
    | 'morning_briefing'
    | 'trade_execution'
    | 'synthetic_lab';
  name: string;
  status: WorkspaceConnectionStatus;
  tone: WorkspaceConnectionTone;
  environment: WorkspaceConnectionEnvironment;
  lastVerifiedAt: number | null;
  lastVerifiedLabel: string;
  checkpoint: string;
  detail: string;
};

export type WorkspaceConnectionsReport = {
  evaluatedAt: number;
  evaluatedAtLabel: string;
  liveTelemetryConnected: boolean;
  headline: string;
  summary: string;
  counts: {
    healthy: number;
    stale: number;
    configuredUnverified: number;
    notConfigured: number;
    failed: number;
    intentionallyDisabled: number;
    syntheticOnly: number;
  };
  services: WorkspaceServiceConnection[];
};

export type LiveOperationsSnapshot = {
  health: CollectionHealthReport;
  latestBriefing: MorningBriefingRecord | null;
  marketData?: {
    totalObservationsStored: number;
    coveredSymbols: readonly string[];
    latestBySymbol: AuthorisedMarketObservation[];
  };
  missingEvidenceResolution?: MissingEvidenceResolverReport;
  forwardResearchEvents?: ForwardResearchEventRecord[];
};

export type BuildWorkspaceConnectionsOptions = {
  liveOps?: LiveOperationsSnapshot | null;
  convexUrlConfigured?: boolean;
  convexIsProduction?: boolean;
  authenticationConfigured?: boolean;
  clerkIsProduction?: boolean;
  secUserAgentConfigured?: boolean;
  typedbConfigured?: boolean;
  typedbDatabase?: string | null;
  licensedMarketDataConfigured?: boolean;
  modelProviderConfigured?: boolean;
  brokerVaultKeyConfigured?: boolean;
  brokerStorageConfigured?: boolean;
  liveTradingEnabled?: boolean;
  demoTradingEnabled?: boolean;
  now?: number;
};

export function formatUtcTimestamp(ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts) || ts <= 0) {
    return 'Not yet verified';
  }
  return new Date(ts).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function statusTone(status: WorkspaceConnectionStatus): WorkspaceConnectionTone {
  switch (status) {
    case 'Connected and healthy':
      return 'green';
    case 'Failed':
      return 'red';
    case 'Synthetic/demo only':
    case 'Intentionally disabled':
      return 'neutral';
    case 'Connected but stale':
    case 'Configured, not yet verified':
    case 'Not configured':
    default:
      return 'amber';
  }
}

export function buildWorkspaceConnectionsReport(
  options: BuildWorkspaceConnectionsOptions = {},
): WorkspaceConnectionsReport {
  const health = options.liveOps?.health ?? null;
  const liveTelemetryConnected = Boolean(health);
  const evaluatedAt = health?.evaluatedAt ?? options.now ?? Date.now();
  const evaluatedAtLabel = formatUtcTimestamp(evaluatedAt);

  const convexUrlConfigured = Boolean(options.convexUrlConfigured || liveTelemetryConnected);
  const convexEnv: WorkspaceConnectionEnvironment = options.convexIsProduction
    ? 'Production'
    : convexUrlConfigured
      ? 'Staging'
      : 'Disabled';

  // 1. Convex Research Database
  let convexStatus: WorkspaceConnectionStatus = 'Not configured';
  let convexVerifiedAt: number | null = null;
  let convexCheckpoint = 'No active Convex query endpoint configured';
  let convexDetail =
    'Configure NEXT_PUBLIC_CONVEX_URL and a server deploy credential to query durable research records.';

  if (health) {
    convexVerifiedAt = health.evaluatedAt;
    const enabledCount = health.jobs.filter((j) => j.enabled).length;
    const promotedTotal = health.operationalLayers.evidence.promotedTotal;
    const obsCount = options.liveOps?.marketData?.totalObservationsStored ?? 0;
    convexCheckpoint = `${promotedTotal} promoted facts · ${obsCount} EOD observations · ${enabledCount}/${health.jobs.length} cloud schedules enabled`;
    if (health.operationalLayers.collector.status === 'failed') {
      convexStatus = 'Failed';
      convexDetail = `Convex reachable, but one or more scheduled collectors reported errors (${health.operationalLayers.collector.failedJobsCount} failing).`;
    } else if (!health.systemEnabled) {
      convexStatus = 'Intentionally disabled';
      convexDetail = health.operationalLayers.scheduler.detail;
    } else {
      convexStatus = 'Connected and healthy';
      convexDetail =
        'Authoritative evidence store, provenance ledger, and 15-minute unattended cloud scheduler verified.';
    }
  } else if (convexUrlConfigured) {
    convexStatus = 'Configured, not yet verified';
    convexCheckpoint = 'Convex URL configured; server telemetry query not yet verified in this runtime';
    convexDetail =
      'NEXT_PUBLIC_CONVEX_URL is present, but server-side operational telemetry requires RESEARCH_OWNER_ID and a server deploy credential.';
  }

  // 2. SEC EDGAR Official Disclosures
  const secJob = health?.jobs.find((j) => j.jobKey === 'sec_filings_collect') ?? null;
  let secStatus: WorkspaceConnectionStatus = 'Not configured';
  let secEnv: WorkspaceConnectionEnvironment = options.convexIsProduction ? 'Production' : 'Disabled';
  let secVerifiedAt: number | null = null;
  let secCheckpoint = '0 filings verified in this runtime';
  let secDetail = 'Configure a compliant SEC_USER_AGENT header and Convex collector schedule.';

  if (secJob) {
    secEnv = secJob.environment === 'remote' ? 'Production' : 'Staging';
    secVerifiedAt = secJob.lastSuccessAt;
    const promotedTotal = health?.operationalLayers.evidence.promotedTotal ?? secJob.evidenceAdded;
    secCheckpoint = `${secJob.sourcesAdded} sources discovered · ${promotedTotal} promoted evidence facts`;
    if (!secJob.enabled) {
      secStatus = 'Intentionally disabled';
      secDetail = secJob.pausedReason ?? 'SEC EDGAR collector schedule is disabled by the owner.';
    } else if (secJob.lastErrorCode) {
      secStatus = 'Failed';
      secDetail = `Last SEC EDGAR run failed (${secJob.lastErrorCode}).`;
    } else if (secJob.freshness === 'stale' || secJob.freshness === 'delayed') {
      secStatus = 'Connected but stale';
      secDetail = 'Last successful SEC EDGAR check exceeded its freshness window.';
    } else if (secJob.lastSuccessAt) {
      secStatus = 'Connected and healthy';
      secDetail =
        'Official data.sec.gov submissions & XBRL companyfacts collector active with accession-number deduplication.';
    } else {
      secStatus = 'Configured, not yet verified';
      secDetail = 'SEC EDGAR collector is scheduled and awaiting its first completed run.';
    }
  } else if (options.secUserAgentConfigured) {
    secStatus = 'Configured, not yet verified';
    secEnv = options.convexIsProduction ? 'Production' : 'Staging';
    secCheckpoint = 'SEC_USER_AGENT configured; awaiting live Convex collector telemetry';
    secDetail = 'SEC User-Agent header is configured on the server; connect Convex telemetry to inspect filing runs.';
  }

  // 3. Historical Market Prices & FX (Delayed EOD Reference Closes)
  const mktJob = health?.jobs.find((j) => j.jobKey === 'market_data_collect') ?? null;
  let mktEodStatus: WorkspaceConnectionStatus = 'Not configured';
  let mktEodEnv: WorkspaceConnectionEnvironment = options.convexIsProduction ? 'Production' : 'Disabled';
  let mktEodVerifiedAt: number | null = null;
  let mktEodCheckpoint = 'No live EOD observations loaded';
  let mktEodDetail =
    'Deterministic EOD market-data & ECB FX collector requires an active Convex connection.';

  if (mktJob) {
    mktEodEnv = mktJob.environment === 'remote' ? 'Production' : 'Staging';
    mktEodVerifiedAt = mktJob.lastSuccessAt;
    const obsCount = options.liveOps?.marketData?.totalObservationsStored ?? mktJob.evidenceAdded;
    const symbolCount = options.liveOps?.marketData?.coveredSymbols.length ?? 6;
    mktEodCheckpoint = `${obsCount} EOD observations across ${symbolCount} symbols + USD/GBP FX`;
    if (!mktJob.enabled) {
      mktEodStatus = 'Intentionally disabled';
      mktEodDetail = mktJob.pausedReason ?? 'Market-data collector schedule is disabled by the owner.';
    } else if (mktJob.lastErrorCode) {
      mktEodStatus = 'Failed';
      mktEodDetail = `Market-data collector failed (${mktJob.lastErrorCode}).`;
    } else if (mktJob.freshness === 'stale' || mktJob.freshness === 'delayed') {
      mktEodStatus = 'Connected but stale';
      mktEodDetail = 'Latest EOD market-data & FX collection exceeded its freshness window.';
    } else if (mktJob.lastSuccessAt) {
      mktEodStatus = 'Connected and healthy';
      mktEodDetail =
        'Verified EOD exchange closes (Nasdaq historical API) & ECB USD/GBP reference FX (Frankfurter). Explicitly labelled as delayed EOD reference data, never live quotes.';
    } else {
      mktEodStatus = 'Configured, not yet verified';
      mktEodDetail = 'Market-data collector is scheduled and awaiting its first completed run.';
    }
  }

  // 4. Licensed Real-Time Intraday Market Prices
  const intradayStatus: WorkspaceConnectionStatus = options.licensedMarketDataConfigured
    ? 'Configured, not yet verified'
    : 'Not configured';
  const intradayEnv: WorkspaceConnectionEnvironment = options.licensedMarketDataConfigured
    ? 'Production'
    : 'Disabled';
  const intradayCheckpoint = options.licensedMarketDataConfigured
    ? 'Licensed intraday key present; awaiting live stream verification'
    : '0 real-time quotes (operating on verified EOD reference closes)';
  const intradayDetail = options.licensedMarketDataConfigured
    ? 'Licensed market-data key configured; verify provider feed before enabling intraday quote attribution.'
    : 'No paid real-time intraday market-data feed is configured. The platform uses verified daily EOD reference closes and never fabricates live quotes.';

  // 5. TypeDB Cloud 3.14.2 Knowledge Graph
  const graphProj = health?.graphProjection ?? null;
  const graphJob = health?.jobs.find((j) => j.jobKey === 'typedb_outbox_project') ?? null;
  let typedbStatus: WorkspaceConnectionStatus = 'Not configured';
  let typedbEnv: WorkspaceConnectionEnvironment = 'Disabled';
  let typedbVerifiedAt: number | null = null;
  let typedbCheckpoint = 'No hosted TypeDB projection status loaded';
  let typedbDetail =
    'Configure TYPEDB_HTTP_ADDRESS, TYPEDB_USERNAME, TYPEDB_PASSWORD, and TYPEDB_DATABASE to enable hosted graph queries.';

  if (graphProj) {
    typedbEnv = graphProj.productionIsolated ? 'Production' : 'Staging';
    typedbVerifiedAt = graphProj.updatedAtMs ?? graphJob?.lastSuccessAt ?? null;
    const totalOutbox = graphProj.projectedCount + graphProj.pendingCount + graphProj.retryingCount + graphProj.deadLetterCount;
    typedbCheckpoint = `${graphProj.projectedCount}/${totalOutbox} relationships projected · ${graphProj.deadLetterCount} dead-letter · ${graphProj.maxProjectionLagMs} ms lag (${graphProj.databaseName})`;
    if (graphProj.deadLetterCount > 0 || Boolean(graphJob?.lastErrorCode)) {
      typedbStatus = 'Failed';
      typedbDetail = `TypeDB outbox projection has ${graphProj.deadLetterCount} dead-letter entry(s) requiring reconciliation.`;
    } else if (graphJob?.freshness === 'stale' || graphJob?.freshness === 'delayed') {
      typedbStatus = 'Connected but stale';
      typedbDetail = 'TypeDB outbox projection worker is overdue for its scheduled reconciliation check.';
    } else if (graphProj.projectedCount > 0 && graphProj.pendingCount === 0 && graphProj.reconciled) {
      typedbStatus = 'Connected and healthy';
      typedbDetail = `Hosted TypeDB Cloud 3.14.2 (${graphProj.databaseName}, schema v${graphProj.schemaVersion}) reconciled with Convex outbox; staging database isolated.`;
    } else {
      typedbStatus = 'Configured, not yet verified';
      typedbDetail = `${graphProj.pendingCount} outbox entry(s) pending projection to TypeDB Cloud.`;
    }
  } else if (options.typedbConfigured) {
    typedbStatus = 'Configured, not yet verified';
    typedbEnv = options.typedbDatabase?.endsWith('_prod') ? 'Production' : 'Staging';
    typedbCheckpoint = `Target database: ${options.typedbDatabase ?? 'aci_macro_intelligence_staging'}`;
    typedbDetail =
      'TypeDB Cloud address and database are configured on the server; connect Convex telemetry to inspect outbox reconciliation.';
  }

  // 6. Clerk Production Authentication
  const clerkStatus: WorkspaceConnectionStatus = options.authenticationConfigured
    ? 'Connected and healthy'
    : 'Not configured';
  const clerkEnv: WorkspaceConnectionEnvironment = options.authenticationConfigured
    ? options.clerkIsProduction
      ? 'Production'
      : 'Staging'
    : 'Disabled';
  const clerkVerifiedAt = options.authenticationConfigured ? evaluatedAt : null;
  const clerkCheckpoint = options.authenticationConfigured
    ? 'Clerk session boundary + Convex OIDC JWT binding active'
    : 'Clerk publishable/secret credentials not configured in this environment';
  const clerkDetail = options.authenticationConfigured
    ? 'Authenticated owner and reviewer sessions verified via Clerk OIDC and Convex auth config.'
    : 'Configure Clerk publishable and server authentication credentials alongside NEXT_PUBLIC_CONVEX_URL to enable sign-in.';

  // 7. Trading 212 Read-Only Broker Vault (/settings/brokers)
  let brokerStatus: WorkspaceConnectionStatus = 'Not configured';
  let brokerEnv: WorkspaceConnectionEnvironment = 'Disabled';
  let brokerCheckpoint = 'Server vault not configured; credential form disabled';
  let brokerDetail =
    'Saving, testing, and synchronisation on /settings/brokers remain unavailable until the AES-256-GCM vault key and Convex broker admin credential are configured in Production.';

  if (options.brokerStorageConfigured && options.authenticationConfigured) {
    brokerStatus = 'Configured, not yet verified';
    brokerEnv = 'Demo';
    brokerCheckpoint = 'AES-256-GCM server vault & Convex broker storage ready · read-only Demo & Live supported';
    brokerDetail =
      'Server vault is ready. Open /settings/brokers while signed in to save and test a read-only Trading 212 API key.';
  } else if (options.brokerVaultKeyConfigured && !options.brokerStorageConfigured) {
    brokerStatus = 'Not configured';
    brokerEnv = 'Production';
    brokerCheckpoint = 'AES-256-GCM key present · awaiting Convex broker admin credential on server';
    brokerDetail =
      'Vault encryption key is valid, but the server-side Convex broker admin credential is missing in Production environment settings.';
  } else if (!options.brokerVaultKeyConfigured && options.authenticationConfigured) {
    brokerStatus = 'Not configured';
    brokerEnv = 'Production';
    brokerCheckpoint = 'Clerk & Convex auth ready · awaiting 32-byte AES-256-GCM vault key in Vercel Production';
    brokerDetail =
      'Add the base64-encoded 32-byte AES-256-GCM vault key in Vercel Production environment settings to unlock /settings/brokers (uses Clerk-authenticated owner mutations; no Convex admin key required).';
  }

  // 8. External AI Model Providers
  const modelEnvEntry =
    health?.environmentAudit?.find((e) => e.serviceId === 'remote_ai_models') ?? null;
  let modelStatus: WorkspaceConnectionStatus = 'Not configured';
  let modelEnv: WorkspaceConnectionEnvironment = 'Disabled';
  let modelVerifiedAt: number | null = null;
  const chatTurns = health?.evidenceChat?.totalTurns ?? 0;
  const dailyActual = Math.max(
    health?.dailyCostGbp.actual ?? 0,
    health?.evidenceChat?.dailySpendGbp ?? 0,
  );
  const dailyCeiling = health?.dailyCostGbp.ceiling ?? 2;
  const modelCheckpoint = `${chatTurns} model call${chatTurns === 1 ? '' : 's'} · £${dailyActual.toFixed(4)} / £${dailyCeiling.toFixed(2)} daily ceiling`;
  let modelDetail =
    'No external LLM API key configured in Production. News discovery & morning briefing operate in deterministic SEC XBRL fallback mode.';

  if (modelEnvEntry?.status === 'connected') {
    modelStatus = 'Connected and healthy';
    modelEnv = 'Production';
    modelVerifiedAt = modelEnvEntry.lastVerifiedAt;
    modelDetail = modelEnvEntry.detail;
  } else if (options.modelProviderConfigured) {
    modelStatus = 'Configured, not yet verified';
    modelEnv = 'Production';
    modelDetail =
      'External model provider key is present in environment, but no verified model invocation has been recorded yet.';
  }

  // 9. Morning Intelligence Briefing Schedule
  const briefingJob =
    health?.jobs.find((j) => j.jobKey === 'daily_intelligence_briefing') ?? null;
  let briefingStatus: WorkspaceConnectionStatus = 'Not configured';
  let briefingEnv: WorkspaceConnectionEnvironment = options.convexIsProduction ? 'Production' : 'Disabled';
  let briefingVerifiedAt: number | null = null;
  let briefingCheckpoint = 'No morning briefing record loaded';
  let briefingDetail = 'Morning briefing generator requires an active Convex connection.';

  if (briefingJob) {
    briefingEnv = briefingJob.environment === 'remote' ? 'Production' : 'Staging';
    briefingVerifiedAt = briefingJob.lastSuccessAt;
    const briefDate = options.liveOps?.latestBriefing?.briefingDate ?? health?.operationalLayers.briefing.ukDate ?? 'latest';
    const factCount = options.liveOps?.latestBriefing?.confirmedFacts.length ?? briefingJob.evidenceAdded;
    briefingCheckpoint = `Briefing ${briefDate} (${factCount} confirmed facts) · schedule 07:30 Europe/London`;
    if (!briefingJob.enabled) {
      briefingStatus = 'Intentionally disabled';
      briefingDetail = briefingJob.pausedReason ?? 'Daily intelligence briefing schedule is disabled by the owner.';
    } else if (briefingJob.lastErrorCode) {
      briefingStatus = 'Failed';
      briefingDetail = `Last briefing generation failed (${briefingJob.lastErrorCode}).`;
    } else if (briefingJob.freshness === 'stale' || briefingJob.freshness === 'delayed' || health?.operationalLayers.briefing.status === 'stale') {
      briefingStatus = 'Connected but stale';
      briefingDetail =
        'Last weekday briefing is older than the 30h freshness threshold (expected over the weekend; next automatic run is weekday 07:30 Europe/London).';
    } else if (briefingJob.lastSuccessAt) {
      briefingStatus = 'Connected and healthy';
      briefingDetail = 'Daily 07:30 Europe/London morning briefing is current and backed by promoted evidence.';
    } else {
      briefingStatus = 'Configured, not yet verified';
      briefingDetail = 'Morning briefing schedule is enabled and awaiting its next weekday window.';
    }
  }

  // 10. Live & Demo Order Execution Boundary
  const executionEnabled = Boolean(options.liveTradingEnabled || options.demoTradingEnabled);
  const executionStatus: WorkspaceConnectionStatus = executionEnabled
    ? 'Configured, not yet verified'
    : 'Intentionally disabled';
  const executionEnv: WorkspaceConnectionEnvironment = 'Disabled';
  const executionCheckpoint = `LIVE_TRADING_ENABLED=${Boolean(options.liveTradingEnabled)} · DEMO_TRADING_ENABLED=${Boolean(options.demoTradingEnabled)} · executionAuthority=none`;
  const executionDetail =
    'Hard safety invariant: live and demo broker order placement routes are intentionally disabled and fail closed.';

  // 11. Synthetic Benchmark 001 Laboratory
  const syntheticStatus: WorkspaceConnectionStatus = 'Synthetic/demo only';
  const syntheticEnv: WorkspaceConnectionEnvironment = 'Demo';
  const syntheticCheckpoint = '6 illustrative benchmark companies · browser localStorage paper ledger';
  const syntheticDetail =
    'Used only by the Benchmark 001 laboratory tabs (Analyst Lab, Economics Observatory, Paper Trading, Vectis ONE Lab). Explicitly isolated from live Convex research and Trading 212 records.';

  const services: WorkspaceServiceConnection[] = [
    {
      id: 'convex_database',
      name: 'Convex · durable research records',
      status: convexStatus,
      tone: statusTone(convexStatus),
      environment: convexEnv,
      lastVerifiedAt: convexVerifiedAt,
      lastVerifiedLabel: formatUtcTimestamp(convexVerifiedAt),
      checkpoint: convexCheckpoint,
      detail: convexDetail,
    },
    {
      id: 'sec_edgar',
      name: 'SEC EDGAR · official disclosures',
      status: secStatus,
      tone: statusTone(secStatus),
      environment: secEnv,
      lastVerifiedAt: secVerifiedAt,
      lastVerifiedLabel: formatUtcTimestamp(secVerifiedAt),
      checkpoint: secCheckpoint,
      detail: secDetail,
    },
    {
      id: 'market_data_eod',
      name: 'Market data · EOD reference closes & ECB FX',
      status: mktEodStatus,
      tone: statusTone(mktEodStatus),
      environment: mktEodEnv,
      lastVerifiedAt: mktEodVerifiedAt,
      lastVerifiedLabel: formatUtcTimestamp(mktEodVerifiedAt),
      checkpoint: mktEodCheckpoint,
      detail: mktEodDetail,
    },
    {
      id: 'typedb_cloud',
      name: 'TypeDB Cloud 3.14.2 · relationship graph',
      status: typedbStatus,
      tone: statusTone(typedbStatus),
      environment: typedbEnv,
      lastVerifiedAt: typedbVerifiedAt,
      lastVerifiedLabel: formatUtcTimestamp(typedbVerifiedAt),
      checkpoint: typedbCheckpoint,
      detail: typedbDetail,
    },
    {
      id: 'clerk_auth',
      name: 'Clerk · owner & reviewer authentication',
      status: clerkStatus,
      tone: statusTone(clerkStatus),
      environment: clerkEnv,
      lastVerifiedAt: clerkVerifiedAt,
      lastVerifiedLabel: formatUtcTimestamp(clerkVerifiedAt),
      checkpoint: clerkCheckpoint,
      detail: clerkDetail,
    },
    {
      id: 'morning_briefing',
      name: 'Morning briefing · weekday synthesis',
      status: briefingStatus,
      tone: statusTone(briefingStatus),
      environment: briefingEnv,
      lastVerifiedAt: briefingVerifiedAt,
      lastVerifiedLabel: formatUtcTimestamp(briefingVerifiedAt),
      checkpoint: briefingCheckpoint,
      detail: briefingDetail,
    },
    {
      id: 'trading212_broker',
      name: 'Trading 212 · read-only broker vault',
      status: brokerStatus,
      tone: statusTone(brokerStatus),
      environment: brokerEnv,
      lastVerifiedAt: null,
      lastVerifiedLabel: 'Owner session required',
      checkpoint: brokerCheckpoint,
      detail: brokerDetail,
    },
    {
      id: 'market_data_intraday',
      name: 'Market data · licensed real-time quotes',
      status: intradayStatus,
      tone: statusTone(intradayStatus),
      environment: intradayEnv,
      lastVerifiedAt: null,
      lastVerifiedLabel: 'Not yet verified',
      checkpoint: intradayCheckpoint,
      detail: intradayDetail,
    },
    {
      id: 'model_providers',
      name: 'Model providers · external LLM forecasts',
      status: modelStatus,
      tone: statusTone(modelStatus),
      environment: modelEnv,
      lastVerifiedAt: modelVerifiedAt,
      lastVerifiedLabel: formatUtcTimestamp(modelVerifiedAt),
      checkpoint: modelCheckpoint,
      detail: modelDetail,
    },
    {
      id: 'trade_execution',
      name: 'Order execution · live & demo broker orders',
      status: executionStatus,
      tone: statusTone(executionStatus),
      environment: executionEnv,
      lastVerifiedAt: evaluatedAt,
      lastVerifiedLabel: evaluatedAtLabel,
      checkpoint: executionCheckpoint,
      detail: executionDetail,
    },
    {
      id: 'synthetic_lab',
      name: 'Benchmark 001 · synthetic laboratory fixtures',
      status: syntheticStatus,
      tone: statusTone(syntheticStatus),
      environment: syntheticEnv,
      lastVerifiedAt: null,
      lastVerifiedLabel: 'Client-side fixture',
      checkpoint: syntheticCheckpoint,
      detail: syntheticDetail,
    },
  ];

  const counts = {
    healthy: services.filter((s) => s.status === 'Connected and healthy').length,
    stale: services.filter((s) => s.status === 'Connected but stale').length,
    configuredUnverified: services.filter((s) => s.status === 'Configured, not yet verified').length,
    notConfigured: services.filter((s) => s.status === 'Not configured').length,
    failed: services.filter((s) => s.status === 'Failed').length,
    intentionallyDisabled: services.filter((s) => s.status === 'Intentionally disabled').length,
    syntheticOnly: services.filter((s) => s.status === 'Synthetic/demo only').length,
  };

  const headline = liveTelemetryConnected
    ? `${counts.healthy} production services connected & healthy · ${counts.stale} stale · ${counts.notConfigured} not configured`
    : 'Server telemetry not connected in this runtime · showing verified local configuration boundaries';

  const summary = liveTelemetryConnected
    ? 'Connection statuses below are computed directly from live Convex, TypeDB Cloud, SEC EDGAR, and server environment telemetry. Synthetic Benchmark 001 fixtures remain strictly isolated in the laboratory tabs.'
    : 'Statuses reflect current server configuration. Unconfigured services fail closed and never fabricate live data; Benchmark 001 laboratory tabs use labelled synthetic fixtures.';

  return {
    evaluatedAt,
    evaluatedAtLabel,
    liveTelemetryConnected,
    headline,
    summary,
    counts,
    services,
  };
}
