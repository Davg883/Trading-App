import {afterEach,describe,expect,it,vi} from 'vitest';
import {grantReviewers} from './helpers/roles';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';
import {DEFENCE_VERSION,type DefenceCase,type DefenceInstrument} from '../lib/portfolio-defence';

const modules={'./_generated/server.ts':async()=>({}),'./defence.ts':()=>import('../convex/defence')};
const mutation=(name:string)=>makeFunctionReference<'mutation'>(`defence:${name}`);
const query=(name:string)=>makeFunctionReference<'query'>(`defence:${name}`);
const owner='test|alice';
function fixture():DefenceCase{const now=Date.now();return {version:DEFENCE_VERSION,id:'defence-pilot',name:'Synthetic capital preservation research',mode:'synthetic',sources:[{id:'fixture-source',title:'Synthetic test data',url:'https://example.test/synthetic',publishedAt:now-2000,receivedAt:now-1000,mode:'synthetic',verified:true,role:'evidence'}],instruments:[{id:'cash',name:'Synthetic GBP reserve',symbol:'DEMO-CASH',isin:null,currency:'GBP',company:'Demo institution',sector:'Cash',country:'GB',aiLayer:'Outside AI',aiRelated:false,product:'cash',paperEligible:true,availability:'Synthetic test only',structure:'Fully funded cash reserve',annualFeeBps:0,sourceIds:['fixture-source'],restrictions:['No execution permission'],risks:['Inflation and institution risk'],protectsAgainst:['Equity loss on cash allocation'],cannotProtectAgainst:['Inflation'],lossConditions:['Purchasing power declines']}],funds:[],portfolios:[{id:'reserve',name:'Synthetic cash comparison',initialCapital:10000,currency:'GBP',horizonSessions:20,priceBasis:'total-return',calendarId:'synthetic-calendar',session:'regular',mode:'synthetic',allocations:[{instrumentId:'cash',weight:1}],costs:{fees:0,slippage:0,financing:0}}],scenarios:[],histories:[]};}
async function setup(){const t=convexTest(schema,modules),alice=t.withIdentity({subject:'alice',tokenIdentifier:owner,actorType:'human'});await grantReviewers(t,[owner,'test|bob']);return {t,alice};}
async function imported(t:ReturnType<typeof convexTest>,data=fixture(),externalId='case-v1'){return t.mutation(mutation('importCase'),{owner,externalId,caseJson:JSON.stringify(data)});}
const review=(snapshotId:string,patch:Record<string,unknown>={})=>({snapshotId,portfolioId:'reserve',decision:'approve',reason:'Reviewed the fully funded capital reserve and remaining risks',acknowledgedRisks:['Cash does not protect purchasing power'],reviewBy:Date.now()+86400000,...patch});
afterEach(()=>vi.useRealTimers());

describe('portfolio defence evidence and human review storage',()=>{
  it('keeps ingestion internal and scopes reads, snapshots and reviews to the authenticated owner',async()=>{
    const backend=await import('../convex/defence');expect(backend.importCase.isInternal).toBe(true);
    const {t,alice}=await setup(),bob=t.withIdentity({subject:'bob',tokenIdentifier:'test|bob',actorType:'human'}),caseId=await imported(t);
    await expect(t.query(query('list'),{})).rejects.toThrow('Sign in required');expect(await bob.query(query('list'),{})).toEqual([]);
    await expect(bob.query(query('detail'),{caseId})).rejects.toThrow('Record unavailable');
    await expect(bob.mutation(mutation('freezeSnapshot'),{caseId,cutoff:Date.now()})).rejects.toThrow('Record unavailable');
    const snapshotId=await alice.mutation(mutation('freezeSnapshot'),{caseId,cutoff:Date.now()});
    await expect(bob.mutation(mutation('reviewAllocation'),review(snapshotId))).rejects.toThrow('Record unavailable');
    expect((await alice.query(query('list'),{}))[0].externalId).toBe('case-v1');
  });
  it('accepts identical import retries while rejecting edits to the immutable case',async()=>{
    const {t}=await setup(),data=fixture(),caseId=await imported(t,data);expect(await imported(t,data)).toBe(caseId);
    await expect(imported(t,{...data,name:'Changed case'})).rejects.toThrow('Immutable defence import conflicts');
    await t.run(async ctx=>{expect(await ctx.db.query('defenceCases').collect()).toHaveLength(1);});
  });
  it('cannot import future evidence or substitute declared old receipt for workspace knowledge',async()=>{
    const {t,alice}=await setup(),future=fixture();future.sources[0].receivedAt=Date.now()+1000;
    await expect(imported(t,future,'future')).rejects.toThrow('Future publication or receipt');
    const caseId=await imported(t);
    await expect(alice.mutation(mutation('freezeSnapshot'),{caseId,cutoff:Date.now()-500})).rejects.toThrow('imported into this workspace after cutoff');
    await expect(alice.mutation(mutation('freezeSnapshot'),{caseId,cutoff:Date.now()+1000})).rejects.toThrow('nonfuture cutoff');
  });
  it('excludes market outcomes and retains frozen snapshots after later case versions',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-31T12:00:00Z'));
    const {t,alice}=await setup(),data=fixture();data.sources.push({...data.sources[0],id:'later-outcome',role:'outcome'});
    const caseId=await imported(t,data),snapshotId=await alice.mutation(mutation('freezeSnapshot'),{caseId,cutoff:Date.now()});
    const old=await alice.query(query('detail'),{caseId});expect(old.snapshots[0].snapshot.case.sources.map((source:{id:string})=>source.id)).not.toContain('later-outcome');
    expect(old.snapshots[0].snapshot.executionAuthority).toBe('none');
    vi.setSystemTime(Date.now()+5000);await imported(t,{...data,name:'Later retrospective revision'},'case-v2');
    const retained=await alice.query(query('detail'),{caseId});expect(retained.snapshots[0]._id).toBe(snapshotId);expect(retained.snapshots[0].snapshotJson).toBe(old.snapshots[0].snapshotJson);
  });
  it('requires a signed human claim rather than accepting an AI model or ordinary session as reviewer',async()=>{
    const {t,alice}=await setup(),caseId=await imported(t),snapshotId=await alice.mutation(mutation('freezeSnapshot'),{caseId,cutoff:Date.now()});
    const model=t.withIdentity({subject:'model',tokenIdentifier:owner,actorType:'model'}),ordinary=t.withIdentity({subject:'carol',tokenIdentifier:'test|carol'});
    await expect(model.mutation(mutation('reviewAllocation'),review(snapshotId))).rejects.toThrow('Model or automated actors cannot act as researchers or reviewers');
    await expect(ordinary.mutation(mutation('reviewAllocation'),review(snapshotId))).rejects.toThrow('Reviewer role required');
    await t.run(async ctx=>{expect(await ctx.db.query('defenceAllocationReviews').collect()).toHaveLength(0);});
  });
  it('a human research approval never changes holdings, paper proposals, fills or broker records',async()=>{
    const {t,alice}=await setup(),caseId=await imported(t),snapshotId=await alice.mutation(mutation('freezeSnapshot'),{caseId,cutoff:Date.now()});
    await alice.mutation(mutation('reviewAllocation'),review(snapshotId));
    const detail=await alice.query(query('detail'),{caseId});expect(detail.snapshots[0].reviews[0].state).toBe('reviewed');expect(detail.snapshots[0].reviews[0].executionAuthority).toBe('none');
    expect(detail.snapshots[0].reviews[0].selection.riskRequirement).toContain('independent risk engine');
    await t.run(async ctx=>{for(const table of ['portfolios','proposals','fills','brokerConnections','brokerSnapshots'] as const)expect(await ctx.db.query(table).collect()).toHaveLength(0);});
  });
  it.each(['protective_put','collar','inverse'] as const)('keeps %s research-only despite human approval attempts',async product=>{
    const {t,alice}=await setup(),data=fixture();data.instruments[0]={...data.instruments[0],product,paperEligible:false} as DefenceInstrument;
    const caseId=await imported(t,data),snapshotId=await alice.mutation(mutation('freezeSnapshot'),{caseId,cutoff:Date.now()});
    await expect(alice.mutation(mutation('reviewAllocation'),review(snapshotId))).rejects.toThrow('Research-only or unavailable instruments');
    await alice.mutation(mutation('reviewAllocation'),review(snapshotId,{decision:'reject',reason:'Research-only instruments cannot be allocated'}));
    expect((await alice.query(query('detail'),{caseId})).snapshots[0].reviews[0].state).toBe('rejected');
  });
  it('missing authoritative specifications cannot be overridden by a human review',async()=>{
    const {t,alice}=await setup(),data=fixture();data.sources[0].verified=false;
    const caseId=await imported(t,data),snapshotId=await alice.mutation(mutation('freezeSnapshot'),{caseId,cutoff:Date.now()});
    await expect(alice.mutation(mutation('reviewAllocation'),review(snapshotId))).rejects.toThrow('Portfolio is absent from this frozen evidence');
    const detail=await alice.query(query('detail'),{caseId});expect(detail.snapshots[0].snapshot.excluded.some((row:{id:string})=>row.id==='reserve')).toBe(true);
  });
  it('requires a reason, acknowledged risks, a valid portfolio and a future review date',async()=>{
    const {t,alice}=await setup(),caseId=await imported(t),snapshotId=await alice.mutation(mutation('freezeSnapshot'),{caseId,cutoff:Date.now()});
    await expect(alice.mutation(mutation('reviewAllocation'),review(snapshotId,{reason:' '}))).rejects.toThrow('Human review reason');
    await expect(alice.mutation(mutation('reviewAllocation'),review(snapshotId,{acknowledgedRisks:[]}))).rejects.toThrow('acknowledged risks');
    await expect(alice.mutation(mutation('reviewAllocation'),review(snapshotId,{portfolioId:'other-case'}))).rejects.toThrow('Portfolio is absent');
    await expect(alice.mutation(mutation('reviewAllocation'),review(snapshotId,{reviewBy:Date.now()-1}))).rejects.toThrow('Future review date');
  });
  it('appends explicit superseding reviews without editing history and exposes expired approvals',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-31T12:00:00Z'));
    const {t,alice}=await setup(),caseId=await imported(t),snapshotId=await alice.mutation(mutation('freezeSnapshot'),{caseId,cutoff:Date.now()});
    const reviewId=await alice.mutation(mutation('reviewAllocation'),review(snapshotId,{reviewBy:Date.now()+1000}));
    await expect(alice.mutation(mutation('reviewAllocation'),review(snapshotId))).rejects.toThrow('explicitly superseded');
    vi.setSystemTime(Date.now()+1001);expect((await alice.query(query('detail'),{caseId})).snapshots[0].reviews[0].state).toBe('expired');
    await alice.mutation(mutation('reviewAllocation'),review(snapshotId,{decision:'reject',supersedesId:reviewId,reason:'Expiry requires reassessment'}));
    const rows=(await alice.query(query('detail'),{caseId})).snapshots[0].reviews;expect(rows).toHaveLength(2);expect(rows.find((row:{_id:string})=>row._id===reviewId).decision).toBe('approve');
    await expect(alice.mutation(mutation('reviewAllocation'),review(snapshotId,{supersedesId:reviewId}))).rejects.toThrow('latest decision');
  });
});
