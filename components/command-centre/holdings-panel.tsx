import Link from 'next/link';
import type {Position} from '../../lib/portfolio/performance';
import {DataBadge,iso,money,signedMoney,type DataClass} from './shared';

/** Owned positions only, from the broker. Daily movement is shown as unavailable because the broker reports none. */
export function HoldingsPanel({positions,accountCurrency,observedAt,stale,kind,provider='Trading 212'}:{positions:Position[]|null;accountCurrency:string;observedAt:number|null;stale:boolean;kind:Extract<DataClass,'live'|'demo'|'synthetic'>;provider?:string}){
 const held=(positions??[]).filter(p=>(p.quantity??0)>0);
 return <section className="cc-panel" aria-labelledby="holdings-title" data-testid="holdings-panel">
  <header className="cc-panel-head"><div><h2 id="holdings-title">Holdings</h2><p>Owned positions reported by {provider} · {iso(observedAt)}{stale?' · stale':''}</p></div><DataBadge kind={kind}/></header>
  {positions===null?<div className="cc-empty"><strong>Positions not synchronised</strong><p>Run a full synchronisation to load holdings.</p><Link className="cc-fix" href="/settings/brokers">Synchronise on Broker Connections →</Link></div>:
   held.length===0?<div className="cc-empty" data-testid="holdings-empty"><strong>No open positions</strong><p>Your account holds cash only. Nothing is shown as invested and no position returns are calculated.</p></div>:
   <div className="cc-table-wrap" tabIndex={0} aria-label="Holdings table, scrollable"><table className="cc-table"><caption className="cc-sr">Owned positions</caption><thead><tr><th scope="col">Instrument</th><th scope="col">Quantity</th><th scope="col">Current value</th><th scope="col">Average cost</th><th scope="col">Unrealised P/L</th><th scope="col">Daily move</th><th scope="col">Currency</th></tr></thead>
   <tbody>{held.map(p=><tr key={p.ticker}><th scope="row">{p.name}<small>{p.ticker} · owned</small></th><td>{p.quantity}</td><td>{p.valueAccount===null?'Unavailable':money(p.valueAccount,accountCurrency)}</td><td>{p.averagePricePaid===null?'Unavailable':`${p.averagePricePaid} ${p.currency}`}</td><td className={p.unrealisedAccount===null?'':p.unrealisedAccount>=0?'cc-up':'cc-down'}>{p.unrealisedAccount===null?'Unavailable':signedMoney(p.unrealisedAccount,accountCurrency)}</td><td title="Trading 212 does not report a prior close for positions">Unavailable</td><td>{p.currency}</td></tr>)}</tbody></table></div>}
  <p className="cc-note">Prices are {provider} position prices, not a complete market-data feed.</p>
 </section>;
}

export type WatchItem={
 ticker:string;
 name:string;
 close:number|null;
 closeGbp?:number|null;
 usdToGbp?:number|null;
 currency:string;
 closeAt:number|null;
 serverReceivedAt?:number|null;
 priceBasis?:string|null;
 corporateActionsReviewed?:boolean;
 declaredDelayMs?:number|null;
 source:string;
 signals:{label:string;kind:DataClass;detail:string}[];
};
/** Research-only instruments. Never shows quantities, values or returns, so they cannot be mistaken for holdings. */
export function WatchlistPanel({items,now,ownedTickers}:{items:WatchItem[];now:number;ownedTickers:string[]}){
 return <section className="cc-panel" aria-labelledby="watch-title" data-testid="watchlist-panel">
  <header className="cc-panel-head"><div><h2 id="watch-title">Research watchlist</h2><p>Not owned unless also listed under Holdings. No quantities, values or returns are shown here.</p></div><DataBadge kind="public_reference"/></header>
  <div className="cc-table-wrap" tabIndex={0} aria-label="Watchlist table, scrollable"><table className="cc-table"><caption className="cc-sr">Research watchlist</caption><thead><tr><th scope="col">Instrument</th><th scope="col">Last reference close</th><th scope="col">Price status</th><th scope="col">Research signals</th></tr></thead>
  <tbody>{items.map(w=>{const owned=ownedTickers.some(t=>t.split('_')[0]===w.ticker),age=w.closeAt===null?null:now-w.closeAt,status=w.close===null?'Unavailable':age!==null&&age>36*3600_000?'Stale':'Delayed';
   return <tr key={w.ticker} data-watch={w.ticker}><th scope="row">{w.name}<small>{w.ticker} · {owned?'also owned':'research only'}</small></th><td>{w.close===null?'Unavailable':`${w.close.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})} ${w.currency}`}{w.closeGbp!=null&&<small data-testid={`watch-gbp-${w.ticker}`}>£{w.closeGbp.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})} GBP{w.usdToGbp!=null?` (USD/GBP ${w.usdToGbp.toFixed(4)})`:''}</small>}<small>{iso(w.closeAt)}</small></td><td><span className={`cc-status cc-${status.toLowerCase()}`}>{status}</span><small>{w.source}{w.priceBasis?` · ${w.priceBasis}`:''}</small>{(w.close===null||!w.corporateActionsReviewed)&&<Link className="cc-fix" href="/policy-risk#sources">Check price evidence →</Link>}</td><td>{w.signals.length?w.signals.map(s=><span key={s.label} className="cc-signal" title={s.detail}>{s.label}<small>{s.kind==='retrospective'?'retrospective':s.kind}</small></span>):<small>No registered signal</small>}</td></tr>;})}</tbody></table></div>
 </section>;
}
