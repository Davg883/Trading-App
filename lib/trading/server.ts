import 'server-only';
import {auth} from '@clerk/nextjs/server';
import {ConvexHttpClient} from 'convex/browser';
import {makeFunctionReference} from 'convex/server';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {assertSameOrigin} from '../research-import-server';
import {BrokerError,brokerCredentialsSchema,type BrokerEnvironment,type BrokerSyncSnapshot} from '../brokers/contracts';
import {decryptCredentials,encryptCredentials,encryptedBrokerCredentialsSchema,maskApiKey,vaultConfigured} from '../brokers/vault';
import {Trading212OrderClient} from '../brokers/trading212-orders';
import {RESEARCH_ONLY_ERROR_CODE,RESEARCH_ONLY_MESSAGE,executionPermitted} from './execution-boundary';
import {confirmationPayload,evaluateOrderRisk,orderDraftSchema,reconcileCandidates,brokerQuantity,type AccountState,type Instrument,type PriceReference,type RiskLimits} from './order-model';

/**
 * Server-side execution controls for /api/trading. Every gate is enforced here and again in Convex:
 * signed-in owner, active reviewer grant, approved order, passed deterministic risk, fresh price reference,
 * one-time confirmation of exact details, server execution flag (+ Live emergency switch), and a separately
 * opted-in trading key. Read-only credentials are never used to place orders and never upgraded.
 */
const headers={'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Vary':'Cookie'};
class TradingError extends Error{constructor(readonly code:string,readonly status:number,message:string){super(message);}}
const json=(body:unknown,status=200)=>Response.json(body,{status,headers});
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
type Who={owner:string;user:ConvexHttpClient;admin:ConvexHttpClient};

/** Environment flags are necessary but never sufficient: the build must also grant execution authority, which this build does not. */
export function executionFlag(environment:BrokerEnvironment,env:Record<string,string|undefined>=process.env){if(!executionPermitted())return false;return environment==='live'?env.LIVE_TRADING_ENABLED==='true':env.DEMO_TRADING_ENABLED==='true';}

function client(){const url=process.env.NEXT_PUBLIC_CONVEX_URL;if(!url)throw new TradingError('not_configured',503,'Convex is not configured');return new ConvexHttpClient(url,{logger:false,fetch:(i,init)=>fetch(i,{...init,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15_000)})});}
async function context():Promise<Who>{
 if(!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY||!process.env.CLERK_SECRET_KEY||!vaultConfigured()||!process.env.CONVEX_BROKER_ADMIN_KEY)throw new TradingError('not_configured',503,'Trading storage is not configured');
 const session=await auth();if(!session.userId)throw new TradingError('sign_in_required',401,'Sign in required');
 const token=(await session.getToken({template:'convex'}).catch(()=>null))??(await session.getToken().catch(()=>null));if(!token)throw new TradingError('sign_in_required',401,'Sign in required');
 const user=client();user.setAuth(token);
 const {owner}=await user.query(makeFunctionReference<'query',Record<string,never>,{owner:string}>('recovery:viewer'),{});if(!owner)throw new TradingError('sign_in_required',401,'Sign in required');
 const admin=client();(admin as unknown as {setAdminAuth(t:string):void}).setAdminAuth(process.env.CONVEX_BROKER_ADMIN_KEY);
 return {owner,user,admin};
}
const iq=(name:string)=>makeFunctionReference<'query'>(`trading:${name}`),im=(name:string)=>makeFunctionReference<'mutation'>(`trading:${name}`);
type OrderRow={orderId:string;state:string;environment:BrokerEnvironment;ticker:string;draft:unknown;priceReference:PriceReference|null;riskPassed:boolean;riskEvaluatedAt:number|null;brokerOrderId:number|null;knownBrokerIdsBefore:number[];submittingAt:number|null;limits:RiskLimits;liveKillSwitchEngaged:boolean;optedInAt:number|null};
async function order(who:Who,orderId:string){return await who.admin.query(iq('orderInternal'),{owner:who.owner,orderId}) as unknown as OrderRow;}
async function tradingClient(who:Who,environment:BrokerEnvironment,executionEnabled=false){
 const {encryptedPayload}=await who.admin.query(iq('tradingVaultInternal'),{owner:who.owner,environment}) as {encryptedPayload:string};
 const creds=decryptCredentials(encryptedBrokerCredentialsSchema.parse(JSON.parse(encryptedPayload)),who.owner,environment,process.env,'orders');
 return new Trading212OrderClient(environment,creds,{executionEnabled});
}

// Rate-limit spacing across requests (per owner, environment and resource) on this server instance.
const lastCall=new Map<string,number>();
function spaced(who:Who,environment:string,op:string,ms:number){const k=`${who.owner}|${environment}|${op}`,now=Date.now(),next=(lastCall.get(k)??0)+ms;if(next>now)throw new TradingError('rate_limited',429,`Wait ${Math.ceil((next-now)/1000)}s before repeating this broker request`);lastCall.set(k,now);}
const instrumentCache=new Map<string,{at:number;items:Instrument[]}>();
async function instruments(who:Who,environment:BrokerEnvironment){const k=`${who.owner}|${environment}`,hit=instrumentCache.get(k);if(hit&&Date.now()-hit.at<10*60_000)return hit.items;spaced(who,environment,'instruments',50_000);const items=await (await tradingClient(who,environment)).instruments();instrumentCache.set(k,{at:Date.now(),items});return items;}

/** Builds account state and an indicative price reference from the latest read-only broker snapshot. */
export function accountFromSnapshot(s:BrokerSyncSnapshot):AccountState{
 return {currency:s.summary.data.currency,cashAvailable:s.summary.data.cash.availableToTrade,totalValue:s.summary.data.totalValue,
  positions:(s.positions?.data??[]).map(p=>({ticker:p.instrument.ticker,quantity:p.quantity,quantityAvailableForTrading:p.quantityAvailableForTrading,currentValueAccount:p.walletImpact.currentValue})),
  realisedLossToday:null,syncedAt:Math.min(s.summary.retrievedAt,s.positions?.retrievedAt??s.summary.retrievedAt)};
}
export function priceFromSnapshot(s:BrokerSyncSnapshot,ticker:string):PriceReference|null{
 const p=s.positions?.data.find(x=>x.instrument.ticker===ticker);if(!p||p.currentPrice===null||p.currentPrice<=0||!s.positions)return null;
 const same=p.instrument.currency===s.summary.data.currency,fx=!same&&p.quantity&&p.walletImpact.currentValue?p.walletImpact.currentValue/(p.quantity*p.currentPrice):null;
 return {ticker,price:p.currentPrice,priceCurrency:p.instrument.currency,fxRateToAccount:same?1:fx,source:'broker_position',observedAt:s.positions.retrievedAt,sourceDetail:'Trading 212 position currentPrice (indicative; not an execution guarantee)'};
}
async function snapshot(who:Who,environment:BrokerEnvironment){
 const list=await who.user.query(makeFunctionReference<'query',Record<string,never>,{connectionId:string;environment:string;status:string}[]>('brokers:list'),{});
 const c=list.find(r=>r.environment===environment);if(!c)throw new TradingError('no_connection',409,`Connect and synchronise a read-only ${environment} account first`);
 const d=await who.user.query(makeFunctionReference<'query',{connectionId:string},{snapshot:BrokerSyncSnapshot|null}>('brokers:detail'),{connectionId:c.connectionId});
 if(!d.snapshot||!d.snapshot.positions)throw new TradingError('no_snapshot',409,'Synchronise the account (positions included) before evaluating an order');return d.snapshot;
}
async function realisedLossToday(who:Who,environment:BrokerEnvironment){
 try{spaced(who,environment,'history',3_000);const c=await tradingClient(who,environment),today=new Date().toISOString().slice(0,10);let page=await c.historyOrders(),pnl=0;
  for(let i=0;i<3;i++){for(const f of page.items){if(!f.filledAt?.startsWith(today))continue;if(f.realisedProfitLoss===null)return null;pnl+=f.realisedProfitLoss;}
   const older=page.items.some(f=>f.filledAt&&f.filledAt.slice(0,10)<today);if(older||!page.nextPagePath)return Math.max(0,-pnl);await new Promise(r=>setTimeout(r,3_100));page=await c.historyOrders(page.nextPagePath);}
  return null;
 }catch{return null;}
}
function payloadFor(row:OrderRow){
 const draft=orderDraftSchema.parse(row.draft);if(!row.priceReference||row.riskEvaluatedAt===null)throw new TradingError('not_ready',409,'Evaluate risk before confirming');
 return {draft,payload:confirmationPayload(row.orderId,`trading-key:${row.environment}`,draft,row.priceReference,row.riskEvaluatedAt)};
}
function convexMessage(e:unknown){const m=e instanceof Error?e.message:'';const hit=/Uncaught Error: ([^\n]+)/.exec(m);return hit?hit[1].slice(0,300):null;}

const body=z.discriminatedUnion('action',[
 z.object({action:z.literal('save_trading_key'),environment:z.enum(['demo','live']),apiKey:z.string(),apiSecret:z.string()}).strict(),
 z.object({action:z.literal('instruments'),environment:z.enum(['demo','live']),query:z.string().max(60)}).strict(),
 z.object({action:z.literal('evaluate'),orderId:z.string().max(64)}).strict(),
 z.object({action:z.literal('issue_confirmation'),orderId:z.string().max(64)}).strict(),
 z.object({action:z.literal('confirm'),orderId:z.string().max(64),token:z.string().regex(/^[0-9a-f]{64}$/)}).strict(),
 z.object({action:z.literal('submit'),orderId:z.string().max(64)}).strict(),
 z.object({action:z.literal('reconcile'),orderId:z.string().max(64)}).strict(),
 z.object({action:z.literal('cancel'),orderId:z.string().max(64)}).strict(),
 z.object({action:z.literal('monitor'),environment:z.enum(['demo','live'])}).strict(),
]);

export async function handleTrading(request:Request){
 // Research-only build: the whole endpoint is refused before authentication, parsing, vault, Convex or broker access.
 if(!executionPermitted())return json({error:RESEARCH_ONLY_ERROR_CODE,message:RESEARCH_ONLY_MESSAGE,executionAuthority:'none'},403);
 try{
  assertSameOrigin(request);
  const raw=await request.text();if(raw.length>20_000)throw new TradingError('invalid_request',413,'Request too large');
  let parsed:z.infer<typeof body>;try{parsed=body.parse(JSON.parse(raw));}catch{throw new TradingError('invalid_request',400,'Invalid trading request');}
  const who=await context();
  switch(parsed.action){
   case 'save_trading_key':{
    const creds=brokerCredentialsSchema.parse({apiKey:parsed.apiKey,apiSecret:parsed.apiSecret});
    const encrypted=encryptCredentials(creds,who.owner,parsed.environment,process.env,'orders');
    await who.admin.mutation(im('saveTradingKeyInternal'),{owner:who.owner,environment:parsed.environment,maskedKey:maskApiKey(creds.apiKey),encryptedPayload:JSON.stringify(encrypted)});
    return json({saved:true,environment:parsed.environment,maskedKey:maskApiKey(creds.apiKey)});
   }
   case 'instruments':{
    const q=parsed.query.trim().toLowerCase();const items=await instruments(who,parsed.environment);
    return json({items:q?items.filter(i=>i.ticker.toLowerCase().includes(q)||i.name.toLowerCase().includes(q)||(i.shortName??'').toLowerCase().includes(q)).slice(0,25):[],total:items.length,note:'Broker instrument list (refreshed by Trading 212 every 10 minutes). Availability of order types and fractional quantities varies by instrument.'});
   }
   case 'evaluate':{
    const row=await order(who,parsed.orderId),draft=orderDraftSchema.parse(row.draft),snap=await snapshot(who,row.environment);
    const list=await instruments(who,row.environment).catch(()=>null),instrument=list?.find(i=>i.ticker===draft.ticker)??null;
    const account={...accountFromSnapshot(snap),realisedLossToday:await realisedLossToday(who,row.environment)};
    const reference=priceFromSnapshot(snap,draft.ticker),risk=evaluateOrderRisk(draft,instrument,reference,account,row.limits,Date.now());
    await who.admin.mutation(im('recordRiskInternal'),{owner:who.owner,orderId:row.orderId,riskJson:JSON.stringify({...risk,instrument,account:{currency:account.currency,cashAvailable:account.cashAvailable,totalValue:account.totalValue,syncedAt:account.syncedAt,realisedLossToday:account.realisedLossToday}}),priceReferenceJson:reference?JSON.stringify(reference):null,passed:risk.passed});
    return json({risk,instrument,priceReference:reference});
   }
   case 'issue_confirmation':{
    const row=await order(who,parsed.orderId),{draft,payload}=payloadFor(row),token=randomBytes(32).toString('hex');
    const {expiresAt}=await who.admin.mutation(im('issueConfirmationInternal'),{owner:who.owner,orderId:row.orderId,tokenHash:sha(token),payloadHash:sha(payload)}) as {expiresAt:number};
    return json({token,expiresAt,summary:{environment:draft.environment,ticker:draft.ticker,side:draft.side,quantity:draft.quantity,brokerQuantity:brokerQuantity(draft),type:draft.type,limitPrice:draft.limitPrice,stopPrice:draft.stopPrice,timeValidity:draft.timeValidity,extendedHours:draft.extendedHours,indicativePrice:row.priceReference?.price,indicativePriceAt:row.priceReference?.observedAt}});
   }
   case 'confirm':{const row=await order(who,parsed.orderId),{payload}=payloadFor(row);await who.admin.mutation(im('confirmInternal'),{owner:who.owner,orderId:row.orderId,tokenHash:sha(parsed.token),payloadHash:sha(payload)});return json({confirmed:true});}
   case 'submit':{
    const row=await order(who,parsed.orderId),{draft,payload}=payloadFor(row),flag=executionFlag(row.environment);
    if(!flag)throw new TradingError('execution_disabled',403,`${row.environment==='live'?'Live':'Demo'} order submission is disabled on this server`);
    if(row.environment==='live'&&row.liveKillSwitchEngaged)throw new TradingError('execution_disabled',403,'Live trading is disabled by the emergency switch');
    const c=await tradingClient(who,row.environment,true);spaced(who,row.environment,'pending',5_000);
    const before=(await c.pendingOrders()).map(o=>o.id),submissionId=randomUUID();
    const claim=await who.admin.mutation(im('claimSubmissionInternal'),{owner:who.owner,orderId:row.orderId,submissionId,payloadHash:sha(payload),executionFlagEnabled:flag,knownBrokerIdsBefore:before}) as {ok:boolean;reason?:string};
    if(!claim.ok)throw new TradingError('stale_confirmation',409,claim.reason??'Confirmation went stale');
    const result=await c.submit(draft);
    await who.admin.mutation(im('recordSubmissionResultInternal'),{owner:who.owner,orderId:row.orderId,submissionId,resultJson:JSON.stringify(result)});
    return json({result:{kind:result.kind,brokerOrderId:result.kind==='acknowledged'?result.order.id:null,status:result.kind==='acknowledged'?result.order.status:null}});
   }
   case 'reconcile':{
    const row=await order(who,parsed.orderId),draft=orderDraftSchema.parse(row.draft),c=await tradingClient(who,row.environment);
    if(row.brokerOrderId!==null){spaced(who,row.environment,'order',1_100);try{const o=await c.order(row.brokerOrderId);await who.admin.mutation(im('recordBrokerStatusInternal'),{owner:who.owner,orderId:row.orderId,brokerOrderJson:JSON.stringify(o),source:'order status'});return json({status:o.status});}catch(e){if(!(e instanceof BrokerError&&e.code==='provider_unavailable'))throw e;}
     spaced(who,row.environment,'history',3_000);const h=await c.historyOrders(null,draft.ticker),hit=h.items.find(i=>i.order.id===row.brokerOrderId);if(!hit)return json({status:'not_yet_in_history'});
     await who.admin.mutation(im('recordBrokerStatusInternal'),{owner:who.owner,orderId:row.orderId,brokerOrderJson:JSON.stringify(hit.order),source:'order history'});return json({status:hit.order.status});}
    if(row.state==='submitting'&&row.submittingAt!==null&&Date.now()-row.submittingAt>30_000){
     // A submission claim with no recorded result (e.g. server restart mid-request) is ambiguous: mark unknown, never resend.
     const sid=(row as unknown as {submissionId:string|null}).submissionId;if(!sid)throw new TradingError('invalid_state',409,'Missing submission identifier');
     await who.admin.mutation(im('recordSubmissionResultInternal'),{owner:who.owner,orderId:row.orderId,submissionId:sid,resultJson:JSON.stringify({kind:'ambiguous',reason:'interrupted_submission',httpStatus:null})});row.state='unknown';
    }
    if(row.state!=='unknown'||row.submittingAt===null)throw new TradingError('invalid_state',409,'Nothing to reconcile');
    spaced(who,row.environment,'pending',5_000);const pending=await c.pendingOrders();spaced(who,row.environment,'history',3_000);const history=await c.historyOrders(null,draft.ticker);
    const matches=reconcileCandidates([...pending,...history.items.map(i=>i.order)],{ticker:draft.ticker,brokerQuantity:brokerQuantity(draft),type:draft.type,limitPrice:draft.limitPrice,stopPrice:draft.stopPrice},{submittedAt:row.submittingAt,knownBrokerIdsBefore:row.knownBrokerIdsBefore});
    const unique=[...new Map(matches.map(m=>[m.id,m])).values()];
    if(unique.length===1){await who.admin.mutation(im('recordBrokerStatusInternal'),{owner:who.owner,orderId:row.orderId,brokerOrderJson:JSON.stringify(unique[0]),source:'reconciliation'});return json({matched:unique[0].id,status:unique[0].status});}
    await who.admin.mutation(im('recordReconcileMissInternal'),{owner:who.owner,orderId:row.orderId,candidates:unique.length});return json({matched:null,candidates:unique.length});
   }
   case 'cancel':{
    const row=await order(who,parsed.orderId);if(row.brokerOrderId===null||!['acknowledged','partially_filled'].includes(row.state))throw new TradingError('invalid_state',409,'Only an acknowledged broker order can be cancelled');
    if(!executionFlag(row.environment))throw new TradingError('execution_disabled',403,'Order changes are disabled on this server');
    const c=await tradingClient(who,row.environment,true);await c.cancel(row.brokerOrderId);return json({cancelRequested:true,note:'Cancellation is not guaranteed if the order is already filling; reconcile to read the final status.'});
   }
   case 'monitor':{
    spaced(who,parsed.environment,'monitor',20_000);const c=await tradingClient(who,parsed.environment),retrievedAt=Date.now();
    const pending=await c.pendingOrders();await new Promise(r=>setTimeout(r,3_100));const history=await c.historyOrders();await new Promise(r=>setTimeout(r,3_100));const dividends=await c.dividends();
    return json({retrievedAt,pending,history:history.items,dividends:dividends.items,note:'Polled on request with provider rate limits; not tick-by-tick data.'});
   }
  }
 }catch(e){
  if(e instanceof TradingError)return json({error:e.code,message:e.message},e.status);
  if(e instanceof Error&&typeof (e as {status?:unknown}).status==='number'&&typeof (e as {code?:unknown}).code==='string'){const x=e as Error&{status:number;code:string};return json({error:x.code,message:x.message},x.status);}
  if(e instanceof BrokerError)return json({error:e.code,message:e.message},e.code==='rate_limited'?429:502);
  const m=convexMessage(e);if(m)return json({error:'rejected',message:m},409);
  return json({error:'trading_failed',message:'The trading request could not be completed'},500);
 }
}
