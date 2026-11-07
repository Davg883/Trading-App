import Link from 'next/link';
import type {Value} from '../../lib/portfolio/performance';

/** Data classes that must never be visually confused. */
export type DataClass='live'|'demo'|'paper'|'synthetic'|'retrospective'|'forward'|'public_reference';
export const DATA_CLASS_LABEL:Record<DataClass,string>={live:'Live Trading 212',demo:'Demo brokerage',paper:'Internal paper trading',synthetic:'Synthetic demonstration',retrospective:'Retrospective case',forward:'Forward prediction',public_reference:'Public reference (delayed)'};
export function DataBadge({kind}:{kind:DataClass}){return <span className={`cc-badge cc-${kind}`} data-class={kind}>{DATA_CLASS_LABEL[kind]}</span>;}

export const iso=(t:number|null|undefined)=>t==null?'—':new Date(t).toISOString().replace('T',' ').replace(/:\d\d\.\d{3}Z$/,' UTC');
export function age(ms:number|null){if(ms===null)return 'unknown age';const m=Math.round(ms/60000);return m<1?'just now':m<60?`${m} min ago`:m<2880?`${Math.round(m/60)} h ago`:`${Math.round(m/1440)} days ago`;}
export function money(v:number,currency:string){return new Intl.NumberFormat('en-GB',{style:'currency',currency,maximumFractionDigits:2}).format(v);}
export function signedMoney(v:number,currency:string){return `${v>0?'+':v<0?'−':''}${money(Math.abs(v),currency)}`;}
export function pct(v:number,signed=true){return `${signed&&v>0?'+':v<0?'−':''}${Math.abs(v*100).toFixed(2)}%`;}

/** Renders a Value; unavailable values show a reason, never a zero. */
export type Fix={href:string;label:string};
export function Shown<T>({v,format,fix}:{v:Value<T>;format:(x:T)=>string;fix?:Fix}){return v.ok?<span className="cc-value">{format(v.value)}</span>:<span className="cc-unavailable" title={v.reason}>Unavailable<small>{v.reason}</small>{fix&&<Link className="cc-fix" href={fix.href}>{fix.label} →</Link>}</span>;}
