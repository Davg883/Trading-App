import {afterEach,describe,expect,it,vi} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';
import {CONVEX_DEPLOYMENT_FINGERPRINT} from '../convex/deploymentFingerprint';
import {assessSecFilingClaimIntegrity,accessionFromSecArchiveUrl} from '../lib/remote-ops/evidence-integrity';
import {validateStagedItem} from '../lib/remote-ops/staging-validator';
import {runNewsResearchAgentWorkflow} from '../lib/remote-ops/news-agent';
import {selectCurrentSecXbrlFact} from '../lib/remote-ops/sec-xbrl-fact-selector';
import {evaluateCollectionHealth,SCHEDULER_OVERDUE_AFTER_MS} from '../lib/remote-ops/health-monitor';
import {evaluateReleaseCompatibility} from '../lib/release/fingerprint-compatibility';
import {computeConvexFingerprint} from '../scripts/lib/convex-fingerprint.mjs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AgentOperationsPanel} from '../components/command-centre/agent-operations-panel';
import {MorningBriefPanel} from '../components/command-centre/morning-brief-panel';
import {resolveDisplayedBriefing} from '../lib/remote-ops/briefing-provenance';

/**
 * Sprint G9.2 — research integrity & environment recovery regression suite.
 * Fixtures mirror the real defective dev records found on 2026-11-16 (prior-year comparative XBRL facts promoted as
 * the current period of 2026 filings) and the primary-filing values verified for the corrected re-ingestion.
 */

const NVDA_URL='https://www.sec.gov/Archives/edgar/data/1045810/000104581026000075/nvda-20260726.htm';
const AMZN_URL='https://www.sec.gov/Archives/edgar/data/1018724/000101872426000040/amzn-20260930.htm';
const AMD_URL='https://www.sec.gov/Archives/edgar/data/2488/000000248826000191/amd-20260926.htm';
const NOW=Date.parse('2026-11-16T23:50:00Z');

describe('SEC filing claim integrity rule',()=>{
 it('extracts the accession from an EDGAR Archives URL',()=>{
  expect(accessionFromSecArchiveUrl(NVDA_URL)).toBe('0001045810-26-000075');
  expect(accessionFromSecArchiveUrl('https://www.sec.gov/Archives/edgar/data/789019/msft-2026q3-10q.htm')).toBeNull();
 });

 it('rejects the real NVDA defect: a 2020 accession and period attached to the 2026 10-Q',()=>{
  const v=assessSecFilingClaimIntegrity({
   sourceUrl:NVDA_URL,
   title:'NVIDIA Corporation (NVDA) SEC Form 10-Q (0001045810-20-000147) — Q2 2020 (YTD) XBRL disclosure',
   text:'In SEC Form 10-Q (accession 0001045810-20-000147, filed 2020-08-19, period ended 2020-07-26), NVIDIA Corporation (NVDA) reported $0.37 billion in capital expenditures for Q2 2020 (YTD).',
   claim:{period:'Q22020'},
  });
  expect(v).toMatchObject({status:'reject',reasonCode:'sec_accession_mismatch'});
 });

 it('rejects a prior-year comparative column even when the accession matches (AMD 9M 2025 in the 2026 10-Q)',()=>{
  const v=assessSecFilingClaimIntegrity({
   sourceUrl:AMD_URL,
   title:'Advanced Micro Devices, Inc. (AMD) SEC Form 10-Q (0000002488-26-000191) — Q3 2025 (YTD) XBRL disclosure',
   text:'In SEC Form 10-Q (accession 0000002488-26-000191, filed 2026-11-04, period ended 2025-09-27), AMD reported $0.75 billion in capital expenditures.',
   claim:{period:'2025'},
  });
  expect(v).toMatchObject({status:'reject',reasonCode:'sec_comparative_or_obsolete_period'});
 });

 it('holds 8-K-attributed financial facts and facts without a period end for verification',()=>{
  expect(assessSecFilingClaimIntegrity({
   sourceUrl:'https://www.sec.gov/Archives/edgar/data/789019/000119312526448357/d177209d8k.htm',
   title:'Microsoft Corporation (MSFT) SEC Form 8-K (0001193125-26-448357) — Q1 2027 XBRL disclosure',
   text:'In SEC Form 8-K (accession 0001193125-26-448357, filed 2026-11-05), Microsoft reported $19.39 billion in capital expenditures for Q1 2027.',
   claim:{period:'2026'},
  })).toMatchObject({status:'pending',reasonCode:'sec_periodic_report_required'});
  expect(assessSecFilingClaimIntegrity({
   sourceUrl:AMD_URL,
   title:'AMD SEC Form 10-Q (0000002488-26-000191)',
   text:'(accession 0000002488-26-000191, filed 2026-11-04), Advanced Micro Devices, Inc. (AMD) reported $0.75 billion in capital expenditures for Q3 2026.',
   claim:{period:'2026'},
  })).toMatchObject({status:'pending',reasonCode:'sec_period_end_missing'});
 });

 it('accepts the verified current-period facts (NVDA FY27 Q2 YTD $4.43bn, AMZN Q3 2026 $77.26bn) and long-form dates',()=>{
  expect(assessSecFilingClaimIntegrity({
   sourceUrl:NVDA_URL,
   title:'NVIDIA Corp. (NVDA) SEC Form 10-Q (0001045810-26-000075) — Q2 2027 (YTD) XBRL disclosure',
   text:'In SEC Form 10-Q (accession 0001045810-26-000075, filed 2026-08-26, period ended 2026-07-26), NVIDIA Corp. (NVDA) reported $4.43 billion in capital expenditures for Q2 2027 (YTD).',
   claim:{period:'Q2 2027 (YTD)'},
  })).toMatchObject({status:'ok',filingAccession:'0001045810-26-000075',periodEnd:'2026-07-26'});
  expect(assessSecFilingClaimIntegrity({
   sourceUrl:AMZN_URL,
   title:'Amazon.com, Inc. (AMZN) SEC Form 10-Q',
   text:'Amazon.com, Inc. Form 10-Q for the quarterly period ended September 30, 2026 reports purchases of property and equipment of $77,259 million.',
   claim:{period:'Q3 2026'},
   publishedAtMs:Date.parse('2026-10-29T22:20:46Z'),
  })).toMatchObject({status:'ok',periodEnd:'2026-09-30',filed:'2026-10-29'});
 });
});

describe('Staging validator never promotes comparative or misattributed SEC facts',()=>{
 const ctx=()=>({now:NOW,seenUrls:new Set<string>(),seenContentHashes:new Set<string>(),seenFactKeys:new Set<string>()});
 const candidate=(text:string,title:string,period:string,value:number)=>({
  externalId:`t-${period}-${value}`,
  sourceUrl:NVDA_URL,
  title,
  text,
  summary:'SEC XBRL capex disclosure.',
  publishedAt:Date.parse('2026-08-26T20:36:00Z'),
  receivedAt:NOW-1000,
  entities:['NVDA'],
  claims:[{id:'c1',entity:'NVDA',metric:'capital_expenditures',value,unit:'billions_usd',period,definition:'Capital expenditures',excerpt:text.slice(0,180),classification:'observed' as const,isPrimarySource:true,primarySourceUrl:NVDA_URL}],
  primarySourceUrl:NVDA_URL,
 });

 it('rejects the exact legacy NVDA record shape and promotes nothing',()=>{
  const r=validateStagedItem(candidate(
   'In SEC Form 10-Q (accession 0001045810-20-000147, filed 2020-08-19, period ended 2020-07-26), NVIDIA Corporation (NVDA) reported $0.37 billion in capital expenditures for Q2 2020 (YTD).',
   'NVIDIA Corporation (NVDA) SEC Form 10-Q (0001045810-20-000147) — Q2 2020 (YTD) XBRL disclosure','Q22020',0.37),ctx());
  expect(r.validationStatus).toBe('rejected');
  expect(r.promotableFacts).toHaveLength(0);
  expect(r.validationReasons.join(' ')).toContain('sec_accession_mismatch');
 });

 it('promotes the corrected current-period record',()=>{
  const r=validateStagedItem(candidate(
   'In SEC Form 10-Q (accession 0001045810-26-000075, filed 2026-08-26, period ended 2026-07-26), NVIDIA Corp. (NVDA) reported $4.43 billion in capital expenditures for Q2 2027 (YTD).',
   'NVIDIA Corp. (NVDA) SEC Form 10-Q (0001045810-26-000075) — Q2 2027 (YTD) XBRL disclosure','Q2 2027 (YTD)',4.43),ctx());
  expect(r.validationStatus).toBe('promoted');
  expect(r.promotableFacts[0]).toMatchObject({symbol:'NVDA',value:4.43});
 });
});

describe('Selector picks the current period, never the comparative columns re-reported in the same filing',()=>{
 it('AMZN: obsolete 2015-2017 concept rows and 2025 comparatives lose to the Q3 2026 three-month fact',()=>{
  const r=selectCurrentSecXbrlFact({
   asOfMs:NOW,
   header:{ticker:'AMZN',cik:'0001018724',name:'Amazon.com, Inc.',accession:'0001018724-26-000040',form:'10-Q',filed:'2026-10-30',reportDate:'2026-09-30',docUrl:AMZN_URL,publishedMs:Date.parse('2026-10-29T22:20:46Z'),receivedMs:NOW},
   factsPayload:{facts:{'us-gaap':{
    PaymentsToAcquirePropertyPlantAndEquipment:{units:{USD:[
     {val:4_897_000_000,fy:2017,fp:'Q1',form:'10-Q',filed:'2017-04-28',accn:'0001018724-17-000051',start:'2015-04-01',end:'2016-03-31'},
     {val:1_861_000_000,fy:2017,fp:'Q1',form:'10-Q',filed:'2017-04-28',accn:'0001018724-17-000051',start:'2017-01-01',end:'2017-03-31',frame:'CY2017Q1'},
    ]}},
    PaymentsToAcquireProductiveAssets:{units:{USD:[
     {val:35_095_000_000,fy:2026,fp:'Q3',form:'10-Q',filed:'2026-10-30',accn:'0001018724-26-000040',start:'2025-07-01',end:'2025-09-30',frame:'CY2025Q3'},
     {val:92_297_000_000,fy:2026,fp:'Q3',form:'10-Q',filed:'2026-10-30',accn:'0001018724-26-000040',start:'2025-01-01',end:'2025-09-30'},
     {val:175_670_000_000,fy:2026,fp:'Q3',form:'10-Q',filed:'2026-10-30',accn:'0001018724-26-000040',start:'2026-01-01',end:'2026-09-30'},
     {val:77_259_000_000,fy:2026,fp:'Q3',form:'10-Q',filed:'2026-10-30',accn:'0001018724-26-000040',start:'2026-07-01',end:'2026-09-30',frame:'CY2026Q3'},
    ]}},
   }}},
  });
  expect(r).toMatchObject({eligible:true,isCurrentReportingPeriod:true,accessionMatched:true,conceptName:'PaymentsToAcquireProductiveAssets',periodStart:'2026-07-01',periodEnd:'2026-09-30',valueBillions:77.26,periodSpanKind:'three_month'});
 });

 it('AMD: with only nine-month spans, the current YTD (1.845bn) wins over the 2025 comparative (0.752bn) in the same accession',()=>{
  const r=selectCurrentSecXbrlFact({
   asOfMs:NOW,
   header:{ticker:'AMD',cik:'0000002488',name:'Advanced Micro Devices, Inc.',accession:'0000002488-26-000191',form:'10-Q',filed:'2026-11-04',reportDate:'2026-09-26',docUrl:AMD_URL,publishedMs:Date.parse('2026-11-04T16:00:00Z'),receivedMs:NOW},
   factsPayload:{facts:{'us-gaap':{PaymentsToAcquirePropertyPlantAndEquipment:{units:{USD:[
    {val:752_000_000,fy:2026,fp:'Q3',form:'10-Q',filed:'2026-11-04',accn:'0000002488-26-000191',start:'2024-12-29',end:'2025-09-27'},
    {val:1_845_000_000,fy:2026,fp:'Q3',form:'10-Q',filed:'2026-11-04',accn:'0000002488-26-000191',start:'2025-12-28',end:'2026-09-26'},
   ]}}}}},
  });
  expect(r).toMatchObject({eligible:true,isCurrentReportingPeriod:true,periodEnd:'2026-09-26',val:1_845_000_000});
 });
});

const modules={
 './_generated/server.ts':async()=>({}),
 './operations.ts':()=>import('../convex/operations'),
 './authz.ts':()=>import('../convex/authz'),
};
const opsM=(n:string)=>makeFunctionReference<'mutation'>(`operations:${n}`);
const opsQ=(n:string)=>makeFunctionReference<'query'>(`operations:${n}`);
const OWNER='https://issuer.test|user_owner';
const OTHER='https://issuer.test|user_other';

afterEach(()=>vi.useRealTimers());

describe('Quarantine ledger and auditable re-ingestion of previously seen filing URLs',()=>{
 it('quarantines without deleting, excludes from research, allows corrected re-ingestion and links the replacement',async()=>{
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const t=convexTest(schema,modules);
  const owner=t.withIdentity({subject:'user_owner',tokenIdentifier:OWNER});
  const other=t.withIdentity({subject:'user_other',tokenIdentifier:OTHER});

  // Seed the exact legacy record shape as it exists in the dev deployment (promoted before the integrity rule existed).
  const seeded=await t.run(async ctx=>{
   const evId=await ctx.db.insert('evidence',{owner:OWNER,source:NVDA_URL,symbol:'NVDA',metric:'capital_expenditures',value:0.37,unit:'billions_usd',period:'Q22020',definition:'Capital expenditures',status:'measured',publishedAt:Date.parse('2026-08-26T20:36:00Z'),receivedAt:NOW-86_400_000});
   const stId=await ctx.db.insert('researchStagingItems',{owner:OWNER,externalId:'staged-legacy-nvda',runId:'cloud-news_discovery_agent-legacy',agentId:'convex-cloud-remote-agent',sourceUrl:NVDA_URL,sourceDomain:'www.sec.gov',title:'NVIDIA Corporation (NVDA) SEC Form 10-Q (0001045810-20-000147) — Q2 2020 (YTD) XBRL disclosure',contentSha256:'legacyhash',publishedAt:Date.parse('2026-08-26T20:36:00Z'),receivedAt:NOW-86_400_000,ingestedAt:NOW-86_400_000,entities:['NVDA'],claimsJson:JSON.stringify([{id:'c1',entity:'NVDA',metric:'capital_expenditures',value:0.37,unit:'billions_usd',period:'Q22020'}]),summary:'legacy',isPrimarySource:true,primarySourceUrl:NVDA_URL,validationStatus:'promoted',validationReasons:['primary_source_verified'],researchEligible:true,marketOutcomeEligible:false,promotedEvidenceIds:[evId],executionAuthority:'none',version:'remote-ops-003-v1'});
   const brId=await ctx.db.insert('morningBriefings',{owner:OWNER,briefingDate:'2026-11-15',generatedAt:NOW-30*3600_000,timezone:'Europe/London',confirmedFactsJson:JSON.stringify([{id:'fact-NVDA-0001045810-20-000147',valueDisplay:'$0.37B'}]),researchInterpretationJson:'[]',riskChangesJson:'[]',incompleteEvidenceJson:'[]',modelVersion:null,executionAuthority:'none',version:'remote-ops-003-v1'});
   return {evId,stId,brId};
  });

  const item={stagingItemId:seeded.stId,reasonCode:'sec_accession_mismatch',reason:'2020 comparative presented as FY27 Q2',claimedJson:'{"value":0.37}',expectedJson:'{"value":4.43}'};
  const dry=await t.mutation(opsM('quarantineStagedEvidenceInternal'),{owner:OWNER,quarantinedBy:'test',dryRun:true,items:[item]}) as {report:Array<{status:string;affectedBriefings:unknown[]}>};
  expect(dry.report[0].status).toBe('would_quarantine');
  expect(dry.report[0].affectedBriefings).toHaveLength(1);
  expect(await t.run(ctx=>ctx.db.query('evidenceQuarantines').collect())).toHaveLength(0);

  const real=await t.mutation(opsM('quarantineStagedEvidenceInternal'),{owner:OWNER,quarantinedBy:'test',items:[item]}) as {report:Array<{status:string}>};
  expect(real.report[0].status).toBe('quarantined');
  const again=await t.mutation(opsM('quarantineStagedEvidenceInternal'),{owner:OWNER,quarantinedBy:'test',items:[item]}) as {report:Array<{status:string}>};
  expect(again.report[0].status).toBe('already_quarantined');

  // Originals are preserved (values and statuses unchanged), only marked.
  const after=await t.run(async ctx=>({st:await ctx.db.get(seeded.stId),ev:await ctx.db.get(seeded.evId),br:await ctx.db.get(seeded.brId),audit:await ctx.db.query('audit').collect()}));
  expect(after.st).toMatchObject({validationStatus:'promoted',title:expect.stringContaining('0001045810-20-000147')});
  expect(after.st?.quarantinedAt).toBeGreaterThanOrEqual(NOW);
  expect(after.ev).toMatchObject({value:0.37,quarantinedAt:after.st?.quarantinedAt});
  expect(after.br?.confirmedFactsJson).toContain('fact-NVDA-0001045810-20-000147');
  expect(after.audit.some(a=>a.action==='evidence_quarantined')).toBe(true);

  // The filing URL is no longer "seen", so the corrected selector output can be re-ingested.
  const state=await t.query(makeFunctionReference<'query'>('operations:getStagingStateInternal'),{owner:OWNER}) as {seenUrls:string[]};
  expect(state.seenUrls).not.toContain(NVDA_URL);

  // Owner overview hides the quarantined record from research and lists it for audit; another user sees nothing.
  const ov=await owner.query(opsQ('overview'),{}) as {stagedItems:unknown[];quarantinedEvidence:Array<{ticker:string;replacedAt:number|null}>};
  expect(ov.stagedItems).toHaveLength(0);
  expect(ov.quarantinedEvidence).toMatchObject([{ticker:'NVDA',replacedAt:null}]);
  const ovOther=await other.query(opsQ('overview'),{}) as {quarantinedEvidence:unknown[]};
  expect(ovOther.quarantinedEvidence).toHaveLength(0);

  // The stored 2026-11-15 briefing is not rewritten, but its quarantined fact is withheld from display with a reason.
  const ovBrief=await owner.query(opsQ('overview'),{}) as {latestBriefing:{briefingDate:string;confirmedFacts:Array<{id:string}>;withheldFacts:Array<{id:string;reason:string}>}};
  expect(ovBrief.latestBriefing.briefingDate).toBe('2026-11-15');
  expect(ovBrief.latestBriefing.confirmedFacts.map(f=>f.id)).not.toContain('fact-NVDA-0001045810-20-000147');
  expect(ovBrief.latestBriefing.withheldFacts).toMatchObject([{id:'fact-NVDA-0001045810-20-000147',reason:expect.stringContaining('sec_accession_mismatch')}]);

  // Corrected re-ingestion of the same URL promotes and is linked as the replacement.
  const lease=await t.mutation(opsM('acquireJobLeaseInternal'),{owner:OWNER,jobKey:'news_discovery_agent',environment:'remote',forceOnDemand:true}) as {ok:boolean;leaseToken:string;cursor:string|null};
  expect(lease.ok).toBe(true);
  const wf=runNewsResearchAgentWorkflow({
   runId:'g9-2-reingest',cursorBefore:lease.cursor,now:NOW,
   candidates:[{url:NVDA_URL,title:'NVIDIA Corp. (NVDA) SEC Form 10-Q (0001045810-26-000075) — Q2 2027 (YTD) XBRL disclosure',text:'In SEC Form 10-Q (accession 0001045810-26-000075, filed 2026-08-26, period ended 2026-07-26), NVIDIA Corp. (NVDA) reported $4.43 billion in capital expenditures for Q2 2027 (YTD). Primary XBRL filing retrieved from '+NVDA_URL+'.',publishedAt:Date.parse('2026-08-26T20:36:00Z'),receivedAt:NOW}],
  });
  const res=await t.mutation(opsM('submitStagedResearchInternal'),{owner:OWNER,leaseToken:lease.leaseToken,submissionJson:JSON.stringify(wf.submission)}) as {evidencePromoted:number};
  expect(res.evidencePromoted).toBe(1);
  const q=await t.run(ctx=>ctx.db.query('evidenceQuarantines').collect());
  expect(q[0].replacementStagingItemId).not.toBeNull();
  expect(q[0].replacedAt).toBeGreaterThanOrEqual(NOW);
  const replacement=await t.run(ctx=>ctx.db.get(q[0].replacementStagingItemId!));
  expect(replacement).toMatchObject({sourceUrl:NVDA_URL,validationStatus:'promoted'});

  // No duplicate active records: exactly one active promoted row and one active evidence fact for the filing,
  // while the original quarantined rows remain for audit.
  const rowsFor=async()=>t.run(async ctx=>({
   staged:(await ctx.db.query('researchStagingItems').collect()).filter(s=>s.sourceUrl===NVDA_URL),
   evidence:(await ctx.db.query('evidence').collect()).filter(e=>e.symbol==='NVDA'&&e.metric==='capital_expenditures'),
  }));
  const afterReingest=await rowsFor();
  expect(afterReingest.staged).toHaveLength(2);
  expect(afterReingest.staged.filter(s=>s.quarantinedAt===undefined&&s.validationStatus==='promoted')).toHaveLength(1);
  expect(afterReingest.evidence).toHaveLength(2);
  expect(afterReingest.evidence.filter(e=>e.quarantinedAt===undefined).map(e=>e.value)).toEqual([4.43]);

  // Re-submitting the same corrected filing is a duplicate: no new row, replacement link unchanged.
  const lease2=await t.mutation(opsM('acquireJobLeaseInternal'),{owner:OWNER,jobKey:'news_discovery_agent',environment:'remote',forceOnDemand:true}) as {ok:boolean;leaseToken:string;cursor:string|null};
  const res2=await t.mutation(opsM('submitStagedResearchInternal'),{owner:OWNER,leaseToken:lease2.leaseToken,submissionJson:JSON.stringify({...wf.submission,runId:'g9-2-reingest-again'})}) as {evidencePromoted:number};
  expect(res2.evidencePromoted).toBe(0);
  const afterRepeat=await rowsFor();
  expect(afterRepeat.staged).toHaveLength(2);
  expect(afterRepeat.evidence).toHaveLength(2);
  const q2=await t.run(ctx=>ctx.db.query('evidenceQuarantines').collect());
  expect(q2[0].replacementStagingItemId).toBe(q[0].replacementStagingItemId);

  // The audit trail records both the quarantine and the replacement.
  const actions=(await t.run(ctx=>ctx.db.query('audit').collect())).map(a=>a.action);
  expect(actions).toEqual(expect.arrayContaining(['evidence_quarantined','evidence_quarantine_replaced']));
 });
});

describe('Scheduler health never reports active when disabled or overdue',()=>{
 const base=(over:Partial<Parameters<typeof evaluateCollectionHealth>[0]>)=>evaluateCollectionHealth({
  now:NOW,systemEnabled:true,activeEnvironment:'remote',dailyCostCeilingGbp:2,monthlyCostCeilingGbp:25,dailyEstimatedCostGbp:0,dailyActualCostGbp:0,monthlyEstimatedCostGbp:0,monthlyActualCostGbp:0,pendingVerificationCount:0,
  jobs:[{jobKey:'sec_filings_collect',intervalMinutes:60,enabled:true,pausedReason:null,lastSuccessAt:NOW-10*60_000,lastRunAt:NOW-10*60_000,nextRunAt:NOW+50*60_000,sourcesAddedTotal:7,evidenceAddedTotal:7,estimatedCostGbpTotal:0,actualCostGbpTotal:0,lastOutcome:'succeeded',lastErrorCode:null}],
  ...over,
 });

 it('RESEARCH_SCHEDULER_ENV=disabled → paused, jobs not scheduled, no expected tick',()=>{
  const h=base({schedulerEnv:'disabled'});
  expect(h.operationalLayers.scheduler).toMatchObject({status:'paused',schedulerEnv:'disabled',nextExpectedTickAt:null});
  expect(h.operationalLayers.scheduler.label).toContain('RESEARCH_SCHEDULER_ENV=disabled');
  expect(h.jobs[0].scheduled).toBe(false);
 });

 it('cron enabled but no tick for three intervals → degraded/overdue, not working',()=>{
  const stale=NOW-SCHEDULER_OVERDUE_AFTER_MS-60_000;
  const h=base({schedulerEnv:'remote',jobs:[{jobKey:'sec_filings_collect',intervalMinutes:60,enabled:true,pausedReason:null,lastSuccessAt:stale,lastRunAt:stale,nextRunAt:stale+3600_000,sourcesAddedTotal:7,evidenceAddedTotal:7,estimatedCostGbpTotal:0,actualCostGbpTotal:0,lastOutcome:'succeeded',lastErrorCode:null}]});
  expect(h.operationalLayers.scheduler).toMatchObject({status:'degraded',overdue:true});
  expect(h.executionPaths.find(p=>p.id==='convex_cloud_scheduler_and_collectors')?.status).toBe('standby');
 });

 it('cron enabled with a recent tick → working; external news is reported NOT_IMPLEMENTED',()=>{
  const h=base({schedulerEnv:'remote'});
  expect(h.operationalLayers.scheduler).toMatchObject({status:'working',overdue:false});
  expect(h.externalNewsIngestion.status).toBe('NOT_IMPLEMENTED');
 });

 // Rendered panel in each condition: enabled, disabled, overdue, failed and legitimately unchanged source.
 const recent=NOW-10*60_000;
 const job=(over:Record<string,unknown>={})=>({jobKey:'sec_filings_collect',intervalMinutes:60,enabled:true,pausedReason:null,lastSuccessAt:recent,lastRunAt:recent,nextRunAt:recent+3600_000,sourcesAddedTotal:7,evidenceAddedTotal:7,estimatedCostGbpTotal:0,actualCostGbpTotal:0,lastOutcome:'succeeded',lastErrorCode:null,latestSourceObservationAt:Date.parse('2026-11-12T12:20:41Z'),...over});
 const render=(h:ReturnType<typeof evaluateCollectionHealth>)=>renderToStaticMarkup(createElement(AgentOperationsPanel,{health:h,now:NOW})).replace(/<!-- -->/g,'');
 const stale=NOW-SCHEDULER_OVERDUE_AFTER_MS-60_000;

 it.each([
  ['enabled',{schedulerEnv:'remote' as const,jobs:[job()]},['Scheduler working','RESEARCH_SCHEDULER_ENV: remote','Last attempt: 2026-11-16','Source observed: 2026-11-12'],['Not scheduled','Overdue']],
  ['disabled',{schedulerEnv:'disabled' as const,jobs:[job()]},['Scheduler disabled (RESEARCH_SCHEDULER_ENV=disabled)','RESEARCH_SCHEDULER_ENV: disabled','no tick expected','Not scheduled — scheduler disabled','Configured: Enabled','Not scheduled'],['Scheduler working']],
  ['overdue',{schedulerEnv:'remote' as const,jobs:[job({lastSuccessAt:stale,lastRunAt:stale,nextRunAt:stale+15*60_000})]},['Scheduler overdue','the cron is configured but not executing','Overdue'],['Scheduler working']],
  ['failed',{schedulerEnv:'remote' as const,jobs:[job({lastErrorCode:'sec_edgar_unreachable',lastOutcome:'failed:sec_edgar_unreachable',lastFailureAt:recent})]},['Scheduler working','Failed','sec_edgar_unreachable','Collectors failing'],['All collectors working']],
  ['unchanged source',{schedulerEnv:'remote' as const,jobs:[job({lastConditionalSkip:true,lastOutcome:'succeeded:cursor_unchanged',lastProviderRequests:7})]},['Scheduler working','cursor unchanged (0 model calls)','7 reqs','latest cycle skipped unchanged sources via cursor'],['Failed','Overdue']],
 ] as const)('panel renders the %s condition honestly',(_name,over,present,absent)=>{
  const html=render(base(over as unknown as Parameters<typeof base>[0]));
  for(const s of present)expect(html).toContain(s);
  for(const s of absent)expect(html).not.toContain(s);
  expect(html).toContain('External financial-news ingestion: NOT IMPLEMENTED');
 });
});

describe('Morning briefing provenance: owner sees the latest stored briefing; any bundled fallback is labelled historical',()=>{
 const brief=(date:string,over:Record<string,unknown>={})=>({briefingDate:date,generatedAt:Date.parse(`${date}T07:30:00Z`),timezone:'Europe/London' as const,confirmedFacts:[],researchInterpretation:[],riskChanges:[],incompleteEvidence:[],modelVersion:null,executionAuthority:'none' as const,version:'remote-ops-003-v1' as const,...over});
 const bundled=brief('2026-11-05');
 const owner=brief('2026-11-17');

 it('chooses the owner briefing when the authorised owner overview has one',()=>{
  expect(resolveDisplayedBriefing({fixture:false,ownerOverviewLoaded:true,ownerHasActivity:true,ownerBriefing:owner,feedBriefing:bundled,feedBriefingSource:'bundled_reference'})).toMatchObject({source:'owner_latest',briefing:owner,executiveBriefing:owner});
 });

 it('labels the bundled briefing as the fallback for signed-out viewers and signed-in non-owners, and keeps it out of the executive synthesis',()=>{
  for(const input of [
   {ownerOverviewLoaded:false,ownerHasActivity:false,ownerBriefing:undefined},
   {ownerOverviewLoaded:true,ownerHasActivity:false,ownerBriefing:null},
  ]){
   expect(resolveDisplayedBriefing({fixture:false,feedBriefing:bundled,feedBriefingSource:'bundled_reference',...input})).toMatchObject({source:'bundled_reference',briefing:bundled,executiveBriefing:null});
  }
 });

 it('renders the owner briefing plainly and the bundled one as historical with the latest stored date',()=>{
  const ownerHtml=renderToStaticMarkup(createElement(MorningBriefPanel,{briefing:owner,source:'owner_latest',latestStored:{date:'2026-11-17',generatedAt:owner.generatedAt}})).replace(/<!-- -->/g,'');
  expect(ownerHtml).toContain('Morning intelligence brief (2026-11-17)');
  expect(ownerHtml).toContain('data-briefing-source="owner_latest"');
  expect(ownerHtml).not.toContain('Historical bundled briefing');
  const fallbackHtml=renderToStaticMarkup(createElement(MorningBriefPanel,{briefing:bundled,source:'bundled_reference',latestStored:{date:'2026-11-17',generatedAt:owner.generatedAt}})).replace(/<!-- -->/g,'');
  expect(fallbackHtml).toContain('Historical bundled briefing (2026-11-05) — not current research');
  expect(fallbackHtml).toContain('Latest stored briefing: 2026-11-17');
  expect(fallbackHtml).toContain('data-briefing-source="bundled_reference"');
 });

 it('shows withheld quarantined facts on a stored briefing',()=>{
  const html=renderToStaticMarkup(createElement(MorningBriefPanel,{briefing:brief('2026-11-15',{withheldFacts:[{id:'fact-NVDA-0001045810-20-000147',reason:'sec_accession_mismatch: 2020 comparative'}]}),source:'owner_latest'})).replace(/<!-- -->/g,'');
  expect(html).toContain('1 confirmed fact(s) in this stored briefing were later quarantined and are withheld');
  expect(html).toContain('fact-NVDA-0001045810-20-000147');
 });
});

describe('Release fingerprint',()=>{
 it('the committed Convex fingerprint matches the current sources (regenerate with npm run convex:fingerprint)',()=>{
  const fp=computeConvexFingerprint(process.cwd()) as {sourceSha256:string;fileCount:number};
  expect(CONVEX_DEPLOYMENT_FINGERPRINT.sourceSha256).toBe(fp.sourceSha256);
  expect(CONVEX_DEPLOYMENT_FINGERPRINT.fileCount).toBe(fp.fileCount);
 });

 it('fails release acceptance unless frontend and backend fingerprints match',()=>{
  const exp=CONVEX_DEPLOYMENT_FINGERPRINT;
  expect(evaluateReleaseCompatibility(exp,{...exp,deployedGitSha:'abc',deployedAt:null},null).verdict).toBe('COMPATIBLE');
  expect(evaluateReleaseCompatibility(exp,{...exp,sourceSha256:'0'.repeat(64),deployedGitSha:null,deployedAt:null},null)).toMatchObject({verdict:'INCOMPATIBLE',compatible:false});
  expect(evaluateReleaseCompatibility(exp,null,"Could not find public function for 'release:fingerprint'")).toMatchObject({verdict:'BACKEND_UNVERSIONED',compatible:false});
  expect(evaluateReleaseCompatibility(exp,null,'fetch failed')).toMatchObject({verdict:'BACKEND_UNREACHABLE',compatible:false});
 });
});
