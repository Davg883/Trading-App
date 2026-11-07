'use client';
import {useCallback,useEffect,useState} from 'react';
import {BrokerSyncStatus,type SyncConnection,type SyncSchedule} from './broker-sync-status';

type ListResponse={connections:(SyncConnection&{environment:'demo'|'live'})[];schedules:(SyncSchedule&{environment:'demo'|'live'})[]};
async function post(path:string,body:unknown){const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j?.error?.message??`Request failed (${r.status})`);return j;}

/**
 * Per-environment connection status and automatic synchronisation controls. Polls stored state from the server every
 * 30 seconds (a Convex read, never a Trading 212 request). Live and Demo keys are shown side by side so it is
 * unmistakable which saved key belongs to which environment.
 */
export default function BrokerSyncPanel(){
 const[data,setData]=useState<ListResponse|null>(null),[error,setError]=useState(''),[now,setNow]=useState(0);
 const load=useCallback(async()=>{try{const r=await fetch('/api/brokers',{cache:'no-store'});const j=await r.json();if(!r.ok)throw new Error(j?.error?.message??'Unavailable');setData(j);setError('');}catch(e){setError(e instanceof Error?e.message:'Unavailable');}},[]);
 useEffect(()=>{const tick=()=>{setNow(Date.now());};const t0=setTimeout(()=>{tick();void load();},0),a=setInterval(tick,1000),b=setInterval(()=>{if(document.visibilityState==='visible')void load();},30_000);return ()=>{clearTimeout(t0);clearInterval(a);clearInterval(b);};},[load]);
 if(error)return <section className="proof-panel bs-panel"><h2>Synchronisation</h2><p>{error}</p></section>;
 if(!data||!now)return null;
 const by=(e:'demo'|'live')=>data.connections.find(c=>c.environment===e)??null,sched=(e:'demo'|'live')=>data.schedules?.find(s=>s.environment===e)??null;
 const live=by('live'),demo=by('demo'),sameKey=live&&demo&&live.maskedKey===demo.maskedKey;
 return <section className="proof-panel bs-panel" aria-labelledby="bs-title" data-testid="broker-sync-panel">
  <h2 id="bs-title">Saved connections and automatic synchronisation</h2>
  <p>Each saved key is encrypted for one environment only and is never tried against the other. Automatic synchronisation is off until you turn it on; it uses only these read-only keys and respects Trading 212 rate limits.</p>
  {sameKey&&<p className="bs-warning" role="alert" data-testid="same-key-warning">The same key ({live.maskedKey}) is saved for both Live and Demo. Trading 212 keys belong to one environment, so one of these connections will fail with an environment mismatch. Create a separate key in the matching Trading 212 account; your working connection is not changed automatically.</p>}
  <div className="bs-grid">{(['live','demo'] as const).map(env=>{const c=by(env);return <article key={env} className="bs-card"><h3>{env==='live'?'Live account':'Demo account'}</h3>
   <BrokerSyncStatus environment={env} connection={c} schedule={sched(env)} now={now} dataAt={c?.lastVerifiedAt??null}
    onSync={c?async()=>{await post('/api/brokers/sync',{connectionId:c.connectionId,environment:env,operation:'sync'});await load();return 'Synchronised.';}:undefined}
    onAuto={c?async(enabled,intervalMinutes)=>{await post('/api/brokers/schedule',{environment:env,enabled,intervalMinutes});await load();return enabled?`Automatic sync on every ${intervalMinutes} min.`:'Automatic sync off.';}:undefined}/></article>;})}</div>
 </section>;
}
