import Link from 'next/link';

export type Alert={id:string;tone:'alert'|'warn'|'info';title:string;detail:string;href?:string;hrefLabel?:string};
/**
 * Compact status bar. Risk warnings (alert/warn) are always visible, on every screen size; informational notices and
 * module links are collapsible. Every notice that has a resolution links to it.
 */
export function AlertsCentre({alerts,links}:{alerts:Alert[];links:{href:string;label:string}[]}){
 const urgent=alerts.filter(a=>a.tone!=='info'),info=alerts.filter(a=>a.tone==='info');
 const item=(a:Alert)=><li key={a.id} className={`cc-${a.tone}`} data-alert={a.id}><strong>{a.title}</strong> {a.detail} {a.href&&<Link className="cc-fix" href={a.href}>{a.hrefLabel??'Resolve'} →</Link>}</li>;
 return <div className="cc-alerts-wrap" data-testid="alerts-centre">
  {urgent.length>0&&<ul className="cc-alerts cc-urgent" aria-label="Items needing attention" data-testid="urgent-alerts">{urgent.map(item)}</ul>}
  <details className="cc-status-bar"><summary><span className={`cc-dot-status ${urgent.length?'cc-warn':'cc-ok'}`} aria-hidden="true"/>
   <span>{urgent.length?`${urgent.length} item${urgent.length===1?' needs':'s need'} attention (shown above)`:'No items need attention'}</span><span className="cc-status-hint">{info.length} notices · {links.length} research modules</span></summary>
   <div className="cc-status-body"><ul className="cc-alerts">{info.map(item)}</ul>
    <nav aria-label="Research cases and modules" className="cc-module-links">{links.map(l=><Link key={l.href} href={l.href}>{l.label}</Link>)}</nav></div>
  </details></div>;
}
