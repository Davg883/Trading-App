import Link from 'next/link';
import type {MorningBriefingRecord} from '../../lib/remote-ops/contracts';
import type {BriefingSource} from '../../lib/remote-ops/briefing-provenance';
import {iso} from './shared';

/**
 * Morning Intelligence Brief panel (Section 7).
 * Strictly separates:
 * 1. Confirmed facts (primary-source-backed observations & disclosures).
 * 2. Research interpretation (AI agent structured summaries & hypotheses; zero execution authority).
 * 3. Risk changes (deterministic concentration, AI exposure, policy risk, broker & execution controls).
 * 4. Incomplete evidence (missing licensed feeds, unconfirmed case gaps, staged items pending verification).
 */
export function MorningBriefPanel({
 briefing,
 fixture,
 source,
 latestStored,
}:{
 briefing:MorningBriefingRecord|null;
 fixture?:boolean;
 /** Sprint G9.2: provenance of `briefing`; 'bundled_reference' is the static build-time briefing, never current research. */
 source?:BriefingSource;
 latestStored?:{date:string|null;generatedAt:number|null};
}){
 const bundled=source==='bundled_reference';
 if(!briefing){
  return (
   <section className="cc-panel" id="morning-brief" aria-labelledby="morning-brief-title" data-testid="morning-brief-panel">
    <header className="cc-panel-head">
     <div>
      <h2 id="morning-brief-title">Morning intelligence brief</h2>
      <p>Sign in as an authorised researcher to load the full owner-scoped morning intelligence brief, or refer to Section A above for the public executive market synthesis.</p>
     </div>
     <span className="cc-badge cc-public_reference">Execution authority: none</span>
    </header>
   </section>
  );
 }
 return (
  <section className="cc-panel" id="morning-brief" aria-labelledby="morning-brief-title" data-testid="morning-brief-panel" data-briefing-source={source??'unspecified'}>
   <header className="cc-panel-head">
    <div>
     <h2 id="morning-brief-title">{bundled?`Historical bundled briefing (${briefing.briefingDate}) — not current research`:`Morning intelligence brief (${briefing.briefingDate})`}</h2>
     <p>
      Scheduled 07:30 {briefing.timezone} on weekdays · generated {iso(briefing.generatedAt)} ·{' '}
      {fixture?'Synthetic fixture brief':'Confirmed facts are strictly separated from AI interpretation, risk deltas and incomplete evidence'}.
     </p>
     {bundled&&(
      <p className="cc-note" data-testid="brief-bundled-notice">
       Historical record: this static briefing ships with the application build and predates the stored evidence; it is shown for reference only.
       Latest stored briefing: {latestStored?.date?<>{latestStored.date}{latestStored.generatedAt?<> (generated {iso(latestStored.generatedAt)})</>:null}</>:latestStored?.generatedAt?<>generated {iso(latestStored.generatedAt)}</>:'none stored'}.
       Its content is shown only to the authorised research owner.
      </p>
     )}
     {briefing.remediationState==='SAFE_WITHHELD_PENDING_QUARANTINE'&&(
      <p className="cc-note" data-testid="brief-safe-withheld-pending-quarantine">
       <strong>SAFE_WITHHELD_PENDING_QUARANTINE:</strong> Unquarantined invalid SEC/XBRL disclosures were detected and automatically withheld on read pending formal ledger quarantine; unaffected primary-source facts remain displayed.
      </p>
     )}
     {briefing.withheldFacts&&briefing.withheldFacts.length>0&&(
      <p className="cc-note" data-testid="brief-withheld-facts">
       {briefing.withheldFacts.length} confirmed fact(s) in this stored briefing were {briefing.remediationState==='SAFE_WITHHELD_PENDING_QUARANTINE'?'withheld pending formal quarantine':'later quarantined and are withheld'}:{' '}
       {briefing.withheldFacts.map(w=><span key={w.id}><code>{w.id}</code> ({w.reason.split(':')[0]}) </span>)}
      </p>
     )}
     {briefing.withheldInterpretations&&briefing.withheldInterpretations.length>0&&(
      <p className="cc-note" data-testid="brief-withheld-interpretations">
       {briefing.withheldInterpretations.length} research interpretation(s) citing quarantined evidence were withheld from active display (historical briefing row preserved).
      </p>
     )}
    </div>
    <span className="cc-badge cc-public_reference">Execution authority: {briefing.executionAuthority}</span>
   </header>

   <div className="cc-widgets">
    <article className="cc-widget cc-ok" data-testid="brief-confirmed-facts">
     <h3>1. Confirmed facts (primary-source verified)</h3>
     {briefing.confirmedFacts.length===0?(
      <p>No new primary-source facts recorded in this window.</p>
     ):(
      <ul>
       {briefing.confirmedFacts.map(f=>(
        <li key={f.id}>
         <strong>{f.entity} · {f.metric}</strong> ({f.period}): {f.valueDisplay}{' '}
         <small>
          [{f.classification} · {f.sourceKind.replace('_',' ')} · pub {iso(f.publishedAt)} · rcv {iso(f.receivedAt)} ·{' '}
          <a href={f.sourceUrl} target="_blank" rel="noreferrer">Primary source</a>]
         </small>
        </li>
       ))}
      </ul>
     )}
    </article>

    <article className="cc-widget cc-info" data-testid="brief-interpretation">
     <h3>2. Research interpretation &amp; hypotheses (AI-assisted, non-authoritative)</h3>
     {briefing.researchInterpretation.length===0?(
      <p>No AI research interpretations generated for this window.</p>
     ):(
      <ul>
       {briefing.researchInterpretation.map(item=>(
        <li key={item.id}>
         <strong>{item.title}</strong> ({item.entities.join(', ')}): {item.summary}
         {item.hypothesis&&<> <em>Proposed hypothesis:</em> {item.hypothesis}</>}{' '}
         <small>
          [model: {item.modelVersion} · cites: {item.citedEvidenceIds.join(', ')} · execution: {item.executionAuthority}]
         </small>
        </li>
       ))}
      </ul>
     )}
    </article>

    <article className="cc-widget cc-warn" data-testid="brief-risk-changes">
     <h3>3. Risk &amp; control changes (deterministic)</h3>
     <ul>
      {briefing.riskChanges.map(r=>(
       <li key={r.id}>
        <strong>{r.title}</strong> {r.detail} <Link href={r.href}>Review →</Link>
       </li>
      ))}
     </ul>
    </article>

    <article className="cc-widget cc-alert" data-testid="brief-incomplete-evidence">
     <h3>4. Incomplete evidence &amp; pending verification</h3>
     <ul>
      {briefing.incompleteEvidence.map(gap=>(
       <li key={gap.id}>
        <strong>{gap.domain}: {gap.missingItem}</strong> — {gap.impact}
        {gap.pendingVerificationCount>0&&` (${gap.pendingVerificationCount} staged claim(s) awaiting primary-source verification)`}{' '}
        <Link href={gap.resolutionHref}>Inspect →</Link>
       </li>
      ))}
     </ul>
    </article>
   </div>
  </section>
 );
}
