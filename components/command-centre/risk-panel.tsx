import Link from 'next/link';
import type {Value} from '../../lib/portfolio/performance';
import {Shown,age,iso,pct} from './shared';

export type ExecutionState={demoFlag:boolean;liveFlag:boolean;liveKillSwitchEngaged:boolean|null;reviewer:boolean|null};
export type RiskInputs={concentration:Value<{ticker:string;share:number}>;aiExposure:Value<{share:number;tickers:string[]}>;maxDrawdown:Value;pendingApprovals:number|null;awaitingConfirmation:number|null;unknownOrders:number|null;evidence:{label:string;criticalGaps:number;detail:string;href:string}[];marketDataAsOf:number|null;broker:{status:string|null;lastSyncAt:number|null;errorCode:string|null};execution:ExecutionState;now:number};

/** Compact risk and decision widgets. Read-only: execution states are displayed, never changed, from here. */
export function RiskPanel(r:RiskInputs){
 const marketAge=r.marketDataAsOf===null?null:r.now-r.marketDataAsOf,brokerAge=r.broker.lastSyncAt===null?null:r.now-r.broker.lastSyncAt;
 const w=(title:string,body:React.ReactNode,tone:'ok'|'warn'|'alert'|'info'='info',testId?:string)=><article className={`cc-widget cc-${tone}`} data-testid={testId}><h3>{title}</h3>{body}</article>;
 return <section className="cc-panel" aria-labelledby="risk-title" data-testid="risk-panel"><header className="cc-panel-head"><div><h2 id="risk-title">Risk and decisions</h2><p>Independent controls are enforced on the server; this panel only reports them.</p></div></header>
  <div className="cc-widgets">
   {w('Concentration',<Shown v={r.concentration} format={v=>`${v.ticker.split('_')[0]} ${pct(v.share,false)} of account`}/>,r.concentration.ok&&r.concentration.value.share>0.25?'warn':'info')}
   {w('AI-sector exposure',<Shown v={r.aiExposure} format={v=>`${pct(v.share,false)}${v.tickers.length?` · ${v.tickers.map(t=>t.split('_')[0]).join(', ')}`:''}`}/>)}
   {w('Maximum drawdown',<Shown v={r.maxDrawdown} format={v=>pct(v)}/>)}
   {w('Pending human approvals',r.pendingApprovals===null?<span className="cc-unavailable">Sign in to view</span>:<p><strong>{r.pendingApprovals}</strong> awaiting review · {r.awaitingConfirmation} awaiting confirmation{r.unknownOrders?` · ${r.unknownOrders} unknown`:''} <Link href="/trading">Open</Link></p>,(r.pendingApprovals??0)+(r.unknownOrders??0)>0?'alert':'ok','approvals-widget')}
   {w('Research evidence quality',<ul>{r.evidence.map(e=><li key={e.label} title={e.detail}><Link href={e.href}>{e.label}</Link>: {e.criticalGaps} open evidence gap{e.criticalGaps===1?'':'s'}</li>)}</ul>,r.evidence.some(e=>e.criticalGaps>0)?'warn':'ok','evidence-widget')}
   {w('Market-data freshness',r.marketDataAsOf===null?<span className="cc-unavailable">No market data</span>:<p>Latest public reference close {iso(r.marketDataAsOf)} ({age(marketAge)}). No licensed real-time feed. <Link href="/policy-risk#sources">Price evidence</Link></p>,marketAge!==null&&marketAge>36*3600_000?'warn':'info','market-freshness')}
   {w('Broker connection',r.broker.status===null?<p><span className="cc-unavailable">Not connected</span> <Link href="/settings/brokers">Connect Trading 212</Link></p>:<p>{r.broker.status}{r.broker.errorCode?` · ${r.broker.errorCode}`:''} · last full sync {iso(r.broker.lastSyncAt)} ({age(brokerAge)}) · read-only{(r.broker.status!=='connected'||brokerAge===null||brokerAge>=15*60_000)&&<> · <Link href="/settings/brokers">Synchronise</Link></>}</p>,r.broker.status==='connected'&&brokerAge!==null&&brokerAge<15*60_000?'ok':'warn','broker-widget')}
   {w('Execution states',<ul><li>Live submission: <strong>{r.execution.liveFlag?'enabled':'disabled'}</strong></li><li>Demo submission: <strong>{r.execution.demoFlag?'enabled':'disabled'}</strong></li><li>Reviewer grant: {r.execution.reviewer===null?'sign in to view':r.execution.reviewer?'active':'none'}</li></ul>,r.execution.liveFlag?'alert':'ok','execution-widget')}
   {w('Emergency trading disable',r.execution.liveKillSwitchEngaged===null?<span className="cc-unavailable">Sign in to view</span>:<p><strong>{r.execution.liveKillSwitchEngaged?'Engaged':'Released'}</strong> · {r.execution.liveKillSwitchEngaged?'Live orders blocked':'Live still requires the server flag'} <Link href="/trading">Manage</Link></p>,r.execution.liveKillSwitchEngaged===false?'warn':'ok','killswitch-widget')}
  </div></section>;
}
