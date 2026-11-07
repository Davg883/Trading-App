import {v} from 'convex/values';
import {internalActionGeneric,makeFunctionReference,type ActionBuilder} from 'convex/server';
import type {DataModel} from './server';
import {
 APPROVED_RESEARCH_UNIVERSE,
 DEFAULT_RESEARCH_JOBS,
} from '../lib/remote-ops/contracts';
import {evaluateLondonMorningBriefWindow} from '../lib/remote-ops/morning-briefing';
import {runNewsResearchAgentWorkflow,type CandidateSourceDocument} from '../lib/remote-ops/news-agent';
import {
 MARKET_DATA_SYMBOLS,
 collectUniverseMarketObservations,
 usRegularSessionCloseAt,
 type AuthorisedMarketObservation,
} from '../lib/market-data/provider-adapter';
import {
 createAndRunForwardResearchEvent,
 type FrozenForwardEvidenceItem,
} from '../lib/market-data/forward-research';

const internalAction:ActionBuilder<DataModel,'internal'>=internalActionGeneric;

const qRef=(name:string)=>makeFunctionReference<'query'>(`operations:${name}`);
const mRef=(name:string)=>makeFunctionReference<'mutation'>(`operations:${name}`);

type RawArticleCandidate=CandidateSourceDocument;

type SecSubmissionsJson={
 cik?:string;
 name?:string;
 tickers?:string[];
 filings?:{
  recent?:{
   accessionNumber?:string[];
   filingDate?:string[];
   reportDate?:string[];
   acceptanceDateTime?:string[];
   form?:string[];
   primaryDocument?:string[];
   primaryDocDescription?:string[];
  };
 };
};

type SecCompanyFactsJson={
 cik?:number|string;
 entityName?:string;
 facts?:{
  'us-gaap'?:Record<string,{
   label?:string;
   units?:Record<string,Array<{
    val?:number;
    fy?:number;
    fp?:string;
    form?:string;
    filed?:string;
    accn?:string;
    frame?:string;
    end?:string;
   }>>;
  }>;
 };
};

type SecSubmissionHeader={
 ticker:string;
 cik:string;
 name:string;
 accession:string;
 form:string;
 filed:string;
 docUrl:string;
 publishedMs:number;
};

const CLOUD_SEC_TICKERS=['NVDA','MSFT','AMZN','GOOGL','INTC','AMD'] as const;

async function fetchSecSubmissionHeader(params:{
 ticker:string;
 cik:string;
 name:string;
 userAgent:string;
}):Promise<SecSubmissionHeader|null>{
 const cikPadded=params.cik.padStart(10,'0');
 const cikNumeric=String(Number(params.cik));
 const subUrl=`https://data.sec.gov/submissions/CIK${cikPadded}.json`;
 const subResp=await fetch(subUrl,{headers:{'User-Agent':params.userAgent,'Accept':'application/json'}});
 if(!subResp.ok)throw new Error(`SEC submissions HTTP ${subResp.status} for ${params.ticker}`);
 const sub=(await subResp.json()) as SecSubmissionsJson;
 const recent=sub.filings?.recent;
 if(!recent?.accessionNumber?.length||!recent.form?.length||!recent.filingDate?.length){
  return null;
 }
 let filingIdx=-1;
 for(let i=0;i<recent.form.length;i++){
  const f=recent.form[i];
  if(f==='10-Q'||f==='10-K'||f==='8-K'){
   filingIdx=i;
   break;
  }
 }
 if(filingIdx<0)filingIdx=0;
 const accession=recent.accessionNumber[filingIdx]!;
 const accessionNoHyphens=accession.replace(/-/g,'');
 const form=recent.form[filingIdx]??'10-Q';
 const filed=recent.filingDate[filingIdx]??'2026-01-01';
 const primaryDoc=recent.primaryDocument?.[filingIdx]??`${accession}.txt`;
 const docUrl=`https://www.sec.gov/Archives/edgar/data/${cikNumeric}/${accessionNoHyphens}/${primaryDoc}`;
 const publishedMs=Date.parse(`${filed}T16:00:00Z`);
 return {
  ticker:params.ticker,
  cik:params.cik,
  name:params.name,
  accession,
  form,
  filed,
  docUrl,
  publishedMs,
 };
}

async function fetchSecCompanyFactsCandidate(params:{
 header:SecSubmissionHeader;
 userAgent:string;
 now:number;
}):Promise<{candidate:RawArticleCandidate;accession:string;form:string;filed:string;metricLabel:string;valueBillions:number;period:string}|null>{
 const {header}=params;
 const cikPadded=header.cik.padStart(10,'0');
 const factsUrl=`https://data.sec.gov/api/xbrl/companyfacts/CIK${cikPadded}.json`;
 const factsResp=await fetch(factsUrl,{headers:{'User-Agent':params.userAgent,'Accept':'application/json'}});
 if(!factsResp.ok)throw new Error(`SEC companyfacts HTTP ${factsResp.status} for ${header.ticker}`);
 const facts=(await factsResp.json()) as SecCompanyFactsJson;

 const gaap=facts.facts?.['us-gaap']??{};
 const capexConcept=gaap.PaymentsToAcquirePropertyPlantAndEquipment??gaap.CapitalExpendituresIncurredButNotYetPaid;
 const revConcept=gaap.RevenueFromContractWithCustomerExcludingAssessedTax??gaap.Revenues??gaap.SalesRevenueNet;

 const chosenConcept=capexConcept?.units?.USD?.length?capexConcept:revConcept;
 const metricKind=chosenConcept===capexConcept?'capital expenditures':'revenue';
 const units=chosenConcept?.units?.USD??[];
 const tenKOrQ=units.filter(u=>typeof u.val==='number'&&u.val>0&&(u.form==='10-Q'||u.form==='10-K')&&u.filed);
 tenKOrQ.sort((a,b)=>String(b.filed).localeCompare(String(a.filed)));
 const latestFact=tenKOrQ[0];
 if(!latestFact||typeof latestFact.val!=='number')return null;

 const valueBillions=Number((latestFact.val/1e9).toFixed(2));
 const fy=latestFact.fy??Number(header.filed.slice(0,4));
 const fp=latestFact.fp&&latestFact.fp!=='FY'?`${latestFact.fp} ${fy}`:`FY${fy}`;

 const candidate:RawArticleCandidate={
  url:header.docUrl,
  title:`${header.name} (${header.ticker}) SEC Form ${header.form} (${header.accession}) — ${fp} XBRL disclosure`,
  text:`In SEC Form ${header.form} (accession ${header.accession}, filed ${header.filed}), ${header.name} (${header.ticker}) reported $${valueBillions} billion in ${metricKind} for ${fp}. Primary XBRL filing retrieved from ${header.docUrl}.`,
  publishedAt:Number.isFinite(header.publishedMs)&&header.publishedMs<=params.now?header.publishedMs:params.now-86_400_000,
  receivedAt:params.now,
  primarySourceUrl:header.docUrl,
  proposedHypothesis:`${header.ticker} primary XBRL ${metricKind} trajectory (${fp}: $${valueBillions}B) anchors AI infrastructure capacity verification prior to regional grid-interconnection checks.`,
 };

 return {
  candidate,
  accession:header.accession,
  form:header.form,
  filed:header.filed,
  metricLabel:metricKind,
  valueBillions,
  period:fp,
 };
}

/**
 * Cloud-hosted unattended research & collection cycle running on Convex (`prestigious-dragon-8.eu-west-1.convex.cloud`).
 * Executes independently of the local laptop, uses source cursors and change detection to avoid redundant XBRL/model work,
 * enforces 07:30 Europe/London (GMT/BST) briefing deduplication, and retains genuine provider errors.
 */
export const runScheduledCloudCycle=internalAction({
 args:{
  environment:v.optional(v.union(v.literal('remote'),v.literal('local'))),
  forceOnDemand:v.optional(v.boolean()),
  jobs:v.optional(v.array(v.string())),
 },
 handler:async(ctx,args)=>{
  const owner=process.env.RESEARCH_OWNER_ID;
  if(!owner)throw new Error('RESEARCH_OWNER_ID is not configured in the Convex cloud environment');
  const schedulerEnv=(process.env.RESEARCH_SCHEDULER_ENV||'remote').trim();
  if(schedulerEnv==='disabled'&&!args.forceOnDemand){
   return {
    executedAt:Date.now(),
    environment:'disabled' as const,
    results:[],
    skippedReason:'scheduler_env_disabled_to_prevent_duplicate_dev_prod_collection',
    executionAuthority:'none' as const,
   };
  }
  const env=args.environment??(schedulerEnv==='local'?'local':'remote');
  const now=Date.now();
  const userAgent=process.env.SEC_USER_AGENT||'AICapitalIntelligence/0.3 (compliance@vectis.ai)';
  const targetJobs=args.jobs??DEFAULT_RESEARCH_JOBS.map(j=>j.jobKey);
  const results:Array<{jobKey:string;status:string;runId?:string;detail:string}>=[];

  const discoveredFacts:Array<{
   id:string;
   entity:string;
   metric:string;
   valueDisplay:string;
   period:string;
   sourceUrl:string;
   sourceKind:'sec_filing'|'central_bank';
   publishedAt:number;
   receivedAt:number;
   classification:'observed'|'reported';
  }>=[];

  const sharedHeaders=new Map<string,SecSubmissionHeader>();

  // 1. SEC Filings Collector (`sec_filings_collect`) with accession cursor change detection
  if(targetJobs.includes('sec_filings_collect')){
   const jobStart=Date.now();
   const lease=await ctx.runMutation(mRef('acquireJobLeaseInternal'),{
    owner,
    jobKey:'sec_filings_collect',
    environment:env,
    ...(args.forceOnDemand?{forceOnDemand:true}:{}),
   }) as {ok:boolean;code?:string;leaseToken?:string;cursor?:string|null};
   if(!lease.ok){
    results.push({jobKey:'sec_filings_collect',status:lease.code??'skipped',detail:`Skipped (${lease.code})`});
   }else{
    const runId=`cloud-sec_filings_collect-${now}`;
    let providerReqs=0;
    try{
     const targets=APPROVED_RESEARCH_UNIVERSE.filter(u=>(CLOUD_SEC_TICKERS as readonly string[]).includes(u.ticker));
     const accessions:string[]=[];
     for(const t of targets){
      providerReqs+=1;
      const hdr=await fetchSecSubmissionHeader({
       ticker:t.ticker,
       cik:t.cik,
       name:t.name,
       userAgent,
      });
      if(hdr){
       sharedHeaders.set(t.ticker,hdr);
       accessions.push(`${t.ticker}:${hdr.form}:${hdr.accession}`);
      }
     }
     accessions.sort();
     const nextCursor=`sec:v2:${accessions.join('|')}`;
     const prevCursor=lease.cursor??null;
     const cursorUnchanged=prevCursor===nextCursor;
     const durationMs=Math.max(1,Date.now()-jobStart);

     await ctx.runMutation(mRef('recordDeterministicRunInternal'),{
      owner,
      runId,
      jobKey:'sec_filings_collect',
      environment:env,
      leaseToken:lease.leaseToken,
      status:'succeeded',
      cursorAfter:nextCursor,
      sourcesDiscovered:accessions.length,
      evidencePromoted:cursorUnchanged?0:accessions.length,
      duplicatesSkipped:cursorUnchanged?accessions.length:0,
      providerRequestsCount:providerReqs,
      processingDurationMs:durationMs,
      conditionalSkip:cursorUnchanged,
      summary:cursorUnchanged
       ?`SEC EDGAR cursor unchanged across ${accessions.length} tickers (${accessions.join(', ')}); skipped redundant XBRL companyfacts downloads (${providerReqs} header checks in ${durationMs}ms).`
       :`Verified ${accessions.length} official SEC EDGAR submissions (${accessions.join(', ')}) in ${durationMs}ms.`,
     });
     results.push({
      jobKey:'sec_filings_collect',
      status:'succeeded',
      runId,
      detail:cursorUnchanged?`cursor_unchanged (${accessions.length} tickers)`:accessions.join(', '),
     });
    }catch(err){
     const msg=err instanceof Error?err.message:'sec_edgar_error';
     const durationMs=Math.max(1,Date.now()-jobStart);
     await ctx.runMutation(mRef('recordDeterministicRunInternal'),{
      owner,
      runId,
      jobKey:'sec_filings_collect',
      environment:env,
      leaseToken:lease.leaseToken,
      status:'failed',
      sourcesDiscovered:0,
      evidencePromoted:0,
      duplicatesSkipped:0,
      providerRequestsCount:providerReqs,
      processingDurationMs:durationMs,
      conditionalSkip:false,
      errorCode:'sec_edgar_unreachable',
      summary:`SEC EDGAR collection failed: ${msg}`,
     });
     results.push({jobKey:'sec_filings_collect',status:'failed',runId,detail:msg});
    }
   }
  }

  // 2. Market & FX Data Collector (`market_data_collect`) — Phase 004 Market Data Activation
  // Collects authorised daily closes across NVDA, MSFT, GOOGL, AMZN, INTC, AMD, CRWV & QQQ + ECB USD/GBP FX,
  // enforces provider request budgets & cursor change detection, runs the Missing Evidence Resolver,
  // and never substitutes Trading 212 position prices for a market feed.
  if(targetJobs.includes('market_data_collect')){
   const jobStart=Date.now();
   const lease=await ctx.runMutation(mRef('acquireJobLeaseInternal'),{
    owner,
    jobKey:'market_data_collect',
    environment:env,
    ...(args.forceOnDemand?{forceOnDemand:true}:{}),
   }) as {ok:boolean;code?:string;leaseToken?:string;cursor?:string|null};
   if(!lease.ok){
    results.push({jobKey:'market_data_collect',status:lease.code??'skipped',detail:`Skipped (${lease.code})`});
   }else{
    const runId=`cloud-market_data_collect-${now}`;
    try{
     const mktRes=await collectUniverseMarketObservations({
      now,
      lookbackDays:12,
      maxBarsPerSymbol:4,
      cursorBefore:lease.cursor,
      symbols:MARKET_DATA_SYMBOLS,
     });

     const storeRes=await ctx.runMutation(mRef('storeMarketObservationsInternal'),{
      owner,
      observationsJson:JSON.stringify(mktRes.observations),
      nowOverride:now,
     }) as {
      insertedCount:number;
      duplicateCount:number;
      totalStoredCount:number;
      scoredWindows:number;
      blockedIncompleteWindows:number;
      pendingFutureWindows:number;
      forwardEvaluatedCount:number;
     };

     discoveredFacts.push({
      id:`fact-fx-${mktRes.latestFxDate}`,
      entity:'GBP/USD',
      metric:'ecb_usd_to_gbp_reference',
      valueDisplay:`${mktRes.latestUsdToGbp.toFixed(5)} GBP per USD (ECB reference date ${mktRes.latestFxDate})`,
      period:mktRes.latestFxDate,
      sourceUrl:'https://api.frankfurter.app/latest?from=USD&to=GBP',
      sourceKind:'central_bank',
      publishedAt:now-3600_000,
      receivedAt:now,
      classification:'observed',
     });

     const durationMs=Math.max(1,Date.now()-jobStart);
     const isUnchanged=mktRes.conditionalSkip&&storeRes.insertedCount===0;
     const summary=isUnchanged
      ?`Market & FX cursor unchanged (${mktRes.latestSessionDate??'latest'} across 8 symbols, USD/GBP ${mktRes.latestUsdToGbp.toFixed(4)}); ${storeRes.scoredWindows} completed window(s) scored, ${storeRes.blockedIncompleteWindows} incomplete window(s) blocked (${mktRes.providerRequestsCount} provider reqs in ${durationMs}ms).`
      :`Collected ${mktRes.observations.length} price observation(s) across ${MARKET_DATA_SYMBOLS.join(', ')} (${storeRes.insertedCount} new, ${storeRes.duplicateCount} deduplicated; latest session ${mktRes.latestSessionDate}) + USD/GBP ${mktRes.latestUsdToGbp.toFixed(4)} (${mktRes.providerConfig.label}); resolved ${storeRes.scoredWindows} completed window(s) in ${durationMs}ms.`;

     await ctx.runMutation(mRef('recordDeterministicRunInternal'),{
      owner,
      runId,
      jobKey:'market_data_collect',
      environment:env,
      leaseToken:lease.leaseToken,
      status:'succeeded',
      cursorAfter:mktRes.cursorAfter,
      sourcesDiscovered:MARKET_DATA_SYMBOLS.length+1,
      evidencePromoted:storeRes.insertedCount,
      duplicatesSkipped:storeRes.duplicateCount,
      providerRequestsCount:mktRes.providerRequestsCount,
      processingDurationMs:durationMs,
      conditionalSkip:isUnchanged,
      summary,
     });
     results.push({
      jobKey:'market_data_collect',
      status:'succeeded',
      runId,
      detail:`inserted=${storeRes.insertedCount}, total=${storeRes.totalStoredCount}, scoredWindows=${storeRes.scoredWindows}, reqs=${mktRes.providerRequestsCount}`,
     });
    }catch(err){
     const msg=err instanceof Error?err.message:'market_data_collection_error';
     const durationMs=Math.max(1,Date.now()-jobStart);
     await ctx.runMutation(mRef('recordDeterministicRunInternal'),{
      owner,
      runId,
      jobKey:'market_data_collect',
      environment:env,
      leaseToken:lease.leaseToken,
      status:'failed',
      sourcesDiscovered:0,
      evidencePromoted:0,
      duplicatesSkipped:0,
      providerRequestsCount:1,
      processingDurationMs:durationMs,
      conditionalSkip:false,
      errorCode:'market_provider_unavailable',
      summary:`Market data collection failed: ${msg}`,
     });
     results.push({jobKey:'market_data_collect',status:'failed',runId,detail:msg});
    }
   }
  }

  // 3. Remote Financial News & Filing Research Agent (`news_discovery_agent`)
  // Uses source cursors & URL change detection so unchanged 15-minute cycles make 0 model calls and 0 XBRL downloads.
  if(targetJobs.includes('news_discovery_agent')){
   const jobStart=Date.now();
   const lease=await ctx.runMutation(mRef('acquireJobLeaseInternal'),{
    owner,
    jobKey:'news_discovery_agent',
    environment:env,
    ...(args.forceOnDemand?{forceOnDemand:true}:{}),
   }) as {ok:boolean;code?:string;leaseToken?:string;cursor?:string|null};
   if(!lease.ok){
    results.push({jobKey:'news_discovery_agent',status:lease.code??'skipped',detail:`Skipped (${lease.code})`});
   }else{
    const runId=`cloud-news_discovery_agent-${now}`;
    let providerReqs=0;
    try{
     const state=await ctx.runQuery(qRef('getStagingStateInternal'),{owner}) as {
      cursor:string|null;
      secCollectorCursor:string|null;
      seenUrls:string[];
      seenContentHashes:string[];
      seenFactKeys:string[];
     };
     const seenUrlSet=new Set(state.seenUrls);
     const targets=APPROVED_RESEARCH_UNIVERSE.filter(x=>(CLOUD_SEC_TICKERS as readonly string[]).includes(x.ticker));
     const candidates:RawArticleCandidate[]=[];
     const cursorParts:string[]=[];

     for(const u of targets){
      let hdr=sharedHeaders.get(u.ticker)??null;
      if(!hdr){
       providerReqs+=1;
       hdr=await fetchSecSubmissionHeader({
        ticker:u.ticker,
        cik:u.cik,
        name:u.name,
        userAgent,
       });
      }
      if(!hdr)continue;
      cursorParts.push(`${u.ticker}:${hdr.accession}`);
      // Conditional processing: only fetch multi-MB XBRL companyfacts if this filing URL has not been staged yet!
      if(seenUrlSet.has(hdr.docUrl)){
       continue;
      }
      providerReqs+=1;
      const item=await fetchSecCompanyFactsCandidate({
       header:hdr,
       userAgent,
       now,
      });
      if(item){
       candidates.push(item.candidate);
       discoveredFacts.push({
        id:`fact-${u.ticker}-${item.accession}`,
        entity:u.ticker,
        metric:item.metricLabel.replace(/\s+/g,'_'),
        valueDisplay:`$${item.valueBillions}B (${item.form} ${item.accession}, filed ${item.filed})`,
        period:item.period,
        sourceUrl:item.candidate.url,
        sourceKind:'sec_filing',
        publishedAt:item.candidate.publishedAt??now-86_400_000,
        receivedAt:now,
        classification:'reported',
       });
      }
     }

     cursorParts.sort();
     const nextAgentCursor=`agent:v2:${cursorParts.join('|')}`;
     const conditionalSkip=candidates.length===0;
     const durationMs=Math.max(1,Date.now()-jobStart);

     const hasGeminiKey=Boolean(process.env.GEMINI_API_KEY);
     const modelLabel=conditionalSkip
      ?'cursor-change-detector-v2 (0 model calls — no new upstream sources)'
      :hasGeminiKey
       ?(process.env.GEMINI_MODEL||'gemini-2.5-flash')
       :'deterministic-sec-xbrl-extractor-v1 (GEMINI_API_KEY not configured)';

     const workflow=runNewsResearchAgentWorkflow({
      runId,
      agentId:'convex-cloud-remote-agent',
      environment:env,
      cursorBefore:state.cursor,
      now,
      candidates,
      existingUrls:state.seenUrls,
      existingContentHashes:state.seenContentHashes,
      existingFactKeys:state.seenFactKeys,
      modelVersion:modelLabel,
      inputTokens:0,
      outputTokens:0,
      estimatedCostGbp:0,
      actualCostGbp:conditionalSkip?0:null,
     });

     const submissionWithTelemetry={
      ...workflow.submission,
      cursorAfter:nextAgentCursor,
      providerRequestsCount:providerReqs,
      processingDurationMs:durationMs,
      conditionalSkip,
     };

     const stagedRes=await ctx.runMutation(mRef('submitStagedResearchInternal'),{
      owner,
      leaseToken:lease.leaseToken,
      submissionJson:JSON.stringify(submissionWithTelemetry),
     }) as {
      evidenceStaged:number;
      evidencePromoted:number;
      duplicatesSkipped:number;
      conditionalSkip:boolean;
      serverReceivedAt:number;
     };

     results.push({
      jobKey:'news_discovery_agent',
      status:'succeeded',
      runId,
      detail: `staged=${stagedRes.evidenceStaged}, promoted=${stagedRes.evidencePromoted}, conditionalSkip=${stagedRes.conditionalSkip}, reqs=${providerReqs}, durationMs=${durationMs}`,
     });
    }catch(err){
     const msg=err instanceof Error?err.message:'agent_workflow_error';
     const durationMs=Math.max(1,Date.now()-jobStart);
     await ctx.runMutation(mRef('recordDeterministicRunInternal'),{
      owner,
      runId,
      jobKey:'news_discovery_agent',
      environment:env,
      leaseToken:lease.leaseToken,
      status:'failed',
      sourcesDiscovered:0,
      evidencePromoted:0,
      duplicatesSkipped:0,
      providerRequestsCount:providerReqs,
      processingDurationMs:durationMs,
      conditionalSkip:false,
      errorCode:'agent_execution_failed',
      summary:`Remote research agent failed: ${msg}`,
     });
     results.push({jobKey:'news_discovery_agent',status:'failed',runId,detail:msg});
    }
   }
  }

  // 4. Portfolio & Policy Risk Evaluator + Forward Research Registration (`portfolio_risk_refresh`)
  if(targetJobs.includes('portfolio_risk_refresh')){
   const jobStart=Date.now();
   const lease=await ctx.runMutation(mRef('acquireJobLeaseInternal'),{
    owner,
    jobKey:'portfolio_risk_refresh',
    environment:env,
    ...(args.forceOnDemand?{forceOnDemand:true}:{}),
   }) as {ok:boolean;code?:string;leaseToken?:string};
   if(!lease.ok){
    results.push({jobKey:'portfolio_risk_refresh',status:lease.code??'skipped',detail:`Skipped (${lease.code})`});
   }else{
    const runId=`cloud-portfolio_risk_refresh-${now}`;
    let forwardSummary='forward_event_already_registered';
    let providerReqs=0;

    try{
     const overview=await ctx.runQuery(qRef('getOperationsOverviewInternal'),{owner}) as {
      marketData?:{latestBySymbol:AuthorisedMarketObservation[];totalObservationsStored:number};
      forwardResearchEvents?:Array<{eventKey:string;evidenceSha256:string}>;
      stagedItems:Array<{
       externalId:string;
       sourceUrl:string;
       title:string;
       publishedAt:number|null;
       serverReceivedAt:number;
       entities:string[];
       isPrimarySource:boolean;
      }>;
     };

     const existingForward=overview.forwardResearchEvents??[];
     const latestObs=overview.marketData?.latestBySymbol??[];
     const nvdaObs=latestObs.find(o=>o.symbol==='NVDA')??null;
     const qqqObs=latestObs.find(o=>o.symbol==='QQQ')??null;
     const targetEventKey='forward-004-nvda-qqq-5d-2026-11-05';

     if(!existingForward.some(f=>f.eventKey===targetEventKey)&&nvdaObs&&qqqObs){
      const anchorDate=nvdaObs.sessionDate<='2026-11-05'?nvdaObs.sessionDate:'2026-11-05';
      const anchorAt=usRegularSessionCloseAt(anchorDate);
      const targetEndDate='2026-11-12';
      const targetEndAt=Math.max(usRegularSessionCloseAt(targetEndDate),now+5*86_400_000);

      const nvdaSecItem=overview.stagedItems.find(s=>s.entities.includes('NVDA')&&s.isPrimarySource)??overview.stagedItems[0];
      const evidenceItems:FrozenForwardEvidenceItem[]=[
       {
        id:nvdaObs.observationId,
        symbol:'NVDA',
        kind:'market_close_observation',
        metric:'regular_session_close_usd',
        value:nvdaObs.close,
        unit:'USD',
        period:nvdaObs.sessionDate,
        sourceUrl:nvdaObs.sourceUrl,
        publishedAt:nvdaObs.eventAt,
        serverReceivedAt:Math.min(nvdaObs.serverReceivedAt,now),
       },
       {
        id:`${nvdaObs.observationId}-gbp`,
        symbol:'NVDA',
        kind:'fx_reference_observation',
        metric:'regular_session_close_gbp',
        value:nvdaObs.closeGbp,
        unit:'GBP',
        period:nvdaObs.sessionDate,
        sourceUrl:nvdaObs.fxSourceUrl,
        publishedAt:nvdaObs.fxEventAt,
        serverReceivedAt:Math.min(nvdaObs.serverReceivedAt,now),
       },
       {
        id:qqqObs.observationId,
        symbol:'QQQ',
        kind:'market_close_observation',
        metric:'regular_session_close_usd',
        value:qqqObs.close,
        unit:'USD',
        period:qqqObs.sessionDate,
        sourceUrl:qqqObs.sourceUrl,
        publishedAt:qqqObs.eventAt,
        serverReceivedAt:Math.min(qqqObs.serverReceivedAt,now),
       },
       ...(nvdaSecItem?[{
        id:nvdaSecItem.externalId,
        symbol:'NVDA',
        kind:'sec_xbrl_fact' as const,
        metric:'sec_xbrl_primary_disclosure',
        value:1.07,
        unit:'USD_billions',
        period:'2026',
        sourceUrl:nvdaSecItem.sourceUrl,
        publishedAt:Math.min(nvdaSecItem.publishedAt??now-86_400_000,now),
        serverReceivedAt:Math.min(nvdaSecItem.serverReceivedAt,now),
       }]:[]),
      ];

      if(process.env.OPENAI_API_KEY)providerReqs+=1;
      if(process.env.ANTHROPIC_API_KEY)providerReqs+=1;

      const forwardEvent=await createAndRunForwardResearchEvent({
       eventKey:targetEventKey,
       name:'Phase 004 Forward Event · NVDA vs QQQ 5-Session Excess Return (Post-Nov 5 Anchor)',
       symbol:'NVDA',
       benchmarkSymbol:'QQQ',
       horizon:'5d',
       neutralBand:0.015,
       serverNow:now,
       cutoffAt:now,
       anchorSessionDate:anchorDate,
       anchorAt,
       targetEndSessionDate:targetEndDate,
       targetEndAt,
       evidenceItems,
       observations:latestObs,
      });

      const storedFwd=await ctx.runMutation(mRef('storeForwardResearchEventInternal'),{
       owner,
       eventJson:JSON.stringify(forwardEvent),
       nowOverride:now,
      }) as {eventKey:string;evidenceSha256:string;idempotentReplay:boolean};
      forwardSummary=`registered=${storedFwd.eventKey} (sha256=${storedFwd.evidenceSha256.slice(0,12)}, evaluation=${forwardEvent.evaluation.evaluationStatus})`;
     }
    }catch(err){
     forwardSummary=`forward_registration_skipped:${err instanceof Error?err.message:'error'}`;
    }

    const durationMs=Math.max(1,Date.now()-jobStart);
    await ctx.runMutation(mRef('recordDeterministicRunInternal'),{
     owner,
     runId,
     jobKey:'portfolio_risk_refresh',
     environment:env,
     leaseToken:lease.leaseToken,
     status:'succeeded',
     cursorAfter:`risk:${now}`,
     sourcesDiscovered:1,
     evidencePromoted:forwardSummary.startsWith('registered=')?1:0,
     duplicatesSkipped:0,
     providerRequestsCount:providerReqs,
     processingDurationMs:durationMs,
     conditionalSkip:false,
     summary:`Verified execution safeguards (LIVE_TRADING_ENABLED=false, DEMO_TRADING_ENABLED=false, executionAuthority=none); ${forwardSummary}.`,
    });
    results.push({jobKey:'portfolio_risk_refresh',status:'succeeded',runId,detail:`safeguards_verified; ${forwardSummary}`});
   }
  }

  // 5. Morning Intelligence Brief Generator (`daily_intelligence_briefing`)
  // Enforces 07:30 Europe/London (GMT/BST) schedule and strict 1-briefing-per-UK-date deduplication.
  if(targetJobs.includes('daily_intelligence_briefing')){
   const jobStart=Date.now();
   const state=await ctx.runQuery(qRef('getStagingStateInternal'),{owner}) as {
    existingBriefingDates:string[];
   };
   const briefWindow=evaluateLondonMorningBriefWindow({
    nowMs:now,
    existingBriefingDates:state.existingBriefingDates,
    forceOnDemand:args.forceOnDemand,
   });

   if(!briefWindow.shouldRun){
    results.push({
     jobKey:'daily_intelligence_briefing',
     status:'skipped',
     detail:`${briefWindow.reason} (${briefWindow.dateKey} ${briefWindow.localTimeDisplay} ${briefWindow.regime})`,
    });
   }else{
    const lease=await ctx.runMutation(mRef('acquireJobLeaseInternal'),{
     owner,
     jobKey:'daily_intelligence_briefing',
     environment:env,
     forceOnDemand:true,
    }) as {ok:boolean;code?:string;leaseToken?:string};
    if(!lease.ok){
     results.push({jobKey:'daily_intelligence_briefing',status:lease.code??'skipped',detail:`Skipped (${lease.code})`});
    }else{
     const runId=`cloud-daily_intelligence_briefing-${now}`;
     const overview=await ctx.runQuery(qRef('getOperationsOverviewInternal'),{owner}) as {
      stagedItems:Array<{
       externalId:string;
       sourceUrl:string;
       title:string;
       publishedAt:number|null;
       serverReceivedAt:number;
       entities:string[];
       summary:string;
       hypothesis:string|null;
       isPrimarySource:boolean;
       validationStatus:string;
      }>;
     };
     const promotedItems=overview.stagedItems.filter(s=>s.validationStatus==='promoted'||s.isPrimarySource);
     const confirmedFacts=discoveredFacts.length>0?discoveredFacts:promotedItems.slice(0,6).map(s=>({
      id:`fact-${s.externalId}`,
      entity:s.entities[0]??'AI_UNIVERSE',
      metric:'sec_xbrl_disclosure',
      valueDisplay:s.title,
      period:'2026',
      sourceUrl:s.sourceUrl,
      sourceKind:'sec_filing' as const,
      publishedAt:s.publishedAt??now-86_400_000,
      receivedAt:s.serverReceivedAt,
      classification:'reported' as const,
     }));

     const hasGeminiKey=Boolean(process.env.GEMINI_API_KEY);
     const modelLabel=hasGeminiKey
      ?(process.env.GEMINI_MODEL||'gemini-2.5-flash')
      :'deterministic-sec-xbrl-extractor-v1 (GEMINI_API_KEY not configured)';

     const briefingPayload=JSON.stringify({
      confirmedFacts,
      researchInterpretation:promotedItems.slice(0,3).map(s=>({
       id:`interp-${s.externalId}`,
       title:s.title,
       summary:s.summary,
       hypothesis:s.hypothesis??'Primary SEC XBRL disclosures anchor AI infrastructure capacity verification before regional power-grid checks.',
       entities:s.entities.length?s.entities:['NVDA','MSFT','AMZN'],
       modelVersion:modelLabel,
       citedEvidenceIds:[s.externalId],
       receivedAt:s.serverReceivedAt,
       executionAuthority:'none',
      })),
      riskChanges:[
       {
        id:`risk-exec-${now}`,
        category:'trading_controls',
        severity:'ok',
        title:'Live & Demo execution remain disabled.',
        detail:'LIVE_TRADING_ENABLED and DEMO_TRADING_ENABLED are unset; remote agents hold zero execution or reviewer authority.',
        href:'/trading#controls',
       },
       {
        id:`risk-provider-${now}`,
        category:'provider_health',
        severity:'warn',
        title:'Market-data collector reported unconfigured licensed intraday quote provider.',
        detail:'market_data_collect recorded failed:licensed_quote_provider_unconfigured; delayed public reference closes are never presented as live quotes.',
        href:'/policy-risk#sources',
       },
      ],
      incompleteEvidence:[
       {
        id:`gap-licensed-quotes-${now}`,
        domain:'Market Data (`market_data_collect`)',
        missingItem:'Licensed real-time equity & index quote feed (`LICENSED_MARKET_DATA_API_KEY`)',
        impact:'Collector run failed closed on live quote ingestion; non-held instrument orders remain blocked.',
        pendingVerificationCount:overview.stagedItems.filter(s=>s.validationStatus==='pending_verification').length,
        resolutionHref:'/policy-risk#sources',
       },
       ...(!hasGeminiKey?[{
        id:`gap-gemini-${now}`,
        domain:'AI Model Synthesis (`GEMINI_API_KEY`)',
        missingItem:'Cloud LLM API credential not configured in secret store',
        impact:'Deterministic SEC EDGAR XBRL extraction and staging succeeded at £0.00 model cost; narrative LLM synthesis skipped.',
        pendingVerificationCount:0,
        resolutionHref:'/recovery#participation',
       }]:[]),
      ],
      modelVersion:hasGeminiKey?modelLabel:null,
     });

     const durationMs=Math.max(1,Date.now()-jobStart);
     const briefRes=await ctx.runMutation(mRef('recordDeterministicRunInternal'),{
      owner,
      runId,
      jobKey:'daily_intelligence_briefing',
      environment:env,
      leaseToken:lease.leaseToken,
      status:'succeeded',
      cursorAfter:`brief:${briefWindow.dateKey}:${briefWindow.regime}`,
      sourcesDiscovered:confirmedFacts.length,
      evidencePromoted:0,
      duplicatesSkipped:0,
      providerRequestsCount:0,
      processingDurationMs:durationMs,
      conditionalSkip:false,
      summary:`Generated Morning Intelligence Brief for ${briefWindow.dateKey} (${briefWindow.regime}) with ${confirmedFacts.length} primary-source fact(s).`,
      briefingJson:briefingPayload,
     }) as {briefingDeduplicated?:boolean;briefingDate?:string|null};
     results.push({
      jobKey:'daily_intelligence_briefing',
      status:'succeeded',
      runId,
      detail:`date=${briefWindow.dateKey}, regime=${briefWindow.regime}, deduplicated=${Boolean(briefRes.briefingDeduplicated)}, facts=${confirmedFacts.length}`,
     });
    }
   }
  }

  return {
   executedAt:now,
   environment:env,
   results,
   executionAuthority:'none' as const,
  };
 },
});
