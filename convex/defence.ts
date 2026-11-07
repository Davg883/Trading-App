import {reviewer} from './authz';
import {v,type GenericId} from 'convex/values';
import type {GenericQueryCtx,GenericMutationCtx} from 'convex/server';
import {query,mutation,internalMutation,type DataModel,type TableName} from './server';
import {defenceReviewDecision} from './defenceValidators';
import {parseDefenceCase,freezeDefenceCase} from '../lib/portfolio-defence';

const VERSION='defence-001.3-v1' as const;
type Context=GenericQueryCtx<DataModel>|GenericMutationCtx<DataModel>;
function canonical(value:unknown):string{if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value!==null&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;return JSON.stringify(value);}
async function identity(ctx:Context){const user=await ctx.auth.getUserIdentity();if(!user)throw new Error('Sign in required');return user;}
/** Consequential decisions require an explicit, server-stored reviewer grant (see convex/authz.ts). */
async function human(ctx:Context){return await reviewer(ctx);}
async function owned<T extends TableName>(ctx:Context,id:GenericId<T>,owner:string){const row=await ctx.db.get(id);if(!row||row.owner!==owner)throw new Error('Record unavailable');return row;}
function requiredText(value:string,label:string,max=4000){if(!value.trim()||value.length>max)throw new Error(`${label} is required and must fit the pilot limit`);}
function assertKnownReceipts(value:unknown,now:number):void{if(Array.isArray(value)){value.forEach(row=>assertKnownReceipts(row,now));return;}if(value!==null&&typeof value==='object'){for(const [key,item] of Object.entries(value)){if((key==='publishedAt'||key==='receivedAt')&&typeof item==='number'&&item>now)throw new Error('Future publication or receipt cannot be imported as already known');assertKnownReceipts(item,now);}}}
function metadata(row:DataModel['defenceCases']['document']){return {caseId:row._id,externalId:row.externalId,name:row.name,mode:row.mode,version:row.version,ingestedAt:row.ingestedAt};}
function reviewMetadata(row:DataModel['defenceAllocationReviews']['document'],now:number){return {...row,state:row.decision==='reject'?'rejected' as const:row.reviewBy<=now?'expired' as const:'reviewed' as const,selection:JSON.parse(row.selectionJson)};}

/** Trusted ingestion only. Declared receipt times never replace actual workspace possession. */
export const importCase=internalMutation({args:{owner:v.string(),externalId:v.string(),caseJson:v.string()},handler:async(ctx,args)=>{
  const now=Date.now();requiredText(args.owner,'Owner',1000);requiredText(args.externalId,'Import identifier',200);
  if(new TextEncoder().encode(args.caseJson).byteLength>800000)throw new Error('Case exceeds the pilot size limit');
  const record=parseDefenceCase(JSON.parse(args.caseJson));assertKnownReceipts(record,now);
  const recordJson=canonical(record),prior=await ctx.db.query('defenceCases').withIndex('by_external',q=>q.eq('owner',args.owner).eq('externalId',args.externalId)).first();
  if(prior){if(prior.recordJson!==recordJson)throw new Error('Immutable defence import conflicts; append a new case version');return prior._id;}
  const id=await ctx.db.insert('defenceCases',{owner:args.owner,externalId:args.externalId,name:record.name,mode:record.mode,version:VERSION,recordJson,ingestedAt:now});
  await ctx.db.insert('audit',{owner:args.owner,action:'defence.case.imported',recordId:id,detail:`${VERSION}; ${record.mode}; research only`,at:now});return id;
}});

export const list=query({args:{},handler:async ctx=>{const user=await identity(ctx);return (await ctx.db.query('defenceCases').withIndex('by_owner',q=>q.eq('owner',user.tokenIdentifier)).take(100)).map(metadata);}});
export const detail=query({args:{caseId:v.id('defenceCases')},handler:async(ctx,args)=>{
  const user=await identity(ctx),owner=user.tokenIdentifier,row=await owned(ctx,args.caseId,owner),now=Date.now();
  const snapshots=await ctx.db.query('defenceSnapshots').withIndex('by_case',q=>q.eq('owner',owner).eq('caseId',row._id)).take(100);
  const result=[];for(const snapshot of snapshots){const reviews=await ctx.db.query('defenceAllocationReviews').withIndex('by_snapshot',q=>q.eq('owner',owner).eq('snapshotId',snapshot._id)).take(100);result.push({...snapshot,snapshot:JSON.parse(snapshot.snapshotJson),reviews:reviews.map(review=>reviewMetadata(review,now))});}
  return {metadata:metadata(row),case:parseDefenceCase(JSON.parse(row.recordJson)),snapshots:result,humanReviewer:user.actorType==='human',asOf:now,executionAuthority:'none' as const};
}});

export const freezeSnapshot=mutation({args:{caseId:v.id('defenceCases'),cutoff:v.number()},handler:async(ctx,args)=>{
  const user=await identity(ctx),owner=user.tokenIdentifier,row=await owned(ctx,args.caseId,owner),now=Date.now();
  if(!Number.isFinite(args.cutoff)||args.cutoff<0||args.cutoff>now)throw new Error('A finite nonfuture cutoff is required');
  if(row.ingestedAt>args.cutoff)throw new Error('Case was imported into this workspace after cutoff');
  const snapshot=freezeDefenceCase(parseDefenceCase(JSON.parse(row.recordJson)),args.cutoff),snapshotJson=canonical(snapshot);
  if(new TextEncoder().encode(snapshotJson).byteLength>850000)throw new Error('Frozen evidence exceeds the pilot size limit');
  const id=await ctx.db.insert('defenceSnapshots',{owner,caseId:row._id,cutoff:args.cutoff,snapshotJson,createdAt:now,version:VERSION});
  await ctx.db.insert('audit',{owner,action:'defence.snapshot.frozen',recordId:id,detail:`${VERSION}; cutoff ${args.cutoff}; no execution authority`,at:now});return id;
}});

/** A human research review cannot change a portfolio, place an order, or waive the independent paper risk gate. */
export const reviewAllocation=mutation({args:{snapshotId:v.id('defenceSnapshots'),portfolioId:v.string(),decision:defenceReviewDecision,reason:v.string(),acknowledgedRisks:v.array(v.string()),reviewBy:v.number(),supersedesId:v.optional(v.id('defenceAllocationReviews'))},handler:async(ctx,args)=>{
  const user=await human(ctx),owner=user.tokenIdentifier,snapshot=await owned(ctx,args.snapshotId,owner),now=Date.now();
  requiredText(args.portfolioId,'Comparison portfolio',200);requiredText(args.reason,'Human review reason');
  if(!Number.isFinite(args.reviewBy)||args.reviewBy<=now)throw new Error('Future review date required');
  if(!args.acknowledgedRisks.length||args.acknowledgedRisks.length>30)throw new Error('A bounded set of acknowledged risks is required');
  for(const risk of args.acknowledgedRisks)requiredText(risk,'Acknowledged risk');
  if(new Set(args.acknowledgedRisks).size!==args.acknowledgedRisks.length)throw new Error('Acknowledged risks must be unique');
  const frozen=JSON.parse(snapshot.snapshotJson) as ReturnType<typeof freezeDefenceCase>,record=frozen.case;
  const portfolio=record.portfolios.find(p=>p.id===args.portfolioId);if(!portfolio)throw new Error('Portfolio is absent from this frozen evidence');
  const instruments=portfolio.allocations.map(allocation=>record.instruments.find(instrument=>instrument.id===allocation.instrumentId));
  if(args.decision==='approve'&&instruments.some(instrument=>!instrument||!instrument.paperEligible||['protective_put','collar','inverse'].includes(instrument.product)))throw new Error('Research-only or unavailable instruments cannot receive paper allocation approval');
  const history=await ctx.db.query('defenceAllocationReviews').withIndex('by_portfolio',q=>q.eq('owner',owner).eq('snapshotId',snapshot._id).eq('portfolioId',args.portfolioId)).order('desc').take(101);
  if(history.length>=100)throw new Error('Review history exceeds the pilot limit');
  if(args.supersedesId){const prior=await owned(ctx,args.supersedesId,owner);if(prior.snapshotId!==snapshot._id||prior.portfolioId!==args.portfolioId||history[0]?._id!==prior._id)throw new Error('Review must supersede the latest decision for this exact frozen portfolio');}
  else if(history.length)throw new Error('The latest review must be explicitly superseded');
  const selectionJson=canonical({portfolio,instruments:instruments.filter(instrument=>instrument!==undefined),missingInstrumentIds:portfolio.allocations.filter((_,index)=>!instruments[index]).map(allocation=>allocation.instrumentId),cutoff:snapshot.cutoff,executionAuthority:'none',riskRequirement:'Any paper allocation change still requires the established independent risk engine and authenticated human order approval'});
  const id=await ctx.db.insert('defenceAllocationReviews',{owner,caseId:snapshot.caseId,snapshotId:snapshot._id,portfolioId:args.portfolioId,decision:args.decision,reviewer:user.subject,reviewedAt:now,reviewBy:args.reviewBy,reason:args.reason,acknowledgedRisks:args.acknowledgedRisks,selectionJson,...(args.supersedesId?{supersedesId:args.supersedesId}:{}),executionAuthority:'none',version:VERSION});
  await ctx.db.insert('audit',{owner,action:'defence.allocation.reviewed',recordId:id,detail:`${args.decision}; human research review; paper risk controls still required; no execution authority`,at:now});return id;
}});
