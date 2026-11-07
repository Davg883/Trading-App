import {reviewer,signedIn} from './authz';
import {v,type GenericId} from 'convex/values';
import type {GenericQueryCtx,GenericMutationCtx} from 'convex/server';
import {query,mutation,internalMutation,type DataModel,type TableName} from './server';
import {RECOVERY_VERSION,RECOVERY_HORIZONS,parseRecoveryCase,buildRecoveryRegistration,evaluateRecoveryWindow,recoveryRiskGate,recoveryPlanSchema,type RecoveryCase} from '../lib/market-recovery';

type Context=GenericQueryCtx<DataModel>|GenericMutationCtx<DataModel>;
function canonical(value:unknown):string{if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value!==null&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;return JSON.stringify(value);}
function required(value:string,label:string,max=4000){if(!value.trim()||value.length>max)throw new Error(`${label} is required and must fit the research limit`);}
function instant(value:number,label:string){if(!Number.isSafeInteger(value)||value<0||value>8.64e15)throw new Error(`${label} must be a valid timestamp`);}
function nonfuture(value:number,label:string,now:number){instant(value,label);if(value>now)throw new Error(`${label} cannot be in the future`);}
async function identity(ctx:Context){return await signedIn(ctx);}
/** Consequential decisions require an explicit, server-stored reviewer grant (see convex/authz.ts). */
async function human(ctx:Context){return await reviewer(ctx);}
async function owned<T extends TableName>(ctx:Context,id:GenericId<T>,owner:string){const row=await ctx.db.get(id);if(!row||row.owner!==owner)throw new Error('Record unavailable');return row;}
function assertReceived(value:unknown,now:number):void{if(Array.isArray(value)){value.forEach(item=>assertReceived(item,now));return;}if(value!==null&&typeof value==='object')for(const [key,item] of Object.entries(value)){if((key==='receivedAt'||key==='publishedAt')&&typeof item==='number'&&item>now)throw new Error('Future receipt or publication cannot be imported as already known');assertReceived(item,now);}}
function metadata(row:DataModel['recoveryCases']['document']){return {caseId:row._id,externalId:row.externalId,name:row.name,mode:row.mode,ingestedAt:row.ingestedAt,version:row.version};}
const horizon=v.union(v.literal(1),v.literal(5),v.literal(20),v.literal(60));

/** Trusted ingestion only. Published history never substitutes for actual workspace receipt. */
export const importCase=internalMutation({args:{owner:v.string(),externalId:v.string(),caseJson:v.string()},handler:async(ctx,args)=>{
  required(args.owner,'Owner',1000);required(args.externalId,'Source version identifier',240);if(new TextEncoder().encode(args.caseJson).byteLength>800000)throw new Error('Recovery case exceeds the pilot size limit');
  const record=parseRecoveryCase(JSON.parse(args.caseJson)),now=Date.now();assertReceived(record,now);const recordJson=canonical(record),prior=await ctx.db.query('recoveryCases').withIndex('by_external',q=>q.eq('owner',args.owner).eq('externalId',args.externalId)).first();
  if(prior){if(prior.recordJson!==recordJson)throw new Error('Immutable recovery source conflicts; append a new source version');return prior._id;}
  const id=await ctx.db.insert('recoveryCases',{owner:args.owner,externalId:args.externalId,name:record.name,mode:record.mode,recordJson,ingestedAt:now,version:RECOVERY_VERSION});
  await ctx.db.insert('audit',{owner:args.owner,action:'recovery.case.imported',recordId:id,detail:`${RECOVERY_VERSION}; source receipts and actual ingestion retained`,at:now});return id;
}});

/** Server-verified owner identity for trusted import routes. Returns only the caller's own token identifier. */
export const viewer=query({args:{},handler:async(ctx)=>({owner:(await identity(ctx)).tokenIdentifier})});

export const list=query({args:{},handler:async(ctx)=>{const user=await identity(ctx);return (await ctx.db.query('recoveryCases').withIndex('by_owner',q=>q.eq('owner',user.tokenIdentifier)).take(100)).map(metadata);}});

export const detail=query({args:{caseId:v.id('recoveryCases')},handler:async(ctx,args)=>{
  const user=await identity(ctx),owner=user.tokenIdentifier,row=await owned(ctx,args.caseId,owner),now=Date.now(),registrations=await ctx.db.query('recoveryRegistrations').withIndex('by_case',q=>q.eq('owner',owner).eq('caseId',row._id)).take(100),registered=[];
  for(const registration of registrations){const plans=await ctx.db.query('recoveryExperiments').withIndex('by_registration',q=>q.eq('owner',owner).eq('registrationId',registration._id)).take(3),experiments=[];
    for(const plan of plans){const reviews=await ctx.db.query('recoveryReviews').withIndex('by_experiment',q=>q.eq('owner',owner).eq('experimentId',plan._id)).order('desc').take(100),outcomes=await ctx.db.query('recoveryOutcomes').withIndex('by_experiment',q=>q.eq('owner',owner).eq('experimentId',plan._id)).order('desc').take(100);
      experiments.push({experimentId:plan._id,externalId:plan.externalId,strategy:plan.strategy,name:plan.name,createdAt:plan.createdAt,recordPurpose:plan.recordPurpose,plan:JSON.parse(plan.experimentJson),windows:JSON.parse(plan.windowsJson),reviews:reviews.map(review=>({...review,state:review.decision==='reject'?'rejected':review.reviewBy<=now?'expired':'reviewed'})),outcomes:outcomes.map(outcome=>({...outcome,report:JSON.parse(outcome.reportJson)}))});}
    registered.push({registrationId:registration._id,name:registration.name,cutoff:registration.cutoff,anchorAt:registration.anchorAt,registeredAt:registration.registeredAt,experimentMode:registration.experimentMode,registration:JSON.parse(registration.registrationJson),experiments});}
  return {metadata:metadata(row),case:parseRecoveryCase(JSON.parse(row.recordJson)),registrations:registered,humanReviewer:user.actorType==='human',asOf:now,executionAuthority:'none' as const};
}});

/** Exactly three independent £500 research records; this never calls the paper ledger. */
export const registerCase006=mutation({args:{caseId:v.id('recoveryCases'),name:v.string(),cutoff:v.number(),anchorAt:v.number(),benchmarkInstrumentId:v.string(),priceBasis:v.union(v.literal('total-return'),v.literal('split-adjusted')),adjustmentVersion:v.string()},handler:async(ctx,args)=>{
  const user=await identity(ctx),owner=user.tokenIdentifier,row=await owned(ctx,args.caseId,owner),now=Date.now();required(args.name,'Registration name',500);required(args.benchmarkInstrumentId,'Benchmark',240);required(args.adjustmentVersion,'Adjustment version',240);nonfuture(args.cutoff,'Evidence cutoff',now);instant(args.anchorAt,'Anchor');
  if(row.ingestedAt>args.cutoff)throw new Error('Case was imported into this workspace after cutoff');
  const data=parseRecoveryCase(JSON.parse(row.recordJson));if(data.mode==='forward')throw new Error('Forward predictions require a separate advance registration protocol');
  if(data.plans.length!==3||new Set(data.plans.map(plan=>plan.kind)).size!==3)throw new Error('Register exactly one immediate, staged and diversified £500 plan');
  const registration=buildRecoveryRegistration(data,{name:args.name,cutoff:args.cutoff,anchorAt:args.anchorAt,registeredAt:now,benchmarkInstrumentId:args.benchmarkInstrumentId,priceBasis:args.priceBasis,adjustmentVersion:args.adjustmentVersion});
  if(registration.plans.length!==3||registration.windows.length!==12)throw new Error('All three plans and twelve source-compatible outcome windows must be registered');
  const registrationJson=canonical(registration);if(new TextEncoder().encode(registrationJson).byteLength>850000)throw new Error('Frozen recovery registration exceeds the pilot size limit');
  const registrationId=await ctx.db.insert('recoveryRegistrations',{owner,caseId:row._id,name:args.name,cutoff:args.cutoff,anchorAt:args.anchorAt,registrationJson,registeredAt:now,experimentMode:'retrospective_research',version:RECOVERY_VERSION});
  for(const plan of registration.plans){await ctx.db.insert('recoveryExperiments',{owner,registrationId,externalId:plan.id,strategy:plan.kind,name:plan.name,experimentJson:canonical(plan),windowsJson:canonical(registration.windows.filter(window=>window.planId===plan.id)),createdAt:now,recordPurpose:'research_experiment',version:RECOVERY_VERSION});}
  await ctx.db.insert('audit',{owner,action:'recovery.case006.registered',recordId:registrationId,detail:'Three independent £500 research experiments; frozen criteria and stage schedule; no original historical forecast or trade authority',at:now});return registrationId;
}});

export const reviewExperiment=mutation({args:{experimentId:v.id('recoveryExperiments'),decision:v.union(v.literal('approve'),v.literal('reject')),reason:v.string(),acknowledgedRisks:v.array(v.string()),reviewBy:v.number(),supersedesId:v.optional(v.id('recoveryReviews'))},handler:async(ctx,args)=>{
  const user=await human(ctx),owner=user.tokenIdentifier,experiment=await owned(ctx,args.experimentId,owner),row=await owned(ctx,experiment.registrationId,owner),source=await owned(ctx,row.caseId,owner),now=Date.now();required(args.reason,'Human review reason');instant(args.reviewBy,'Revalidation date');if(args.reviewBy<=now)throw new Error('Future revalidation date required');
  if(!args.acknowledgedRisks.length||args.acknowledgedRisks.length>30||new Set(args.acknowledgedRisks).size!==args.acknowledgedRisks.length)throw new Error('Unique acknowledged risks are required');args.acknowledgedRisks.forEach(risk=>required(risk,'Acknowledged risk'));
  const registration=JSON.parse(row.registrationJson) as ReturnType<typeof buildRecoveryRegistration>,plan=recoveryPlanSchema.parse(JSON.parse(experiment.experimentJson)),sourceCase=parseRecoveryCase(JSON.parse(source.recordJson)),originalGate=recoveryRiskGate(registration,plan.id,registration.evidence,registration.cutoff);
  const outcomes=await ctx.db.query('recoveryOutcomes').withIndex('by_experiment',q=>q.eq('owner',owner).eq('experimentId',experiment._id)).order('desc').take(100);
  let currentCase:RecoveryCase=sourceCase;if(outcomes.length){const latest=await owned(ctx,outcomes[0].observationCaseId,owner);currentCase=parseRecoveryCase(JSON.parse(latest.recordJson));}
  const currentGate=recoveryRiskGate(registration,plan.id,currentCase,now);
  if(args.decision==='approve'){
    if(!originalGate.passed||!currentGate.passed)throw new Error(`Recovery research gate blocked: ${[...new Set([...originalGate.reasons,...currentGate.reasons])].join('; ')}`);
    if(outcomes.some(outcome=>(JSON.parse(outcome.reportJson) as {riskGate?:{invalidationTriggered?:boolean}}).riskGate?.invalidationTriggered))throw new Error('A recorded invalidation cannot be waived by human approval; register a new research experiment');
  }
  const history=await ctx.db.query('recoveryReviews').withIndex('by_experiment',q=>q.eq('owner',owner).eq('experimentId',experiment._id)).order('desc').take(100);if(history.length>=100)throw new Error('Review history exceeds the pilot limit');
  if(args.supersedesId){const previous=await owned(ctx,args.supersedesId,owner);if(previous.experimentId!==experiment._id||history[0]?._id!==previous._id)throw new Error('Review must supersede the latest decision for this exact experiment');}else if(history.length)throw new Error('The latest research review must be explicitly superseded');
  const selectionJson=canonical({plan,criteria:registration.criteria,assessment:registration.assessment,cutoff:row.cutoff,originalGate,currentGate,executionAuthority:'none',riskRequirement:'Existing paper minimum capital, allowed instruments, deterministic risk and authenticated paper order approval remain required'});
  const id=await ctx.db.insert('recoveryReviews',{owner,registrationId:row._id,experimentId:experiment._id,decision:args.decision,reviewer:user.subject,reason:args.reason,acknowledgedRisks:args.acknowledgedRisks,reviewedAt:now,reviewBy:args.reviewBy,selectionJson,...(args.supersedesId?{supersedesId:args.supersedesId}:{}),executionAuthority:'none'});
  await ctx.db.insert('audit',{owner,action:'recovery.experiment.human_reviewed',recordId:id,detail:`${args.decision}; research permission only; criteria and invalidations cannot be overridden`,at:now});return id;
}});

/** Only trusted observations may complete windows; no public function accepts a return or score. */
export const evaluateOutcome=internalMutation({args:{owner:v.string(),experimentId:v.id('recoveryExperiments'),observationCaseId:v.id('recoveryCases'),horizonSessions:horizon,asOf:v.number()},handler:async(ctx,args)=>{
  const experiment=await owned(ctx,args.experimentId,args.owner),row=await owned(ctx,experiment.registrationId,args.owner),observation=await owned(ctx,args.observationCaseId,args.owner),now=Date.now();nonfuture(args.asOf,'Evaluation cutoff',now);if(observation.ingestedAt>args.asOf)throw new Error('Outcome observations entered this workspace after evaluation cutoff');
  const registration=JSON.parse(row.registrationJson) as ReturnType<typeof buildRecoveryRegistration>,windows=JSON.parse(experiment.windowsJson) as typeof registration.windows,window=windows.find(w=>w.horizonSessions===args.horizonSessions);if(!window||!RECOVERY_HORIZONS.includes(args.horizonSessions))throw new Error('Outcome window was not registered');
  const data=parseRecoveryCase(JSON.parse(observation.recordJson));if(data.mode!==registration.evidence.mode)throw new Error('Synthetic, retrospective and forward observations cannot be combined');
  const report={...evaluateRecoveryWindow(data,window,args.asOf),riskGate:recoveryRiskGate(registration,experiment.externalId,data,args.asOf)},reportJson=canonical(report);if(new TextEncoder().encode(reportJson).byteLength>200000)throw new Error('Recovery outcome exceeds the pilot size limit');
  const prior=await ctx.db.query('recoveryOutcomes').withIndex('by_experiment',q=>q.eq('owner',args.owner).eq('experimentId',experiment._id)).take(100),exact=prior.find(p=>p.observationCaseId===observation._id&&p.horizonSessions===args.horizonSessions&&p.asOf===args.asOf);
  if(exact){if(exact.reportJson!==reportJson)throw new Error('Immutable recovery outcome conflicts');return exact._id;}if(prior.length>=100)throw new Error('Outcome history exceeds the pilot limit');
  const id=await ctx.db.insert('recoveryOutcomes',{owner:args.owner,registrationId:row._id,experimentId:experiment._id,observationCaseId:observation._id,horizonSessions:args.horizonSessions,reportJson,asOf:args.asOf,evaluatedAt:now,version:RECOVERY_VERSION});
  await ctx.db.insert('audit',{owner:args.owner,action:'recovery.outcome.evaluated',recordId:id,detail:`${args.horizonSessions} sessions; independent computed result and risk gate; no execution authority`,at:now});return id;
}});
