import Dashboard from "../components/dashboard";
import ConnectedCommandCentre,{UnconfiguredCommandCentre} from "../integrations/connected-command-centre";
import {verifyBrokerVaultSelfTest} from "../lib/brokers/vault";
import {resolveGeminiApiKey} from "../lib/graph/gemini-provider-adapter";
import {researchFeed} from "../lib/portfolio/research-feed";
import {fetchLiveOperationsOverview} from "../lib/remote-ops/server";
import {buildWorkspaceConnectionsReport} from "../lib/remote-ops/workspace-connections";
import "./command-centre.css";
import "./broker-sync.css";

export const dynamic="force-dynamic";
export default async function Home(){
  const configured=Boolean(process.env.NEXT_PUBLIC_CONVEX_URL&&process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY&&process.env.CLERK_SECRET_KEY);
  // Display only: the homepage reads the server execution flags and cannot change them.
  const flags={demo:process.env.DEMO_TRADING_ENABLED==="true",live:process.env.LIVE_TRADING_ENABLED==="true"};
  const baseFeed=researchFeed();
  const liveOps=await fetchLiveOperationsOverview();
  const latestMap=new Map((liveOps?.marketData?.latestBySymbol??[]).map(o=>[o.symbol,o]));
  const updatedWatchlist=baseFeed.watchlist.map(w=>{
    const obs=latestMap.get(w.ticker as never);
    if(!obs)return w;
    return {
      ...w,
      close:obs.close,
      closeGbp:obs.closeGbp,
      usdToGbp:obs.usdToGbp,
      closeAt:obs.eventAt,
      priceBasis:obs.priceBasis,
      corporateActionsReviewed:obs.corporateActionsReviewed,
      source:obs.sourceUrl,
    };
  });
  const latestMarketAt=(liveOps?.marketData?.latestBySymbol??[]).reduce((max,o)=>Math.max(max,o.eventAt),baseFeed.marketDataAsOf??0);
  const forwardEvents=liveOps?.forwardResearchEvents??baseFeed.forwardResearchEvents;
  const vaultSelfTest=verifyBrokerVaultSelfTest();
  const brokerStorageReady=Boolean(configured&&vaultSelfTest.selfTestPassed);
  const hasGeminiKey=Boolean(resolveGeminiApiKey(process.env).apiKey);
  const modelProviderConfigured=Boolean(hasGeminiKey||process.env.OPENAI_API_KEY||process.env.ANTHROPIC_API_KEY);
  const reconciledHealth=liveOps?.health?{
    ...liveOps.health,
    environmentAudit:liveOps.health.environmentAudit?.map(svc=>{
      if(svc.serviceId==="trading212_readonly"&&svc.status!=="connected"){
        return {
          ...svc,
          status:brokerStorageReady?"configured_not_tested" as const:"unavailable" as const,
          detail:brokerStorageReady
            ?`${vaultSelfTest.reason} Save Credentials enabled for the authenticated owner on /settings/brokers.`
            :`${vaultSelfTest.reason} Saving, testing and synchronisation remain disabled on /settings/brokers until the server vault is configured.`,
        };
      }
      if(svc.serviceId==="remote_ai_models"&&svc.status!=="connected"&&modelProviderConfigured){
        return {
          ...svc,
          status:"connected" as const,
          lastVerifiedAt:Date.now(),
          detail:"Google Gemini API key configured in Vercel Production server runtime (gemini-2.5-flash).",
        };
      }
      return svc;
    }),
  }:undefined;
  const feed=liveOps&&reconciledHealth?{
    ...baseFeed,
    watchlist:updatedWatchlist,
    marketDataAsOf:latestMarketAt,
    agentOperations:reconciledHealth,
    ...(liveOps.latestBriefing?{morningBriefing:liveOps.latestBriefing}:{}),
    ...(liveOps.missingEvidenceResolution?{missingEvidenceResolution:liveOps.missingEvidenceResolution}:{}),
    ...(forwardEvents?{forwardResearchEvents:forwardEvents,forwardPredictions:forwardEvents.length}:{}),
  }:baseFeed;
  const workspaceConnections=buildWorkspaceConnectionsReport({
    liveOps:liveOps&&reconciledHealth?{...liveOps,health:reconciledHealth}:liveOps,
    convexUrlConfigured:Boolean(process.env.NEXT_PUBLIC_CONVEX_URL),
    convexIsProduction:Boolean(process.env.NEXT_PUBLIC_CONVEX_URL?.includes("benevolent-magpie-921")),
    authenticationConfigured:configured,
    clerkIsProduction:Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_live_")),
    secUserAgentConfigured:Boolean(process.env.SEC_USER_AGENT),
    typedbConfigured:Boolean(process.env.TYPEDB_HTTP_ADDRESS&&process.env.TYPEDB_DATABASE),
    typedbDatabase:process.env.TYPEDB_DATABASE??null,
    licensedMarketDataConfigured:Boolean(process.env.LICENSED_MARKET_DATA_API_KEY),
    modelProviderConfigured,
    brokerVaultKeyConfigured:vaultSelfTest.selfTestPassed,
    brokerStorageConfigured:brokerStorageReady,
    liveTradingEnabled:flags.live,
    demoTradingEnabled:flags.demo,
  });
  return <Dashboard commandCentre={configured?<ConnectedCommandCentre feed={feed} flags={flags}/>:<UnconfiguredCommandCentre feed={feed} flags={flags}/>} workspaceConnections={workspaceConnections}/>;
}
