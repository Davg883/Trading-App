import {v,type GenericId} from 'convex/values';
import type {GenericQueryCtx,GenericMutationCtx} from 'convex/server';
import {query,mutation,internalMutation,type DataModel,type TableName} from './server';
import {parseInfrastructureCase,freezeInfrastructureCase} from '../lib/infrastructure-financing';

const VERSION='infrastructure-001.2-v1';
type Context=GenericQueryCtx<DataModel>|GenericMutationCtx<DataModel>;
function canonical(value:unknown):string{if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value!==null&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;return JSON.stringify(value);}
async function identity(ctx:Context){const user=await ctx.auth.getUserIdentity();if(!user)throw new Error('Sign in required');return user.tokenIdentifier;}
async function owned<T extends TableName>(ctx:Context,id:GenericId<T>,owner:string){const row=await ctx.db.get(id);if(!row||row.owner!==owner)throw new Error('Record unavailable');return row;}
const inputLinks={linkedEvidenceIds:v.optional(v.array(v.id('evidence'))),linkedEarningsEventIds:v.optional(v.array(v.id('earningsEvents'))),linkedProofEvidenceIds:v.optional(v.array(v.id('proofEvidence')))};
function metadata(row:DataModel['infrastructureCases']['document']){return {caseId:row._id,externalId:row.externalId,name:row.name,mode:row.mode,version:row.version,ingestedAt:row.ingestedAt,linkedEvidenceIds:row.linkedEvidenceIds,linkedEarningsEventIds:row.linkedEarningsEventIds,linkedProofEvidenceIds:row.linkedProofEvidenceIds};}

/** Trusted ingestion only. A browser or model recommendation cannot promote an event. */
export const importCase=internalMutation({args:{owner:v.string(),externalId:v.string(),caseJson:v.string(),...inputLinks},handler:async(ctx,args)=>{
  const now=Date.now();if(!args.owner.trim()||args.owner.length>1000||!args.externalId.trim()||args.externalId.length>200||new TextEncoder().encode(args.caseJson).byteLength>800000)throw new Error('Import identity and bounded case payload required');
  const record=parseInfrastructureCase(JSON.parse(args.caseJson));
  for(const row of [...record.sources,...record.events,...record.relationships,...record.metrics]){
    if('receivedAt' in row&&typeof row.receivedAt==='number'&&row.receivedAt>now||'publishedAt' in row&&typeof row.publishedAt==='number'&&row.publishedAt>now)throw new Error('Future evidence cannot be imported as already received');
  }
  const linkedEvidenceIds=args.linkedEvidenceIds??[],linkedEarningsEventIds=args.linkedEarningsEventIds??[],linkedProofEvidenceIds=args.linkedProofEvidenceIds??[];
  if([linkedEvidenceIds,linkedEarningsEventIds,linkedProofEvidenceIds].some(ids=>ids.length>100||new Set<string>(ids).size!==ids.length))throw new Error('Registry links must be unique and bounded');
  const urls=new Set(record.sources.map(source=>source.url));
  for(const id of linkedEvidenceIds){const source=await owned(ctx,id,args.owner);if(!urls.has(source.source))throw new Error('Linked evidence source is absent from the infrastructure source registry');}
  for(const id of linkedEarningsEventIds){const event=await owned(ctx,id,args.owner);if(!event.sources.some(source=>urls.has(source.url)))throw new Error('Linked earnings event has no matching infrastructure source');}
  for(const id of linkedProofEvidenceIds){const source=await owned(ctx,id,args.owner);const parsed=JSON.parse(source.recordJson) as {sourceUrl?:string;mode?:string};if(!parsed.sourceUrl||!urls.has(parsed.sourceUrl)||parsed.mode!==record.mode)throw new Error('Linked integrity source or evidence mode differs');}
  const recordJson=canonical(record);
  const prior=await ctx.db.query('infrastructureCases').withIndex('by_external',q=>q.eq('owner',args.owner).eq('externalId',args.externalId)).first();
  if(prior){if(prior.recordJson!==recordJson||canonical(prior.linkedEvidenceIds)!==canonical(linkedEvidenceIds)||canonical(prior.linkedEarningsEventIds)!==canonical(linkedEarningsEventIds)||canonical(prior.linkedProofEvidenceIds)!==canonical(linkedProofEvidenceIds))throw new Error('Immutable infrastructure import conflicts; append a new case version');return prior._id;}
  const id=await ctx.db.insert('infrastructureCases',{owner:args.owner,externalId:args.externalId,name:record.name,mode:record.mode,version:VERSION,recordJson,ingestedAt:now,linkedEvidenceIds,linkedEarningsEventIds,linkedProofEvidenceIds});
  await ctx.db.insert('audit',{owner:args.owner,action:'infrastructure.case.imported',recordId:id,detail:`${VERSION}; ${record.mode}; event revisions and source claims retained`,at:now});return id;
}});

export const list=query({args:{},handler:async(ctx)=>{const owner=await identity(ctx);return (await ctx.db.query('infrastructureCases').withIndex('by_owner',q=>q.eq('owner',owner)).take(100)).map(metadata);}});
export const detail=query({args:{caseId:v.id('infrastructureCases')},handler:async(ctx,args)=>{const owner=await identity(ctx),row=await owned(ctx,args.caseId,owner);const snapshots=await ctx.db.query('infrastructureSnapshots').withIndex('by_case',q=>q.eq('owner',owner).eq('caseId',row._id)).take(100);return {metadata:metadata(row),case:parseInfrastructureCase(JSON.parse(row.recordJson)),snapshots:snapshots.map(s=>({...s,snapshot:JSON.parse(s.snapshotJson)}))};}});

/** Freeze only what this workspace actually possessed at the cutoff. No paper/broker operation is imported here. */
export const freezeSnapshot=mutation({args:{caseId:v.id('infrastructureCases'),cutoff:v.number()},handler:async(ctx,args)=>{
  const owner=await identity(ctx),row=await owned(ctx,args.caseId,owner),now=Date.now();if(!Number.isFinite(args.cutoff)||args.cutoff<0||args.cutoff>now)throw new Error('A finite nonfuture cutoff is required');
  if(row.ingestedAt>args.cutoff)throw new Error('Case was imported into this workspace after cutoff');
  const snapshot=freezeInfrastructureCase(parseInfrastructureCase(JSON.parse(row.recordJson)),args.cutoff);
  const snapshotJson=canonical(snapshot);if(new TextEncoder().encode(snapshotJson).byteLength>850000)throw new Error('Frozen evidence exceeds the pilot limit');
  const id=await ctx.db.insert('infrastructureSnapshots',{owner,caseId:row._id,cutoff:args.cutoff,snapshotJson,createdAt:now,version:VERSION});
  await ctx.db.insert('audit',{owner,action:'infrastructure.snapshot.frozen',recordId:id,detail:`${VERSION}; cutoff ${args.cutoff}; research only, no execution authority`,at:now});return id;
}});
