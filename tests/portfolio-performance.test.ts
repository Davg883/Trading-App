import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';
import {accountKpis,performance,todayInvestmentPnl,benchmarkReturnGbp,benchmarkSeries,flowEvents,maxDrawdown,concentration,aiSectorExposure,freshness,type Valuation,type CashFlow,type Snapshot,type Position} from '../lib/portfolio/performance';

const DAY=86_400_000,now=Date.parse('2026-11-06T15:00:00Z');
const v=(daysAgo:number,total:number|null,currency='GBP'):Valuation=>({observedAt:now-daysAgo*DAY,currency,totalValue:total,cash:null,investedCost:null,investmentsValue:null,realisedProfitLoss:null,unrealisedProfitLoss:null});
const flow=(daysAgo:number,amount:number,type='DEPOSIT',currency='GBP'):CashFlow=>({reference:`${type}-${daysAgo}`,type,amount,currency,occurredAt:now-daysAgo*DAY});
const snap=(o:Partial<Snapshot>={}):Snapshot=>({currency:'GBP',totalValue:250,cash:250,investedCost:0,investmentsValue:0,realised:0,unrealised:0,summaryAt:now-60_000,positions:[],positionsAt:now-60_000,source:'test',...o});
const pos=(o:Partial<Position>={}):Position=>({ticker:'NVDA_US_EQ',name:'NVIDIA',currency:'USD',quantity:1,currentPrice:200,averagePricePaid:180,valueAccount:150,costAccount:135,unrealisedAccount:15,...o});

describe('Deposits are never investment profit',()=>{
 it('reports zero time-weighted return when the only change is a deposit',()=>{
  const p=performance([v(10,100),v(1,350)],[flow(5,250)],'GBP','All',now);
  expect(p.twr.ok&&p.twr.value).toBeCloseTo(0,12);expect(p.mwr.ok&&p.mwr.value).toBeCloseTo(0,12);
 });
 it('removes deposits and withdrawals from today\'s P/L',()=>{
  const r=todayInvestmentPnl([v(1,250),v(0.1,510)],[flow(0.2,250)],'GBP',now);expect(r.ok&&r.value).toBeCloseTo(10,12);
  const w=todayInvestmentPnl([v(1,250),v(0.1,200)],[flow(0.2,-50,'WITHDRAW')],'GBP',now);expect(w.ok&&w.value).toBeCloseTo(0,12);
 });
 it('uses broker P/L fields, not value minus deposits, for cumulative P/L and return',()=>{
  const k=accountKpis(snap({totalValue:250,investedCost:0,realised:0,unrealised:0}),[],[flow(7,250)],now)!;
  expect(k.cumulativePnl.ok&&k.cumulativePnl.value).toBe(0);expect(k.returnPct.ok).toBe(false);expect(!k.returnPct.ok&&k.returnPct.reason).toMatch(/Nothing invested/);
 });
});

describe('Empty, stale and unreconciled states',()=>{
 it('shows no historical return for an account with a single valuation (the live £250 cash account)',()=>{
  const p=performance([v(0.01,250)],[flow(7,250)],'GBP','All',now);expect(p.series).toEqual([]);expect(p.twr.ok).toBe(false);expect(p.reason).toBe('insufficient_history');
  const k=accountKpis(snap(),[v(0.01,250)],[],now)!;expect(k.todayPnl.ok).toBe(false);expect(k.openPositions.ok&&k.openPositions.value).toBe(0);
 });
 it('marks unavailable values instead of zero when the broker omits them',()=>{
  const k=accountKpis(snap({totalValue:null,realised:null}),[],[],now)!;expect(k.totalValue.ok).toBe(false);expect(k.cumulativePnl.ok).toBe(false);
  expect(accountKpis(snap({positions:null}),[],[],now)!.openPositions.ok).toBe(false);expect(accountKpis(null,[],[],now)).toBeNull();
 });
 it('identifies stale account data',()=>{expect(freshness(now-16*60_000,now).state).toBe('stale');expect(freshness(now-60_000,now).state).toBe('fresh');expect(freshness(null,now).state).toBe('unavailable');});
 it('does not invent chart points: every plotted point is a stored valuation, with the last one before the window as its baseline',()=>{
  const vals=[v(40,250),v(20,260),v(5,255),v(1,270)],p=performance(vals,[],'GBP','1M',now);
  expect(p.series.map(s=>s.at)).toEqual(vals.map(x=>x.observedAt));expect(p.startsAtWindowStart).toBe(true);
  expect(performance(vals,[],'GBP','1W',now).series.map(s=>s.at)).toEqual([vals[1],vals[2],vals[3]].map(x=>x.observedAt));
  expect(performance([v(5,255),v(1,270)],[],'GBP','1M',now).startsAtWindowStart).toBe(false);
  for(const w of ['1D','1W','1M','3M','1Y','All'] as const)expect(performance(vals,[],'GBP',w,now).series.every(s=>vals.some(x=>x.observedAt===s.at&&x.totalValue===s.value))).toBe(true);
 });
 it('refuses cash flows or valuations in another currency rather than converting at an unknown rate',()=>{
  expect(performance([v(10,100),v(1,120)],[flow(5,10,'DEPOSIT','USD')],'GBP','All',now).twr.ok).toBe(false);
  expect(performance([v(10,100,'USD'),v(1,120,'USD')],[],'GBP','All',now).series).toEqual([]);
 });
});

describe('GBP benchmark and risk widgets',()=>{
 it('computes a GBP benchmark return only with matching closes and known FX',()=>{
  const obs=[{at:now-10*DAY,close:100,currency:'USD',gbpPerUnit:0.8},{at:now-DAY,close:110,currency:'USD',gbpPerUnit:0.75}];
  const r=benchmarkReturnGbp(obs,now-10*DAY,now-DAY);expect(r.ok&&r.value).toBeCloseTo((110*0.75)/(100*0.8)-1,12);
  expect(benchmarkReturnGbp([{...obs[0],gbpPerUnit:null},obs[1]],now-10*DAY,now-DAY).ok).toBe(false);
  expect(benchmarkReturnGbp(obs,now-30*DAY,now-DAY).ok).toBe(false);
 });
 it('computes drawdown, concentration and AI exposure from broker values only',()=>{
  const p=performance([v(3,100),v(2,120),v(1,90)],[],'GBP','All',now);expect(maxDrawdown(p.series).ok&&(maxDrawdown(p.series) as {value:number}).value).toBeCloseTo(-0.25,12);
  expect(concentration([pos(),pos({ticker:'VUSA_EQ',valueAccount:50})],250)).toMatchObject({ok:true,value:{ticker:'NVDA_US_EQ',share:0.6}});
  expect(concentration([],250).ok).toBe(false);expect(concentration([pos({valueAccount:null})],250).ok).toBe(false);
  expect(aiSectorExposure([pos(),pos({ticker:'VUSA_EQ',valueAccount:50})],250,['NVDA'])).toMatchObject({ok:true,value:{share:0.6,tickers:['NVDA_US_EQ']}});
 });
});

describe('Chart markers and benchmark preparation',()=>{
 it('lists cash-flow events inside the window only, as external flows',()=>{
  const e=flowEvents([flow(20,100),flow(5,250),flow(2,-50,'WITHDRAW'),flow(1,10,'DEPOSIT','USD')],'GBP',now-10*DAY,now);
  expect(e.map(x=>[x.type,x.amount])).toEqual([['DEPOSIT',250],['WITHDRAW',-50]]);
 });
 it('builds a benchmark GBP series only from observations with known FX, without interpolation',()=>{
  const obs=[{at:now-10*DAY,close:100,currency:'USD',gbpPerUnit:0.8},{at:now-9*DAY,close:104,currency:'USD',gbpPerUnit:null},{at:now-8*DAY,close:105,currency:'USD',gbpPerUnit:0.8},{at:now-DAY,close:110,currency:'USD',gbpPerUnit:0.75}];
  const s=benchmarkSeries(obs,now-10*DAY,now-DAY);expect(s.reason).toBeNull();expect(s.points.map(p=>p.at)).toEqual([obs[0].at,obs[2].at,obs[3].at]);
  expect(s.points.at(-1)!.cumulativeReturn).toBeCloseTo((110*0.75)/(100*0.8)-1,12);
  expect(benchmarkSeries(obs,now-30*DAY,now-20*DAY).points).toEqual([]);expect(benchmarkSeries(obs,now-30*DAY,now-20*DAY).reason).toMatch(/No benchmark close/);
 });
});

describe('Valuation history is append-only and owner-scoped',()=>{
 it('records each sync valuation and classifies deposits as external cash flows, once',async()=>{
  const t=convexTest(schema,{'./_generated/server.ts':async()=>({}),'./brokers.ts':()=>import('../convex/brokers'),'./portfolio.ts':()=>import('../convex/portfolio')});
  const OWNER='https://issuer.test|user_owner',owner=t.withIdentity({subject:'user_owner',tokenIdentifier:OWNER});
  const envelope=JSON.stringify({version:'broker-vault-v1',keyVersion:'v1',iv:'AAAAAAAAAAAAAAAA',tag:'AAAAAAAAAAAAAAAAAAAAAA==',ciphertext:'AAAA'});
  const {connectionId}=await t.mutation(makeFunctionReference<'mutation'>('brokers:saveInternal'),{owner:OWNER,environment:'live',maskedKey:'••••TEST',encryptedPayload:envelope}) as {connectionId:string};
  const base='https://live.trading212.com/api/v0';
  for(const round of [1,2]){
   const lease=await t.mutation(makeFunctionReference<'mutation'>('brokers:acquireSyncInternal'),{owner:OWNER,connectionId,environment:'live',operation:'sync'}) as {leaseToken:string;revision:number};
   const at=Date.now()-1000;
   const snapshot={scope:'sync',summary:{provider:'trading212',environment:'live',sourceUrl:`${base}/equity/account/summary`,retrievedAt:at,data:{accountId:'1',currency:'GBP',totalValue:250,cash:{availableToTrade:250,reservedForOrders:0,inPies:0},investments:{currentValue:0,totalCost:0,realizedProfitLoss:0,unrealizedProfitLoss:0}}},positions:{provider:'trading212',environment:'live',sourceUrl:`${base}/equity/positions`,retrievedAt:at,data:[]},transactions:{provider:'trading212',environment:'live',sourceUrl:`${base}/equity/history/transactions`,retrievedAt:at,data:{items:[{reference:'dep-1',type:'DEPOSIT',dateTime:'2026-10-30T19:34:48.752Z',amount:250,currency:'GBP'}],nextCursor:null,truncated:false}},historyErrorCode:null};
   await t.mutation(makeFunctionReference<'mutation'>('brokers:recordSyncInternal'),{owner:OWNER,connectionId,environment:'live',leaseToken:lease.leaseToken,revision:lease.revision,snapshotJson:JSON.stringify(snapshot)});
   await t.run(async ctx=>{const c=await ctx.db.get(connectionId as never) as {_id:string}|null;if(c)await ctx.db.patch(c._id as never,{nextAllowedAt:0} as never);});
   expect(round).toBeGreaterThan(0);
  }
  const data=await owner.query(makeFunctionReference<'query'>('portfolio:overview'),{}) as {live:{valuations:unknown[];flows:{type:string;amount:number}[];snapshot:unknown};demo:{valuations:unknown[]}};
  expect(data.live.valuations).toHaveLength(2);expect(data.live.flows).toEqual([expect.objectContaining({type:'DEPOSIT',amount:250})]);expect(data.demo.valuations).toEqual([]);
  expect(JSON.stringify(data)).not.toMatch(/encryptedPayload|ciphertext|leaseToken/);
  await expect(t.query(makeFunctionReference<'query'>('portfolio:overview'),{})).rejects.toThrow('Sign in required');
  const other=t.withIdentity({subject:'user_other',tokenIdentifier:'https://issuer.test|user_other'});expect(((await other.query(makeFunctionReference<'query'>('portfolio:overview'),{})) as {live:{valuations:unknown[]}}).live.valuations).toEqual([]);
 });
 it('keeps the redesign display-only: no trading permission is changed by the homepage',()=>{
  const files=['app/page.tsx','components/command-centre/command-centre.tsx','components/command-centre/risk-panel.tsx','integrations/connected-command-centre.tsx'].map(f=>readFileSync(f,'utf8')).join('\n');
  expect(files).not.toMatch(/useMutation|setLiveKillSwitch|LIVE_TRADING_ENABLED\s*=(?!=)|DEMO_TRADING_ENABLED\s*=(?!=)|api\/trading/);
 });
});
