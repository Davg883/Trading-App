'use client';
import {ClerkProvider,SignInButton,UserButton,useAuth} from '@clerk/nextjs';
import {ConvexProviderWithClerk} from 'convex/react-clerk';
import {Authenticated,Unauthenticated,AuthLoading,ConvexReactClient,useQuery,useMutation} from 'convex/react';
import {makeFunctionReference} from 'convex/server';
import {useEffect,useState} from 'react';
import {useConvexClerkAuth} from '../lib/clerk-convex-auth';
import type {RiskLimits} from '../lib/trading/order-model';

type Order={orderId:string;state:string;environment:'demo'|'live';ticker:string;draft:{side:string;quantity:number;type:string;limitPrice:number|null;stopPrice:number|null;timeValidity:string|null;thesis:string;counterevidence:string};risk:null|{passed:boolean;reasons:string[];estimate:{grossValue:number|null;fxCost:number;estimatedValue:number|null;accountCurrency:string|null};account?:{cashAvailable:number|null;totalValue:number|null;syncedAt:number}};priceReference:null|{price:number;priceCurrency:string;observedAt:number;sourceDetail:string};reviewNote:string|null;brokerOrderId:number|null;brokerStatus:string|null;filledQuantity:number|null;filledValue:number|null;reconcileChecks:number;lastReconciledAt:number|null;updatedAt:number};
type Overview={limits:RiskLimits;liveKillSwitchEngaged:boolean;optedInAt:number|null;optInStatement:string;reviewer:boolean;tradingKeys:{environment:string;maskedKey:string;createdAt:number}[];orders:Order[]};
const overviewRef=makeFunctionReference<'query',Record<string,never>,Overview>('trading:overview');
const eventsRef=makeFunctionReference<'query',{orderId:string},{from:string;to:string;actor:string;detail:string;at:number}[]>('trading:orderEvents');
const ref=(n:string)=>makeFunctionReference<'mutation'>(`trading:${n}`);
const iso=(t:number|null|undefined)=>t?new Date(t).toISOString().replace('.000Z','Z'):'—';
const money=(v:number|null|undefined,c?:string|null)=>v==null?'Unavailable':`${c??''} ${v.toFixed(2)}`.trim();
async function api(body:Record<string,unknown>){const r=await fetch('/api/trading',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json().catch(()=>({message:'Unreadable response'}));if(!r.ok)throw new Error(j.message??`Request failed (${r.status})`);return j;}

export default function ConnectedTrading({flags}:{flags:{demo:boolean;live:boolean}}){const[client]=useState(()=>new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!));return <ClerkProvider><ConvexProviderWithClerk client={client} useAuth={useConvexClerkAuth}><AuthLoading><p>Checking your session…</p></AuthLoading><Unauthenticated><p>Sign in to manage proposals, approvals and confirmations.</p><SignInButton mode="modal"><button className="button primary">Sign in</button></SignInButton></Unauthenticated><Authenticated><UserButton/><Workspace flags={flags}/></Authenticated></ConvexProviderWithClerk></ClerkProvider>;}

function Workspace({flags}:{flags:{demo:boolean;live:boolean}}){
 const data=useQuery(overviewRef,{}),kill=useMutation(ref('setLiveKillSwitch')),[environment,setEnvironment]=useState<'demo'|'live'>('demo'),[message,setMessage]=useState('');
 const run=async(f:()=>Promise<unknown>,ok:string)=>{try{await f();setMessage(ok);}catch(e){setMessage(e instanceof Error?e.message:'Request failed');}};
 if(!data)return <p>Loading trading workspace…</p>;
 const key=data.tradingKeys.find(k=>k.environment===environment);
 return <div className="trading-grid">
  <section className="proof-panel" id="controls"><div className="proof-label">01 / ACCOUNT, ENVIRONMENT AND CONTROLS</div>
   <div className="proof-form"><label>Environment<select aria-label="Trading environment" value={environment} onChange={e=>setEnvironment(e.target.value as 'demo'|'live')}><option value="demo">Demo (Trading 212 practice account)</option><option value="live">Live (real money)</option></select></label></div>
   <ul className="trading-gates" data-testid="trading-gates">
    <li className={flags[environment]?'ok':'blocked'}>Server submission flag ({environment}): {flags[environment]?'enabled':'disabled'}</li>
    {environment==='live'&&<li className={data.liveKillSwitchEngaged?'blocked':'ok'}>Live emergency switch: {data.liveKillSwitchEngaged?'engaged (Live trading disabled)':'released'}</li>}
    <li className={data.reviewer?'ok':'blocked'}>Reviewer grant: {data.reviewer?'active':'missing'}</li>
    <li className={data.optedInAt?'ok':'blocked'}>Trading-key opt-in: {data.optedInAt?`recorded ${iso(data.optedInAt)}`:'not recorded'}</li>
    <li className={key?'ok':'blocked'}>Trading-capable key ({environment}): {key?`${key.maskedKey} saved ${iso(key.createdAt)}`:'none (read-only credentials are never used to trade)'}</li>
   </ul>
   <div className="proof-actions"><button className="button secondary" onClick={()=>void run(()=>kill({engaged:true,reason:'Emergency stop from /trading'}),'Live trading disabled.')}>Disable Live trading now</button>{data.reviewer&&data.liveKillSwitchEngaged&&<KillRelease release={reason=>run(()=>kill({engaged:false,reason}),'Live switch released. The server flag still controls Live submission.')}/>}</div>
   <KeySetup data={data} environment={environment} onMessage={setMessage}/>
   {message&&<p role="status" className="trading-message">{message}</p>}
  </section>
  <Ticket environment={environment} onMessage={setMessage}/>
  <section className="proof-panel" id="orders"><div className="proof-label">03 / PROPOSALS, APPROVALS AND BROKER STATUS</div><h2>Orders</h2>
   {data.orders.length===0&&<p>No order proposals yet.</p>}
   {data.orders.map(o=><OrderCard key={o.orderId} order={o} reviewer={data.reviewer} flag={flags[o.environment]} killed={o.environment==='live'&&data.liveKillSwitchEngaged} onMessage={setMessage}/>)}
  </section>
  <Monitor environment={environment} hasKey={Boolean(key)}/>
  <Limits limits={data.limits} reviewer={data.reviewer} onMessage={setMessage}/>
 </div>;
}
function KillRelease({release}:{release:(reason:string)=>Promise<void>}){const[reason,setReason]=useState('');return <span className="trading-inline"><input aria-label="Reason to release the Live switch" placeholder="Reason (required)" value={reason} onChange={e=>setReason(e.target.value)}/><button className="button secondary" disabled={!reason.trim()} onClick={()=>void release(reason)}>Release Live switch</button></span>;}

function KeySetup({data,environment,onMessage}:{data:Overview;environment:'demo'|'live';onMessage:(m:string)=>void}){
 const optIn=useMutation(ref('recordOptIn')),del=useMutation(ref('deleteTradingKey'));
 const[ack,setAck]=useState(false),[apiKey,setApiKey]=useState(''),[apiSecret,setApiSecret]=useState(''),[busy,setBusy]=useState(false);
 const key=data.tradingKeys.find(k=>k.environment===environment);
 async function save(){setBusy(true);try{await api({action:'save_trading_key',environment,apiKey,apiSecret});onMessage(`${environment} trading key saved separately from read-only credentials.`);}catch(e){onMessage(e instanceof Error?e.message:'Save failed');}finally{setApiKey('');setApiSecret('');setBusy(false);}}
 return <details className="trading-keys"><summary>Trading-capable key ({environment})</summary>
  {!data.optedInAt&&<div><p>{data.optInStatement}</p><label className="trading-check"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/> I have read and accept this statement</label><button className="button secondary" disabled={!ack} onClick={()=>void optIn({statement:data.optInStatement}).then(()=>onMessage('Opt-in recorded.'))}>Record opt-in</button></div>}
  {data.optedInAt&&<div className="proof-form"><p>Create a separate key in Trading 212 with only the scopes needed (Orders execute and read, Metadata, History). It never replaces your read-only connection.</p>
   <label>API key<input type="password" autoComplete="off" value={apiKey} onChange={e=>setApiKey(e.target.value)}/></label><label>API secret<input type="password" autoComplete="off" value={apiSecret} onChange={e=>setApiSecret(e.target.value)}/></label>
   <button className="button secondary" disabled={busy||!apiKey||!apiSecret} onClick={()=>void save()}>Save trading key securely</button>
   {key&&<button className="button secondary" onClick={()=>void del({environment}).then(()=>onMessage('Trading key deleted locally. Revoke it at Trading 212 as well.'))}>Delete trading key</button>}</div>}
 </details>;
}

function Ticket({environment,onMessage}:{environment:'demo'|'live';onMessage:(m:string)=>void}){
 const create=useMutation(ref('createDraft'));const[queryText,setQuery]=useState(''),[results,setResults]=useState<{ticker:string;name:string;currencyCode:string;type:string;maxOpenQuantity:number|null}[]>([]),[ticker,setTicker]=useState('');
 const[side,setSide]=useState<'BUY'|'SELL'>('BUY'),[quantity,setQuantity]=useState(''),[type,setType]=useState<'MARKET'|'LIMIT'|'STOP'|'STOP_LIMIT'>('MARKET'),[limitPrice,setLimit]=useState(''),[stopPrice,setStop]=useState(''),[validity,setValidity]=useState<'DAY'|'GOOD_TILL_CANCEL'>('DAY'),[thesis,setThesis]=useState(''),[counter,setCounter]=useState(''),[busy,setBusy]=useState(false);
 async function search(){try{const r=await api({action:'instruments',environment,query:queryText});setResults(r.items);onMessage(`${r.items.length} matches from ${r.total} broker instruments. ${r.note}`);}catch(e){onMessage(e instanceof Error?e.message:'Search failed');}}
 async function propose(){setBusy(true);try{const n=(s:string)=>s.trim()===''?null:Number(s);const draft={environment,ticker,side,quantity:Number(quantity),type,limitPrice:type==='LIMIT'||type==='STOP_LIMIT'?n(limitPrice):null,stopPrice:type==='STOP'||type==='STOP_LIMIT'?n(stopPrice):null,timeValidity:type==='MARKET'?null:validity,extendedHours:false,thesis,counterevidence:counter};await create({draftJson:JSON.stringify(draft)});onMessage('Draft proposal created. Evaluate risk next.');}catch(e){onMessage(e instanceof Error?e.message.replace(/^.*Uncaught Error: /,''):'Could not create draft');}finally{setBusy(false);}}
 return <section className="proof-panel" id="ticket"><div className="proof-label">02 / TRADE TICKET · PROPOSAL ONLY</div><h2>Propose an order</h2>
  <div className="proof-form"><label>Search broker instruments<input value={queryText} onChange={e=>setQuery(e.target.value)} placeholder="Name or ticker"/></label><button className="button secondary" disabled={!queryText.trim()} onClick={()=>void search()}>Search</button></div>
  {results.length>0&&<ul className="trading-results">{results.map(r=><li key={r.ticker}><button className={ticker===r.ticker?'selected':''} onClick={()=>setTicker(r.ticker)}>{r.ticker} · {r.name} · {r.currencyCode} · {r.type}{r.maxOpenQuantity!=null?` · max ${r.maxOpenQuantity}`:''}</button></li>)}</ul>}
  <div className="proof-form">
   <label>Official broker ticker<input value={ticker} onChange={e=>setTicker(e.target.value)} placeholder="e.g. AAPL_US_EQ"/></label>
   <label>Direction<select value={side} onChange={e=>setSide(e.target.value as 'BUY'|'SELL')}><option>BUY</option><option>SELL</option></select></label>
   <label>Quantity (shares)<input inputMode="decimal" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
   <label>Order type<select value={type} onChange={e=>setType(e.target.value as typeof type)}><option>MARKET</option><option>LIMIT</option><option>STOP</option><option>STOP_LIMIT</option></select></label>
   {(type==='LIMIT'||type==='STOP_LIMIT')&&<label>Limit price<input inputMode="decimal" value={limitPrice} onChange={e=>setLimit(e.target.value)}/></label>}
   {(type==='STOP'||type==='STOP_LIMIT')&&<label>Stop price<input inputMode="decimal" value={stopPrice} onChange={e=>setStop(e.target.value)}/></label>}
   {type!=='MARKET'&&<label>Time validity<select value={validity} onChange={e=>setValidity(e.target.value as typeof validity)}><option>DAY</option><option>GOOD_TILL_CANCEL</option></select></label>}
   <label>Investment thesis<textarea value={thesis} onChange={e=>setThesis(e.target.value)}/></label><label>Counterevidence<textarea value={counter} onChange={e=>setCounter(e.target.value)}/></label>
  </div>
  <p className="proof-note">Order types and fractional quantities vary by instrument; Trading 212 decides acceptance. Orders are placed by quantity only, in the primary account currency. Market orders can fill at a different price from any indicative price.</p>
  <button className="button primary" disabled={busy||!ticker||!quantity} onClick={()=>void propose()}>Create proposal</button>
 </section>;
}

function OrderCard({order:o,reviewer,flag,killed,onMessage}:{order:Order;reviewer:boolean;flag:boolean;killed:boolean;onMessage:(m:string)=>void}){
 const decide=useMutation(ref('reviewDecision')),withdraw=useMutation(ref('withdraw'));const[note,setNote]=useState(''),[confirmation,setConfirmation]=useState<null|{token:string;expiresAt:number;summary:Record<string,unknown>}>(null),[busy,setBusy]=useState(false),[showEvents,setShow]=useState(false);
 const act=async(f:()=>Promise<unknown>,ok:string)=>{setBusy(true);try{await f();onMessage(ok);}catch(e){onMessage(e instanceof Error?e.message.replace(/^.*Uncaught Error: /,''):'Request failed');}finally{setBusy(false);}};
 const d=o.draft,r=o.risk;
 return <article className="trading-order" data-state={o.state}><header><strong>{d.side} {d.quantity} {o.ticker}</strong><span className="proof-badge">{o.state.replaceAll('_',' ')}</span><span className="proof-badge">{o.environment}</span></header>
  <p>{d.type}{d.limitPrice!=null?` · limit ${d.limitPrice}`:''}{d.stopPrice!=null?` · stop ${d.stopPrice}`:''}{d.timeValidity?` · ${d.timeValidity}`:''}</p>
  <details><summary>Thesis and counterevidence</summary><p>{d.thesis}</p><p><em>Counter:</em> {d.counterevidence}</p></details>
  {o.priceReference&&<p>Indicative price {o.priceReference.priceCurrency} {o.priceReference.price} at {iso(o.priceReference.observedAt)}. {o.priceReference.sourceDetail}</p>}
  {r&&<div className={`trading-risk ${r.passed?'ok':'blocked'}`}><strong>Independent risk check: {r.passed?'passed':'blocked'}</strong><p>Estimated value {money(r.estimate.estimatedValue,r.estimate.accountCurrency)} (FX cost {money(r.estimate.fxCost,r.estimate.accountCurrency)}) · cash {money(r.account?.cashAvailable,r.estimate.accountCurrency)} · account {money(r.account?.totalValue,r.estimate.accountCurrency)} · synced {iso(r.account?.syncedAt)}</p>{r.reasons.length>0&&<ul>{r.reasons.map(x=><li key={x}>{x}</li>)}</ul>}</div>}
  {o.brokerOrderId!==null&&<p>Broker order {o.brokerOrderId} · {o.brokerStatus} · filled {o.filledQuantity??0}{o.filledValue!=null?` · value ${o.filledValue}`:''} · last checked {iso(o.lastReconciledAt)}</p>}
  {o.state==='unknown'&&<p className="trading-warning">The broker response was ambiguous. This order is never re-sent. Reconcile against Trading 212 ({o.reconcileChecks} checks so far).</p>}
  <div className="proof-actions">
   {['draft','reviewed','approved'].includes(o.state)&&<button className="button secondary" disabled={busy} onClick={()=>void act(()=>api({action:'evaluate',orderId:o.orderId}),'Risk evaluated against the latest synchronised account.')}>Evaluate risk</button>}
   {o.state==='reviewed'&&reviewer&&<><input aria-label="Review note" placeholder="Review note" value={note} onChange={e=>setNote(e.target.value)}/><button className="button primary" disabled={busy||!note.trim()} onClick={()=>void act(()=>decide({orderId:o.orderId,decision:'approve',note}),'Approved.')}>Approve</button><button className="button secondary" disabled={busy||!note.trim()} onClick={()=>void act(()=>decide({orderId:o.orderId,decision:'decline',note}),'Declined.')}>Decline</button></>}
   {o.state==='approved'&&<button className="button secondary" disabled={busy} onClick={()=>void act(async()=>setConfirmation(await api({action:'issue_confirmation',orderId:o.orderId})),'Review the exact details and confirm within 60 seconds.')}>Prepare confirmation</button>}
   {o.state==='confirmed'&&<button className="button primary" disabled={busy||!flag||killed} title={!flag?'Submission is disabled on this server':killed?'Live emergency switch engaged':''} onClick={()=>void act(()=>api({action:'submit',orderId:o.orderId}),'Submitted once. Status will follow from the broker.')}>Submit to Trading 212</button>}
   {['acknowledged','partially_filled','unknown','submitting'].includes(o.state)&&<button className="button secondary" disabled={busy} onClick={()=>void act(()=>api({action:'reconcile',orderId:o.orderId}),'Reconciled against the broker.')}>Refresh broker status</button>}
   {['acknowledged','partially_filled'].includes(o.state)&&<button className="button secondary" disabled={busy||!flag} onClick={()=>void act(()=>api({action:'cancel',orderId:o.orderId}),'Cancellation requested; refresh to read the outcome.')}>Request cancellation</button>}
   {['draft','reviewed','approved','confirmed'].includes(o.state)&&<button className="button secondary" disabled={busy} onClick={()=>void act(()=>withdraw({orderId:o.orderId,reason:'Withdrawn by owner'}),'Withdrawn.')}>Withdraw</button>}
   <button className="button secondary" onClick={()=>setShow(!showEvents)}>Audit trail</button>
  </div>
  {confirmation&&o.state==='approved'&&<div className="trading-confirm" role="dialog" aria-label="Final confirmation"><strong>Final confirmation · expires {iso(confirmation.expiresAt)}</strong><dl>{Object.entries(confirmation.summary).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{String(v??'—')}</dd></div>)}</dl><p>The indicative price is not a guaranteed execution price. Submission is a separate step and happens once.</p><button className="button primary" disabled={busy} onClick={()=>void act(async()=>{await api({action:'confirm',orderId:o.orderId,token:confirmation.token});setConfirmation(null);},'Exact order details confirmed.')}>Confirm these exact details</button></div>}
  {showEvents&&<Events orderId={o.orderId}/>}
 </article>;
}
function Events({orderId}:{orderId:string}){const e=useQuery(eventsRef,{orderId});return <ol className="trading-events">{e?.map((x,i)=><li key={i}>{iso(x.at)} · {x.from} → {x.to} · {x.actor.split('|').pop()} · {x.detail}</li>)}</ol>;}

function Monitor({environment,hasKey}:{environment:'demo'|'live';hasKey:boolean}){
 const[data,setData]=useState<null|{retrievedAt:number;pending:{id:number;ticker:string;status:string;quantity:number|null;filledQuantity:number|null;type:string}[];history:{order:{id:number;ticker:string;status:string;quantity:number|null};filledAt:string|null;price:number|null;quantity:number|null}[];dividends:{reference:string;ticker:string;amount:number;paidOn:string}[]}>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const[clock,setClock]=useState(0);
 useEffect(()=>{const tick=()=>setClock(Date.now());const first=setTimeout(tick,0),id=setInterval(tick,30_000);return ()=>{clearTimeout(first);clearInterval(id);};},[]);
 const stale=data&&clock?clock-data.retrievedAt>5*60_000:false;
 return <section className="proof-panel" id="monitor"><div className="proof-label">04 / BROKER RECORD · ORDERS, FILLS AND DIVIDENDS</div><h2>What Trading 212 reports</h2>
  <p>Polled on request within provider rate limits; not tick-by-tick prices. Account cash and positions come from the read-only sync on Broker Connections.</p>
  <button className="button secondary" disabled={busy||!hasKey} onClick={()=>{setBusy(true);setError('');api({action:'monitor',environment}).then(setData).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>{hasKey?'Refresh broker orders':'Save a trading key to read orders'}</button>
  {error&&<p role="alert">{error}</p>}
  {data&&<><p className={stale?'trading-warning':''}>Last synchronised {iso(data.retrievedAt)}{stale?' · stale (over 5 minutes old)':''}</p>
   <h3>Pending orders ({data.pending.length})</h3><ul>{data.pending.map(p=><li key={p.id}>{p.id} · {p.ticker} · {p.type} · {p.status} · qty {p.quantity} · filled {p.filledQuantity??0}</li>)}</ul>
   <h3>Recent fills ({data.history.length})</h3><ul>{data.history.map(h=><li key={`${h.order.id}-${h.filledAt}`}>{h.filledAt??'—'} · {h.order.ticker} · {h.order.status} · {h.quantity??'—'} @ {h.price??'—'}</li>)}</ul>
   <h3>Dividends ({data.dividends.length})</h3><ul>{data.dividends.map(d=><li key={d.reference}>{d.paidOn} · {d.ticker} · {d.amount}</li>)}</ul></>}
 </section>;
}

function Limits({limits,reviewer,onMessage}:{limits:RiskLimits;reviewer:boolean;onMessage:(m:string)=>void}){
 const update=useMutation(ref('updateLimits'));const[draft,setDraft]=useState(JSON.stringify(limits,null,1));
 return <section className="proof-panel" id="limits"><div className="proof-label">05 / INDEPENDENT RISK LIMITS</div><h2>Limits ({limits.version})</h2>
  <p>Per-order value {limits.maxOrderValue} · position exposure {limits.maxPositionExposurePct}% · daily realised loss {limits.maxDailyLoss} · price age {limits.maxPriceAgeSeconds}s · FX fee {limits.fxFeeBps} bps · instrument types {limits.allowedInstrumentTypes.join(', ')}. Values are in the account currency.</p>
  {reviewer&&<details><summary>Change limits (reviewer)</summary><textarea aria-label="Risk limits JSON" value={draft} onChange={e=>setDraft(e.target.value)} rows={9}/><button className="button secondary" onClick={()=>update({limitsJson:draft}).then(()=>onMessage('Limits updated and audited.')).catch(e=>onMessage(String(e.message).replace(/^.*Uncaught Error: /,'')))}>Save limits</button></details>}
 </section>;
}
