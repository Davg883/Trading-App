import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({generate:vi.fn(),get:vi.fn(),session:null as null|{userId:string;token:string|null},legacy:[] as string[]}));
vi.mock('@google/genai',async orig=>({...(await orig<typeof import('@google/genai')>()),GoogleGenAI:class{models={generateContent:h.generate,get:h.get,list:vi.fn(async()=>({page:[]}))};}}));
vi.mock('@clerk/nextjs/server',()=>({auth:async()=>h.session?{userId:h.session.userId,getToken:async()=>h.session!.token}:{userId:null,getToken:async()=>null}}));
vi.mock('convex/browser',()=>({ConvexHttpClient:class{setAuth(){}async query(){throw new Error('Convex unavailable');}async action(){throw new Error('Convex unavailable');}async mutation(ref:unknown){h.legacy.push(String(ref));return {auditId:'legacy'};}}}));
import {NextRequest} from 'next/server';
import {POST} from '../app/api/graph/chat/route';

/**
 * Correction 1: an acceptance or paid turn whose audit record cannot be written is never presented as a
 * successful, audited answer. Provider and audit outcomes are reported separately; a retry never repeats the
 * provider call and reuses the same turn identifier (Convex deduplicates it). The provider SDK is mocked.
 */
const G='g'.repeat(48);
const Q='Which hyperscalers fund the Irish data-centre build-out?';
const OWNER='https://issuer.test|user_acc';
const liveReply={text:JSON.stringify({shortAnswer:'Not covered by approved evidence.',supportStatus:'unsupported',executiveTldr:[],supportingClaims:[],missingInformation:['x'],abstentionReason:'Insufficient approved evidence.',suggestedFollowUpQuestions:[]}),responseId:'resp-1',usageMetadata:{promptTokenCount:100,candidatesTokenCount:20}};
let calls:Array<{path:string;body:Record<string,unknown>}>=[];
let reply:(path:string,n:number)=>Response=()=>Response.json({},{status:404});
let n=0;
beforeEach(()=>{
 h.generate.mockReset();h.get.mockReset();h.get.mockResolvedValue({});h.session=null;h.legacy=[];calls=[];
 vi.stubEnv('GEMINI_API_KEY','test-key-not-real');vi.stubEnv('EVIDENCE_CHAT_GEMINI_ENABLED','true');
 vi.stubEnv('NEXT_PUBLIC_CONVEX_URL','https://example-deployment-123.convex.cloud');vi.stubEnv('EVIDENCE_CHAT_GATEWAY_SECRET',G);vi.stubEnv('TYPEDB_HTTP_ADDRESS','');
 vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{const path=new URL(url).pathname;calls.push({path,body:JSON.parse(String(init.body??'{}'))});return reply(path,calls.filter(c=>c.path===path).length);}));
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
const ask=(headers:Record<string,string>,mode?:string)=>POST(new NextRequest('https://capital.aiguides.co.uk/api/graph/chat',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({question:Q,...(mode?{mode}:{})})}));
const consumeOk=()=>Response.json({owner:OWNER,reservation:'r'.repeat(64),recordDeadlineMs:Date.now()+180_000,budget:{reserved:true},context:{checkpoint:null,publicProjectedRelationships:[],dailyCostCeilingGbp:2,dailyChatSpendGbp:0}});
const started=()=>Response.json({started:true,inFlightDeadlineMs:Date.now()+300_000});
const paths=()=>calls.map(c=>c.path.split('/').slice(-2).join('/'));
const NONCE={'x-aci-acceptance-nonce':'acn1.valid'};

describe('Correction 1 — acceptance audit recording fails closed',()=>{
 it('a definitive record rejection returns 502, withholds the answer, and fails the nonce',async()=>{
  h.generate.mockResolvedValue(liveReply);
  reply=p=>p.endsWith('/consume')?consumeOk():p.endsWith('acceptance/start')?started():p.endsWith('/record')?Response.json({error:{code:'nonce_rejected',reason:'invalid_audit_record'}},{status:400}):p.endsWith('/fail')?Response.json({failed:true}):Response.json({},{status:404});
  const res=await ask(NONCE);
  expect(res.status).toBe(502);
  const body=await res.json() as Record<string,unknown>;
  expect(body).toMatchObject({code:'audit_record_rejected',audit:{status:'rejected'},provider:{invoked:true,generationMode:'gemini_live',providerStatus:'succeeded'}});
  expect(body.answer).toBeUndefined();expect(body.auditRecorded).toBeUndefined();
  expect(paths()).toEqual(['acceptance/consume','acceptance/start','acceptance/record','acceptance/fail']);
  expect(calls.at(-1)!.body.failureCode).toBe('audit_record_rejected');
  expect(h.generate).toHaveBeenCalledTimes(1);
 });
 it('an unreachable audit backend returns 503 unconfirmed after exactly one retry, without failing the nonce or re-calling the provider',async()=>{
  h.generate.mockResolvedValue(liveReply);
  reply=p=>p.endsWith('/consume')?consumeOk():p.endsWith('acceptance/start')?started():p.endsWith('/record')?Response.json({},{status:503}):Response.json({},{status:404});
  const res=await ask(NONCE);
  expect(res.status).toBe(503);
  expect(await res.json()).toMatchObject({code:'audit_record_unconfirmed',audit:{status:'unconfirmed'}});
  const records=calls.filter(c=>c.path.endsWith('/record'));
  expect(records).toHaveLength(2);
  expect((records[0]!.body.turn as {turnId:string}).turnId).toBe((records[1]!.body.turn as {turnId:string}).turnId);
  expect(calls.some(c=>c.path.endsWith('/fail'))).toBe(false);
  expect(h.generate).toHaveBeenCalledTimes(1);
 });
 it('a transient failure followed by a successful idempotent retry returns 200 as audited',async()=>{
  h.generate.mockResolvedValue(liveReply);
  reply=(p,count)=>p.endsWith('/consume')?consumeOk():p.endsWith('acceptance/start')?started():p.endsWith('/record')?(count===1?Response.json({},{status:503}):Response.json({auditId:'audit-1',duplicate:true})):Response.json({},{status:404});
  const res=await ask(NONCE);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({auditId:'audit-1',auditRecorded:'server_gateway_acceptance'});
  expect(h.generate).toHaveBeenCalledTimes(1);
 });
 it('a deterministic acceptance turn (no paid call) whose record is rejected is also not returned as audited',async()=>{
  reply=p=>p.endsWith('/consume')?consumeOk():p.endsWith('/record')?Response.json({error:{code:'nonce_rejected',reason:'record_window_elapsed'}},{status:409}):p.endsWith('/fail')?Response.json({failed:true}):Response.json({},{status:404});
  const res=await ask(NONCE,'deterministic_evidence_synthesis');
  expect(res.status).toBe(502);
  expect(await res.json()).toMatchObject({provider:{invoked:false}});
  expect(paths()).toEqual(['acceptance/consume','acceptance/record','acceptance/fail']);
  expect(h.generate).not.toHaveBeenCalled();
 });
 it('if the acceptance budget cannot be started, the provider is not called and the nonce is failed',async()=>{
  reply=p=>p.endsWith('/consume')?consumeOk():p.endsWith('acceptance/start')?Response.json({},{status:503}):p.endsWith('/fail')?Response.json({failed:true}):Response.json({},{status:404});
  const res=await ask(NONCE);
  expect(res.status).toBe(503);expect(await res.json()).toMatchObject({code:'budget_unavailable'});
  expect(h.generate).not.toHaveBeenCalled();
  expect(calls.at(-1)!.body.failureCode).toBe('budget_start_failed');
 });
});

describe('Correction 1 / 2 — paid signed-in turns follow the same rule',()=>{
 beforeEach(()=>{h.session={userId:`user_paid_${++n}`,token:'jwt'};});
 const reserveOk=()=>Response.json({reservation:'c'.repeat(64),spentGbp:0,ceilingGbp:2,startExpiresAtMs:Date.now()+120_000});
 it('a rejected gateway record returns 502 and never falls back to the client-credential mutation',async()=>{
  h.generate.mockResolvedValue(liveReply);
  reply=p=>p.endsWith('/reserve')?reserveOk():p.endsWith('budget/start')?started():p.endsWith('/turn')?Response.json({error:{code:'invalid_request'}},{status:400}):Response.json({},{status:404});
  const res=await ask({});
  expect(res.status).toBe(502);
  expect(h.legacy).toEqual([]);
  expect(h.generate).toHaveBeenCalledTimes(1);
 });
 it('if the reservation cannot be started, no provider call is made',async()=>{
  reply=p=>p.endsWith('/reserve')?reserveOk():p.endsWith('budget/start')?Response.json({error:{code:'budget_reservation_expired'}},{status:409}):Response.json({},{status:404});
  const res=await ask({});
  expect(res.status).toBe(503);expect(h.generate).not.toHaveBeenCalled();
  expect(paths()).toEqual(['budget/reserve','budget/start']);
 });
 it('a provider timeout is recorded as provider_error with failure kind timeout_or_transport, never as live',async()=>{
  const e=new Error('gemini_generate_timeout');h.generate.mockRejectedValue(e);
  reply=p=>p.endsWith('/reserve')?reserveOk():p.endsWith('budget/start')?started():p.endsWith('/turn')?Response.json({auditId:'a9',duplicate:false}):Response.json({},{status:404});
  const res=await ask({});
  expect(res.status).toBe(200);
  const turn=calls.find(c=>c.path.endsWith('/turn'))!.body.turn as Record<string,unknown>;
  expect(turn).toMatchObject({generationMode:'abstention_only',providerStatus:'provider_error',providerFailureKind:'timeout_or_transport',estimatedCostGbp:0});
 });
});
