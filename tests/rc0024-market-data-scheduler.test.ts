import fs from 'node:fs';
import path from 'node:path';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';
import {
 MARKET_DATA_MAX_MONTHLY_PROVIDER_REQUESTS,
 MARKET_DATA_MAX_MONTHLY_SCHEDULED_ATTEMPTS,
 MARKET_DATA_MAX_WEEKDAYS_PER_MONTH,
 buildMarketDataOperationalStatus,
 evaluateUsMarketEodWindow,
 resolveMarketDataSchedulerEnv,
} from '../lib/remote-ops/market-data-scheduler';

const modules={
 './_generated/server.ts':async()=>({}),
 './operations.ts':()=>import('../convex/operations'),
 './remoteOpsCloud.ts':()=>import('../convex/remoteOpsCloud'),
 './graph.ts':()=>import('../convex/graph'),
 './research.ts':()=>import('../convex/research'),
};

const OWNER='https://issuer.test|rc0024_owner';
// 2026-11-19 21:30 UTC = 16:30 EST (post regular US close)
const POST_CLOSE_EST=Date.parse('2026-11-19T21:30:00Z');
const runMarketDataOnlyRef=makeFunctionReference<'action'>('remoteOpsCloud:runMarketDataOnlyInternal');
const runScheduledCloudCycleRef=makeFunctionReference<'action'>('remoteOpsCloud:runScheduledCloudCycle');
const publicOpsRef=makeFunctionReference<'query'>('operations:publicOperationsOverview');

const ORIGINAL_ENV={
 RESEARCH_OWNER_ID:process.env.RESEARCH_OWNER_ID,
 RESEARCH_SCHEDULER_ENV:process.env.RESEARCH_SCHEDULER_ENV,
 MARKET_DATA_SCHEDULER_ENV:process.env.MARKET_DATA_SCHEDULER_ENV,
 TYPEDB_HTTP_ADDRESS:process.env.TYPEDB_HTTP_ADDRESS,
};

function mockMarketFetch(calledUrls:string[],options?:{failNasdaq?:boolean}){
 return vi.fn(async(input:RequestInfo|URL)=>{
  const url=typeof input==='string'?input:input instanceof URL?input.toString():input.url;
  calledUrls.push(url);
  if(url.includes('typedb')||url.includes('sec.gov')||url.includes('trading212')){
   throw new Error(`FORBIDDEN_OUTBOUND_CALL: ${url}`);
  }
  if(url.startsWith('https://api.frankfurter.app/')){
   return new Response(
    JSON.stringify({
     amount:1,
     base:'USD',
     start_date:'2026-11-18',
     end_date:'2026-11-19',
     rates:{
      '2026-11-18':{GBP:0.75939},
      '2026-11-19':{GBP:0.76038},
     },
    }),
    {status:200,headers:{'Content-Type':'application/json'}},
   );
  }
  if(url.startsWith('https://api.nasdaq.com/api/quote/')){
   if(options?.failNasdaq){
    return new Response('Upstream unavailable',{status:503});
   }
   return new Response(
    JSON.stringify({
     data:{
      tradesTable:{
       rows:[
        {date:'11/19/2026',close:'$152.10',volume:'15,000,000',open:'$151.00',high:'$153.20',low:'$150.40'},
        {date:'11/18/2026',close:'$150.96',volume:'12,345,678',open:'$149.50',high:'$152.10',low:'$148.90'},
       ],
      },
     },
    }),
    {status:200,headers:{'Content-Type':'application/json'}},
   );
  }
  throw new Error(`UNEXPECTED_FETCH_URL: ${url}`);
 });
}

beforeEach(()=>{
 vi.useFakeTimers();
 vi.setSystemTime(POST_CLOSE_EST);
 process.env.RESEARCH_OWNER_ID=OWNER;
 process.env.RESEARCH_SCHEDULER_ENV='disabled';
 delete process.env.MARKET_DATA_SCHEDULER_ENV;
 process.env.TYPEDB_HTTP_ADDRESS='https://typedb.adversarial.invalid:8000';
});

afterEach(()=>{
 vi.useRealTimers();
 vi.unstubAllGlobals();
 for(const [k,v] of Object.entries(ORIGINAL_ENV)){
  if(v===undefined)delete process.env[k];
  else process.env[k]=v;
 }
});

describe('RC002.4 — Dedicated Market-Data-Only Recurring Scheduler (Mode B)',()=>{
 it('is disabled by default and rejects scheduled execution even if forceOnDemand:true is passed',async()=>{
  expect(resolveMarketDataSchedulerEnv(undefined)).toBe('disabled');
  expect(resolveMarketDataSchedulerEnv('')).toBe('disabled');
  expect(resolveMarketDataSchedulerEnv('remote')).toBe('disabled');
  expect(resolveMarketDataSchedulerEnv('true')).toBe('disabled');
  expect(resolveMarketDataSchedulerEnv('enabled')).toBe('enabled');

  const t=convexTest(schema,modules);
  const calledUrls:string[]=[];
  vi.stubGlobal('fetch',mockMarketFetch(calledUrls));

  const res=await t.action(runMarketDataOnlyRef,{
   environment:'remote',
   triggerSource:'scheduled_market_data_cron',
   forceOnDemand:true, // scheduled path must NEVER bypass its own gate
  }) as {environment:string;skippedReason:string;typedbProjectionInvoked:boolean;executionAuthority:string};

  expect(res.environment).toBe('disabled');
  expect(res.skippedReason).toBe('market_data_scheduler_disabled');
  expect(res.typedbProjectionInvoked).toBe(false);
  expect(res.executionAuthority).toBe('none');
  expect(calledUrls.length).toBe(0);
 });

 it('enables ONLY market_data_collect when MARKET_DATA_SCHEDULER_ENV=enabled while RESEARCH_SCHEDULER_ENV=disabled keeps all general research jobs paused',async()=>{
  process.env.MARKET_DATA_SCHEDULER_ENV='enabled';
  process.env.RESEARCH_SCHEDULER_ENV='disabled';
  const t=convexTest(schema,modules);
  const calledUrls:string[]=[];
  vi.stubGlobal('fetch',mockMarketFetch(calledUrls));

  // General research scheduler MUST remain paused even when MARKET_DATA_SCHEDULER_ENV=enabled
  const generalRes=await t.action(runScheduledCloudCycleRef,{
   environment:'remote',
   forceOnDemand:false,
  }) as {environment:string;skippedReason:string;results:unknown[]};
  expect(generalRes.environment).toBe('disabled');
  expect(generalRes.skippedReason).toBe('scheduler_env_disabled_to_prevent_duplicate_dev_prod_collection');
  expect(generalRes.results).toEqual([]);
  expect(calledUrls.length).toBe(0);

  // Dedicated Mode B market-data cron executes market_data_collect ONLY
  const mktRes=await t.action(runMarketDataOnlyRef,{
   environment:'remote',
   triggerSource:'scheduled_market_data_cron',
   forceOnDemand:false,
  }) as {
   triggerSource:string;
   marketDataSchedulerEnv:string;
   typedbProjectionInvoked:boolean;
   executionAuthority:string;
   result:{jobKey:string;status:string};
  };

  expect(mktRes.triggerSource).toBe('scheduled_market_data_cron');
  expect(mktRes.marketDataSchedulerEnv).toBe('enabled');
  expect(mktRes.typedbProjectionInvoked).toBe(false);
  expect(mktRes.executionAuthority).toBe('none');
  expect(mktRes.result.jobKey).toBe('market_data_collect');
  expect(mktRes.result.status).toBe('succeeded');
  expect(calledUrls.some((u)=>u.includes('typedb')||u.includes('sec.gov')||u.includes('trading212'))).toBe(false);

  const counts=await t.run(async(ctx)=>({
   obs:(await ctx.db.query('marketObservations').collect()).length,
   staging:(await ctx.db.query('researchStagingItems').collect()).length,
   evidence:(await ctx.db.query('evidence').collect()).length,
   briefings:(await ctx.db.query('morningBriefings').collect()).length,
   outbox:(await ctx.db.query('graphProjectionOutbox').collect()).length,
   orders:(await ctx.db.query('tradeOrders').collect()).length,
  }));
  expect(counts).toEqual({obs:16,staging:0,evidence:0,briefings:0,outbox:0,orders:0});
 });

 it('prevents manual Mode A forceOnDemand from enabling recurring collection and respects administrative pause at the next gate',async()=>{
  process.env.MARKET_DATA_SCHEDULER_ENV='disabled';
  const t=convexTest(schema,modules);
  const calledUrls:string[]=[];
  vi.stubGlobal('fetch',mockMarketFetch(calledUrls));

  // Manual Mode A run succeeds
  const manualRes=await t.action(runMarketDataOnlyRef,{
   environment:'remote',
   forceOnDemand:true,
  }) as {result:{status:string};marketDataSchedulerEnv:string};
  expect(manualRes.result.status).toBe('succeeded');
  expect(manualRes.marketDataSchedulerEnv).toBe('disabled');

  // Subsequent scheduled cron tick MUST still skip
  calledUrls.length=0;
  const schedRes=await t.action(runMarketDataOnlyRef,{
   environment:'remote',
   triggerSource:'scheduled_market_data_cron',
  }) as {skippedReason:string};
  expect(schedRes.skippedReason).toBe('market_data_scheduler_disabled');
  expect(calledUrls.length).toBe(0);

  // Public operations overview reports dedicated marketDataScheduler paused state & next-gate pause note
  const pub=await t.query(publicOpsRef,{}) as {
   marketDataScheduler:{
    schedulerEnv:string;
    status:string;
    coveredSymbolsCount:number;
    latestCompletedSessionDate:string;
    maxMonthlyScheduledAttempts:number;
    emergencyPauseNote:string;
   };
  };
  expect(pub.marketDataScheduler.schedulerEnv).toBe('disabled');
  expect(pub.marketDataScheduler.status).toBe('paused');
  expect(pub.marketDataScheduler.coveredSymbolsCount).toBe(8);
  expect(pub.marketDataScheduler.latestCompletedSessionDate).toBe('2026-11-19');
  expect(pub.marketDataScheduler.maxMonthlyScheduledAttempts).toBe(46);
  expect(pub.marketDataScheduler.emergencyPauseNote).toContain('next scheduled cron gate');
 });

 it('enforces US market-session awareness (EST, EDT, holidays, weekends, early close) and 23-weekday max-run math',()=>{
  expect(MARKET_DATA_MAX_WEEKDAYS_PER_MONTH).toBe(23);
  expect(MARKET_DATA_MAX_MONTHLY_SCHEDULED_ATTEMPTS).toBe(46);
  expect(MARKET_DATA_MAX_MONTHLY_PROVIDER_REQUESTS).toBe(414);

  // Thanksgiving holiday (2026-11-26 21:30 UTC)
  const holiday=evaluateUsMarketEodWindow(Date.parse('2026-11-26T21:30:00Z'));
  expect(holiday.eligible).toBe(false);
  expect(holiday.skippedReason).toBe('us_market_closed_holiday');

  // Saturday weekend (2026-11-21 21:30 UTC)
  const weekend=evaluateUsMarketEodWindow(Date.parse('2026-11-21T21:30:00Z'));
  expect(weekend.eligible).toBe(false);
  expect(weekend.skippedReason).toBe('us_market_closed_weekend');

  // Mid-session EST (2026-11-19 19:00 UTC = 14:00 EST)
  const midSession=evaluateUsMarketEodWindow(Date.parse('2026-11-19T19:00:00Z'));
  expect(midSession.eligible).toBe(false);
  expect(midSession.skippedReason).toBe('us_regular_session_not_yet_closed');

  // Summer EDT post-close (2026-07-15 20:30 UTC = 16:30 EDT)
  const summerEdt=evaluateUsMarketEodWindow(Date.parse('2026-07-15T20:30:00Z'));
  expect(summerEdt.eligible).toBe(true);
  expect(summerEdt.expectedLatestCompletedSession).toBe('2026-07-15');

  // Black Friday early close (2026-11-27 18:30 UTC = 13:30 EST)
  const earlyClose=evaluateUsMarketEodWindow(Date.parse('2026-11-27T18:30:00Z'));
  expect(earlyClose.eligible).toBe(true);
  expect(earlyClose.isEarlyClose).toBe(true);
 });

 it('prevents duplicate observations across overlapping cron attempts and slot-2 bounded retry',async()=>{
  process.env.MARKET_DATA_SCHEDULER_ENV='enabled';
  const t=convexTest(schema,modules);
  const calledUrls:string[]=[];
  vi.stubGlobal('fetch',mockMarketFetch(calledUrls));

  // Slot 1 (21:30 UTC) inserts 16 bars
  const slot1=await t.action(runMarketDataOnlyRef,{
   environment:'remote',
   triggerSource:'scheduled_market_data_cron',
  }) as {result:{status:string;detail:string}};
  expect(slot1.result.status).toBe('succeeded');
  expect(slot1.result.detail).toContain('inserted=16');

  // Overlapping attempt 1 minute later is blocked by lease/cooldown (0 provider calls)
  vi.setSystemTime(POST_CLOSE_EST+60_000);
  calledUrls.length=0;
  const overlap=await t.action(runMarketDataOnlyRef,{
   environment:'remote',
   triggerSource:'scheduled_market_data_cron',
  }) as {result:{status:string}};
  expect(overlap.result.status).toBe('not_due');
  expect(calledUrls.length).toBe(0);

  // Slot 2 (22:30 UTC, +60m) runs bounded retry and deduplicates 100% (inserted=0)
  vi.setSystemTime(POST_CLOSE_EST+60*60_000);
  const slot2=await t.action(runMarketDataOnlyRef,{
   environment:'remote',
   triggerSource:'scheduled_market_data_cron',
  }) as {result:{status:string;detail:string}};
  expect(slot2.result.status).toBe('succeeded');
  expect(slot2.result.detail).toContain('inserted=0, total=16');

  const obsCount=await t.run(async(ctx)=>(await ctx.db.query('marketObservations').collect()).length);
  expect(obsCount).toBe(16);
 });

 it('never fabricates market prices on provider failure and reports degraded/stale operational status',async()=>{
  process.env.MARKET_DATA_SCHEDULER_ENV='enabled';
  const t=convexTest(schema,modules);
  const calledUrls:string[]=[];
  vi.stubGlobal('fetch',mockMarketFetch(calledUrls,{failNasdaq:true}));

  const failRes=await t.action(runMarketDataOnlyRef,{
   environment:'remote',
   triggerSource:'scheduled_market_data_cron',
  }) as {result:{status:string}};
  expect(failRes.result.status).toBe('failed');

  const obsCount=await t.run(async(ctx)=>(await ctx.db.query('marketObservations').collect()).length);
  expect(obsCount).toBe(0);

  const status=buildMarketDataOperationalStatus({
   marketDataSchedulerEnv:'enabled',
   nowMs:POST_CLOSE_EST,
   recentMarketRuns:[{startedAt:POST_CLOSE_EST,status:'failed'}],
   latestBySymbol:[],
  });
  expect(status.status).toBe('degraded');
  expect(status.coveredSymbolsCount).toBe(0);
  expect(status.missingSymbols.length).toBe(8);
  expect(status.staleDataWarning).toContain('never fabricated');
 });

 it('schedules dedicated weekday EOD crons targeting runMarketDataOnlyInternal in convex/crons.ts',()=>{
  const cronsSrc=fs.readFileSync(path.join(process.cwd(),'convex/crons.ts'),'utf8');
  expect(cronsSrc).toContain("remoteOpsCloud:runMarketDataOnlyInternal");
  expect(cronsSrc).toContain("'market-data-eod-us-slot-1'");
  expect(cronsSrc).toContain("'30 21 * * 1-5'");
  expect(cronsSrc).toContain("'market-data-eod-us-slot-2'");
  expect(cronsSrc).toContain("'30 22 * * 1-5'");
  expect(cronsSrc).toContain("triggerSource:'scheduled_market_data_cron'");
 });

 it('handles DST spring-forward and fall-back transitions, 15-minute post-close buffer, holiday skip, and 13:00 ET early close end-to-end',async()=>{
  // 15-minute post-close buffer boundary on regular EST day (2026-11-19)
  expect(evaluateUsMarketEodWindow(Date.parse('2026-11-19T21:14:00Z')).skippedReason).toBe('us_regular_session_not_yet_closed');
  expect(evaluateUsMarketEodWindow(Date.parse('2026-11-19T21:15:00Z')).eligible).toBe(true);

  // Spring-forward DST transition (2026-03-08): Fri before (EST) vs Mon after (EDT)
  expect(evaluateUsMarketEodWindow(Date.parse('2026-03-06T21:30:00Z')).eligible).toBe(true); // 16:30 EST
  expect(evaluateUsMarketEodWindow(Date.parse('2026-03-09T19:59:00Z')).skippedReason).toBe('us_regular_session_not_yet_closed'); // 15:59 EDT
  expect(evaluateUsMarketEodWindow(Date.parse('2026-03-09T20:30:00Z')).eligible).toBe(true); // 16:30 EDT

  // Fall-back DST transition (2026-11-01): Fri before (EDT) vs Mon after (EST)
  expect(evaluateUsMarketEodWindow(Date.parse('2026-10-30T20:30:00Z')).eligible).toBe(true); // 16:30 EDT
  expect(evaluateUsMarketEodWindow(Date.parse('2026-11-02T20:30:00Z')).skippedReason).toBe('us_regular_session_not_yet_closed'); // 15:30 EST!
  expect(evaluateUsMarketEodWindow(Date.parse('2026-11-02T21:30:00Z')).eligible).toBe(true); // 16:30 EST

  // 13:00 ET early-close boundary (Black Friday 2026-11-27)
  expect(evaluateUsMarketEodWindow(Date.parse('2026-11-27T18:14:00Z')).skippedReason).toBe('us_regular_session_not_yet_closed');
  expect(evaluateUsMarketEodWindow(Date.parse('2026-11-27T18:15:00Z')).eligible).toBe(true);

  // End-to-end Thanksgiving holiday invocation (2026-11-26 21:30 UTC): 0 fetches, 0 DB writes
  process.env.MARKET_DATA_SCHEDULER_ENV='enabled';
  const t=convexTest(schema,modules);
  const calledUrls:string[]=[];
  vi.stubGlobal('fetch',mockMarketFetch(calledUrls));
  vi.setSystemTime(Date.parse('2026-11-26T21:30:00Z'));

  const holidayRes=await t.action(runMarketDataOnlyRef,{
   environment:'remote',
   triggerSource:'scheduled_market_data_cron',
  }) as {skippedReason:string;typedbProjectionInvoked:boolean};
  expect(holidayRes.skippedReason).toBe('us_market_closed_holiday');
  expect(holidayRes.typedbProjectionInvoked).toBe(false);
  expect(calledUrls.length).toBe(0);

  // End-to-end Black Friday early-close invocation (2026-11-27 18:15 UTC = 13:15 EST)
  vi.setSystemTime(Date.parse('2026-11-27T18:15:00Z'));
  const earlyRes=await t.action(runMarketDataOnlyRef,{
   environment:'remote',
   triggerSource:'scheduled_market_data_cron',
  }) as {result:{status:string};marketWindow:{isEarlyClose:boolean}};
  expect(earlyRes.marketWindow.isEarlyClose).toBe(true);
  expect(earlyRes.result.status).toBe('succeeded');
 });

 it('handles delayed provider publication at Slot 1 without fabricating closes, recovers at Slot 2, blocks active in-flight lease, and pauses cleanly when disabled',async()=>{
  process.env.MARKET_DATA_SCHEDULER_ENV='enabled';
  process.env.RESEARCH_SCHEDULER_ENV='disabled';
  const t=convexTest(schema,modules);

  // Seed pending graphProjectionOutbox row to prove 0 TypeDB/outbox writes across all phases
  const outboxId=await t.run((ctx)=>ctx.db.insert('graphProjectionOutbox',{
   owner:OWNER,
   visibility:'public_research',
   sequence:1,
   projectionKey:'proj-rc0024-pending-001',
   sourceTable:'evidence',
   sourceRecordId:'ev-rc0024-001',
   sourceEvidenceIds:['ev-rc0024-001'],
   graphSchemaVersion:'macro-intelligence-graph-3.14-v1',
   relationshipId:'rel-rc0024-001',
   payloadJson:'{}',
   typeqlJson:'[]',
   reviewer:'rc0024-test',
   status:'pending',
   attemptCount:0,
   maxAttempts:3,
   nextAttemptAtMs:POST_CLOSE_EST-60_000,
   lastError:null,
   projectedAtMs:null,
   createdAtMs:POST_CLOSE_EST-120_000,
   updatedAtMs:POST_CLOSE_EST-120_000,
   executionAuthority:'none',
  }));

  // Slot 1 (21:30 UTC): delayed provider only returns 2026-11-18 (2026-11-19 not published yet)
  let includeNov19=false;
  const calledUrls:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
   const url=typeof input==='string'?input:input instanceof URL?input.toString():input.url;
   calledUrls.push(url);
   if(url.includes('typedb')||url.includes('sec.gov')||url.includes('trading212')){
    throw new Error(`FORBIDDEN_CALL: ${url}`);
   }
   if(url.startsWith('https://api.frankfurter.app/')){
    return new Response(JSON.stringify({amount:1,base:'USD',rates:{'2026-11-18':{GBP:0.75939},'2026-11-19':{GBP:0.76038}}}),{status:200,headers:{'Content-Type':'application/json'}});
   }
   const rows=includeNov19
    ?[
      {date:'11/19/2026',close:'$152.10',volume:'15,000,000',open:'$151.00',high:'$153.20',low:'$150.40'},
      {date:'11/18/2026',close:'$150.96',volume:'12,345,678',open:'$149.50',high:'$152.10',low:'$148.90'},
     ]
    :[{date:'11/18/2026',close:'$150.96',volume:'12,345,678',open:'$149.50',high:'$152.10',low:'$148.90'}];
   return new Response(JSON.stringify({data:{tradesTable:{rows}}}),{status:200,headers:{'Content-Type':'application/json'}});
  }));

  const slot1=await t.action(runMarketDataOnlyRef,{
   environment:'remote',
   triggerSource:'scheduled_market_data_cron',
  }) as {result:{status:string;detail:string}};
  expect(slot1.result.status).toBe('succeeded');
  expect(slot1.result.detail).toContain('inserted=8, total=8');

  // Public status must honestly report stale (2026-11-18 lags expected 2026-11-19) — never fabricated!
  const pubAfterSlot1=await t.query(publicOpsRef,{}) as {marketDataScheduler:{status:string;latestCompletedSessionDate:string;staleDataWarning:string|null}};
  expect(pubAfterSlot1.marketDataScheduler.status).toBe('stale');
  expect(pubAfterSlot1.marketDataScheduler.latestCompletedSessionDate).toBe('2026-11-18');
  expect(pubAfterSlot1.marketDataScheduler.staleDataWarning).toContain('behind expected US session (2026-11-19)');

  // Simulate active in-flight lease on market_data_collect -> overlapping invocation blocked as lease_active (0 fetches)
  vi.setSystemTime(POST_CLOSE_EST+60*60_000);
  await t.run(async(ctx)=>{
   const job=await ctx.db.query('researchJobs').filter((q)=>q.eq(q.field('jobKey'),'market_data_collect')).first();
   if(job){
    await ctx.db.patch(job._id,{leaseToken:'in-flight-lease-001',leaseUntil:POST_CLOSE_EST+60*60_000+30_000});
   }
  });
  calledUrls.length=0;
  const inFlightOverlap=await t.action(runMarketDataOnlyRef,{
   environment:'remote',
   triggerSource:'scheduled_market_data_cron',
  }) as {result:{status:string}};
  expect(inFlightOverlap.result.status).toBe('lease_held');
  expect(calledUrls.length).toBe(0);

  // Release lease; Slot 2 (22:30 UTC) now sees delayed 2026-11-19 close -> inserts 8 new bars and clears stale warning
  await t.run(async(ctx)=>{
   const job=await ctx.db.query('researchJobs').filter((q)=>q.eq(q.field('jobKey'),'market_data_collect')).first();
   if(job){
    await ctx.db.patch(job._id,{leaseToken:null,leaseUntil:0});
   }
  });
  includeNov19=true;
  const slot2=await t.action(runMarketDataOnlyRef,{
   environment:'remote',
   triggerSource:'scheduled_market_data_cron',
  }) as {result:{status:string;detail:string}};
  expect(slot2.result.status).toBe('succeeded');
  expect(slot2.result.detail).toContain('inserted=8, total=16');

  const pubAfterSlot2=await t.query(publicOpsRef,{}) as {marketDataScheduler:{status:string;latestCompletedSessionDate:string;staleDataWarning:string|null}};
  expect(pubAfterSlot2.marketDataScheduler.status).toBe('active');
  expect(pubAfterSlot2.marketDataScheduler.latestCompletedSessionDate).toBe('2026-11-19');
  expect(pubAfterSlot2.marketDataScheduler.staleDataWarning).toBeNull();

  // Disable MARKET_DATA_SCHEDULER_ENV -> next scheduled tick skips without affecting RESEARCH_SCHEDULER_ENV
  process.env.MARKET_DATA_SCHEDULER_ENV='disabled';
  vi.setSystemTime(POST_CLOSE_EST+120*60_000);
  calledUrls.length=0;
  const pausedTick=await t.action(runMarketDataOnlyRef,{
   environment:'remote',
   triggerSource:'scheduled_market_data_cron',
  }) as {skippedReason:string};
  expect(pausedTick.skippedReason).toBe('market_data_scheduler_disabled');
  expect(calledUrls.length).toBe(0);
  expect(process.env.RESEARCH_SCHEDULER_ENV).toBe('disabled');

  // Verify zero unauthorized writes across all protected tables + pending outbox row untouched
  const finalState=await t.run(async(ctx)=>({
   obs:(await ctx.db.query('marketObservations').collect()).length,
   quotes:(await ctx.db.query('quotes').collect()).length,
   runs:(await ctx.db.query('researchJobRuns').collect()).map((r)=>r.jobKey),
   staging:(await ctx.db.query('researchStagingItems').collect()).length,
   evidence:(await ctx.db.query('evidence').collect()).length,
   quarantines:(await ctx.db.query('evidenceQuarantines').collect()).length,
   briefings:(await ctx.db.query('morningBriefings').collect()).length,
   orders:(await ctx.db.query('tradeOrders').collect()).length,
   brokers:(await ctx.db.query('brokerConnections').collect()).length,
   outboxRow:await ctx.db.get(outboxId),
  }));
  expect(finalState.obs).toBe(16);
  expect(finalState.quotes).toBe(16);
  expect(finalState.runs).toEqual(['market_data_collect','market_data_collect']);
  expect(finalState.staging).toBe(0);
  expect(finalState.evidence).toBe(0);
  expect(finalState.quarantines).toBe(0);
  expect(finalState.briefings).toBe(0);
  expect(finalState.orders).toBe(0);
  expect(finalState.brokers).toBe(0);
  expect(finalState.outboxRow?.status).toBe('pending');
  expect(finalState.outboxRow?.attemptCount).toBe(0);
 });

 it('recovers at Slot 2 even after 3+ consecutive failures (45m backoff cap) and handles double-slot outage without fabricating data',async()=>{
  process.env.MARKET_DATA_SCHEDULER_ENV='enabled';
  const t=convexTest(schema,modules);
  const calledUrls:string[]=[];

  // Scenario A: Both Slot 1 (21:30Z) and Slot 2 (22:30Z) fail on outage -> 0 fabricated rows
  vi.stubGlobal('fetch',mockMarketFetch(calledUrls,{failNasdaq:true}));
  const day1Slot1=await t.action(runMarketDataOnlyRef,{
   environment:'remote',
   triggerSource:'scheduled_market_data_cron',
  }) as {result:{status:string}};
  expect(day1Slot1.result.status).toBe('failed');

  vi.setSystemTime(POST_CLOSE_EST+60*60_000); // 22:30 UTC
  const day1Slot2=await t.action(runMarketDataOnlyRef,{
   environment:'remote',
   triggerSource:'scheduled_market_data_cron',
  }) as {result:{status:string}};
  expect(day1Slot2.result.status).toBe('failed');

  // Next trading day Slot 1 (2026-11-20 21:30 UTC): 3rd consecutive failure!
  const day2Slot1Ms=Date.parse('2026-11-20T21:30:00Z');
  vi.setSystemTime(day2Slot1Ms);
  const day2Slot1=await t.action(runMarketDataOnlyRef,{
   environment:'remote',
   triggerSource:'scheduled_market_data_cron',
  }) as {result:{status:string}};
  expect(day2Slot1.result.status).toBe('failed');

  // Still 0 fabricated observations after 3 consecutive failures
  const obsAfter3Fails=await t.run(async(ctx)=>(await ctx.db.query('marketObservations').collect()).length);
  expect(obsAfter3Fails).toBe(0);

  // 10 minutes later (21:40 UTC): cooldown still blocks rapid overlap (within 45m cap)
  vi.setSystemTime(day2Slot1Ms+10*60_000);
  calledUrls.length=0;
  const tooEarly=await t.action(runMarketDataOnlyRef,{
   environment:'remote',
   triggerSource:'scheduled_market_data_cron',
  }) as {result:{status:string}};
  expect(tooEarly.result.status).toBe('not_due');
  expect(calledUrls.length).toBe(0);

  // Day 2 Slot 2 (22:30 UTC, +60m after 3rd failure): provider recovers -> MUST NOT be blocked by backoff!
  vi.setSystemTime(day2Slot1Ms+60*60_000);
  vi.stubGlobal('fetch',mockMarketFetch(calledUrls,{failNasdaq:false}));
  const day2Slot2=await t.action(runMarketDataOnlyRef,{
   environment:'remote',
   triggerSource:'scheduled_market_data_cron',
  }) as {result:{status:string;detail:string}};
  expect(day2Slot2.result.status).toBe('succeeded');
  expect(day2Slot2.result.detail).toContain('inserted=16');

  const runs=await t.run(async(ctx)=>await ctx.db.query('researchJobRuns').collect());
  expect(runs.map((r)=>r.status)).toEqual(['failed','failed','failed','succeeded']);
  expect(runs.slice(0,3).every((r)=>r.errorCode==='market_provider_unavailable')).toBe(true);
 });

 it('surfaces partial symbol coverage as degraded/incomplete (never healthy) and computes nextExpectedCollectionAtUtc',async()=>{
  process.env.MARKET_DATA_SCHEDULER_ENV='enabled';
  const t=convexTest(schema,modules);
  const failingSymbols=new Set(['AMD','CRWV','QQQ']);
  const calledUrls:string[]=[];

  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
   const url=typeof input==='string'?input:input instanceof URL?input.toString():input.url;
   calledUrls.push(url);
   if(url.startsWith('https://api.frankfurter.app/')){
    return new Response(JSON.stringify({amount:1,base:'USD',rates:{'2026-11-18':{GBP:0.75939},'2026-11-19':{GBP:0.76038}}}),{status:200,headers:{'Content-Type':'application/json'}});
   }
   for(const sym of failingSymbols){
    if(url.includes(`/quote/${sym}/`)){
     return new Response('Upstream partial error',{status:503});
    }
   }
   return new Response(
    JSON.stringify({
     data:{
      tradesTable:{
       rows:[{date:'11/19/2026',close:'$152.10',volume:'15,000,000',open:'$151.00',high:'$153.20',low:'$150.40'}],
      },
     },
    }),
    {status:200,headers:{'Content-Type':'application/json'}},
   );
  }));

  // Slot 1 (21:30Z): 5 symbols succeed, 3 fail -> stores 5 valid rows, marks degraded/incomplete
  const slot1=await t.action(runMarketDataOnlyRef,{
   environment:'remote',
   triggerSource:'scheduled_market_data_cron',
  }) as {result:{status:string;detail:string}};
  expect(slot1.result.status).toBe('succeeded');
  expect(slot1.result.detail).toContain('inserted=5');

  const pubPartial=await t.query(publicOpsRef,{}) as {
   marketDataScheduler:{
    status:string;
    schedulerActive:boolean;
    lastCollectionSucceeded:boolean;
    dataFresh:boolean;
    dataIncomplete:boolean;
    coveredSymbolsCount:number;
    missingSymbols:string[];
    lastErrorCode:string|null;
    nextExpectedCollectionAtUtc:string|null;
    staleDataWarning:string|null;
   };
  };
  expect(pubPartial.marketDataScheduler.status).toBe('degraded');
  expect(pubPartial.marketDataScheduler.schedulerActive).toBe(true);
  expect(pubPartial.marketDataScheduler.lastCollectionSucceeded).toBe(false);
  expect(pubPartial.marketDataScheduler.dataFresh).toBe(false);
  expect(pubPartial.marketDataScheduler.dataIncomplete).toBe(true);
  expect(pubPartial.marketDataScheduler.coveredSymbolsCount).toBe(5);
  expect(pubPartial.marketDataScheduler.missingSymbols).toEqual(['AMD','CRWV','QQQ']);
  expect(pubPartial.marketDataScheduler.lastErrorCode).toBe('partial_symbol_provider_error');
  expect(pubPartial.marketDataScheduler.nextExpectedCollectionAtUtc).toBe('2026-11-19T22:30:00Z');
  expect(pubPartial.marketDataScheduler.staleDataWarning).toContain('AMD, CRWV, QQQ');

  // Slot 2 (22:30Z): all 8 symbols succeed -> recovers missing 3, clears degraded/stale, advances next window to Fri 21:30Z
  failingSymbols.clear();
  vi.setSystemTime(POST_CLOSE_EST+60*60_000);
  await t.action(runMarketDataOnlyRef,{
   environment:'remote',
   triggerSource:'scheduled_market_data_cron',
  });

  const pubRecovered=await t.query(publicOpsRef,{}) as {
   marketDataScheduler:{
    status:string;
    schedulerActive:boolean;
    lastCollectionSucceeded:boolean;
    dataFresh:boolean;
    dataIncomplete:boolean;
    coveredSymbolsCount:number;
    missingSymbols:string[];
    lastErrorCode:string|null;
    nextExpectedCollectionAtUtc:string|null;
    staleDataWarning:string|null;
   };
  };
  expect(pubRecovered.marketDataScheduler.status).toBe('active');
  expect(pubRecovered.marketDataScheduler.schedulerActive).toBe(true);
  expect(pubRecovered.marketDataScheduler.lastCollectionSucceeded).toBe(true);
  expect(pubRecovered.marketDataScheduler.dataFresh).toBe(true);
  expect(pubRecovered.marketDataScheduler.dataIncomplete).toBe(false);
  expect(pubRecovered.marketDataScheduler.coveredSymbolsCount).toBe(8);
  expect(pubRecovered.marketDataScheduler.missingSymbols).toEqual([]);
  expect(pubRecovered.marketDataScheduler.lastErrorCode).toBeNull();
  expect(pubRecovered.marketDataScheduler.nextExpectedCollectionAtUtc).toBe('2026-11-20T21:30:00Z');
  expect(pubRecovered.marketDataScheduler.staleDataWarning).toBeNull();
 });
});
