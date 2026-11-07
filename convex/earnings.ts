import { v } from 'convex/values';
import { query, mutation, internalMutation } from './server';
import { metricRecord, sourceRecord } from './earningsValidators';
import { parseMetricRecords, freezeEarningsSnapshot } from '../lib/earnings';
import {AMAZON_CASH_VERSION,parseAmazonCashCase,freezeAmazonCase,buildAmazonInterpretation} from '../lib/amazon-cash-conversion';
import {AMAZON_INTERPRETATION_VERSION,validateAmazonInterpretationManifest,validateAmazonInterpretationResult} from '../lib/amazon-interpretation';
function canonical(value:unknown):string { if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value!==null&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;return JSON.stringify(value); }

// Trusted ingestion only. Browser callers cannot declare their own observations verified.
export const importEvent=internalMutation({args:{owner:v.string(),eventKey:v.string(),ticker:v.string(),period:v.string(),releaseAt:v.union(v.number(),v.null()),sources:v.array(sourceRecord)},handler:async(ctx,args)=>{
  const now=Date.now();
  if(!args.owner.trim()||!args.eventKey.trim()||!args.ticker.trim()||!/^\d{4}-Q[1-4]$/.test(args.period)||!args.sources.length||args.sources.length>100)throw new Error('Event identity, quarter and sources required');
  if(args.releaseAt!==null&&(!Number.isFinite(args.releaseAt)||args.releaseAt>now))throw new Error('Invalid release timestamp');
  for(const source of args.sources){if(!/^https:\/\//.test(source.url)||!Number.isFinite(source.receivedAt)||source.receivedAt>now||source.publishedAt!==null&&(!Number.isFinite(source.publishedAt)||source.publishedAt>source.receivedAt))throw new Error('Invalid source timestamps or URL');}
  const previous=await ctx.db.query('earningsEvents').withIndex('by_key',q=>q.eq('owner',args.owner).eq('eventKey',args.eventKey)).first();
  if(previous){for(const key of Object.keys(args) as Array<keyof typeof args>){if(canonical(previous[key])!==canonical(args[key]))throw new Error('Event exists with different metadata; import a new event version');}return previous._id;}
  return ctx.db.insert('earningsEvents',{...args,createdAt:now});
}});
export const appendMetrics=internalMutation({args:{owner:v.string(),eventId:v.id('earningsEvents'),records:v.array(metricRecord)},handler:async(ctx,args)=>{
  const event=await ctx.db.get(args.eventId);if(!event||event.owner!==args.owner)throw new Error('Record unavailable');
  if(!args.records.length||args.records.length>100)throw new Error('Supply 1–100 records');
  const records=parseMetricRecords(args.records);const ids=[];const now=Date.now();
  for(const record of records){
    if(record.receivedAt>now||record.publishedAt!==null&&record.publishedAt>record.receivedAt)throw new Error('Invalid metric timestamps');
    if(!event.sources.some(s=>s.url===record.sourceUrl))throw new Error('Metric source must belong to the event');
    const previous=await ctx.db.query('earningsMetrics').withIndex('by_external',q=>q.eq('owner',args.owner).eq('eventId',args.eventId).eq('record.id',record.id)).first();
    if(previous){if(canonical(previous.record)!==canonical(record))throw new Error('Metric ID conflicts; append a new revision');ids.push(previous._id);continue;}
    if(record.supersedes){const original=await ctx.db.query('earningsMetrics').withIndex('by_external',q=>q.eq('owner',args.owner).eq('eventId',args.eventId).eq('record.id',record.supersedes!)).first();if(!original||original.record.metric!==record.metric||original.record.period!==record.period)throw new Error('Revision must reference the same metric and period');}
    ids.push(await ctx.db.insert('earningsMetrics',{owner:args.owner,eventId:args.eventId,record,ingestedAt:now}));
  }
  return ids;
}});
export const listEvents=query({args:{},handler:async(ctx)=>{const user=await ctx.auth.getUserIdentity();if(!user)throw new Error('Sign in required');return ctx.db.query('earningsEvents').withIndex('by_owner',q=>q.eq('owner',user.tokenIdentifier)).take(100);}});
export const eventDetail=query({args:{eventId:v.id('earningsEvents')},handler:async(ctx,args)=>{
  const user=await ctx.auth.getUserIdentity();if(!user)throw new Error('Sign in required');const event=await ctx.db.get(args.eventId);if(!event||event.owner!==user.tokenIdentifier)throw new Error('Record unavailable');
  return {event,metrics:await ctx.db.query('earningsMetrics').withIndex('by_event',q=>q.eq('owner',user.tokenIdentifier).eq('eventId',args.eventId)).take(1000),snapshots:await ctx.db.query('earningsSnapshots').withIndex('by_event',q=>q.eq('owner',user.tokenIdentifier).eq('eventId',args.eventId)).take(100)};
}});
export const freezeSnapshot=mutation({args:{eventId:v.id('earningsEvents'),phase:v.union(v.literal('pre'),v.literal('post')),cutoff:v.number()},handler:async(ctx,args)=>{
  const user=await ctx.auth.getUserIdentity();if(!user)throw new Error('Sign in required');const event=await ctx.db.get(args.eventId);if(!event||event.owner!==user.tokenIdentifier)throw new Error('Record unavailable');
  if(!Number.isFinite(args.cutoff)||args.cutoff>Date.now())throw new Error('Future cutoff forbidden');
  const rows=await ctx.db.query('earningsMetrics').withIndex('by_event',q=>q.eq('owner',user.tokenIdentifier).eq('eventId',args.eventId)).take(1001);if(rows.length>1000)throw new Error('Evidence exceeds pilot snapshot limit');
  // Server ingestion time is also required: imported historical receipts cannot backdate this workspace's knowledge.
  const eligible=rows.filter(row=>row.ingestedAt<=args.cutoff);
  const snapshot=freezeEarningsSnapshot(eligible.map(row=>row.record),{phase:args.phase,cutoff:args.cutoff,earningsPublishedAt:event.releaseAt});
  if(snapshot.status==='blocked')throw new Error('No eligible evidence at cutoff');
  return ctx.db.insert('earningsSnapshots',{owner:user.tokenIdentifier,eventId:args.eventId,phase:args.phase,cutoff:args.cutoff,records:snapshot.evidence,excluded:[...snapshot.excluded,...rows.filter(row=>row.ingestedAt>args.cutoff).map(row=>({id:row.record.id,reason:'Imported into this workspace after cutoff'}))],createdAt:Date.now()});
}});

/** The linked case preserves guidance separately; the established MetricRecord contract remains unchanged. */
export const importInterpretationCase=internalMutation({args:{owner:v.string(),eventId:v.id('earningsEvents'),externalId:v.string(),caseJson:v.string()},handler:async(ctx,args)=>{
  const now=Date.now();
  if(!args.owner.trim()||args.owner.length>1000||!args.externalId.trim()||args.externalId.length>240||new TextEncoder().encode(args.caseJson).byteLength>800000)throw new Error('Bounded owner, import identifier and case are required');
  const event=await ctx.db.get(args.eventId);
  if(!event||event.owner!==args.owner||event.ticker!=='AMZN'||event.period!=='2026-Q3')throw new Error('Owned Amazon Q3 2026 earnings event required');
  const record=parseAmazonCashCase(JSON.parse(args.caseJson));
  if([...record.sources,...record.observations,...record.bedrock].some(r=>r.receivedAt>now)||record.sources.some(s=>s.publishedAt!==null&&s.publishedAt>now))throw new Error('Future receipt or publication cannot be imported as already known');
  if(record.sources.some(s=>!event.sources.some(registered=>registered.url===s.url)))throw new Error('Every case source must already belong to the linked earnings event');
  const recordJson=canonical(record),prior=await ctx.db.query('earningsInterpretationCases').withIndex('by_external',q=>q.eq('owner',args.owner).eq('externalId',args.externalId)).first();
  if(prior){if(prior.eventId!==args.eventId||prior.recordJson!==recordJson)throw new Error('Immutable interpretation case conflicts; register a new case version');return prior._id;}
  const id=await ctx.db.insert('earningsInterpretationCases',{owner:args.owner,eventId:args.eventId,externalId:args.externalId,name:record.name,recordJson,ingestedAt:now,version:AMAZON_CASH_VERSION});
  await ctx.db.insert('audit',{owner:args.owner,action:'earnings.interpretation.case.imported',recordId:id,detail:'Retrospective Amazon cash-conversion case; reported results and management forecasts remain distinct',at:now});
  return id;
}});

export const listInterpretationCases=query({args:{},handler:async(ctx)=>{
  const user=await ctx.auth.getUserIdentity();if(!user)throw new Error('Sign in required');
  return (await ctx.db.query('earningsInterpretationCases').withIndex('by_owner',q=>q.eq('owner',user.tokenIdentifier)).take(100)).map(row=>({caseId:row._id,eventId:row.eventId,externalId:row.externalId,name:row.name,ingestedAt:row.ingestedAt,version:row.version,mode:'retrospective' as const}));
}});

export const interpretationCaseDetail=query({args:{caseId:v.id('earningsInterpretationCases')},handler:async(ctx,args)=>{
  const user=await ctx.auth.getUserIdentity();if(!user)throw new Error('Sign in required');
  const row=await ctx.db.get(args.caseId);if(!row||row.owner!==user.tokenIdentifier)throw new Error('Record unavailable');
  const experiments=await ctx.db.query('earningsInterpretationExperiments').withIndex('by_case',q=>q.eq('owner',user.tokenIdentifier).eq('caseId',args.caseId)).take(100);
  const registered=await Promise.all(experiments.map(async experiment=>{
    const results=await ctx.db.query('earningsInterpretationResults').withIndex('by_experiment',q=>q.eq('owner',user.tokenIdentifier).eq('experimentId',experiment._id)).take(100);
    return {experimentId:experiment._id,name:experiment.name,cutoff:experiment.cutoff,registeredAt:experiment.registeredAt,experimentMode:experiment.experimentMode,manifest:JSON.parse(experiment.manifestJson),results:results.map(result=>({resultId:result._id,externalId:result.externalId,ingestedAt:result.ingestedAt,result:JSON.parse(result.resultJson)}))};
  }));
  return {metadata:{caseId:row._id,eventId:row.eventId,externalId:row.externalId,name:row.name,ingestedAt:row.ingestedAt,version:row.version,mode:'retrospective' as const},case:parseAmazonCashCase(JSON.parse(row.recordJson)),experiments:registered,executionAuthority:'none' as const};
}});

/** Interpretation is not a financial/market forecast and cannot mutate the paper or broker domains. */
export const registerInterpretationExperiment=mutation({args:{caseId:v.id('earningsInterpretationCases'),name:v.string(),cutoff:v.number(),models:v.array(v.object({provider:v.string(),modelVersion:v.string()}))},handler:async(ctx,args)=>{
  const user=await ctx.auth.getUserIdentity();if(!user)throw new Error('Sign in required');
  const row=await ctx.db.get(args.caseId);if(!row||row.owner!==user.tokenIdentifier)throw new Error('Record unavailable');
  const now=Date.now();
  if(!args.name.trim()||args.name.length>500||!Number.isSafeInteger(args.cutoff)||args.cutoff<0||args.cutoff>now)throw new Error('Name and finite nonfuture evidence cutoff required');
  if(row.ingestedAt>args.cutoff)throw new Error('Case was imported into this workspace after cutoff; retrospective receipt times cannot be backdated');
  if(args.models.length!==2||args.models.some(model=>!model.provider.trim()||model.provider.length>200||!model.modelVersion.trim()||model.modelVersion.length>200||['pending','unconfigured','tbd'].includes(model.modelVersion.trim().toLowerCase()))||new Set(args.models.map(model=>model.provider.trim().toLowerCase())).size!==2)throw new Error('Two exact model versions from distinct declared providers are required');
  const record=parseAmazonCashCase(JSON.parse(row.recordJson)),snapshot=freezeAmazonCase(record,args.cutoff);
  if(!snapshot.case.observations.some(observation=>observation.kind==='reported'||observation.kind==='derived'))throw new Error('No eligible financial evidence at cutoff');
  const interpretation=buildAmazonInterpretation(record,'2026-Q3',args.cutoff);
  const interpretationRubric={version:'amazon-economic-interpretation-v1',status:'unscored_pending_independent_adjudication',dimensions:['Reconcile quarterly, trailing-twelve-month and calendar-year definitions','Separate company cash conversion from AWS segment operating income','Reconcile gross purchases, proceeds and net cash capex','Keep management guidance and expectations separate from realised results','Identify the distinct Bedrock token-volume and Fortune 500 spending populations','Keep unavailable AI-specific returns null and avoid trade recommendations'],weights:null};
  const manifest={...interpretation,models:interpretation.models.map((slot,index)=>({...slot,provider:args.models[index].provider.trim().toLowerCase(),modelVersion:args.models[index].modelVersion.trim()})),snapshot,interpretationRubric,registeredAt:now,status:'registered_pending_models' as const,experimentMode:'retrospective_interpretation' as const,evidencePolicy:'Both participants receive the exact same immutable eligible source snapshot',registrationLimit:'Registration records model identities and pending slots; no provider call or model result has been produced'};
  validateAmazonInterpretationManifest(manifest);
  const manifestJson=canonical(manifest);if(new TextEncoder().encode(manifestJson).byteLength>850000)throw new Error('Interpretation snapshot exceeds the pilot size limit');
  const id=await ctx.db.insert('earningsInterpretationExperiments',{owner:user.tokenIdentifier,caseId:row._id,eventId:row.eventId,name:args.name,cutoff:args.cutoff,experimentMode:'retrospective_interpretation',manifestJson,registeredAt:now,version:AMAZON_CASH_VERSION});
  await ctx.db.insert('audit',{owner:user.tokenIdentifier,action:'earnings.interpretation.experiment.registered',recordId:id,detail:'Immutable retrospective economic interpretation; two pending models and rules baseline; no market forecast or trading authority',at:now});
  return id;
}});

/** Trusted runner ingestion only. Results retain failed attempts and cannot grant research or trade approval. */
export const appendInterpretationResult=internalMutation({args:{owner:v.string(),experimentId:v.id('earningsInterpretationExperiments'),externalId:v.string(),resultJson:v.string()},handler:async(ctx,args)=>{
  if(!args.owner.trim()||args.owner.length>1000||!args.externalId.trim()||args.externalId.length>240||new TextEncoder().encode(args.resultJson).byteLength>200000)throw new Error('Bounded owner, attempt identifier and result are required');
  const experiment=await ctx.db.get(args.experimentId);if(!experiment||experiment.owner!==args.owner)throw new Error('Record unavailable');
  const manifest=JSON.parse(experiment.manifestJson),result=validateAmazonInterpretationResult(JSON.parse(args.resultJson),manifest),now=Date.now();
  if(result.startedAt<experiment.registeredAt||result.completedAt>now)throw new Error('Result run predates registration or is future-dated');
  const resultJson=canonical(result),prior=await ctx.db.query('earningsInterpretationResults').withIndex('by_external',q=>q.eq('owner',args.owner).eq('experimentId',args.experimentId).eq('externalId',args.externalId)).first();
  if(prior){if(prior.resultJson!==resultJson)throw new Error('Immutable interpretation attempt conflicts; append a new attempt identifier');return prior._id;}
  const previous=await ctx.db.query('earningsInterpretationResults').withIndex('by_experiment',q=>q.eq('owner',args.owner).eq('experimentId',args.experimentId)).take(100);
  if(previous.length>=100||previous.reduce((total,row)=>total+new TextEncoder().encode(row.resultJson).byteLength,0)+new TextEncoder().encode(resultJson).byteLength>800000)throw new Error('Interpretation attempt history exceeds the pilot storage limit');
  const id=await ctx.db.insert('earningsInterpretationResults',{owner:args.owner,experimentId:args.experimentId,externalId:args.externalId,resultJson,ingestedAt:now,version:AMAZON_INTERPRETATION_VERSION});
  await ctx.db.insert('audit',{owner:args.owner,action:'earnings.interpretation.result.imported',recordId:id,detail:`${result.slot}; ${result.status}; immutable runner attempt; no execution authority`,at:now});
  return id;
}});
