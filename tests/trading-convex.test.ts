import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';
import {grantReviewers} from './helpers/roles';
import {OPT_IN_STATEMENT} from '../convex/trading';

const modules={'./_generated/server.ts':async()=>({}),'./trading.ts':()=>import('../convex/trading')};
const m=(n:string)=>makeFunctionReference<'mutation'>(`trading:${n}`),q=(n:string)=>makeFunctionReference<'query'>(`trading:${n}`);
const OWNER='https://issuer.test|user_owner',OTHER='https://issuer.test|user_other',now=Date.parse('2026-11-06T15:00:00Z');
const H=(c:string)=>c.repeat(64);
const draft=(o:Record<string,unknown>={})=>JSON.stringify({environment:'demo',ticker:'AAPL_US_EQ',side:'BUY',quantity:0.1,type:'MARKET',limitPrice:null,stopPrice:null,timeValidity:null,extendedHours:false,thesis:'Services margin expansion supports earnings growth.',counterevidence:'Hardware demand is cyclical and valuation is elevated.',...o});
const brokerOrder=(o:Record<string,unknown>={})=>JSON.stringify({id:555,ticker:'AAPL_US_EQ',type:'MARKET',status:'NEW',quantity:0.1,filledQuantity:0,filledValue:null,limitPrice:null,stopPrice:null,createdAt:null,initiatedFrom:'API',...o});
afterEach(()=>vi.useRealTimers());

async function setup({reviewer=true,optIn=true,key=true}={}){
 vi.useFakeTimers();vi.setSystemTime(now);const t=convexTest(schema,modules),owner=t.withIdentity({subject:'user_owner',tokenIdentifier:OWNER}),other=t.withIdentity({subject:'user_other',tokenIdentifier:OTHER});
 if(reviewer)await grantReviewers(t,[OWNER]);
 if(optIn)await owner.mutation(m('recordOptIn'),{statement:OPT_IN_STATEMENT});
 if(key)await t.mutation(m('saveTradingKeyInternal'),{owner:OWNER,environment:'demo',maskedKey:'••••ABCD',encryptedPayload:'{"test":"envelope"}'});
 return {t,owner,other};
}
async function toApproved(t:Awaited<ReturnType<typeof setup>>['t'],owner:Awaited<ReturnType<typeof setup>>['owner'],d=draft()){
 const orderId=await owner.mutation(m('createDraft'),{draftJson:d});
 await t.mutation(m('recordRiskInternal'),{owner:OWNER,orderId,riskJson:'{"passed":true}',priceReferenceJson:'{"price":200}',passed:true});
 await owner.mutation(m('reviewDecision'),{orderId,decision:'approve',note:'Thesis and limits reviewed'});
 return orderId;
}
async function toConfirmed(t:Awaited<ReturnType<typeof setup>>['t'],owner:Awaited<ReturnType<typeof setup>>['owner'],d?:string){
 const orderId=await toApproved(t,owner,d);await t.mutation(m('issueConfirmationInternal'),{owner:OWNER,orderId,tokenHash:H('a'),payloadHash:H('b')});
 await t.mutation(m('confirmInternal'),{owner:OWNER,orderId,tokenHash:H('a'),payloadHash:H('b')});return orderId;
}
const claim=(orderId:unknown,o:Record<string,unknown>={})=>({owner:OWNER,orderId,submissionId:'0f8fad5b-d9cb-469f-a165-70867728950e',payloadHash:H('b'),executionFlagEnabled:true,knownBrokerIdsBefore:[1,2],...o});
const state=async(owner:Awaited<ReturnType<typeof setup>>['owner'],orderId:unknown)=>((await owner.query(q('overview'),{})) as {orders:{orderId:unknown;state:string}[]}).orders.find(o=>o.orderId===orderId)!.state;

describe('Trading proposals, approvals and confirmations',()=>{
 it('refuses model actors and keeps orders owner-scoped',async()=>{
  const {t,owner,other}=await setup();const model=t.withIdentity({subject:'user_owner',tokenIdentifier:OWNER,actorType:'model'});
  await expect(model.mutation(m('createDraft'),{draftJson:draft()})).rejects.toThrow('Model or automated actors');
  const orderId=await owner.mutation(m('createDraft'),{draftJson:draft()});
  await expect(other.mutation(m('withdraw'),{orderId,reason:'x'})).rejects.toThrow('Order unavailable');await expect(other.query(q('orderEvents'),{orderId})).rejects.toThrow('Order unavailable');
  await expect(t.query(q('overview'),{})).rejects.toThrow('Sign in required');
 });
 it('requires a passed risk check and an explicit reviewer grant to approve',async()=>{
  const {t,owner}=await setup({reviewer:false});const orderId=await owner.mutation(m('createDraft'),{draftJson:draft()});
  await t.mutation(m('recordRiskInternal'),{owner:OWNER,orderId,riskJson:'{}',priceReferenceJson:null,passed:false});expect(await state(owner,orderId)).toBe('draft');
  await t.mutation(m('recordRiskInternal'),{owner:OWNER,orderId,riskJson:'{}',priceReferenceJson:'{}',passed:true});expect(await state(owner,orderId)).toBe('reviewed');
  await expect(owner.mutation(m('reviewDecision'),{orderId,decision:'approve',note:'ok'})).rejects.toThrow('Reviewer role required');
  await grantReviewers(t,[OWNER]);await owner.mutation(m('reviewDecision'),{orderId,decision:'approve',note:'ok'});expect(await state(owner,orderId)).toBe('approved');
  await t.mutation(m('recordRiskInternal'),{owner:OWNER,orderId,riskJson:'{}',priceReferenceJson:'{}',passed:false});expect(await state(owner,orderId)).toBe('draft');
 });
 it('accepts a confirmation once, only unexpired and only for unchanged details',async()=>{
  const {t,owner}=await setup();const orderId=await toApproved(t,owner);
  await t.mutation(m('issueConfirmationInternal'),{owner:OWNER,orderId,tokenHash:H('a'),payloadHash:H('b')});
  await expect(t.mutation(m('confirmInternal'),{owner:OWNER,orderId,tokenHash:H('c'),payloadHash:H('b')})).rejects.toThrow('does not match');
  await expect(t.mutation(m('confirmInternal'),{owner:OWNER,orderId,tokenHash:H('a'),payloadHash:H('d')})).rejects.toThrow('changed');
  vi.setSystemTime(now+61_000);await expect(t.mutation(m('confirmInternal'),{owner:OWNER,orderId,tokenHash:H('a'),payloadHash:H('b')})).rejects.toThrow('expired');
  await t.mutation(m('issueConfirmationInternal'),{owner:OWNER,orderId,tokenHash:H('a'),payloadHash:H('b')});await t.mutation(m('confirmInternal'),{owner:OWNER,orderId,tokenHash:H('a'),payloadHash:H('b')});
  await expect(t.mutation(m('confirmInternal'),{owner:OWNER,orderId,tokenHash:H('a'),payloadHash:H('b')})).rejects.toThrow();
  expect(await state(owner,orderId)).toBe('confirmed');
 });
});

describe('Submission gates and duplicate prevention',()=>{
 it('refuses submission when the server flag is off, without opt-in, key or reviewer grant',async()=>{
  const a=await setup();const o1=await toConfirmed(a.t,a.owner);await expect(a.t.mutation(m('claimSubmissionInternal'),claim(o1,{executionFlagEnabled:false}))).rejects.toThrow('disabled on this server');
  const b=await setup({key:false});const o2=await toConfirmed(b.t,b.owner);await expect(b.t.mutation(m('claimSubmissionInternal'),claim(o2))).rejects.toThrow('No trading key');
  const c=await setup();const o3=await toConfirmed(c.t,c.owner);await c.t.run(async ctx=>{for(const g of await ctx.db.query('roleGrants').collect())await ctx.db.patch(g._id,{revokedAt:now});});
  await expect(c.t.mutation(m('claimSubmissionInternal'),claim(o3))).rejects.toThrow('Reviewer grant is no longer active');
 });
 it('keeps Live blocked by the emergency switch until a reviewer releases it with a reason',async()=>{
  const {t,owner}=await setup();await t.mutation(m('saveTradingKeyInternal'),{owner:OWNER,environment:'live',maskedKey:'••••LIVE',encryptedPayload:'{}'});
  const orderId=await toConfirmed(t,owner,draft({environment:'live'}));
  await expect(t.mutation(m('claimSubmissionInternal'),claim(orderId))).rejects.toThrow('emergency switch');
  const plain=t.withIdentity({subject:'user_other',tokenIdentifier:OTHER});await expect(plain.mutation(m('setLiveKillSwitch'),{engaged:false,reason:'try'})).rejects.toThrow('Reviewer role required');
  await owner.mutation(m('setLiveKillSwitch'),{engaged:false,reason:'Owner activation review completed'});
  expect(await t.mutation(m('claimSubmissionInternal'),claim(orderId))).toEqual({ok:true});
  await owner.mutation(m('setLiveKillSwitch'),{engaged:true,reason:'Emergency stop'});
  expect(((await owner.query(q('overview'),{})) as {liveKillSwitchEngaged:boolean}).liveKillSwitchEngaged).toBe(true);
 });
 it('claims a submission exactly once; replays and double clicks are refused',async()=>{
  const {t,owner}=await setup();const orderId=await toConfirmed(t,owner);
  expect(await t.mutation(m('claimSubmissionInternal'),claim(orderId))).toEqual({ok:true});
  await expect(t.mutation(m('claimSubmissionInternal'),claim(orderId))).rejects.toThrow('can be submitted only once');
  await expect(t.mutation(m('claimSubmissionInternal'),claim(orderId,{submissionId:'1f8fad5b-d9cb-469f-a165-70867728950e'}))).rejects.toThrow('only once');
  expect(await state(owner,orderId)).toBe('submitting');
 });
 it('returns a stale confirmation to approved instead of submitting it',async()=>{
  const {t,owner}=await setup();const orderId=await toConfirmed(t,owner);vi.setSystemTime(now+61_000);
  expect(await t.mutation(m('claimSubmissionInternal'),claim(orderId))).toMatchObject({ok:false});expect(await state(owner,orderId)).toBe('approved');
 });
});

describe('Broker outcomes and reconciliation (mocked results)',()=>{
 it('records acknowledgement, partial fill and fill from the broker as authority',async()=>{
  const {t,owner}=await setup();const orderId=await toConfirmed(t,owner);await t.mutation(m('claimSubmissionInternal'),claim(orderId));
  await t.mutation(m('recordSubmissionResultInternal'),{owner:OWNER,orderId,submissionId:claim(orderId).submissionId,resultJson:JSON.stringify({kind:'acknowledged',order:JSON.parse(brokerOrder())})});expect(await state(owner,orderId)).toBe('acknowledged');
  await t.mutation(m('recordBrokerStatusInternal'),{owner:OWNER,orderId,brokerOrderJson:brokerOrder({status:'PARTIALLY_FILLED',filledQuantity:0.05}),source:'test'});expect(await state(owner,orderId)).toBe('partially_filled');
  await expect(t.mutation(m('recordBrokerStatusInternal'),{owner:OWNER,orderId,brokerOrderJson:brokerOrder({id:999,status:'FILLED'}),source:'test'})).rejects.toThrow('does not match');
  await t.mutation(m('recordBrokerStatusInternal'),{owner:OWNER,orderId,brokerOrderJson:brokerOrder({status:'FILLED',filledQuantity:0.1,filledValue:15}),source:'test'});expect(await state(owner,orderId)).toBe('filled');
  await t.mutation(m('recordBrokerStatusInternal'),{owner:OWNER,orderId,brokerOrderJson:brokerOrder({status:'CANCELLED'}),source:'late'});expect(await state(owner,orderId)).toBe('filled');
 });
 it('records broker refusals as rejected and ambiguous responses as unknown, never submitting again',async()=>{
  const {t,owner}=await setup();const r=await toConfirmed(t,owner);await t.mutation(m('claimSubmissionInternal'),claim(r));
  await t.mutation(m('recordSubmissionResultInternal'),{owner:OWNER,orderId:r,submissionId:claim(r).submissionId,resultJson:JSON.stringify({kind:'rejected',code:'validation',httpStatus:400})});expect(await state(owner,r)).toBe('rejected');
  const u=await toConfirmed(t,owner);await t.mutation(m('claimSubmissionInternal'),claim(u));
  await t.mutation(m('recordSubmissionResultInternal'),{owner:OWNER,orderId:u,submissionId:claim(u).submissionId,resultJson:JSON.stringify({kind:'ambiguous',reason:'timeout',httpStatus:null})});expect(await state(owner,u)).toBe('unknown');
  await expect(t.mutation(m('claimSubmissionInternal'),claim(u))).rejects.toThrow('only once');
  await t.mutation(m('recordReconcileMissInternal'),{owner:OWNER,orderId:u,candidates:0});expect(await state(owner,u)).toBe('unknown');
  vi.setSystemTime(now+2*60_000);await t.mutation(m('recordReconcileMissInternal'),{owner:OWNER,orderId:u,candidates:0});expect(await state(owner,u)).toBe('unknown');
  vi.setSystemTime(now+6*60_000);await t.mutation(m('recordReconcileMissInternal'),{owner:OWNER,orderId:u,candidates:2});expect(await state(owner,u)).toBe('unknown');
  await t.mutation(m('recordReconcileMissInternal'),{owner:OWNER,orderId:u,candidates:0});expect(await state(owner,u)).toBe('not_placed');
 });
 it('turns an interrupted submission (claim without result) into unknown, never back into a submittable state',async()=>{
  const {t,owner}=await setup();const u=await toConfirmed(t,owner);await t.mutation(m('claimSubmissionInternal'),claim(u));
  vi.setSystemTime(now+45_000);await t.mutation(m('recordSubmissionResultInternal'),{owner:OWNER,orderId:u,submissionId:claim(u).submissionId,resultJson:JSON.stringify({kind:'ambiguous',reason:'interrupted_submission',httpStatus:null})});
  expect(await state(owner,u)).toBe('unknown');await expect(t.mutation(m('claimSubmissionInternal'),claim(u))).rejects.toThrow('only once');
  await expect(t.mutation(m('recordSubmissionResultInternal'),{owner:OWNER,orderId:u,submissionId:claim(u).submissionId,resultJson:JSON.stringify({kind:'acknowledged',order:JSON.parse(brokerOrder())})})).rejects.toThrow('No matching submission');
 });
 it('reconciles an unknown order to the single matching broker order',async()=>{
  const {t,owner}=await setup();const u=await toConfirmed(t,owner);await t.mutation(m('claimSubmissionInternal'),claim(u));
  await t.mutation(m('recordSubmissionResultInternal'),{owner:OWNER,orderId:u,submissionId:claim(u).submissionId,resultJson:JSON.stringify({kind:'ambiguous',reason:'transport',httpStatus:null})});
  await t.mutation(m('recordBrokerStatusInternal'),{owner:OWNER,orderId:u,brokerOrderJson:brokerOrder({status:'FILLED',filledQuantity:0.1}),source:'reconciliation'});expect(await state(owner,u)).toBe('filled');
  const events=await owner.query(q('orderEvents'),{orderId:u}) as {to:string}[];expect(events.map(e=>e.to)).toEqual(['draft','reviewed','approved','confirmed','submitting','unknown','filled']);
 });
});

describe('Trading keys, limits and ledger independence',()=>{
 it('stores a trading key only after explicit opt-in and never touches read-only connections',async()=>{
  const {t}=await setup({optIn:false,key:false});
  await expect(t.mutation(m('saveTradingKeyInternal'),{owner:OWNER,environment:'demo',maskedKey:'••••ABCD',encryptedPayload:'{}'})).rejects.toThrow('opt-in');
  const owner=t.withIdentity({subject:'user_owner',tokenIdentifier:OWNER});await expect(owner.mutation(m('recordOptIn'),{statement:'yes'})).rejects.toThrow('exact opt-in statement');
  await owner.mutation(m('recordOptIn'),{statement:OPT_IN_STATEMENT});await t.mutation(m('saveTradingKeyInternal'),{owner:OWNER,environment:'demo',maskedKey:'••••ABCD',encryptedPayload:'{}'});
  await t.run(async ctx=>{expect(await ctx.db.query('brokerConnections').collect()).toEqual([]);expect(await ctx.db.query('brokerCredentials').collect()).toEqual([]);expect(await ctx.db.query('tradingCredentials').collect()).toHaveLength(1);});
  const overview=await owner.query(q('overview'),{}) as {tradingKeys:Record<string,unknown>[]};expect(Object.keys(overview.tradingKeys[0]).sort()).toEqual(['createdAt','environment','maskedKey']);
  await owner.mutation(m('deleteTradingKey'),{environment:'demo'});await t.run(async ctx=>{expect(await ctx.db.query('tradingCredentials').collect()).toEqual([]);});
 });
 it('lets only a reviewer change limits, and not while an order is approved',async()=>{
  const {t,owner}=await setup();const limits=JSON.stringify({maxOrderValue:50,maxPositionExposurePct:20,maxDailyLoss:10,maxPriceAgeSeconds:60,fxFeeBps:15,allowedInstrumentTypes:['STOCK'],version:'v2'});
  await owner.mutation(m('updateLimits'),{limitsJson:limits});await toApproved(t,owner);await expect(owner.mutation(m('updateLimits'),{limitsJson:limits})).rejects.toThrow('outstanding');
  const plain=t.withIdentity({subject:'user_other',tokenIdentifier:OTHER});await expect(plain.mutation(m('updateLimits'),{limitsJson:limits})).rejects.toThrow('Reviewer role required');
 });
 it('never writes the internal paper ledger and exposes no broker calls from Convex',async()=>{
  const {t,owner}=await setup();const orderId=await toConfirmed(t,owner);await t.mutation(m('claimSubmissionInternal'),claim(orderId));
  await t.run(async ctx=>{for(const table of ['portfolios','proposals','fills','quotes'] as const)expect(await ctx.db.query(table).collect()).toEqual([]);});
  const src=readFileSync('convex/trading.ts','utf8');expect(src).not.toMatch(/fetch\(|trading212\.com|Trading212OrderClient/);
 });
});
