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
});
