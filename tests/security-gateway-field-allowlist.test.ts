import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {convexTest,type TestConvex} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';

/**
 * Pre-merge blockers C1 and C2 (docs/mvp-hardening-fable-52/11-pre-merge-security-review.md).
 * The gateway HTTP actions must build mutation arguments from an explicit field allowlist: no field inside the
 * client-supplied `turn` object may override the authenticated owner, the provenance label, the nonce identity
 * or the server-derived question binding. Unknown fields are refused, not silently dropped.
 */
const modules={
 './_generated/server.ts':async()=>({}),
 './acceptanceNonces.ts':()=>import('../convex/acceptanceNonces'),
 './evidenceChat.ts':()=>import('../convex/evidenceChat'),
 './operations.ts':()=>import('../convex/operations'),
 './remoteOpsCloud.ts':()=>import('../convex/remoteOpsCloud'),
 './http.ts':()=>import('../convex/http'),
};
const ISS='https://issuer.test',A=`${ISS}|user_a`,B=`${ISS}|user_b`,G='g'.repeat(48);
const NOW=Date.parse('2026-11-10T12:00:00Z');
const Q='Which hyperscalers fund the Irish data-centre build-out?';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const H={'content-type':'application/json','x-aci-gateway-authorization':`Bearer ${G}`};
type T=TestConvex<typeof schema>;
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});

function setup(){
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(NOW);
 vi.stubEnv('EVIDENCE_CHAT_GATEWAY_SECRET',G);vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN',ISS);
 const t=convexTest(schema,modules);
 return {t,asA:t.withIdentity({subject:'user_a',tokenIdentifier:A,issuer:ISS})};
}
function turn(o:Record<string,unknown>={}){
 return {turnId:'chat-1',bundleId:'bundle-1',bundleSha256:'a'.repeat(64),question:Q,queryType:'ownership_chain',intentCategory:'graph',historicalCutoffMs:NOW,temporalBasis:'receipt',graphDatabaseName:'db',graphSchemaVersion:'v1',lastProjectedSequence:0,supportStatus:'unsupported',validationValid:true,validationAction:'accepted',modelId:'gemini-2.5-flash',generationMode:'abstention_only',providerStatus:'provider_error',inputTokens:0,outputTokens:0,cachedTokens:0,estimatedCostGbp:0,actualCostGbp:0,latencyMs:5,bundleJson:'{}',answerJson:'{}',validationJson:'{}',createdAtMs:NOW,...o};
}
const rows=(t:T)=>t.run(ctx=>ctx.db.query('evidenceChatAudit').collect());
const postTurn=(caller:{fetch:T['fetch']},body:unknown)=>caller.fetch('/api/evidence-chat/turn',{method:'POST',headers:H,body:JSON.stringify(body)});
async function consumed(t:T){
 const m=await t.action(makeFunctionReference<'action'>('acceptanceNonces:mintAcceptanceNonce'),{owner:A,question:Q,operator:'test'}) as {token:string};
 const c=await (await t.fetch('/api/evidence-chat/acceptance/consume',{method:'POST',headers:H,body:JSON.stringify({token:m.token,question:Q})})).json() as {reservation:string};
 return {token:m.token,reservation:c.reservation};
}
const postRecord=(t:T,s:{token:string;reservation:string},tr:Record<string,unknown>)=>t.fetch('/api/evidence-chat/acceptance/record',{method:'POST',headers:H,body:JSON.stringify({token:s.token,reservation:s.reservation,turn:tr})});

describe('C1 — /api/evidence-chat/turn takes owner and provenance only from the server',()=>{
 it('rejects a nested owner override (cross-owner audit write)',async()=>{
  const {t,asA}=setup();
  const res=await postTurn(asA,{turn:turn({owner:B})});
  expect(res.status).toBe(400);
  expect((await rows(t)).filter(r=>r.owner===B)).toHaveLength(0);
  expect(await rows(t)).toHaveLength(0);
 });
 it('rejects forged provenance and other trusted fields inside turn',async()=>{
  const {t,asA}=setup();
  for(const forged of [{recordedVia:'convex_action'},{recordedVia:'server_gateway_acceptance'},{executionAuthority:'none'},{actorType:'human'},{modelVerifiedViaEndpoint:true},{tokenIdentifier:B},{callerId:B}]){
   const res=await postTurn(asA,{turn:turn(forged)});
   expect(res.status,JSON.stringify(forged)).toBe(400);
  }
  expect(await rows(t)).toHaveLength(0);
 });
 it('still records a legitimate turn for the verified caller with server provenance',async()=>{
  const {t,asA}=setup();
  const res=await postTurn(asA,{turn:turn()});
  expect(res.status).toBe(200);
  expect(await rows(t)).toMatchObject([{owner:A,recordedVia:'server_gateway'}]);
 });
 it('refuses a non-object or array turn',async()=>{
  const {asA}=setup();
  for(const bad of [[],'x',null,1])expect((await postTurn(asA,{turn:bad})).status).toBe(400);
 });
});

describe('C2 — acceptance record binds the question from the persisted nonce',()=>{
 it('rejects a nested turnQuestionSha256 override used to record a different question',async()=>{
  const {t}=setup();const s=await consumed(t);
  const other=turn({question:'A completely different question?'});
  const plain=await postRecord(t,s,other);
  expect(plain.status).toBe(409);
  const forged=await postRecord(t,s,{...other,turnQuestionSha256:sha(Q)});
  expect(forged.status).toBe(400);
  expect(await rows(t)).toHaveLength(0);
 });
 it('rejects nested nonce identity, secret or reservation overrides',async()=>{
  const {t}=setup();const s=await consumed(t);
  for(const forged of [{nonceId:'0'.repeat(32)},{secretSha256:'0'.repeat(64)},{reservationSha256:'0'.repeat(64)},{owner:B},{recordedVia:'server_gateway'}]){
   expect((await postRecord(t,s,turn(forged))).status,JSON.stringify(forged)).toBe(400);
  }
  expect(await rows(t)).toHaveLength(0);
  expect((await postRecord(t,s,turn())).status).toBe(200);
  expect(await rows(t)).toMatchObject([{owner:A,question:Q,recordedVia:'server_gateway_acceptance'}]);
 });
 it('rejects a replayed record with altered content after the nonce is recorded',async()=>{
  const {t}=setup();const s=await consumed(t);
  expect((await postRecord(t,s,turn())).status).toBe(200);
  const replayAltered=await postRecord(t,s,turn({turnId:'chat-2'}));
  expect(replayAltered.status).toBe(409);
  const replayForged=await postRecord(t,s,{...turn({turnId:'chat-3',question:'Other?'}),turnQuestionSha256:sha('Other?')});
  expect(replayForged.status).toBe(400);
  expect(await rows(t)).toHaveLength(1);
 });
});
