// Verifies Phase 003.1 unattended cloud operations against https://prestigious-dragon-8.eu-west-1.convex.cloud
// and https://prestigious-dragon-8.eu-west-1.convex.site while the local Next.js server is stopped.
// Never prints any secret or token value.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {ConvexHttpClient} from 'convex/browser';
import {makeFunctionReference} from 'convex/server';

const envLines=readFileSync('.env.local','utf8').split(/\r?\n/);
const getEnv=k=>{
 const line=envLines.find(l=>l.startsWith(`${k}=`));
 return line?line.slice(k.length+1).trim():'';
};

const convexUrl=getEnv('NEXT_PUBLIC_CONVEX_URL');
const siteUrl=getEnv('NEXT_PUBLIC_CONVEX_SITE_URL');
const adminKey=getEnv('CONVEX_STAGING_DEPLOY_KEY')||getEnv('CONVEX_IMPORT_ADMIN_KEY');
const stagingToken=getEnv('RESEARCH_STAGING_TOKEN');
const schedulerSecret=getEnv('OPERATIONS_SCHEDULER_SECRET');
const owner=getEnv('RESEARCH_OWNER_ID');

if(!convexUrl||!siteUrl||!adminKey||!stagingToken||!schedulerSecret||!owner){
 console.error('Missing required cloud configuration in .env.local');
 process.exit(2);
}

const client=new ConvexHttpClient(convexUrl,{logger:false});
client.setAdminAuth(adminKey);
const qRef=name=>makeFunctionReference(`operations:${name}`);

async function main(){
 // 1. Confirm localhost:3000 is NOT serving requests.
 let localUp=false;
 try{
  const r=await fetch('http://localhost:3000',{signal:AbortSignal.timeout(1500)});
  if(r.ok)localUp=true;
 }catch{
  localUp=false;
 }
 console.log(JSON.stringify({check:'local_dev_server_off',localhost3000Serving:localUp}));

 // 2. Check initial state on Convex cloud (see if Convex cloud cron already fired!).
 const before=await client.query(qRef('getOperationsOverviewInternal'),{owner});
 console.log(JSON.stringify({
  check:'initial_cloud_state',
  recentRunCount:before.recentRuns.length,
  recentRuns:before.recentRuns.slice(0,8).map(r=>({
   runId:r.runId,
   jobKey:r.jobKey,
   environment:r.environment,
   status:r.status,
   startedAt:new Date(r.startedAt).toISOString(),
   finishedAt:r.finishedAt?new Date(r.finishedAt).toISOString():null,
   sourcesDiscovered:r.sourcesDiscovered,
   evidencePromoted:r.evidencePromoted,
   errorCode:r.errorCode,
   summary:r.summary,
  })),
 },null,2));

 // 3. Security checks against live cloud HTTP endpoint (https://prestigious-dragon-8.eu-west-1.convex.site)
 const unauthRes=await fetch(`${siteUrl}/api/research/staging`);
 const forbiddenOwnerRes=await fetch(`${siteUrl}/api/research/staging`,{
  method:'POST',
  headers:{
   'Content-Type':'application/json',
   'Authorization':`Bearer ${stagingToken}`,
  },
  body:JSON.stringify({owner:'attacker-owner',runId:'bad-1'}),
 });
 const forbiddenTradeRes=await fetch(`${siteUrl}/api/research/staging`,{
  method:'POST',
  headers:{
   'Content-Type':'application/json',
   'Authorization':`Bearer ${stagingToken}`,
  },
  body:JSON.stringify({liveTradingEnabled:true,runId:'bad-2'}),
 });
 const cursorRes=await fetch(`${siteUrl}/api/research/staging`,{
  headers:{'Authorization':`Bearer ${stagingToken}`},
 });
 const cursorJson=await cursorRes.json();

 console.log(JSON.stringify({
  check:'cloud_http_security_boundaries',
  siteUrl,
  unauthenticatedStatus:unauthRes.status,
  clientSuppliedOwnerStatus:forbiddenOwnerRes.status,
  enableTradingAttemptStatus:forbiddenTradeRes.status,
  validStagingCursorStatus:cursorRes.status,
  cursorExecutionAuthority:cursorJson.executionAuthority,
  cursorUniverseCount:cursorJson.universe?.length,
  cursorPayloadLimits:cursorJson.payloadLimits,
  cursorRateLimits:cursorJson.rateLimits,
 },null,2));

 // 4. Run Python remote research worker against live SEC EDGAR (INTC, AMD) and submit to cloud staging URL
 const runId=`py-remote-sec-${Date.now()}`;
 const pyEnv={
  PATH:process.env.PATH,
  SYSTEMROOT:process.env.SYSTEMROOT,
  RESEARCH_STAGING_TOKEN:stagingToken,
  SEC_USER_AGENT:getEnv('SEC_USER_AGENT')||'AICapitalIntelligence/0.3 (compliance@vectis.ai)',
 };
 const pyRun=spawnSync(
  'python',
  [
   '-m','worker.remote_research',
   '--live-sec','INTC','AMD',
   '--run-id',runId,
   '--submit-url',`${siteUrl}/api/research/staging`,
  ],
  {env:pyEnv,encoding:'utf8',timeout:60_000},
 );
 if(pyRun.status!==0){
  console.error('Python remote research run failed:',pyRun.stderr);
  process.exit(3);
 }
 console.log(JSON.stringify({
  check:'python_live_sec_remote_cycle',
  output:JSON.parse(pyRun.stdout),
 },null,2));

 // 5. Trigger two consecutive cloud cycles via cloud HTTP endpoint to prove:
 //    (a) Full 6-ticker SEC coverage in Convex Cloud (`NVDA, MSFT, AMZN, GOOGL, INTC, AMD`)
 //    (b) Source cursor & change-detection conditional skip (0 model calls, 0 redundant XBRL downloads)
 //    (c) Strict 07:30 Europe/London 1-briefing-per-UK-date deduplication (`already_generated_for_uk_date`)
 const cycle1Res=await fetch(`${siteUrl}/api/operations/scheduled`,{
  method:'POST',
  headers:{
   'Content-Type':'application/json',
   'Authorization':`Bearer ${schedulerSecret}`,
  },
  body:JSON.stringify({environment:'remote',forceOnDemand:true}),
 });
 const cycle1Json=await cycle1Res.json();

 const cycle2Res=await fetch(`${siteUrl}/api/operations/scheduled`,{
  method:'POST',
  headers:{
   'Content-Type':'application/json',
   'Authorization':`Bearer ${schedulerSecret}`,
  },
  body:JSON.stringify({environment:'remote',forceOnDemand:true}),
 });
 const cycle2Json=await cycle2Res.json();

 console.log(JSON.stringify({
  check:'cloud_scheduled_endpoint_cycles',
  cycle1Status:cycle1Res.status,
  cycle1Response:cycle1Json,
  cycle2Status:cycle2Res.status,
  cycle2Response:cycle2Json,
 },null,2));

 // 6. Read final Convex cloud state (5 operational layers, executionPaths, marketData, missingEvidenceResolution, forwardResearchEvents, runs, trusted timestamps, Morning Intelligence Brief).
 const after=await client.query(qRef('getOperationsOverviewInternal'),{owner});
 console.log(JSON.stringify({
  check:'final_cloud_state',
  marketData:after.marketData?{
   totalObservationsStored:after.marketData.totalObservationsStored,
   coveredSymbols:after.marketData.coveredSymbols,
   latestBySymbol:after.marketData.latestBySymbol.map(o=>({
    symbol:o.symbol,
    sessionDate:o.sessionDate,
    eventAt:new Date(o.eventAt).toISOString(),
    serverReceivedAt:new Date(o.serverReceivedAt).toISOString(),
    closeUsd:o.close,
    usdToGbp:o.usdToGbp,
    closeGbp:o.closeGbp,
    provider:o.provider,
    sourceId:o.sourceId,
    priceBasis:o.priceBasis,
    adjustmentVersion:o.adjustmentVersion,
    corporateActionsReviewed:o.corporateActionsReviewed,
    declaredDelayMs:o.declaredDelayMs,
   })),
  }:null,
  missingEvidenceResolution:after.missingEvidenceResolution?{
   totalWindows:after.missingEvidenceResolution.totalWindows,
   completedWindows:after.missingEvidenceResolution.completedWindows,
   scoredWindows:after.missingEvidenceResolution.scoredWindows,
   blockedIncompleteWindows:after.missingEvidenceResolution.blockedIncompleteWindows,
   pendingFutureWindows:after.missingEvidenceResolution.pendingFutureWindows,
   windows:after.missingEvidenceResolution.windows.map(w=>({
    windowId:w.windowId,
    studyName:w.studyName,
    status:w.status,
    scored:w.scored,
    recalculated:w.recalculated,
    blockingReasons:w.blockingReasons,
    equalWeightReturnUsd:w.outcome?.equalWeightReturnUsd??null,
    equalWeightReturnGbp:w.outcome?.equalWeightReturnGbp??null,
    benchmarkReturnUsd:w.outcome?.benchmarkReturnUsd??null,
    excessReturnUsd:w.outcome?.excessReturnUsd??null,
    excessReturnGbp:w.outcome?.excessReturnGbp??null,
   })),
  }:null,
  forwardResearchEvents:(after.forwardResearchEvents??[]).map(f=>({
   eventKey:f.eventKey,
   name:f.name,
   symbol:f.symbol,
   benchmarkSymbol:f.benchmarkSymbol,
   horizon:f.horizon,
   registeredAt:new Date(f.registeredAt).toISOString(),
   cutoffAt:new Date(f.cutoffAt).toISOString(),
   anchorSessionDate:f.anchorSessionDate,
   targetEndSessionDate:f.targetEndSessionDate,
   evidenceSha256:f.evidenceSha256,
   evidenceItemsCount:f.evidenceItems.length,
   participants:f.participants.map(p=>({
    participantId:p.participantId,
    modelVersion:p.modelVersion,
    status:p.status,
    inputTokens:p.inputTokens,
    outputTokens:p.outputTokens,
    estimatedCostGbp:p.estimatedCostGbp,
    actualBilledCostGbp:p.actualBilledCostGbp,
    costStatus:p.costStatus,
    evidenceSha256:p.evidenceSha256,
    expectedReturn:p.forecast?.expectedReturn??null,
    probabilities:p.forecast?.probabilities??null,
    decision:p.forecast?.decision??null,
   })),
   evaluation:f.evaluation,
   executionAuthority:f.executionAuthority,
  })),
  healthSummary:{
   systemEnabled:after.health.systemEnabled,
   activeEnvironment:after.health.activeEnvironment,
   deterministicCollectionHealthy:after.health.deterministicCollectionHealthy,
   dailyCostGbp:after.health.dailyCostGbp,
   operationalLayers:after.health.operationalLayers,
   executionPaths:after.health.executionPaths,
   jobs:after.health.jobs.map(j=>({
    jobKey:j.jobKey,
    environment:j.environment,
    status:j.enabled?'enabled':'disabled',
    lastSuccessAt:j.lastSuccessAt?new Date(j.lastSuccessAt).toISOString():null,
    lastFailureAt:j.lastFailureAt?new Date(j.lastFailureAt).toISOString():null,
    nextRunAt:new Date(j.nextRunAt).toISOString(),
    freshness:j.freshness,
    lastErrorCode:j.lastErrorCode,
    providerRequestsLastRun:j.providerRequestsLastRun,
    processingDurationMsLastRun:j.processingDurationMsLastRun,
    conditionalSkipLastRun:j.conditionalSkipLastRun,
    sourcesAdded:j.sourcesAdded,
    evidenceAdded:j.evidenceAdded,
   })),
  },
  recentRuns:after.recentRuns.slice(0,10).map(r=>({
   runId:r.runId,
   jobKey:r.jobKey,
   environment:r.environment,
   status:r.status,
   startedAt:new Date(r.startedAt).toISOString(),
   finishedAt:r.finishedAt?new Date(r.finishedAt).toISOString():null,
   cursorBefore:r.cursorBefore,
   cursorAfter:r.cursorAfter,
   sourcesDiscovered:r.sourcesDiscovered,
   evidenceStaged:r.evidenceStaged,
   evidencePromoted:r.evidencePromoted,
   duplicatesSkipped:r.duplicatesSkipped,
   providerRequestsCount:r.providerRequestsCount,
   processingDurationMs:r.processingDurationMs,
   conditionalSkip:r.conditionalSkip,
   modelVersion:r.modelVersion,
   estimatedCostGbp:r.estimatedCostGbp,
   actualCostGbp:r.actualCostGbp,
   errorCode:r.errorCode,
   summary:r.summary,
  })),
  stagedItems:after.stagedItems.slice(0,10).map(s=>({
   externalId:s.externalId,
   runId:s.runId,
   sourceUrl:s.sourceUrl,
   title:s.title,
   publishedAt:s.publishedAt?new Date(s.publishedAt).toISOString():null,
   serverReceivedAt:new Date(s.serverReceivedAt).toISOString(),
   sourceRetrievedAt:new Date(s.sourceRetrievedAt).toISOString(),
   importedAt:new Date(s.importedAt).toISOString(),
   untrustedAgentMetadata:s.untrustedAgentMetadata,
   validationStatus:s.validationStatus,
   researchEligible:s.researchEligible,
   marketOutcomeEligible:s.marketOutcomeEligible,
  })),
  latestBriefing:after.latestBriefing?{
   briefingDate:after.latestBriefing.briefingDate,
   generatedAt:new Date(after.latestBriefing.generatedAt).toISOString(),
   timezone:after.latestBriefing.timezone,
   confirmedFactsCount:after.latestBriefing.confirmedFacts.length,
   confirmedFacts:after.latestBriefing.confirmedFacts,
   researchInterpretationCount:after.latestBriefing.researchInterpretation.length,
   riskChangesCount:after.latestBriefing.riskChanges.length,
   incompleteEvidence:after.latestBriefing.incompleteEvidence,
   modelVersion:after.latestBriefing.modelVersion,
   executionAuthority:after.latestBriefing.executionAuthority,
  }:null,
 },null,2));
}

main().catch(err=>{
 console.error(err);
 process.exit(1);
});
