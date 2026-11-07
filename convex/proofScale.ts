import {researcher,reviewer,signedIn} from './authz';
import { v } from 'convex/values';
import type { GenericId } from 'convex/values';
import type { GenericMutationCtx,GenericQueryCtx } from 'convex/server';
import { query,mutation,internalMutation,type DataModel,type TableName } from './server';
import { proofDomain,proofMode,proofStage,proofGateType,proofMeasurement,proofRun } from './proofValidators';
import { evidenceRecordSchema,gateRecordSchema,scopeSchema,evaluateGate,evaluateExpansion,validateEvidenceHistory,gateMeasurementSchema,runUsageSchema,investmentEconomicsSchema,vectisEconomicsSchema,investmentEconomics,vectisEconomics } from '../lib/proof-scale';

const VERSION='proof-001.2-v1';
type Ctx=GenericMutationCtx<DataModel>|GenericQueryCtx<DataModel>;
async function identity(ctx:Ctx){return await signedIn(ctx);}
// actorType must be a signed identity-provider claim, never a browser argument.
/** Research authoring: any signed-in human researcher. Stage decisions: explicit reviewer grant (convex/authz.ts). */
async function human(ctx:Ctx){return await researcher(ctx);}
async function decisionReviewer(ctx:Ctx){return await reviewer(ctx);}
async function owned<T extends TableName>(ctx:Ctx,id:GenericId<T>,owner:string){const row=await ctx.db.get(id);if(!row||row.owner!==owner)throw new Error('Record unavailable');return row;}
function canonical(value:unknown):string{if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value!==null&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;return JSON.stringify(value);}
function text(value:string,name:string,max=4000){if(!value.trim()||value.length>max)throw new Error(`${name} is required and must fit the pilot limit`);}
function finite(values:number[]){if(values.some(n=>!Number.isFinite(n)||n<0))throw new Error('Finite nonnegative values required');}
async function audit(ctx:GenericMutationCtx<DataModel>,owner:string,action:string,recordId:string,detail:string){await ctx.db.insert('audit',{owner,action,recordId,detail,at:Date.now()});}
async function evidenceFor(ctx:Ctx,owner:string,pilotId:GenericId<'proofPilots'>){const records=await ctx.db.query('proofEvidence').withIndex('by_pilot',q=>q.eq('owner',owner).eq('pilotId',pilotId)).take(401);if(records.length>400)throw new Error('Integrity register exceeds pilot limit');return records.map(row=>evidenceRecordSchema.parse(JSON.parse(row.recordJson)));}
async function currentGates(ctx:Ctx,owner:string,pilotId:GenericId<'proofPilots'>){
  const definitions=await ctx.db.query('proofGates').withIndex('by_pilot',q=>q.eq('owner',owner).eq('pilotId',pilotId)).take(101);
  if(definitions.length>100)throw new Error('Gate definition history exceeds pilot limit');
  const latest=new Map<string,typeof definitions[number]>();for(const row of definitions.sort((a,b)=>a._creationTime-b._creationTime))latest.set(row.type,row);
  const measurements=await ctx.db.query('proofMeasurements').withIndex('by_pilot',q=>q.eq('owner',owner).eq('pilotId',pilotId)).take(501);if(measurements.length>500)throw new Error('Measurements exceed pilot limit');
  const result=[];
  for(const definition of latest.values()){
    const decisions=await ctx.db.query('proofGateDecisions').withIndex('by_gate',q=>q.eq('owner',owner).eq('gateId',definition._id)).order('desc').take(100);
    const gate=gateRecordSchema.parse(JSON.parse(decisions[0]?.gateJson??definition.definitionJson));
    const latestMeasurements=new Map<string,typeof measurements[number]>();
    for(const row of measurements.filter(m=>m.type===definition.type).sort((a,b)=>a.record.observedAt-b.record.observedAt||a.record.receivedAt-b.record.receivedAt||a._creationTime-b._creationTime))latestMeasurements.set(row.record.metric,row);
    const candidateMeasurements=Array.from(latestMeasurements.values(),row=>row.record).sort((a,b)=>a.metric.localeCompare(b.metric));
    const measurementRevisionPending=decisions.length>0&&canonical([...gate.measurements].sort((a,b)=>a.metric.localeCompare(b.metric)))!==canonical(candidateMeasurements);
    result.push({definition,decisions,gate,candidateMeasurements,measurementRevisionPending});
  }
  return result;
}

export const list=query({args:{},handler:async(ctx)=>{const user=await identity(ctx);return ctx.db.query('proofPilots').withIndex('by_owner',q=>q.eq('owner',user.tokenIdentifier)).take(100);}});
export const detail=query({args:{pilotId:v.id('proofPilots')},handler:async(ctx,args)=>{
  const user=await identity(ctx),owner=user.tokenIdentifier,pilot=await owned(ctx,args.pilotId,owner),evidence=await evidenceFor(ctx,owner,args.pilotId),now=Date.now();
  const gates=await currentGates(ctx,owner,args.pilotId);
  const recommendations=await ctx.db.query('proofRecommendations').withIndex('by_pilot',q=>q.eq('owner',owner).eq('pilotId',args.pilotId)).take(100);
  const expansions=await ctx.db.query('proofExpansions').withIndex('by_pilot',q=>q.eq('owner',owner).eq('pilotId',args.pilotId)).take(100);
  const rollbacks=await ctx.db.query('proofRollbacks').withIndex('by_pilot',q=>q.eq('owner',owner).eq('pilotId',args.pilotId)).take(100);
  const runs=await ctx.db.query('proofRuns').withIndex('by_pilot',q=>q.eq('owner',owner).eq('pilotId',args.pilotId)).take(100);
  const economicRecords=await ctx.db.query('proofEconomics').withIndex('by_pilot',q=>q.eq('owner',owner).eq('pilotId',args.pilotId)).order('desc').take(100);
  const economics=economicRecords.map(row=>({...row,input:JSON.parse(row.recordJson),calculation:JSON.parse(row.calculationJson),currentCalculation:row.domain==='investment'?investmentEconomics(investmentEconomicsSchema.parse(JSON.parse(row.recordJson)),evidence,now,pilot.permittedUse):vectisEconomics(vectisEconomicsSchema.parse(JSON.parse(row.recordJson)),evidence,now,pilot.permittedUse)}));
  return {version:VERSION,pilot,evidence,economics,gates:gates.map(row=>({...row,evaluation:row.measurementRevisionPending?{...evaluateGate(row.gate,evidence,now,pilot.mode,pilot.permittedUse),state:'failed',blockers:[...evaluateGate(row.gate,evidence,now,pilot.mode,pilot.permittedUse).blockers,'New measurement requires human re-review']}:evaluateGate(row.gate,evidence,now,pilot.mode,pilot.permittedUse)})),recommendations,expansions,rollbacks,runs,humanReviewer:user.actorType==='human',asOf:now};
}});
export const createPilot=mutation({args:{name:v.string(),domain:proofDomain,mode:proofMode,permittedUse:v.string()},handler:async(ctx,args)=>{const user=await human(ctx);text(args.name,'Pilot name',200);text(args.permittedUse,'Permitted use',200);const id=await ctx.db.insert('proofPilots',{...args,owner:user.tokenIdentifier,stage:'idea',createdAt:Date.now()});await audit(ctx,user.tokenIdentifier,'proof.pilot.created',id,`${VERSION}; ${args.mode}`);return id;}});

// Trusted import service owns verification and links. Models/browser clients cannot assert it.
export const importEvidence=internalMutation({args:{owner:v.string(),pilotId:v.id('proofPilots'),recordJson:v.string(),linkedEvidenceId:v.optional(v.id('evidence')),linkedEarningsEventId:v.optional(v.id('earningsEvents')),linkedStressImportId:v.optional(v.id('stressImports'))},handler:async(ctx,args)=>{
  const pilot=await owned(ctx,args.pilotId,args.owner),now=Date.now();if(args.recordJson.length>50000)throw new Error('Evidence exceeds pilot size limit');
  const declaredRecord=evidenceRecordSchema.parse(JSON.parse(args.recordJson));const record={...declaredRecord,receivedAt:now};if(declaredRecord.mode!==pilot.mode||declaredRecord.receivedAt>now||record.lastVerifiedAt!==null&&record.lastVerifiedAt>now)throw new Error('Future verification/receipt or mixed evidence mode');
  for(const id of [args.linkedEvidenceId,args.linkedEarningsEventId,args.linkedStressImportId])if(id)await owned(ctx,id,args.owner);
  if(args.linkedEarningsEventId){const event=await owned(ctx,args.linkedEarningsEventId,args.owner);if(!event.sources.some(source=>source.url===record.sourceUrl))throw new Error('Integrity source is not in the linked earnings registry');}
  if(args.linkedStressImportId){const imported=await owned(ctx,args.linkedStressImportId,args.owner),dataset=JSON.parse(imported.datasetJson),financials=JSON.parse(imported.financialsJson);if(dataset.synthetic!==(record.mode==='synthetic')||![...dataset.bars,...financials].some((source:{sourceUrl:string})=>source.sourceUrl===record.sourceUrl))throw new Error('Integrity source or mode differs from linked stress import');}
  const previous=await ctx.db.query('proofEvidence').withIndex('by_external',q=>q.eq('owner',args.owner).eq('pilotId',args.pilotId).eq('externalId',record.id)).first();
  const recordJson=canonical(record),declaredRecordJson=canonical(declaredRecord);
  if(previous){if(previous.declaredRecordJson!==declaredRecordJson||previous.linkedEvidenceId!==args.linkedEvidenceId||previous.linkedEarningsEventId!==args.linkedEarningsEventId||previous.linkedStressImportId!==args.linkedStressImportId)throw new Error('Immutable integrity revision conflicts');return previous._id;}
  const history=await evidenceFor(ctx,args.owner,args.pilotId);if(history.length>=400)throw new Error('Integrity register exceeds pilot limit');validateEvidenceHistory([...history,record]);
  const id=await ctx.db.insert('proofEvidence',{owner:args.owner,pilotId:args.pilotId,externalId:record.id,sourceId:record.sourceId,revision:record.revision,recordJson,declaredRecordJson,declaredReceivedAt:declaredRecord.receivedAt,ingestedAt:now,...(args.linkedEvidenceId?{linkedEvidenceId:args.linkedEvidenceId}:{}),...(args.linkedEarningsEventId?{linkedEarningsEventId:args.linkedEarningsEventId}:{}),...(args.linkedStressImportId?{linkedStressImportId:args.linkedStressImportId}:{})});
  await audit(ctx,args.owner,'proof.integrity.imported',id,`${record.sourceId} revision ${record.revision}`);return id;
}});
export const defineGate=mutation({args:{pilotId:v.id('proofPilots'),gateJson:v.string()},handler:async(ctx,args)=>{
  const user=await human(ctx);await owned(ctx,args.pilotId,user.tokenIdentifier);if(args.gateJson.length>100000)throw new Error('Gate exceeds pilot limit');
  const input=gateRecordSchema.parse(JSON.parse(args.gateJson));const gate={...input,state:'not_assessed' as const,measurements:[],evaluatedAt:null,revalidateAt:null,decisionBy:null,decisionActor:null,audit:[]};
  const existing=await ctx.db.query('proofGates').withIndex('by_pilot',q=>q.eq('owner',user.tokenIdentifier).eq('pilotId',args.pilotId)).take(101);if(existing.length>=100)throw new Error('Gate definition history exceeds pilot limit');
  const id=await ctx.db.insert('proofGates',{owner:user.tokenIdentifier,pilotId:args.pilotId,type:gate.type,definitionJson:canonical(gate),createdAt:Date.now()});
  await audit(ctx,user.tokenIdentifier,'proof.gate.defined',id,'New definition invalidates the prior definition for this gate');return id;
}});
export const recordMeasurement=internalMutation({args:{owner:v.string(),pilotId:v.id('proofPilots'),type:proofGateType,externalId:v.string(),record:proofMeasurement},handler:async(ctx,args)=>{
  await owned(ctx,args.pilotId,args.owner);text(args.externalId,'Measurement ID',200);const declaredRecord=gateMeasurementSchema.parse(args.record),r={...declaredRecord,receivedAt:Date.now()};finite([Math.abs(r.value),r.observedAt,declaredRecord.receivedAt]);if(!r.metric.trim()||!r.unit.trim()||!r.evidenceIds.length||r.observedAt>declaredRecord.receivedAt||declaredRecord.receivedAt>Date.now())throw new Error('Measurement provenance and receipt required');
  const evidence=await evidenceFor(ctx,args.owner,args.pilotId);if(r.evidenceIds.some(id=>!evidence.some(e=>e.id===id)))throw new Error('Measurement source outside integrity register');
  const previous=await ctx.db.query('proofMeasurements').withIndex('by_external',q=>q.eq('owner',args.owner).eq('pilotId',args.pilotId).eq('externalId',args.externalId)).first();if(previous){if(previous.declaredRecordJson!==canonical(declaredRecord)||previous.type!==args.type)throw new Error('Immutable measurement conflicts');return previous._id;}
  const all=await ctx.db.query('proofMeasurements').withIndex('by_pilot',q=>q.eq('owner',args.owner).eq('pilotId',args.pilotId)).take(501);if(all.length>=500)throw new Error('Measurements exceed pilot limit');if(all.some(m=>m.type===args.type&&m.record.metric===r.metric&&m.record.observedAt===r.observedAt&&m.record.receivedAt===r.receivedAt))throw new Error('Ambiguous measured observation');
  return ctx.db.insert('proofMeasurements',{...args,record:r,declaredRecordJson:canonical(declaredRecord),declaredReceivedAt:declaredRecord.receivedAt,ingestedAt:Date.now()});
}});
export const reviewGate=mutation({args:{pilotId:v.id('proofPilots'),gateId:v.id('proofGates'),decision:v.union(v.literal('pass'),v.literal('fail'),v.literal('pending')),revalidateAt:v.number(),reason:v.string()},handler:async(ctx,args)=>{
  const user=await decisionReviewer(ctx),owner=user.tokenIdentifier,pilot=await owned(ctx,args.pilotId,owner),definition=await owned(ctx,args.gateId,owner),now=Date.now();if(definition.pilotId!==args.pilotId)throw new Error('Gate belongs to another pilot');text(args.reason,'Review reason');if(!Number.isFinite(args.revalidateAt)||args.revalidateAt<=now)throw new Error('Future revalidation date required');
  const current=await currentGates(ctx,owner,args.pilotId),entry=current.find(row=>row.definition.type===definition.type);if(!entry||entry.definition._id!==args.gateId)throw new Error('Gate definition was superseded');
  const evidence=await evidenceFor(ctx,owner,args.pilotId);const gate=gateRecordSchema.parse({...entry.gate,measurements:entry.candidateMeasurements,state:args.decision==='pass'?'passed':args.decision==='fail'?'failed':'pending',evaluatedAt:now,revalidateAt:args.revalidateAt,decisionBy:user.subject,decisionActor:'human',audit:[...entry.gate.audit,{at:now,actor:user.subject,actorType:'human',action:args.decision,reason:args.reason,evidenceIds:entry.gate.evidenceIds}]});
  const evaluation=evaluateGate(gate,evidence,now,pilot.mode,pilot.permittedUse);const decision=args.decision==='pass'&&evaluation.state!=='passed'?'fail':args.decision;const sealedGate=decision!==args.decision?{...gate,state:'failed',audit:[...gate.audit,{at:now,actor:user.subject,actorType:'human',action:'blocked_pass',reason:evaluation.blockers.join('; '),evidenceIds:gate.evidenceIds}]}:gate;
  const id=await ctx.db.insert('proofGateDecisions',{owner,pilotId:args.pilotId,gateId:args.gateId,type:gate.type,decision,reviewer:user.subject,evaluatedAt:now,revalidateAt:args.revalidateAt,reason:args.reason,gateJson:canonical(sealedGate),evaluationJson:canonical(evaluation)});
  await audit(ctx,owner,`proof.gate.${decision}`,id,`${args.reason}; ${evaluation.blockers.join('; ')}`);return {id,decision,evaluation};
}});
export const recommendGate=internalMutation({args:{owner:v.string(),pilotId:v.id('proofPilots'),type:proofGateType,modelVersion:v.string(),recommendation:v.string(),evidenceIds:v.array(v.string())},handler:async(ctx,args)=>{await owned(ctx,args.pilotId,args.owner);text(args.modelVersion,'Model version',200);text(args.recommendation,'Recommendation');const evidence=await evidenceFor(ctx,args.owner,args.pilotId);if(args.evidenceIds.some(id=>!evidence.some(e=>e.id===id)))throw new Error('Recommendation source outside register');return ctx.db.insert('proofRecommendations',{...args,createdAt:Date.now()});}});
export const decideExpansion=mutation({args:{pilotId:v.id('proofPilots'),nextStage:proofStage,scopeJson:v.string(),decision:v.union(v.literal('approve'),v.literal('reject')),reason:v.string()},handler:async(ctx,args)=>{
  const user=await decisionReviewer(ctx),owner=user.tokenIdentifier,pilot=await owned(ctx,args.pilotId,owner),now=Date.now();text(args.reason,'Decision reason');if(args.scopeJson.length>50000)throw new Error('Scope exceeds pilot limit');const scope=scopeSchema.parse(JSON.parse(args.scopeJson));
  const evidence=await evidenceFor(ctx,owner,args.pilotId),gates=await currentGates(ctx,owner,args.pilotId);const evaluation=evaluateExpansion({currentStage:pilot.stage,nextStage:args.nextStage,scope,gates:gates.map(g=>g.measurementRevisionPending?{...g.gate,state:'failed' as const}:g.gate),evidence,asOf:now,mode:pilot.mode,permittedUse:pilot.permittedUse});
  const decision=args.decision==='approve'&&evaluation.allowed?'approve':'reject';
  const id=await ctx.db.insert('proofExpansions',{owner,pilotId:args.pilotId,fromStage:pilot.stage,toStage:args.nextStage,decision,reviewer:user.subject,scopeJson:canonical(scope),evaluationJson:canonical(evaluation),reason:args.reason,createdAt:now});
  if(decision==='approve')await ctx.db.patch(args.pilotId,{stage:args.nextStage});await audit(ctx,owner,`proof.expansion.${decision}`,id,`${args.reason}; ${evaluation.blockers.join('; ')}`);return {id,decision,evaluation};
}});
export const rollback=mutation({args:{pilotId:v.id('proofPilots'),toStage:proofStage,reason:v.string(),actions:v.array(v.string())},handler:async(ctx,args)=>{const user=await decisionReviewer(ctx),owner=user.tokenIdentifier,pilot=await owned(ctx,args.pilotId,owner);text(args.reason,'Rollback reason');const stages=['idea','limited_pilot','expanded_pilot','production'];if(stages.indexOf(args.toStage)>=stages.indexOf(pilot.stage)||!args.actions.length||args.actions.length>30||args.actions.some(action=>!action.trim()))throw new Error('Rollback requires a lower stage and defined actions');const id=await ctx.db.insert('proofRollbacks',{...args,owner,fromStage:pilot.stage,reviewer:user.subject,createdAt:Date.now()});await ctx.db.patch(args.pilotId,{stage:args.toStage});await audit(ctx,owner,'proof.rollback',id,args.reason);return id;}});
export const recordRun=internalMutation({args:{owner:v.string(),pilotId:v.id('proofPilots'),record:proofRun,evidenceIds:v.array(v.string()),observedAt:v.number(),receivedAt:v.number(),qualityEvaluation:v.optional(v.string())},handler:async(ctx,args)=>{
  const pilot=await owned(ctx,args.pilotId,args.owner),r=runUsageSchema.parse(args.record);finite([args.observedAt,args.receivedAt]);if(r.mode!==pilot.mode||args.receivedAt<args.observedAt||args.receivedAt>Date.now())throw new Error('Run mode and receipt invalid');
  if(args.qualityEvaluation)text(args.qualityEvaluation,'Quality evaluation');
  const evidence=await evidenceFor(ctx,args.owner,args.pilotId);if(!args.evidenceIds.length||args.evidenceIds.some(id=>!evidence.some(e=>e.id===id)))throw new Error('Run sources outside integrity register');
  const previous=await ctx.db.query('proofRuns').withIndex('by_run',q=>q.eq('owner',args.owner).eq('pilotId',args.pilotId).eq('record.id',r.id)).first();if(previous){if(canonical(previous.record)!==canonical(r)||canonical(previous.evidenceIds)!==canonical(args.evidenceIds)||previous.observedAt!==args.observedAt||previous.declaredReceivedAt!==args.receivedAt||previous.qualityEvaluation!==args.qualityEvaluation)throw new Error('Immutable run conflicts');return previous._id;}return ctx.db.insert('proofRuns',{...args,record:r,receivedAt:Date.now(),declaredReceivedAt:args.receivedAt,ingestedAt:Date.now()});
}});
export const recordEconomics=internalMutation({args:{owner:v.string(),pilotId:v.id('proofPilots'),externalId:v.string(),recordJson:v.string(),observedAt:v.number(),receivedAt:v.number()},handler:async(ctx,args)=>{
  const pilot=await owned(ctx,args.pilotId,args.owner);text(args.externalId,'Economic record ID',200);finite([args.observedAt,args.receivedAt]);if(args.receivedAt<args.observedAt||args.receivedAt>Date.now()||args.recordJson.length>150000)throw new Error('Economic receipt or size invalid');
  const record=pilot.domain==='investment'?investmentEconomicsSchema.parse(JSON.parse(args.recordJson)):vectisEconomicsSchema.parse(JSON.parse(args.recordJson));if(record.mode!==pilot.mode)throw new Error('Economic evidence mode differs');
  const recordJson=canonical(record),previous=await ctx.db.query('proofEconomics').withIndex('by_external',q=>q.eq('owner',args.owner).eq('pilotId',args.pilotId).eq('externalId',args.externalId)).first();if(previous){if(previous.recordJson!==recordJson||previous.observedAt!==args.observedAt||previous.declaredReceivedAt!==args.receivedAt)throw new Error('Immutable economics conflict');return previous._id;}
  const evidence=await evidenceFor(ctx,args.owner,args.pilotId),evaluatedAt=Date.now();const calculation=pilot.domain==='investment'?investmentEconomics(investmentEconomicsSchema.parse(record),evidence,evaluatedAt,pilot.permittedUse):vectisEconomics(vectisEconomicsSchema.parse(record),evidence,evaluatedAt,pilot.permittedUse);
  return ctx.db.insert('proofEconomics',{owner:args.owner,pilotId:args.pilotId,externalId:args.externalId,domain:pilot.domain,recordJson,calculationJson:canonical(calculation),evidenceJson:canonical(evidence),evaluatedAt,observedAt:args.observedAt,receivedAt:Date.now(),declaredReceivedAt:args.receivedAt,ingestedAt:Date.now()});
}});
