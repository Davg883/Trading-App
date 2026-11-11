import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({generate:vi.fn(),get:vi.fn(),session:null as null|{userId:string;token:string|null}}));
vi.mock('@google/genai',async orig=>({...(await orig<typeof import('@google/genai')>()),GoogleGenAI:class{models={generateContent:h.generate,get:h.get,list:vi.fn(async()=>({page:[]}))};}}));
vi.mock('@clerk/nextjs/server',()=>({auth:async()=>h.session?{userId:h.session.userId,getToken:async()=>h.session!.token}:{userId:null,getToken:async()=>null}}));
vi.mock('convex/browser',()=>({ConvexHttpClient:class{setAuth(){}async query(){throw new Error('Convex unavailable');}async action(){throw new Error('Convex unavailable');}async mutation(){return {auditId:'legacy'};}}}));
import {NextRequest} from 'next/server';
import {POST} from '../app/api/graph/chat/route';

/**
 * Correction 3: authentication-mode selection on /api/graph/chat.
 * Rule: a request authenticates EITHER with a Clerk session OR with an acceptance nonce. A request carrying both
 * is ambiguous and is refused with 400 before either credential is used (the nonce is not consumed).
 */
const G='g'.repeat(48);
const Q='Which hyperscalers fund the Irish data-centre build-out?';
const OWNER_A='https://issuer.test|user_a';
let calls:Array<{path:string;body:Record<string,unknown>}>=[];
let reply:(path:string,body:Record<string,unknown>)=>Response=()=>Response.json({},{status:404});
let n=0;
beforeEach(()=>{
 h.generate.mockReset();h.get.mockReset();calls=[];h.session=null;
 vi.stubEnv('GEMINI_API_KEY','');vi.stubEnv('GOOGLE_API_KEY','');vi.stubEnv('GOOGLE_GEMINI_API_KEY','');vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY','');
 vi.stubEnv('NEXT_PUBLIC_CONVEX_URL','https://example-deployment-123.convex.cloud');vi.stubEnv('EVIDENCE_CHAT_GATEWAY_SECRET',G);vi.stubEnv('TYPEDB_HTTP_ADDRESS','');
 vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{const path=new URL(url).pathname,body=JSON.parse(String(init.body??'{}'));calls.push({path,body});return reply(path,body);}));
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
const ask=(headers:Record<string,string>={},question=Q)=>POST(new NextRequest('https://capital.aiguides.co.uk/api/graph/chat',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({question,mode:'deterministic_evidence_synthesis'})}));
const acceptanceOk=(owner=OWNER_A)=>(path:string)=>path.endsWith('/consume')?Response.json({owner,reservation:'r'.repeat(64),recordDeadlineMs:Date.now()+180_000,budget:{reserved:true},context:{checkpoint:null,publicProjectedRelationships:[],dailyCostCeilingGbp:2,dailyChatSpendGbp:0}}):path.endsWith('/record')?Response.json({auditId:'audit_acc',duplicate:false}):path.endsWith('/turn')?Response.json({auditId:'audit_turn'}):Response.json({},{status:404});

describe('Correction 3 — exactly one credential per request',()=>{
 it('Clerk-only request is served as the Clerk user and never touches the nonce gateway',async()=>{
  h.session={userId:`user_c${++n}`,token:'jwt'};reply=acceptanceOk();
  const res=await ask();expect(res.status).toBe(200);
  expect(calls.some(c=>c.path.includes('/acceptance/'))).toBe(false);
 });
 it('nonce-only request is served as the nonce owner',async()=>{
  reply=acceptanceOk();
  const res=await ask({'x-aci-acceptance-nonce':'acn1.valid'});expect(res.status).toBe(200);
  expect(calls.map(c=>c.path.split('/').pop())).toEqual(['consume','record']);
  expect(((await res.json()) as {auditRecorded:string}).auditRecorded).toBe('server_gateway_acceptance');
 });
 it('both credentials present: 400 ambiguous_credentials, nonce not consumed, no inference',async()=>{
  h.session={userId:`user_c${++n}`,token:'jwt'};reply=acceptanceOk();
  const res=await ask({'x-aci-acceptance-nonce':'acn1.valid'});
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({code:'ambiguous_credentials'});
  expect(calls).toEqual([]);expect(h.generate).not.toHaveBeenCalled();
 });
 it('both credentials where the Clerk user differs from the nonce owner are also refused, not merged',async()=>{
  h.session={userId:'user_b',token:'jwt-b'};reply=acceptanceOk(OWNER_A);
  const res=await ask({'x-aci-acceptance-nonce':'acn1.valid'});
  expect(res.status).toBe(400);expect(calls).toEqual([]);
 });
 it('replayed or question-mismatched nonce (rejected by the gateway) is refused with 401',async()=>{
  for(const reason of ['already_consumed','question_mismatch','expired']){
   reply=p=>p.endsWith('/consume')?Response.json({error:{code:'nonce_rejected',reason}},{status:409}):Response.json({},{status:404});
   calls=[];
   const res=await ask({'x-aci-acceptance-nonce':'acn1.x'});
   expect(res.status,reason).toBe(401);
   expect(calls.map(c=>c.path.split('/').pop())).toEqual(['consume']);
  }
 });
 it('neither credential: 401',async()=>{expect((await ask()).status).toBe(401);expect(calls).toEqual([]);});
});
