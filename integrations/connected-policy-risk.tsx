'use client';
import {ClerkProvider,SignInButton,UserButton,useAuth} from '@clerk/nextjs';
import {ConvexProviderWithClerk} from 'convex/react-clerk';
import {Authenticated,Unauthenticated,AuthLoading,ConvexReactClient,useQuery,useMutation} from 'convex/react';
import {makeFunctionReference} from 'convex/server';
import {useState} from 'react';
import type {PolicyRegistration,evaluatePolicyStudy} from '../lib/policy-risk';

type Metadata={caseId:string;externalId:string;name:string;mode:string;ingestedAt:number};
type Outcome={outcomeId:string;asOf:number;evaluatedAt:number;observationIds:string[];report:ReturnType<typeof evaluatePolicyStudy>};
type Registration={registrationId:string;name:string;cutoff:number;basis:'receipt'|'publication';registeredAt:number;experimentMode:string;registration:PolicyRegistration;observations:{observationId:string;externalId:string;capturedAt:number;ingestedAt:number}[];outcomes:Outcome[]};
type Detail={metadata:Metadata;registrations:Registration[]};
const listRef=makeFunctionReference<'query',Record<string,never>,Metadata[]>('policyRisk:list');
const detailRef=makeFunctionReference<'query',{caseId:string},Detail>('policyRisk:detail');
const registerRef=makeFunctionReference<'mutation',{caseId:string;name:string;cutoff:number;basis:'receipt'|'publication'},string>('policyRisk:register');
const iso=(t:number)=>new Date(t).toISOString();
const pct=(v:number|null|undefined)=>v==null?'—':`${(v*100).toFixed(2)}%`;
function stamp(value:string){if(!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value))||Date.parse(value)<0)throw new Error('Timestamp with explicit timezone required.');return Date.parse(value);}

export default function ConnectedPolicyRisk(){const [client]=useState(()=>new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!));return <ClerkProvider><ConvexProviderWithClerk client={client} useAuth={useAuth}><AuthLoading><p>Checking your session…</p></AuthLoading><Unauthenticated><p>Sign in to preserve private policy-risk registrations and outcome evaluations.</p><SignInButton mode="modal"><button className="button primary">Sign in</button></SignInButton></Unauthenticated><Authenticated><UserButton/><Registry/></Authenticated></ConvexProviderWithClerk></ClerkProvider>;}

function Registry(){const rows=useQuery(listRef,{}),[selected,setSelected]=useState('');return <div><p>Trusted server ingestion imports source packages and later observation sets. Browser clients can register a frozen study but cannot submit returns, scores or classifications.</p><div className="proof-form"><label>Private case<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Choose an imported case</option>{rows?.map(r=><option key={r.caseId} value={r.caseId}>{r.name} · {r.externalId}</option>)}</select></label></div>{rows?.length===0&&<p>No policy-risk case has been imported.</p>}{selected&&<PrivateCase key={selected} caseId={selected}/>}</div>;}

function PrivateCase({caseId}:{caseId:string}){
 const data=useQuery(detailRef,{caseId}),register=useMutation(registerRef),[name,setName]=useState('Benchmark 001.2 retrospective event study'),[cutoff,setCutoff]=useState(''),[basis,setBasis]=useState<'receipt'|'publication'>('receipt'),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 async function save(){setBusy(true);try{await register({caseId,name,cutoff:stamp(cutoff),basis});setMessage('Frozen registration recorded. It is retrospective, not a prior prediction, and grants no execution authority.');}catch(e){setMessage(e instanceof Error?e.message:'Registration failed');}finally{setBusy(false);}}
 if(!data)return <p>Loading private case…</p>;
 return <div><h3>{data.metadata.name}</h3><p>{data.metadata.mode} · imported {iso(data.metadata.ingestedAt)}</p>
  <div className="proof-form"><label>Registration name<input value={name} onChange={e=>setName(e.target.value)}/></label><label>Evidence cutoff · ISO timestamp<input value={cutoff} onChange={e=>setCutoff(e.target.value)} placeholder={iso(data.metadata.ingestedAt)}/></label><label>Knowledge basis<select value={basis} onChange={e=>setBasis(e.target.value as 'receipt'|'publication')}><option value="receipt">Received by cutoff</option><option value="publication">Published by cutoff (reconstruction)</option></select></label></div>
  <button className="button secondary" disabled={busy} onClick={()=>void save()}>Register frozen study</button>{message&&<p role="status">{message}</p>}
  {data.registrations.map(r=><details key={r.registrationId}><summary>{r.name} · {r.experimentMode.replaceAll('_',' ')} · registered {iso(r.registeredAt)}</summary><p>Cutoff {iso(r.cutoff)} ({r.basis}) · {r.registration.windows.length} windows · {r.observations.length} later observation sets</p>{r.observations.map(o=><p key={o.observationId}>{o.externalId} · captured {iso(o.capturedAt)} · ingested {iso(o.ingestedAt)}</p>)}{r.outcomes.map(o=><div key={o.outcomeId}><strong>Evaluated as of {iso(o.asOf)}</strong><p>{o.report.outcomes.filter(x=>x.status==='complete').length}/{o.report.outcomes.length} windows complete</p>{o.report.hypotheses.map(h=><p key={`${h.hypothesisId}-${h.horizon}`}>{h.hypothesisId} · {h.horizon} sessions · {h.status} {pct(h.value)}</p>)}</div>)}{!r.outcomes.length&&<p>No outcome evaluation recorded yet.</p>}</details>)}
 </div>;
}
