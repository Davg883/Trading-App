import Link from 'next/link';
import type {Value} from '../../lib/portfolio/performance';
import {Shown,iso,type Fix} from './shared';

/** Primary KPI card. Shows the value (or an explicit unavailable state with a route to fix it), its source and observation time. */
export function KpiCard<T>({label,value,format,tone,emphasis=false,testId,fix}:{label:string;value:Value<T>;format:(v:T)=>string;tone?:(v:T)=>'up'|'down'|'flat';emphasis?:boolean;testId?:string;fix?:Fix}){
 const t=value.ok&&tone?tone(value.value):'flat';
 return <article className={`cc-kpi ${emphasis?'cc-kpi-main':''} cc-${t}`} data-testid={testId} aria-label={label}>
  <h3>{label}</h3>
  <p className="cc-kpi-value"><Shown v={value} format={format} fix={fix}/></p>
  <p className="cc-kpi-source">{value.ok?<>{value.source}{value.observedAt?` · ${iso(value.observedAt)}`:''}</>:'No reconciled source'}</p>
 </article>;
}

/** Compact secondary figures in one strip; sources and timestamps sit in a collapsible note. */
export function KpiStrip({items,testId}:{items:{label:string;value:Value<unknown>;format:(v:never)=>string;fix?:Fix;source?:string}[];testId?:string}){
 return <div className="cc-strip" data-testid={testId}>
  <dl>{items.map(i=><div key={i.label} className="cc-strip-item"><dt>{i.label}</dt><dd>{i.value.ok?<span className="cc-value">{i.format(i.value.value as never)}</span>:<span className="cc-unavailable-inline" title={i.value.reason}>Unavailable{i.fix&&<Link className="cc-fix" href={i.fix.href}>{i.fix.label} →</Link>}</span>}</dd></div>)}</dl>
  <details className="cc-strip-sources"><summary>Sources and timestamps</summary><ul>{items.map(i=><li key={i.label}><strong>{i.label}:</strong> {i.value.ok?`${i.value.source}${i.value.observedAt?` · ${iso(i.value.observedAt)}`:''}`:i.value.reason}</li>)}</ul></details>
 </div>;
}
