'use client';
import { ClerkProvider, SignInButton, UserButton, useAuth } from '@clerk/nextjs';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import { Authenticated, Unauthenticated, AuthLoading, ConvexReactClient, useMutation, useQuery } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { useState } from 'react';
import ProposalReview from '../components/proposal-review';
import { useConvexClerkAuth } from '../lib/clerk-convex-auth';
import { validateReviewContext, type ReviewContext } from '../lib/review-context';

type Row = {_id:string;reviewContext?:ReviewContext;name?:string;symbol?:string;quantity?:number;status?:string;reason?:string;cashGbp?:number;metric?:string;value?:number;unit?:string;source?:string;action?:string;detail?:string;at?:number};
type Data = {portfolios:Row[]; proposals:Row[]; experiments:Row[]; evidence:Row[]; forecasts:Row[]; audit:Row[]; fills:Row[]};
const dashboardRef=makeFunctionReference<'query',Record<string,never>,Data>('research:dashboard');
const portfolioRef=makeFunctionReference<'mutation',{name:string;capitalGbp:number;synthetic:boolean},string>('research:createPortfolio');
const proposalRef=makeFunctionReference<'mutation',{portfolioId:string;symbol:string;quantity:number;reason:string;reviewContext?:ReviewContext},string>('research:propose');
const reviewRef=makeFunctionReference<'mutation',{proposalId:string;decision:'approve'|'reject';note:string},null>('research:review');
const executeRef=makeFunctionReference<'mutation',{proposalId:string},string>('research:executePaper');
const freezeRef=makeFunctionReference<'mutation',{name:string;cutoff:number;evidenceIds:string[];protocol:string},string>('research:freezeExperiment');

export default function ConnectedWorkspace(){
  const [client]=useState(()=>new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!));
  return <ClerkProvider><ConvexProviderWithClerk client={client} useAuth={useConvexClerkAuth}>
    <AuthLoading><p>Checking your session…</p></AuthLoading>
    <Unauthenticated><p>Sign in to access your private research records.</p><SignInButton mode="modal"><button>Sign in</button></SignInButton></Unauthenticated>
    <Authenticated><UserButton/><Records/></Authenticated>
  </ConvexProviderWithClerk></ClerkProvider>;
}
function Records(){
  const data=useQuery(dashboardRef,{});
  const create=useMutation(portfolioRef), propose=useMutation(proposalRef), review=useMutation(reviewRef), execute=useMutation(executeRef), freeze=useMutation(freezeRef);
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[capital,setCapital]=useState(10000),[symbol,setSymbol]=useState('MSFT'),[quantity,setQuantity]=useState(1),[reason,setReason]=useState(''),[note,setNote]=useState(''),[protocol,setProtocol]=useState(''),[selected,setSelected]=useState<string[]>([]);
  const [reviewJson,setReviewJson]=useState('');
  const contextFromInput=()=>reviewJson.trim()?validateReviewContext(JSON.parse(reviewJson) as ReviewContext):undefined;
  async function act(fn:()=>Promise<unknown>){setBusy(true);try{await fn();setMessage('Saved to your private workspace.');}catch(e){setMessage(e instanceof Error?e.message:'Request failed');}finally{setBusy(false);}}
  if(!data)return <p>Loading research records…</p>;
  const style={padding:24,border:'1px solid #344047',borderRadius:16,marginTop:24};
  return <div><p role="status">{message}</p><section style={style}><h2>Paper portfolios</h2><p>Observed-data portfolios require validated, fresh quotes from internal ingestion before a fill can occur.</p>
    {data.portfolios.map(p=><p key={p._id}>{p.name}: £{p.cashGbp?.toFixed(2)} available</p>)}
    <label>Starting capital (£) <input type="number" min={5000} max={20000} value={capital} onChange={e=>setCapital(Number(e.target.value))}/></label> <button disabled={busy} onClick={()=>act(()=>create({name:'Benchmark 001',capitalGbp:capital,synthetic:false}))}>Create paper portfolio</button>
  </section><section style={style}><h2>Proposals and human review</h2>
    <label>Company <select value={symbol} onChange={e=>setSymbol(e.target.value)}>{['MSFT','GOOGL','AMZN','NVDA','INTC','CRWV'].map(s=><option key={s}>{s}</option>)}</select></label>
    <label> Shares <input type="number" min={0.01} step={0.01} value={quantity} onChange={e=>setQuantity(Number(e.target.value))}/></label>
    <label> Evidence and rationale <input value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <label>Structured review context JSON (optional for legacy research)<textarea rows={5} value={reviewJson} onChange={e=>setReviewJson(e.target.value)} placeholder="Paste the exported reviewContext object from the stress monitor."/></label>
    <button disabled={busy||!data.portfolios.length||!reason.trim()} onClick={()=>act(()=>propose({portfolioId:data.portfolios[0]._id,symbol,quantity,reason,reviewContext:contextFromInput()}))}>Propose paper purchase</button>
    <p>New proposals use the first portfolio. Risk checks run again at execution; approval alone does not create a fill.</p>
    <label>Review note <input value={note} onChange={e=>setNote(e.target.value)}/></label>
    {data.proposals.map(p=><article key={p._id} style={{padding:12,borderBottom:'1px solid #344047'}}><b>{p.symbol} · {p.quantity} shares · {p.status}</b><p>{p.reason}</p><ProposalReview context={p.reviewContext} quantity={p.quantity}/>{p.status==='pending'&&<><button disabled={busy||!note.trim()} onClick={()=>act(()=>review({proposalId:p._id,decision:'approve',note}))}>Approve</button> <button disabled={busy||!note.trim()} onClick={()=>act(()=>review({proposalId:p._id,decision:'reject',note}))}>Reject</button></>}{p.status==='approved'&&<button disabled={busy} onClick={()=>act(()=>execute({proposalId:p._id}))}>Check risk and simulate fill</button>}</article>)}
  </section><section style={style}><h2>Freeze evidence</h2><p>{data.evidence.length} source records · {data.experiments.length} frozen experiments · {data.forecasts.length} forecasts</p>
    {data.evidence.map(e=><label key={e._id} style={{display:'block'}}><input type="checkbox" checked={selected.includes(e._id)} onChange={ev=>setSelected(ev.target.checked?[...selected,e._id]:selected.filter(id=>id!==e._id))}/>{e.symbol} · {e.metric}: {e.value} {e.unit} · {e.source}</label>)}
    <label>Experiment protocol <textarea value={protocol} onChange={e=>setProtocol(e.target.value)} placeholder="Define participants, horizon, neutral band, baseline, costs and deadline."/></label>
    <button disabled={busy||!selected.length||!protocol.trim()} onClick={()=>act(()=>freeze({name:'Benchmark 001',cutoff:Date.now(),evidenceIds:selected,protocol}))}>Freeze selected evidence</button>
  </section><section style={style}><h2>Audit trail</h2>{data.audit.length===0?<p>No recorded actions yet.</p>:data.audit.map(a=><p key={a._id}>{a.action} · {a.detail}</p>)}</section></div>;
}

