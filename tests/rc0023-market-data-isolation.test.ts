import fs from 'node:fs';
import path from 'node:path';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';
import {MARKET_DATA_SYMBOLS} from '../lib/market-data/provider-adapter';

const modules={
 './_generated/server.ts':async()=>({}),
 './operations.ts':()=>import('../convex/operations'),
 './remoteOpsCloud.ts':()=>import('../convex/remoteOpsCloud'),
 './graph.ts':()=>import('../convex/graph'),
 './research.ts':()=>import('../convex/research'),
};

const OWNER='https://issuer.test|rc0023_owner';
const NOW=Date.parse('2026-11-19T17:10:00Z');
const runMarketDataOnlyRef=makeFunctionReference<'action'>('remoteOpsCloud:runMarketDataOnlyInternal');
const runScheduledCloudCycleRef=makeFunctionReference<'action'>('remoteOpsCloud:runScheduledCloudCycle');

const ORIGINAL_ENV={
 RESEARCH_OWNER_ID:process.env.RESEARCH_OWNER_ID,
 RESEARCH_SCHEDULER_ENV:process.env.RESEARCH_SCHEDULER_ENV,
 TYPEDB_HTTP_ADDRESS:process.env.TYPEDB_HTTP_ADDRESS,
 TYPEDB_DATABASE:process.env.TYPEDB_DATABASE,
};

function mockMarketDataFetch(calledUrls:string[]){
 return vi.fn(async(input:RequestInfo|URL)=>{
  const url=typeof input==='string'?input:input instanceof URL?input.toString():input.url;
  calledUrls.push(url);

  if(url.includes('typedb')||url.includes('sec.gov')||url.includes('trading212')){
   throw new Error(`FORBIDDEN_OUTBOUND_CALL_IN_MARKET_DATA_ONLY: ${url}`);
  }

  if(url.startsWith('https://api.frankfurter.app/')){
   return new Response(
    JSON.stringify({
     amount:1,
     base:'USD',
     start_date:'2026-11-16',
     end_date:'2026-11-18',
     rates:{
      '2026-11-16':{GBP:0.75812},
      '2026-11-17':{GBP:0.75884},
      '2026-11-18':{GBP:0.75939},
     },
    }),
    {status:200,headers:{'Content-Type':'application/json'}},
   );
  }

  if(url.startsWith('https://api.nasdaq.com/api/quote/')){
   return new Response(
    JSON.stringify({
     data:{
      tradesTable:{
       rows:[
        {date:'11/18/2026',close:'$150.96',volume:'12,345,678',open:'$149.50',high:'$152.10',low:'$148.90'},
        {date:'11/17/2026',close:'$149.10',volume:'11,223,344',open:'$148.00',high:'$150.00',low:'$147.20'},
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

async function seedPendingOutboxRow(t:ReturnType<typeof convexTest>){
 return t.run(async(ctx)=>
  ctx.db.insert('graphProjectionOutbox',{
   owner:OWNER,
   visibility:'public_research',
   sequence:1,
   projectionKey:'proj-rc0023-adversarial-pending-001',
   sourceTable:'evidence',
   sourceRecordId:'ev-rc0023-pending-001',
   sourceEvidenceIds:['ev-rc0023-pending-001'],
   graphSchemaVersion:'macro-intelligence-graph-3.14-v1',
   relationshipId:'rel-rc0023-pending-001',
   payloadJson:'{"test":"pending_outbox_must_not_project"}',
   typeqlJson:'[]',
   reviewer:'rc0023-test',
   status:'pending',
   attemptCount:0,
   maxAttempts:3,
   nextAttemptAtMs:NOW-60_000,
   lastError:null,
   projectedAtMs:null,
   createdAtMs:NOW-120_000,
   updatedAtMs:NOW-120_000,
   executionAuthority:'none',
  }),
 );
}

beforeEach(()=>{
 vi.useFakeTimers();
 vi.setSystemTime(NOW);
 process.env.RESEARCH_OWNER_ID=OWNER;
 process.env.RESEARCH_SCHEDULER_ENV='disabled';
 process.env.TYPEDB_HTTP_ADDRESS='https://typedb.adversarial.invalid:8000';
 process.env.TYPEDB_DATABASE='aci_macro_intelligence_prod';
});

afterEach(()=>{
 vi.useRealTimers();
 vi.unstubAllGlobals();
 for(const [k,v] of Object.entries(ORIGINAL_ENV)){
  if(v===undefined)delete process.env[k];
  else process.env[k]=v;
 }
});

describe('RC002.3 — Isolated market-data collection (runMarketDataOnlyInternal)',()=>{
 it('collects 8 approved symbols + USD/GBP FX and never triggers TypeDB projection even with TYPEDB_HTTP_ADDRESS set and pending outbox rows',async()=>{
  const t=convexTest(schema,modules);
  const outboxId=await seedPendingOutboxRow(t);
  const calledUrls:string[]=[];
  vi.stubGlobal('fetch',mockMarketDataFetch(calledUrls));

  const res=await t.action(runMarketDataOnlyRef,{
   environment:'remote',
   forceOnDemand:true,
  }) as {
   executedAt:number;
   environment:string;
   result:{jobKey:string;status:string;runId?:string;detail:string}|null;
   coveredSymbols:string[];
   typedbProjectionInvoked:boolean;
   executionAuthority:string;
  };

  expect(res.environment).toBe('remote');
  expect(res.typedbProjectionInvoked).toBe(false);
  expect(res.executionAuthority).toBe('none');
  expect(res.coveredSymbols).toEqual([...MARKET_DATA_SYMBOLS]);
  expect(res.result?.jobKey).toBe('market_data_collect');
  expect(res.result?.status).toBe('succeeded');

  // Strict network boundary: only Nasdaq EOD (8 symbols) + Frankfurter ECB FX (1 call)
  expect(calledUrls.some((u)=>u.includes('typedb'))).toBe(false);
  expect(calledUrls.some((u)=>u.includes('sec.gov'))).toBe(false);
  expect(calledUrls.some((u)=>u.includes('trading212'))).toBe(false);
  expect(calledUrls.filter((u)=>u.startsWith('https://api.nasdaq.com/api/quote/')).length).toBe(8);
  expect(calledUrls.filter((u)=>u.startsWith('https://api.frankfurter.app/')).length).toBe(1);

  // Verify DB state: observations + quotes + 1 job run written; ALL protected tables untouched
  const snapshot=await t.run(async(ctx)=>({
   observations:await ctx.db.query('marketObservations').collect(),
   quotes:await ctx.db.query('quotes').collect(),
   jobRuns:await ctx.db.query('researchJobRuns').collect(),
   staging:await ctx.db.query('researchStagingItems').collect(),
   evidence:await ctx.db.query('evidence').collect(),
   quarantines:await ctx.db.query('evidenceQuarantines').collect(),
   briefings:await ctx.db.query('morningBriefings').collect(),
   outbox:await ctx.db.query('graphProjectionOutbox').collect(),
   pendingOutboxRow:await ctx.db.get(outboxId),
   tradeOrders:await ctx.db.query('tradeOrders').collect(),
  }));

  expect(snapshot.observations.length).toBe(16); // 8 symbols * 2 bars
  expect(snapshot.quotes.length).toBe(16);
  expect(snapshot.jobRuns.length).toBe(1);
  expect(snapshot.jobRuns[0]?.jobKey).toBe('market_data_collect');
  expect(snapshot.jobRuns[0]?.status).toBe('succeeded');

  // Provenance, delay, Trading 212 exclusion, and executionAuthority invariants
  for(const obs of snapshot.observations){
   expect(obs.usage).toBe('public_reference');
   expect(obs.isTrading212PositionPrice).toBe(false);
   expect(obs.executionAuthority).toBe('none');
   expect(obs.declaredDelayMs).toBeGreaterThan(0);
   expect(obs.sourceUrl).toMatch(/^https:\/\/api\.nasdaq\.com\/api\/quote\//);
   expect(obs.fxProvider).toContain('ECB');
  }
  for(const q of snapshot.quotes){
   expect(q.synthetic).toBe(false);
  }

  // Zero mutation to staging, evidence, quarantine, briefings, outbox, or trading tables
  expect(snapshot.staging.length).toBe(0);
  expect(snapshot.evidence.length).toBe(0);
  expect(snapshot.quarantines.length).toBe(0);
  expect(snapshot.briefings.length).toBe(0);
  expect(snapshot.tradeOrders.length).toBe(0);
  expect(snapshot.outbox.length).toBe(1);
  expect(snapshot.pendingOutboxRow?.status).toBe('pending');
  expect(snapshot.pendingOutboxRow?.attemptCount).toBe(0);
  expect(snapshot.pendingOutboxRow?.projectedAtMs).toBeNull();
 });

 it('respects RESEARCH_SCHEDULER_ENV=disabled when forceOnDemand is omitted or false',async()=>{
  const t=convexTest(schema,modules);
  const calledUrls:string[]=[];
  vi.stubGlobal('fetch',mockMarketDataFetch(calledUrls));

  const res=await t.action(runMarketDataOnlyRef,{}) as {
   environment:string;
   result:null;
   skippedReason:string;
   typedbProjectionInvoked:boolean;
   executionAuthority:string;
  };

  expect(res.environment).toBe('disabled');
  expect(res.result).toBeNull();
  expect(res.skippedReason).toBe('scheduler_env_disabled_to_prevent_duplicate_dev_prod_collection');
  expect(res.typedbProjectionInvoked).toBe(false);
  expect(res.executionAuthority).toBe('none');
  expect(calledUrls.length).toBe(0);
 });

 it('structurally rejects non-market job routing via Convex strict argument validation',async()=>{
  const t=convexTest(schema,modules);
  await expect(
   t.action(runMarketDataOnlyRef,{
    jobs:['sec_filings_collect'],
    forceOnDemand:true,
   } as Record<string,unknown>),
  ).rejects.toThrow();
 });

 it('defense-in-depth: runScheduledCloudCycle with jobs:["market_data_collect"] also skips TypeDB projection',async()=>{
  const t=convexTest(schema,modules);
  const outboxId=await seedPendingOutboxRow(t);
  const calledUrls:string[]=[];
  vi.stubGlobal('fetch',mockMarketDataFetch(calledUrls));

  const res=await t.action(runScheduledCloudCycleRef,{
   environment:'remote',
   jobs:['market_data_collect'],
   forceOnDemand:true,
  }) as {
   results:Array<{jobKey:string;status:string}>;
   executionAuthority:string;
  };

  expect(res.executionAuthority).toBe('none');
  expect(res.results.map((r)=>r.jobKey)).toEqual(['market_data_collect']);
  expect(calledUrls.some((u)=>u.includes('typedb'))).toBe(false);

  const pendingOutbox=await t.run((ctx)=>ctx.db.get(outboxId));
  expect(pendingOutbox?.status).toBe('pending');
  expect(pendingOutbox?.attemptCount).toBe(0);
 });

 it('exposes runMarketDataOnlyInternal strictly as internal-only with zero public HTTP endpoint',()=>{
  const cloudSrc=fs.readFileSync(path.join(process.cwd(),'convex/remoteOpsCloud.ts'),'utf8');
  expect(cloudSrc).toMatch(/export const runMarketDataOnlyInternal\s*=\s*internalAction\(/);
  const httpPath=path.join(process.cwd(),'convex/http.ts');
  if(fs.existsSync(httpPath)){
   const httpSrc=fs.readFileSync(httpPath,'utf8');
   expect(httpSrc).not.toContain('runMarketDataOnlyInternal');
  }
  const serverSrc=fs.readFileSync(path.join(process.cwd(),'lib/remote-ops/server.ts'),'utf8');
  expect(serverSrc).not.toContain('runMarketDataOnlyInternal');
 });
});
