import {afterEach,describe,expect,it,vi} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';
import {runNewsResearchAgentWorkflow} from '../lib/remote-ops/news-agent';

const modules={
 './_generated/server.ts':async()=>({}),
 './operations.ts':()=>import('../convex/operations'),
 './brokers.ts':()=>import('../convex/brokers'),
 './trading.ts':()=>import('../convex/trading'),
 './roles.ts':()=>import('../convex/roles'),
 './research.ts':()=>import('../convex/research'),
};

const opsM=(n:string)=>makeFunctionReference<'mutation'>(`operations:${n}`);
const opsQ=(n:string)=>makeFunctionReference<'query'>(`operations:${n}`);
const OWNER='https://issuer.test|user_owner';
const OTHER='https://issuer.test|user_other';
const NOW=Date.parse('2026-11-06T16:00:00Z');

afterEach(()=>vi.useRealTimers());

function setup(){
 vi.useFakeTimers();
 vi.setSystemTime(NOW);
 const t=convexTest(schema,modules);
 return {
  t,
  owner:t.withIdentity({subject:'user_owner',tokenIdentifier:OWNER}),
  other:t.withIdentity({subject:'user_other',tokenIdentifier:OTHER}),
  agent:t.withIdentity({subject:'remote_agent',tokenIdentifier:'https://issuer.test|remote_agent',actorType:'agent'}),
  model:t.withIdentity({subject:'model_runner',tokenIdentifier:'https://issuer.test|model_runner',actorType:'model'}),
 };
}

describe('Phase 003 Convex persistence, unattended execution & security boundaries',()=>{
 it('continues unattended research staging & promotion when no browser session is active',async()=>{
  const {t,owner}=setup();
  const lease=await t.mutation(opsM('acquireJobLeaseInternal'),{
   owner:OWNER,
   jobKey:'news_discovery_agent',
   environment:'remote',
  }) as {ok:boolean;leaseToken:string;cursor:string|null};
  expect(lease.ok).toBe(true);

  const workflow=runNewsResearchAgentWorkflow({
   runId:'unattended-run-001',
   cursorBefore:lease.cursor,
   now:NOW,
   candidates:[
    {
     url:'https://www.sec.gov/Archives/edgar/data/789019/msft-2026q3-10q.htm',
     title:'Microsoft Q3 2026 Form 10-Q capital expenditure disclosure',
     text:'In Form 10-Q for Q3 2026, Microsoft reported $20.0 billion in capital expenditures for cloud and AI infrastructure.',
     publishedAt:NOW-180_000,
     receivedAt:NOW-45_000,
    },
    {
     url:'https://digest.example.com/ai-cluster-rumour',
     title:'Unconfirmed cluster expansion estimate',
     text:'Analysts estimate NVIDIA partners may propose $12.0 billion in new cluster financing.',
     publishedAt:NOW-120_000,
     receivedAt:NOW-20_000,
    },
   ],
  });

  const result=await t.mutation(opsM('submitStagedResearchInternal'),{
   owner:OWNER,
   leaseToken:lease.leaseToken,
   submissionJson:JSON.stringify(workflow.submission),
  }) as {
   evidenceStaged:number;
   evidencePromoted:number;
   pendingVerification:number;
   duplicatesSkipped:number;
   idempotentReplay:boolean;
   executionAuthority:string;
  };
  expect(result).toMatchObject({
   evidenceStaged:2,
   evidencePromoted:1,
   pendingVerification:1,
   duplicatesSkipped:0,
   idempotentReplay:false,
   executionAuthority:'none',
  });

  // Replaying the same runId is idempotent and creates no duplicates.
  const replay=await t.mutation(opsM('submitStagedResearchInternal'),{
   owner:OWNER,
   submissionJson:JSON.stringify(workflow.submission),
  }) as {idempotentReplay:boolean;evidencePromoted:number};
  expect(replay.idempotentReplay).toBe(true);
  expect(replay.evidencePromoted).toBe(1);

  // Verify publication time and authoritative server receipt timestamp are preserved in `evidence`.
  const dash=await owner.query(makeFunctionReference<'query'>('research:dashboard'),{}) as {
   evidence:Array<{symbol:string;metric:string;value:number;publishedAt:number;receivedAt:number}>;
  };
  expect(dash.evidence).toHaveLength(1);
  expect(dash.evidence[0]).toMatchObject({
   symbol:'MSFT',
   metric:'capital_expenditures',
   value:20,
   publishedAt:NOW-180_000,
   receivedAt:NOW,
  });

  // Owner overview reflects the run, pending verification count, and isolated another owner.
  const ov=await owner.query(opsQ('overview'),{}) as {
   health:{pendingVerificationCount:number;jobs:Array<{jobKey:string;evidenceAdded:number}>};
   recentRuns:Array<{runId:string}>;
  };
  expect(ov.health.pendingVerificationCount).toBe(1);
  expect(ov.recentRuns[0].runId).toBe('unattended-run-001');

  const otherOv=await setup().other.query(opsQ('overview'),{}) as {recentRuns:unknown[]};
  expect(otherOv.recentRuns).toHaveLength(0);
 });

 it('forbids remote agents and models from changing operations settings, broker sync, roles or trading controls',async()=>{
  const {agent,model}=setup();
  for(const actor of [agent,model]){
   await expect(actor.mutation(opsM('configureSettings'),{
    systemEnabled:false,
    activeEnvironment:'disabled',
    dailyCostCeilingGbp:10,
    monthlyCostCeilingGbp:100,
   })).rejects.toThrow(/Model or automated actors/);
   await expect(actor.mutation(opsM('setJobEnabled'),{
    jobKey:'market_data_collect',
    enabled:false,
   })).rejects.toThrow(/Model or automated actors/);
   await expect(actor.mutation(makeFunctionReference<'mutation'>('brokers:setAutoSync'),{
    environment:'live',
    enabled:true,
    intervalMinutes:15,
   })).rejects.toThrow(/Only the account owner/);
   await expect(actor.mutation(makeFunctionReference<'mutation'>('trading:createDraft'),{
    draftJson:JSON.stringify({
     environment:'demo',
     ticker:'NVDA_US_EQ',
     side:'buy',
     orderType:'market',
     quantity:1,
     currency:'GBP',
     rationale:'agent attempt',
    }),
   })).rejects.toThrow(/Model or automated actors/);
   await expect(actor.mutation(makeFunctionReference<'mutation'>('roles:assignReviewer'),{
    subject:OWNER,
    reason:'agent self-grant attempt',
    expiresAt:NOW+86400_000,
   })).rejects.toThrow(/Model or automated actors/);
  }
 });

 it('enforces cost ceilings on AI agent jobs while deterministic market-data collectors continue unaffected',async()=>{
  const {t,owner}=setup();
  await owner.mutation(opsM('configureSettings'),{
   systemEnabled:true,
   activeEnvironment:'remote',
   dailyCostCeilingGbp:0.05,
   monthlyCostCeilingGbp:1.0,
  });

  // Submit a run that consumes £0.05 (reaching the daily ceiling).
  const run1=runNewsResearchAgentWorkflow({
   runId:'budget-run-1',
   cursorBefore:null,
   now:NOW,
   estimatedCostGbp:0.05,
   candidates:[{
    url:'https://www.sec.gov/Archives/edgar/data/1045810/nvda-8k.htm',
    title:'NVIDIA 8-K disclosure',
    text:'NVIDIA reported $10.0 billion in revenue in Form 8-K.',
    publishedAt:NOW-60_000,
    receivedAt:NOW-10_000,
   }],
  });
  await t.mutation(opsM('submitStagedResearchInternal'),{
   owner:OWNER,
   submissionJson:JSON.stringify(run1.submission),
  });

  // Next AI agent lease is blocked by budget_exceeded.
  vi.setSystemTime(NOW+31*60_000);
  const aiLease=await t.mutation(opsM('acquireJobLeaseInternal'),{
   owner:OWNER,
   jobKey:'news_discovery_agent',
   environment:'remote',
  }) as {ok:boolean;code?:string};
  expect(aiLease).toEqual({ok:false,code:'budget_exceeded'});

  // Deterministic market_data_collect and sec_filings_collect still acquire leases and succeed!
  const marketLease=await t.mutation(opsM('acquireJobLeaseInternal'),{
   owner:OWNER,
   jobKey:'market_data_collect',
   environment:'remote',
  }) as {ok:boolean;leaseToken?:string};
  expect(marketLease.ok).toBe(true);
  await t.mutation(opsM('recordDeterministicRunInternal'),{
   owner:OWNER,
   runId:'det-market-1',
   jobKey:'market_data_collect',
   environment:'remote',
   leaseToken:marketLease.leaseToken,
   status:'succeeded',
   sourcesDiscovered:4,
   evidencePromoted:4,
   duplicatesSkipped:0,
   summary:'Deterministic market data collected while AI budget ceiling is active.',
  });
 });

 it('prevents duplicate jobs across local and remote environments, recovers expired leases, and supports central disable',async()=>{
  const {t,owner}=setup();
  // Active environment defaults to 'remote': a 'local' runner is skipped with environment_inactive.
  const localAttempt=await t.mutation(opsM('acquireJobLeaseInternal'),{
   owner:OWNER,
   jobKey:'market_data_collect',
   environment:'local',
  }) as {ok:boolean;code?:string};
  expect(localAttempt).toMatchObject({ok:false,code:'environment_inactive'});

  // Remote runner acquires lease; a second concurrent remote runner sees lease_held.
  const first=await t.mutation(opsM('acquireJobLeaseInternal'),{
   owner:OWNER,
   jobKey:'market_data_collect',
   environment:'remote',
  }) as {ok:boolean;leaseToken:string;timeoutMs:number};
  expect(first.ok).toBe(true);
  const concurrent=await t.mutation(opsM('acquireJobLeaseInternal'),{
   owner:OWNER,
   jobKey:'market_data_collect',
   environment:'remote',
  }) as {ok:boolean;code?:string};
  expect(concurrent).toMatchObject({ok:false,code:'lease_held'});

  // After timeoutMs expires, the next tick recovers the expired lease without duplicating observations.
  vi.setSystemTime(NOW+first.timeoutMs+1000);
  const recovered=await t.mutation(opsM('acquireJobLeaseInternal'),{
   owner:OWNER,
   jobKey:'market_data_collect',
   environment:'remote',
  }) as {ok:boolean;leaseToken:string};
  expect(recovered.ok).toBe(true);
  expect(recovered.leaseToken).not.toBe(first.leaseToken);

  // Central system disable blocks all subsequent claims until re-enabled.
  await owner.mutation(opsM('configureSettings'),{
   systemEnabled:false,
   disabledReason:'Maintenance test',
   activeEnvironment:'disabled',
   dailyCostCeilingGbp:2.0,
   monthlyCostCeilingGbp:25.0,
  });
  const disabledAttempt=await t.mutation(opsM('acquireJobLeaseInternal'),{
   owner:OWNER,
   jobKey:'sec_filings_collect',
   environment:'remote',
  }) as {ok:boolean;code?:string};
  expect(disabledAttempt).toEqual({ok:false,code:'system_disabled'});
 });

 it('enforces trusted server receipt timestamps, blocks backdated forward registration, and rate-limits staging submissions',async()=>{
  const {t,owner}=setup();
  const historicalAgentClaimAt=NOW-4*86_400_000;
  const pubAt=NOW-5*86_400_000;
  const workflow=runNewsResearchAgentWorkflow({
   runId:'run-trusted-ts-1',
   cursorBefore:null,
   now:NOW,
   candidates:[{
    url:'https://www.sec.gov/Archives/edgar/data/1652044/googl-2026q3-10q.htm',
    title:'Alphabet Q3 2026 Form 10-Q',
    text:'In Form 10-Q for Q3 2026, Alphabet reported $13.2 billion in capital expenditures.',
    publishedAt:pubAt,
    receivedAt:historicalAgentClaimAt,
   }],
  });
  const extId=workflow.submission.items[0]!.externalId;
  await t.mutation(opsM('submitStagedResearchInternal'),{
   owner:OWNER,
   submissionJson:JSON.stringify(workflow.submission),
  });

  const view=await owner.query(opsQ('overview'),{}) as {
   stagedItems:Array<{
    externalId:string;
    receivedAt:number;
    serverReceivedAt:number;
    sourceRetrievedAt:number;
    untrustedAgentMetadata:{agentReportedReceivedAt:number;forwardEligibilityTrusted:boolean}|null;
   }>;
  };
  const stored=view.stagedItems.find(s=>s.externalId===extId)!;
  expect(stored.receivedAt).toBe(NOW);
  expect(stored.serverReceivedAt).toBe(NOW);
  expect(stored.sourceRetrievedAt).toBe(historicalAgentClaimAt);
  expect(stored.untrustedAgentMetadata).toMatchObject({
   agentReportedReceivedAt:historicalAgentClaimAt,
   forwardEligibilityTrusted:false,
  });

  await expect(owner.mutation(opsM('registerForwardStudy'),{
   name:'Backdated Forward Attempt',
   cutoffAt:NOW-2*86_400_000,
   stagedExternalIds:[extId],
  })).rejects.toThrow(/Backdated forward experiment registration prohibited/);

  for(let i=2;i<=6;i++){
   const w=runNewsResearchAgentWorkflow({
    runId:`run-trusted-ts-${i}`,
    cursorBefore:null,
    now:NOW,
    candidates:[],
   });
   await t.mutation(opsM('submitStagedResearchInternal'),{
    owner:OWNER,
    submissionJson:JSON.stringify(w.submission),
   });
  }
  const w7=runNewsResearchAgentWorkflow({
   runId:'run-trusted-ts-7',
   cursorBefore:null,
   now:NOW,
   candidates:[],
  });
  await expect(t.mutation(opsM('submitStagedResearchInternal'),{
   owner:OWNER,
   submissionJson:JSON.stringify(w7.submission),
  })).rejects.toThrow(/Staging request rate limit exceeded/);
 });

 it('deduplicates Morning Intelligence Briefs per UK reporting date across BST/GMT and records failure & efficiency telemetry',async()=>{
  const {t,owner}=setup();
  const bstMorning0630Utc=Date.parse('2026-03-30T06:30:00Z'); // 07:30 BST on Monday after clocks spring forward
  const bstMorning0730Utc=Date.parse('2026-03-30T07:30:00Z'); // 08:30 BST on the same UK date

  const payload=JSON.stringify({
   confirmedFacts:[{
    id:'f-bst-1',
    entity:'NVDA',
    metric:'capital_expenditures',
    valueDisplay:'$1.1B',
    period:'2026',
    sourceUrl:'https://www.sec.gov/Archives/edgar/data/1045810/nvda-10q.htm',
    sourceKind:'sec_filing',
    publishedAt:bstMorning0630Utc-86_400_000,
    receivedAt:bstMorning0630Utc-3600_000,
    classification:'reported',
   }],
   researchInterpretation:[],
   riskChanges:[],
   incompleteEvidence:[],
   modelVersion:null,
  });

  const firstBrief=await t.mutation(opsM('recordDeterministicRunInternal'),{
   owner:OWNER,
   runId:'brief-bst-0630',
   jobKey:'daily_intelligence_briefing',
   environment:'remote',
   status:'succeeded',
   sourcesDiscovered:1,
   evidencePromoted:0,
   duplicatesSkipped:0,
   nowOverride:bstMorning0630Utc,
   summary:'07:30 BST briefing',
   briefingJson:payload,
  }) as {briefingDeduplicated:boolean;briefingDate:string|null};
  expect(firstBrief).toMatchObject({briefingDeduplicated:false,briefingDate:'2026-03-30'});

  // Second attempt on the same UK date (e.g. 07:30 UTC = 08:30 BST) is strictly deduplicated.
  const secondBrief=await t.mutation(opsM('recordDeterministicRunInternal'),{
   owner:OWNER,
   runId:'brief-bst-0730',
   jobKey:'daily_intelligence_briefing',
   environment:'remote',
   status:'succeeded',
   sourcesDiscovered:1,
   evidencePromoted:0,
   duplicatesSkipped:1,
   conditionalSkip:true,
   nowOverride:bstMorning0730Utc,
   summary:'Deduplicated second trigger on same UK date',
   briefingJson:payload,
  }) as {briefingDeduplicated:boolean;briefingDate:string|null};
  expect(secondBrief).toMatchObject({briefingDeduplicated:true,briefingDate:'2026-03-30'});

  const state=await t.query(opsQ('getStagingStateInternal'),{owner:OWNER}) as {existingBriefingDates:string[]};
  expect(state.existingBriefingDates.filter(d=>d==='2026-03-30')).toHaveLength(1);

  // Record a failed market_data_collect run and verify lastFailureAt + operationalLayers distinction.
  await t.mutation(opsM('recordDeterministicRunInternal'),{
   owner:OWNER,
   runId:'mkt-fail-1',
   jobKey:'market_data_collect',
   environment:'remote',
   status:'failed',
   sourcesDiscovered:1,
   evidencePromoted:0,
   duplicatesSkipped:0,
   providerRequestsCount:1,
   processingDurationMs:85,
   errorCode:'licensed_quote_provider_unconfigured',
   summary:'Licensed quote provider unconfigured',
  });

  const view=await owner.query(opsQ('overview'),{}) as {
   health:{
    operationalLayers:{
     scheduler:{status:string};
     collector:{status:string};
     source:{status:string};
    };
    jobs:Array<{jobKey:string;lastFailureAt:number|null;lastErrorCode:string|null;providerRequestsLastRun:number}>;
   };
  };
  expect(view.health.operationalLayers.scheduler.status).toBe('working');
  expect(view.health.operationalLayers.collector.status).toBe('partial');
  expect(view.health.operationalLayers.source.status).toBe('partial');
  const mkt=view.health.jobs.find(j=>j.jobKey==='market_data_collect')!;
  expect(mkt.lastErrorCode).toBe('licensed_quote_provider_unconfigured');
  expect(mkt.lastFailureAt).toBeGreaterThanOrEqual(NOW);
  expect(mkt.providerRequestsLastRun).toBe(1);
 });
});
