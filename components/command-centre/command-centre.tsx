'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import type {BrokerSyncSnapshot} from '../../lib/brokers/contracts';
import {accountKpis,aiSectorExposure,concentration,freshness,maxDrawdown,performance,type CashFlow,type Position,type Snapshot,type Valuation,type Value} from '../../lib/portfolio/performance';
import type {ResearchFeed} from '../../lib/portfolio/research-feed';
import type {MorningBriefingRecord} from '../../lib/remote-ops/contracts';
import type {CollectionHealthReport} from '../../lib/remote-ops/health-monitor';
import type {MissingEvidenceResolverReport} from '../../lib/market-data/missing-evidence-resolver';
import type {ForwardResearchEventRecord} from '../../lib/market-data/forward-research';
import {KpiCard,KpiStrip} from './kpi-card';
import {PerformanceChart} from './performance-chart';
import {HoldingsPanel,WatchlistPanel} from './holdings-panel';
import {RiskPanel,type ExecutionState} from './risk-panel';
import {AlertsCentre,type Alert} from './alerts-centre';
import {ResearchIntel} from './research-intel';
import {AgentOperationsPanel} from './agent-operations-panel';
import {MorningBriefPanel} from './morning-brief-panel';
import {ExecutiveOverviewSections} from './executive-overview';
import {DataBadge,age,iso,money,pct,signedMoney} from './shared';
import {BrokerSyncStatus,type SyncConnection,type SyncSchedule} from '../broker-sync-status';

export type EnvData={connection:null|SyncConnection;schedule?:SyncSchedule|null;snapshot:BrokerSyncSnapshot|null;valuations:Valuation[];flows:CashFlow[]};
export type PortfolioData={live:EnvData;demo:EnvData};
export type TradingOverview={liveKillSwitchEngaged:boolean;reviewer:boolean;orders:{state:string}[]};
export type OperationsOverview={
 health:CollectionHealthReport;
 latestBriefing:MorningBriefingRecord|null;
 missingEvidenceResolution?:MissingEvidenceResolverReport;
 forwardResearchEvents?:ForwardResearchEventRecord[];
};

export function toSnapshot(s:BrokerSyncSnapshot|null):Snapshot|null{
 if(!s)return null;const d=s.summary.data;
 const positions:Position[]|null=s.positions?s.positions.data.map(p=>{const same=p.walletImpact.currency===null||p.walletImpact.currency===d.currency;return {ticker:p.instrument.ticker,name:p.instrument.name||p.instrument.ticker,currency:p.instrument.currency,quantity:p.quantity,currentPrice:p.currentPrice,averagePricePaid:p.averagePricePaid,valueAccount:same?p.walletImpact.currentValue:null,costAccount:same?p.walletImpact.totalCost:null,unrealisedAccount:same?p.walletImpact.unrealizedProfitLoss:null};}):null;
 return {currency:d.currency,totalValue:d.totalValue,cash:d.cash.availableToTrade,investedCost:d.investments.totalCost,investmentsValue:d.investments.currentValue,realised:d.investments.realizedProfitLoss,unrealised:d.investments.unrealizedProfitLoss,summaryAt:s.summary.retrievedAt,positions,positionsAt:s.positions?.retrievedAt??null,source:s.summary.sourceUrl};
}

const LINKS=[{href:'/portfolio',label:'Portfolio Risk & Capital Preservation'},{href:'/trading',label:'Trading workspace'},{href:'/recovery',label:'Case 006 · AI Market Recovery'},{href:'/policy-risk',label:'Benchmark 001.2 · Midterm infrastructure risk'},{href:'/consensus',label:'Analyst consensus validation'},{href:'/proof-scale',label:'Proof & Scale'},{href:'/stress',label:'Market Stress Monitor'},{href:'/earnings',label:'Alphabet earnings case'},{href:'/earnings/amazon',label:'Amazon cash conversion'},{href:'/infrastructure',label:'Infrastructure financing'},{href:'/defence',label:'Portfolio defence'},{href:'/settings/brokers',label:'Broker connections'}];
const BROKER='/settings/brokers',FIX_SYNC={href:BROKER,label:'Synchronise on Broker Connections'};

/** Secondary sections collapse on narrow screens; risk warnings and the risk panel never do. */
function useWide(){const[wide,setWide]=useState(true);useEffect(()=>{const m=window.matchMedia('(min-width: 768px)');const on=()=>setWide(m.matches);on();m.addEventListener('change',on);return ()=>m.removeEventListener('change',on);},[]);return wide;}
function Collapsible({title,testId,children,wide}:{title:string;testId:string;children:React.ReactNode;wide:boolean}){return <details className="cc-collapsible" data-testid={testId} open={wide||undefined} key={wide?'w':'n'}><summary>{title}</summary>{children}</details>;}

/**
 * Investment-first command centre. Presentational: receives broker data (or null when signed out / not configured),
 * trading overview, research feed and server execution flags, and never writes anything. With `fixtureLabel` it renders
 * a visibly different synthetic-fixture style so development fixtures can never pass for real account figures.
 */
export function CommandCentre({portfolio,trading,operations,feed,flags,now,signedIn,configured,fixtureLabel,onSync,onToggleJob}:{portfolio:PortfolioData|null;trading:TradingOverview|null;operations?:OperationsOverview|null;feed:ResearchFeed;flags:{demo:boolean;live:boolean};now:number;signedIn:boolean;configured:boolean;fixtureLabel?:string;onSync?:(env:'live'|'demo',connectionId:string)=>Promise<string>;onToggleJob?:(jobKey:string,enabled:boolean)=>Promise<void>}){
 const fixture=Boolean(fixtureLabel),wide=useWide(),provider=fixture?'Synthetic fixture':'Trading 212';
 const hasDemo=Boolean(portfolio?.demo.snapshot),[env,setEnv]=useState<'live'|'demo'>('live');
 const data=portfolio?portfolio[env]:null,snap=toSnapshot(data?.snapshot??null),kpis=accountKpis(snap,data?.valuations??[],data?.flows??[],now,provider);
 const currency=snap?.currency??'GBP',fresh=freshness(snap?.summaryAt??null,now),posFresh=freshness(snap?.positionsAt??null,now);
 const all=data?performance(data.valuations,data.flows,currency,'All',now):null;
 const orders=trading?.orders??null,count=(states:string[])=>orders?orders.filter(o=>states.includes(o.state)).length:null;
 const execution:ExecutionState={demoFlag:flags.demo,liveFlag:flags.live,liveKillSwitchEngaged:trading?.liveKillSwitchEngaged??null,reviewer:trading?.reviewer??null};
 const deposits=(data?.flows??[]).filter(f=>f.amount>0).reduce((a,f)=>a+f.amount,0);
 const accountKind=fixture?'synthetic' as const:env;
 const missingPrices=feed.watchlist.filter(w=>w.close===null).map(w=>w.ticker);
 const activeHealth=operations?.health??feed.agentOperations;
 const activeBriefing=operations?.latestBriefing??feed.morningBriefing;
 const alerts:Alert[]=[
  ...(!configured?[{id:'cfg',tone:'warn' as const,title:'Accounts not configured.',detail:'Clerk, Convex and the broker vault are required to show your account.',href:BROKER,hrefLabel:'Broker setup'}]:!signedIn?[{id:'signin',tone:'info' as const,title:'Signed out.',detail:'Sign in to load your Trading 212 account.'}]:[]),
  ...(signedIn&&!data?.connection?[{id:'noconn',tone:'warn' as const,title:'No broker connection.',detail:`No ${env} Trading 212 connection saved.`,href:BROKER,hrefLabel:'Connect Trading 212'}]:[]),
  ...(snap&&fresh.state==='stale'?[{id:'stale',tone:'warn' as const,title:'Account data is stale.',detail:`Last account summary ${age(fresh.ageMs)}.`,href:BROKER,hrefLabel:'Synchronise now'}]:[]),
  ...(snap&&snap.positions===null?[{id:'nopos',tone:'warn' as const,title:'Holdings not synchronised.',detail:'Only a connection test has run.',href:BROKER,hrefLabel:'Run a full synchronisation'}]:[]),
  ...(snap&&all&&all.series.length<2?[{id:'history',tone:'info' as const,title:'No performance history yet.',detail:`${all.observations} stored valuation(s); returns need at least two syncs over time.`,href:BROKER,hrefLabel:'Synchronise on Broker Connections'}]:[]),
  ...((count(['reviewed'])??0)>0?[{id:'approvals',tone:'alert' as const,title:'Approvals waiting.',detail:`${count(['reviewed'])} order proposal(s) await review.`,href:'/trading#orders',hrefLabel:'Review'}]:[]),
  ...((count(['unknown','submitting'])??0)>0?[{id:'unknown',tone:'alert' as const,title:'Order outcome unknown.',detail:'It will not be re-sent.',href:'/trading#orders',hrefLabel:'Reconcile against Trading 212'}]:[]),
  ...(activeHealth.alerts.map(a=>({id:a.id,tone:a.severity,title:a.title,detail:a.detail,href:a.href,hrefLabel:'Inspect'}))),
  {id:'market',tone:'info',title:'Market data is delayed.',detail:`Watchlist prices are public reference closes as of ${iso(feed.marketDataAsOf)}; no licensed real-time feed is connected${missingPrices.length?`; no price for ${missingPrices.join(', ')}`:''}.`,href:'/policy-risk#sources',hrefLabel:'View price evidence'},
  {id:'exec',tone:flags.live?'alert':'info',title:`Live submission ${flags.live?'ENABLED':'disabled'}.`,detail:`Demo submission ${flags.demo?'enabled':'disabled'}. This page cannot change trading permissions.`,href:'/trading#controls',hrefLabel:'Trading controls'},
 ];
 const syncValue:Value=data?.connection?.lastSuccessfulSyncAt?{ok:true,value:data.connection.lastSuccessfulSyncAt,source:`${provider} full synchronisation`,observedAt:data.connection.lastSuccessfulSyncAt}:{ok:false,reason:'No full synchronisation yet'};
 const ownedTickers=(snap?.positions??[]).filter(p=>(p.quantity??0)>0).map(p=>p.ticker);
 const hasPerformanceSeries=Boolean(all&&all.series.length>=2);
 const portfolioSnapshotSection=(
  <section className="cc-account cc-panel g6-portfolio-snapshot" aria-labelledby="account-title" data-testid="portfolio-snapshot">
   <header className="cc-account-head">
    <div>
     <div className="g6-eyebrow-row">
      <span className="g6-section-tag">SECTION B · PORTFOLIO SNAPSHOT</span>
      <span className="g6-meta-pill">Execution: Read-Only (Live {flags.live?'enabled':'disabled'} · Demo {flags.demo?'enabled':'disabled'})</span>
      <span className="g6-meta-pill" data-testid="broker-last-sync-pill">Last Broker Sync: {snap?.summaryAt?`${iso(snap.summaryAt)} (${age(fresh.ageMs)})`:data?.connection?.lastSuccessfulSyncAt?`${iso(data.connection.lastSuccessfulSyncAt)}`:signedIn?'Not yet synchronised':'Signed out (no broker data loaded)'}</span>
     </div>
     <h1 id="account-title">Portfolio command centre</h1>
     <p>{snap?<>Source: {fixture?'synthetic fixture (not Trading 212)':`Trading 212 · ${env==='live'?'Live account (read-only)':'Demo account'}`} · summary {iso(snap.summaryAt)} <span className={`cc-fresh cc-${fresh.state}`} data-testid="freshness">{fresh.state==='stale'?`Stale · ${age(fresh.ageMs)}`:`Fresh · ${age(fresh.ageMs)}`}</span></>:configured?signedIn?'No synchronised Trading 212 account yet.':'Sign in to load your Trading 212 account.':'Account integration not configured.'}</p>
    </div>
    <div className="cc-account-tools">{snap&&<DataBadge kind={accountKind}/>}{hasDemo&&<div role="radiogroup" aria-label="Account" className="cc-segment"><button role="radio" aria-checked={env==='live'} onClick={()=>setEnv('live')}>Live</button><button role="radio" aria-checked={env==='demo'} onClick={()=>setEnv('demo')}>Demo</button></div>}</div>
   </header>
   {kpis?<>
    <div className="cc-kpis cc-kpis-primary" data-testid="kpi-strip">
     <KpiCard emphasis label="Total account value" value={kpis.totalValue} format={v=>money(v,currency)} testId="kpi-total" fix={FIX_SYNC}/>
     <KpiCard label="Today's investment P/L" value={kpis.todayPnl} format={v=>signedMoney(v,currency)} tone={v=>v>0?'up':v<0?'down':'flat'} testId="kpi-today" fix={FIX_SYNC}/>
     <KpiCard label="Cumulative investment P/L" value={kpis.cumulativePnl} format={v=>signedMoney(v,currency)} tone={v=>v>0?'up':v<0?'down':'flat'} testId="kpi-pnl" fix={FIX_SYNC}/>
     <KpiCard label="Portfolio return" value={kpis.returnPct} format={v=>pct(v)} tone={v=>v>0?'up':v<0?'down':'flat'} testId="kpi-return"/>
    </div>
    <KpiStrip testId="kpi-secondary" items={[
     {label:'Available cash',value:kpis.cash,format:(v:number)=>money(v,currency),fix:FIX_SYNC},
     {label:'Amount invested',value:kpis.invested,format:(v:number)=>money(v,currency),fix:FIX_SYNC},
     {label:'Open positions',value:kpis.openPositions,format:(v:number)=>String(v),fix:FIX_SYNC},
     {label:'Last full sync',value:syncValue,format:(v:number)=>age(now-v),fix:FIX_SYNC},
    ] as never}/>
   </>:<div className="cc-empty cc-kpis-empty" data-testid="kpi-empty"><strong>{configured?signedIn?'No account data yet':'Signed out':'Not configured'}</strong><p>{configured?signedIn?'Connect and synchronise Trading 212 (read-only).':'Sign in to see capital, P/L and cash. Nothing is estimated in the meantime.':'Configure Clerk, Convex and the broker vault.'}</p>{configured&&signedIn&&<Link className="cc-fix" href={BROKER}>Connect Trading 212 →</Link>}</div>}
   {snap&&deposits>0&&<p className="cc-note" data-testid="deposit-note">Deposits recorded: {money(deposits,currency)}. Deposits and withdrawals are external cash flows and are never counted as investment profit.</p>}
   <details className="g6-drawer-details" data-testid="expanded-portfolio-drawer" open={hasPerformanceSeries||undefined}>
    <summary className="g6-drawer-summary">
     <span>Expanded Portfolio View — Performance Chart, Holdings, Broker Sync &amp; Risk Diagnostics</span>
     <small>{hasPerformanceSeries?`${all?.series.length??0} valuation points plotted`:'Collapsed by default until ≥2 broker valuation points are recorded'}</small>
    </summary>
    <div className="g6-drawer-body">
     {data?.connection&&<details className="cc-sync" data-testid="cc-sync" open={wide||undefined} key={wide?'w':'n'}><summary>Broker connection and refresh</summary><BrokerSyncStatus compact environment={env} connection={data.connection} schedule={data.schedule??null} now={now} dataAt={snap?.summaryAt??null} onSync={onSync&&data.connection?()=>onSync(env,data.connection!.connectionId):undefined}/></details>}
     <PerformanceChart valuations={data?.valuations??[]} flows={data?.flows??[]} currency={currency} now={now} benchmarks={feed.benchmarks} fixHref={BROKER} compact={!wide} provider={provider}/>
     <div className="cc-two">
      <div className="cc-col">{snap?<HoldingsPanel positions={snap.positions} accountCurrency={currency} observedAt={snap.positionsAt} stale={posFresh.state==='stale'} kind={accountKind} provider={provider}/>:<section className="cc-panel" data-testid="holdings-panel"><header className="cc-panel-head"><div><h2>Holdings</h2><p>Owned positions from Trading 212</p></div></header><div className="cc-empty"><strong>No broker positions loaded</strong><p>Nothing is shown as owned until Trading 212 reports it.</p>{signedIn&&<Link className="cc-fix" href={BROKER}>Synchronise on Broker Connections →</Link>}</div></section>}</div>
      <div className="cc-col"><RiskPanel concentration={concentration(snap?.positions??null,snap?.totalValue??null)} aiExposure={aiSectorExposure(snap?.positions??null,snap?.totalValue??null,feed.aiTickers)} maxDrawdown={all?maxDrawdown(all.series):{ok:false,reason:'No account history'}} pendingApprovals={count(['reviewed'])} awaitingConfirmation={count(['approved','confirmed'])} unknownOrders={count(['unknown','submitting'])} evidence={feed.evidence} marketDataAsOf={feed.marketDataAsOf} broker={{status:data?.connection?.status??null,lastSyncAt:data?.connection?.lastSuccessfulSyncAt??null,errorCode:data?.connection?.lastErrorCode??null}} execution={execution} now={now}/></div>
     </div>
    </div>
   </details>
  </section>
 );
 return <div className={`cc-root ${fixture?'cc-fixture-mode':''}`} data-testid="command-centre" data-source={fixture?'synthetic-fixture':'broker'}>
  {fixtureLabel&&<p className="cc-fixture" role="note">{fixtureLabel}</p>}
  <AlertsCentre alerts={alerts} links={LINKS}/>
  <ExecutiveOverviewSections watchlist={feed.watchlist} ownedTickers={ownedTickers} now={now} portfolioSnapshotSlot={portfolioSnapshotSection}/>
  <details className="g6-drawer-details" data-testid="technical-evidence-details">
   <summary className="g6-drawer-summary">
    <span>Technical, Operations &amp; Evidence Audit Details (Agent Operations, Morning Brief, Watchlist &amp; Data Boundaries)</span>
    <small>Secondary audit &amp; ingestion telemetry</small>
   </summary>
   <div className="g6-drawer-body">
    <Collapsible title="Morning intelligence brief" testId="brief-collapsible" wide={wide}><MorningBriefPanel briefing={activeBriefing} fixture={fixture}/></Collapsible>
    <Collapsible title="Agent operations & collection health" testId="ops-collapsible" wide={wide}><AgentOperationsPanel health={activeHealth} now={now} fixture={fixture} onToggleJob={onToggleJob}/></Collapsible>
    <Collapsible title="Research intelligence" testId="intel-collapsible" wide={wide}><ResearchIntel events={feed.events} forwardPredictions={operations?.forwardResearchEvents?.length??feed.forwardPredictions} missingEvidenceResolution={operations?.missingEvidenceResolution??feed.missingEvidenceResolution} forwardResearchEvents={operations?.forwardResearchEvents??feed.forwardResearchEvents}/></Collapsible>
    <Collapsible title="Research watchlist (delayed public reference prices)" testId="watch-collapsible" wide={wide}><WatchlistPanel items={feed.watchlist} now={now} ownedTickers={ownedTickers}/></Collapsible>
    <Collapsible title="Data boundaries" testId="bound-collapsible" wide={wide}><section className="cc-panel cc-boundaries" aria-labelledby="bound-title"><header className="cc-panel-head"><div><h2 id="bound-title">Data boundaries</h2><p>Real and simulated results are never combined.</p></div></header><ul>
     <li><DataBadge kind="live"/> Actual orders, positions and cash. Trading 212 is authoritative.</li><li><DataBadge kind="demo"/> Trading 212 practice account; never added to Live figures.</li><li><DataBadge kind="paper"/> Internal paper ledger (Paper Trading module); never mixed with broker P/L.</li><li><DataBadge kind="synthetic"/> Illustrative examples and development fixtures only.</li><li><DataBadge kind="retrospective"/> Cases registered after the event; not predictions.</li><li><DataBadge kind="forward"/> Registered before the outcome; {(operations?.forwardResearchEvents?.length??feed.forwardPredictions)>0?`${operations?.forwardResearchEvents?.length??feed.forwardPredictions} active`:'none yet'}.</li></ul></section></Collapsible>
   </div>
  </details>
 </div>;
}
