import {afterEach,describe,expect,it,vi} from 'vitest';
import {grantReviewers} from './helpers/roles';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';
import {RECOVERY_VERSION,RECOVERY_CRITERIA,parseRecoveryCase,type RecoveryCase} from '../lib/market-recovery';

const modules={'./_generated/server.ts':async()=>({}),'./recovery.ts':()=>import('../convex/recovery'),'./research.ts':()=>import('../convex/research')};
const mutation=(name:string)=>makeFunctionReference<'mutation'>(`recovery:${name}`),query=(name:string)=>makeFunctionReference<'query'>(`recovery:${name}`);
const owner='test|alice',day=86400000,now=Date.parse('2026-11-03T12:00:00Z'),anchorAt=Date.parse('2026-11-02T21:00:00Z'),url='https://example.test/recovery';
function fixture():RecoveryCase{
  const sessions:number[]=[];for(let at=anchorAt;sessions.length<25;at-=day){if(![0,6].includes(new Date(at).getUTCDay()))sessions.unshift(at);}for(let at=anchorAt+day;sessions.length<90;at+=day){if(![0,6].includes(new Date(at).getUTCDay()))sessions.push(at);}
  const publishedAt=sessions[0]-2000,receivedAt=publishedAt+1000,sourceIds=['source'],mode='synthetic';
  const instruments=[['COMP','index','USD'],['NDX','index','USD'],['SOX','index','USD'],['QQQ','etf','USD'],['NVDA','equity','USD'],['MSFT','equity','USD'],['AAPL','equity','USD'],['WORLD','etf','GBP'],['CASH','cash','GBP']].map(([id,product,currency])=>({id,name:`Synthetic ${id}`,symbol:id,product,currency,sourceIds,sourceUrl:url,globalDiversificationVerified:id==='WORLD',leverageFactor:1,researchApproved:true,publishedAt,receivedAt,mode}));
  const prices=instruments.filter(i=>i.product!=='cash').flatMap(i=>(i.product==='index'?sessions.slice(0,25):[anchorAt]).map((eventAt,index)=>({id:`${i.id}-${eventAt}`,instrumentId:i.id,provider:'Synthetic licensed market history',sourceIds,sourceUrl:url,eventAt,publishedAt:eventAt,receivedAt:eventAt+1000,currency:i.currency,close:i.product==='index'?100*Math.pow(1.005,index):100,priceBasis:i.product==='index'?'index-level':'total-return',adjustmentVersion:'synthetic-v1',session:'regular',corporateActionsReviewed:true,licensed:true,permittedUse:'Synthetic unit tests only',usage:'licensed',mode,supersedes:null})));
  const indicators=sessions.slice(0,25).flatMap(measurementAt=>[['vix',20,'index_points'],['treasury_10y',4,'percent'],['credit_spread',300,'basis_points']].map(([metric,value,unit])=>({id:`${metric}-${measurementAt}`,metric,seriesId:`synthetic-${metric}`,populationDefinition:`Consistent synthetic ${metric} series`,value,unit,measurementAt,publishedAt:measurementAt,receivedAt:measurementAt+1000,sourceIds,mode})));
  const common={initialCapitalGbp:500,cashInstrumentId:'CASH',entryFeePerLegGbp:0,exitFeePerLegGbp:0,spreadBps:0,slippageBps:0,fxFeeBps:0,annualAdditionalFeeBps:0,cashAnnualRate:0,costAssumptionsNote:'Explicit zero-cost synthetic calculation, not real dealing costs',mode};
  const basket=['NVDA','MSFT','AAPL'].map(instrumentId=>({instrumentId,weight:1/3}));
  return parseRecoveryCase({version:RECOVERY_VERSION,id:'recovery-test-006',name:'Synthetic recovery Case 006',mode,anchorAt,sources:[{id:'source',title:'Synthetic authoritative market fixture',url,kind:'licensed_provider',publishedAt,publicationDate:null,publicationBasis:'exact',receivedAt,verified:true,usage:'licensed',permittedUse:'Synthetic unit tests only',mode,role:'evidence'}],instruments,calendar:{id:'synthetic-calendar',sourceUrl:url,verified:true,publishedAt,receivedAt,session:'regular',sessionCloses:sessions,mode},prices,fx:[{id:'fx-entry',provider:'Synthetic licensed FX',sourceUrl:url,licensed:true,permittedUse:'Synthetic unit tests only',from:'USD',to:'GBP',eventAt:anchorAt,publishedAt:anchorAt,receivedAt:anchorAt+1000,rate:.8,conversionVersion:'synthetic-fx-v1',mode,supersedes:null}],breadth:[{id:'breadth-entry',populationInstrumentId:'COMP',populationDefinition:'Complete synthetic population of thirty companies',eventAt:anchorAt,publishedAt:anchorAt,receivedAt:anchorAt+1000,advancing:24,declining:6,unchanged:0,eligiblePopulation:30,coverageComplete:true,licensed:true,sourceIds,mode}],sectorParticipation:[{id:'sectors-entry',populationDefinition:'Complete synthetic ten-sector population',eventAt:anchorAt,publishedAt:anchorAt,receivedAt:anchorAt+1000,positiveSectors:8,totalSectors:10,coverageComplete:true,licensed:true,sourceIds,mode}],indicators,electionHeadlines:[],contextRecords:[],analystConsensusSnapshot:null,plans:[{...common,id:'immediate',name:'Immediate equal basket',kind:'immediate',basket,schedule:[{offsetSessions:0,fraction:1}]},{...common,id:'staged',name:'One budget, three stages',kind:'staged',basket,schedule:[0,5,20].map(offsetSessions=>({offsetSessions,fraction:1/3}))},{...common,id:'diversified',name:'Global ETF and cash',kind:'diversified',basket:[{instrumentId:'WORLD',weight:.5},{instrumentId:'CASH',weight:.5}],schedule:[{offsetSessions:0,fraction:1}]}]});
}
async function setup(){vi.useFakeTimers();vi.setSystemTime(now);const t=convexTest(schema,modules);await grantReviewers(t,[owner,'test|bob']);return {t,alice:t.withIdentity({tokenIdentifier:owner,subject:'alice',actorType:'human'}),bob:t.withIdentity({tokenIdentifier:'test|bob',subject:'bob',actorType:'human'})};}
async function imported(t:ReturnType<typeof convexTest>,data=fixture(),externalId='case-v1'){const caseId=await t.mutation(mutation('importCase'),{owner,externalId,caseJson:JSON.stringify(data)});vi.setSystemTime(Date.now()+1000);return caseId;}
const registration=(caseId:string,patch:Record<string,unknown>={})=>({caseId,name:'Retrospective recovery registration',cutoff:Date.now(),anchorAt,benchmarkInstrumentId:'QQQ',priceBasis:'total-return',adjustmentVersion:'synthetic-v1',...patch});
const review=(experimentId:string,patch:Record<string,unknown>={})=>({experimentId,decision:'approve',reason:'Reviewed the fixed criteria, staged capital and source limitations',acknowledgedRisks:['A research confirmation is not a validated profitable trading signal'],reviewBy:Date.now()+10*day,...patch});
function addDay(data:RecoveryCase,eventAt:number,vix=20){
  const sourceIds=['source'];data.anchorAt=eventAt;
  for(const i of data.instruments.filter(i=>i.product!=='cash')){const prior=data.prices.filter(p=>p.instrumentId===i.id).sort((a,b)=>b.eventAt-a.eventAt)[0];data.prices.push({...prior,id:`${i.id}-${eventAt}`,eventAt,publishedAt:eventAt,receivedAt:eventAt+1000,close:prior.close*(i.product==='index'?1.005:i.id==='WORLD'?1.005:1.01)});}
  data.fx.push({...data.fx[0],id:`fx-${eventAt}`,eventAt,publishedAt:eventAt,receivedAt:eventAt+1000});
  data.breadth.push({...data.breadth[0],id:`breadth-${eventAt}`,eventAt,publishedAt:eventAt,receivedAt:eventAt+1000});
  data.sectorParticipation.push({...data.sectorParticipation[0],id:`sectors-${eventAt}`,eventAt,publishedAt:eventAt,receivedAt:eventAt+1000});
  for(const [metric,value,unit] of [['vix',vix,'index_points'],['treasury_10y',4,'percent'],['credit_spread',300,'basis_points']] as const)data.indicators.push({id:`${metric}-${eventAt}`,metric,seriesId:`synthetic-${metric}`,populationDefinition:`Consistent synthetic ${metric} series`,value,unit,measurementAt:eventAt,publishedAt:eventAt,receivedAt:eventAt+1000,sourceIds,mode:data.mode});
  return parseRecoveryCase(data);
}
afterEach(()=>vi.useRealTimers());

describe('Recovery Case 006 private research controls',()=>{
  it('keeps imports and outcome evaluation internal with strict owner-scoped access',async()=>{
    const backend=await import('../convex/recovery');expect(backend.importCase.isInternal).toBe(true);expect(backend.evaluateOutcome.isInternal).toBe(true);
    const {t,alice,bob}=await setup(),caseId=await imported(t);await expect(t.query(query('list'),{})).rejects.toThrow('Sign in required');expect(await bob.query(query('list'),{})).toEqual([]);await expect(bob.query(query('detail'),{caseId})).rejects.toThrow('Record unavailable');await expect(bob.mutation(mutation('registerCase006'),registration(caseId))).rejects.toThrow('Record unavailable');expect(await alice.query(query('list'),{})).toHaveLength(1);
  });
  it('preserves source versions and rejects artificial historical receipt and future publication',async()=>{
    const {t,alice}=await setup(),data=fixture(),caseId=await imported(t,data);expect(await imported(t,data)).toBe(caseId);await expect(imported(t,{...data,name:'Edited source'})).rejects.toThrow('Immutable recovery source conflicts');
    await expect(alice.mutation(mutation('registerCase006'),registration(caseId,{cutoff:anchorAt+1000}))).rejects.toThrow('imported into this workspace after cutoff');
    const future=fixture();future.sources[0].receivedAt=Date.now()+day;await expect(imported(t,future,'future')).rejects.toThrow('Future receipt');
  });
  it('creates exactly three independent £500 experiments and twelve frozen windows',async()=>{
    const {t,alice}=await setup(),caseId=await imported(t),registrationId=await alice.mutation(mutation('registerCase006'),registration(caseId)),detail=await alice.query(query('detail'),{caseId}),row=detail.registrations[0];
    expect(row.registrationId).toBe(registrationId);expect(row.experimentMode).toBe('retrospective_research');expect(row.experiments).toHaveLength(3);expect(new Set(row.experiments.map((e:{experimentId:string})=>e.experimentId)).size).toBe(3);expect(row.registration.criteria).toEqual(RECOVERY_CRITERIA);
    for(const experiment of row.experiments){expect(experiment.plan.initialCapitalGbp).toBe(500);expect(experiment.windows.map((w:{horizonSessions:number})=>w.horizonSessions)).toEqual([1,5,20,60]);expect(experiment.windows.every((w:{anchorAt:number})=>w.anchorAt===anchorAt)).toBe(true);expect(experiment.outcomes).toEqual([]);}
    const staged=row.experiments.find((e:{strategy:string})=>e.strategy==='staged')!;expect(staged.plan.schedule.map((s:{offsetSessions:number})=>s.offsetSessions)).toEqual([0,5,20]);expect(staged.plan.schedule.reduce((n:number,s:{fraction:number})=>n+500*s.fraction,0)).toBeCloseTo(500);expect(row.registration.executionAuthority).toBe('none');
  });
  it('requires a verified human and preserves explicit superseding research reviews',async()=>{
    const {t,alice,bob}=await setup(),caseId=await imported(t);await alice.mutation(mutation('registerCase006'),registration(caseId));const detail=await alice.query(query('detail'),{caseId}),experimentId=detail.registrations[0].experiments[0].experimentId;
    await expect(t.withIdentity({tokenIdentifier:owner,subject:'model',actorType:'model'}).mutation(mutation('reviewExperiment'),review(experimentId))).rejects.toThrow('Model or automated actors cannot act as researchers or reviewers');await expect(bob.mutation(mutation('reviewExperiment'),review(experimentId))).rejects.toThrow('Record unavailable');
    const id=await alice.mutation(mutation('reviewExperiment'),review(experimentId));await expect(alice.mutation(mutation('reviewExperiment'),review(experimentId))).rejects.toThrow('explicitly superseded');await alice.mutation(mutation('reviewExperiment'),review(experimentId,{decision:'reject',reason:'Pause the research permission',supersedesId:id}));
    const reviewed=await alice.query(query('detail'),{caseId});expect(reviewed.registrations[0].experiments[0].reviews).toHaveLength(2);expect(reviewed.registrations[0].experiments[0].reviews[0].executionAuthority).toBe('none');
  });
  it('cannot waive missing critical confirmation evidence or undisclosed costs',async()=>{
    const {t,alice}=await setup(),data=fixture();data.breadth=[];const caseId=await imported(t,data);await alice.mutation(mutation('registerCase006'),registration(caseId));const detail=await alice.query(query('detail'),{caseId}),experimentId=detail.registrations[0].experiments[0].experimentId;
    await expect(alice.mutation(mutation('reviewExperiment'),review(experimentId,{reason:'Human requests an override'}))).rejects.toThrow('research gate blocked');await alice.mutation(mutation('reviewExperiment'),review(experimentId,{decision:'reject',reason:'Breadth evidence missing'}));
    const costs=fixture();costs.plans[0].spreadBps=null;const costId=await imported(t,costs,'unknown-cost');await alice.mutation(mutation('registerCase006'),registration(costId));const blocked=await alice.query(query('detail'),{caseId:costId});await expect(alice.mutation(mutation('reviewExperiment'),review(blocked.registrations[0].experiments[0].experimentId))).rejects.toThrow('assumptions');
  });
  it('leaves future windows pending and does not deploy later staged tranches early',async()=>{
    const {t,alice}=await setup(),caseId=await imported(t);await alice.mutation(mutation('registerCase006'),registration(caseId));const detail=await alice.query(query('detail'),{caseId}),staged=detail.registrations[0].experiments.find((e:{strategy:string})=>e.strategy==='staged')!;
    await t.mutation(mutation('evaluateOutcome'),{owner,experimentId:staged.experimentId,observationCaseId:caseId,horizonSessions:1,asOf:Date.now()});const pending=await alice.query(query('detail'),{caseId});expect(pending.registrations[0].experiments.find((e:{strategy:string})=>e.strategy==='staged')!.outcomes[0].report.status).toBe('pending');
    vi.setSystemTime(now+day);const data=fixture(),next=data.calendar!.sessionCloses[data.calendar!.sessionCloses.indexOf(anchorAt)+1],observations=addDay(data,next),observationCaseId=await imported(t,observations,'next-session');
    for(const experiment of detail.registrations[0].experiments)await t.mutation(mutation('evaluateOutcome'),{owner,experimentId:experiment.experimentId,observationCaseId,horizonSessions:1,asOf:Date.now()});
    const completed=await alice.query(query('detail'),{caseId}),plans=completed.registrations[0].experiments;
    const stageResult=plans.find((e:{strategy:string})=>e.strategy==='staged')!.outcomes[0].report;expect(stageResult.status).toBe('complete');expect(stageResult.result.initialCapitalGbp).toBe(500);expect(stageResult.result.entries).toHaveLength(1);expect(stageResult.result.entries[0].offsetSessions).toBe(0);expect(stageResult.result.entries[0].budgetGbp).toBeCloseTo(500/3);expect(stageResult.result.cashRemainingGbp).toBeCloseTo(1000/3);expect(stageResult.result.netReturn).toBeCloseTo(.01/3);
    const immediate=plans.find((e:{strategy:string})=>e.strategy==='immediate')!.outcomes[0].report;expect(immediate.result.netReturn).toBeCloseTo(.01);expect(immediate.anchorAt).toBe(stageResult.anchorAt);expect(immediate.endAt).toBe(stageResult.endAt);
  });
  it('retains completed invalidation checks and rejects human attempts to waive them',async()=>{
    const {t,alice}=await setup(),caseId=await imported(t);await alice.mutation(mutation('registerCase006'),registration(caseId));const detail=await alice.query(query('detail'),{caseId}),experimentId=detail.registrations[0].experiments[0].experimentId;
    vi.setSystemTime(now+day);const data=fixture(),next=data.calendar!.sessionCloses[data.calendar!.sessionCloses.indexOf(anchorAt)+1],invalid=addDay(data,next,36),invalidId=await imported(t,invalid,'invalidation');
    await t.mutation(mutation('evaluateOutcome'),{owner,experimentId,observationCaseId:invalidId,horizonSessions:1,asOf:Date.now()});const invalidated=await alice.query(query('detail'),{caseId});expect(invalidated.registrations[0].experiments[0].outcomes[0].report.riskGate.invalidationTriggered).toBe(true);
    await expect(alice.mutation(mutation('reviewExperiment'),review(experimentId,{reason:'Human wants to ignore the volatility invalidation'}))).rejects.toThrow(/cannot be waived|research gate blocked/);
    vi.setSystemTime(now+2*day);const later=invalid.calendar!.sessionCloses[invalid.calendar!.sessionCloses.indexOf(next)+1],recovered=addDay(invalid,later,20),recoveredId=await imported(t,recovered,'subsequent-recovery');
    await t.mutation(mutation('evaluateOutcome'),{owner,experimentId,observationCaseId:recoveredId,horizonSessions:1,asOf:Date.now()});const fresh=await alice.query(query('detail'),{caseId}),latest=fresh.registrations[0].experiments[0].outcomes[0].report;
    expect(latest.riskGate.passed).toBe(true);expect(latest.riskGate.invalidationTriggered).toBe(false);
    await expect(alice.mutation(mutation('reviewExperiment'),review(experimentId,{reason:'Latest data recovered; ignore the prior invalidation'}))).rejects.toThrow('recorded invalidation cannot be waived');
  });
  it('does not create ledger or brokerage records or lower the established minimum capital',async()=>{
    const {t,alice}=await setup(),caseId=await imported(t);await alice.mutation(mutation('registerCase006'),registration(caseId));const detail=await alice.query(query('detail'),{caseId});await alice.mutation(mutation('reviewExperiment'),review(detail.registrations[0].experiments[0].experimentId));
    await expect(alice.mutation(makeFunctionReference<'mutation'>('research:createPortfolio'),{name:'Attempted lower capital bypass',capitalGbp:500,synthetic:true})).rejects.toThrow('£5,000');
    await t.run(async ctx=>{for(const table of ['portfolios','proposals','fills','quotes','forecasts','brokerConnections'] as const)expect(await ctx.db.query(table).collect()).toEqual([]);});
  });
  it('cannot treat a headline or market-outcome source as historical confirmation evidence',async()=>{
    const {t,alice}=await setup();for(const role of ['headline','outcome'] as const){const data=fixture();data.sources[0].role=role;const caseId=await imported(t,data,`role-${role}`);await expect(alice.mutation(mutation('registerCase006'),registration(caseId))).rejects.toThrow('benchmark specification');}
  });
});
