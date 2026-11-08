import Link from 'next/link';
import type {CollectionHealthReport,JobHealthSummary} from '../../lib/remote-ops/health-monitor';
import {age,iso} from './shared';

const CATEGORY_LABELS:Record<JobHealthSummary['category'],string>={
 deterministic_collector:'Deterministic collector (non-AI)',
 remote_agent:'Antigravity Remote Agent (AI)',
 risk_evaluation:'Deterministic risk evaluation',
 briefing_generator:'Daily briefing generator',
};

function costText(job:JobHealthSummary):string{
 if(!job.usesAiModel)return '£0.00 (deterministic, non-AI)';
 const est=`£${job.estimatedCostGbp.toFixed(4)}`;
 const act=job.actualCostGbp!==null?`£${job.actualCostGbp.toFixed(4)}`:'pending billing';
 return `Est. ${est} · Actual ${act}`;
}

function layerTone(status:string):'ok'|'warn'|'alert'{
 if(status==='working'||status==='available'||status==='imported'||status==='generated')return 'ok';
 if(status==='partial'||status==='unchanged_cursor'||status==='awaiting_uk_0730'||status==='degraded')return 'warn';
 return 'alert';
}

/**
 * Agent Operations & Collection Health panel (Phase 003 Section 7 & Phase 003.2 Section 4).
 *
 * Explicitly distinguishes:
 * 1. Scheduler working
 * 2. Collector working
 * 3. Source available
 * 4. Valid evidence imported
 * 5. Research briefing generated
 *
 * A healthy scheduler does not automatically imply healthy data ingestion.
 * Displays active environment, last success, last failure, next run, data freshness,
 * cursor/efficiency telemetry, and estimated vs. actual model cost for each collector.
 */
export function AgentOperationsPanel({
 health,
 now,
 fixture,
 onToggleJob,
}:{
 health:CollectionHealthReport;
 now:number;
 fixture?:boolean;
 onToggleJob?:(jobKey:string,enabled:boolean)=>Promise<void>;
}){
 const layers=health.operationalLayers;
 return (
  <section className="cc-panel" id="agent-operations" aria-labelledby="agent-ops-title" data-testid="agent-operations-panel">
   <header className="cc-panel-head">
    <div>
     <h2 id="agent-ops-title">Agent operations &amp; collection health</h2>
     <p>
      Deterministic collectors (market closes, FX, SEC XBRL, read-only broker sync) run independently of AI research agents.
      A healthy scheduler does not automatically imply healthy upstream data ingestion.
     </p>
    </div>
    <span className={`cc-status ${health.systemEnabled?'cc-delayed':'cc-stale'}`} data-testid="agent-ops-env">
     {health.systemEnabled?`Active authority: ${health.activeEnvironment}`:'Centrally disabled'}
    </span>
   </header>

   <div className="cc-strip" data-testid="agent-ops-summary">
    <dl>
     <div className="cc-strip-item">
      <dt>System status</dt>
      <dd>{health.systemEnabled?'Enabled (unattended)':'Disabled centrally'}</dd>
     </div>
     <div className="cc-strip-item">
      <dt>Pending verification</dt>
      <dd data-testid="agent-ops-pending">{health.pendingVerificationCount} staged item{health.pendingVerificationCount===1?'':'s'}</dd>
     </div>
     <div className="cc-strip-item">
      <dt>Paid AI API usage (today / ceiling)</dt>
      <dd data-testid="agent-ops-cost">
       Est. ?{health.dailyCostGbp.estimated.toFixed(4)} ? Actual ?{health.dailyCostGbp.actual.toFixed(4)} / ?{health.dailyCostGbp.ceiling.toFixed(2)}
       <small style={{display:'block',opacity:0.75}}>Variable LLM/data API spend only; excludes base Vercel, Convex &amp; TypeDB Cloud hosting</small>
      </dd>
     </div>
     <div className="cc-strip-item">
      <dt>Deterministic pipeline</dt>
      <dd data-testid="agent-ops-isolation">
       {health.deterministicCollectionHealthy?'Healthy · isolated from AI failures':'Attention needed'}
      </dd>
     </div>
    </dl>
   </div>

   <div className="cc-widgets" style={{marginBottom:'12px'}} data-testid="agent-ops-layers">
    <article className={`cc-widget cc-${layerTone(layers.scheduler.status)}`} data-testid="layer-scheduler">
     <h3>1. Scheduler working</h3>
     <p><strong>{layers.scheduler.label}</strong> — {layers.scheduler.detail}</p>
    </article>
    <article className={`cc-widget cc-${layerTone(layers.collector.status)}`} data-testid="layer-collector">
     <h3>2. Collector working</h3>
     <p><strong>{layers.collector.label}</strong> — {layers.collector.detail}</p>
    </article>
    <article className={`cc-widget cc-${layerTone(layers.source.status)}`} data-testid="layer-source">
     <h3>3. Source available</h3>
     <p><strong>{layers.source.label}</strong> — {layers.source.detail}</p>
    </article>
    <article className={`cc-widget cc-${layerTone(layers.evidence.status)}`} data-testid="layer-evidence">
     <h3>4. Valid evidence imported</h3>
     <p><strong>{layers.evidence.label}</strong> — {layers.evidence.detail}</p>
    </article>
    <article className={`cc-widget cc-${layerTone(layers.briefing.status)}`} data-testid="layer-briefing">
     <h3>5. Research briefing generated</h3>
     <p><strong>{layers.briefing.label}</strong> — {layers.briefing.detail}</p>
    </article>
   </div>

   <div className="cc-table-wrap" tabIndex={0} role="region" aria-label="Scheduled collectors and remote research agents">
    <table className="cc-table" data-testid="agent-ops-table">
     <caption className="cc-sr">Scheduled deterministic collectors and Antigravity Remote Agents</caption>
     <thead>
      <tr>
       <th scope="col">Agent / Collector &amp; Purpose</th>
       <th scope="col">Status &amp; Environment</th>
       <th scope="col">Last successful run</th>
       <th scope="col">Last failure / Provider error</th>
       <th scope="col">Next scheduled run</th>
       <th scope="col">Data freshness</th>
       <th scope="col">Sources, evidence &amp; efficiency</th>
       <th scope="col">Model cost (Est. / Actual)</th>
      </tr>
     </thead>
     <tbody>
      {health.jobs.map(job=>(
       <tr key={job.jobKey} data-job={job.jobKey}>
        <th scope="row">
         {job.name}
         <small>{CATEGORY_LABELS[job.category]} — {job.purpose}</small>
        </th>
        <td>
         <span className={`cc-status ${job.enabled&&!job.pausedReason&&!job.lastErrorCode?'cc-delayed':'cc-stale'}`} data-testid={`job-status-${job.jobKey}`}>
          {job.pausedReason?`Paused (${job.pausedReason})`:!job.enabled?'Disabled':job.lastErrorCode?'Failed':'Enabled'}
         </span>
         <small data-testid={`job-env-${job.jobKey}`}>Env: {job.environment}</small>
         {onToggleJob&&(
          <small>
           <button
            type="button"
            className="cc-fix"
            onClick={()=>{void onToggleJob(job.jobKey,!job.enabled);}}
           >
            {job.enabled?'Disable':'Enable'}
           </button>
          </small>
         )}
        </td>
        <td data-testid={`job-last-success-${job.jobKey}`}>
         {job.lastSuccessAt?iso(job.lastSuccessAt):'No completed run yet'}
         {job.lastSuccessAt&&<small>{age(now-job.lastSuccessAt)}</small>}
        </td>
        <td data-testid={`job-last-failure-${job.jobKey}`}>
         {job.lastErrorCode?(
          <>
           <span className="cc-down" data-testid={`job-error-${job.jobKey}`}>{job.lastErrorCode}</span>
           {job.lastFailureAt&&<small>{iso(job.lastFailureAt)} ({age(now-job.lastFailureAt)})</small>}
          </>
         ):job.lastFailureAt?(
          <span>{iso(job.lastFailureAt)} (recovered)</span>
         ):(
          <span>{fixture?'Synthetic fixture healthy':'None · No provider errors'}</span>
         )}
        </td>
        <td data-testid={`job-next-run-${job.jobKey}`}>{iso(job.nextRunAt)}</td>
        <td>
         <span className={`cc-fresh cc-${job.freshness==='fresh'?'fresh':job.freshness==='stale'?'stale':'unavailable'}`} data-testid={`job-freshness-${job.jobKey}`}>
          {job.freshness==='fresh'?'Fresh':job.freshness==='delayed'?'Delayed':job.freshness==='stale'?'Stale':'Unavailable'}
         </span>
        </td>
        <td>
         {job.sourcesAdded} source{job.sourcesAdded===1?'':'s'} · {job.evidenceAdded} promoted
         {job.pendingVerification>0&&<small>{job.pendingVerification} pending verification</small>}
         {(job.providerRequestsLastRun>0||job.processingDurationMsLastRun!==null||job.conditionalSkipLastRun)&&(
          <small>
           {job.providerRequestsLastRun} req{job.providerRequestsLastRun===1?'':'s'}
           {job.processingDurationMsLastRun!==null?` · ${job.processingDurationMsLastRun}ms`:''}
           {job.conditionalSkipLastRun?' · cursor unchanged (0 model calls)':''}
          </small>
         )}
        </td>
        <td>{costText(job)}</td>
       </tr>
      ))}
     </tbody>
    </table>
   </div>

   {health.graphProjection&&(
    <div className="cc-strip" style={{marginTop:'12px'}} data-testid="agent-ops-graph-projection">
     <dl>
      <div className="cc-strip-item">
       <dt>TypeDB Cloud graph</dt>
       <dd>
        <code>{health.graphProjection.databaseName}</code> ({health.graphProjection.productionIsolated?'production isolated':'staging'})
       </dd>
      </div>
      <div className="cc-strip-item">
       <dt>Outbox reconciliation</dt>
       <dd data-testid="agent-ops-graph-reconciled">
        {health.graphProjection.projectedCount} projected · seq #{health.graphProjection.lastProjectedSequence} · {health.graphProjection.reconciled?'Reconciled':'Pending sync'}
       </dd>
      </div>
      <div className="cc-strip-item">
       <dt>Projection lag &amp; dead-letter (lag = max(now - oldest pending/retrying createdAtMs), 0ms when empty)</dt>
       <dd>
        {health.graphProjection.maxProjectionLagMs}ms lag · {health.graphProjection.deadLetterCount} dead-letter · {health.graphProjection.pendingCount} pending
       </dd>
      </div>
      <div className="cc-strip-item">
       <dt>Graph governance</dt>
       <dd>
        {health.graphProjection.humanReviewCount} relationship review(s) · <Link href="/data-room">Open Macro Data Room →</Link>
       </dd>
      </div>
     </dl>
    </div>
   )}

   {health.evidenceChat&&(
    <div className="cc-strip" style={{marginTop:'12px'}} data-testid="agent-ops-evidence-chat">
     <dl>
      <div className="cc-strip-item">
       <dt>Evidence-Locked AI Chat ({health.evidenceChat.modelId})</dt>
       <dd data-testid="agent-ops-chat-status">
        {health.evidenceChat.geminiEnabled&&health.evidenceChat.geminiConfigured
         ?'Live Gemini + closed-evidence validator active'
         :'Deterministic closed-evidence synthesis + validator active'}
        {' · '}
        <Link href="/research-chat">Open Research Chat →</Link>
       </dd>
      </div>
      <div className="cc-strip-item">
       <dt>Research Q&amp;A audit ({health.evidenceChat.totalTurns} turns)</dt>
       <dd data-testid="agent-ops-chat-turns">
        {health.evidenceChat.supportedCount} supported · {health.evidenceChat.partiallySupportedCount} partial · {health.evidenceChat.unsupportedCount} abstained ({Math.round(health.evidenceChat.unsupportedRate*100)}%)
       </dd>
      </div>
      <div className="cc-strip-item">
       <dt>Independent validator &amp; provider gates</dt>
       <dd data-testid="agent-ops-chat-validator">
        {health.evidenceChat.validationRejectionCount} hallucination rejection(s) · {health.evidenceChat.providerErrorCount} provider error(s)
       </dd>
      </div>
      <div className="cc-strip-item">
       <dt>Chat token &amp; cost budget</dt>
       <dd data-testid="agent-ops-chat-cost">
        {health.evidenceChat.inputTokensTotal} in / {health.evidenceChat.outputTokensTotal} out tok · £{health.evidenceChat.dailySpendGbp.toFixed(4)} today / £{health.evidenceChat.dailyCeilingGbp.toFixed(2)} ceiling
       </dd>
      </div>
     </dl>
    </div>
   )}

   {health.environmentAudit&&health.environmentAudit.length>0&&(
    <div className="cc-widgets" style={{marginTop:'12px'}} data-testid="agent-ops-environment-audit">
     {health.environmentAudit.map(svc=>{
      const tone=
       svc.status==='connected'
        ?'ok'
        :svc.status==='configured_not_tested'||svc.status==='intentionally_disabled'||svc.status==='degraded'
         ?'warn'
         :'alert';
      return (
       <article
        key={svc.serviceId}
        className={`cc-widget cc-${tone}`}
        data-testid={`env-audit-${svc.serviceId}`}
       >
        <h3>{svc.name}</h3>
        <p>
         <strong data-testid={`env-audit-status-${svc.serviceId}`}>{svc.status}</strong> · <code>{svc.environmentTarget}</code> — {svc.detail}
        </p>
       </article>
      );
     })}
    </div>
   )}

   {health.providers.length>0&&(
    <div className="cc-widgets" style={{marginTop:'12px'}} data-testid="agent-ops-providers">
     {health.providers.map(p=>(
      <article
       key={p.providerId}
       className={`cc-widget cc-${p.status==='credentials_expired'||p.status==='outage'?'alert':p.status==='unconfigured'||p.status==='rate_limited'?'warn':'ok'}`}
       data-testid={`provider-${p.providerId}`}
      >
       <h3>{p.label} ({p.category.replace('_',' ')})</h3>
       <p>
        <strong>{p.status.replace('_',' ')}</strong>
        {p.errorCode?` · ${p.errorCode}`:''} — {p.detail}{' '}
        {p.category==='broker_readonly'&&<Link href="/settings/brokers">Broker settings</Link>}
       </p>
      </article>
     ))}
    </div>
   )}

   {health.executionPaths.length>0&&(
    <div className="cc-widgets" style={{marginTop:'12px'}} data-testid="agent-ops-execution-paths">
     {health.executionPaths.map(ep=>(
      <article
       key={ep.id}
       className={`cc-widget cc-${ep.status==='active'?'ok':ep.status==='standby'?'warn':'alert'}`}
       data-testid={`exec-path-${ep.id}`}
      >
       <h3>{ep.label}</h3>
       <p>
        <strong>{ep.deployment.replace(/_/g,' ')} ({ep.status})</strong> — {ep.detail}
       </p>
      </article>
     ))}
    </div>
   )}

   {health.recentRuns&&health.recentRuns.length>0&&(
    <div style={{marginTop:'12px'}} data-testid="agent-ops-run-audit-trail">
     <h3 style={{fontSize:'0.95rem',marginBottom:'8px'}}>Expandable run audit trail ({health.recentRuns.slice(0,8).length} most recent cloud executions)</h3>
     {health.recentRuns.slice(0,8).map(run=>(
      <details
       key={run.runId}
       className="cc-collapsible"
       style={{marginBottom:'6px'}}
       data-testid={`run-audit-${run.runId}`}
      >
       <summary>
        <strong>{run.jobKey}</strong> · <code>{run.runId}</code> · {run.status} · {iso(run.startedAt)}
        {run.processingDurationMs!==null?` (${run.processingDurationMs}ms)`:''} · {run.sourcesDiscovered} src / {run.evidencePromoted} promoted
       </summary>
       <div className="cc-strip" style={{marginTop:'6px'}}>
        <dl>
         <div className="cc-strip-item">
          <dt>Window &amp; environment</dt>
          <dd>
           Start {iso(run.startedAt)} → Finish {run.finishedAt?iso(run.finishedAt):'in progress'} ({run.environment})
          </dd>
         </div>
         <div className="cc-strip-item">
          <dt>Cursor transition</dt>
          <dd style={{wordBreak:'break-all'}}>
           <code>{run.cursorBefore??'null'}</code> → <code>{run.cursorAfter??'null'}</code>
          </dd>
         </div>
         <div className="cc-strip-item">
          <dt>Records &amp; evidence</dt>
          <dd>
           {run.sourcesDiscovered} discovered · {run.evidenceStaged} staged · {run.evidencePromoted} promoted · {run.duplicatesSkipped} skipped · {run.pendingVerification} pending review
          </dd>
         </div>
         <div className="cc-strip-item">
          <dt>Model / collector &amp; cost</dt>
          <dd>
           {run.modelVersion??'deterministic-collector (non-AI)'} · {run.providerRequestsCount} HTTP req(s) · Est. £{run.estimatedCostGbp.toFixed(4)} / Actual £{(run.actualCostGbp??0).toFixed(4)}
          </dd>
         </div>
        </dl>
        <p style={{margin:'6px 0 0',fontSize:'0.85rem'}}>
         <strong>Audit summary:</strong> {run.summary}
         {run.errorCode?` · Error: ${run.errorCode}`:''}
        </p>
       </div>
      </details>
     ))}
    </div>
   )}
  </section>
 );
}
