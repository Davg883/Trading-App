import {afterEach,describe,expect,it,vi} from 'vitest';
import {convexTest,type TestConvex} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';

/**
 * Pre-merge risk H2 (Convex side): paid inference requires an atomic per-owner budget reservation, and a live
 * provider turn can only be recorded by settling an active reservation of the same owner.
 */
const modules={'./_generated/server.ts':async()=>({}),'./acceptanceNonces.ts':()=>import('../convex/acceptanceNonces'),'./chatBudget.ts':()=>import('../convex/chatBudget'),'./evidenceChat.ts':()=>import('../convex/evidenceChat'),'./operations.ts':()=>import('../convex/operations'),'./remoteOpsCloud.ts':()=>import('../convex/remoteOpsCloud'),'./http.ts':()=>import('../convex/http')};
const ISS='https://issuer.test',A=`${ISS}|user_a`,B=`${ISS}|user_b`,G='g'.repeat(48);
const NOW=Date.parse('2026-11-10T12:00:00Z');
const Q='Which hyperscalers fund the Irish data-centre build-out?';
const H={'content-type':'application/json','x-aci-gateway-authorization':`Bearer ${G}`};
type T=TestConvex<typeof schema>;
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
function setup(){
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(NOW);
 vi.stubEnv('EVIDENCE_CHAT_GATEWAY_SECRET',G);vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN',ISS);
 const t=convexTest(schema,modules);
 return {t,asA:t.withIdentity({subject:'user_a',tokenIdentifier:A,issuer:ISS}),asB:t.withIdentity({subject:'user_b',tokenIdentifier:B,issuer:ISS})};
}
const live={generationMode:'gemini_live',providerStatus:'succeeded',inputTokens:3000,outputTokens:500,estimatedCostGbp:0.002,actualCostGbp:0.002,supportStatus:'fully_supported'};
function turn(o:Record<string,unknown>={}){
 return {turnId:`chat-${Math.random().toString(36).slice(2)}`,bundleId:'bundle-1',bundleSha256:'a'.repeat(64),question:Q,queryType:'ownership_chain',intentCategory:'graph',historicalCutoffMs:NOW,temporalBasis:'receipt',graphDatabaseName:'db',graphSchemaVersion:'v1',lastProjectedSequence:0,supportStatus:'unsupported',validationValid:true,validationAction:'accepted',modelId:'gemini-2.5-flash',generationMode:'abstention_only',providerStatus:'provider_error',inputTokens:0,outputTokens:0,cachedTokens:0,estimatedCostGbp:0,actualCostGbp:null,latencyMs:5,bundleJson:'{}',answerJson:'{}',validationJson:'{}',createdAtMs:NOW,...o};
}
type Caller={fetch:T['fetch']};
const reserve=(c:Caller)=>c.fetch('/api/evidence-chat/budget/reserve',{method:'POST',headers:H,body:'{}'});
const postTurn=(c:Caller,body:unknown)=>c.fetch('/api/evidence-chat/turn',{method:'POST',headers:H,body:JSON.stringify(body)});
const setCeiling=(t:T,owner:string,ceiling:number)=>t.run(ctx=>ctx.db.insert('operationsSettings',{owner,systemEnabled:true,disabledReason:null,activeEnvironment:'remote',dailyCostCeilingGbp:ceiling,monthlyCostCeilingGbp:Math.max(ceiling,1),updatedAt:NOW}));
const reservations=(t:T)=>t.run(ctx=>ctx.db.query('chatBudgetReservations').collect());
const auditRows=(t:T)=>t.run(ctx=>ctx.db.query('evidenceChatAudit').collect());

describe('H2 — reservation is atomic and bounded by the ceiling',()=>{
 it('reserves within the ceiling and refuses a reservation that would exceed it (concurrent requests included)',async()=>{
  const {t,asA}=setup();await setCeiling(t,A,0.06);
  const results=await Promise.all([reserve(asA),reserve(asA),reserve(asA)]);
  expect(results.map(r=>r.status).sort()).toEqual([200,409,409]);
  expect((await reservations(t)).filter(r=>r.status==='reserved')).toHaveLength(1);
 });
 it('requires the gateway credential and a verified human identity',async()=>{
  const {t,asA}=setup();
  expect((await t.fetch('/api/evidence-chat/budget/reserve',{method:'POST',headers:H,body:'{}'})).status).toBe(401);
  expect((await asA.fetch('/api/evidence-chat/budget/reserve',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status).toBe(401);
  const model=t.withIdentity({subject:'user_a',tokenIdentifier:A,issuer:ISS,actorType:'model'});
  expect((await reserve(model)).status).toBe(403);
  expect(await reservations(t)).toHaveLength(0);
 });
 it('unsettled reservations count until they expire, and recorded spend counts afterwards',async()=>{
  const {t,asA}=setup();await setCeiling(t,A,0.06);
  expect((await reserve(asA)).status).toBe(200);
  expect((await reserve(asA)).status).toBe(409);
  vi.setSystemTime(NOW+5*60_000+1);
  expect((await reserve(asA)).status).toBe(200);
 });
 it('enforces the shared per-owner rate limit across reservations and recorded turns',async()=>{
  const {asA,asB}=setup();
  for(let i=0;i<10;i++)expect((await reserve(asA)).status).toBe(200);
  expect((await reserve(asA)).status).toBe(429);
  expect((await reserve(asB)).status).toBe(200);
 });
});

describe('H2 — live turns must settle an active reservation of the same owner',()=>{
 it('rejects a live turn without a reservation, and accepts a non-live turn without one',async()=>{
  const {t,asA}=setup();
  expect((await postTurn(asA,{turn:turn(live)})).status).toBe(400);
  expect((await postTurn(asA,{turn:turn()})).status).toBe(200);
  expect(await auditRows(t)).toMatchObject([{generationMode:'abstention_only'}]);
 });
 it('settles a reservation exactly once; replay and cross-owner use are rejected',async()=>{
  const {t,asA,asB}=setup();
  const {reservation}=await (await reserve(asA)).json() as {reservation:string};
  expect((await postTurn(asB,{turn:turn(live),budgetReservation:reservation})).status).toBe(400);
  expect((await postTurn(asA,{turn:turn(live),budgetReservation:reservation})).status).toBe(200);
  expect((await postTurn(asA,{turn:turn(live),budgetReservation:reservation})).status).toBe(400);
  const [r]=await reservations(t);
  expect(r).toMatchObject({owner:A,status:'settled'});
  expect(await auditRows(t)).toMatchObject([{owner:A,generationMode:'gemini_live',recordedVia:'server_gateway'}]);
 });
 it('rejects an expired reservation and a malformed one',async()=>{
  const {asA}=setup();
  const {reservation}=await (await reserve(asA)).json() as {reservation:string};
  vi.setSystemTime(NOW+5*60_000+1);
  expect((await postTurn(asA,{turn:turn({...live,createdAtMs:NOW+5*60_000+1}),budgetReservation:reservation})).status).toBe(400);
  expect((await postTurn(asA,{turn:turn(),budgetReservation:'not-hex'})).status).toBe(400);
 });
 it('cannot smuggle a reservation digest inside the turn object',async()=>{
  const {asA}=setup();
  expect((await postTurn(asA,{turn:{...turn(live),budgetReservationSha256:'a'.repeat(64)}})).status).toBe(400);
 });
 it('a provider failure recorded against a reservation releases it as a non-live turn with no cost',async()=>{
  const {t,asA}=setup();
  const {reservation}=await (await reserve(asA)).json() as {reservation:string};
  expect((await postTurn(asA,{turn:turn(),budgetReservation:reservation})).status).toBe(200);
  expect((await reservations(t))[0]).toMatchObject({status:'settled'});
  expect(await auditRows(t)).toMatchObject([{generationMode:'abstention_only',providerStatus:'provider_error',estimatedCostGbp:0}]);
 });
});

describe('H2 — acceptance nonces reserve budget at consumption',()=>{
 async function mintConsume(t:T){
  const m=await t.action(makeFunctionReference<'action'>('acceptanceNonces:mintAcceptanceNonce'),{owner:A,question:Q,operator:'test'}) as {token:string};
  const c=await (await t.fetch('/api/evidence-chat/acceptance/consume',{method:'POST',headers:H,body:JSON.stringify({token:m.token,question:Q})})).json() as {reservation:string;budget:{reserved:boolean;reason?:string};context:{dailyChatSpendGbp:number;dailyCostCeilingGbp:number}};
  return {token:m.token,...c};
 }
 const record=(t:T,s:{token:string;reservation:string},tr:Record<string,unknown>)=>t.fetch('/api/evidence-chat/acceptance/record',{method:'POST',headers:H,body:JSON.stringify({token:s.token,reservation:s.reservation,turn:tr})});
 it('reserves at consume and settles on a live record',async()=>{
  const {t}=setup();const s=await mintConsume(t);
  expect(s.budget).toEqual({reserved:true});
  expect((await record(t,s,turn(live))).status).toBe(200);
  expect((await reservations(t))[0]).toMatchObject({source:'acceptance',status:'settled'});
 });
 it('with the budget exhausted, the context forces abstention and a live record is refused',async()=>{
  const {t}=setup();await setCeiling(t,A,0.01);
  const s=await mintConsume(t);
  expect(s.budget).toEqual({reserved:false,reason:'budget_exceeded'});
  expect(s.context.dailyChatSpendGbp).toBeGreaterThanOrEqual(s.context.dailyCostCeilingGbp);
  const liveRes=await record(t,s,turn(live));
  expect(liveRes.status).toBe(400);
  expect((await record(t,s,turn({providerStatus:'budget_exceeded'}))).status).toBe(200);
  expect(await auditRows(t)).toMatchObject([{providerStatus:'budget_exceeded',estimatedCostGbp:0}]);
 });
});
