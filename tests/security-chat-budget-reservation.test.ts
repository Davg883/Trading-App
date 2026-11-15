import {afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {evidenceTurnFields} from './helpers/turn-fixture';
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
const live={generationMode:'gemini_live',providerStatus:'succeeded',inputTokens:3000,outputTokens:500,estimatedCostGbp:0.002,actualCostGbp:0.002};
const errorResponse={generationMode:'abstention_only',providerStatus:'provider_error',providerFailureKind:'error_response'};
const timedOut={generationMode:'abstention_only',providerStatus:'provider_error',providerFailureKind:'timeout_or_transport'};
const noCall={generationMode:'abstention_only',providerStatus:'budget_exceeded'};
let turnSeq=0;
let EV_A:Awaited<ReturnType<typeof evidenceTurnFields>>;
beforeAll(async()=>{EV_A=await evidenceTurnFields(Q,A);});
function turn(o:Record<string,unknown>={}){
 // Evidence fields come from a real, consistent deterministic turn (strict inner evidence validation, Correction 4).
 return {turnId:`chat-${++turnSeq}`,modelId:'gemini-2.5-flash',generationMode:'abstention_only',providerStatus:'budget_exceeded',inputTokens:0,outputTokens:0,cachedTokens:0,estimatedCostGbp:0,actualCostGbp:null,latencyMs:5,createdAtMs:Date.now(),...EV_A,...o};
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
 it('unresolved in-flight liability persists across the 24-hour boundary until settled or operator-reconciled (R3)',async()=>{
  const {asA,t}=setup();await setCeiling(t,A,0.06);
  const r=await reserveStarted(asA);
  vi.setSystemTime(NOW+24*60*MIN+1);
  expect((await reserve(asA)).status).toBe(409);
  expect(await t.query(unresolved,{owner:A})).toMatchObject([{reservationSha256:sha(r),effectiveStatus:'unknown',liabilityGbp:0.05}]);
  await t.mutation(reconcile,{reservationSha256:sha(r),resolution:'provider_failed',chargeGbp:0,chargeBasis:'none',operator:'ops',note:'Confirmed no upstream charge after 24h'});
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

describe('Task A — Financial precision: integer accounting units (1 micro-GBP = £0.000001) at the £0.15 / £0.05 boundary',()=>{
 it('exact ceiling equality: a £0.15 ceiling accepts exactly three £0.05 reservations (150,000 units = 150,000 units) without IEEE-754 0.1+0.05 drift, and rejects the fourth',async()=>{
  const {t,asA}=setup();await setCeiling(t,A,0.15);
  const r1=await reserve(asA);expect(r1.status).toBe(200);expect(await r1.json()).toMatchObject({spentGbp:0,ceilingGbp:0.15});
  const r2=await reserve(asA);expect(r2.status).toBe(200);expect(await r2.json()).toMatchObject({spentGbp:0.05,ceilingGbp:0.15});
  const r3=await reserve(asA);expect(r3.status).toBe(200);expect(await r3.json()).toMatchObject({spentGbp:0.1,ceilingGbp:0.15});
  const r4=await reserve(asA);expect(r4.status).toBe(409);expect(await r4.json()).toMatchObject({error:{code:'budget_exceeded',spentGbp:0.15,ceilingGbp:0.15}});
  expect(await reservations(t)).toHaveLength(3);
 });
 it('one accounting unit (£0.000001) above the limit is rejected fail-closed (both via £0.100001 spend against £0.15 ceiling and via £0.149999 ceiling)',async()=>{
  const {t,asA,asB}=setup();await setCeiling(t,A,0.15);
  const rSettled=await reserveStarted(asA);
  expect((await postTurn(asA,{turn:turn({...live,estimatedCostGbp:0.000001,actualCostGbp:0.000001}),budgetReservation:rSettled})).status).toBe(200);
  expect((await reserve(asA)).status).toBe(200);
  expect((await reserve(asA)).status).toBe(200);
  const third=await reserve(asA);
  expect(third.status).toBe(409);
  expect(await third.json()).toMatchObject({error:{code:'budget_exceeded',spentGbp:0.100001,ceilingGbp:0.15}});

  await setCeiling(t,B,0.149999);
  expect((await reserve(asB)).status).toBe(200);
  expect((await reserve(asB)).status).toBe(200);
  const thirdB=await reserve(asB);
  expect(thirdB.status).toBe(409);
  expect(await thirdB.json()).toMatchObject({error:{code:'budget_exceeded',spentGbp:0.1,ceilingGbp:0.149999}});
 });
 it('concurrent reservations at the £0.15 boundary: 10 parallel £0.05 requests accept exactly 3 and reject 7',async()=>{
  const {t,asA}=setup();await setCeiling(t,A,0.15);
  const results=await Promise.all(Array.from({length:10},()=>reserve(asA)));
  expect(results.filter(r=>r.status===200)).toHaveLength(3);
  expect(results.filter(r=>r.status===409)).toHaveLength(7);
  expect(await reservations(t)).toHaveLength(3);
 });
 it('reconciliation and duplicate settlement at the 1-accounting-unit boundary unlock exact headroom when <= ceiling and block when 1 unit over',async()=>{
  const {t,asA}=setup();await setCeiling(t,A,0.15);
  const r1=await reserveStarted(asA),r2=await reserveStarted(asA),r3=await reserveStarted(asA);
  vi.setSystemTime(NOW+6*MIN);
  expect((await reserve(asA)).status).toBe(409);
  await t.mutation(reconcile,{reservationSha256:sha(r1),resolution:'settled',chargeGbp:0.000001,chargeBasis:'actual_billing',operator:'ops',note:'1 micro-GBP charge'});
  expect(await t.mutation(reconcile,{reservationSha256:sha(r1),resolution:'settled',chargeGbp:0.000001,chargeBasis:'actual_billing',operator:'ops',note:'1 micro-GBP charge'})).toMatchObject({duplicate:true});
  expect((await reserve(asA)).status).toBe(409);
  const tr2=turn({...live,createdAtMs:Date.now(),estimatedCostGbp:0.049999,actualCostGbp:0.049999});
  expect((await postTurn(asA,{turn:tr2,budgetReservation:r2})).status).toBe(200);
  expect(await (await postTurn(asA,{turn:tr2,budgetReservation:r2})).json()).toMatchObject({duplicate:true});
  const r4=await reserve(asA);
  expect(r4.status).toBe(200);
  expect(await r4.json()).toMatchObject({spentGbp:0.1,ceilingGbp:0.15});
  expect(r3).toBeTruthy();
 });
 it('midnight and 24-hour liability rollover at the 1-accounting-unit boundary: unresolved reservations persist across midnight and 24h while settled spend rolls off at 24h+1ms',async()=>{
  const {t,asA}=setup();await setCeiling(t,A,0.15);
  // 1. r1 is settled at £0.000001 (1 unit); r2 and r3 are started (`in_flight`, 50,000 units each -> total 100,001 units)
  const r1=await reserveStarted(asA);
  expect((await postTurn(asA,{turn:turn({...live,estimatedCostGbp:0.000001,actualCostGbp:0.000001}),budgetReservation:r1})).status).toBe(200);
  await reserveStarted(asA);
  await reserveStarted(asA);
  // Across UTC midnight (+13h): total is still 100,001 units, so another £0.05 reservation (50,000 units -> 150,001 > 150,000) is blocked!
  vi.setSystemTime(NOW+13*60*MIN);
  expect((await reserve(asA)).status).toBe(409);
  // At 24h + 1ms: the £0.000001 settled turn rolls off the 24h window, while the two unresolved reservations (now `unknown`, 100,000 units total) remain liable!
  // Now 100,000 + 50,000 = 150,000 <= 150,000 -> exact ceiling equality succeeds!
  vi.setSystemTime(NOW+24*60*MIN+1);
  const afterRollover=await reserve(asA);
  expect(afterRollover.status).toBe(200);
  expect(await afterRollover.json()).toMatchObject({spentGbp:0.1,ceilingGbp:0.15});
  // And a 4th reservation (150,000 + 50,000 = 200,000 > 150,000) is blocked because the two >24h unresolved reservations still hold £0.10!
  expect((await reserve(asA)).status).toBe(409);
 });
});

describe('Task 1 — Forged or malformed Clerk JWTs return controlled 401/403 (never 500) with zero private leak',()=>{
 const b64u=(obj:unknown)=>Buffer.from(JSON.stringify(obj),'utf8').toString('base64url');
 const fakeSig='A'.repeat(86);
 const signedRoutes=['/api/evidence-chat/budget/reserve','/api/evidence-chat/budget/start','/api/evidence-chat/turn'] as const;

 it('malformed, truncated, wrong-alg, missing-kid, or expired Authorization Bearer tokens return 401 sign_in_required on all user gateway routes',async()=>{
  const {t}=setup();
  const validHdr=b64u({alg:'RS256',typ:'JWT',kid:'ins_test_key_1'});
  const expiredPay=b64u({iss:ISS,sub:'user_a',aud:'convex',exp:Math.floor((NOW-60_000)/1000)});
  const noKidHdr=b64u({alg:'RS256',typ:'JWT'});
  const noneAlgHdr=b64u({alg:'none',typ:'JWT',kid:'ins_test_key_1'});
  const validPay=b64u({iss:ISS,sub:'user_a',aud:'convex',exp:Math.floor((NOW+300_000)/1000)});

  const malformedTokens=[
   'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.forged.signature',
   'Bearer not-a-jwt',
   'Token some-opaque-string',
   `Bearer ${validHdr}.${expiredPay}.${fakeSig}`,
   `Bearer ${noKidHdr}.${validPay}.${fakeSig}`,
   `Bearer ${noneAlgHdr}.${validPay}.${fakeSig}`,
   `Bearer ${validHdr}.${validPay}.short`,
  ];

  for(const path of signedRoutes){
   for(const auth of malformedTokens){
    const res=await t.fetch(path,{
     method:'POST',
     headers:{...H,Authorization:auth},
     body:JSON.stringify({}),
    });
    expect(res.status,`${path} with ${auth}`).toBe(401);
    const body=await res.json() as {error:{code:string;message:string}};
    expect(body).toEqual({
     error:{
      code:'sign_in_required',
      message:'A verified user session is required.',
     },
    });
    expect(JSON.stringify(body)).not.toMatch(/stack|Request ID|at handler|secret|token/i);
   }
  }
  expect(await reservations(t)).toHaveLength(0);
  expect(await auditRows(t)).toHaveLength(0);
 });

 it('structurally valid JWTs with untrusted issuer, untrusted audience, untrusted azp, or automated actorType return 403 forbidden_identity (never 500)',async()=>{
  const {t}=setup();
  const validHdr=b64u({alg:'RS256',typ:'JWT',kid:'ins_test_key_1'});
  const exp=Math.floor((NOW+300_000)/1000);
  const forbiddenPayloads=[
   {iss:'https://untrusted-issuer.clerk.accounts.dev',sub:'user_a',aud:'convex',exp},
   {iss:ISS,sub:'user_a',aud:'https://evil.example.com',exp},
   {iss:ISS,sub:'user_a',aud:'convex',azp:'https://attacker.example.com',exp},
   {iss:ISS,sub:'user_a',aud:'foreign-relying-party',azp:'https://capital.aiguides.co.uk',exp},
   {iss:ISS,sub:'user_a',aud:'convex',actorType:'agent',exp},
   {iss:ISS,sub:'user_a',exp},
   {iss:ISS,sub:'user_a',aud:null,exp},
   {iss:ISS,sub:'user_a',azp:null,exp},
   {iss:ISS,sub:'user_a',aud:[],exp},
  ];

  for(const path of signedRoutes){
   for(const pay of forbiddenPayloads){
    const jwt=`Bearer ${validHdr}.${b64u(pay)}.${fakeSig}`;
    const res=await t.fetch(path,{
     method:'POST',
     headers:{...H,Authorization:jwt},
     body:JSON.stringify({}),
    });
    expect(res.status,`${path} with ${JSON.stringify(pay)}`).toBe(403);
    const body=await res.json() as {error:{code:string;message:string}};
    expect(body).toEqual({
     error:{
      code:'forbidden_identity',
      message:'This identity cannot use research chat.',
     },
    });
   }
  }
  expect(await reservations(t)).toHaveLength(0);
  expect(await auditRows(t)).toHaveLength(0);
 });

 it('structurally valid JWT with trusted claims but unverified/forged signature returns 401 sign_in_required when getUserIdentity returns null',async()=>{
  const {t}=setup();
  const validHdr=b64u({alg:'RS256',typ:'JWT',kid:'ins_test_key_1'});
  const validPay=b64u({iss:ISS,sub:'user_a',aud:'convex',exp:Math.floor((NOW+300_000)/1000)});
  const forgedJwt=`Bearer ${validHdr}.${validPay}.${fakeSig}`;

  for(const path of signedRoutes){
   const res=await t.fetch(path,{
    method:'POST',
    headers:{...H,Authorization:forgedJwt},
    body:JSON.stringify({}),
   });
   expect(res.status,path).toBe(401);
   expect(await res.json()).toEqual({
    error:{
     code:'sign_in_required',
     message:'A verified user session is required.',
    },
   });
  }
  expect(await reservations(t)).toHaveLength(0);
  expect(await auditRows(t)).toHaveLength(0);
 });
});
