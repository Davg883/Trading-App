import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
vi.mock('server-only',()=>({}));
const authMock=vi.hoisted(()=>vi.fn());
vi.mock('@clerk/nextjs/server',()=>({auth:authMock}));
import {getResearchStagingCursor,runScheduledOperations,submitResearchStaging,updateOperationsSettings} from '../lib/remote-ops/server';
import {vaultConfigured} from '../lib/brokers/vault';

const STAGING_TOKEN='staging-machine-token-0123456789abcdef0123456789';
const SCHEDULER_SECRET='scheduler-secret-token-0123456789abcdef0123456789';
const OWNER='https://mock.clerk.test|user-owner';
const NOW=Date.parse('2026-11-06T16:00:00Z');

type ConvexCall={url:string;auth:string|null;body:string};

function installMockConvex(){
 const calls:ConvexCall[]=[];
 const transport=vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{
  const url=typeof input==='string'?input:input instanceof URL?input.toString():input.url;
  const body=typeof init?.body==='string'?init.body:'';
  calls.push({url,auth:new Headers(init?.headers).get('authorization'),body});
  const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  if(url.startsWith('https://mock.convex.cloud/api/')){
   const payload=JSON.parse(body) as {path:string;args:[Record<string,unknown>]};
   if(payload.path==='operations:getStagingStateInternal'){
    return json({status:'success',value:{
     cursor:'cursor:1793900000000:abc',
     systemEnabled:true,
     activeEnvironment:'remote',
     dailyCostCeilingGbp:2.0,
     monthlyCostCeilingGbp:25.0,
     spend:{dailyEstimated:0.01,dailyActual:0.01,monthlyEstimated:0.1,monthlyActual:0.1},
     seenUrls:['https://www.sec.gov/existing'],
     seenContentHashes:['hash1'],
     seenFactKeys:[],
    }});
   }
   if(payload.path==='operations:submitStagedResearchInternal'){
    return json({status:'success',value:{
     runId:'run-1',
     idempotentReplay:false,
     sourcesDiscovered:1,
     evidenceStaged:1,
     evidencePromoted:1,
     duplicatesSkipped:0,
     pendingVerification:0,
     quarantinedCount:0,
     cursorAfter:'cursor:1793980800000:def',
     executionAuthority:'none',
    }});
   }
   if(payload.path==='operations:acquireJobLeaseInternal'){
    return json({status:'success',value:{ok:true,jobKey:payload.args[0].jobKey,leaseToken:'lease-1',cursor:null,timeoutMs:60000}});
   }
   if(payload.path==='operations:recordDeterministicRunInternal'){
    return json({status:'success',value:{stored:true,idempotentReplay:false}});
   }
   throw new Error(`Unexpected Convex function called by staging server: ${payload.path}`);
  }
  throw new Error(`Unexpected external destination: ${url}`);
 });
 vi.stubGlobal('fetch',transport);
 return calls;
}

beforeEach(()=>{
 vi.stubEnv('NEXT_PUBLIC_CONVEX_URL','https://mock.convex.cloud');
 vi.stubEnv('CONVEX_STAGING_DEPLOY_KEY','mock-staging-deploy-key');
 vi.stubEnv('RESEARCH_STAGING_TOKEN',STAGING_TOKEN);
 vi.stubEnv('OPERATIONS_SCHEDULER_SECRET',SCHEDULER_SECRET);
 vi.stubEnv('RESEARCH_OWNER_ID',OWNER);
});

afterEach(()=>{
 vi.unstubAllGlobals();
 vi.unstubAllEnvs();
 vi.restoreAllMocks();
});

describe('Phase 003 server route security & least-privilege isolation',()=>{
 it('authenticates staging requests with a dedicated machine token and rejects missing or wrong tokens',async()=>{
  const calls=installMockConvex();
  const unauth=await getResearchStagingCursor(new Request('http://localhost:3000/api/research/staging',{method:'GET'}));
  expect(unauth.status).toBe(401);
  expect(calls).toHaveLength(0);

  const valid=await getResearchStagingCursor(new Request('http://localhost:3000/api/research/staging',{
   method:'GET',
   headers:{Authorization:`Bearer ${STAGING_TOKEN}`},
  }));
  expect(valid.status).toBe(200);
  const body=await valid.json() as {cursor:string;executionAuthority:string;universe:unknown[]};
  expect(body.cursor).toBe('cursor:1793900000000:abc');
  expect(body.executionAuthority).toBe('none');
  expect(body.universe.length).toBeGreaterThanOrEqual(11);
 });

 it('rejects staging payloads that attempt to supply owner, broker credentials, roles or trading flags',async()=>{
  const calls=installMockConvex();
  for(const forbiddenField of [
   {owner:'https://attacker.test|victim'},
   {apiKey:'leaked-t212-key'},
   {liveTradingEnabled:true},
   {liveKillSwitchEngaged:false},
   {role:'reviewer'},
  ]){
   const res=await submitResearchStaging(new Request('http://localhost:3000/api/research/staging',{
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${STAGING_TOKEN}`},
    body:JSON.stringify({
     runId:'run-forbidden',
     agentId:'remote-agent',
     cursorBefore:null,
     cursorAfter:'cursor:1',
     modelVersion:'gemini-2.5-flash-preview',
     inputTokens:100,
     outputTokens:50,
     estimatedCostGbp:0.001,
     items:[],
     ...forbiddenField,
    }),
   }));
   expect(res.status).toBe(403);
   expect(await res.json()).toMatchObject({error:{code:'forbidden_capability'}});
  }
  expect(calls).toHaveLength(0);
 });

 it('keeps deterministic market-data, filing, risk and briefing jobs running when AI models fail',async()=>{
  installMockConvex();
  const res=await runScheduledOperations(new Request('http://localhost:3000/api/operations/scheduled',{
   method:'POST',
   headers:{'Content-Type':'application/json',Authorization:`Bearer ${SCHEDULER_SECRET}`},
   body:JSON.stringify({
    environment:'remote',
    forceOnDemand:true,
    simulateModelFailure:true,
   }),
  }));
  expect(res.status).toBe(200);
  const body=await res.json() as {results:Array<{jobKey:string;status:string}>;executionAuthority:string};
  expect(body.executionAuthority).toBe('none');
  const byJob=new Map(body.results.map(r=>[r.jobKey,r.status]));
  expect(byJob.get('news_discovery_agent')).toBe('failed');
  expect(byJob.get('market_data_collect')).toBe('succeeded');
  expect(byJob.get('sec_filings_collect')).toBe('succeeded');
  expect(byJob.get('portfolio_risk_refresh')).toBe('succeeded');
  expect(byJob.get('daily_intelligence_briefing')).toBe('succeeded');
 });

 it('contains zero references to broker vault keys, broker admin keys or order submission in remote-ops modules',()=>{
  const files=[
   'lib/remote-ops/contracts.ts',
   'lib/remote-ops/health-monitor.ts',
   'lib/remote-ops/morning-briefing.ts',
   'lib/remote-ops/news-agent.ts',
   'lib/remote-ops/server.ts',
   'components/command-centre/agent-operations-panel.tsx',
   'components/command-centre/morning-brief-panel.tsx',
  ];
  for(const f of files){
   const src=readFileSync(f,'utf8');
   expect(src).not.toMatch(/BROKER_VAULT_KEY_B64|CONVEX_BROKER_ADMIN_KEY|trading212-orders|equity\/orders|submitOrder/);
  }
 });

 it('enforces CSRF origin checks (403), Clerk authentication (401), and Preview environment isolation (503)',async()=>{
  vi.stubEnv('RESEARCH_APP_ORIGIN','https://trading-app-theta-two.vercel.app');
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','pk_test_mock');
  vi.stubEnv('CLERK_SECRET_KEY','sk_test_mock');

  const crossOrigin=await updateOperationsSettings(new Request('https://trading-app-theta-two.vercel.app/api/operations/settings',{
   method:'POST',
   headers:{'Content-Type':'application/json',Origin:'https://evil.example.com'},
   body:JSON.stringify({action:'set_job_enabled',jobKey:'sec_filings_collect',enabled:true}),
  }));
  expect(crossOrigin.status).toBe(403);
  expect(await crossOrigin.json()).toMatchObject({error:{code:'forbidden_origin'}});

  authMock.mockResolvedValueOnce({userId:null,getToken:vi.fn()});
  const unauth=await updateOperationsSettings(new Request('https://trading-app-theta-two.vercel.app/api/operations/settings',{
   method:'POST',
   headers:{'Content-Type':'application/json',Origin:'https://trading-app-theta-two.vercel.app'},
   body:JSON.stringify({action:'set_job_enabled',jobKey:'sec_filings_collect',enabled:true}),
  }));
  expect(unauth.status).toBe(401);
  expect(await unauth.json()).toMatchObject({error:{code:'sign_in_required'}});

  vi.stubEnv('VERCEL_ENV','preview');
  const previewStaging=await getResearchStagingCursor(new Request('https://preview.vercel.app/api/research/staging',{
   method:'GET',
   headers:{Authorization:`Bearer ${STAGING_TOKEN}`},
  }));
  expect(previewStaging.status).toBe(503);
  expect(vaultConfigured({VERCEL_ENV:'preview',BROKER_VAULT_KEY_VERSION:'v1'})).toBe(false);
 });
});
