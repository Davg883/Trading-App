import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {convexTest,type TestConvex} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';

/**
 * Budget reservation accounting (pre-merge risk H2; durable state model, Correction 2).
 *
 * Deterministic local tests against convex-test. convex-test runs one transaction at a time, so "concurrent"
 * cases prove the state machine is correct under any serial order of whole transactions; they do not exercise
 * the production optimistic-concurrency engine (see docs/mvp-hardening-fable-52/12-final-corrections-report.md).
 */
const modules={'./_generated/server.ts':async()=>({}),'./acceptanceNonces.ts':()=>import('../convex/acceptanceNonces'),'./chatBudget.ts':()=>import('../convex/chatBudget'),'./evidenceChat.ts':()=>import('../convex/evidenceChat'),'./operations.ts':()=>import('../convex/operations'),'./remoteOpsCloud.ts':()=>import('../convex/remoteOpsCloud'),'./http.ts':()=>import('../convex/http')};
const ISS='https://issuer.test',A=`${ISS}|user_a`,B=`${ISS}|user_b`,G='g'.repeat(48);
const NOW=Date.parse('2026-11-10T12:00:00Z');
const MIN=60_000;
const Q='Which hyperscalers fund the Irish data-centre build-out?';
const H={'content-type':'application/json','x-aci-gateway-authorization':`Bearer ${G}`};
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
type T=TestConvex<typeof schema>;
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
function setup(){
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(NOW);
 vi.stubEnv('EVIDENCE_CHAT_GATEWAY_SECRET',G);vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN',ISS);
 const t=convexTest(schema,modules);
 return {t,asA:t.withIdentity({subject:'user_a',tokenIdentifier:A,issuer:ISS}),asB:t.withIdentity({subject:'user_b',tokenIdentifier:B,issuer:ISS})};
}
const live={generationMode:'gemini_live',providerStatus:'succeeded',inputTokens:3000,outputTokens:500,estimatedCostGbp:0.002,actualCostGbp:0.002,supportStatus:'fully_supported'};
const errorResponse={generationMode:'abstention_only',providerStatus:'provider_error',providerFailureKind:'error_response'};
const timedOut={generationMode:'abstention_only',providerStatus:'provider_error',providerFailureKind:'timeout_or_transport'};
const noCall={generationMode:'abstention_only',providerStatus:'budget_exceeded'};
let turnSeq=0;
function turn(o:Record<string,unknown>={}){
 return {turnId:`chat-${++turnSeq}`,bundleId:'bundle-1',bundleSha256:'a'.repeat(64),question:Q,queryType:'ownership_chain',intentCategory:'graph',historicalCutoffMs:NOW,temporalBasis:'receipt',graphDatabaseName:'db',graphSchemaVersion:'v1',lastProjectedSequence:0,supportStatus:'unsupported',validationValid:true,validationAction:'accepted',modelId:'gemini-2.5-flash',generationMode:'abstention_only',providerStatus:'budget_exceeded',inputTokens:0,outputTokens:0,cachedTokens:0,estimatedCostGbp:0,actualCostGbp:null,latencyMs:5,bundleJson:'{}',answerJson:'{}',validationJson:'{}',createdAtMs:Date.now(),...o};
}
type Caller={fetch:T['fetch']};
const post=(c:Caller,path:string,body:unknown)=>c.fetch(path,{method:'POST',headers:H,body:JSON.stringify(body)});
const reserve=(c:Caller)=>post(c,'/api/evidence-chat/budget/reserve',{});
const start=(c:Caller,r:string)=>post(c,'/api/evidence-chat/budget/start',{budgetReservation:r});
const postTurn=(c:Caller,body:unknown)=>post(c,'/api/evidence-chat/turn',body);
async function reserveStarted(c:Caller){const {reservation}=await (await reserve(c)).json() as {reservation:string};expect((await start(c,reservation)).status).toBe(200);return reservation;}
const setCeiling=(t:T,owner:string,ceiling:number)=>t.run(ctx=>ctx.db.insert('operationsSettings',{owner,systemEnabled:true,disabledReason:null,activeEnvironment:'remote',dailyCostCeilingGbp:ceiling,monthlyCostCeilingGbp:Math.max(ceiling,1),updatedAt:NOW}));
const reservations=(t:T)=>t.run(ctx=>ctx.db.query('chatBudgetReservations').collect());
const auditRows=(t:T)=>t.run(ctx=>ctx.db.query('evidenceChatAudit').collect());
const reconcile=makeFunctionReference<'mutation'>('chatBudget:reconcileReservationInternal');
const unresolved=makeFunctionReference<'query'>('chatBudget:listUnresolvedReservationsInternal');

describe('Correction 2 — expiry never erases possible provider liability',()=>{
 it('REGRESSION: a started call that never reports back keeps counting after the old five-minute expiry',async()=>{
  const {t,asA}=setup();await setCeiling(t,A,0.06);
  await reserveStarted(asA); // provider call starts, then the server crashes: no audit record
  vi.setSystemTime(NOW+5*MIN+1);
  expect((await reserve(asA)).status).toBe(409);
  expect(await t.query(unresolved,{owner:A})).toMatchObject([{storedStatus:'in_flight',effectiveStatus:'unknown',liabilityGbp:0.05}]);
 });
 it('a reservation that was never started lapses unused after its start window and frees the budget',async()=>{
  const {t,asA}=setup();await setCeiling(t,A,0.06);
  expect((await reserve(asA)).status).toBe(200);
  expect((await reserve(asA)).status).toBe(409);
  vi.setSystemTime(NOW+2*MIN+1);
  expect((await reserve(asA)).status).toBe(200);
  expect(await t.query(unresolved,{owner:A})).toEqual([]);
 });
 it('an expired, never-started reservation cannot be started or used for a paid turn',async()=>{
  const {asA}=setup();
  const {reservation}=await (await reserve(asA)).json() as {reservation:string};
  vi.setSystemTime(NOW+2*MIN+1);
  const res=await start(asA,reservation);
  expect(res.status).toBe(409);expect(((await res.json()) as {error:{code:string}}).error.code).toBe('budget_reservation_expired');
  expect((await postTurn(asA,{turn:turn(live),budgetReservation:reservation})).status).toBe(400);
 });
 it('unresolved liability ages out with the 24-hour window, so it cannot lock the budget permanently',async()=>{
  const {asA,t}=setup();await setCeiling(t,A,0.06);
  await reserveStarted(asA);
  vi.setSystemTime(NOW+24*60*MIN+1);
  expect((await reserve(asA)).status).toBe(200);
 });
});

describe('Correction 2 — settlement outcomes',()=>{
 it('a provider call cannot be recorded against an unstarted reservation',async()=>{
  const {asA}=setup();
  const {reservation}=await (await reserve(asA)).json() as {reservation:string};
  for(const outcome of [live,errorResponse,timedOut])
   expect((await postTurn(asA,{turn:turn(outcome),budgetReservation:reservation})).status,JSON.stringify(outcome)).toBe(400);
 });
 it('live success → settled with an estimated charge; confirmed error → provider_failed with no charge; timeout → unknown and still liable',async()=>{
  const {t,asA}=setup();
  const r1=await reserveStarted(asA),r2=await reserveStarted(asA),r3=await reserveStarted(asA);
  expect((await postTurn(asA,{turn:turn(live),budgetReservation:r1})).status).toBe(200);
  expect((await postTurn(asA,{turn:turn(errorResponse),budgetReservation:r2})).status).toBe(200);
  expect((await postTurn(asA,{turn:turn(timedOut),budgetReservation:r3})).status).toBe(200);
  const by=new Map((await reservations(t)).map(r=>[r.reservationSha256,r]));
  expect(by.get(sha(r1))).toMatchObject({status:'settled',chargeGbp:0.002,chargeBasis:'estimated'});
  expect(by.get(sha(r2))).toMatchObject({status:'provider_failed',chargeGbp:0,chargeBasis:'estimated'});
  expect(by.get(sha(r3))).toMatchObject({status:'unknown',chargeGbp:null,chargeBasis:'unknown'});
  expect(await t.query(unresolved,{owner:A})).toMatchObject([{reservationSha256:sha(r3),liabilityGbp:0.05}]);
 });
 it('a turn with no provider call settles with charge basis "none", even on an unstarted reservation',async()=>{
  const {t,asA}=setup();
  const {reservation}=await (await reserve(asA)).json() as {reservation:string};
  expect((await postTurn(asA,{turn:turn(noCall),budgetReservation:reservation})).status).toBe(200);
  expect((await reservations(t))[0]).toMatchObject({status:'settled',chargeGbp:0,chargeBasis:'none'});
 });
 it('a live or failed provider turn without any reservation is refused',async()=>{
  const {asA,t}=setup();
  for(const outcome of [live,errorResponse,timedOut])expect((await postTurn(asA,{turn:turn(outcome)})).status).toBe(400);
  expect(await auditRows(t)).toHaveLength(0);
 });
});

describe('Correction 2 — idempotency, duplicates, delays and ownership',()=>{
 it('duplicate completion of the same turn returns the original audit id and charges once',async()=>{
  const {t,asA}=setup();const r=await reserveStarted(asA);const tr=turn(live);
  const first=await (await postTurn(asA,{turn:tr,budgetReservation:r})).json() as {auditId:string;duplicate:boolean};
  const again=await (await postTurn(asA,{turn:tr,budgetReservation:r})).json() as {auditId:string;duplicate:boolean};
  expect(again).toMatchObject({auditId:first.auditId,duplicate:true});
  expect(await auditRows(t)).toHaveLength(1);
  expect((await reservations(t))[0]).toMatchObject({status:'settled',auditId:first.auditId});
 });
 it('a different turn cannot settle an already settled reservation (no second paid call per reservation)',async()=>{
  const {t,asA}=setup();const r=await reserveStarted(asA);
  expect((await postTurn(asA,{turn:turn(live),budgetReservation:r})).status).toBe(200);
  expect((await postTurn(asA,{turn:turn(live),budgetReservation:r})).status).toBe(400);
  expect(await auditRows(t)).toHaveLength(1);
 });
 it('a reused turnId with different content is refused',async()=>{
  const {asA}=setup();const r1=await reserveStarted(asA),r2=await reserveStarted(asA);
  const tr=turn(live);
  expect((await postTurn(asA,{turn:tr,budgetReservation:r1})).status).toBe(200);
  expect((await postTurn(asA,{turn:{...tr,bundleSha256:'b'.repeat(64)},budgetReservation:r2})).status).toBe(400);
 });
 it('delayed completion after the in-flight deadline resolves the unknown state',async()=>{
  const {t,asA}=setup();const r=await reserveStarted(asA);
  vi.setSystemTime(NOW+6*MIN);
  expect(await t.query(unresolved,{owner:A})).toHaveLength(1);
  expect((await postTurn(asA,{turn:turn({...live,createdAtMs:Date.now()}),budgetReservation:r})).status).toBe(200);
  expect(await t.query(unresolved,{owner:A})).toEqual([]);
  expect((await reservations(t))[0]).toMatchObject({status:'settled'});
 });
 it('cross-owner start and settlement are rejected',async()=>{
  const {t,asA,asB}=setup();
  const {reservation}=await (await reserve(asA)).json() as {reservation:string};
  expect((await start(asB,reservation)).status).toBe(409);
  expect((await start(asA,reservation)).status).toBe(200);
  expect((await postTurn(asB,{turn:turn(live),budgetReservation:reservation})).status).toBe(400);
  expect((await reservations(t))[0]).toMatchObject({owner:A,status:'in_flight'});
 });
 it('starting twice is idempotent and does not extend the deadline',async()=>{
  const {asA}=setup();const {reservation}=await (await reserve(asA)).json() as {reservation:string};
  const a=await (await start(asA,reservation)).json() as {inFlightDeadlineMs:number};
  vi.setSystemTime(NOW+MIN);
  const b=await (await start(asA,reservation)).json() as {inFlightDeadlineMs:number};
  expect(b.inFlightDeadlineMs).toBe(a.inFlightDeadlineMs);
 });
});

describe('Correction 2 — concurrency, rate limit and outage behaviour',()=>{
 it('concurrent reservations cannot jointly exceed the ceiling',async()=>{
  const {t,asA}=setup();await setCeiling(t,A,0.11);
  const results=await Promise.all(Array.from({length:6},()=>reserve(asA)));
  expect(results.map(r=>r.status).filter(s=>s===200)).toHaveLength(2);
  expect(results.map(r=>r.status).filter(s=>s===409)).toHaveLength(4);
 });
 it('enforces the shared per-owner rate limit across open reservations and recorded turns',async()=>{
  const {asA,asB}=setup();
  for(let i=0;i<10;i++)expect((await reserve(asA)).status).toBe(200);
  expect((await reserve(asA)).status).toBe(429);
  expect((await reserve(asB)).status).toBe(200);
 });
 it('requires the gateway credential and a verified human identity for reserve and start',async()=>{
  const {t,asA}=setup();
  expect((await t.fetch('/api/evidence-chat/budget/reserve',{method:'POST',headers:H,body:'{}'})).status).toBe(401);
  expect((await asA.fetch('/api/evidence-chat/budget/reserve',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status).toBe(401);
  expect((await t.fetch('/api/evidence-chat/budget/start',{method:'POST',headers:H,body:JSON.stringify({budgetReservation:'a'.repeat(64)})})).status).toBe(401);
  const model=t.withIdentity({subject:'user_a',tokenIdentifier:A,issuer:ISS,actorType:'model'});
  expect((await reserve(model)).status).toBe(403);
  expect(await reservations(t)).toHaveLength(0);
 });
 it('with the budget exhausted no reservation is created, so no paid call can be authorised',async()=>{
  const {t,asA}=setup();await setCeiling(t,A,0.01);
  expect((await reserve(asA)).status).toBe(409);
  expect(await reservations(t)).toHaveLength(0);
 });
});

describe('Correction 2 — operator reconciliation is explicit and audited',()=>{
 const reconcileArgs=(r:string,o:Record<string,unknown>={})=>({reservationSha256:sha(r),resolution:'settled',chargeGbp:0.004,chargeBasis:'actual_billing',operator:'ops',note:'Matched to provider billing export',...o});
 it('resolves an unknown call from billing evidence, writes an audit event, and is idempotent',async()=>{
  const {t,asA}=setup();await setCeiling(t,A,0.06);
  const r=await reserveStarted(asA);vi.setSystemTime(NOW+6*MIN);
  expect((await reserve(asA)).status).toBe(409);
  await t.mutation(reconcile,reconcileArgs(r));
  expect((await reservations(t)).find(x=>x.reservationSha256===sha(r))).toMatchObject({status:'settled',chargeGbp:0.004,chargeBasis:'actual_billing'});
  expect(await t.mutation(reconcile,reconcileArgs(r))).toMatchObject({duplicate:true});
  const events=await t.run(ctx=>ctx.db.query('audit').collect());
  expect(events.filter(e=>e.action==='graph.evidence_chat.budget.reconciled')).toHaveLength(1);
  // The unknown £0.05 liability is replaced by the reconciled £0.004 charge, so a new £0.05 reservation fits (0.054 <= 0.06).
  expect((await reserve(asA)).status).toBe(200);
 });
 it('cannot rewrite a settled or failed reservation, or reconcile a call that is still within its deadline',async()=>{
  const {t,asA}=setup();
  const settled=await reserveStarted(asA);
  expect((await postTurn(asA,{turn:turn(live),budgetReservation:settled})).status).toBe(200);
  await expect(t.mutation(reconcile,reconcileArgs(settled))).rejects.toThrow('cannot be reconciled');
  const fresh=await reserveStarted(asA);
  await expect(t.mutation(reconcile,reconcileArgs(fresh))).rejects.toThrow('cannot be reconciled');
  await expect(t.mutation(reconcile,reconcileArgs(fresh,{resolution:'provider_failed',chargeGbp:0.01}))).rejects.toThrow('Only a settled reservation');
  await expect(t.mutation(reconcile,reconcileArgs(fresh,{note:' '}))).rejects.toThrow('note');
 });
});

describe('Correction 2 — acceptance nonces',()=>{
 async function mintConsume(t:T){
  const m=await t.action(makeFunctionReference<'action'>('acceptanceNonces:mintAcceptanceNonce'),{owner:A,question:Q,operator:'test'}) as {token:string};
  const c=await (await post(t,'/api/evidence-chat/acceptance/consume',{token:m.token,question:Q})).json() as {reservation:string;budget:{reserved:boolean;reason?:string};context:{dailyChatSpendGbp:number;dailyCostCeilingGbp:number}};
  return {token:m.token,...c};
 }
 const record=(t:T,s:{token:string;reservation:string},tr:Record<string,unknown>)=>post(t,'/api/evidence-chat/acceptance/record',{token:s.token,reservation:s.reservation,turn:tr});
 it('reserves at consume, must be started before a paid call, and settles on a live record',async()=>{
  const {t}=setup();const s=await mintConsume(t);
  expect(s.budget).toEqual({reserved:true});
  expect((await record(t,s,turn(live))).status).toBe(400);
  expect((await post(t,'/api/evidence-chat/acceptance/start',{token:s.token,reservation:s.reservation})).status).toBe(200);
  expect((await record(t,s,turn(live))).status).toBe(200);
  expect((await reservations(t))[0]).toMatchObject({source:'acceptance',status:'settled'});
 });
 it('a nonce failed after its provider call started keeps the reservation liable as unknown',async()=>{
  const {t}=setup();const s=await mintConsume(t);
  await post(t,'/api/evidence-chat/acceptance/start',{token:s.token,reservation:s.reservation});
  expect((await post(t,'/api/evidence-chat/acceptance/fail',{token:s.token,reservation:s.reservation,failureCode:'audit_record_rejected'})).status).toBe(200);
  expect((await reservations(t))[0]).toMatchObject({status:'unknown'});
 });
 it('a nonce failed before any provider call releases its reservation unused',async()=>{
  const {t}=setup();const s=await mintConsume(t);
  await post(t,'/api/evidence-chat/acceptance/fail',{token:s.token,reservation:s.reservation,failureCode:'budget_start_failed'});
  expect((await reservations(t))[0]).toMatchObject({status:'expired_unused'});
 });
 it('with the budget exhausted, the context forces abstention and a live record is refused',async()=>{
  const {t}=setup();await setCeiling(t,A,0.01);
  const s=await mintConsume(t);
  expect(s.budget).toEqual({reserved:false,reason:'budget_exceeded'});
  expect(s.context.dailyChatSpendGbp).toBeGreaterThanOrEqual(s.context.dailyCostCeilingGbp);
  expect((await record(t,s,turn(live))).status).toBe(400);
  expect((await record(t,s,turn(noCall))).status).toBe(200);
 });
});
