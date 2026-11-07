import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import type {GenericId} from 'convex/values';
import {describe,it,expect} from 'vitest';
import schema from '../convex/schema';
import {BROKER_BASE_URLS,type BrokerSyncSnapshot} from '../lib/brokers/contracts';

const modules={'./_generated/server.ts':async()=>({}),'./brokers.ts':()=>import('../convex/brokers')};
const mutation=(name:string)=>makeFunctionReference<'mutation'>(`brokers:${name}`);
const query=(name:string)=>makeFunctionReference<'query'>(`brokers:${name}`);
const owner='test|alice';
const payload=JSON.stringify({version:'broker-vault-v1',keyVersion:'v1',iv:'AAAAAAAAAAAAAAAA',tag:'AAAAAAAAAAAAAAAAAAAAAA==',ciphertext:'QUJDREVGRw=='});
function setup(){const t=convexTest(schema,modules);return {t,alice:t.withIdentity({subject:'alice',tokenIdentifier:owner}),bob:t.withIdentity({subject:'bob',tokenIdentifier:'test|bob'})};}
async function saved(environment:'demo'|'live'='demo'){const all=setup();const result=await all.t.mutation(mutation('saveInternal'),{owner,environment,maskedKey:'••••1234',encryptedPayload:payload}) as {connectionId:GenericId<'brokerConnections'>;revision:number};return {...all,...result,environment};}
function snapshot(environment:'demo'|'live'='demo',scope:'test'|'sync'='sync'):BrokerSyncSnapshot{
  const base={provider:'trading212' as const,environment,retrievedAt:Date.now()-10};
  return {scope,summary:{...base,sourceUrl:BROKER_BASE_URLS[environment]+'/equity/account/summary',data:{accountId:'demo-account',currency:'GBP',totalValue:1000,cash:{availableToTrade:100,reservedForOrders:0,inPies:0},investments:{currentValue:900,totalCost:850,realizedProfitLoss:0,unrealizedProfitLoss:50}}},positions:scope==='test'?null:{...base,sourceUrl:BROKER_BASE_URLS[environment]+'/equity/positions',data:[{instrument:{ticker:'TEST_US_EQ',name:'Mock holding',currency:'USD',isin:null},quantity:2,currentPrice:100,averagePricePaid:95,quantityAvailableForTrading:2,quantityInPies:0,walletImpact:{currency:'GBP',currentValue:160,totalCost:150,unrealizedProfitLoss:10,fxImpact:0}}]},transactions:null,historyErrorCode:null};
}
describe('encrypted broker persistence and read-only isolation',()=>{
  it('authenticates browser reads and never returns ciphertext, credentials or lease tokens',async()=>{
    const {t,alice,connectionId}=await saved();
    await expect(t.query(query('list'),{})).rejects.toThrow('Sign in required');
    expect(await alice.query(query('viewer'),{})).toEqual({owner});
    const rows=await alice.query(query('list'),{}),detail=await alice.query(query('detail'),{connectionId});
    expect(rows).toHaveLength(1);expect(detail.maskedKey).toBe('••••1234');expect(detail.readOnly).toBe(true);
    const serialized=JSON.stringify({rows,detail});for(const value of ['encryptedPayload','ciphertext','apiSecret','apiKey','leaseToken','QUJDREVGRw=='])expect(serialized).not.toContain(value);
    const backend=await import('../convex/brokers');for(const name of ['saveInternal','getVaultInternal','acquireSyncInternal','recordSyncInternal','deleteInternal'] as const)expect(backend[name].isInternal).toBe(true);
  });
  it('user A cannot inspect user B connections or use demo credentials as live',async()=>{
    const {t,bob,connectionId}=await saved();expect(await bob.query(query('list'),{})).toEqual([]);await expect(bob.query(query('detail'),{connectionId})).rejects.toThrow('Connection unavailable');
    await expect(t.query(query('getVaultInternal'),{owner:'test|bob',connectionId,environment:'demo'})).rejects.toThrow('Connection unavailable');
    await expect(t.query(query('getVaultInternal'),{owner,connectionId,environment:'live'})).rejects.toThrow('Connection unavailable');
    await expect(t.mutation(mutation('acquireSyncInternal'),{owner,connectionId,environment:'live',operation:'sync'})).rejects.toThrow('Connection unavailable');
  });
  it('rejects plaintext envelopes and unmasked key identifiers with static errors',async()=>{
    const {t}=setup();const args={owner,environment:'demo' as const,maskedKey:'••••1234',encryptedPayload:JSON.stringify({apiKey:'not-a-real-key',apiSecret:'not-a-real-secret'})};
    await expect(t.mutation(mutation('saveInternal'),args)).rejects.toThrow('Invalid encrypted credential envelope');
    await expect(t.mutation(mutation('saveInternal'),{...args,encryptedPayload:payload,maskedKey:'not-a-real-key'})).rejects.toThrow('Masked key identifier required');
  });
  it('stores separately labelled read-only snapshots without touching the paper ledger',async()=>{
    const {t,alice,connectionId}=await saved();const lease=await t.mutation(mutation('acquireSyncInternal'),{owner,connectionId,environment:'demo',operation:'sync'});expect(lease.ok).toBe(true);
    const result=await t.mutation(mutation('recordSyncInternal'),{owner,connectionId,environment:'demo',leaseToken:lease.leaseToken,revision:lease.revision,snapshotJson:JSON.stringify(snapshot())});expect(result.stored).toBe(true);
    const detail=await alice.query(query('detail'),{connectionId});expect(detail.status).toBe('connected');expect(detail.lastSuccessfulSyncAt).not.toBeNull();expect(detail.snapshot.summary.environment).toBe('demo');expect(detail.snapshot.positions.data[0].instrument.ticker).toBe('TEST_US_EQ');
    await t.run(async ctx=>{expect(await ctx.db.query('fills').collect()).toEqual([]);expect(await ctx.db.query('quotes').collect()).toEqual([]);expect(await ctx.db.query('portfolios').collect()).toEqual([]);});
  });
  it('serializes sync attempts and preserves provider backoff after failed verification',async()=>{
    const {t,alice,connectionId}=await saved();const lease=await t.mutation(mutation('acquireSyncInternal'),{owner,connectionId,environment:'demo',operation:'test'});
    expect((await t.mutation(mutation('acquireSyncInternal'),{owner,connectionId,environment:'demo',operation:'sync'})).code).toBe('sync_in_progress');
    const retryAfterAt=Date.now()+300000;await t.mutation(mutation('recordSyncInternal'),{owner,connectionId,environment:'demo',leaseToken:lease.leaseToken,revision:lease.revision,errorCode:'rate_limited',retryAfterAt});
    const blocked=await t.mutation(mutation('acquireSyncInternal'),{owner,connectionId,environment:'demo',operation:'test'});expect(blocked.ok).toBe(false);expect(blocked.code).toBe('rate_limited');expect(blocked.retryAfterAt).toBe(retryAfterAt);
    const detail=await alice.query(query('detail'),{connectionId});expect(detail.lastErrorCode).toBe('rate_limited');expect(detail.lastSuccessfulSyncAt).toBeNull();
  });
  it('credential replacement invalidates in-flight results and clears prior account data',async()=>{
    const {t,alice,connectionId}=await saved();const lease=await t.mutation(mutation('acquireSyncInternal'),{owner,connectionId,environment:'demo',operation:'sync'});
    const replacement=await t.mutation(mutation('saveInternal'),{owner,environment:'demo',maskedKey:'••••5678',encryptedPayload:payload});expect(replacement.connectionId).toBe(connectionId);expect(replacement.revision).toBe(2);
    expect((await t.mutation(mutation('recordSyncInternal'),{owner,connectionId,environment:'demo',leaseToken:lease.leaseToken,revision:lease.revision,snapshotJson:JSON.stringify(snapshot())})).stored).toBe(false);
    const detail=await alice.query(query('detail'),{connectionId});expect(detail.maskedKey).toBe('••••5678');expect(detail.snapshot).toBeNull();expect(detail.status).toBe('saved');
  });
  it('deletion erases the vault and account snapshots and late sync cannot recreate them',async()=>{
    const {t,alice,connectionId}=await saved();const lease=await t.mutation(mutation('acquireSyncInternal'),{owner,connectionId,environment:'demo',operation:'sync'});
    expect(await t.mutation(mutation('deleteInternal'),{owner,connectionId,environment:'demo'})).toEqual({deleted:true,providerRevocationRequired:true});
    expect((await t.mutation(mutation('recordSyncInternal'),{owner,connectionId,environment:'demo',leaseToken:lease.leaseToken,revision:lease.revision,snapshotJson:JSON.stringify(snapshot())})).stored).toBe(false);
    expect(await alice.query(query('list'),{})).toEqual([]);await t.run(async ctx=>{expect(await ctx.db.query('brokerCredentials').collect()).toEqual([]);expect(await ctx.db.query('brokerSnapshots').collect()).toEqual([]);});
  });
  it('rejects order-endpoint provenance and mismatched environment observations',async()=>{
    const {t,connectionId}=await saved();const lease=await t.mutation(mutation('acquireSyncInternal'),{owner,connectionId,environment:'demo',operation:'sync'});
    const invalid=snapshot();invalid.summary.sourceUrl=BROKER_BASE_URLS.demo+'/equity/orders';await expect(t.mutation(mutation('recordSyncInternal'),{owner,connectionId,environment:'demo',leaseToken:lease.leaseToken,revision:lease.revision,snapshotJson:JSON.stringify(invalid)})).rejects.toThrow('Invalid sanitized broker snapshot');
    await expect(t.mutation(mutation('recordSyncInternal'),{owner,connectionId,environment:'demo',leaseToken:lease.leaseToken,revision:lease.revision,snapshotJson:JSON.stringify(snapshot('live'))})).rejects.toThrow('Snapshot environment');
  });
  it('testing a connection preserves earlier holdings and does not invent a new full sync',async()=>{
    const {t,alice,connectionId}=await saved();const sync=await t.mutation(mutation('acquireSyncInternal'),{owner,connectionId,environment:'demo',operation:'sync'});
    await t.mutation(mutation('recordSyncInternal'),{owner,connectionId,environment:'demo',leaseToken:sync.leaseToken,revision:sync.revision,snapshotJson:JSON.stringify(snapshot())});const previous=await alice.query(query('detail'),{connectionId});
    await t.run(async ctx=>{await ctx.db.patch(connectionId,{nextAllowedAt:0});});const test=await t.mutation(mutation('acquireSyncInternal'),{owner,connectionId,environment:'demo',operation:'test'});const current=snapshot('demo','test');current.summary.data.cash.availableToTrade=120;
    await t.mutation(mutation('recordSyncInternal'),{owner,connectionId,environment:'demo',leaseToken:test.leaseToken,revision:test.revision,snapshotJson:JSON.stringify(current)});const detail=await alice.query(query('detail'),{connectionId});expect(detail.lastSuccessfulSyncAt).toBe(previous.lastSuccessfulSyncAt);expect(detail.lastVerifiedAt).not.toBeNull();expect(detail.snapshot.positions.data).toEqual(previous.snapshot.positions.data);expect(detail.snapshot.summary.data.cash.availableToTrade).toBe(120);
  });
});
