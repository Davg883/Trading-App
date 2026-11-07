import Link from 'next/link';
import type {MissingEvidenceResolutionSummary} from '../../lib/market-data/missing-evidence-resolver';
import type {RegisteredForwardResearchEvent} from '../../lib/market-data/forward-research';
import {DataBadge,iso,pct,type DataClass} from './shared';

export type EvidenceEvent={id:string;at:number;title:string;detail:string;kind:DataClass;href:string};

export function ResearchIntel({
 events,
 forwardPredictions,
 missingEvidenceResolution,
 forwardResearchEvents,
}:{
 events:EvidenceEvent[];
 forwardPredictions:number;
 missingEvidenceResolution?:MissingEvidenceResolutionSummary|null;
 forwardResearchEvents?:RegisteredForwardResearchEvent[]|null;
}){
 const fwdList=forwardResearchEvents??[];
 const effectiveFwdCount=Math.max(forwardPredictions,fwdList.length);
 return <section className="cc-panel" aria-labelledby="intel-title" data-testid="research-intel">
  <header className="cc-panel-head">
   <div>
    <h2 id="intel-title">Research intelligence</h2>
    <p>Recent evidence events. Retrospective cases are not predictions; forward predictions registered so far: <strong data-testid="forward-predictions-count">{effectiveFwdCount}</strong>.</p>
   </div>
  </header>
  <ol className="cc-events">
   {events.map(e=><li key={e.id}><div><DataBadge kind={e.kind}/><time dateTime={new Date(e.at).toISOString()}>{iso(e.at)}</time></div><Link href={e.href}><strong>{e.title}</strong></Link><p>{e.detail}</p></li>)}
  </ol>

  {missingEvidenceResolution&&missingEvidenceResolution.windows.length>0&&<div className="cc-ops-subpanel" data-testid="missing-evidence-resolver" style={{marginTop:'1rem'}}>
   <h3 style={{fontSize:'0.95rem',marginBottom:'0.35rem'}}>Missing Evidence Resolver &amp; Outcome Recalculation</h3>
   <p className="cc-note" style={{marginBottom:'0.5rem'}}>
    Evaluated {missingEvidenceResolution.totalWindows} research window(s): <strong>{missingEvidenceResolution.scoredWindows}</strong> complete &amp; scored, <strong>{missingEvidenceResolution.blockedIncompleteWindows}</strong> incomplete blocked (never scored), <strong>{missingEvidenceResolution.pendingFutureWindows}</strong> awaiting horizon completion.
   </p>
   <div className="cc-table-wrap" tabIndex={0} aria-label="Missing evidence resolution table">
    <table className="cc-table" data-testid="missing-evidence-table">
     <thead>
      <tr>
       <th scope="col">Research window</th>
       <th scope="col">Horizon</th>
       <th scope="col">Status</th>
       <th scope="col">Recalculated outcome (USD / GBP)</th>
       <th scope="col">Missing evidence / guard</th>
      </tr>
     </thead>
     <tbody>
      {missingEvidenceResolution.windows.map(w=><tr key={w.windowId} data-testid={`resolver-window-${w.windowId}`}>
       <th scope="row">
        {w.studyName}
        <small>{w.windowId}</small>
       </th>
       <td>
        {w.horizonSessions} session(s)
        <small>{iso(w.anchorAt)} → {w.endAt?iso(w.endAt):'TBD'}</small>
       </td>
       <td>
        <span className={`cc-status cc-${w.status==='complete_scored'?'fresh':w.status==='incomplete_blocked'?'stale':'delayed'}`}>
         {w.status==='complete_scored'?'Complete · Scored':w.status==='incomplete_blocked'?'Incomplete · Blocked':'Horizon Pending'}
        </span>
       </td>
       <td>
        {w.outcome?<>
         <strong>USD {pct(w.outcome.equalWeightReturnUsd)} · GBP {pct(w.outcome.equalWeightReturnGbp)}</strong>
         {w.outcome.excessReturnUsd!==null&&<small>vs QQQ: USD {pct(w.outcome.excessReturnUsd)} / GBP {pct(w.outcome.excessReturnGbp??0)}</small>}
        </>:<span>Not scored (incomplete/pending)</span>}
       </td>
       <td>
        {w.blockingReasons.length>0
         ?<small>{w.blockingReasons.join(' · ')}</small>
         :<small>All required prices, FX rates, corporate actions &amp; cost rules verified ({w.outcome?.observationIds.length??0} observations).</small>}
       </td>
      </tr>)}
     </tbody>
    </table>
   </div>
  </div>}

  {fwdList.length>0&&<div className="cc-ops-subpanel" data-testid="forward-research-panel" style={{marginTop:'1rem'}}>
   <h3 style={{fontSize:'0.95rem',marginBottom:'0.35rem'}}>Registered Forward Research Events (Trusted Server Timestamps)</h3>
   {fwdList.map(ev=><div key={ev.eventKey} data-testid={`forward-event-${ev.eventKey}`} style={{marginBottom:'0.75rem'}}>
    <p className="cc-note" style={{marginBottom:'0.4rem'}}>
     <DataBadge kind="forward"/> <strong>{ev.name}</strong> ({ev.eventKey}) · Registered: <code>{iso(ev.registeredAt)}</code> · Cutoff: <code>{iso(ev.cutoffAt)}</code> · Anchor: <code>{ev.anchorSessionDate}</code> → Target End: <code>{ev.targetEndSessionDate}</code> · Frozen Bundle SHA-256: <code>{ev.evidenceSha256.slice(0,16)}…</code> · Outcome Status: <strong data-testid={`forward-eval-${ev.eventKey}`}>{ev.evaluation.evaluationStatus==='evaluated'?'Evaluated':'Awaiting post-horizon observations'}</strong>
     {ev.evaluation.blockingReason?` (${ev.evaluation.blockingReason})`:''}
    </p>
    <div className="cc-table-wrap" tabIndex={0} aria-label="Forward research participants table">
     <table className="cc-table" data-testid={`forward-participants-${ev.eventKey}`}>
      <thead>
       <tr>
        <th scope="col">Participant</th>
        <th scope="col">Model / Baseline version</th>
        <th scope="col">Status</th>
        <th scope="col">Forecast (Up / Down / Neutral)</th>
        <th scope="col">Expected return &amp; 80% interval</th>
        <th scope="col">Usage &amp; billed cost</th>
       </tr>
      </thead>
      <tbody>
       {ev.participants.map(p=><tr key={p.participantId} data-testid={`forward-participant-${p.participantId}`}>
        <th scope="row">
         {p.providerName}
         <small>{p.participantId}</small>
        </th>
        <td><code>{p.modelVersion}</code></td>
        <td>
         <span className={`cc-status cc-${p.status==='succeeded'?'fresh':p.status==='configuration_missing'?'delayed':'stale'}`}>
          {p.status}
         </span>
        </td>
        <td>
         {p.forecast
          ?<span>Up {(p.forecast.probabilities[0]*100).toFixed(0)}% · Down {(p.forecast.probabilities[1]*100).toFixed(0)}% · Neutral {(p.forecast.probabilities[2]*100).toFixed(0)}% ({p.forecast.decision})</span>
          :<small>{p.error??'No forecast (provider unconfigured)'}</small>}
        </td>
        <td>
         {p.forecast
          ?<span>{pct(p.forecast.expectedReturn)} [{pct(p.forecast.lower)}, {pct(p.forecast.upper)}]</span>
          :<span>—</span>}
        </td>
        <td>
         <small>
          {p.inputTokens} in / {p.outputTokens} out · {p.actualBilledCostGbp!==null?`£${p.actualBilledCostGbp.toFixed(4)}`:`Est £${p.estimatedCostGbp.toFixed(4)}`} ({p.costStatus})
         </small>
        </td>
       </tr>)}
      </tbody>
     </table>
    </div>
   </div>)}
  </div>}
 </section>;
}
