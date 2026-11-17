import {afterEach,describe,expect,it,vi} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import schema from '../convex/schema';
import {AgentOperationsPanel} from '../components/command-centre/agent-operations-panel';
import {iso} from '../components/command-centre/shared';
import {describeJobSchedule} from '../lib/remote-ops/job-schedule-display';
import type {CollectionHealthReport} from '../lib/remote-ops/health-monitor';

/**
 * Sprint G9.3.1 — scheduler health reporting correction.
 *
 * Defect found on the G9.3 Preview (2026-11-17): the signed-out operations view showed every collector as "Enabled"
 * with stale next-run times while RESEARCH_SCHEDULER_ENV=disabled, because the public projection dropped the per-job
 * scheduling fields. These tests run the real public and owner Convex queries, render the panel from their output,
 * and pin the exact public job field set so a field cannot be silently dropped (or a private one leaked) again.
 */

const NOW=Date.parse('2026-11-17T14:00:00Z');
const OWNER='https://issuer.test|user_owner';
const MIN=60_000,HOUR=3600_000;
const modules={
 './_generated/server.ts':async()=>({}),
 './operations.ts':()=>import('../convex/operations'),
 './authz.ts':()=>import('../convex/authz'),
};
const opsQ=(n:string)=>makeFunctionReference<'query'>(`operations:${n}`);

afterEach(()=>{
 vi.useRealTimers();
 vi.unstubAllEnvs();
});

type JobOverrides={
 lastRunAt?:number|null;
 lastSuccessAt?:number|null;
 lastFailureAt?:number|null;
 nextRunAt?:number;
 lastErrorCode?:string|null;
 lastOutcome?:string|null;
 lastConditionalSkip?:boolean;
 lastProviderRequests?:number;
 enabled?:boolean;
};

const JOBS=[
 {jobKey:'market_data_collect',name:'Market Data Collector',category:'deterministic_collector' as const,intervalMinutes:15},
 {jobKey:'sec_filings_collect',name:'SEC Financial Filings Collector',category:'deterministic_collector' as const,intervalMinutes:60},
];

async function seed(t:ReturnType<typeof convexTest>,over:Record<string,JobOverrides>={}){
 await t.run(async ctx=>{
  for(const j of JOBS){
   const o=over[j.jobKey]??{};
   await ctx.db.insert('researchJobs',{
    owner:OWNER,jobKey:j.jobKey,name:j.name,purpose:`${j.name} purpose`,category:j.category,scheduleCron:'*/15 * * * *',
    intervalMinutes:j.intervalMinutes,enabled:o.enabled??true,environment:'remote',cursor:null,
    lastRunAt:o.lastRunAt===undefined?NOW-5*MIN:o.lastRunAt,
    lastSuccessAt:o.lastSuccessAt===undefined?NOW-5*MIN:o.lastSuccessAt,
    lastFailureAt:o.lastFailureAt??null,
    nextRunAt:o.nextRunAt??NOW+10*MIN,
    lastOutcome:o.lastOutcome??'succeeded',lastErrorCode:o.lastErrorCode??null,consecutiveFailures:o.lastErrorCode?1:0,
    pausedReason:null,nextAllowedAt:0,leaseToken:null,leaseUntil:0,timeoutMs:60_000,
    sourcesAddedTotal:3,evidenceAddedTotal:2,estimatedCostGbpTotal:1.25,actualCostGbpTotal:1.1,
    lastProviderRequests:o.lastProviderRequests??4,lastDurationMs:900,lastConditionalSkip:o.lastConditionalSkip??false,
    updatedAt:NOW,executionAuthority:'none',version:'remote-ops-003-v1',
   });
  }
 });
}

async function views(schedulerEnv:string,over:Record<string,JobOverrides>={}){
 vi.useFakeTimers();
 vi.setSystemTime(NOW);
 vi.stubEnv('RESEARCH_OWNER_ID',OWNER);
 vi.stubEnv('RESEARCH_SCHEDULER_ENV',schedulerEnv);
 const t=convexTest(schema,modules);
 await seed(t,over);
 const owner=t.withIdentity({subject:'user_owner',tokenIdentifier:OWNER});
 const pub=await t.query(opsQ('publicOperationsOverview'),{}) as {health:CollectionHealthReport;latestBriefing:unknown};
 const own=await owner.query(opsQ('overview'),{}) as {health:CollectionHealthReport};
 return {pub,own};
}

const render=(health:CollectionHealthReport)=>renderToStaticMarkup(createElement(AgentOperationsPanel,{health,now:NOW})).replace(/<!-- -->/g,'');
const cell=(html:string,testid:string)=>{
 const m=new RegExp(`data-testid="${testid}"[^>]*>(.*?)</(td|span|dd|small)>`).exec(html);
 return m?m[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim():null;
};

/** Every field the public job projection may carry. Adding or dropping one must be a deliberate, reviewed change. */
const PUBLIC_JOB_FIELDS=[
 'actualCostGbp','ageMs','category','conditionalSkipLastRun','enabled','environment','estimatedCostGbp','evidenceAdded','freshness',
 'jobKey','lastErrorCode','lastFailureAt','lastOutcome','lastRunAt','lastSuccessAt','latestSourceObservationAt','name','nextRunAt',
 'nextRunOverdue','pausedReason','pendingVerification','processingDurationMsLastRun','providerRequestsLastRun','purpose','scheduled',
 'sourcesAdded','usesAiModel',
].sort();

describe('Public (signed-out) operations projection keeps scheduling fields and nothing private',()=>{
 it('carries scheduled, nextRunOverdue, latestSourceObservationAt and externalNewsIngestion; private telemetry stays masked',async()=>{
  const {pub,own}=await views('disabled');
  for(const j of pub.health.jobs){
   expect(Object.keys(j).sort()).toEqual(PUBLIC_JOB_FIELDS);
   expect(j.scheduled).toBe(false);
   expect(typeof j.nextRunOverdue).toBe('boolean');
   // Owner-only telemetry is still zeroed or nulled on the public path.
   expect(j.estimatedCostGbp).toBe(0);
   expect(j.actualCostGbp).toBeNull();
   expect(j.providerRequestsLastRun).toBe(0);
   expect(j.processingDurationMsLastRun).toBeNull();
   expect(j.lastOutcome).toBeNull();
   expect(j.pendingVerification).toBe(0);
  }
  expect(pub.health.externalNewsIngestion?.status).toBe('NOT_IMPLEMENTED');
  expect(pub.health.dailyCostGbp).toEqual({estimated:0,actual:0,ceiling:0,exceeded:false});
  expect('recentRuns' in pub.health).toBe(false);
  expect('evidenceChat' in pub.health).toBe(false);
  expect(pub.latestBriefing).toBeNull();
  // The owner view still carries the private values the public view masks.
  const ownSec=own.health.jobs.find(j=>j.jobKey==='sec_filings_collect')!;
  expect(ownSec.estimatedCostGbp).toBe(1.25);
  expect(ownSec.providerRequestsLastRun).toBe(4);
  expect(ownSec.scheduled).toBe(false);
 });

 it('an anonymous caller cannot read the owner overview',async()=>{
  vi.stubEnv('RESEARCH_OWNER_ID',OWNER);
  const t=convexTest(schema,modules);
  await seed(t);
  await expect(t.query(opsQ('overview'),{})).rejects.toThrow(/Sign in required/);
 });
});

// Each condition is checked on both the signed-out and the signed-in (owner) rendering of the real query output.
const stale=NOW-2*HOUR;
const CONDITIONS:Array<{
 name:string;
 env:string;
 over:Record<string,JobOverrides>;
 effective:string;
 present:string[];
 absent:string[];
}>=[
 {
  name:'disabled',env:'disabled',
  over:{sec_filings_collect:{lastRunAt:NOW-44*HOUR,lastSuccessAt:NOW-44*HOUR,nextRunAt:NOW-43*HOUR},market_data_collect:{lastRunAt:NOW-44*HOUR,lastSuccessAt:NOW-44*HOUR,nextRunAt:NOW-43*HOUR}},
  effective:'not_scheduled',
  present:['Not scheduled — scheduler disabled','Configured: Enabled','is historical; no run will occur while the scheduler is disabled.','Collectors idle (scheduler disabled)','Enabled · scheduler disabled (no unattended runs)','Active authority: remote · scheduler disabled'],
  absent:['Overdue','All collectors working','Enabled (unattended)','Scheduler working','data-effective-state="scheduled"'],
 },
 {
  name:'enabled',env:'remote',over:{},
  effective:'scheduled',
  present:['Scheduler working','>Scheduled<','Configured: Enabled','All collectors working','Enabled (unattended)',iso(NOW+10*MIN)],
  absent:['Not scheduled','Overdue','Collectors idle','not guaranteed'],
 },
 {
  name:'overdue',env:'remote',
  over:{sec_filings_collect:{lastRunAt:stale,lastSuccessAt:stale,nextRunAt:stale+15*MIN},market_data_collect:{lastRunAt:stale,lastSuccessAt:stale,nextRunAt:stale+15*MIN}},
  effective:'overdue',
  present:['Scheduler overdue','Scheduled · scheduler overdue','Overdue',`Was due ${iso(stale+15*MIN)}; no run has been recorded since, and a run is not guaranteed.`],
  absent:['Scheduler working','Not scheduled','will run','data-effective-state="scheduled"'],
 },
 {
  name:'failed',env:'remote',
  over:{sec_filings_collect:{lastErrorCode:'sec_edgar_unreachable',lastOutcome:'failed:sec_edgar_unreachable',lastFailureAt:NOW-5*MIN}},
  effective:'failed',
  present:['Failed (sec_edgar_unreachable) · still scheduled','sec_edgar_unreachable','Partial (1/2 healthy)'],
  absent:['Not scheduled','All collectors working'],
 },
 {
  name:'unchanged source',env:'remote',
  over:{sec_filings_collect:{lastConditionalSkip:true,lastOutcome:'succeeded:cursor_unchanged'}},
  effective:'scheduled',
  present:['>Scheduled<','Scheduler working','All collectors working'],
  absent:['Failed','Overdue','Not scheduled'],
 },
];

describe('Rendered operations panel from the real queries, signed out and signed in',()=>{
 it.each(CONDITIONS)('$name: signed-out and signed-in views are honest and agree on the schedule state',async c=>{
  const {pub,own}=await views(c.env,c.over);
  for(const [audience,health] of [['signed-out',pub.health],['signed-in',own.health]] as const){
   const html=render(health);
   const secState=/data-job="sec_filings_collect" data-effective-state="([a-z_]+)"/.exec(html)?.[1];
   expect(secState,`${audience} effective state`).toBe(c.effective);
   for(const s of c.present)expect(html,`${audience} should contain: ${s}`).toContain(s);
   for(const s of c.absent)expect(html,`${audience} should not contain: ${s}`).not.toContain(s);
   expect(html).toContain('External financial-news ingestion: NOT IMPLEMENTED');
  }
  // Both audiences render the same status and next-run text for every job.
  const pubHtml=render(pub.health),ownHtml=render(own.health);
  for(const j of JOBS){
   expect(cell(pubHtml,`job-status-${j.jobKey}`)).toBe(cell(ownHtml,`job-status-${j.jobKey}`));
   expect(cell(pubHtml,`job-next-run-${j.jobKey}`)).toBe(cell(ownHtml,`job-next-run-${j.jobKey}`));
  }
 });

 it('unchanged source on the owner view reports the cursor skip and zero model calls',async()=>{
  const {own}=await views('remote',{sec_filings_collect:{lastConditionalSkip:true,lastOutcome:'succeeded:cursor_unchanged'}});
  expect(render(own.health)).toContain('cursor unchanged (0 model calls)');
 });
});

describe('describeJobSchedule fails safe',()=>{
 const job={enabled:true,pausedReason:null,lastErrorCode:null,nextRunAt:NOW+10*MIN,lastRunAt:NOW-5*MIN};
 it('never presents a job as scheduled when the per-job flag is missing',()=>{
  const d=describeJobSchedule(job,{status:'working',schedulerEnv:'remote'},NOW,iso);
  expect(d).toMatchObject({effective:'unknown',effectiveLabel:'Schedule state not reported',nextRunLabel:'Not reported',active:false});
 });
 it('a disabled scheduler overrides an explicit scheduled:true and an overdue flag',()=>{
  const d=describeJobSchedule({...job,scheduled:true,nextRunOverdue:true},{status:'paused',schedulerEnv:'disabled'},NOW,iso);
  expect(d).toMatchObject({effective:'not_scheduled',nextRunLabel:'Not scheduled',active:false});
  expect(d.nextRunDetail).toContain('is historical');
 });
 it('operations disabled centrally is reported as such',()=>{
  const d=describeJobSchedule({...job,scheduled:false},{status:'paused',schedulerEnv:'remote'},NOW,iso);
  expect(d.effectiveLabel).toBe('Not scheduled — operations disabled');
 });
 it('a disabled or paused job is not scheduled even with the scheduler working',()=>{
  expect(describeJobSchedule({...job,enabled:false,scheduled:false},{status:'working',schedulerEnv:'remote'},NOW,iso).effectiveLabel).toBe('Not scheduled — job disabled');
  expect(describeJobSchedule({...job,pausedReason:'budget_exceeded',scheduled:false},{status:'working',schedulerEnv:'remote'},NOW,iso).configured).toBe('Paused (budget_exceeded)');
 });
 it('an overdue job never promises an automatic run',()=>{
  const d=describeJobSchedule({...job,scheduled:true,nextRunAt:NOW-HOUR,lastRunAt:NOW-2*HOUR},{status:'working',schedulerEnv:'remote'},NOW,iso);
  expect(d).toMatchObject({effective:'overdue',nextRunLabel:'Overdue',active:false});
  expect(d.nextRunDetail).toContain('a run is not guaranteed');
 });
});
