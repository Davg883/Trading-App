import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
vi.mock('server-only',()=>({}));
const h=vi.hoisted(()=>({authMock:vi.fn(),convexCalls:[] as string[]}));
vi.mock('@clerk/nextjs/server',()=>({auth:h.authMock}));
vi.mock('convex/browser',()=>({ConvexHttpClient:class{setAuth(){}setAdminAuth(){}async query(ref:unknown){h.convexCalls.push(`query:${String(ref)}`);return {owner:'https://issuer.test|user_owner'};}async mutation(ref:unknown){h.convexCalls.push(`mutation:${String(ref)}`);return {};}}}));
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';
import {grantReviewers} from './helpers/roles';
import {handleTrading,executionFlag} from '../lib/trading/server';
import {Trading212OrderClient} from '../lib/brokers/trading212-orders';
import {DEPLOYMENT_EXECUTION_AUTHORITY,ResearchOnlyDeploymentError,assertExecutionPermitted,executionPermitted} from '../lib/trading/execution-boundary';
import {DEFAULT_RISK_LIMITS,TRADING_VERSION} from '../lib/trading/order-model';
import {OPT_IN_STATEMENT} from '../convex/trading';

/**
 * MVP hardening — work package 3: research-only execution boundary.
 * This file deliberately does NOT mock `execution-boundary`; it exercises the real build constant with
 * LIVE_TRADING_ENABLED=true and DEMO_TRADING_ENABLED=true. No test here can reach Trading 212: the global
 * fetch and the order client's transport are spies that fail the test if they are ever called.
 */
const ENV={LIVE_TRADING_ENABLED:'true',DEMO_TRADING_ENABLED:'true',NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:'pk_test_x',CLERK_SECRET_KEY:'sk_test_x',NEXT_PUBLIC_CONVEX_URL:'https://example.convex.cloud',CONVEX_BROKER_ADMIN_KEY:'admin-test',BROKER_VAULT_KEY_B64:Buffer.alloc(32,3).toString('base64'),BROKER_VAULT_KEY_VERSION:'v1',BROKER_APP_ORIGIN:'http://localhost:3000'};
const OWNER='https://issuer.test|user_owner';
const draft={environment:'live',ticker:'AAPL_US_EQ',side:'BUY',quantity:0.1,type:'MARKET',limitPrice:null,stopPrice:null,timeValidity:null,extendedHours:false,thesis:'Services margin expansion supports earnings growth.',counterevidence:'Hardware demand is cyclical and may weaken.',invalidation:'Two consecutive quarters of services decline.',horizon:'6–12 months',reason:'Research position sizing test.'};
const req=(body:unknown)=>new Request('http://localhost:3000/api/trading',{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json'},body:JSON.stringify(body)});
let fetchSpy:ReturnType<typeof vi.fn>;
beforeEach(()=>{h.convexCalls.length=0;h.authMock.mockReset();h.authMock.mockResolvedValue({userId:'user_owner',getToken:async()=>'jwt'});for(const [k,v] of Object.entries(ENV))vi.stubEnv(k,v);fetchSpy=vi.fn(async()=>{throw new Error('network access attempted in a research-only test');});vi.stubGlobal('fetch',fetchSpy);});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});

describe('WP3 — the build constant, not the environment, decides execution authority',()=>{
 it('is none in this build and takes no runtime input',()=>{
  expect(DEPLOYMENT_EXECUTION_AUTHORITY).toBe('none');
  expect(executionPermitted()).toBe(false);
  expect(()=>assertExecutionPermitted('x')).toThrow(ResearchOnlyDeploymentError);
  const src=readFileSync('lib/trading/execution-boundary.ts','utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'');
  expect(src).not.toMatch(/process\.env|globalThis|fetch\(|require\(|import\s/);
  expect(src).toMatch(/DEPLOYMENT_EXECUTION_AUTHORITY: 'none' \| 'human_authorised_orders' = 'none';/);
 });
 it('execution flags set to "true" enable nothing',()=>{
  expect(process.env.LIVE_TRADING_ENABLED).toBe('true');expect(process.env.DEMO_TRADING_ENABLED).toBe('true');
  expect(executionFlag('live')).toBe(false);expect(executionFlag('demo')).toBe(false);
  expect(executionFlag('live',{LIVE_TRADING_ENABLED:'true'})).toBe(false);
 });
});

describe('WP3 — /api/trading refuses every action with both execution flags enabled',()=>{
 const actions:Record<string,unknown>[]=[
  {action:'save_trading_key',environment:'live',apiKey:'k'.repeat(20),apiSecret:'s'.repeat(20)},
  {action:'save_trading_key',environment:'demo',apiKey:'k'.repeat(20),apiSecret:'s'.repeat(20)},
  {action:'issue_confirmation',orderId:'o1'},
  {action:'confirm',orderId:'o1',token:'a'.repeat(64)},
  {action:'submit',orderId:'o1'},
  {action:'cancel',orderId:'o1'},
  {action:'reconcile',orderId:'o1'},
  {action:'evaluate',orderId:'o1'},
  {action:'instruments',environment:'live',query:'aapl'},
  {action:'monitor',environment:'live'},
 ];
 for(const body of actions){
  it(`${String(body.action)} (${String(body.environment??body.orderId)}) → 403 before authentication, storage or broker access`,async()=>{
   const res=await handleTrading(req(body));
   expect(res.status).toBe(403);
   expect(await res.json()).toMatchObject({error:'research_only_deployment',executionAuthority:'none'});
   expect(h.authMock).not.toHaveBeenCalled();expect(h.convexCalls).toEqual([]);expect(fetchSpy).not.toHaveBeenCalled();
  });
 }
 it('the refusal never echoes submitted credentials',async()=>{
  const text=await (await handleTrading(req({action:'save_trading_key',environment:'live',apiKey:'SECRET-KEY-VALUE-123456',apiSecret:'SECRET-SECRET-VALUE-123456'}))).text();
  expect(text).not.toContain('SECRET-KEY-VALUE');expect(text).not.toContain('SECRET-SECRET-VALUE');
 });
});

describe('WP3 — the broker order client cannot submit or cancel',()=>{
 it('refuses before any transport call even when constructed with executionEnabled: true',async()=>{
  const transport=vi.fn(async()=>new Response('{}'));
  const client=new Trading212OrderClient('live',{apiKey:'k'.repeat(20),apiSecret:'s'.repeat(20)},{fetch:transport,executionEnabled:true});
  await expect(client.submit(draft as never)).rejects.toBeInstanceOf(ResearchOnlyDeploymentError);
  await expect(client.cancel(12345)).rejects.toBeInstanceOf(ResearchOnlyDeploymentError);
  const demo=new Trading212OrderClient('demo',{apiKey:'k'.repeat(20),apiSecret:'s'.repeat(20)},{fetch:transport,executionEnabled:true});
  await expect(demo.submit({...draft,environment:'demo'} as never)).rejects.toBeInstanceOf(ResearchOnlyDeploymentError);
  expect(transport).not.toHaveBeenCalled();expect(fetchSpy).not.toHaveBeenCalled();
 });
});

describe('WP3 — Convex refuses execution-enabling state changes',()=>{
 const modules={'./_generated/server.ts':async()=>({}),'./trading.ts':()=>import('../convex/trading'),'./roles.ts':()=>import('../convex/roles'),'./brokers.ts':()=>import('../convex/brokers')};
 const m=(n:string)=>makeFunctionReference<'mutation'>(`trading:${n}`);
 const HASH='a'.repeat(64);
 async function setup(){
  const t=convexTest(schema,modules);await grantReviewers(t,[OWNER]);
  const now=Date.now();
  // Seed the most permissive state reachable: opted in, kill switch released, key present, order confirmed.
  const orderId=await t.run(async ctx=>{
   await ctx.db.insert('tradingSettings',{owner:OWNER,limitsJson:JSON.stringify(DEFAULT_RISK_LIMITS),liveKillSwitchEngaged:false,optedInAt:now,updatedAt:now});
   await ctx.db.insert('tradingCredentials',{owner:OWNER,environment:'live',maskedKey:'••••seed',encryptedPayload:'{}',createdAt:now});
   return await ctx.db.insert('tradeOrders',{owner:OWNER,state:'confirmed',environment:'live',ticker:'AAPL_US_EQ',draftJson:JSON.stringify(draft),createdAt:now,updatedAt:now,version:TRADING_VERSION,riskPassed:true,riskEvaluatedAt:now,confirmationTokenHash:HASH,confirmationPayloadHash:HASH,confirmationExpiresAt:now+60_000,confirmationUsedAt:now,confirmedAt:now});
  });
  const approvedId=await t.run(ctx=>ctx.db.insert('tradeOrders',{owner:OWNER,state:'approved',environment:'demo',ticker:'AAPL_US_EQ',draftJson:JSON.stringify({...draft,environment:'demo'}),createdAt:now,updatedAt:now,version:TRADING_VERSION,riskPassed:true,riskEvaluatedAt:now}));
  return {t,owner:t.withIdentity({subject:'user_owner',tokenIdentifier:OWNER}),orderId,approvedId};
 }
 it('refuses a submission claim for a fully confirmed order with executionFlagEnabled: true',async()=>{
  const {t,orderId}=await setup();
  await expect(t.mutation(m('claimSubmissionInternal'),{owner:OWNER,orderId,submissionId:'0f8fad5b-d9cb-469f-a165-70867728950e',payloadHash:HASH,executionFlagEnabled:true,knownBrokerIdsBefore:[]})).rejects.toThrow('research-only');
  expect((await t.run(ctx=>ctx.db.get(orderId)))!.state).toBe('confirmed');
 });
 it('refuses issuing and accepting an order confirmation',async()=>{
  const {t,approvedId}=await setup();
  await expect(t.mutation(m('issueConfirmationInternal'),{owner:OWNER,orderId:approvedId,tokenHash:HASH,payloadHash:HASH})).rejects.toThrow('research-only');
  await expect(t.mutation(m('confirmInternal'),{owner:OWNER,orderId:approvedId,tokenHash:HASH,payloadHash:HASH})).rejects.toThrow('research-only');
  expect((await t.run(ctx=>ctx.db.get(approvedId)))!.state).toBe('approved');
 });
 it('refuses saving live or demo trading credentials and recording the trading opt-in',async()=>{
  const {t,owner}=await setup();
  for(const environment of ['live','demo'] as const)await expect(t.mutation(m('saveTradingKeyInternal'),{owner:OWNER,environment,maskedKey:'••••new1',encryptedPayload:'{"x":1}'})).rejects.toThrow('research-only');
  await expect(owner.mutation(m('recordOptIn'),{statement:OPT_IN_STATEMENT})).rejects.toThrow('research-only');
  const creds=await t.run(ctx=>ctx.db.query('tradingCredentials').collect());
  expect(creds.map(c=>c.maskedKey)).toEqual(['••••seed']);
 });
 it('refuses releasing the Live emergency switch but still allows engaging it and deleting a stored key',async()=>{
  const {t,owner}=await setup();
  await owner.mutation(m('setLiveKillSwitch'),{engaged:true,reason:'Research-only deployment'});
  await expect(owner.mutation(m('setLiveKillSwitch'),{engaged:false,reason:'attempted release'})).rejects.toThrow('research-only');
  expect((await t.run(ctx=>ctx.db.query('tradingSettings').first()))!.liveKillSwitchEngaged).toBe(true);
  await owner.mutation(m('deleteTradingKey'),{environment:'live'});
  expect(await t.run(ctx=>ctx.db.query('tradingCredentials').collect())).toEqual([]);
 });
});

describe('WP3 — reachability of order execution code',()=>{
 function sources(dir:string,out:string[]=[]):string[]{for(const name of readdirSync(dir)){if(name==='node_modules'||name==='_generated'||name.startsWith('.'))continue;const p=join(dir,name);if(statSync(p).isDirectory())sources(p,out);else if(/\.(ts|tsx|mjs|py)$/.test(name))out.push(p);}return out;}
 it('only the guarded trading server imports the order client; research agents and Convex cannot reach it',()=>{
  const importers=['app','components','integrations','lib','convex','worker','scripts'].flatMap(d=>sources(d)).filter(f=>/trading212-orders/.test(readFileSync(f,'utf8'))&&!f.endsWith('trading212-orders.ts'));
  expect(importers.sort()).toEqual(['lib/trading/server.ts']);
  const routeFiles=sources('app/api').filter(f=>/lib\/trading\/server/.test(readFileSync(f,'utf8')));
  expect(routeFiles).toEqual(['app/api/trading/route.ts']);
  for(const f of [...sources('convex'),...sources('worker'),...sources('lib/remote-ops')])expect(readFileSync(f,'utf8'),f).not.toMatch(/Trading212OrderClient|trading212\.com\/api|BROKER_BASE_URLS/);
 });
 it('the read-only broker adapter is a separate path with no order endpoints or mutating HTTP methods',()=>{
  const src=readFileSync('lib/brokers/trading212.ts','utf8');
  expect(src).not.toMatch(/equity\/orders|method:\s*['"](POST|PUT|PATCH|DELETE)['"]|execution-boundary/);
 });
});
