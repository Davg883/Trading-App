/**
 * Portfolio reporting calculations for the command centre (`portfolio-ui-001-v1`). Pure functions.
 *
 * Rules: deposits, withdrawals and transfers are external cash flows, never investment profit. Values are reported
 * only from broker observations; anything that cannot be reconciled is `unavailable` with a reason (never zero).
 * Charts use only stored valuation observations; no point is interpolated or back-filled from the latest balance.
 */
export const PORTFOLIO_UI_VERSION='portfolio-ui-001-v1' as const;
export type Value<T=number>={ok:true;value:T;source:string;observedAt:number|null}|{ok:false;reason:string};
const ok=<T>(value:T,source:string,observedAt:number|null):Value<T>=>({ok:true,value,source,observedAt});
const no=(reason:string):Value<never>=>({ok:false,reason});

export type Valuation={observedAt:number;currency:string;totalValue:number|null;cash:number|null;investedCost:number|null;investmentsValue:number|null;realisedProfitLoss:number|null;unrealisedProfitLoss:number|null};
export type CashFlow={reference:string;type:string;amount:number;currency:string;occurredAt:number};
export type Position={ticker:string;name:string;currency:string;quantity:number|null;currentPrice:number|null;averagePricePaid:number|null;valueAccount:number|null;costAccount:number|null;unrealisedAccount:number|null};
export type Snapshot={currency:string;totalValue:number|null;cash:number|null;investedCost:number|null;investmentsValue:number|null;realised:number|null;unrealised:number|null;summaryAt:number;positions:Position[]|null;positionsAt:number|null;source:string};

export const STALE_AFTER_MS=15*60_000;
export function freshness(observedAt:number|null,now:number){if(observedAt===null)return {state:'unavailable' as const,ageMs:null};const age=now-observedAt;return {state:age>STALE_AFTER_MS?'stale' as const:'fresh' as const,ageMs:age};}

/** Headline KPIs from the latest broker snapshot plus the stored valuation history. */
export function accountKpis(s:Snapshot|null,valuations:Valuation[],flows:CashFlow[],now:number,provider='Trading 212'){
 if(!s)return null;const src=`${provider} account summary`;
 const val=(v:number|null,label:string)=>v===null?no(`${label} not reported by the broker`):ok(v,src,s.summaryAt);
 const pnl=s.realised!==null&&s.unrealised!==null?ok(s.realised+s.unrealised,src,s.summaryAt):no('Realised or unrealised P/L not reported');
 const ret=!pnl.ok?no('P/L unavailable'):s.investedCost===null?no('Invested amount not reported'):s.investedCost<=0?no('Nothing invested yet, so there is no investment return'):ok(pnl.value/s.investedCost,`${src} (realised + unrealised P/L ÷ amount invested)`,s.summaryAt);
 return {currency:s.currency,totalValue:val(s.totalValue,'Total value'),cash:val(s.cash,'Available cash'),invested:val(s.investedCost,'Amount invested'),realised:val(s.realised,'Realised P/L'),unrealised:val(s.unrealised,'Unrealised P/L'),cumulativePnl:pnl,returnPct:ret,
  openPositions:s.positions===null?no('Positions not synchronised (run a full synchronisation)'):ok(s.positions.filter(p=>(p.quantity??0)>0).length,`${provider} positions`,s.positionsAt),
  todayPnl:todayInvestmentPnl(valuations,flows,s.currency,now),freshness:freshness(s.summaryAt,now)};
}

/** Today's investment P/L = change in value since the last valuation before today's UTC start, minus external flows since then. */
export function todayInvestmentPnl(valuations:Valuation[],flows:CashFlow[],currency:string,now:number):Value{
 const dayStart=Date.UTC(new Date(now).getUTCFullYear(),new Date(now).getUTCMonth(),new Date(now).getUTCDate());
 const usable=valuations.filter(v=>v.currency===currency&&v.totalValue!==null).sort((a,b)=>a.observedAt-b.observedAt);
 const before=[...usable].reverse().find(v=>v.observedAt<dayStart),latest=usable.at(-1);
 if(!before)return no('No valuation recorded before today, so today\'s change cannot be separated from earlier movement');
 if(!latest||latest.observedAt<dayStart)return no('No valuation recorded today');
 const f=flowsBetween(flows,currency,before.observedAt,latest.observedAt);if(!f.ok)return f;
 return ok(latest.totalValue!-before.totalValue!-f.value,'Change between stored valuations, net of deposits and withdrawals',latest.observedAt);
}
function flowsBetween(flows:CashFlow[],currency:string,from:number,to:number):Value{
 const inside=flows.filter(f=>f.occurredAt>from&&f.occurredAt<=to);if(inside.some(f=>f.currency!==currency))return no('A cash flow in another currency cannot be converted with a known compatible rate');
 return ok(inside.reduce((a,f)=>a+f.amount,0),'Trading 212 transactions',to);
}

export const WINDOWS=[{id:'1D',ms:86_400_000},{id:'1W',ms:7*86_400_000},{id:'1M',ms:30*86_400_000},{id:'3M',ms:91*86_400_000},{id:'1Y',ms:365*86_400_000},{id:'All',ms:Infinity}] as const;
export type WindowId=typeof WINDOWS[number]['id'];

/**
 * Time-weighted return over stored valuations: each sub-period return removes external flows that occurred inside it
 * (flows treated as occurring at the end of the sub-period). Also returns a modified-Dietz money-weighted return.
 */
export function performance(valuations:Valuation[],flows:CashFlow[],currency:string,window:WindowId,now:number){
 const span=WINDOWS.find(w=>w.id===window)!.ms,start=span===Infinity?-Infinity:now-span;
 const all=valuations.filter(v=>v.currency===currency&&v.totalValue!==null).sort((a,b)=>a.observedAt-b.observedAt);
 const base=[...all].reverse().find(v=>v.observedAt<=start),points=[...(base?[base]:[]),...all.filter(v=>v.observedAt>start&&v.observedAt<=now)];
 const meta={window,observations:points.length,startsAtWindowStart:Boolean(base)||span===Infinity};
 if(points.length<2)return {...meta,series:[] as {at:number;value:number;cumulativeTwr:number}[],twr:no('At least two stored valuations are needed; synchronise the account over time to build a history'),mwr:no('Not enough valuations'),flowsInWindow:0,reason:'insufficient_history' as const};
 let growth=1;const series=[{at:points[0].observedAt,value:points[0].totalValue!,cumulativeTwr:0}];
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],f=flowsBetween(flows,currency,a.observedAt,b.observedAt);
  if(!f.ok)return {...meta,series:[],twr:f,mwr:no(f.reason),flowsInWindow:0,reason:'incompatible_flow' as const};
  if(a.totalValue!<=0){const both=a.totalValue===0&&b.totalValue!-f.value===0;if(!both)return {...meta,series:[],twr:no('A period starting from a zero balance has no defined return'),mwr:no('Undefined'),flowsInWindow:0,reason:'zero_base' as const};}
  else growth*=(b.totalValue!-f.value)/a.totalValue!;
  series.push({at:b.observedAt,value:b.totalValue!,cumulativeTwr:growth-1});
 }
 const first=points[0],last=points.at(-1)!,inWindow=flows.filter(f=>f.currency===currency&&f.occurredAt>first.observedAt&&f.occurredAt<=last.observedAt),T=last.observedAt-first.observedAt;
 const netFlow=inWindow.reduce((a,f)=>a+f.amount,0),weighted=inWindow.reduce((a,f)=>a+f.amount*(T>0?(last.observedAt-f.occurredAt)/T:0),0),denom=first.totalValue!+weighted;
 const label=meta.startsAtWindowStart?'':' (since first stored valuation in this window)';
 return {...meta,series,twr:ok(growth-1,`Time-weighted return from stored valuations${label}`,last.observedAt),mwr:denom>0?ok((last.totalValue!-first.totalValue!-netFlow)/denom,`Modified Dietz money-weighted return${label}`,last.observedAt):no('Money-weighted return undefined for this cash-flow pattern'),flowsInWindow:inWindow.length,reason:null};
}

/** Benchmark GBP return between two instants using closes and GBP-per-unit FX observed at the same sessions. */
export type BenchmarkObservation={at:number;close:number;currency:string;gbpPerUnit:number|null};
export function benchmarkReturnGbp(obs:BenchmarkObservation[],from:number,to:number,toleranceMs=36*3600_000):Value{
 const near=(t:number)=>obs.filter(o=>Math.abs(o.at-t)<=toleranceMs).sort((a,b)=>Math.abs(a.at-t)-Math.abs(b.at-t))[0];
 const a=near(from),b=near(to);if(!a||!b)return no('No benchmark close within 36 hours of the portfolio\'s first and last valuations');
 if(a===b)return no('The window covers a single benchmark session');
 const fx=(o:BenchmarkObservation)=>o.currency==='GBP'?1:o.gbpPerUnit;const fa=fx(a),fb=fx(b);
 if(fa===null||fb===null)return no('No compatible GBP conversion rate for the benchmark sessions');
 return ok((b.close*fb)/(a.close*fa)-1,'Benchmark close × GBP rate at matching sessions',b.at);
}

export function maxDrawdown(series:{at:number;cumulativeTwr:number}[]):Value{
 if(series.length<2)return no('Needs at least two stored valuations');let peak=1,dd=0;for(const p of series){const g=1+p.cumulativeTwr;peak=Math.max(peak,g);dd=Math.min(dd,g/peak-1);}return ok(dd,'Time-weighted valuation path',series.at(-1)!.at);
}
export function concentration(positions:Position[]|null,totalValue:number|null):Value<{ticker:string;share:number}>{
 if(positions===null)return no('Positions not synchronised');const held=positions.filter(p=>(p.quantity??0)>0);if(!held.length)return no('No open positions');
 if(totalValue===null||totalValue<=0||held.some(p=>p.valueAccount===null))return no('Position values in the account currency are incomplete');
 const top=held.reduce((a,b)=>b.valueAccount!>a.valueAccount!?b:a);return ok({ticker:top.ticker,share:top.valueAccount!/totalValue},'Trading 212 positions',null);
}
/** Share of account value in instruments tagged as AI-sector by the registered research universe (ticker-prefix match). */
export function aiSectorExposure(positions:Position[]|null,totalValue:number|null,aiTickers:string[]):Value<{share:number;tickers:string[]}>{
 if(positions===null)return no('Positions not synchronised');const held=positions.filter(p=>(p.quantity??0)>0);if(!held.length)return no('No open positions');
 if(totalValue===null||totalValue<=0)return no('Account total value unavailable');
 const root=(t:string)=>t.split('_')[0].toUpperCase(),tagged=held.filter(p=>aiTickers.includes(root(p.ticker)));if(tagged.some(p=>p.valueAccount===null))return no('Some AI-sector position values are unavailable');
 return ok({share:tagged.reduce((a,p)=>a+p.valueAccount!,0)/totalValue,tickers:tagged.map(p=>p.ticker)},'Trading 212 positions × research universe tags',null);
}

/** Cash-flow events inside a window, for chart markers. These are external flows, not performance. */
export function flowEvents(flows:CashFlow[],currency:string,from:number,to:number){return flows.filter(f=>f.currency===currency&&f.occurredAt>=from&&f.occurredAt<=to).sort((a,b)=>a.occurredAt-b.occurredAt).map(f=>({at:f.occurredAt,amount:f.amount,type:f.type,reference:f.reference}));}

/**
 * Benchmark cumulative GBP return series aligned to a portfolio window. Uses only observations that have a close and a
 * known GBP rate; the base is the observation nearest the first portfolio valuation (within tolerance). Returns an
 * empty series with a reason instead of interpolating.
 */
export function benchmarkSeries(obs:BenchmarkObservation[],from:number,to:number,toleranceMs=36*3600_000):{points:{at:number;cumulativeReturn:number}[];reason:string|null}{
 const usable=obs.filter(o=>o.currency==='GBP'||o.gbpPerUnit!==null).sort((a,b)=>a.at-b.at);
 const base=usable.filter(o=>Math.abs(o.at-from)<=toleranceMs).sort((a,b)=>Math.abs(a.at-from)-Math.abs(b.at-from))[0];
 if(!base)return {points:[],reason:'No benchmark close with a known GBP rate near the start of this window'};
 const gbp=(o:BenchmarkObservation)=>o.close*(o.currency==='GBP'?1:o.gbpPerUnit!);
 const points=usable.filter(o=>o.at>=base.at&&o.at<=to+toleranceMs).map(o=>({at:o.at,cumulativeReturn:gbp(o)/gbp(base)-1}));
 return points.length<2?{points:[],reason:'Fewer than two benchmark observations overlap this window'}:{points,reason:null};
}
