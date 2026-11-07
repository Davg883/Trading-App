import {afterEach,describe,expect,it,vi} from 'vitest';
import {grantReviewers} from './helpers/roles';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';
import {CONSENSUS_VERSION,parseConsensusCase,type ConsensusCase,type ConsensusPortfolio} from '../lib/analyst-consensus';

const modules={'./_generated/server.ts':async()=>({}),'./consensus.ts':()=>import('../convex/consensus'),'./research.ts':()=>import('../convex/research')};
const mutation=(name:string)=>makeFunctionReference<'mutation'>(`consensus:${name}`),query=(name:string)=>makeFunctionReference<'query'>(`consensus:${name}`);
const owner='test|alice',day=86400000,at=Date.parse('2026-11-03T12:00:00Z'),startAt=Date.parse('2026-11-02T21:00:00Z'),publishedAt=startAt-day,receivedAt=publishedAt+1000,url='https://example.test/consensus';
function fixture():ConsensusCase{
  const calendar:number[]=[];for(let t=startAt;calendar.length<70;t+=day){if(![0,6].includes(new Date(t).getUTCDay()))calendar.push(t);}
  const instruments=[['NVDA','equity','USD'],['MSFT','equity','USD'],['AAPL','equity','USD'],['WORLD','etf','GBP'],['CASH','cash','GBP']].map(([id,product,currency])=>({id,name:`Synthetic ${id}`,symbol:id,product,currency,sourceUrl:url,globalDiversificationVerified:product==='etf',leverageFactor:1,researchApproved:true,publishedAt,receivedAt,mode:'synthetic'}));
  const shared={initialCapitalGbp:500,entryCostsGbp:1,exitCostsGbp:1,annualFeesBps:0,cashAnnualRate:0,costAssumptionsNote:'Explicit synthetic all-in fees; no real dealing terms',mode:'synthetic'};
  return parseConsensusCase({version:CONSENSUS_VERSION,id:'synthetic-consensus',name:'Synthetic consensus research fixture',mode:'synthetic',providers:[{id:'licensed',name:'Synthetic licensed test provider',sourceUrl:url,licensed:true,permittedUse:'Synthetic tests only',mode:'synthetic',ratingScale:[{raw:'Buy',normalized:'positive'},{raw:'Hold',normalized:'neutral'}],coverage:{startAt:publishedAt-400*day,endAt:publishedAt,publishedAt,receivedAt,complete:true,symbols:['NVDA','MSFT','AAPL'],analystUniverse:'Three synthetic named analysts'}}],recommendations:['NVDA','MSFT','AAPL'].map(symbol=>({id:`rating-${symbol}`,providerId:'licensed',analyst:`Analyst ${symbol}`,institution:'Synthetic institution',symbol,rating:'Buy',previousRating:null,target:null,previousTarget:null,targetCurrency:null,publishedAt,updatedAt:publishedAt,receivedAt,sourceUrl:url,mode:'synthetic',supersedes:null})),headlines:[],webClaims:[],contextRecords:[],instruments,portfolios:[{...shared,id:'ai',name:'Equal AI equities',planType:'ai_equal',allocations:['NVDA','MSFT','AAPL'].map(instrumentId=>({instrumentId,weight:1/3}))},{...shared,id:'diversified',name:'Global ETF and cash',planType:'diversified',allocations:[{instrumentId:'WORLD',weight:.8},{instrumentId:'CASH',weight:.2}]}],calendar:{id:'calendar',sourceUrl:url,verified:true,publishedAt,receivedAt,session:'regular',sessionCloses:calendar,mode:'synthetic'},prices:instruments.filter(i=>i.product!=='cash').map(i=>({id:`entry-${i.id}`,instrumentId:i.id,provider:'Synthetic licensed prices',sourceUrl:url,licensed:true,permittedUse:'Synthetic tests only',eventAt:startAt,publishedAt:startAt,receivedAt:startAt+1000,currency:i.currency,close:100,priceBasis:'total-return',adjustmentVersion:'synthetic-v1',session:'regular',corporateActionsReviewed:true,mode:'synthetic',supersedes:null})),fx:[{id:'entry-usd-gbp',provider:'Synthetic licensed FX',sourceUrl:url,licensed:true,permittedUse:'Synthetic tests only',from:'USD',to:'GBP',eventAt:startAt,publishedAt:startAt,receivedAt:startAt+1000,rate:.8,conversionVersion:'synthetic-fx-v1',mode:'synthetic',supersedes:null}],ablations:[]});
}
async function setup(){vi.useFakeTimers();vi.setSystemTime(at);const t=convexTest(schema,modules);await grantReviewers(t,[owner,'test|bob']);return {t,alice:t.withIdentity({tokenIdentifier:owner,subject:'alice',actorType:'human'}),bob:t.withIdentity({tokenIdentifier:'test|bob',subject:'bob',actorType:'human'})};}
async function imported(t:ReturnType<typeof convexTest>,data=fixture(),externalId='case-v1'){const id=await t.mutation(mutation('importCase'),{owner,externalId,caseJson:JSON.stringify(data)});vi.setSystemTime(Date.now()+1000);return id;}
function registration(caseId:string,patch:Record<string,unknown>={}){return {caseId,name:'Retrospective matched research study',cutoff:Date.now(),startAt,benchmarkInstrumentId:'WORLD',priceBasis:'total-return',adjustmentVersion:'synthetic-v1',...patch};}
function custom(patch:Partial<ConsensusPortfolio>={}):ConsensusPortfolio{return {id:'custom-cash',name:'Additional explicit cash reserve',planType:'custom',initialCapitalGbp:500,allocations:[{instrumentId:'CASH',weight:1}],entryCostsGbp:0,exitCostsGbp:0,annualFeesBps:0,cashAnnualRate:0,costAssumptionsNote:'Explicit synthetic cash scenario',mode:'synthetic',...patch};}
function review(portfolioId:string,patch:Record<string,unknown>={}){return {portfolioId,decision:'approve',reason:'Reviewed the source limits, concentration and cost assumptions',acknowledgedRisks:['Retrospective analysis does not prove future signal value'],reviewBy:Date.now()+day,...patch};}
afterEach(()=>vi.useRealTimers());

describe('Consensus Validation 001 private research controls',()=>{
  it('keeps source and outcome ingestion internal with authenticated owner isolation',async()=>{
    const backend=await import('../convex/consensus');expect(backend.importCase.isInternal).toBe(true);expect(backend.evaluateOutcome.isInternal).toBe(true);
    const {t,alice,bob}=await setup(),caseId=await imported(t);await expect(t.query(query('list'),{})).rejects.toThrow('Sign in required');expect(await bob.query(query('list'),{})).toEqual([]);
    await expect(bob.query(query('detail'),{caseId})).rejects.toThrow('Record unavailable');await expect(bob.mutation(mutation('registerResearchStudy'),registration(caseId))).rejects.toThrow('Record unavailable');
    expect(await alice.query(query('list'),{})).toHaveLength(1);
  });
  it('preserves immutable retries and actual ingestion instead of backdating historical research',async()=>{
    const {t,alice}=await setup(),data=fixture(),caseId=await imported(t,data);expect(await imported(t,data)).toBe(caseId);
    await expect(imported(t,{...data,name:'Changed case'})).rejects.toThrow('Immutable consensus case conflicts');
    await expect(alice.mutation(mutation('registerResearchStudy'),registration(caseId,{cutoff:receivedAt}))).rejects.toThrow('imported into this workspace after cutoff');
    const future=fixture();future.prices[0].receivedAt=Date.now()+day;await expect(imported(t,future,'future')).rejects.toThrow('Future receipt');
  });
  it('creates exactly two separate £500 plans, eight immutable outcome windows and three ablation arms',async()=>{
    const {t,alice}=await setup(),caseId=await imported(t),studyId=await alice.mutation(mutation('registerResearchStudy'),registration(caseId)),detail=await alice.query(query('detail'),{caseId}),study=detail.studies[0];
    expect(study.studyId).toBe(studyId);expect(study.experimentMode).toBe('retrospective_research');expect(study.portfolios).toHaveLength(2);
    expect(new Set(study.portfolios.map((p:{portfolioId:string})=>p.portfolioId)).size).toBe(2);
    for(const p of study.portfolios){expect(p.plan.initialCapitalGbp).toBe(500);expect(p.recordPurpose).toBe('research_plan');expect(p.windows.map((w:{horizonSessions:number})=>w.horizonSessions)).toEqual([1,5,20,60]);expect(p.windows.every((w:{portfolioSnapshot:ConsensusPortfolio})=>w.portfolioSnapshot.initialCapitalGbp===500)).toBe(true);expect(p.outcomes).toEqual([]);}
    expect(study.study.arms).toHaveLength(3);expect(study.study.executionAuthority).toBe('none');
    await t.run(async ctx=>{expect(await ctx.db.query('portfolios').collect()).toEqual([]);expect(await ctx.db.query('fills').collect()).toEqual([]);});
  });
  it('supports append-only custom plans while rejecting leverage, unavailable instruments and altered capital',async()=>{
    const {t,alice,bob}=await setup(),caseId=await imported(t),studyId=await alice.mutation(mutation('registerResearchStudy'),registration(caseId)),plan=custom();
    await expect(bob.mutation(mutation('addCustomPortfolio'),{studyId,portfolioJson:JSON.stringify(plan)})).rejects.toThrow('Record unavailable');
    const portfolioId=await alice.mutation(mutation('addCustomPortfolio'),{studyId,portfolioJson:JSON.stringify(plan)});expect(await alice.mutation(mutation('addCustomPortfolio'),{studyId,portfolioJson:JSON.stringify(plan)})).toBe(portfolioId);
    const registered=await alice.query(query('detail'),{caseId}),added=registered.studies[0].portfolios.find((p:{portfolioId:string})=>p.portfolioId===portfolioId)!;expect(added.windows.every((w:{portfolioId:string;portfolioSnapshot:ConsensusPortfolio;registeredAt:number})=>w.portfolioId===plan.id&&w.portfolioSnapshot.id===plan.id&&w.registeredAt>=registered.studies[0].createdAt)).toBe(true);
    await expect(alice.mutation(mutation('addCustomPortfolio'),{studyId,portfolioJson:JSON.stringify({...plan,initialCapitalGbp:1000})})).rejects.toThrow();
    await expect(alice.mutation(mutation('addCustomPortfolio'),{studyId,portfolioJson:JSON.stringify({...plan,allocations:[{instrumentId:'CASH',weight:1.2}]})})).rejects.toThrow();
    await expect(alice.mutation(mutation('addCustomPortfolio'),{studyId,portfolioJson:JSON.stringify({...plan,id:'unavailable',allocations:[{instrumentId:'INVERSE',weight:1}]})})).rejects.toThrow('Portfolio instrument missing');
    await expect(alice.mutation(mutation('addCustomPortfolio'),{studyId,portfolioJson:JSON.stringify({...plan,name:'Changed allocation'})})).rejects.toThrow('Immutable allocation conflicts');
    const data=fixture();data.instruments[0].researchApproved=false;const limitedId=await imported(t,data,'limited'),limitedStudy=await alice.mutation(mutation('registerResearchStudy'),registration(limitedId)).catch(()=>null);expect(limitedStudy).toBeNull();
  });
  it('requires a signed human reviewer and explicit immutable superseding decisions',async()=>{
    const {t,alice,bob}=await setup(),caseId=await imported(t);await alice.mutation(mutation('registerResearchStudy'),registration(caseId));const detail=await alice.query(query('detail'),{caseId}),portfolioId=detail.studies[0].portfolios[0].portfolioId;
    const model=t.withIdentity({tokenIdentifier:owner,subject:'model',actorType:'model'});await expect(model.mutation(mutation('reviewRecommendation'),review(portfolioId))).rejects.toThrow('Model or automated actors cannot act as researchers or reviewers');await expect(bob.mutation(mutation('reviewRecommendation'),review(portfolioId))).rejects.toThrow('Record unavailable');
    const id=await alice.mutation(mutation('reviewRecommendation'),review(portfolioId));await expect(alice.mutation(mutation('reviewRecommendation'),review(portfolioId))).rejects.toThrow('explicitly superseded');
    await alice.mutation(mutation('reviewRecommendation'),review(portfolioId,{decision:'reject',reason:'Research uncertainty remains material',supersedesId:id}));
    const reviewed=await alice.query(query('detail'),{caseId});expect(reviewed.studies[0].portfolios[0].reviews).toHaveLength(2);expect(reviewed.studies[0].portfolios[0].reviews[0].executionAuthority).toBe('none');
  });
  it('blocks favourable recommendations with critical cost, price or licensed-source gaps',async()=>{
    const {t,alice}=await setup(),data=fixture();data.portfolios[0].entryCostsGbp=null;const caseId=await imported(t,data);await alice.mutation(mutation('registerResearchStudy'),registration(caseId));const detail=await alice.query(query('detail'),{caseId}),portfolioId=detail.studies[0].portfolios[0].portfolioId;
    await expect(alice.mutation(mutation('reviewRecommendation'),review(portfolioId))).rejects.toThrow('Unknown costs');
    await alice.mutation(mutation('reviewRecommendation'),review(portfolioId,{decision:'reject',reason:'Costs unavailable'}));
    const missing=fixture();missing.prices=missing.prices.filter(p=>p.instrumentId!=='NVDA');const otherId=await imported(t,missing,'missing-price');await alice.mutation(mutation('registerResearchStudy'),registration(otherId));const other=await alice.query(query('detail'),{caseId:otherId});await expect(alice.mutation(mutation('reviewRecommendation'),review(other.studies[0].portfolios[0].portfolioId))).rejects.toThrow('eligible licensed entry price');
    const unlicensed=fixture();unlicensed.providers[0].licensed=false;const noSourceId=await imported(t,unlicensed,'unlicensed-consensus');await alice.mutation(mutation('registerResearchStudy'),registration(noSourceId));const noSource=await alice.query(query('detail'),{caseId:noSourceId});await expect(alice.mutation(mutation('reviewRecommendation'),review(noSource.studies[0].portfolios[0].portfolioId))).rejects.toThrow('Eligible licensed consensus evidence');
  });
  it('keeps incomplete windows pending and recomputes completed outcomes from trusted observations',async()=>{
    const {t,alice}=await setup(),caseId=await imported(t);await alice.mutation(mutation('registerResearchStudy'),registration(caseId));const detail=await alice.query(query('detail'),{caseId}),portfolioId=detail.studies[0].portfolios[0].portfolioId;
    await t.mutation(mutation('evaluateOutcome'),{owner,portfolioId,observationCaseId:caseId,horizonSessions:1,asOf:Date.now()});const pending=await alice.query(query('detail'),{caseId});expect(pending.studies[0].portfolios[0].outcomes[0].report.status).toBe('pending');expect(pending.studies[0].portfolios[0].outcomes[0].report.result).toBeNull();
    vi.setSystemTime(at+day);const observations=fixture(),endAt=observations.calendar!.sessionCloses[1];observations.prices.push(...observations.prices.map(p=>({...p,id:`end-${p.instrumentId}`,eventAt:endAt,publishedAt:endAt,receivedAt:endAt+1000,close:110})));observations.fx.push({...observations.fx[0],id:'end-usd-gbp',eventAt:endAt,publishedAt:endAt,receivedAt:endAt+1000,rate:.8});
    const observationCaseId=await imported(t,observations,'outcomes-v1');const outcomeId=await t.mutation(mutation('evaluateOutcome'),{owner,portfolioId,observationCaseId,horizonSessions:1,asOf:Date.now()});
    const complete=await alice.query(query('detail'),{caseId}),report=complete.studies[0].portfolios[0].outcomes.find((r:{_id:string})=>r._id===outcomeId)!.report;expect(report.status).toBe('complete');expect(report.result.initialCapitalGbp).toBe(500);expect(report.result.grossReturn).toBeCloseTo(.1);expect(report.result.netReturn).toBeCloseTo(.0956);expect(report.executionAuthority).toBe('none');
    await expect(t.mutation(mutation('evaluateOutcome'),{owner:'test|bob',portfolioId,observationCaseId,horizonSessions:1,asOf:Date.now()})).rejects.toThrow('Record unavailable');
  });
  it('does not lower the old paper-ledger capital minimum or create orders after research approval',async()=>{
    const {t,alice}=await setup(),caseId=await imported(t);await alice.mutation(mutation('registerResearchStudy'),registration(caseId));const detail=await alice.query(query('detail'),{caseId});await alice.mutation(mutation('reviewRecommendation'),review(detail.studies[0].portfolios[0].portfolioId));
    await expect(alice.mutation(makeFunctionReference<'mutation'>('research:createPortfolio'),{name:'Attempted bypass',capitalGbp:500,synthetic:true})).rejects.toThrow('£5,000');
    await t.run(async ctx=>{for(const table of ['portfolios','proposals','fills','quotes','forecasts','brokerConnections'] as const)expect(await ctx.db.query(table).collect()).toEqual([]);});
  });
  it('cannot relabel imported data as a newly authorised forward study or mix outcome modes',async()=>{
    const {t,alice}=await setup(),forward=parseConsensusCase(JSON.parse(JSON.stringify(fixture()).replaceAll('"synthetic"','"forward"'))),forwardId=await imported(t,forward,'declared-forward');
    await expect(alice.mutation(mutation('registerResearchStudy'),registration(forwardId))).rejects.toThrow('separate advance registration');
    const caseId=await imported(t);await alice.mutation(mutation('registerResearchStudy'),registration(caseId));const detail=await alice.query(query('detail'),{caseId}),portfolioId=detail.studies[0].portfolios[0].portfolioId;
    await expect(t.mutation(mutation('evaluateOutcome'),{owner,portfolioId,observationCaseId:forwardId,horizonSessions:1,asOf:Date.now()})).rejects.toThrow('cannot be combined');
  });
});
