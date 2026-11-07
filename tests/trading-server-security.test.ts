import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const h=vi.hoisted(()=>({authMock:vi.fn(),calls:[] as {kind:string;name:string;args:unknown}[],state:{orderRow:{} as Record<string,unknown>}}));
const authMock=h.authMock,calls=h.calls;
vi.mock('@clerk/nextjs/server',()=>({auth:h.authMock}));
vi.mock('convex/browser',()=>({ConvexHttpClient:class{setAuth(){}setAdminAuth(){}async query(ref:unknown,args:unknown){const name=String((ref as {_name?:string})?._name??ref);h.calls.push({kind:'query',name,args});if(name.includes('viewer'))return {owner:'https://issuer.test|user_owner'};if(name.includes('orderInternal'))return h.state.orderRow;if(name.includes('tradingVaultInternal'))throw new Error('Uncaught Error: No trading key saved for this environment');return null;}async mutation(ref:unknown,args:unknown){h.calls.push({kind:'mutation',name:String((ref as {_name?:string})?._name??ref),args});return {ok:true};}}}));
vi.mock('convex/server',async orig=>{const real=await orig<typeof import('convex/server')>();return {...real,makeFunctionReference:(name:string)=>({_name:name})};});
import {handleTrading,executionFlag} from '../lib/trading/server';

const ENV={NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:'pk_test_x',CLERK_SECRET_KEY:'sk_test_x',NEXT_PUBLIC_CONVEX_URL:'https://example.convex.cloud',CONVEX_BROKER_ADMIN_KEY:'admin-test',BROKER_VAULT_KEY_B64:Buffer.alloc(32,3).toString('base64'),BROKER_VAULT_KEY_VERSION:'v1',BROKER_APP_ORIGIN:'http://localhost:3000'};
const req=(body:unknown,origin='http://localhost:3000')=>new Request('http://localhost:3000/api/trading',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
const draft={environment:'live',ticker:'AAPL_US_EQ',side:'BUY',quantity:0.1,type:'MARKET',limitPrice:null,stopPrice:null,timeValidity:null,extendedHours:false,thesis:'Services margin expansion supports earnings growth.',counterevidence:'Hardware demand is cyclical and valuation is elevated.'};
let fetchSpy:ReturnType<typeof vi.fn>;
beforeEach(()=>{calls.length=0;for(const [k,v] of Object.entries(ENV))vi.stubEnv(k,v);authMock.mockResolvedValue({userId:'user_owner',getToken:async()=>'jwt'});fetchSpy=vi.fn(async()=>new Response('{}'));vi.stubGlobal('fetch',fetchSpy);
 h.state.orderRow={orderId:'o1',state:'confirmed',environment:'live',ticker:'AAPL_US_EQ',draft,priceReference:{ticker:'AAPL_US_EQ',price:200,priceCurrency:'USD',fxRateToAccount:0.75,source:'broker_position',observedAt:Date.now(),sourceDetail:'t'},riskPassed:true,riskEvaluatedAt:Date.now(),brokerOrderId:null,knownBrokerIdsBefore:[],submittingAt:null,limits:{},liveKillSwitchEngaged:false,optedInAt:1};});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});

describe('Trading route server-side enforcement',()=>{
 it('keeps Live submission off unless LIVE_TRADING_ENABLED is exactly "true"',()=>{
  expect(executionFlag('live',{})).toBe(false);expect(executionFlag('live',{LIVE_TRADING_ENABLED:'1'})).toBe(false);expect(executionFlag('live',{LIVE_TRADING_ENABLED:'true'})).toBe(true);
  expect(executionFlag('demo',{LIVE_TRADING_ENABLED:'true'})).toBe(false);expect(executionFlag('demo',{DEMO_TRADING_ENABLED:'true'})).toBe(true);
 });
 it('refuses a Live submission before decrypting keys or contacting the broker when the flag is off',async()=>{
  const r=await handleTrading(req({action:'submit',orderId:'o1'}));expect(r.status).toBe(403);expect((await r.json()).error).toBe('execution_disabled');
  expect(fetchSpy).not.toHaveBeenCalled();expect(calls.some(c=>c.name.includes('tradingVaultInternal')||c.name.includes('claimSubmission'))).toBe(false);
 });
 it('refuses a Live submission while the emergency switch is engaged even if the flag is on',async()=>{
  vi.stubEnv('LIVE_TRADING_ENABLED','true');h.state.orderRow={...h.state.orderRow,liveKillSwitchEngaged:true};
  const r=await handleTrading(req({action:'submit',orderId:'o1'}));expect(r.status).toBe(403);expect(fetchSpy).not.toHaveBeenCalled();
 });
 it('requires sign-in, same origin, a known action and no extra fields',async()=>{
  authMock.mockResolvedValue({userId:null});expect((await handleTrading(req({action:'monitor',environment:'demo'}))).status).toBe(401);
  authMock.mockResolvedValue({userId:'user_owner',getToken:async()=>'jwt'});
  expect((await handleTrading(req({action:'monitor',environment:'demo'},'https://evil.example'))).status).toBe(403);
  expect((await handleTrading(req({action:'place_any_order',url:'https://live.trading212.com'}))).status).toBe(400);
  expect((await handleTrading(req({action:'submit',orderId:'o1',quantity:999}))).status).toBe(400);
  expect(fetchSpy).not.toHaveBeenCalled();
 });
 it('does not fall back to read-only credentials when no trading key exists',async()=>{
  vi.stubEnv('DEMO_TRADING_ENABLED','true');h.state.orderRow={...h.state.orderRow,environment:'demo',draft:{...draft,environment:'demo'}};
  const r=await handleTrading(req({action:'submit',orderId:'o1'})),b=await r.json();expect(b.message).toMatch(/No trading key/);
  expect(fetchSpy).not.toHaveBeenCalled();expect(calls.some(c=>c.name.startsWith('brokers:'))).toBe(false);
 });
 it('never echoes credentials in responses when saving a trading key fails',async()=>{
  const r=await handleTrading(req({action:'save_trading_key',environment:'demo',apiKey:'SECRET-KEY-1234',apiSecret:'SECRET-VALUE'}));const text=await r.text();
  expect(text).not.toContain('SECRET-KEY-1234');expect(text).not.toContain('SECRET-VALUE');
 });
});
