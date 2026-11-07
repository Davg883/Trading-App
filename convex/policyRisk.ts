import {signedIn} from './authz';
import {v,type GenericId} from 'convex/values';
import type {GenericQueryCtx,GenericMutationCtx} from 'convex/server';
import {query,mutation,internalMutation,type DataModel,type TableName} from './server';
import {POLICY_RISK_VERSION,parsePolicyCase,policyAssessment,registerPolicyExperiment,evaluatePolicyStudy,policyObservationSetSchema,mergePolicyObservations,type PolicyRegistration,type PolicyObservationSet} from '../lib/policy-risk';

/**
 * Benchmark 001.2 persistence. Owner-scoped, append-only research records.
 * No function here reads or writes the paper ledger, broker connections or orders.
 */
type Context=GenericQueryCtx<DataModel>|GenericMutationCtx<DataModel>;
const MAX_CASE_BYTES=800_000,MAX_REGISTRATION_BYTES=850_000,MAX_OBSERVATION_BYTES=800_000,MAX_REPORT_BYTES=400_000;

function canonical(value:unknown):string{if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value!==null&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>`${JSON.stringify(k)}:${canonical(x)}`).join(',')}}`;return JSON.stringify(value);}
const bytes=(s:string)=>new TextEncoder().encode(s).byteLength;
function required(value:string,label:string,max=500){if(!value.trim()||value.length>max)throw new Error(`${label} is required and must fit the research limit`);}
function instant(value:number,label:string){if(!Number.isSafeInteger(value)||value<0||value>8.64e15)throw new Error(`${label} must be a valid timestamp`);}
function nonfuture(value:number,label:string,now:number){instant(value,label);if(value>now)throw new Error(`${label} cannot be in the future`);}
async function identity(ctx:Context){return await signedIn(ctx);}
async function owned<T extends TableName>(ctx:Context,id:GenericId<T>,owner:string){const row=await ctx.db.get(id);if(!row||row.owner!==owner)throw new Error('Record unavailable');return row;}
function assertReceived(value:unknown,now:number):void{if(Array.isArray(value)){value.forEach(x=>assertReceived(x,now));return;}if(value!==null&&typeof value==='object')for(const [k,x] of Object.entries(value)){if((k==='receivedAt'||k==='publishedAt'||k==='capturedAt')&&typeof x==='number'&&x>now)throw new Error('Future receipt or publication cannot be imported as already known');assertReceived(x,now);}}
function metadata(row:DataModel['policyRiskCases']['document']){return {caseId:row._id,externalId:row.externalId,name:row.name,mode:row.mode,ingestedAt:row.ingestedAt,version:row.version};}

/** Trusted ingestion only. Exact retries are idempotent; changed content needs a new external source version. */
export const importCase=internalMutation({args:{owner:v.string(),externalId:v.string(),caseJson:v.string()},handler:async(ctx,args)=>{
 required(args.owner,'Owner',1000);required(args.externalId,'Source version identifier',240);
 if(bytes(args.caseJson)>MAX_CASE_BYTES)throw new Error('Policy-risk case exceeds the pilot size limit');
 const record=parsePolicyCase(JSON.parse(args.caseJson)),now=Date.now();assertReceived(record,now);
 const recordJson=canonical(record),prior=await ctx.db.query('policyRiskCases').withIndex('by_external',q=>q.eq('owner',args.owner).eq('externalId',args.externalId)).first();
 if(prior){if(prior.recordJson!==recordJson)throw new Error('Immutable policy-risk source conflicts; append a new source version');return prior._id;}
 const id=await ctx.db.insert('policyRiskCases',{owner:args.owner,externalId:args.externalId,name:record.name,mode:record.mode,recordJson,ingestedAt:now,version:POLICY_RISK_VERSION});
 await ctx.db.insert('audit',{owner:args.owner,action:'policyRisk.case.imported',recordId:id,detail:`${POLICY_RISK_VERSION}; source receipts and actual ingestion retained; no execution authority`,at:now});
 return id;
}});

export const list=query({args:{},handler:async ctx=>{const user=await identity(ctx);return (await ctx.db.query('policyRiskCases').withIndex('by_owner',q=>q.eq('owner',user.tokenIdentifier)).take(100)).map(metadata);}});

export const detail=query({args:{caseId:v.id('policyRiskCases')},handler:async(ctx,args)=>{
 const user=await identity(ctx),owner=user.tokenIdentifier,row=await owned(ctx,args.caseId,owner);
 const registrations=await ctx.db.query('policyRiskRegistrations').withIndex('by_case',q=>q.eq('owner',owner).eq('caseId',row._id)).take(100),out=[];
 for(const r of registrations){
  const observations=await ctx.db.query('policyRiskObservations').withIndex('by_registration',q=>q.eq('owner',owner).eq('registrationId',r._id)).take(100);
  const outcomes=await ctx.db.query('policyRiskOutcomes').withIndex('by_registration',q=>q.eq('owner',owner).eq('registrationId',r._id)).order('desc').take(100);
  out.push({registrationId:r._id,name:r.name,cutoff:r.cutoff,basis:r.basis,registeredAt:r.registeredAt,experimentMode:r.experimentMode,registration:JSON.parse(r.registrationJson) as PolicyRegistration,
   observations:observations.map(o=>({observationId:o._id,externalId:o.externalId,capturedAt:o.capturedAt,ingestedAt:o.ingestedAt})),
   outcomes:outcomes.map(o=>({outcomeId:o._id,asOf:o.asOf,evaluatedAt:o.evaluatedAt,observationIds:o.observationIds,report:JSON.parse(o.reportJson) as ReturnType<typeof evaluatePolicyStudy>}))});
 }
 return {metadata:metadata(row),case:parsePolicyCase(JSON.parse(row.recordJson)),registrations:out,executionAuthority:'none' as const};
}});

/**
 * Freezes the policy assessment, group membership, hypotheses and outcome windows. A receipt-basis cutoff cannot precede
 * actual workspace ingestion; a publication-basis registration is stored as a labelled retrospective reconstruction.
 */
export const register=mutation({args:{caseId:v.id('policyRiskCases'),name:v.string(),cutoff:v.number(),basis:v.union(v.literal('receipt'),v.literal('publication'))},handler:async(ctx,args)=>{
 const user=await identity(ctx),owner=user.tokenIdentifier,row=await owned(ctx,args.caseId,owner),now=Date.now();
 required(args.name,'Registration name');nonfuture(args.cutoff,'Evidence cutoff',now);
 const data=parsePolicyCase(JSON.parse(row.recordJson));
 if(data.mode==='forward')throw new Error('Forward predictions need a separate advance registration protocol');
 if(args.basis==='receipt'&&row.ingestedAt>args.cutoff)throw new Error('Case was imported into this workspace after the cutoff');
 if(args.basis==='publication'&&data.mode!=='retrospective')throw new Error('Publication-basis reconstruction is limited to retrospective cases');
 const registration=registerPolicyExperiment(data,{cutoff:args.cutoff,registeredAt:now,basis:args.basis});
 const assessment=policyAssessment(data,args.cutoff,args.basis);
 const registrationJson=canonical(registration),assessmentJson=canonical(assessment);
 if(bytes(registrationJson)+bytes(assessmentJson)>MAX_REGISTRATION_BYTES)throw new Error('Frozen policy-risk registration exceeds the pilot size limit');
 const id=await ctx.db.insert('policyRiskRegistrations',{owner,caseId:row._id,name:args.name,cutoff:args.cutoff,basis:args.basis,registeredAt:now,registrationJson,assessmentJson,experimentMode:args.basis==='publication'?'retrospective_reconstruction':'retrospective_research',executionAuthority:'none',version:POLICY_RISK_VERSION});
 await ctx.db.insert('audit',{owner,action:'policyRisk.registered',recordId:id,detail:`${registration.windows.length} frozen windows; ${registration.hypotheses.length} hypotheses; not a prior prediction; no order or execution authority`,at:now});
 return id;
}});

/** Trusted ingestion of independently captured later closes. Appends only; tickers must belong to the frozen groups. */
export const importObservations=internalMutation({args:{owner:v.string(),registrationId:v.id('policyRiskRegistrations'),externalId:v.string(),observationJson:v.string()},handler:async(ctx,args)=>{
 required(args.owner,'Owner',1000);required(args.externalId,'Observation version identifier',240);
 if(bytes(args.observationJson)>MAX_OBSERVATION_BYTES)throw new Error('Observation set exceeds the pilot size limit');
 const reg=await owned(ctx,args.registrationId,args.owner),now=Date.now(),set=policyObservationSetSchema.parse(JSON.parse(args.observationJson));assertReceived(set,now);
 const registration=JSON.parse(reg.registrationJson) as PolicyRegistration,tickers=new Set(registration.groups.flatMap(g=>g.members));
 if(set.prices.some(p=>!tickers.has(p.ticker)))throw new Error('Observation tickers must belong to the frozen comparison groups');
 if(set.prices.some(p=>p.mode!==registration.mode))throw new Error('Observation mode must match the registration');
 const observationJson=canonical(set),prior=await ctx.db.query('policyRiskObservations').withIndex('by_external',q=>q.eq('owner',args.owner).eq('registrationId',reg._id).eq('externalId',args.externalId)).first();
 if(prior){if(prior.observationJson!==observationJson)throw new Error('Immutable observation set conflicts; use a new version identifier');return prior._id;}
 const id=await ctx.db.insert('policyRiskObservations',{owner:args.owner,registrationId:reg._id,externalId:args.externalId,observationJson,capturedAt:set.capturedAt,ingestedAt:now,version:POLICY_RISK_VERSION});
 await ctx.db.insert('audit',{owner:args.owner,action:'policyRisk.observations.imported',recordId:id,detail:`${set.prices.length} closes appended; registration unchanged`,at:now});
 return id;
}});

/**
 * Recomputes outcomes from the frozen registration plus observation sets ingested by `asOf`. Callers cannot supply returns,
 * scores or hypothesis results. Exact retries return the existing record.
 */
export const evaluateOutcomes=internalMutation({args:{owner:v.string(),registrationId:v.id('policyRiskRegistrations'),asOf:v.number()},handler:async(ctx,args)=>{
 const reg=await owned(ctx,args.registrationId,args.owner),now=Date.now();nonfuture(args.asOf,'Evaluation time',now);
 if(args.asOf<reg.registeredAt)throw new Error('Outcomes cannot be evaluated before registration');
 const source=await owned(ctx,reg.caseId,args.owner),data=parsePolicyCase(JSON.parse(source.recordJson));
 const sets=(await ctx.db.query('policyRiskObservations').withIndex('by_registration',q=>q.eq('owner',args.owner).eq('registrationId',reg._id)).take(100)).filter(o=>o.ingestedAt<=args.asOf).sort((a,b)=>a.ingestedAt-b.ingestedAt||(a._id<b._id?-1:1));
 const observationIds=sets.map(o=>o._id),registration=JSON.parse(reg.registrationJson) as PolicyRegistration;
 const prior=(await ctx.db.query('policyRiskOutcomes').withIndex('by_registration',q=>q.eq('owner',args.owner).eq('registrationId',reg._id)).take(100)).find(o=>o.asOf===args.asOf&&canonical(o.observationIds)===canonical(observationIds));
 if(prior)return prior._id;
 const prices=mergePolicyObservations(data.prices,...sets.map(o=>JSON.parse(o.observationJson) as PolicyObservationSet));
 const report=evaluatePolicyStudy(registration,prices,args.asOf),reportJson=canonical(report);
 if(bytes(reportJson)>MAX_REPORT_BYTES)throw new Error('Outcome report exceeds the pilot size limit');
 const id=await ctx.db.insert('policyRiskOutcomes',{owner:args.owner,registrationId:reg._id,observationIds,asOf:args.asOf,evaluatedAt:now,reportJson,executionAuthority:'none',version:POLICY_RISK_VERSION});
 await ctx.db.insert('audit',{owner:args.owner,action:'policyRisk.outcomes.evaluated',recordId:id,detail:`${report.outcomes.filter(o=>o.status==='complete').length}/${report.outcomes.length} windows complete; recomputed from frozen registration`,at:now});
 return id;
}});
