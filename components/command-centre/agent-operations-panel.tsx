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
      <dt>Model cost (today / ceiling)</dt>
      <dd data-testid="agent-ops-cost">
       Est. £{health.dailyCostGbp.estimated.toFixed(4)} · Actual £{health.dailyCostGbp.actual.toFixed(4)} / £{health.dailyCostGbp.ceiling.toFixed(2)}
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

   {health.providers.length>0&&(
    <div className="cc-widgets" style={{marginTop:'12px'}} data-testid="agent-ops-providers">
     {health.providers.map(p=>(
      <article
       key={p.providerId}
       className={`cc-widget cc-${p.status==='credentials_expired'||p.status==='outage'?'alert':p.status==='unconfigured'||p.status==='rate_limited'?'warn':'ok'}`}
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
  </section>
 );
}
