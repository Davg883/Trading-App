import {v,type GenericId} from 'convex/values';
import {internalQueryGeneric,type QueryBuilder,type GenericMutationCtx,type GenericQueryCtx} from 'convex/server';
import {query,mutation,internalMutation,type DataModel} from './server';
import {researcher,reviewer,hasRole} from './authz';
import {assertExecutionPermitted} from '../lib/trading/execution-boundary';
import {TRADING_VERSION,TERMINAL_STATES,assertTransition,orderDraftSchema,riskLimitsSchema,DEFAULT_RISK_LIMITS,brokerOrderSchema,stateFromBroker,type OrderState,type RiskLimits} from '../lib/trading/order-model';

/**
 * Phase 002 trading records. Convex is authoritative for proposals, approvals, risk decisions, submission claims and
 * the audit trail; Trading 212 is authoritative for executed orders and holdings. Only the Next.js server, after
 * verifying the Clerk session, calls the internal functions with a server-only key. No function here talks to the broker.
 */
const internalQuery:QueryBuilder<DataModel,'internal'>=internalQueryGeneric;
type Ctx=GenericMutationCtx<DataModel>|GenericQueryCtx<DataModel>;
type Order=DataModel['tradeOrders']['document'];
const env=v.union(v.literal('demo'),v.literal('live'));
const CONFIRMATION_MS=60_000,NOT_PLACED_MIN_CHECKS=2,NOT_PLACED_MIN_SPAN_MS=5*60_000;
export const OPT_IN_STATEMENT='I understand that a trading-capable Trading 212 key can place real orders with real money in a Live account. I authorise this application to store it encrypted and to submit only orders I have individually approved and confirmed.';

function owner(v:string){if(!v.trim()||v.length>1000)throw new Error('Owner required');}
async function owned(ctx:Ctx,id:GenericId<'tradeOrders'>,who:string){const row=await ctx.db.get(id);if(!row||row.owner!==who)throw new Error('Order unavailable');return row;}
async function settings(ctx:Ctx,who:string){return await ctx.db.query('tradingSettings').withIndex('by_owner',q=>q.eq('owner',who)).unique();}
function limitsOf(row:DataModel['tradingSettings']['document']|null):RiskLimits{return row?riskLimitsSchema.parse(JSON.parse(row.limitsJson)):DEFAULT_RISK_LIMITS;}
async function move(ctx:GenericMutationCtx<DataModel>,row:Order,to:OrderState,actor:string,detail:string,patch:Partial<Order>={}){
 assertTransition(row.state as OrderState,to);const now=Date.now();
 await ctx.db.patch(row._id,{...patch,state:to,updatedAt:now});
 await ctx.db.insert('tradeOrderEvents',{owner:row.owner,orderId:row._id,from:row.state,to,actor,detail:detail.slice(0,2000),at:now});
}
function view(row:Order){
 return {orderId:row._id,state:row.state,environment:row.environment,ticker:row.ticker,draft:JSON.parse(row.draftJson),risk:row.riskJson?JSON.parse(row.riskJson):null,priceReference:row.priceReferenceJson?JSON.parse(row.priceReferenceJson):null,
  reviewedBy:row.reviewedBy??null,reviewNote:row.reviewNote??null,confirmationExpiresAt:row.confirmationExpiresAt??null,confirmedAt:row.confirmedAt??null,submissionId:row.submissionId??null,brokerOrderId:row.brokerOrderId??null,brokerStatus:row.brokerStatus??null,
  filledQuantity:row.filledQuantity??null,filledValue:row.filledValue??null,reconcileChecks:row.reconcileChecks??0,lastReconciledAt:row.lastReconciledAt??null,createdAt:row.createdAt,updatedAt:row.updatedAt,version:row.version};
}

// ---------- Public, owner-scoped ----------
export const overview=query({args:{},handler:async ctx=>{
 const user=await researcher(ctx),who=user.tokenIdentifier,s=await settings(ctx,who);
 const creds=await ctx.db.query('tradingCredentials').withIndex('by_owner',q=>q.eq('owner',who)).collect();
 const orders=await ctx.db.query('tradeOrders').withIndex('by_owner',q=>q.eq('owner',who)).order('desc').take(100);
 return {limits:limitsOf(s),liveKillSwitchEngaged:s?.liveKillSwitchEngaged??true,optedInAt:s?.optedInAt??null,optInStatement:OPT_IN_STATEMENT,reviewer:await hasRole(ctx,who,'reviewer'),
  tradingKeys:creds.map(c=>({environment:c.environment,maskedKey:c.maskedKey,createdAt:c.createdAt})),orders:orders.map(view),version:TRADING_VERSION};
}});
export const orderEvents=query({args:{orderId:v.id('tradeOrders')},handler:async(ctx,args)=>{const user=await researcher(ctx);await owned(ctx,args.orderId,user.tokenIdentifier);return (await ctx.db.query('tradeOrderEvents').withIndex('by_order',q=>q.eq('orderId',args.orderId)).collect()).map(e=>({from:e.from,to:e.to,actor:e.actor,detail:e.detail,at:e.at}));}});

export const recordOptIn=mutation({args:{statement:v.string()},handler:async(ctx,args)=>{
 assertExecutionPermitted('trading-key opt-in');
 const user=await researcher(ctx),who=user.tokenIdentifier,now=Date.now();if(args.statement!==OPT_IN_STATEMENT)throw new Error('The exact opt-in statement must be acknowledged');
 const s=await settings(ctx,who);if(s)await ctx.db.patch(s._id,{optedInAt:now,updatedAt:now});else await ctx.db.insert('tradingSettings',{owner:who,limitsJson:JSON.stringify(DEFAULT_RISK_LIMITS),liveKillSwitchEngaged:true,optedInAt:now,updatedAt:now});
 await ctx.db.insert('audit',{owner:who,action:'trading.opt_in',recordId:who,detail:OPT_IN_STATEMENT,at:now});
}});
export const updateLimits=mutation({args:{limitsJson:v.string()},handler:async(ctx,args)=>{
 const user=await reviewer(ctx),who=user.tokenIdentifier,now=Date.now(),limits=riskLimitsSchema.parse(JSON.parse(args.limitsJson));
 const busy=await ctx.db.query('tradeOrders').withIndex('by_owner',q=>q.eq('owner',who)).collect();
 if(busy.some(o=>['approved','confirmed','submitting'].includes(o.state)))throw new Error('Limits cannot change while an approved or confirmed order is outstanding');
 const s=await settings(ctx,who);if(s)await ctx.db.patch(s._id,{limitsJson:JSON.stringify(limits),updatedAt:now});else await ctx.db.insert('tradingSettings',{owner:who,limitsJson:JSON.stringify(limits),liveKillSwitchEngaged:true,updatedAt:now});
 await ctx.db.insert('audit',{owner:who,action:'trading.limits.updated',recordId:who,detail:JSON.stringify(limits),at:now});
}});
/** Emergency switch. Engaging is always allowed; releasing needs reviewer authority and a reason. Live submission additionally needs the server flag. */
export const setLiveKillSwitch=mutation({args:{engaged:v.boolean(),reason:v.string()},handler:async(ctx,args)=>{
 if(!args.engaged)assertExecutionPermitted('release of the Live emergency switch');
 const user=args.engaged?await researcher(ctx):await reviewer(ctx),who=user.tokenIdentifier,now=Date.now();
 if(!args.reason.trim()||args.reason.length>1000)throw new Error('Reason required');
 const s=await settings(ctx,who);if(s)await ctx.db.patch(s._id,{liveKillSwitchEngaged:args.engaged,updatedAt:now});else await ctx.db.insert('tradingSettings',{owner:who,limitsJson:JSON.stringify(DEFAULT_RISK_LIMITS),liveKillSwitchEngaged:args.engaged,updatedAt:now});
 await ctx.db.insert('audit',{owner:who,action:args.engaged?'trading.live.disabled':'trading.live.switch_released',recordId:who,detail:args.reason,at:now});
}});
export const deleteTradingKey=mutation({args:{environment:env},handler:async(ctx,args)=>{
 const user=await researcher(ctx),who=user.tokenIdentifier,row=await ctx.db.query('tradingCredentials').withIndex('by_owner_env',q=>q.eq('owner',who).eq('environment',args.environment)).unique();
 if(!row)throw new Error('No trading key saved for this environment');await ctx.db.delete(row._id);
 await ctx.db.insert('audit',{owner:who,action:'trading.key.deleted',recordId:who,detail:`${args.environment} trading key deleted locally; revoke it at Trading 212 separately`,at:Date.now()});
}});
export const createDraft=mutation({args:{draftJson:v.string()},handler:async(ctx,args)=>{
 const user=await researcher(ctx),who=user.tokenIdentifier,now=Date.now(),draft=orderDraftSchema.parse(JSON.parse(args.draftJson));
 const id=await ctx.db.insert('tradeOrders',{owner:who,state:'draft',environment:draft.environment,ticker:draft.ticker,draftJson:JSON.stringify(draft),createdAt:now,updatedAt:now,version:TRADING_VERSION});
 await ctx.db.insert('tradeOrderEvents',{owner:who,orderId:id,from:'none',to:'draft',actor:who,detail:'Draft created',at:now});return id;
}});
export const withdraw=mutation({args:{orderId:v.id('tradeOrders'),reason:v.string()},handler:async(ctx,args)=>{const user=await researcher(ctx),row=await owned(ctx,args.orderId,user.tokenIdentifier);await move(ctx,row,'withdrawn',user.tokenIdentifier,args.reason||'Withdrawn by owner');}});
export const reviewDecision=mutation({args:{orderId:v.id('tradeOrders'),decision:v.union(v.literal('approve'),v.literal('decline')),note:v.string()},handler:async(ctx,args)=>{
 const user=await reviewer(ctx),row=await owned(ctx,args.orderId,user.tokenIdentifier);if(!args.note.trim()||args.note.length>2000)throw new Error('Review note required');
 if(row.state!=='reviewed')throw new Error('Only a risk-reviewed order can be decided');
 if(args.decision==='approve'&&!row.riskPassed)throw new Error('The independent risk check did not pass; approval cannot waive it');
 await move(ctx,row,args.decision==='approve'?'approved':'declined',user.tokenIdentifier,args.note,{reviewedBy:user.tokenIdentifier,reviewNote:args.note,reviewedAt:Date.now()});
}});

// ---------- Internal: called only by the authenticated Next.js server ----------
export const recordRiskInternal=internalMutation({args:{owner:v.string(),orderId:v.id('tradeOrders'),riskJson:v.string(),priceReferenceJson:v.union(v.string(),v.null()),passed:v.boolean()},handler:async(ctx,args)=>{
 owner(args.owner);const row=await owned(ctx,args.orderId,args.owner);
 if(row.state!=='draft'&&row.state!=='reviewed'&&row.state!=='approved')throw new Error('Risk can be re-evaluated only before confirmation');
 const patch={riskJson:args.riskJson,priceReferenceJson:args.priceReferenceJson??undefined,riskPassed:args.passed,riskEvaluatedAt:Date.now()};
 if(row.state==='draft'&&args.passed)return await move(ctx,row,'reviewed','risk-engine','Independent risk check passed',patch);
 if(row.state!=='draft'&&!args.passed)return await move(ctx,row,'draft','risk-engine','Re-evaluated risk failed; approval withdrawn',{...patch,reviewedBy:undefined,reviewNote:undefined});
 if(row.state==='approved')return await move(ctx,row,'draft','risk-engine','Risk re-evaluated after approval; a fresh review is required',{...patch,reviewedBy:undefined,reviewNote:undefined});
 await ctx.db.patch(row._id,{...patch,updatedAt:Date.now()});
 await ctx.db.insert('tradeOrderEvents',{owner:row.owner,orderId:row._id,from:row.state,to:row.state,actor:'risk-engine',detail:args.passed?'Risk check passed':'Risk check failed',at:Date.now()});
}});
export const issueConfirmationInternal=internalMutation({args:{owner:v.string(),orderId:v.id('tradeOrders'),tokenHash:v.string(),payloadHash:v.string()},handler:async(ctx,args)=>{
 assertExecutionPermitted('order confirmation issue');
 owner(args.owner);const row=await owned(ctx,args.orderId,args.owner);if(row.state!=='approved')throw new Error('Only an approved order can be confirmed');
 if(!/^[0-9a-f]{64}$/.test(args.tokenHash)||!/^[0-9a-f]{64}$/.test(args.payloadHash))throw new Error('Invalid confirmation digest');
 const now=Date.now();await ctx.db.patch(row._id,{confirmationTokenHash:args.tokenHash,confirmationPayloadHash:args.payloadHash,confirmationExpiresAt:now+CONFIRMATION_MS,confirmationUsedAt:undefined,updatedAt:now});
 return {expiresAt:now+CONFIRMATION_MS};
}});
export const confirmInternal=internalMutation({args:{owner:v.string(),orderId:v.id('tradeOrders'),tokenHash:v.string(),payloadHash:v.string()},handler:async(ctx,args)=>{
 assertExecutionPermitted('order confirmation');
 owner(args.owner);const row=await owned(ctx,args.orderId,args.owner),now=Date.now();
 if(row.state!=='approved')throw new Error('Order is not awaiting confirmation');
 if(!row.confirmationTokenHash||row.confirmationUsedAt!==undefined)throw new Error('Confirmation already used or not issued');
 if((row.confirmationExpiresAt??0)<now)throw new Error('Confirmation expired; request a new one');
 if(row.confirmationTokenHash!==args.tokenHash)throw new Error('Confirmation token does not match');
 if(row.confirmationPayloadHash!==args.payloadHash)throw new Error('Order details changed since the confirmation was issued');
 await move(ctx,row,'confirmed',args.owner,'Owner confirmed exact order details',{confirmationUsedAt:now,confirmedAt:now});
}});
/** Atomic one-time claim. Re-checks every gate at the moment of submission; a second claim for the same order always fails. */
export const claimSubmissionInternal=internalMutation({args:{owner:v.string(),orderId:v.id('tradeOrders'),submissionId:v.string(),payloadHash:v.string(),executionFlagEnabled:v.boolean(),knownBrokerIdsBefore:v.array(v.number())},handler:async(ctx,args)=>{
 // The caller-supplied `executionFlagEnabled` argument can never override the build boundary.
 assertExecutionPermitted('order submission claim');
 owner(args.owner);const row=await owned(ctx,args.orderId,args.owner),now=Date.now(),s=await settings(ctx,args.owner);
 if(row.state!=='confirmed')throw new Error(`Order is ${row.state}; it can be submitted only once, from confirmed`);
 if(!args.executionFlagEnabled)throw new Error(`${row.environment} order submission is disabled on this server`);
 if(row.environment==='live'&&(s?.liveKillSwitchEngaged??true))throw new Error('Live trading is disabled by the emergency switch');
 if(!s?.optedInAt)throw new Error('Trading-key opt-in has not been recorded');
 if(!(await hasRole(ctx,args.owner,'reviewer',now)))throw new Error('Reviewer grant is no longer active');
 if(!row.riskPassed)throw new Error('Independent risk check has not passed');
 if((row.confirmedAt??0)+CONFIRMATION_MS<now){await move(ctx,row,'approved','system','Confirmation went stale before submission',{confirmedAt:undefined});return {ok:false as const,reason:'Confirmation went stale; confirm again'};}
 if(row.confirmationPayloadHash!==args.payloadHash)throw new Error('Order details changed since confirmation');
 if(!/^[0-9a-f-]{36}$/.test(args.submissionId))throw new Error('Invalid submission identifier');
 const key=await ctx.db.query('tradingCredentials').withIndex('by_owner_env',q=>q.eq('owner',args.owner).eq('environment',row.environment)).unique();if(!key)throw new Error('No trading key saved for this environment');
 await move(ctx,row,'submitting',args.owner,`Submission ${args.submissionId} claimed`,{submissionId:args.submissionId,submittingAt:now,knownBrokerIdsBefore:args.knownBrokerIdsBefore});
 return {ok:true as const};
}});
export const recordSubmissionResultInternal=internalMutation({args:{owner:v.string(),orderId:v.id('tradeOrders'),submissionId:v.string(),resultJson:v.string()},handler:async(ctx,args)=>{
 owner(args.owner);const row=await owned(ctx,args.orderId,args.owner);if(row.state!=='submitting'||row.submissionId!==args.submissionId)throw new Error('No matching submission in progress');
 const r=JSON.parse(args.resultJson) as {kind:'acknowledged'|'rejected'|'ambiguous';order?:unknown;code?:string;reason?:string;httpStatus?:number|null};
 if(r.kind==='acknowledged'){const o=brokerOrderSchema.parse(r.order);await move(ctx,row,'acknowledged','broker',`Broker order ${o.id} (${o.status})`,{brokerOrderId:o.id,brokerStatus:o.status,filledQuantity:o.filledQuantity??undefined,filledValue:o.filledValue??undefined});return;}
 if(r.kind==='rejected')return await move(ctx,row,'rejected','broker',`Broker refused the request (${r.code}, HTTP ${r.httpStatus}); no order was placed`);
 await move(ctx,row,'unknown','system',`Ambiguous broker response (${r.reason}${r.httpStatus?`, HTTP ${r.httpStatus}`:''}); reconciliation required, never retried`);
}});
export const recordBrokerStatusInternal=internalMutation({args:{owner:v.string(),orderId:v.id('tradeOrders'),brokerOrderJson:v.string(),source:v.string()},handler:async(ctx,args)=>{
 owner(args.owner);const row=await owned(ctx,args.orderId,args.owner),o=brokerOrderSchema.parse(JSON.parse(args.brokerOrderJson));
 if(row.brokerOrderId!==undefined&&row.brokerOrderId!==o.id)throw new Error('Broker order id does not match this order');
 if(TERMINAL_STATES.has(row.state as OrderState))return;
 const to=stateFromBroker(o),now=Date.now();
 await move(ctx,row,to,'broker',`${args.source}: broker order ${o.id} ${o.status}, filled ${o.filledQuantity??0}`,{brokerOrderId:o.id,brokerStatus:o.status,filledQuantity:o.filledQuantity??undefined,filledValue:o.filledValue??undefined,lastReconciledAt:now});
}});
/** Unknown orders with no matching broker order are resolved only after repeated, spaced checks. Nothing is resubmitted. */
export const recordReconcileMissInternal=internalMutation({args:{owner:v.string(),orderId:v.id('tradeOrders'),candidates:v.number()},handler:async(ctx,args)=>{
 owner(args.owner);const row=await owned(ctx,args.orderId,args.owner),now=Date.now();if(row.state!=='unknown')throw new Error('Only unknown orders are reconciled this way');
 const checks=(row.reconcileChecks??0)+1,first=row.firstReconcileAt??now;
 if(args.candidates===0&&checks>=NOT_PLACED_MIN_CHECKS&&now-first>=NOT_PLACED_MIN_SPAN_MS)return await move(ctx,row,'not_placed','reconciler',`No matching broker order after ${checks} checks over ${Math.round((now-first)/60000)} minutes`,{reconcileChecks:checks,firstReconcileAt:first,lastReconciledAt:now});
 await move(ctx,row,'unknown','reconciler',args.candidates>1?`${args.candidates} possible broker matches; manual review required`:`No match yet (check ${checks})`,{reconcileChecks:checks,firstReconcileAt:first,lastReconciledAt:now});
}});
export const orderInternal=internalQuery({args:{owner:v.string(),orderId:v.id('tradeOrders')},handler:async(ctx,args)=>{owner(args.owner);const row=await owned(ctx,args.orderId,args.owner),s=await settings(ctx,args.owner);return {...view(row),knownBrokerIdsBefore:row.knownBrokerIdsBefore??[],submittingAt:row.submittingAt??null,riskPassed:row.riskPassed??false,riskEvaluatedAt:row.riskEvaluatedAt??null,limits:limitsOf(s),liveKillSwitchEngaged:s?.liveKillSwitchEngaged??true,optedInAt:s?.optedInAt??null};}});
export const saveTradingKeyInternal=internalMutation({args:{owner:v.string(),environment:env,maskedKey:v.string(),encryptedPayload:v.string()},handler:async(ctx,args)=>{
 assertExecutionPermitted('trading-key storage');
 owner(args.owner);const s=await settings(ctx,args.owner);if(!s?.optedInAt)throw new Error('Record the trading-key opt-in before saving a trading-capable key');
 if(!/^[*•]{4,12}[A-Za-z0-9_-]{0,4}$/.test(args.maskedKey)||args.encryptedPayload.length>20_000)throw new Error('Invalid key envelope');
 const existing=await ctx.db.query('tradingCredentials').withIndex('by_owner_env',q=>q.eq('owner',args.owner).eq('environment',args.environment)).unique(),now=Date.now();
 if(existing)await ctx.db.delete(existing._id);
 await ctx.db.insert('tradingCredentials',{owner:args.owner,environment:args.environment,maskedKey:args.maskedKey,encryptedPayload:args.encryptedPayload,createdAt:now});
 await ctx.db.insert('audit',{owner:args.owner,action:'trading.key.saved',recordId:args.owner,detail:`${args.environment} trading key ${args.maskedKey} saved separately from read-only credentials`,at:now});
}});
export const tradingVaultInternal=internalQuery({args:{owner:v.string(),environment:env},handler:async(ctx,args)=>{owner(args.owner);const row=await ctx.db.query('tradingCredentials').withIndex('by_owner_env',q=>q.eq('owner',args.owner).eq('environment',args.environment)).unique();if(!row)throw new Error('No trading key saved for this environment');return {encryptedPayload:row.encryptedPayload};}});
