import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({generate:vi.fn(),get:vi.fn(),userId:'user_x',token:'jwt-token' as string|null,convexMutations:[] as string[]}));
vi.mock('@google/genai',async orig=>({
 ...(await orig<typeof import('@google/genai')>()),
 GoogleGenAI:class{models={generateContent:h.generate,get:h.get,list:vi.fn(async()=>({page:[]}))};},
}));
vi.mock('@clerk/nextjs/server',()=>({auth:async()=>({userId:h.userId,getToken:async()=>h.token})}));
vi.mock('convex/browser',()=>({ConvexHttpClient:class{setAuth(){}async query(){throw new Error('Convex unavailable');}async action(){throw new Error('Convex unavailable');}async mutation(ref:unknown){h.convexMutations.push(String((ref as {_name?:string})?._name??ref));return {auditId:'legacy'};}}}));
import {NextRequest} from 'next/server';
import {POST} from '../app/api/graph/chat/route';

/**
 * Pre-merge risk H2 (Next.js side): paid Gemini inference fails closed when the authoritative budget cannot be
 * checked or reserved. The provider SDK is mocked: `h.generate` records any attempted provider call. Nothing is billed.
 */
const GATEWAY='g'.repeat(48);
const Q='Which hyperscalers fund the Irish data-centre build-out?';
let calls:Array<{path:string;body:Record<string,unknown>;headers:Record<string,string>}>=[];
let gatewayReply:(path:string)=>Response|Promise<Response>=()=>Response.json({},{status:404});
let n=0;

beforeEach(()=>{
 h.generate.mockReset();h.get.mockReset();h.get.mockResolvedValue({name:'models/x'});
 h.userId=`user_route_${++n}`;h.token='jwt-token';h.convexMutations=[];calls=[];
 vi.stubEnv('GEMINI_API_KEY','test-key-not-real');vi.stubEnv('EVIDENCE_CHAT_GEMINI_ENABLED','true');
 vi.stubEnv('NEXT_PUBLIC_CONVEX_URL','https://example-deployment-123.convex.cloud');
 vi.stubEnv('EVIDENCE_CHAT_GATEWAY_SECRET',GATEWAY);vi.stubEnv('TYPEDB_HTTP_ADDRESS','');
 vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
  const path=new URL(url).pathname;
  calls.push({path,body:JSON.parse(String(init.body??'{}')),headers:init.headers as Record<string,string>});
  return gatewayReply(path);
 }));
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});

const ask=(body:Record<string,unknown>={question:Q})=>POST(new NextRequest('https://capital.aiguides.co.uk/api/graph/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
const liveReply={text:JSON.stringify({shortAnswer:'The approved evidence does not answer this question.',supportStatus:'unsupported',executiveTldr:[],supportingClaims:[],missingInformation:['No approved source covers this.'],abstentionReason:'Insufficient approved evidence.',suggestedFollowUpQuestions:[]}),responseId:'resp-test-1',usageMetadata:{promptTokenCount:120,candidatesTokenCount:30,totalTokenCount:150}};
type Turn={telemetry:{generationMode:string;providerStatus:string;estimatedCostGbp:number};auditRecorded:string};

describe('H2 — paid inference fails closed',()=>{
 it('Convex unavailable (reserve request fails): 503 and no provider call',async()=>{
  gatewayReply=()=>{throw new TypeError('fetch failed');};
  const res=await ask();
  expect(res.status).toBe(503);expect(await res.json()).toMatchObject({code:'budget_unavailable'});
  expect(h.generate).not.toHaveBeenCalled();
 });
 it('Convex returns a server error: 503 and no provider call',async()=>{
  gatewayReply=()=>Response.json({},{status:502});
  expect((await ask()).status).toBe(503);expect(h.generate).not.toHaveBeenCalled();
 });
 it('gateway not configured: 503 and no provider call',async()=>{
  vi.stubEnv('EVIDENCE_CHAT_GATEWAY_SECRET','');
  expect((await ask()).status).toBe(503);expect(h.generate).not.toHaveBeenCalled();expect(calls).toHaveLength(0);
 });
 it('signed in without a Convex token: 503 and no provider call',async()=>{
  h.token=null;
  expect((await ask()).status).toBe(503);expect(h.generate).not.toHaveBeenCalled();
 });
 it('an old Convex deployment without the reserve route (404) fails closed rather than calling the provider',async()=>{
  gatewayReply=()=>Response.json({},{status:404});
  const res=await ask();
  expect(h.generate).not.toHaveBeenCalled();
  expect(res.status).toBe(503);
 });
 it('rate limited: 429 and no provider call',async()=>{
  gatewayReply=p=>p.endsWith('/reserve')?Response.json({error:{code:'rate_limited'}},{status:429}):Response.json({},{status:404});
  expect((await ask()).status).toBe(429);expect(h.generate).not.toHaveBeenCalled();
 });
 it('budget exhausted: explicit budget abstention, no provider call, recorded without a reservation and never as live',async()=>{
  gatewayReply=p=>p.endsWith('/reserve')?Response.json({error:{code:'budget_exceeded'}},{status:409}):p.endsWith('/turn')?Response.json({auditId:'a1'}):Response.json({},{status:404});
  const res=await ask();expect(res.status).toBe(200);
  const j=await res.json() as Turn;
  expect(j.telemetry).toMatchObject({generationMode:'abstention_only',providerStatus:'budget_exceeded',estimatedCostGbp:0});
  expect(h.generate).not.toHaveBeenCalled();
  const turnCall=calls.find(c=>c.path.endsWith('/turn'))!;
  expect(turnCall.body.budgetReservation).toBeUndefined();
  expect((turnCall.body.turn as {generationMode:string}).generationMode).not.toBe('gemini_live');
 });
 it('provider failure after a reservation is recorded as provider_error with the reservation, never as live inference',async()=>{
  const reservation='a'.repeat(64);
  gatewayReply=p=>p.endsWith('/reserve')?Response.json({reservation,spentGbp:0,ceilingGbp:2,expiresAtMs:Date.now()+300_000}):p.endsWith('/turn')?Response.json({auditId:'a2'}):Response.json({},{status:404});
  h.generate.mockRejectedValue(new Error('HTTP 400 INVALID_ARGUMENT'));
  const res=await ask();expect(res.status).toBe(200);
  const j=await res.json() as Turn;
  expect(h.generate).toHaveBeenCalled();
  expect(j.telemetry).toMatchObject({generationMode:'abstention_only',providerStatus:'provider_error',estimatedCostGbp:0});
  const turnCall=calls.find(c=>c.path.endsWith('/turn'))!;
  expect(turnCall.body.budgetReservation).toBe(reservation);
  expect(turnCall.body.turn).toMatchObject({generationMode:'abstention_only',providerStatus:'provider_error'});
  expect(j.auditRecorded).toBe('server_gateway');
 });
 it('a live turn whose gateway record fails is not written through the client-credential mutation',async()=>{
  gatewayReply=p=>p.endsWith('/reserve')?Response.json({reservation:'b'.repeat(64),spentGbp:0,ceilingGbp:2,expiresAtMs:Date.now()+300_000}):Response.json({},{status:503});
  h.generate.mockResolvedValue(liveReply);
  const res=await ask();expect(res.status).toBe(200);
  const j=await res.json() as Turn;
  expect(j.telemetry.generationMode).toBe('gemini_live');
  expect(j.auditRecorded).toBe('not_recorded');
  expect(h.convexMutations).toEqual([]);
 });
});

describe('H2 — legitimate paid chat with a reservation',()=>{
 it('reserves, calls the provider once, and records the live turn through the gateway with the reservation',async()=>{
  gatewayReply=p=>p.endsWith('/reserve')?Response.json({reservation:'c'.repeat(64),spentGbp:0.1,ceilingGbp:2,expiresAtMs:Date.now()+300_000}):p.endsWith('/turn')?Response.json({auditId:'a4'}):Response.json({},{status:404});
  h.generate.mockResolvedValue(liveReply);
  const res=await ask();expect(res.status).toBe(200);
  const j=await res.json() as Turn&{auditId:string};
  expect(h.generate).toHaveBeenCalledTimes(1);
  expect(j.telemetry).toMatchObject({generationMode:'gemini_live',providerStatus:'succeeded'});
  expect(j).toMatchObject({auditId:'a4',auditRecorded:'server_gateway'});
  const order=calls.map(c=>c.path.split('/').pop());
  expect(order).toEqual(['reserve','turn']);
  const turnCall=calls.find(c=>c.path.endsWith('/turn'))!;
  expect(turnCall.body.budgetReservation).toBe('c'.repeat(64));
  expect(turnCall.headers['Authorization']).toBe('Bearer jwt-token');
  expect(JSON.stringify(turnCall.body.turn)).not.toMatch(/"owner"|"recordedVia"/);
 });
});

describe('H2 — legitimate chat that makes no paid call still works',()=>{
 it('explicit deterministic mode needs no reservation and makes no provider call',async()=>{
  gatewayReply=p=>p.endsWith('/turn')?Response.json({auditId:'a3'}):Response.json({},{status:404});
  const res=await ask({question:Q,mode:'deterministic_evidence_synthesis'});
  expect(res.status).toBe(200);
  expect(calls.some(c=>c.path.endsWith('/reserve'))).toBe(false);
  expect(h.generate).not.toHaveBeenCalled();
  expect((await res.json() as Turn).telemetry).toMatchObject({generationMode:'deterministic_evidence_synthesis',providerStatus:'not_invoked'});
 });
});
