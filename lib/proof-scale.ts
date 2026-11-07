import { z } from 'zod';

export const PROOF_VERSION='proof-001.2-v1' as const;
export const GATE_TYPES=['business_value','data_integrity','execution_safety','operational_readiness'] as const;
export const STAGES=['idea','limited_pilot','expanded_pilot','production'] as const;
export const evidenceModeSchema=z.enum(['synthetic','historical','forward']);
export type EvidenceMode=z.infer<typeof evidenceModeSchema>;
const timestamp=z.number().finite().nonnegative();
const text=z.string().max(10000);
const identifier=z.string().trim().min(1).max(200);
const stringList=z.array(identifier).max(100);
const sourceUrl=z.string().url().startsWith('https://').refine(s=>{const u=new URL(s);return !u.username&&!u.password;},'Source URLs cannot contain credentials');
export const evidenceRecordSchema=z.object({
  id:identifier,sourceId:identifier,authoritativeSource:text,sourceUrl,dataOwner:text,lastVerifiedAt:timestamp.nullable(),permittedUses:stringList,
  reconciliation:z.enum(['matched','unreconciled','contradictory']),exceptionPolicy:text,revision:z.number().int().positive(),supersedes:identifier.nullable(),
  publishedAt:timestamp,receivedAt:timestamp,mode:evidenceModeSchema,critical:z.boolean(),content:text,
}).strict().refine(r=>r.receivedAt>=r.publishedAt,'Receipt must not precede publication');
export type IntegrityEvidence=z.infer<typeof evidenceRecordSchema>;
export const gateThresholdSchema=z.object({metric:identifier,operator:z.enum(['gte','lte']),value:z.number().finite(),unit:identifier}).strict();
export const gateMeasurementSchema=z.object({metric:identifier,value:z.number().finite(),unit:identifier,evidenceIds:stringList,kind:z.enum(['measured','forecast']),observedAt:timestamp,receivedAt:timestamp}).strict().refine(r=>r.receivedAt>=r.observedAt,'Measurement receipt must follow observation');
export const auditEntrySchema=z.object({at:timestamp,actor:identifier,actorType:z.enum(['human','model','system']),action:identifier,reason:text,evidenceIds:stringList}).strict();
export const gateRecordSchema=z.object({id:identifier,type:z.enum(GATE_TYPES),owner:text,state:z.enum(['not_assessed','pending','passed','failed','expired']),evidenceIds:stringList,thresholds:z.array(gateThresholdSchema).max(50),measurements:z.array(gateMeasurementSchema).max(100),evaluatedAt:timestamp.nullable(),revalidateAt:timestamp.nullable(),decisionBy:identifier.nullable(),decisionActor:z.enum(['human','model']).nullable(),audit:z.array(auditEntrySchema).max(500)}).strict();
export type ProofGate=z.infer<typeof gateRecordSchema>;
export const scopeSchema=z.object({users:stringList.min(1),workflows:stringList.min(1),sourceIds:stringList.min(1),capexCeilingGbp:z.number().finite().nonnegative(),operatingBudgetGbp:z.number().finite().nonnegative(),nextReviewAt:timestamp}).strict();
export type ExpansionScope=z.infer<typeof scopeSchema>;

export function validateEvidenceHistory(input:IntegrityEvidence[]){
  const rows=z.array(evidenceRecordSchema).max(2000).parse(input),ids=new Set<string>(),revisions=new Set<string>(),children=new Set<string>();
  for(const r of rows){
    if(ids.has(r.id))throw new Error('Evidence IDs must be unique');ids.add(r.id);
    const key=`${r.mode}|${r.sourceId}|${r.revision}`;if(revisions.has(key))throw new Error('Source revision must be unique');revisions.add(key);
  }
  const byId=new Map(rows.map(r=>[r.id,r]));
  for(const r of rows){
    if(r.revision===1&&r.supersedes!==null)throw new Error('First revision cannot supersede evidence');
    if(r.revision>1){
      const prior=r.supersedes?byId.get(r.supersedes):undefined;
      if(!prior||prior.sourceId!==r.sourceId||prior.mode!==r.mode||prior.revision+1!==r.revision||r.receivedAt<prior.receivedAt||children.has(prior.id))throw new Error('Revision history must be a complete, ordered, unforked source chain');
      children.add(prior.id);
    }
  }
  return rows;
}
function activeEvidence(rows:IntegrityEvidence[],asOf:number,mode:EvidenceMode){
  const eligible=rows.filter(r=>r.mode===mode&&r.publishedAt<=asOf&&r.receivedAt<=asOf);
  const latest=new Map<string,IntegrityEvidence>();for(const r of eligible){if(!latest.has(r.sourceId)||latest.get(r.sourceId)!.revision<r.revision)latest.set(r.sourceId,r);}
  return {eligible,latest};
}
export function evidenceIntegrity(record:IntegrityEvidence,asOf:number,mode:EvidenceMode,permittedUse:string){
  evidenceRecordSchema.parse(record);timestamp.parse(asOf);
  const blockers:string[]=[];
  if(record.mode!==mode)blockers.push(`${record.id}: evidence mode differs`);
  if(record.publishedAt>asOf||record.receivedAt>asOf)blockers.push(`${record.id}: evidence unavailable at cutoff`);
  if(!record.authoritativeSource.trim())blockers.push(`${record.id}: authoritative source missing`);
  if(!record.dataOwner.trim())blockers.push(`${record.id}: data owner missing`);
  if(record.lastVerifiedAt===null||record.lastVerifiedAt>asOf)blockers.push(`${record.id}: verification unavailable at cutoff`);
  if(!record.permittedUses.includes(permittedUse))blockers.push(`${record.id}: permitted use missing`);
  if(record.reconciliation!=='matched')blockers.push(`${record.id}: reconciliation ${record.reconciliation}`);
  if(!record.exceptionPolicy.trim())blockers.push(`${record.id}: exception policy missing`);
  return blockers;
}
function referenceBlockers(ids:string[],rows:IntegrityEvidence[],asOf:number,mode:EvidenceMode,use:string){
  const blockers:string[]=[];const {latest}=activeEvidence(rows,asOf,mode);const byId=new Map(rows.map(r=>[r.id,r]));
  if(!ids.length)blockers.push('Evidence references required');
  for(const id of ids){const r=byId.get(id);if(!r){blockers.push(`${id}: evidence missing`);continue;}blockers.push(...evidenceIntegrity(r,asOf,mode,use));if(latest.get(r.sourceId)?.id!==id)blockers.push(`${id}: evidence superseded or not active at cutoff`);}
  return blockers;
}
/** Deterministic readiness only. Authentication and approval authority belong to the server. */
export function evaluateGate(input:ProofGate,evidence:IntegrityEvidence[],asOf:number,mode:EvidenceMode,permittedUse:string){
  const gate=gateRecordSchema.parse(input),rows=validateEvidenceHistory(evidence);timestamp.parse(asOf);const blockers:string[]=[];
  if(!gate.owner.trim())blockers.push('Named gate owner required');
  blockers.push(...referenceBlockers(gate.evidenceIds,rows,asOf,mode,permittedUse));
  if(!gate.thresholds.length)blockers.push('Explicit required thresholds are missing');
  const keys=new Set<string>();
  for(const t of gate.thresholds){
    if(keys.has(t.metric))blockers.push(`${t.metric}: duplicate threshold`);keys.add(t.metric);
    const values=gate.measurements.filter(m=>m.metric===t.metric);
    if(values.length!==1){blockers.push(`${t.metric}: unique measurement required`);continue;}
    const m=values[0];
    if(m.kind!=='measured')blockers.push(`${t.metric}: forecast cannot satisfy a measured threshold`);
    if(m.observedAt>asOf||m.receivedAt>asOf||(gate.evaluatedAt!==null&&(m.observedAt>gate.evaluatedAt||m.receivedAt>gate.evaluatedAt)))blockers.push(`${t.metric}: measurement unavailable at evaluation`);
    if(m.unit!==t.unit)blockers.push(`${t.metric}: measurement unit differs`);
    blockers.push(...referenceBlockers(m.evidenceIds,rows,asOf,mode,permittedUse));
    if(m.evidenceIds.some(id=>!gate.evidenceIds.includes(id)))blockers.push(`${t.metric}: measurement source outside gate snapshot`);
    if(!(t.operator==='gte'?m.value>=t.value:m.value<=t.value))blockers.push(`${t.metric}: required threshold failed`);
  }
  if(gate.state==='passed'){
    if(gate.decisionActor!=='human'||!gate.decisionBy)blockers.push('Human gate decision required; model recommendation cannot approve');
    if(gate.evaluatedAt===null||gate.evaluatedAt>asOf)blockers.push('Valid human evaluation date required');
    if(gate.revalidateAt===null||gate.evaluatedAt!==null&&gate.revalidateAt<=gate.evaluatedAt)blockers.push('Revalidation must follow evaluation');
    if(gate.evaluatedAt!==null)for(const id of gate.evidenceIds){const r=rows.find(r=>r.id===id);if(r&&(r.publishedAt>gate.evaluatedAt||r.receivedAt>gate.evaluatedAt||r.lastVerifiedAt===null||r.lastVerifiedAt>gate.evaluatedAt))blockers.push(`${id}: evidence unavailable when gate was evaluated`);}
  }
  const expired=gate.state==='expired'||gate.revalidateAt!==null&&asOf>=gate.revalidateAt;
  const state=expired?'expired':gate.state==='passed'&&blockers.length?'failed':gate.state;
  if(gate.state!=='passed')blockers.push(`Gate is ${gate.state}`);
  if(expired)blockers.push('Gate revalidation expired');
  return {version:PROOF_VERSION,type:gate.type,state,blockers:[...new Set(blockers)],evidenceIds:[...gate.evidenceIds]};
}
export function evaluateExpansion(input:{currentStage:typeof STAGES[number];nextStage:typeof STAGES[number];scope:ExpansionScope;gates:ProofGate[];evidence:IntegrityEvidence[];asOf:number;mode:EvidenceMode;permittedUse:string}){
  const scope=scopeSchema.parse(input.scope),rows=validateEvidenceHistory(input.evidence);timestamp.parse(input.asOf);const blockers:string[]=[];
  z.enum(STAGES).parse(input.currentStage);z.enum(STAGES).parse(input.nextStage);evidenceModeSchema.parse(input.mode);
  if(STAGES.indexOf(input.nextStage)!==STAGES.indexOf(input.currentStage)+1)blockers.push('Only the next defined stage may be approved');
  if(scope.nextReviewAt<=input.asOf)blockers.push('Next review date must be in the future');
  if(input.mode!=='forward'&&input.nextStage==='production')blockers.push('Production expansion requires authentic forward evidence');
  const evaluations=GATE_TYPES.map(type=>{const matching=input.gates.filter(g=>g.type===type);if(matching.length!==1){blockers.push(`${type}: exactly one gate required`);return null;}const result=evaluateGate(matching[0],rows,input.asOf,input.mode,input.permittedUse);if(result.state!=='passed'||result.blockers.length)blockers.push(...result.blockers.map(b=>`${type}: ${b}`));return result;}).filter((r):r is NonNullable<typeof r>=>r!==null);
  const {latest}=activeEvidence(rows,input.asOf,input.mode);
  for(const sourceId of scope.sourceIds){const r=latest.get(sourceId);if(!r)blockers.push(`${sourceId}: permitted source unavailable`);else blockers.push(...evidenceIntegrity(r,input.asOf,input.mode,input.permittedUse));}
  for(const r of latest.values())if(r.critical)blockers.push(...evidenceIntegrity(r,input.asOf,input.mode,input.permittedUse));
  return {version:PROOF_VERSION,allowed:blockers.length===0,blockers:[...new Set(blockers)],gates:evaluations,scope};
}

export const metricValueSchema=z.object({value:z.number().finite().nullable(),status:z.enum(['forecast','unverified','verified']),evidenceIds:stringList}).strict();
export type MeasuredValue=z.infer<typeof metricValueSchema>;
export const COST_CATEGORIES=['inferenceGbp','labourGbp','dataGbp','energyGbp','hardwareDepreciationGbp','operationsGbp','correctionGbp','otherGbp'] as const;
export const costsSchema=z.object({inferenceGbp:metricValueSchema,labourGbp:metricValueSchema,dataGbp:metricValueSchema,energyGbp:metricValueSchema,hardwareDepreciationGbp:metricValueSchema,operationsGbp:metricValueSchema,correctionGbp:metricValueSchema,otherGbp:metricValueSchema}).strict();
export const investmentEconomicsSchema=z.object({mode:evidenceModeSchema,brier:metricValueSchema,mae:metricValueSchema,absoluteReturn:metricValueSchema,benchmarkReturn:metricValueSchema,maxDrawdown:metricValueSchema,costs:costsSchema}).strict();
export const vectisEconomicsSchema=z.object({mode:evidenceModeSchema,baselineWorkflowCostGbp:metricValueSchema,attemptedTasks:metricValueSchema,successfulTasks:metricValueSchema,avoidedExpenditureGbp:metricValueSchema,incrementalContributionGbp:metricValueSchema,customerIncomeGbp:metricValueSchema,costs:costsSchema}).strict();
export type VectisEconomicInput=z.infer<typeof vectisEconomicsSchema>;
export type InvestmentEconomicInput=z.infer<typeof investmentEconomicsSchema>;
function recognised(value:MeasuredValue,rows:IntegrityEvidence[],asOf:number,mode:EvidenceMode,use:string,name:string,blockers:string[]){
  if(value.value===null||value.status!=='verified'){blockers.push(`${name}: verified realised measurement unavailable`);return null;}
  if(name.endsWith('Gbp')&&Math.abs(value.value)>Number.MAX_SAFE_INTEGER/100){blockers.push(`${name}: monetary value exceeds safe numerical range`);return null;}
  const errors=referenceBlockers(value.evidenceIds,rows,asOf,mode,use);if(errors.length){blockers.push(...errors.map(e=>`${name}: ${e}`));return null;}return value.value;
}
function allocatedCosts(costs:z.infer<typeof costsSchema>,rows:IntegrityEvidence[],asOf:number,mode:EvidenceMode,use:string,blockers:string[]){
  const values=COST_CATEGORIES.map(key=>{const value=recognised(costs[key],rows,asOf,mode,use,key,blockers);if(value!==null&&value<0){blockers.push(`${key}: negative cost rejected`);return null;}return value;});
  let fullyAllocatedCostGbp=values.some(v=>v===null)?null:(values as number[]).reduce((a,b)=>a+b,0);
  if(fullyAllocatedCostGbp!==null&&(!Number.isFinite(fullyAllocatedCostGbp)||fullyAllocatedCostGbp>Number.MAX_SAFE_INTEGER/100)){fullyAllocatedCostGbp=null;blockers.push('Allocated cost exceeds safe numerical range');}
  return {fullyAllocatedCostGbp,costs:Object.fromEntries(COST_CATEGORIES.map((key,i)=>[key,values[i]]))};
}
export function investmentEconomics(input:InvestmentEconomicInput,evidence:IntegrityEvidence[],asOf:number,permittedUse:string){
  const r=investmentEconomicsSchema.parse(input),rows=validateEvidenceHistory(evidence),blockers:string[]=[];timestamp.parse(asOf);
  const names=['brier','mae','absoluteReturn','benchmarkReturn','maxDrawdown'] as const;
  const metrics=Object.fromEntries(names.map(key=>[key,recognised(r[key],rows,asOf,r.mode,permittedUse,key,blockers)])) as Record<typeof names[number],number|null>;
  if(metrics.brier!==null&&(metrics.brier<0||metrics.brier>2)){metrics.brier=null;blockers.push('Brier score must be between zero and two');}
  if(metrics.mae!==null&&metrics.mae<0){metrics.mae=null;blockers.push('MAE cannot be negative');}
  if(metrics.maxDrawdown!==null&&(metrics.maxDrawdown<0||metrics.maxDrawdown>1)){metrics.maxDrawdown=null;blockers.push('Maximum drawdown uses positive loss magnitude between zero and one');}
  for(const name of ['absoluteReturn','benchmarkReturn'] as const)if(metrics[name]!==null&&metrics[name]<-1){metrics[name]=null;blockers.push(`${name}: simple return cannot be below negative one`);}
  const sameOutcomeEvidence=JSON.stringify([...new Set(r.absoluteReturn.evidenceIds)].sort())===JSON.stringify([...new Set(r.benchmarkReturn.evidenceIds)].sort());
  if(!sameOutcomeEvidence)blockers.push('Relative returns require the same aligned outcome evidence references');
  return {version:PROOF_VERSION,mode:r.mode,...metrics,benchmarkRelativeReturn:!sameOutcomeEvidence||metrics.absoluteReturn===null||metrics.benchmarkReturn===null?null:metrics.absoluteReturn-metrics.benchmarkReturn,...allocatedCosts(r.costs,rows,asOf,r.mode,permittedUse,blockers),forecasts:Object.fromEntries(names.filter(key=>r[key].status==='forecast').map(key=>[key,r[key]])) as Record<string,MeasuredValue>,blockers:[...new Set(blockers)]};
}
export function vectisEconomics(input:VectisEconomicInput,evidence:IntegrityEvidence[],asOf:number,permittedUse:string){
  const r=vectisEconomicsSchema.parse(input),rows=validateEvidenceHistory(evidence),blockers:string[]=[];timestamp.parse(asOf);
  const names=['baselineWorkflowCostGbp','attemptedTasks','successfulTasks','avoidedExpenditureGbp','incrementalContributionGbp','customerIncomeGbp'] as const;
  const values=Object.fromEntries(names.map(key=>{let v=recognised(r[key],rows,asOf,r.mode,permittedUse,key,blockers);if(v!==null&&(key!=='incrementalContributionGbp'&&v<0||(['attemptedTasks','successfulTasks'].includes(key)&&!Number.isInteger(v)))){blockers.push(`${key}: nonnegative valid amount/count required`);v=null;}return [key,v];})) as Record<typeof names[number],number|null>;
  if(values.successfulTasks!==null&&(values.attemptedTasks===null||values.successfulTasks>values.attemptedTasks)){values.successfulTasks=null;blockers.push('Successful tasks require a valid attempt count and cannot exceed attempts');}
  const allocated=allocatedCosts(r.costs,rows,asOf,r.mode,permittedUse,blockers);
  const realisedProfitGbp=allocated.fullyAllocatedCostGbp===null||values.customerIncomeGbp===null?null:values.customerIncomeGbp-allocated.fullyAllocatedCostGbp;
  const commercialProfitEstablished=r.mode==='forward'&&realisedProfitGbp!==null&&realisedProfitGbp>0&&values.customerIncomeGbp!==null&&values.customerIncomeGbp>0&&values.attemptedTasks!==null&&values.attemptedTasks>0&&values.successfulTasks!==null&&values.successfulTasks>0;
  return {version:PROOF_VERSION,mode:r.mode,...values,...allocated,correctionCostGbp:allocated.costs.correctionGbp,successRate:values.successfulTasks===null||values.attemptedTasks===null||values.attemptedTasks===0?null:values.successfulTasks/values.attemptedTasks,costPerSuccessfulTaskGbp:allocated.fullyAllocatedCostGbp===null||values.successfulTasks===null||values.successfulTasks===0?null:allocated.fullyAllocatedCostGbp/values.successfulTasks,realisedProfitGbp,commercialProfitEstablished,benefitBasis:r.mode==='synthetic'?'Demonstration arithmetic; no genuine customer income or commercial profitability established':'Source-backed research measurements; independent source and workload verification required',forecasts:Object.fromEntries(names.filter(key=>r[key].status==='forecast').map(key=>[key,r[key]])),blockers:[...new Set(blockers)]};
}
export const runUsageSchema=z.object({id:identifier,mode:evidenceModeSchema,provider:identifier,modelVersion:identifier,inputTokens:z.number().int().nonnegative(),outputTokens:z.number().int().nonnegative(),inferenceCostGbp:z.number().finite().nonnegative().nullable(),latencyMs:z.number().finite().nonnegative().nullable(),quality:z.enum(['passed','failed','not_evaluated']),fallbackCalls:z.number().int().nonnegative(),hardware:z.object({energyKwh:z.number().finite().nonnegative().nullable(),depreciationGbp:z.number().finite().nonnegative().nullable(),utilisation:z.number().finite().min(0).max(1).nullable(),throughputPerSecond:z.number().finite().nonnegative().nullable()}).strict()}).strict();
export type RunUsage=z.infer<typeof runUsageSchema>;
export function runEconomics(input:RunUsage[]){
  const runs=z.array(runUsageSchema).max(5000).parse(input);if(new Set(runs.map(r=>r.id)).size!==runs.length)throw new Error('Run IDs must be unique');if(new Set(runs.map(r=>r.mode)).size>1)throw new Error('Run evidence modes cannot be mixed');
  const inferenceCost=runs.length&&runs.every(r=>r.inferenceCostGbp!==null)?runs.reduce((n,r)=>n+r.inferenceCostGbp!,0):null;
  const latency=runs.length&&runs.every(r=>r.latencyMs!==null)?runs.reduce((n,r)=>n+r.latencyMs!,0)/runs.length:null;
  return {version:PROOF_VERSION,runs:runs.length,inputTokens:runs.reduce((n,r)=>n+r.inputTokens,0),outputTokens:runs.reduce((n,r)=>n+r.outputTokens,0),fallbackCalls:runs.reduce((n,r)=>n+r.fallbackCalls,0),successfulTasks:runs.filter(r=>r.quality==='passed').length,inferenceCostGbp:inferenceCost!==null&&Number.isFinite(inferenceCost)&&inferenceCost<=Number.MAX_SAFE_INTEGER/100?inferenceCost:null,meanLatencyMs:latency!==null&&Number.isFinite(latency)?latency:null,fullServiceCostGbp:null,profitability:'Not established: per-run inference statistics exclude complete service costs and customer income'};
}
