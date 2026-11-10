import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {convexTest,type TestConvex} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import {NextRequest} from 'next/server';
import schema from '../convex/schema';
import * as nonceModule from '../convex/acceptanceNonces';
import * as chatModule from '../convex/evidenceChat';
import {consumeAcceptanceNonce,resolveGatewayBaseUrl,gatewayConfigured} from '../lib/graph/evidence-chat-gateway';
import {POST as chatRoutePost} from '../app/api/graph/chat/route';

/**
 * MVP hardening — work package 2: acceptance nonce and chat audit security.
 *
 * These tests run the real Convex function code (mutations, the internal mint action and the HTTP gateway
 * actions) against convex-test. convex-test executes each mutation as an isolated transaction but schedules
 * them one at a time, so the "simultaneous" cases here prove the state machine admits exactly one winner under
 * any interleaving of whole transactions; they do not exercise the production optimistic-concurrency engine.
 * See docs/mvp-hardening-fable-52/03-acceptance-nonce-security-design.md for the real-backend procedure.
 */
const modules={
 './_generated/server.ts':async()=>({}),
 './acceptanceNonces.ts':()=>import('../convex/acceptanceNonces'),
 './evidenceChat.ts':()=>import('../convex/evidenceChat'),
 './operations.ts':()=>import('../convex/operations'),
 './remoteOpsCloud.ts':()=>import('../convex/remoteOpsCloud'),
 './http.ts':()=>import('../convex/http'),
};
const ISSUER='https://issuer.test';
const A=`${ISSUER}|user_a`,B=`${ISSUER}|user_b`;
const GATEWAY='g'.repeat(48),SCHEDULER='s'.repeat(48),STAGING='t'.repeat(48);
const QUESTION='Which hyperscalers fund the Irish data-centre build-out?';
const NOW=Date.parse('2026-11-10T12:00:00Z');
const mintRef=makeFunctionReference<'action'>('acceptanceNonces:mintAcceptanceNonce');
const listRef=makeFunctionReference<'query'>('acceptanceNonces:listNoncesInternal');
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
type T=TestConvex<typeof schema>;

afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.unstubAllGlobals();});

function setup(){
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(NOW);
 vi.stubEnv('EVIDENCE_CHAT_GATEWAY_SECRET',GATEWAY);
 vi.stubEnv('EVIDENCE_CHAT_GATEWAY_SECRET_PREVIOUS','');
 vi.stubEnv('OPERATIONS_SCHEDULER_SECRET',SCHEDULER);
 vi.stubEnv('RESEARCH_STAGING_TOKEN',STAGING);
 vi.stubEnv('RESEARCH_OWNER_ID',B);
 vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN',ISSUER);
 return convexTest(schema,modules);
}
async function mint(t:T,overrides:Record<string,unknown>={}){
 return await t.action(mintRef,{owner:A,question:QUESTION,operator:'test-operator',...overrides}) as {token:string;nonceId:string;owner:string;expiresAtMs:number};
}
function gateway(t:T,path:string,body:unknown,headers:Record<string,string>={'x-aci-gateway-authorization':`Bearer ${GATEWAY}`}){
 return t.fetch(path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
}
const consume=(t:T,token:string,question=QUESTION,headers?:Record<string,string>)=>gateway(t,'/api/evidence-chat/acceptance/consume',{token,question},headers);
const record=(t:T,token:string,reservation:string,turn:Record<string,unknown>)=>gateway(t,'/api/evidence-chat/acceptance/record',{token,reservation,turn});
function turn(overrides:Record<string,unknown>={}){
 return {turnId:'chat-abc-1',bundleId:'bundle-1',bundleSha256:'a'.repeat(64),question:QUESTION,queryType:'ownership_chain',intentCategory:'graph',historicalCutoffMs:NOW,temporalBasis:'receipt',graphDatabaseName:'aci_macro_intelligence_prod',graphSchemaVersion:'v1',lastProjectedSequence:3,supportStatus:'fully_supported',validationValid:true,validationAction:'accepted',modelId:'gemini-2.5-flash',generationMode:'gemini_live',providerStatus:'succeeded',inputTokens:3000,outputTokens:500,cachedTokens:0,estimatedCostGbp:0.002,actualCostGbp:null,latencyMs:2400,bundleJson:'{"k":1}',answerJson:'{"k":1}',validationJson:'{"k":1}',createdAtMs:NOW,...overrides};
}
const chatRows=(t:T)=>t.run(ctx=>ctx.db.query('evidenceChatAudit').collect());
const nonceRows=(t:T)=>t.run(ctx=>ctx.db.query('acceptanceNonces').collect());
async function reason(res:Response){return ((await res.json()) as {error:{code:string;reason?:string}}).error;}

describe('WP2 — the insecure public acceptance pathway no longer exists',()=>{
 it('removes the public mutations and exposes no public function from the nonce module',()=>{
  const chat=chatModule as Record<string,unknown>;
  for(const gone of ['consumeAcceptanceNonceAndGetContext','recordAcceptanceChatTurn','mintServerAcceptanceTokenInternal'])expect(chat[gone]).toBeUndefined();
  const registered=Object.entries(nonceModule).filter(([,f])=>typeof f==='function'&&('isInternal' in f||'isPublic' in f));
  expect(registered.map(([n])=>n).sort()).toEqual(['consumeNonceInternal','failNonceInternal','listNoncesInternal','mintAcceptanceNonce','recordNonceTurnInternal','storeIssuedNonceInternal']);
  for(const [,f] of registered){expect((f as unknown as {isInternal?:boolean}).isInternal).toBe(true);expect((f as unknown as {isPublic?:boolean}).isPublic).toBeFalsy();}
  expect((chatModule.recordEvidenceChatTurnInternal as unknown as {isInternal?:boolean}).isInternal).toBe(true);
 });
 it('a public caller invoking the removed function names is refused',async()=>{
  const t=setup();
  await expect(t.mutation(makeFunctionReference<'mutation'>('evidenceChat:consumeAcceptanceNonceAndGetContext'),{nonce:'x'})).rejects.toThrow();
  await expect(t.mutation(makeFunctionReference<'mutation'>('evidenceChat:recordAcceptanceChatTurn'),{nonce:'x',...turn()})).rejects.toThrow();
 });
});

describe('WP2 — minting',()=>{
 it('issues a CSPRNG token and stores only SHA-256 digests, bound to owner, purpose and question',async()=>{
  const t=setup(),m=await mint(t);
  expect(m.token).toMatch(/^acn1\.[0-9a-f]{32}\.[0-9a-f]{64}$/);
  const secret=m.token.split('.')[2]!;
  const [row]=await nonceRows(t);
  expect(row).toMatchObject({nonceId:m.nonceId,owner:A,purpose:'evidence_chat_acceptance',status:'issued',secretSha256:sha(secret),questionSha256:sha(QUESTION),issuedAtMs:NOW,expiresAtMs:NOW+120_000,issuedBy:'deployment-admin:test-operator'});
  const everything=JSON.stringify(await t.run(async ctx=>({n:await ctx.db.query('acceptanceNonces').collect(),a:await ctx.db.query('audit').collect()})));
  expect(everything).not.toContain(secret);expect(everything).not.toContain(m.token);
  const other=await mint(t);expect(other.token).not.toBe(m.token);
 });
 it('refuses a default or label owner, an over-long lifetime and an empty question',async()=>{
  const t=setup();
  await expect(mint(t,{owner:'system_acceptance'})).rejects.toThrow('token identifier');
  await expect(mint(t,{ttlSeconds:86_400})).rejects.toThrow('ttlSeconds');
  await expect(mint(t,{question:'  '})).rejects.toThrow('question');
  await expect(t.action(mintRef,{question:QUESTION,operator:'x'} as never)).rejects.toThrow();
 });
});

describe('WP2 — gateway authentication',()=>{
 it('refuses missing, wrong, scheduler and staging credentials',async()=>{
  const t=setup(),m=await mint(t);
  expect((await consume(t,m.token,QUESTION,{})).status).toBe(401);
  expect((await consume(t,m.token,QUESTION,{'x-aci-gateway-authorization':`Bearer ${'x'.repeat(48)}`})).status).toBe(401);
  expect((await consume(t,m.token,QUESTION,{'x-aci-gateway-authorization':`Bearer ${SCHEDULER}`})).status).toBe(401);
  expect((await consume(t,m.token,QUESTION,{authorization:`Bearer ${GATEWAY}`})).status).toBe(401);
  expect((await nonceRows(t))[0]!.status).toBe('issued');
 });
 it('fails closed when unconfigured or when the gateway secret is reused from another machine credential',async()=>{
  const t=setup(),m=await mint(t);
  vi.stubEnv('EVIDENCE_CHAT_GATEWAY_SECRET','');
  expect((await consume(t,m.token)).status).toBe(503);
  vi.stubEnv('EVIDENCE_CHAT_GATEWAY_SECRET','short');
  expect((await consume(t,m.token)).status).toBe(503);
  vi.stubEnv('EVIDENCE_CHAT_GATEWAY_SECRET',SCHEDULER);
  expect((await consume(t,m.token,QUESTION,{'x-aci-gateway-authorization':`Bearer ${SCHEDULER}`})).status).toBe(503);
  expect((await nonceRows(t))[0]!.status).toBe('issued');
 });
 it('supports rotation: the previous secret is accepted only while configured',async()=>{
  const t=setup(),m=await mint(t),old='o'.repeat(48);
  expect((await consume(t,m.token,QUESTION,{'x-aci-gateway-authorization':`Bearer ${old}`})).status).toBe(401);
  vi.stubEnv('EVIDENCE_CHAT_GATEWAY_SECRET_PREVIOUS',old);
  expect((await consume(t,m.token,QUESTION,{'x-aci-gateway-authorization':`Bearer ${old}`})).status).toBe(200);
 });
 it('the gateway secret alone never establishes a user: /turn also needs a verified user JWT, and vice versa',async()=>{
  const t=setup(),asA=t.withIdentity({subject:'user_a',tokenIdentifier:A,issuer:ISSUER});
  expect((await gateway(t,'/api/evidence-chat/turn',{turn:turn()})).status).toBe(401);
  expect((await asA.fetch('/api/evidence-chat/turn',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({turn:turn()})})).status).toBe(401);
  expect(await chatRows(t)).toHaveLength(0);
  // Non-live turn: since the H2 correction a live turn additionally needs a budget reservation (tests/security-chat-budget-reservation.test.ts).
  const nonLive={generationMode:'abstention_only',providerStatus:'provider_error',supportStatus:'unsupported',inputTokens:0,outputTokens:0,estimatedCostGbp:0,actualCostGbp:null};
  const ok=await asA.fetch('/api/evidence-chat/turn',{method:'POST',headers:{'content-type':'application/json','x-aci-gateway-authorization':`Bearer ${GATEWAY}`},body:JSON.stringify({turn:turn(nonLive)})});
  expect(ok.status).toBe(200);
  expect(await chatRows(t)).toMatchObject([{owner:A,recordedVia:'server_gateway'}]);
  const model=t.withIdentity({subject:'user_a',tokenIdentifier:A,issuer:ISSUER,actorType:'model'});
  expect((await model.fetch('/api/evidence-chat/turn',{method:'POST',headers:{'content-type':'application/json','x-aci-gateway-authorization':`Bearer ${GATEWAY}`},body:JSON.stringify({turn:turn({turnId:'t2'})})})).status).toBe(403);
  const forged=await asA.fetch('/api/evidence-chat/turn',{method:'POST',headers:{'content-type':'application/json','x-aci-gateway-authorization':`Bearer ${GATEWAY}`},body:JSON.stringify({owner:B,turn:turn({turnId:'t3'})})});
  expect(forged.status).toBe(400);
  expect(await chatRows(t)).toHaveLength(1);
 });
});

describe('WP2 — consumption',()=>{
 it('returns the owner bound at mint time and ignores forged owner headers; a payload owner is refused',async()=>{
  const t=setup(),m=await mint(t);
  const forgedBody=await gateway(t,'/api/evidence-chat/acceptance/consume',{token:m.token,question:QUESTION,owner:B});
  expect(forgedBody.status).toBe(400);expect((await reason(forgedBody)).code).toBe('forbidden_field');
  const res=await consume(t,m.token,QUESTION,{'x-aci-gateway-authorization':`Bearer ${GATEWAY}`,'x-aci-acceptance-owner':B});
  expect(res.status).toBe(200);
  const body=await res.json() as {owner:string;reservation:string;context:{dailyCostCeilingGbp:number}};
  expect(body.owner).toBe(A);expect(body.reservation).toMatch(/^[0-9a-f]{64}$/);expect(body.context.dailyCostCeilingGbp).toBe(2);
  const [row]=await nonceRows(t);
  expect(row).toMatchObject({status:'consumed',consumedAtMs:NOW,reservationSha256:sha(body.reservation),recordDeadlineMs:NOW+180_000});
  expect(JSON.stringify(row)).not.toContain(body.reservation);
 });
 it('rejects the wrong question, a wrong secret and an unknown nonce without burning the nonce',async()=>{
  const t=setup(),m=await mint(t),[prefix,id,secret]=m.token.split('.') as [string,string,string];
  const wrongQ=await consume(t,m.token,'A different question entirely?');expect(wrongQ.status).toBe(409);expect((await reason(wrongQ)).reason).toBe('question_mismatch');
  const flipped=secret.slice(0,-1)+(secret.endsWith('0')?'1':'0');
  const wrongS=await consume(t,`${prefix}.${id}.${flipped}`);expect((await reason(wrongS)).reason).toBe('invalid_secret');
  const unknown=await consume(t,`${prefix}.${'0'.repeat(32)}.${secret}`);expect((await reason(unknown)).reason).toBe('unknown_nonce');
  expect((await consume(t,'not-a-token')).status).toBe(400);
  expect((await nonceRows(t))[0]!.status).toBe('issued');
  expect((await consume(t,m.token)).status).toBe(200);
 });
 it('rejects an expired nonce using the server-stored expiry',async()=>{
  const t=setup(),m=await mint(t);
  vi.setSystemTime(NOW+120_001);
  const res=await consume(t,m.token);expect(res.status).toBe(409);expect((await reason(res)).reason).toBe('expired');
  expect(await t.query(listRef,{owner:A})).toMatchObject([{storedStatus:'issued',effectiveStatus:'expired'}]);
 });
 it('prevents replay: a consumed nonce cannot be consumed again',async()=>{
  const t=setup(),m=await mint(t);
  expect((await consume(t,m.token)).status).toBe(200);
  const again=await consume(t,m.token);expect(again.status).toBe(409);expect((await reason(again)).reason).toBe('already_consumed');
 });
 for(const n of [2,10]){
  it(`${n} simultaneous consumption requests: exactly one succeeds`,async()=>{
   const t=setup(),m=await mint(t);
   const results=await Promise.all(Array.from({length:n},()=>consume(t,m.token)));
   expect(results.filter(r=>r.status===200)).toHaveLength(1);
   expect(results.filter(r=>r.status===409)).toHaveLength(n-1);
   const rows=await nonceRows(t);expect(rows).toHaveLength(1);expect(rows[0]!.status).toBe('consumed');
   const consumedAudits=await t.run(ctx=>ctx.db.query('audit').collect());
   expect(consumedAudits.filter(a=>a.action==='graph.evidence_chat.acceptance_nonce.consumed')).toHaveLength(1);
  });
 }
});

describe('WP2 — audit recording',()=>{
 async function consumed(t:T){const m=await mint(t);const body=await (await consume(t,m.token)).json() as {reservation:string};return {token:m.token,reservation:body.reservation};}

 it('records exactly one turn for the nonce owner; duplicate callbacks return the original audit id',async()=>{
  const t=setup(),s=await consumed(t);
  const first=await record(t,s.token,s.reservation,turn());expect(first.status).toBe(200);
  const a=await first.json() as {auditId:string;duplicate:boolean};expect(a.duplicate).toBe(false);
  const retry=await record(t,s.token,s.reservation,turn());expect(retry.status).toBe(200);
  expect(await retry.json()).toMatchObject({auditId:a.auditId,duplicate:true});
  const rows=await chatRows(t);expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({owner:A,recordedVia:'server_gateway_acceptance',executionAuthority:'none'});
  expect((await nonceRows(t))[0]).toMatchObject({status:'recorded',recordedTurnId:'chat-abc-1'});
  const different=await record(t,s.token,s.reservation,turn({turnId:'chat-other'}));
  expect(different.status).toBe(409);expect((await reason(different)).reason).toBe('already_recorded');
  expect(await chatRows(t)).toHaveLength(1);
 });
 it('cannot be used to write to another owner: the owner comes only from the nonce row',async()=>{
  const t=setup(),s=await consumed(t);
  const res=await gateway(t,'/api/evidence-chat/acceptance/record',{token:s.token,reservation:s.reservation,turn:{...turn(),owner:B}});
  expect(res.status).toBe(400);
  const res2=await gateway(t,'/api/evidence-chat/acceptance/record',{token:s.token,reservation:s.reservation,owner:B,turn:turn()});
  expect(res2.status).toBe(400);
  expect(await chatRows(t)).toHaveLength(0);
  expect((await record(t,s.token,s.reservation,turn())).status).toBe(200);
  expect((await chatRows(t)).map(r=>r.owner)).toEqual([A]);
 });
 it('rejects a record without consumption, with a wrong reservation, for a different question, or after the window',async()=>{
  const t=setup(),m=await mint(t);
  const early=await record(t,m.token,'f'.repeat(64),turn());expect((await reason(early)).reason).toBe('not_consumed');
  const body=await (await consume(t,m.token)).json() as {reservation:string};
  const wrong=await record(t,m.token,'f'.repeat(64),turn());expect((await reason(wrong)).reason).toBe('invalid_reservation');
  const otherQ=await record(t,m.token,body.reservation,turn({question:'Another question?'}));expect((await reason(otherQ)).reason).toBe('question_mismatch');
  vi.setSystemTime(NOW+185_000);
  const late=await record(t,m.token,body.reservation,turn({createdAtMs:NOW+185_000}));expect((await reason(late)).reason).toBe('record_window_elapsed');
  expect(await chatRows(t)).toHaveLength(0);
  expect(await t.query(listRef,{owner:A})).toMatchObject([{storedStatus:'consumed',effectiveStatus:'abandoned'}]);
  expect((await reason(await consume(t,m.token))).reason).toBe('already_consumed');
 });
 it('rejects forged or implausible telemetry and writes nothing (cost-allowance exhaustion is not possible)',async()=>{
  const t=setup(),s=await consumed(t);
  const cases:Array<[Record<string,unknown>,string]>=[
   [{estimatedCostGbp:1_000_000},'estimatedCostGbp out of range'],
   [{estimatedCostGbp:-1},'estimatedCostGbp out of range'],
   [{inputTokens:1.5},'inputTokens out of range'],
   [{outputTokens:Number.MAX_SAFE_INTEGER},'outputTokens out of range'],
   [{cachedTokens:5000},'cachedTokens cannot exceed inputTokens'],
   [{latencyMs:-5},'latencyMs out of range'],
   [{createdAtMs:NOW-86_400_000},'createdAtMs is not within 15 minutes of the server clock'],
   [{bundleSha256:'placeholder-hash'},'bundleSha256 must be a lowercase SHA-256 hex digest'],
   [{generationMode:'gemini_live',providerStatus:'provider_error'},'generationMode gemini_live requires providerStatus succeeded'],
   [{generationMode:'deterministic_evidence_synthesis',providerStatus:'succeeded',estimatedCostGbp:0},'providerStatus succeeded requires generationMode gemini_live'],
   [{generationMode:'abstention_only',providerStatus:'budget_exceeded',estimatedCostGbp:0.5},'a turn without live provider inference cannot carry provider cost'],
   [{generationMode:'made_up_mode'},'generationMode is not a recognised mode'],
   [{answerJson:'not json'},'answerJson must be a JSON object within the size limit'],
  ];
  for(const [override,expected] of cases){
   const res=await record(t,s.token,s.reservation,turn(override));
   expect(res.status,expected).toBe(400);
   const err=await res.json() as {error:{reason:string;violations:string[]}};
   expect(err.error.reason).toBe('invalid_audit_record');expect(err.error.violations).toContain(expected);
  }
  expect((await record(t,s.token,s.reservation,{...turn(),unexpectedField:1})).status).toBe(400);
  expect(await chatRows(t)).toHaveLength(0);
  // A failed audit write leaves the nonce consumed (not reopened), so the corrected record still succeeds once.
  expect((await nonceRows(t))[0]!.status).toBe('consumed');
  expect((await record(t,s.token,s.reservation,turn())).status).toBe(200);
 });
 it('records a provider failure after consumption as a failure, never as live inference',async()=>{
  const t=setup(),s=await consumed(t);
  const res=await record(t,s.token,s.reservation,turn({generationMode:'abstention_only',providerStatus:'provider_error',supportStatus:'unsupported',inputTokens:0,outputTokens:0,estimatedCostGbp:0,actualCostGbp:0,modelId:'gemini-2.5-flash'}));
  expect(res.status).toBe(200);
  expect(await chatRows(t)).toMatchObject([{generationMode:'abstention_only',providerStatus:'provider_error',estimatedCostGbp:0,supportStatus:'unsupported'}]);
 });
 it('marks a nonce failed when no turn could be produced; it can never be recorded or reused afterwards',async()=>{
  const t=setup(),s=await consumed(t);
  expect((await gateway(t,'/api/evidence-chat/acceptance/fail',{token:s.token,reservation:'f'.repeat(64),failureCode:'x'})).status).toBe(409);
  expect((await gateway(t,'/api/evidence-chat/acceptance/fail',{token:s.token,reservation:s.reservation,failureCode:'server_error_after_consumption'})).status).toBe(200);
  expect((await nonceRows(t))[0]).toMatchObject({status:'failed',failureCode:'server_error_after_consumption'});
  expect((await reason(await record(t,s.token,s.reservation,turn()))).reason).toBe('already_failed');
  expect((await reason(await consume(t,s.token))).reason).toBe('already_failed');
  expect(await chatRows(t)).toHaveLength(0);
 });
});

describe('WP2 — signed-in compatibility path',()=>{
 const recRef=makeFunctionReference<'mutation'>('evidenceChat:recordEvidenceChatTurn');
 it('denies anonymous writes, scopes writes to the verified caller and validates telemetry',async()=>{
  const t=setup(),asB=t.withIdentity({subject:'user_b',tokenIdentifier:B,issuer:ISSUER});
  await expect(t.mutation(recRef,turn())).rejects.toThrow('Sign in required');
  await expect(asB.mutation(recRef,{...turn(),owner:A} as never)).rejects.toThrow();
  // Since the H1 correction the caller's own credential cannot record live inference or provider cost at all.
  await expect(asB.mutation(recRef,turn({estimatedCostGbp:9999}))).rejects.toThrow('provider cost can only be recorded by the trusted server gateway');
  await expect(asB.mutation(recRef,turn())).rejects.toThrow('live provider inference can only be recorded by the trusted server gateway');
  const nonLive={generationMode:'deterministic_evidence_synthesis',providerStatus:'not_invoked',inputTokens:0,outputTokens:0,estimatedCostGbp:0,actualCostGbp:0};
  await expect(asB.mutation(recRef,turn({...nonLive,latencyMs:-1}))).rejects.toThrow('latencyMs out of range');
  await asB.mutation(recRef,turn(nonLive));
  expect(await chatRows(t)).toMatchObject([{owner:B,recordedVia:'client_jwt_legacy'}]);
 });
});

describe('WP2 — Next.js gateway client and chat route',()=>{
 const env={NEXT_PUBLIC_CONVEX_URL:'https://example-deployment-123.convex.cloud',EVIDENCE_CHAT_GATEWAY_SECRET:GATEWAY};
 it('derives the HTTP-actions origin and refuses to run unconfigured',async()=>{
  expect(resolveGatewayBaseUrl(env)).toBe('https://example-deployment-123.convex.site');
  expect(resolveGatewayBaseUrl({NEXT_PUBLIC_CONVEX_URL:'http://evil.test'})).toBeNull();
  expect(gatewayConfigured({...env,EVIDENCE_CHAT_GATEWAY_SECRET:'short'})).toBe(false);
  const res=await consumeAcceptanceNonce('t','q',{env:{},fetchImpl:async()=>{throw new Error('must not be called');}});
  expect(res).toMatchObject({ok:false,kind:'unavailable',reason:'gateway_not_configured'});
 });
 it('sends the credential only in the gateway header, never retries, and reports timeouts as unavailable',async()=>{
  const calls:Array<{url:string;init:RequestInit}>=[];
  const timeout=await consumeAcceptanceNonce('tok','q',{env,fetchImpl:async(url,init)=>{calls.push({url,init});const e=new Error('timed out');e.name='TimeoutError';throw e;}});
  expect(timeout).toMatchObject({ok:false,kind:'unavailable',reason:'gateway_timeout'});
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe('https://example-deployment-123.convex.site/api/evidence-chat/acceptance/consume');
  const headers=calls[0]!.init.headers as Record<string,string>;
  expect(headers['X-ACI-Gateway-Authorization']).toBe(`Bearer ${GATEWAY}`);expect(headers.Authorization).toBeUndefined();
  expect(String(calls[0]!.init.body)).not.toContain('owner');
  const rejected=await consumeAcceptanceNonce('tok','q',{env,fetchImpl:async()=>Response.json({error:{code:'nonce_rejected',reason:'expired'}},{status:409})});
  expect(rejected).toMatchObject({ok:false,kind:'rejected',status:409,reason:'expired'});
 });
 function chatRequest(headers:Record<string,string>,body:unknown={question:QUESTION,mode:'deterministic_evidence_synthesis'}){
  return new NextRequest('https://capital.aiguides.co.uk/api/graph/chat',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
 }
 it('route: a forged owner header or a rejected nonce yields 401 and no inference',async()=>{
  vi.stubEnv('NEXT_PUBLIC_CONVEX_URL',env.NEXT_PUBLIC_CONVEX_URL);vi.stubEnv('EVIDENCE_CHAT_GATEWAY_SECRET',GATEWAY);
  const fetchSpy=vi.fn(async()=>Response.json({error:{code:'nonce_rejected',reason:'already_consumed'}},{status:409}));
  vi.stubGlobal('fetch',fetchSpy);
  expect((await chatRoutePost(chatRequest({'x-aci-acceptance-owner':A}))).status).toBe(401);
  expect(fetchSpy).not.toHaveBeenCalled();
  expect((await chatRoutePost(chatRequest({'x-aci-acceptance-nonce':'acn1.replayed','x-aci-acceptance-owner':A}))).status).toBe(401);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
 });
 it('route: a gateway timeout yields 503 and is not retried; an unconfigured gateway yields 401',async()=>{
  vi.stubEnv('NEXT_PUBLIC_CONVEX_URL',env.NEXT_PUBLIC_CONVEX_URL);vi.stubEnv('EVIDENCE_CHAT_GATEWAY_SECRET',GATEWAY);
  const fetchSpy=vi.fn(async()=>{const e=new Error('timeout');e.name='TimeoutError';throw e;});
  vi.stubGlobal('fetch',fetchSpy);
  expect((await chatRoutePost(chatRequest({'x-aci-acceptance-nonce':'acn1.x'}))).status).toBe(503);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  vi.stubEnv('EVIDENCE_CHAT_GATEWAY_SECRET','');
  expect((await chatRoutePost(chatRequest({'x-aci-acceptance-nonce':'acn1.x'}))).status).toBe(401);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
 });
 it('route: a consumed nonce runs the bound question as the nonce owner and records through the gateway',async()=>{
  vi.stubEnv('NEXT_PUBLIC_CONVEX_URL',env.NEXT_PUBLIC_CONVEX_URL);vi.stubEnv('EVIDENCE_CHAT_GATEWAY_SECRET',GATEWAY);
  vi.stubEnv('TYPEDB_HTTP_ADDRESS','');
  const seen:Array<{path:string;body:Record<string,unknown>}>=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
   const path=new URL(url).pathname,body=JSON.parse(String(init.body)) as Record<string,unknown>;seen.push({path,body});
   if(path.endsWith('/consume'))return Response.json({owner:A,reservation:'r'.repeat(64),recordDeadlineMs:Date.now()+180_000,context:{checkpoint:null,publicProjectedRelationships:[],dailyCostCeilingGbp:2,dailyChatSpendGbp:0}});
   if(path.endsWith('/record'))return Response.json({auditId:'audit_1',duplicate:false});
   return Response.json({},{status:404});
  }));
  const res=await chatRoutePost(chatRequest({'x-aci-acceptance-nonce':'acn1.valid','x-aci-acceptance-owner':B}));
  expect(res.status).toBe(200);
  const json=await res.json() as {auditId:string;auditRecorded:string;telemetry:{generationMode:string;providerStatus:string;estimatedCostGbp:number}};
  expect(json).toMatchObject({auditId:'audit_1',auditRecorded:'server_gateway_acceptance'});
  expect(json.telemetry).toMatchObject({generationMode:'deterministic_evidence_synthesis',providerStatus:'not_invoked',estimatedCostGbp:0});
  expect(seen.map(s=>s.path)).toEqual(['/api/evidence-chat/acceptance/consume','/api/evidence-chat/acceptance/record']);
  expect(seen[0]!.body).toEqual({token:'acn1.valid',question:QUESTION});
  const recorded=seen[1]!.body as {reservation:string;turn:Record<string,unknown>};
  expect(recorded.reservation).toBe('r'.repeat(64));expect(recorded.turn.owner).toBeUndefined();
  expect(recorded.turn).toMatchObject({question:QUESTION,generationMode:'deterministic_evidence_synthesis',providerStatus:'not_invoked',inputTokens:0,estimatedCostGbp:0});
  expect(JSON.stringify(seen)).not.toContain(B);
 });
});
