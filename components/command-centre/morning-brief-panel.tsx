import Link from 'next/link';
import type {MorningBriefingRecord} from '../../lib/remote-ops/contracts';
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
}:{
 briefing:MorningBriefingRecord;
 fixture?:boolean;
}){
 return (
  <section className="cc-panel" id="morning-brief" aria-labelledby="morning-brief-title" data-testid="morning-brief-panel">
   <header className="cc-panel-head">
    <div>
     <h2 id="morning-brief-title">Morning intelligence brief ({briefing.briefingDate})</h2>
     <p>
      Scheduled 07:30 {briefing.timezone} on weekdays · generated {iso(briefing.generatedAt)} ·{' '}
      {fixture?'Synthetic fixture brief':'Confirmed facts are strictly separated from AI interpretation, risk deltas and incomplete evidence'}.
     </p>
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
