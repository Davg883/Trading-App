import { signedIn } from './authz';
import { v } from 'convex/values';
import { query, mutation, internalMutation } from './server';
import { importMarketData, STRESS_VERSION } from '../lib/market-data';
import { evaluateOutcome, financialObservationSchema, outcomeRegistrationSchema, registerOutcome } from '../lib/stress';
import { z } from 'zod';

function canonical(value:unknown):string{if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value!==null&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;return JSON.stringify(value);}
// The browser cannot assert observed provenance. Import through a trusted worker after checking licensing and provider metadata.
export const importDataset=internalMutation({args:{owner:v.string(),externalId:v.string(),datasetJson:v.string(),financialsJson:v.string(),earningsEventIds:v.optional(v.array(v.id('earningsEvents')))},handler:async(ctx,args)=>{
  const now=Date.now();if(!args.owner.trim()||!args.externalId.trim()||args.datasetJson.length+args.financialsJson.length>800000)throw new Error('Import identity and pilot size limit required');
  const dataset=importMarketData(JSON.parse(args.datasetJson));const financials=z.array(financialObservationSchema).max(500).parse(JSON.parse(args.financialsJson));
  if(dataset.bars.some(b=>b.receivedAt>now)||financials.some(r=>r.receivedAt>now||r.synthetic!==dataset.synthetic))throw new Error('Future receipt or mixed synthetic provenance');
  if(new Set(financials.map(r=>r.id)).size!==financials.length)throw new Error('Financial observation IDs must be unique');
  const earningsEventIds=args.earningsEventIds??[];
  const registeredSources=new Set<string>();
  for(const id of earningsEventIds){const event=await ctx.db.get(id);if(!event||event.owner!==args.owner)throw new Error('Earnings source registry unavailable');for(const source of event.sources)registeredSources.add(source.url);}
  if(earningsEventIds.length&&financials.some(r=>r.kind==='reported'&&!registeredSources.has(r.sourceUrl)))throw new Error('Reported financial source must be in the linked earnings source registry');
  const datasetJson=canonical(dataset),financialsJson=canonical(financials);
  const previous=await ctx.db.query('stressImports').withIndex('by_external',q=>q.eq('owner',args.owner).eq('externalId',args.externalId)).first();
  if(previous){if(previous.datasetJson!==datasetJson||previous.financialsJson!==financialsJson||canonical(previous.earningsEventIds)!==canonical(earningsEventIds))throw new Error('Immutable import ID conflicts; append a new version');return previous._id;}
  return ctx.db.insert('stressImports',{owner:args.owner,externalId:args.externalId,datasetJson,financialsJson,earningsEventIds,ingestedAt:now,version:STRESS_VERSION});
}});
export const listImports=query({args:{},handler:async(ctx)=>{const user=await signedIn(ctx);const rows=await ctx.db.query('stressImports').withIndex('by_owner',q=>q.eq('owner',user.tokenIdentifier)).take(100);return rows.map(({_id,externalId,ingestedAt,version})=>({_id,externalId,ingestedAt,version}));}});
export const detail=query({args:{datasetId:v.id('stressImports')},handler:async(ctx,args)=>{
  const user=await signedIn(ctx);const record=await ctx.db.get(args.datasetId);if(!record||record.owner!==user.tokenIdentifier)throw new Error('Record unavailable');
  const outcomes=await ctx.db.query('stressOutcomes').withIndex('by_dataset',q=>q.eq('owner',user.tokenIdentifier).eq('datasetId',record._id)).take(100);
  const results=await Promise.all(outcomes.map(o=>ctx.db.query('stressResults').withIndex('by_outcome',q=>q.eq('owner',user.tokenIdentifier).eq('outcomeId',o._id)).first()));
  return {record,dataset:JSON.parse(record.datasetJson),financials:JSON.parse(record.financialsJson),outcomes:outcomes.map((o,i)=>({...o,registration:JSON.parse(o.registrationJson),result:results[i]?JSON.parse(results[i]!.resultJson):null}))};
}});
export const registerWindow=mutation({args:{datasetId:v.id('stressImports'),registrationJson:v.string()},handler:async(ctx,args)=>{
  const user=await signedIn(ctx);const dataset=await ctx.db.get(args.datasetId);if(!dataset||dataset.owner!==user.tokenIdentifier)throw new Error('Record unavailable');
  if(args.registrationJson.length>250000)throw new Error('Calendar exceeds pilot limit');
  const now=Date.now(),requested=outcomeRegistrationSchema.parse(JSON.parse(args.registrationJson));
  const registration=registerOutcome({...requested,registeredAt:now});
  if(registration.endAt!==requested.endAt||requested.registeredAt>now||registration.evidenceCutoff>now)throw new Error('Invalid outcome registration timestamp');
  const imported=importMarketData(JSON.parse(dataset.datasetJson));
  if(imported.synthetic!==registration.synthetic||imported.provider!==registration.provider||canonical(imported.calendar)!==canonical(registration.calendar))throw new Error('Outcome provenance must match imported data and calendar');
  if(registration.mode==='forward'&&dataset.ingestedAt>registration.evidenceCutoff)throw new Error('Forward evidence was imported after cutoff');
  const financials=z.array(financialObservationSchema).parse(JSON.parse(dataset.financialsJson));
  const evidenceJson=canonical({bars:imported.bars.filter(b=>b.eventAt<=registration.evidenceCutoff&&b.receivedAt<=registration.evidenceCutoff),financials:financials.filter(r=>r.publishedAt<=registration.evidenceCutoff&&r.receivedAt<=registration.evidenceCutoff)});
  return ctx.db.insert('stressOutcomes',{owner:user.tokenIdentifier,datasetId:dataset._id,registrationJson:canonical(registration),evidenceJson,createdAt:now,version:STRESS_VERSION});
}});
// Completed outcomes are append-only and cannot mutate the registered protocol, forecast or paper ledger.
export const recordOutcome=internalMutation({args:{owner:v.string(),outcomeId:v.id('stressOutcomes'),observationDatasetId:v.id('stressImports')},handler:async(ctx,args)=>{
  const outcome=await ctx.db.get(args.outcomeId),observations=await ctx.db.get(args.observationDatasetId);if(!outcome||!observations||outcome.owner!==args.owner||observations.owner!==args.owner)throw new Error('Record unavailable');
  const previous=await ctx.db.query('stressResults').withIndex('by_outcome',q=>q.eq('owner',args.owner).eq('outcomeId',args.outcomeId)).first();if(previous){if(previous.observationDatasetId!==args.observationDatasetId)throw new Error('Outcome already sealed');return previous._id;}
  const now=Date.now();const result=evaluateOutcome(outcomeRegistrationSchema.parse(JSON.parse(outcome.registrationJson)),importMarketData(JSON.parse(observations.datasetJson)).bars,now);
  if(result.status!=='completed')throw new Error(result.reason??'Outcome is pending');
  return ctx.db.insert('stressResults',{owner:args.owner,outcomeId:args.outcomeId,observationDatasetId:args.observationDatasetId,resultJson:canonical(result),evaluatedAt:now,version:STRESS_VERSION});
}});
