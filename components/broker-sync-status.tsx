'use client';
import {useState} from 'react';
import {BROKER_ERROR_MESSAGES,type BrokerErrorCode} from '../lib/brokers/contracts';
import {rateLimitStatus,type RateLimit} from '../lib/brokers/rate-limits';

export type SyncConnection={connectionId:string;status:string;maskedKey:string;lastSuccessfulSyncAt:number|null;lastVerifiedAt:number|null;lastErrorCode:string|null;nextAllowedAt:number;rateLimits:RateLimit[]};
export type SyncSchedule={enabled:boolean;intervalMinutes:number;nextRunAt:number;lastRunAt:number|null;lastOutcome:string|null;pausedReason:string|null};

/** Distinct, plain-language labels for every connection error class. */
export const ERROR_LABEL:Record<string,string>={invalid_credentials:'Invalid credentials',environment_mismatch:'Environment mismatch',missing_permissions:'Missing API permissions',rate_limited:'Provider rate limit',timeout:'Temporary network failure',provider_unavailable:'Temporary network failure',redirect_blocked:'Temporary network failure',invalid_response:'Temporary provider failure',credentials_revoked:'Expired or revoked credentials',disconnected:'Configuration problem',invalid_configuration:'Configuration problem'};
const iso=(t:number|null|undefined)=>t?new Date(t).toISOString().replace('T',' ').replace(/:\d\d\.\d{3}Z$/,' UTC'):'—';
function ago(ms:number){const m=Math.round(ms/60000);return m<1?'under a minute':m<60?`${m} min`:m<2880?`${Math.round(m/60)} h`:`${Math.round(m/1440)} days`;}
export function connectionLabel(c:SyncConnection|null){if(!c)return {label:'Not connected',tone:'warn'};if(c.status==='connected')return {label:'Connected (read-only)',tone:'ok'};if(c.status==='partial')return {label:'Connected, history unavailable',tone:'warn'};if(c.status==='syncing')return {label:'Synchronising…',tone:'info'};if(c.status==='saved')return {label:'Saved, not yet tested',tone:'info'};return {label:ERROR_LABEL[c.lastErrorCode??'']??'Error',tone:'alert'};}

/**
 * Connection and synchronisation status for one environment. Reads stored state only; the Synchronise button calls the
 * server, which enforces the per-account lease, cooldown and provider rate limits (so it is safe to click from many tabs).
 */
export function BrokerSyncStatus({environment,connection,schedule,now,dataAt,onSync,onAuto,compact=false}:{environment:'demo'|'live';connection:SyncConnection|null;schedule:SyncSchedule|null;now:number;dataAt:number|null;onSync?:()=>Promise<string>;onAuto?:(enabled:boolean,interval:number)=>Promise<string>;compact?:boolean}){
 const[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[interval,setInterval_]=useState(schedule?.intervalMinutes??15);
 const status=connectionLabel(connection),rl=connection?rateLimitStatus(connection.rateLimits,connection.nextAllowedAt,now):null;
 const age=dataAt===null?null:now-dataAt,stale=age!==null&&age>15*60_000,waitMs=connection?Math.max(0,connection.nextAllowedAt-now):0;
 const run=async(f:()=>Promise<string>)=>{setBusy(true);try{setMessage(await f());}catch(e){setMessage(e instanceof Error?e.message:'Request failed');}finally{setBusy(false);}};
 const next=!connection?'—':!schedule||!schedule.enabled?'Automatic sync off':schedule.pausedReason?`Paused: ${ERROR_LABEL[schedule.pausedReason]??schedule.pausedReason}`:schedule.nextRunAt<=now?'Due now (runs while the dashboard is open or by the scheduler)':`${iso(schedule.nextRunAt)} (in ${ago(schedule.nextRunAt-now)})`;
 return <div className={`bs-status ${compact?'bs-compact':''}`} data-testid={`broker-sync-${environment}`} data-env={environment}>
  <dl>
   <div><dt>Environment</dt><dd><span className={`bs-env bs-env-${environment}`}>{environment==='live'?'LIVE (real money, read-only)':'DEMO (practice account)'}</span></dd></div>
   <div><dt>Saved key</dt><dd>{connection?`${connection.maskedKey} · ${environment} only`:'None saved for this environment'}</dd></div>
   <div><dt>Connection status</dt><dd><span className={`bs-pill bs-${status.tone}`} data-testid={`broker-status-${environment}`}>{status.label}</span>{connection?.status==='error'&&connection.lastErrorCode&&<small className="bs-detail">{BROKER_ERROR_MESSAGES[connection.lastErrorCode as BrokerErrorCode]??''}</small>}</dd></div>
   <div><dt>Last successful sync</dt><dd>{iso(connection?.lastSuccessfulSyncAt)}</dd></div>
   <div><dt>Data age</dt><dd className={stale?'bs-stale':''}>{age===null?'No snapshot':`${ago(age)} old${stale?' · stale':''}`}</dd></div>
   <div><dt>Next scheduled refresh</dt><dd>{next}</dd></div>
   <div><dt>Provider rate limit</dt><dd>{rl?<><span className={`bs-pill bs-${rl.state==='ok'?'ok':rl.state==='unknown'?'info':'warn'}`}>{rl.state==='ok'?'Within limits':rl.state==='unknown'?'Not observed yet':rl.state==='exhausted'?'Limit reached':'Cooling down'}</span><small className="bs-detail">{rl.detail}{rl.until?` · next request after ${iso(rl.until)}`:''}</small></>:'—'}</dd></div>
  </dl>
  <div className="bs-actions">
   {onSync&&connection&&<button className="button secondary" disabled={busy||waitMs>0} title={waitMs>0?`Available after ${iso(connection.nextAllowedAt)}`:''} onClick={()=>void run(onSync)}>{waitMs>0?`Synchronise (in ${Math.ceil(waitMs/1000)}s)`:'Synchronise now'}</button>}
   {onAuto&&connection&&<span className="bs-auto"><label>Every <select aria-label={`Automatic sync interval (${environment})`} value={interval} onChange={e=>setInterval_(Number(e.target.value))}>{[5,15,30,60,240].map(m=><option key={m} value={m}>{m} min</option>)}</select></label>
    <button className="button secondary" disabled={busy} onClick={()=>void run(()=>onAuto(!(schedule?.enabled??false),interval))}>{schedule?.enabled?'Turn automatic sync off':'Turn automatic sync on'}</button></span>}
  </div>
  {message&&<p role="status" className="bs-message">{message}</p>}
 </div>;
}
