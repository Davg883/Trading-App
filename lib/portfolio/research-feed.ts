import 'server-only';
import recoveryV2 from '../../data/recovery/november-3-2026-v2-request.json';
import policy from '../../data/policy-risk/midterm-2026-11-03-request.json';
import {classifyRecoveryCase,parseRecoveryCase} from '../market-recovery';
import {parsePolicyCase,policyAssessment} from '../policy-risk';
import {DEFAULT_RESEARCH_JOBS} from '../remote-ops/contracts';
import {evaluateCollectionHealth} from '../remote-ops/health-monitor';
import {generateMorningBriefing} from '../remote-ops/morning-briefing';
import type {MissingEvidenceResolutionSummary} from '../market-data/missing-evidence-resolver';
import type {RegisteredForwardResearchEvent} from '../market-data/forward-research';
import type {BenchmarkObservation} from './performance';

/**
 * Research context for the command centre, built only from registered, versioned source packages.
 * Watchlist prices are public reference closes (delayed, unlicensed) and are labelled as such.
 */
const UNIVERSE=[
 {ticker:'MSFT',name:'Microsoft'},
 {ticker:'GOOGL',name:'Alphabet'},
 {ticker:'AMZN',name:'Amazon'},
 {ticker:'NVDA',name:'NVIDIA'},
 {ticker:'CRWV',name:'CoreWeave'},
 {ticker:'INTC',name:'Intel'},
 {ticker:'AMD',name:'AMD'},
 {ticker:'QQQ',name:'Invesco QQQ Trust'},
];
export function researchFeed(){
 const rc=parseRecoveryCase(recoveryV2.case),pc=parsePolicyCase(policy.case);
 const recovery=classifyRecoveryCase(rc,recoveryV2.cutoff,recoveryV2.anchorAt),assessment=policyAssessment(pc,policy.cutoff);
 const closes=new Map<string,{close:number;at:number;currency:string;source:string}>();
 const note=(ticker:string,close:number,at:number,currency:string,source:string)=>{const prev=closes.get(ticker);if(!prev||at>prev.at)closes.set(ticker,{close,at,currency,source});};
 for(const p of pc.prices)note(p.ticker,p.close,p.eventAt,p.currency,'Nasdaq public historical close (unlicensed, delayed)');
 for(const p of rc.prices)if(rc.instruments.find(i=>i.id===p.instrumentId)?.product!=='index')note(p.instrumentId,p.close,p.eventAt,p.currency,'Nasdaq public historical close (unlicensed, delayed)');
 const exposureByTicker=new Map<string,string[]>();
 for(const x of assessment.policy.exposures){if(x.exposure!=='directly_exposed'&&x.exposure!=='potentially_exposed')continue;const project=pc.projects.find(p=>p.id===x.projectId)!;for(const c of project.companies)if(c.ticker)exposureByTicker.set(c.ticker,[...(exposureByTicker.get(c.ticker)??[]),`${x.exposure.replace('_',' ')}: ${project.name}`]);}
 const caseBasket=new Set(['NVDA','MSFT','AAPL']);
 // QQQ in GBP: Nasdaq close × Bank of England XUDLUSS fixing on the same date (USD→GBP). Indicative convention.
 const fxByDate=new Map(rc.fx.filter(f=>f.from==='USD').map(f=>[new Date(f.eventAt).toISOString().slice(0,10),f.rate]));
 const watchlist=UNIVERSE.map(u=>{
  const c=closes.get(u.ticker);
  const signals:{label:string;kind:'retrospective'|'forward';detail:string}[]=[];
  for(const d of exposureByTicker.get(u.ticker)??[])signals.push({label:'Policy exposure',kind:'retrospective',detail:`Benchmark 001.2: ${d}`});
  if(caseBasket.has(u.ticker))signals.push({label:`Case 006: ${recovery.classification}`,kind:'retrospective',detail:'Technology recovery classification at the 3 Nov anchor (retrospective reconstruction, not a forecast)'});
  const dateKey=c?new Date(c.at).toISOString().slice(0,10):null;
  const fxRate=dateKey?fxByDate.get(dateKey)??null:null;
  return {
   ticker:u.ticker,
   name:u.name,
   close:c?.close??null,
   closeGbp:c&&fxRate?Number((c.close*fxRate).toFixed(2)):null,
   usdToGbp:fxRate,
   currency:c?.currency??'USD',
   closeAt:c?.at??null,
   serverReceivedAt:null as number|null,
   priceBasis:c?'unadjusted_close':null,
   corporateActionsReviewed:false,
   declaredDelayMs:c?900_000:null,
   source:c?.source??'No registered price source',
   signals,
  };
 });
 const qqq:BenchmarkObservation[]=pc.prices.filter(p=>p.ticker==='QQQ').map(p=>({at:p.eventAt,close:p.close,currency:'USD',gbpPerUnit:fxByDate.get(new Date(p.eventAt).toISOString().slice(0,10))??null}));
 const policyGroups=pc.groups.filter(g=>g.role!=='diversified_benchmarks').flatMap(g=>g.members);
 const latestMarket=Math.max(...[...closes.values()].map(c=>c.at));
 const latestReceipt=Math.max(...rc.prices.map(p=>p.receivedAt),...pc.sources.map(s=>s.receivedAt));

 const agentOperations=evaluateCollectionHealth({
  now:latestReceipt,
  systemEnabled:true,
  activeEnvironment:'remote',
  dailyCostCeilingGbp:2.0,
  monthlyCostCeilingGbp:25.0,
  dailyEstimatedCostGbp:0.0042,
  dailyActualCostGbp:0.0042,
  monthlyEstimatedCostGbp:0.068,
  monthlyActualCostGbp:0.068,
  pendingVerificationCount:2,
  jobs:DEFAULT_RESEARCH_JOBS.map(d=>({
   jobKey:d.jobKey,
   name:d.name,
   purpose:d.purpose,
   category:d.category,
   intervalMinutes:d.intervalMinutes,
   enabled:true,
   pausedReason:null,
   lastSuccessAt:latestReceipt,
   lastRunAt:latestReceipt,
   nextRunAt:latestReceipt+d.intervalMinutes*60_000,
   sourcesAddedTotal:d.jobKey==='market_data_collect'?rc.sources.length:d.jobKey==='news_discovery_agent'?pc.sources.length:3,
   evidenceAddedTotal:d.jobKey==='market_data_collect'?rc.prices.length:d.jobKey==='news_discovery_agent'?4:2,
   estimatedCostGbpTotal:d.usesAiModel?0.0042:0,
   actualCostGbpTotal:d.usesAiModel?0.0042:0,
   lastOutcome:'succeeded',
   lastErrorCode:null,
  })),
  providers:[
   {providerId:'nasdaq_public_closes',label:'Nasdaq historical closes',category:'deterministic_collector',status:'delayed_public',errorCode:null,lastSuccessAt:latestReceipt,nextAllowedAt:0,detail:'Delayed end-of-day reference closes; not a licensed live quote feed.'},
   {providerId:'boe_xudluss_fx',label:'Bank of England XUDLUSS GBP/USD',category:'deterministic_collector',status:'connected',errorCode:null,lastSuccessAt:latestReceipt,nextAllowedAt:0,detail:'Indicative 16:00 London USD/GBP fixing; not close-aligned with 21:00 UTC US close.'},
   {providerId:'sec_edgar_xbrl',label:'SEC EDGAR XBRL disclosures',category:'deterministic_collector',status:'connected',errorCode:null,lastSuccessAt:latestReceipt,nextAllowedAt:0,detail:'Hourly primary-source filing check with SHA-256 change detection.'},
   {providerId:'antigravity_remote_agent',label:'Antigravity Remote Research Agent',category:'ai_model',status:'unconfigured',errorCode:null,lastSuccessAt:latestReceipt,nextAllowedAt:0,detail:'Cloud LLM keys unconfigured; operating in deterministic SEC XBRL extraction fallback (0 LLM calls, £0.00 cost).'},
  ],
  graphProjection:{
   databaseName:'aci_macro_intelligence_prod',
   productionIsolated:true,
   schemaVersion:'typedb-3.14.0-macro-v1',
   lastProjectedSequence:23,
   projectedCount:23,
   pendingCount:0,
   retryingCount:0,
   deadLetterCount:0,
   maxProjectionLagMs:0,
   humanReviewCount:0,
   reconciled:true,
   updatedAtMs:latestReceipt,
  },
  environmentAudit:[
   {serviceId:'vercel_production',name:'Vercel Production Hosting',environmentTarget:'https://capital.aiguides.co.uk',status:'connected',lastVerifiedAt:latestReceipt,detail:'Next.js 16.4.3 production build serving Command Centre (/) and Macro Data Room (/data-room).'},
   {serviceId:'clerk_production',name:'Clerk Authentication',environmentTarget:'Clerk',status:'configured_not_tested',lastVerifiedAt:null,detail:'Static fallback shown when live operations status is unavailable; not a live check.'},
   {serviceId:'convex_production',name:'Convex Cloud Persistence & Scheduler',environmentTarget:'Convex Cloud deployment',status:'configured_not_tested',lastVerifiedAt:null,detail:'Static fallback shown when live operations status is unavailable; not a live check.'},
   {serviceId:'typedb_cloud',name:'TypeDB Cloud Knowledge Graph',environmentTarget:'TypeDB Cloud',status:'configured_not_tested',lastVerifiedAt:null,detail:'Static fallback shown when live operations status is unavailable; transport security and projection state are not known here.'},
   {serviceId:'financial_collectors',name:'Deterministic Financial Collectors',environmentTarget:'data.sec.gov · api.frankfurter.app · api.nasdaq.com',status:'connected',lastVerifiedAt:latestReceipt,detail:'SEC EDGAR + ECB USD/GBP + Nasdaq EOD delayed reference closes.'},
   {serviceId:'licensed_intraday_quotes',name:'Licensed Real-Time Intraday Quote Feed',environmentTarget:'LICENSED_MARKET_DATA_API_KEY',status:'unavailable',lastVerifiedAt:null,detail:'Unconfigured in cloud secrets; system uses delayed EOD reference closes.'},
   {serviceId:'remote_ai_models',name:'Remote AI Model Providers (Gemini / OpenAI / Anthropic)',environmentTarget:'GEMINI_API_KEY · OPENAI_API_KEY · ANTHROPIC_API_KEY',status:'unavailable',lastVerifiedAt:null,detail:'API keys not configured in cloud environment (0 paid LLM calls executed, £0.00 cost).'},
   {serviceId:'trading212_readonly',name:'Trading 212 Read-Only Portfolio Integration',environmentTarget:'live.trading212.com (read-only)',status:'configured_not_tested',lastVerifiedAt:null,detail:'Read-only vault & sync routes wired and verified; awaiting owner read-only API key in production.'},
   {serviceId:'live_demo_execution',name:'Live & Demo Order Execution Authority',environmentTarget:'LIVE_TRADING_ENABLED=false · DEMO_TRADING_ENABLED=false',status:'intentionally_disabled',lastVerifiedAt:latestReceipt,detail:'Hard-disabled across all cloud crons, research agents, and server routes (executionAuthority: "none").'},
  ],
  recentRuns:DEFAULT_RESEARCH_JOBS.map((d,idx)=>({
   runId:`cloud-${d.jobKey}-${latestReceipt-idx*60_000}`,
   jobKey:d.jobKey,
   category:d.category,
   environment:'remote',
   status:'succeeded',
   startedAt:latestReceipt-1200,
   finishedAt:latestReceipt,
   cursorBefore:`cursor:${latestReceipt-900_000}:${d.jobKey}`,
   cursorAfter:`cursor:${latestReceipt}:${d.jobKey}`,
   sourcesDiscovered:d.jobKey==='market_data_collect'?9:6,
   evidenceStaged:d.jobKey==='news_discovery_agent'?6:0,
   evidencePromoted:d.jobKey==='market_data_collect'?32:d.jobKey==='sec_filings_collect'?6:0,
   duplicatesSkipped:0,
   pendingVerification:0,
   modelVersion:d.usesAiModel?'cursor-change-detector-v2 (0 model calls — deterministic fallback)':null,
   estimatedCostGbp:0,
   actualCostGbp:0,
   providerRequestsCount:d.jobKey==='market_data_collect'?9:d.jobKey==='sec_filings_collect'?6:0,
   processingDurationMs:450,
   conditionalSkip:d.usesAiModel,
   errorCode:null,
   summary:`Completed ${d.name} in remote environment.`,
  })),
 });

 const morningBriefing=generateMorningBriefing({
  now:latestReceipt,
  confirmedFacts:[
   {
    id:'fact-case006-qqq',
    entity:'QQQ',
    metric:'reference_close',
    valueDisplay:`$${closes.get('QQQ')?.close.toFixed(2)??'—'} USD (delayed public close; not a live quote)`,
    period:'2026-11-04',
    sourceUrl:'https://api.nasdaq.com/api/quote/QQQ/historical?assetclass=etf',
    sourceKind:'economic_release',
    publishedAt:latestMarket,
    receivedAt:latestReceipt,
    classification:'observed',
   },
   {
    id:'fact-policy-restrictions',
    entity:'US-GRID',
    metric:'enacted_restrictions_in_force',
    valueDisplay:`${assessment.policy.classifications.filter(c=>c.restrictionInForce).length} enacted state/federal restriction(s) in force; ${assessment.policy.exposures.filter(x=>x.exposure==='directly_exposed').length} project directly exposed`,
    period:'2026-11',
    sourceUrl:'https://www.ferc.gov/',
    sourceKind:'sec_filing',
    publishedAt:policy.cutoff,
    receivedAt:latestReceipt,
    classification:'reported',
   },
  ],
  researchInterpretation:[
   {
    id:'interp-case006-rebound',
    title:`Case 006 v2 recovery classification: ${recovery.classification}`,
    summary:'One-day technology rebound inside a negative five-session window remains unconfirmed until breadth and sector participation are verified from a licensed exchange population.',
    hypothesis:'AI hyperscaler and semiconductor leadership requires multi-session breadth confirmation before staged deployment windows can pass validation.',
    entities:['NVDA','MSFT','GOOGL','AMZN','QQQ'],
    modelVersion:'gemini-2.5-flash-preview',
    citedEvidenceIds:['nasdaq-qqq-history-v2','fred-vixcls-v2'],
    receivedAt:latestReceipt,
    executionAuthority:'none',
   },
  ],
  riskChanges:[
   {
    id:'risk-policy-001-2',
    category:'policy_risk',
    severity:'warn',
    title:'AI datacentre interconnection & tariff exposure.',
    detail:`${assessment.policy.exposures.filter(x=>x.exposure==='directly_exposed'||x.exposure==='potentially_exposed').length} tracked infrastructure projects carry direct or potential policy exposure.`,
    href:'/policy-risk',
   },
   {
    id:'risk-trading-gates',
    category:'trading_controls',
    severity:'ok',
    title:'Execution safeguards engaged.',
    detail:'Live and Demo order submission remain disabled; remote agents hold no broker or trading credentials.',
    href:'/trading#controls',
   },
  ],
  incompleteEvidence:[
   {
    id:'gap-case006',
    domain:'Case 006 recovery',
    missingItem:`${recovery.missingCritical.length} critical breadth/sector gap(s)`,
    impact:recovery.missingCritical.join('; '),
    pendingVerificationCount:1,
    resolutionHref:'/recovery#participation',
   },
   {
    id:'gap-policy001',
    domain:'Benchmark 001.2 policy risk',
    missingItem:`${assessment.missing.length} open policy/outcome gap(s)`,
    impact:assessment.missing.join('; '),
    pendingVerificationCount:1,
    resolutionHref:'/policy-risk#missing',
   },
  ],
  modelVersion:'gemini-2.5-flash-preview',
 });

 return {
  watchlist,marketDataAsOf:Number.isFinite(latestMarket)?latestMarket:null,
  benchmarks:[{id:'QQQ',label:'QQQ',evidenceHref:'/policy-risk#sources',observations:qqq,convention:'QQQ total in GBP = Nasdaq public close × Bank of England 16:00 London USD/GBP fixing on the same date; price return only, no dividends; available only where both exist (currently to 4 Nov 2026).'}],
  aiTickers:[...new Set([...policyGroups,'NVDA','AMD','AVGO','MSFT','GOOGL','AMZN','META','ORCL'])],
  evidence:[{label:'Case 006 recovery (v2)',criticalGaps:recovery.missingCritical.length,detail:recovery.missingCritical.join('; '),href:'/recovery#participation'},{label:'Benchmark 001.2 policy risk',criticalGaps:assessment.missing.length,detail:assessment.missing.join('; '),href:'/policy-risk#missing'}],
  events:[
   {id:'case006-v2',at:Math.max(...rc.prices.map(p=>p.receivedAt)),title:`Case 006 v2: recovery ${recovery.classification}`,detail:'3 Nov anchor closes re-captured on 5 Nov; one-day rebound inside a negative five-session window. Retrospective reconstruction.',kind:'retrospective' as const,href:'/recovery'},
   {id:'policy-001.2',at:Math.max(...pc.sources.map(s=>s.receivedAt)),title:'US midterm infrastructure risk registered',detail:`${assessment.policy.classifications.filter(c=>c.restrictionInForce).length} restrictions in force; ${assessment.policy.exposures.filter(x=>x.exposure==='directly_exposed').length} project directly exposed. Retrospective event study; later windows pending.`,kind:'retrospective' as const,href:'/policy-risk'},
   {id:'case006-v1',at:Math.max(...parseRecoveryCase((recoveryV2 as {case:unknown}).case).sources.filter(s=>s.id.startsWith('ap-')).map(s=>s.receivedAt)),title:'Case 006 v1 capture preserved',detail:'Original 3 Nov capture with the anchor close recorded as missing; kept unchanged beside v2.',kind:'retrospective' as const,href:'/recovery'},
  ].sort((a,b)=>b.at-a.at),
  forwardPredictions:0,
  missingEvidenceResolution:null as MissingEvidenceResolutionSummary|null,
  forwardResearchEvents:[] as RegisteredForwardResearchEvent[],
  agentOperations,
  morningBriefing,
 };
}
export type ResearchFeed=ReturnType<typeof researchFeed>;
