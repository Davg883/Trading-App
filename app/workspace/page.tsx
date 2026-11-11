import Link from 'next/link';
import ConnectedWorkspace from '../../integrations/connected-workspace';
import { verifyBrokerVaultSelfTest } from '../../lib/brokers/vault';
import {
  checkGeminiProviderAvailability,
  resolveGeminiApiKey,
} from '../../lib/graph/gemini-provider-adapter';
import { fetchLiveOperationsOverview } from '../../lib/remote-ops/server';
import { executionPermitted } from '../../lib/trading/execution-boundary';
import { buildWorkspaceConnectionsReport } from '../../lib/remote-ops/workspace-connections';

export const dynamic = 'force-dynamic';

export default async function WorkspacePage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
  const liveOps = await fetchLiveOperationsOverview();
  const vaultSelfTest = verifyBrokerVaultSelfTest();
  const vaultReady = vaultSelfTest.ready;
  const hasGeminiKey = Boolean(resolveGeminiApiKey(process.env).apiKey);
  const geminiStatus = hasGeminiKey
    ? await checkGeminiProviderAvailability({ verifyEndpoint: true, timeoutMs: 5_000 })
    : null;
  const modelProviderConfigured = Boolean(
    hasGeminiKey || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY,
  );
  const hasProviderErrors = (liveOps?.health.evidenceChat?.providerErrorCount ?? 0) > 0;
  const reconciledLiveOps =
    liveOps && geminiStatus?.status === 'connected'
      ? {
          ...liveOps,
          health: {
            ...liveOps.health,
            environmentAudit: liveOps.health.environmentAudit?.map((svc) =>
              svc.serviceId === 'remote_ai_models' && svc.status !== 'connected'
                ? {
                    ...svc,
                    status: hasProviderErrors
                      ? ('degraded' as const)
                      : ('configured_not_tested' as const),
                    lastVerifiedAt: Date.now(),
                    detail: hasProviderErrors
                      ? `${geminiStatus.detail} Live generateContent returned HTTP 402 (RESOURCE_EXHAUSTED: Google AI Studio prepayment credits depleted); explicit safe abstention enforced.`
                      : `${geminiStatus.detail} Awaiting first verified live generateContent response.`,
                  }
                : svc,
            ),
          },
        }
      : liveOps;
  const report = buildWorkspaceConnectionsReport({
    liveOps: reconciledLiveOps,
    convexUrlConfigured: Boolean(process.env.NEXT_PUBLIC_CONVEX_URL),
    convexIsProduction: Boolean(process.env.NEXT_PUBLIC_CONVEX_URL?.includes('benevolent-magpie-921')),
    authenticationConfigured: configured,
    clerkIsProduction: Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith('pk_live_')),
    secUserAgentConfigured: Boolean(process.env.SEC_USER_AGENT),
    typedbConfigured: Boolean(process.env.TYPEDB_HTTP_ADDRESS && process.env.TYPEDB_DATABASE),
    typedbDatabase: process.env.TYPEDB_DATABASE ?? null,
    licensedMarketDataConfigured: Boolean(process.env.LICENSED_MARKET_DATA_API_KEY),
    modelProviderConfigured,
    brokerVaultKeyConfigured: vaultReady,
    brokerStorageConfigured: Boolean(configured && vaultReady),
    liveTradingEnabled: executionPermitted() && process.env.LIVE_TRADING_ENABLED === 'true',
    demoTradingEnabled: executionPermitted() && process.env.DEMO_TRADING_ENABLED === 'true',
  });
  return <main style={{maxWidth:1100,margin:'40px auto',padding:24}}>
    <Link href="/">← Back to research demo</Link>
    <h1>Connected research workspace</h1>
    <p>Authenticated, private Convex records. This workspace contains no preloaded market observations.</p>
    {configured ? <ConnectedWorkspace/> : <section style={{padding:24,border:'1px solid #344047',borderRadius:16,marginTop:24}}>
      <h2>Ready for your connections</h2>
      <p>The interactive synthetic laboratory is available now. To enable persistent private records, configure Convex and Clerk using the project README.</p>
      <ul><li>NEXT_PUBLIC_CONVEX_URL</li><li>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</li><li>CLERK_SECRET_KEY</li><li>CLERK_JWT_ISSUER_DOMAIN in Convex</li></ul>
      <p>Provider ingestion and model runs require their own credentials and setup. Adding a key does not import data automatically.</p>
    </section>}
    <section data-testid="workspace-page-connections" style={{padding:24,border:'1px solid #344047',borderRadius:16,marginTop:24}}>
      <h2>Service connection matrix ({report.liveTelemetryConnected ? 'Live cloud telemetry' : 'Server configuration audit'})</h2>
      <p>{report.headline}. {report.summary}</p>
      <div style={{display:'grid',gap:12,marginTop:16}}>
        {report.services.map(s => (
          <article key={s.id} data-testid={`workspace-page-conn-${s.id}`} style={{padding:14,border:'1px solid rgba(148,163,184,0.22)',borderRadius:10}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
              <strong>{s.name} <span>[{s.environment}]</span></strong>
              <span style={{color:s.tone==='green'?'#4ade80':s.tone==='red'?'#f87171':'#fbbf24',fontWeight:600}}>{s.status}</span>
            </div>
            <div style={{fontSize:13,opacity:0.85,marginTop:4}}>
              Last verified: {s.lastVerifiedLabel} · Checkpoint: {s.checkpoint}
            </div>
            <p style={{margin:'6px 0 0 0',fontSize:13,opacity:0.8}}>{s.detail}</p>
          </article>
        ))}
      </div>
    </section>
  </main>;
}
