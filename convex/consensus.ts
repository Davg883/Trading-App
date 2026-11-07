import {reviewer} from './authz';
import {v,type GenericId} from 'convex/values';
import type {GenericQueryCtx,GenericMutationCtx} from 'convex/server';
import {query,mutation,internalMutation,type DataModel,type TableName} from './server';
import {CONSENSUS_VERSION,CONSENSUS_WINDOWS,parseConsensusCase,buildConsensusStudy,validateConsensusPortfolio,evaluateConsensusWindow,consensusPortfolioSchema,consensusWindowSchema,type ConsensusCase,type ConsensusPortfolio} from '../lib/analyst-consensus';

type Context=GenericQueryCtx<DataModel>|GenericMutationCtx<DataModel>;
function canonical(value:unknown):string{if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value!==null&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;return JSON.stringify(value);}
function required(value:string,label:string,maximum=4000){if(!value.trim()||value.length>maximum)throw new Error(`${label} is required and must fit the research limit`);}
function instant(value:number,label:string){if(!Number.isSafeInteger(value)||value<0||value>8.64e15)throw new Error(`${label} must be a valid timestamp`);}
function nonfuture(value:number,label:string,now:number){instant(value,label);if(value>now)throw new Error(`${label} cannot be in the future`);}
async function identity(ctx:Context){const user=await ctx.auth.getUserIdentity();if(!user)throw new Error('Sign in required');return user;}
/** Consequential decisions require an explicit, server-stored reviewer grant (see convex/authz.ts). */
async function human(ctx:Context){return await reviewer(ctx);}
async function owned<T extends TableName>(ctx:Context,id:GenericId<T>,owner:string){const row=await ctx.db.get(id);if(!row||row.owner!==owner)throw new Error('Record unavailable');return row;}
function assertReceived(value:unknown,now:number):void{if(Array.isArray(value)){value.forEach(item=>assertReceived(item,now));return;}if(value!==null&&typeof value==='object')for(const [key,item] of Object.entries(value)){if((key==='receivedAt'||key==='publishedAt'||key==='outcomeReceivedAt')&&typeof item==='number'&&item>now)throw new Error('Future receipt or publication cannot be imported as already known');assertReceived(item,now);}}
function metadata(row:DataModel['consensusCases']['document']){return {caseId:row._id,externalId:row.externalId,name:row.name,mode:row.mode,ingestedAt:row.ingestedAt,version:row.version};}
const horizon=v.union(v.literal(1),v.literal(5),v.literal(20),v.literal(60));
function recommendationReady(data:ConsensusCase,plan:ConsensusPortfolio,study:ReturnType<typeof buildConsensusStudy>){
  if([plan.entryCostsGbp,plan.exitCostsGbp,plan.annualFeesBps,plan.cashAnnualRate].some(value=>value===null))throw new Error('Unknown costs and cash assumptions block a favourable research recommendation');
  if(!data.calendar?.verified||!data.calendar.sessionCloses.includes(study.startAt))throw new Error('A verified registered entry session is required for a favourable research recommendation');
  if(!data.providers.length)throw new Error('Eligible licensed consensus evidence is required for a favourable research recommendation');
  const window=study.windows[0];
  for(const allocation of plan.allocations){const instrument=data.instruments.find(i=>i.id===allocation.instrumentId)!;if(instrument.product==='cash')continue;
    const prices=data.prices.filter(p=>p.instrumentId===instrument.id&&p.eventAt===study.startAt&&p.currency===instrument.currency&&p.priceBasis===window.priceBasis&&p.adjustmentVersion===window.adjustmentVersion&&p.corporateActionsReviewed&&p.licensed&&p.permittedUse!==null),superseded=new Set(prices.map(p=>p.supersedes).filter(Boolean));
    if(prices.filter(p=>!superseded.has(p.id)).length!==1)throw new Error('Exactly one eligible licensed entry price per allocated instrument is required');
    if(instrument.currency!=='GBP'){const fx=data.fx.filter(f=>f.from===instrument.currency&&f.eventAt===study.startAt&&f.licensed&&f.permittedUse!==null),replaced=new Set(fx.map(f=>f.supersedes).filter(Boolean));if(fx.filter(f=>!replaced.has(f.id)).length!==1)throw new Error('Explicit eligible entry FX is required for each foreign-currency allocation');}
  }
}

/** Source licence and verification assertions are accepted only from trusted ingestion. */
export const importCase=internalMutation({args:{owner:v.string(),externalId:v.string(),caseJson:v.string()},handler:async(ctx,args)=>{
  required(args.owner,'Owner',1000);required(args.externalId,'Case identifier',240);if(new TextEncoder().encode(args.caseJson).byteLength>800000)throw new Error('Consensus case exceeds the pilot size limit');
  const record=parseConsensusCase(JSON.parse(args.caseJson)),now=Date.now();assertReceived(record,now);const recordJson=canonical(record);
  const prior=await ctx.db.query('consensusCases').withIndex('by_external',q=>q.eq('owner',args.owner).eq('externalId',args.externalId)).first();
  if(prior){if(prior.recordJson!==recordJson)throw new Error('Immutable consensus case conflicts; append a new case version');return prior._id;}
  const id=await ctx.db.insert('consensusCases',{owner:args.owner,externalId:args.externalId,name:record.name,mode:record.mode,recordJson,ingestedAt:now,version:CONSENSUS_VERSION});
  await ctx.db.insert('audit',{owner:args.owner,action:'consensus.case.imported',recordId:id,detail:`${CONSENSUS_VERSION}; ${record.mode}; declared receipts and actual ingestion retained`,at:now});return id;
}});

export const list=query({args:{},handler:async(ctx)=>{const user=await identity(ctx);return (await ctx.db.query('consensusCases').withIndex('by_owner',q=>q.eq('owner',user.tokenIdentifier)).take(100)).map(metadata);}});

export const detail=query({args:{caseId:v.id('consensusCases')},handler:async(ctx,args)=>{
  const user=await identity(ctx),owner=user.tokenIdentifier,row=await owned(ctx,args.caseId,owner),now=Date.now();
  const studies=await ctx.db.query('consensusStudies').withIndex('by_case',q=>q.eq('owner',owner).eq('caseId',row._id)).take(100),registered=[];
  for(const study of studies){const plans=await ctx.db.query('consensusPortfolios').withIndex('by_study',q=>q.eq('owner',owner).eq('studyId',study._id)).take(100),portfolios=[];
    for(const plan of plans){const reviews=await ctx.db.query('consensusRecommendationReviews').withIndex('by_portfolio',q=>q.eq('owner',owner).eq('portfolioId',plan._id)).order('desc').take(100),outcomes=await ctx.db.query('consensusOutcomes').withIndex('by_portfolio',q=>q.eq('owner',owner).eq('portfolioId',plan._id)).order('desc').take(100);
      portfolios.push({portfolioId:plan._id,externalId:plan.externalId,createdAt:plan.createdAt,recordPurpose:plan.recordPurpose,plan:JSON.parse(plan.planJson),windows:JSON.parse(plan.windowsJson),reviews:reviews.map(review=>({...review,state:review.decision==='reject'?'rejected':review.reviewBy<=now?'expired':'reviewed'})),outcomes:outcomes.map(outcome=>({...outcome,report:JSON.parse(outcome.reportJson)}))});}
    registered.push({studyId:study._id,name:study.name,cutoff:study.cutoff,startAt:study.startAt,createdAt:study.createdAt,experimentMode:study.experimentMode,study:JSON.parse(study.studyJson),portfolios});}
  return {metadata:metadata(row),case:parseConsensusCase(JSON.parse(row.recordJson)),studies:registered,humanReviewer:user.actorType==='human',asOf:now,executionAuthority:'none' as const};
}});

/** The £500 comparisons are independent research plans, not entries in the existing paper ledger. */
export const registerResearchStudy=mutation({args:{caseId:v.id('consensusCases'),name:v.string(),cutoff:v.number(),startAt:v.number(),benchmarkInstrumentId:v.string(),priceBasis:v.union(v.literal('total-return'),v.literal('split-adjusted')),adjustmentVersion:v.string()},handler:async(ctx,args)=>{
  const user=await identity(ctx),owner=user.tokenIdentifier,row=await owned(ctx,args.caseId,owner),now=Date.now();required(args.name,'Study name',500);required(args.benchmarkInstrumentId,'Benchmark',240);required(args.adjustmentVersion,'Adjustment version',240);nonfuture(args.cutoff,'Evidence cutoff',now);instant(args.startAt,'Anchor');
  if(row.ingestedAt>args.cutoff)throw new Error('Case was imported into this workspace after cutoff');
  const record=parseConsensusCase(JSON.parse(row.recordJson));if(record.mode==='forward')throw new Error('Forward predictions require a separate advance registration protocol');
  const defaults=record.portfolios.filter(plan=>plan.planType==='ai_equal'||plan.planType==='diversified');if(defaults.length!==2||defaults.filter(plan=>plan.planType==='ai_equal').length!==1||defaults.filter(plan=>plan.planType==='diversified').length!==1)throw new Error('Register exactly one standard AI plan and one diversified ETF-and-cash plan');
  const study=buildConsensusStudy({...record,portfolios:defaults},{name:args.name,cutoff:args.cutoff,startAt:args.startAt,registeredAt:now,benchmarkInstrumentId:args.benchmarkInstrumentId,priceBasis:args.priceBasis,adjustmentVersion:args.adjustmentVersion});
  if(study.portfolios.length!==2)throw new Error('Both default research plans need eligible approved instruments at cutoff');
  const studyJson=canonical(study);if(new TextEncoder().encode(studyJson).byteLength>850000)throw new Error('Frozen consensus study exceeds the pilot size limit');
  const studyId=await ctx.db.insert('consensusStudies',{owner,caseId:row._id,name:args.name,cutoff:args.cutoff,startAt:args.startAt,studyJson,createdAt:now,experimentMode:'retrospective_research',version:CONSENSUS_VERSION});
  for(const plan of study.portfolios){await ctx.db.insert('consensusPortfolios',{owner,studyId,externalId:plan.id,name:plan.name,planJson:canonical(plan),windowsJson:canonical(study.windows.filter(window=>window.portfolioId===plan.id)),createdAt:now,recordPurpose:'research_plan',version:CONSENSUS_VERSION});}
  await ctx.db.insert('audit',{owner,action:'consensus.study.registered',recordId:studyId,detail:'Retrospective study; two independent £500 research plans; no paper-ledger or brokerage authority',at:now});return studyId;
}});

export const addCustomPortfolio=mutation({args:{studyId:v.id('consensusStudies'),portfolioJson:v.string()},handler:async(ctx,args)=>{
  const user=await identity(ctx),owner=user.tokenIdentifier,studyRow=await owned(ctx,args.studyId,owner);if(new TextEncoder().encode(args.portfolioJson).byteLength>60000)throw new Error('Research portfolio exceeds the pilot size limit');
  const study=JSON.parse(studyRow.studyJson) as ReturnType<typeof buildConsensusStudy>,plan=consensusPortfolioSchema.parse(JSON.parse(args.portfolioJson));
  if(plan.planType!=='custom')throw new Error('Additional allocations must be explicitly marked custom');
  validateConsensusPortfolio(plan,study.evidence);
  const plans=await ctx.db.query('consensusPortfolios').withIndex('by_study',q=>q.eq('owner',owner).eq('studyId',studyRow._id)).take(100);if(plans.length>=100)throw new Error('Research portfolio limit reached');
  const prior=plans.find(p=>p.externalId===plan.id),planJson=canonical(plan);if(prior){if(prior.planJson!==planJson)throw new Error('Immutable allocation conflicts; register a new research plan');return prior._id;}
  const now=Date.now(),windows=study.windows.filter(window=>window.portfolioId===study.portfolios[0].id).map(window=>consensusWindowSchema.parse({...window,id:`${plan.id}-${window.horizonSessions}`,portfolioId:plan.id,registeredAt:now,portfolioSnapshot:plan,instrumentSnapshots:study.evidence.instruments}));
  const id=await ctx.db.insert('consensusPortfolios',{owner,studyId:studyRow._id,externalId:plan.id,name:plan.name,planJson,windowsJson:canonical(windows),createdAt:now,recordPurpose:'research_plan',version:CONSENSUS_VERSION});
  await ctx.db.insert('audit',{owner,action:'consensus.portfolio.research_registered',recordId:id,detail:'Additional immutable fully funded £500 research plan; existing paper risk policy still required',at:now});return id;
}});

export const reviewRecommendation=mutation({args:{portfolioId:v.id('consensusPortfolios'),decision:v.union(v.literal('approve'),v.literal('reject')),reason:v.string(),acknowledgedRisks:v.array(v.string()),reviewBy:v.number(),supersedesId:v.optional(v.id('consensusRecommendationReviews'))},handler:async(ctx,args)=>{
  const user=await human(ctx),owner=user.tokenIdentifier,portfolio=await owned(ctx,args.portfolioId,owner),studyRow=await owned(ctx,portfolio.studyId,owner),now=Date.now();required(args.reason,'Human review reason');instant(args.reviewBy,'Revalidation date');if(args.reviewBy<=now)throw new Error('Future revalidation date required');
  if(!args.acknowledgedRisks.length||args.acknowledgedRisks.length>30||new Set(args.acknowledgedRisks).size!==args.acknowledgedRisks.length)throw new Error('Unique acknowledged risks are required');args.acknowledgedRisks.forEach(risk=>required(risk,'Acknowledged risk'));
  const study=JSON.parse(studyRow.studyJson) as ReturnType<typeof buildConsensusStudy>,plan=consensusPortfolioSchema.parse(JSON.parse(portfolio.planJson));validateConsensusPortfolio(plan,study.evidence);
  if(args.decision==='approve')recommendationReady(study.evidence,plan,study);
  const history=await ctx.db.query('consensusRecommendationReviews').withIndex('by_portfolio',q=>q.eq('owner',owner).eq('portfolioId',portfolio._id)).order('desc').take(100);if(history.length>=100)throw new Error('Review history exceeds the pilot limit');
  if(args.supersedesId){const previous=await owned(ctx,args.supersedesId,owner);if(previous.portfolioId!==portfolio._id||history[0]?._id!==previous._id)throw new Error('Review must explicitly supersede the latest decision for this exact research plan');}else if(history.length)throw new Error('The latest research review must be explicitly superseded');
  const selectionJson=canonical({plan,cutoff:studyRow.cutoff,studyId:studyRow._id,sourceMode:study.evidence.mode,executionAuthority:'none',riskRequirement:'The existing paper capital minimum, instrument allowlist, independent risk gate and authenticated paper-order approval remain required'});
  const id=await ctx.db.insert('consensusRecommendationReviews',{owner,studyId:studyRow._id,portfolioId:portfolio._id,decision:args.decision,reviewer:user.subject,reason:args.reason,acknowledgedRisks:args.acknowledgedRisks,reviewedAt:now,reviewBy:args.reviewBy,selectionJson,...(args.supersedesId?{supersedesId:args.supersedesId}:{}),executionAuthority:'none'});
  await ctx.db.insert('audit',{owner,action:'consensus.recommendation.human_reviewed',recordId:id,detail:`${args.decision}; research recommendation only; no order or ledger authority`,at:now});return id;
}});

/** Outcomes are independently recomputed from a trusted observed case; callers cannot insert scores. */
export const evaluateOutcome=internalMutation({args:{owner:v.string(),portfolioId:v.id('consensusPortfolios'),observationCaseId:v.id('consensusCases'),horizonSessions:horizon,asOf:v.number()},handler:async(ctx,args)=>{
  const portfolio=await owned(ctx,args.portfolioId,args.owner),studyRow=await owned(ctx,portfolio.studyId,args.owner),observation=await owned(ctx,args.observationCaseId,args.owner),now=Date.now();nonfuture(args.asOf,'Evaluation cutoff',now);if(observation.ingestedAt>args.asOf)throw new Error('Outcome observations entered this workspace after evaluation cutoff');
  const study=JSON.parse(studyRow.studyJson) as ReturnType<typeof buildConsensusStudy>,windows=JSON.parse(portfolio.windowsJson) as typeof study.windows,window=windows.find(w=>w.horizonSessions===args.horizonSessions);if(!window||!CONSENSUS_WINDOWS.includes(args.horizonSessions))throw new Error('Outcome window was not registered');
  const data=parseConsensusCase(JSON.parse(observation.recordJson)),plan=consensusPortfolioSchema.parse(JSON.parse(portfolio.planJson));if(data.mode!==study.evidence.mode)throw new Error('Synthetic, retrospective and forward outcomes cannot be combined');
  const report=evaluateConsensusWindow({...data,portfolios:[plan]},window,args.asOf),reportJson=canonical(report),prior=await ctx.db.query('consensusOutcomes').withIndex('by_portfolio',q=>q.eq('owner',args.owner).eq('portfolioId',portfolio._id)).take(100);
  const exact=prior.find(row=>row.observationCaseId===observation._id&&row.horizonSessions===args.horizonSessions&&row.asOf===args.asOf);if(exact){if(exact.reportJson!==reportJson)throw new Error('Immutable outcome evaluation conflicts');return exact._id;}if(prior.length>=100)throw new Error('Outcome history exceeds the pilot limit');
  const id=await ctx.db.insert('consensusOutcomes',{owner:args.owner,studyId:studyRow._id,portfolioId:portfolio._id,observationCaseId:observation._id,horizonSessions:args.horizonSessions,reportJson,asOf:args.asOf,evaluatedAt:now,version:CONSENSUS_VERSION});
  await ctx.db.insert('audit',{owner:args.owner,action:'consensus.outcome.evaluated',recordId:id,detail:`${args.horizonSessions} sessions; independently computed retrospective outcome; no execution authority`,at:now});return id;
}});
