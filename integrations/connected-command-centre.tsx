'use client';
import {ClerkProvider,SignInButton,useAuth} from '@clerk/nextjs';
import {ConvexProviderWithClerk} from 'convex/react-clerk';
import {Authenticated,Unauthenticated,AuthLoading,ConvexReactClient,useQuery} from 'convex/react';
import {makeFunctionReference} from 'convex/server';
import {useEffect,useState} from 'react';
import {CommandCentre,type OperationsOverview,type PortfolioData,type TradingOverview} from '../components/command-centre/command-centre';
import type {ResearchFeed} from '../lib/portfolio/research-feed';

const portfolioRef=makeFunctionReference<'query',Record<string,never>,PortfolioData>('portfolio:overview');
const tradingRef=makeFunctionReference<'query',Record<string,never>,TradingOverview>('trading:overview');
const operationsRef=makeFunctionReference<'query',Record<string,never>,OperationsOverview>('operations:overview');
function useNow(){const[now,setNow]=useState(0);useEffect(()=>{const tick=()=>setNow(Date.now());const first=setTimeout(tick,0),id=setInterval(tick,30_000);return ()=>{clearTimeout(first);clearInterval(id);};},[]);return now;}

type Props={feed:ResearchFeed;flags:{demo:boolean;live:boolean}};
export default function ConnectedCommandCentre(props:Props){const[client]=useState(()=>new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!));return <ClerkProvider><ConvexProviderWithClerk client={client} useAuth={useAuth}>
 <AuthLoading><p className="cc-loading">Checking your session…</p></AuthLoading>
 <Unauthenticated><SignedOut {...props}/></Unauthenticated>
 <Authenticated><SignedIn {...props}/></Authenticated>
</ConvexProviderWithClerk></ClerkProvider>;}
function SignedOut({feed,flags}:Props){const now=useNow();if(!now)return null;return <><div className="cc-signin"><SignInButton mode="modal"><button className="button primary">Sign in to load your account</button></SignInButton></div><CommandCentre portfolio={null} trading={null} feed={feed} flags={flags} now={now} signedIn={false} configured/></>;}
async function post(path:string,body:unknown){const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j?.error?.message??`Request failed (${r.status})`);return j;}
/**
 * While the owner has the dashboard open and visible, ask the server every 60 s whether an opted-in schedule is due.
 * The server answers from Convex and only calls Trading 212 when a schedule is due and this caller wins the claim,
 * so many tabs cause at most one provider sync per due run. Saved snapshots arrive through the reactive Convex query.
 */
function useAutoSyncHeartbeat(){useEffect(()=>{let stopped=false;const beat=()=>{if(stopped||document.visibilityState!=='visible')return;void fetch('/api/brokers/auto-sync',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).catch(()=>{});};const first=setTimeout(beat,5_000),id=setInterval(beat,60_000);return ()=>{stopped=true;clearTimeout(first);clearInterval(id);};},[]);}
function SignedIn({feed,flags}:Props){
 const portfolio=useQuery(portfolioRef,{});
 const trading=useQuery(tradingRef,{});
 const operations=useQuery(operationsRef,{});
 const now=useNow();
 useAutoSyncHeartbeat();
 if(!portfolio||!now)return <p className="cc-loading">Loading your account…</p>;
 return <CommandCentre
  portfolio={portfolio}
  trading={trading??null}
  operations={operations??null}
  feed={feed}
  flags={flags}
  now={now}
  signedIn
  configured
  onSync={async(environment,connectionId)=>{await post('/api/brokers/sync',{connectionId,environment,operation:'sync'});return 'Synchronised. Figures update automatically.';}}
  onToggleJob={async(jobKey,enabled)=>{await post('/api/operations/settings',{action:'set_job_enabled',jobKey,enabled});}}
 />;
}

/** Used when accounts are not configured on this server: no providers, explicit unavailable states. */
export function UnconfiguredCommandCentre({feed,flags}:Props){const now=useNow();if(!now)return null;return <CommandCentre portfolio={null} trading={null} feed={feed} flags={flags} now={now} signedIn={false} configured={false}/>;}
