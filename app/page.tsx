import Dashboard from "../components/dashboard";
import ConnectedCommandCentre,{UnconfiguredCommandCentre} from "../integrations/connected-command-centre";
import {researchFeed} from "../lib/portfolio/research-feed";
import {fetchLiveOperationsOverview} from "../lib/remote-ops/server";
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
  const feed=liveOps?{
    ...baseFeed,
    watchlist:updatedWatchlist,
    marketDataAsOf:latestMarketAt,
    agentOperations:liveOps.health,
    ...(liveOps.latestBriefing?{morningBriefing:liveOps.latestBriefing}:{}),
    ...(liveOps.missingEvidenceResolution?{missingEvidenceResolution:liveOps.missingEvidenceResolution}:{}),
    ...(forwardEvents?{forwardResearchEvents:forwardEvents,forwardPredictions:forwardEvents.length}:{}),
  }:baseFeed;
  return <Dashboard commandCentre={configured?<ConnectedCommandCentre feed={feed} flags={flags}/>:<UnconfiguredCommandCentre feed={feed} flags={flags}/>}/>;
}
