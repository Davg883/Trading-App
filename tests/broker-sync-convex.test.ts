import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';

const modules={'./_generated/server.ts':async()=>({}),'./brokers.ts':()=>import('../convex/brokers')};
const m=(n:string)=>makeFunctionReference<'mutation'>(`brokers:${n}`),q=(n:string)=>makeFunctionReference<'query'>(`brokers:${n}`);
const OWNER='https://issuer.test|user_owner',now=Date.parse('2026-11-06T16:00:00Z');
const envelope=JSON.stringify({version:'broker-vault-v1',keyVersion:'v1',iv:'AAAAAAAAAAAAAAAA',tag:'AAAAAAAAAAAAAAAAAAAAAA==',ciphertext:'AAAA'});
const base=(e:string)=>`https://${e}.trading212.com/api/v0`;
const snap=(e:'live'|'demo',at:number,total=250)=>JSON.stringify({scope:'sync',summary:{provider:'trading212',environment:e,sourceUrl:`${base(e)}/equity/account/summary`,retrievedAt:at,data:{accountId:'1',currency:'GBP',totalValue:total,cash:{availableToTrade:total,reservedForOrders:0,inPies:0},investments:{currentValue:0,totalCost:0,realizedProfitLoss:0,unrealizedProfitLoss:0}}},positions:{provider:'trading212',environment:e,sourceUrl:`${base(e)}/equity/positions`,retrievedAt:at,data:[]},transactions:null,historyErrorCode:null});
afterEach(()=>vi.useRealTimers());
function setup(){vi.useFakeTimers();vi.setSystemTime(now);const t=convexTest(schema,modules);return {t,owner:t.withIdentity({subject:'user_owner',tokenIdentifier:OWNER})};}
async function save(t:ReturnType<typeof setup>['t'],environment:'live'|'demo',maskedKey='••••FVft'){return (await t.mutation(m('saveInternal'),{owner:OWNER,environment,maskedKey,encryptedPayload:envelope}) as {connectionId:string}).connectionId;}
async function lease(t:ReturnType<typeof setup>['t'],connectionId:string,environment:'live'|'demo'){return await t.mutation(m('acquireSyncInternal'),{owner:OWNER,connectionId,environment,operation:'sync'}) as {ok:boolean;leaseToken:string;revision:number;code?:string;retryAfterAt?:number};}
const record=(t:ReturnType<typeof setup>['t'],id:string,e:'live'|'demo',l:{leaseToken:string;revision:number},extra:Record<string,unknown>)=>t.mutation(m('recordSyncInternal'),{owner:OWNER,connectionId:id,environment:e,leaseToken:l.leaseToken,revision:l.revision,...extra}) as Promise<{stored:boolean;errorCode?:string}>;
const advance=(ms:number)=>vi.setSystemTime(Date.now()+ms);

describe('Connection errors are classified distinctly',()=>{
 it('identifies an environment mismatch without ever using the key in the other environment',async()=>{
  const {t}=setup();const live=await save(t,'live'),l=await lease(t,live,'live');await record(t,live,'live',l,{snapshotJson:snap('live',now-1000)});
  const demo=await save(t,'demo'),d=await lease(t,demo,'demo');expect((await record(t,demo,'demo',d,{errorCode:'invalid_credentials'})).errorCode).toBe('environment_mismatch');
  const other=await save(t,'demo','••••ZZZZ');advance(61_000);const d2=await lease(t,other,'demo');expect((await record(t,other,'demo',d2,{errorCode:'invalid_credentials'})).errorCode).toBe('invalid_credentials');
 });
 it('identifies an expired or revoked key that previously worked',async()=>{
  const {t}=setup();const id=await save(t,'live');const l=await lease(t,id,'live');await record(t,id,'live',l,{snapshotJson:snap('live',now-1000)});
  advance(61_000);const l2=await lease(t,id,'live');expect((await record(t,id,'live',l2,{errorCode:'invalid_credentials'})).errorCode).toBe('credentials_revoked');
 });
});

describe('Rate limits, coordination and snapshot preservation',()=>{
 it('suppresses requests until the provider reset when a bucket is exhausted',async()=>{
  const {t}=setup();const id=await save(t,'live'),reset=now+10*60_000;const l=await lease(t,id,'live');
  await record(t,id,'live',l,{snapshotJson:snap('live',now-1000),rateLimitJson:JSON.stringify([{resource:'/equity/positions',limit:1,remaining:0,resetAt:reset,periodSeconds:600,used:1,observedAt:now}])});
  advance(5*60_000);expect(await lease(t,id,'live')).toMatchObject({ok:false,code:'rate_limited',retryAfterAt:reset});
  advance(5*60_000+1);expect((await lease(t,id,'live')).ok).toBe(true);
 });
 it('lets only one tab or server hold the sync lease at a time',async()=>{
  const {t}=setup();const id=await save(t,'live');const [a,b]=await Promise.all([lease(t,id,'live'),lease(t,id,'live')]);
  expect([a.ok,b.ok].sort()).toEqual([false,true]);expect([a,b].find(x=>!x.ok)!.code).toMatch(/sync_in_progress|rate_limited/);
 });
 it('keeps the last successful snapshot visible when a later sync fails',async()=>{
  const {t,owner}=setup();const id=await save(t,'live');const l=await lease(t,id,'live');await record(t,id,'live',l,{snapshotJson:snap('live',now-1000,250)});
  advance(61_000);const l2=await lease(t,id,'live');await record(t,id,'live',l2,{errorCode:'timeout'});
  const d=await owner.query(q('detail'),{connectionId:id}) as {status:string;lastErrorCode:string;snapshot:{summary:{data:{totalValue:number}}}};
  expect(d.status).toBe('error');expect(d.lastErrorCode).toBe('timeout');expect(d.snapshot.summary.data.totalValue).toBe(250);
 });
});

describe('Owner opt-in schedules',()=>{
 it('requires an owner and a saved connection, and can be disabled',async()=>{
  const {t,owner}=setup();await expect(t.mutation(m('setAutoSync'),{environment:'live',enabled:true,intervalMinutes:15})).rejects.toThrow('Sign in required');
  await expect(owner.mutation(m('setAutoSync'),{environment:'live',enabled:true,intervalMinutes:15})).rejects.toThrow('Save a read-only connection');
  await save(t,'live');await expect(t.withIdentity({subject:'m',tokenIdentifier:OWNER,actorType:'model'}).mutation(m('setAutoSync'),{environment:'live',enabled:true,intervalMinutes:15})).rejects.toThrow('Only the account owner');
  await expect(owner.mutation(m('setAutoSync'),{environment:'live',enabled:true,intervalMinutes:1})).rejects.toThrow('Interval');
  await owner.mutation(m('setAutoSync'),{environment:'live',enabled:true,intervalMinutes:15});expect(await t.mutation(m('claimDueInternal'),{limit:5})).toHaveLength(1);
  await owner.mutation(m('setAutoSync'),{environment:'live',enabled:false,intervalMinutes:15});advance(3*60_000);expect(await t.mutation(m('claimDueInternal'),{limit:5})).toHaveLength(0);
 });
 it('claims each due schedule once and pauses on credential errors until the owner re-saves',async()=>{
  const {t,owner}=setup();await save(t,'live');await owner.mutation(m('setAutoSync'),{environment:'live',enabled:true,intervalMinutes:15});
  expect(await t.mutation(m('claimDueInternal'),{owner:OWNER,limit:2})).toHaveLength(1);expect(await t.mutation(m('claimDueInternal'),{owner:OWNER,limit:2})).toHaveLength(0);
  await t.mutation(m('recordScheduledOutcomeInternal'),{owner:OWNER,environment:'live',outcome:'failed',errorCode:'credentials_revoked'});
  advance(24*3600_000);expect(await t.mutation(m('claimDueInternal'),{limit:5})).toHaveLength(0);
  expect(((await owner.query(q('schedules'),{})) as {pausedReason:string}[])[0].pausedReason).toBe('credentials_revoked');
  await save(t,'live');expect(await t.mutation(m('claimDueInternal'),{limit:5})).toHaveLength(1);
 });
 it('backs off after temporary failures',async()=>{
  const {t,owner}=setup();await save(t,'live');await owner.mutation(m('setAutoSync'),{environment:'live',enabled:true,intervalMinutes:15});await t.mutation(m('claimDueInternal'),{limit:5});
  await t.mutation(m('recordScheduledOutcomeInternal'),{owner:OWNER,environment:'live',outcome:'failed',errorCode:'timeout'});
  const s=((await owner.query(q('schedules'),{})) as {nextRunAt:number;consecutiveFailures:number}[])[0];expect(s.consecutiveFailures).toBe(1);expect(Math.abs(s.nextRunAt-(now+30*60_000))).toBeLessThan(50);
 });
});

describe('Security boundaries',()=>{
 it('adds no order, cancellation, withdrawal or transfer capability to the broker sync path',()=>{
  const src=['lib/brokers/trading212.ts','lib/brokers/server.ts','convex/brokers.ts','components/broker-sync-status.tsx','components/broker-sync-panel.tsx'].map(f=>readFileSync(f,'utf8')).join('\n');
  expect(src).not.toMatch(/equity\/orders|\/withdraw|\/transfer/);
  expect([...readFileSync('lib/brokers/trading212.ts','utf8').matchAll(/method:'([A-Z]+)'/g)].map(x=>x[1])).toEqual(['GET']);
 });
});
