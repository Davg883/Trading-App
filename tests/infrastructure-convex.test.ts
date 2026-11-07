import {afterEach,describe,expect,it,vi} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';
import {INFRASTRUCTURE_VERSION,type InfrastructureCase,type InfrastructureSource,type FinancingEvent} from '../lib/infrastructure-financing';

const modules={'./_generated/server.ts':async()=>({}),'./infrastructure.ts':()=>import('../convex/infrastructure')};
const mutation=(name:string)=>makeFunctionReference<'mutation'>(`infrastructure:${name}`);
const query=(name:string)=>makeFunctionReference<'query'>(`infrastructure:${name}`);
const owner='test|alice';
function source(patch:Partial<InfrastructureSource>={}):InfrastructureSource{const now=Date.now();return {id:'report-1',title:'Reported financing discussion',url:'https://example.test/financing',kind:'news',publishedAt:now-2000,receivedAt:now-1000,verification:'corroborated',mode:'historical',role:'evidence',supports:[{eventId:'guarantee',status:'reported_discussion',binding:false}],...patch};}
function event(patch:Partial<FinancingEvent>={}):FinancingEvent{const now=Date.now();return {id:'guarantee-r1',eventId:'guarantee',revision:1,supersedes:null,issuer:'NVIDIA',borrower:'Nscale',guarantor:'NVIDIA',customer:'Anthropic',projectId:'monarch',type:'guarantee',principal:50,currency:'USD',maturityAt:null,status:'reported_discussion',claimType:'discussion',publishedAt:now-2000,receivedAt:now-1000,sourceIds:['report-1'],mode:'historical',economicGroupId:'potential-loan',...patch};}
function fixture():InfrastructureCase{return {version:INFRASTRUCTURE_VERSION,id:'reported-case',name:'Reported financing case',mode:'historical',sources:[source()],events:[event()],relationships:[],metrics:[]};}
function setup(){const t=convexTest(schema,modules),alice=t.withIdentity({subject:'alice',tokenIdentifier:owner});return {t,alice};}
afterEach(()=>vi.useRealTimers());

describe('infrastructure financing evidence storage',()=>{
  it('keeps ingestion internal and scopes all reads and snapshots to the authenticated owner',async()=>{
    const backend=await import('../convex/infrastructure');expect(backend.importCase.isInternal).toBe(true);
    const {t,alice}=setup(),bob=t.withIdentity({subject:'bob',tokenIdentifier:'test|bob'});
    const caseId=await t.mutation(mutation('importCase'),{owner,externalId:'case-v1',caseJson:JSON.stringify(fixture())});
    await expect(t.query(query('list'),{})).rejects.toThrow('Sign in required');expect(await bob.query(query('list'),{})).toEqual([]);
    await expect(bob.query(query('detail'),{caseId})).rejects.toThrow('Record unavailable');
    await expect(bob.mutation(mutation('freezeSnapshot'),{caseId,cutoff:Date.now()})).rejects.toThrow('Record unavailable');
    await expect(t.mutation(mutation('freezeSnapshot'),{caseId,cutoff:Date.now()})).rejects.toThrow('Sign in required');
    expect((await alice.query(query('list'),{}))[0].externalId).toBe('case-v1');
  });
  it('accepts exact retries and rejects changed case content or registry links',async()=>{
    const {t}=setup(),input={owner,externalId:'case-v1',caseJson:JSON.stringify(fixture())};
    const caseId=await t.mutation(mutation('importCase'),input);expect(await t.mutation(mutation('importCase'),input)).toBe(caseId);
    const changed=JSON.parse(input.caseJson);changed.name='Rewritten investigation';
    await expect(t.mutation(mutation('importCase'),{...input,caseJson:JSON.stringify(changed)})).rejects.toThrow('Immutable infrastructure import conflicts');
    await t.run(async ctx=>{expect(await ctx.db.query('infrastructureCases').collect()).toHaveLength(1);});
  });
  it('cannot promote a proposed guarantee using a signed claim from a news article',async()=>{
    const {t}=setup(),data=fixture();data.sources=[source({verification:'verified',supports:[{eventId:'guarantee',status:'signed',binding:true}]})];data.events=[event({status:'signed',claimType:'contingent'})];
    await expect(t.mutation(mutation('importCase'),{owner,externalId:'forged-signature',caseJson:JSON.stringify(data)})).rejects.toThrow('verified primary binding evidence');
    await t.run(async ctx=>{expect(await ctx.db.query('infrastructureCases').collect()).toHaveLength(0);expect(await ctx.db.query('audit').collect()).toHaveLength(0);});
  });
  it('rejects unsupported event revision chains and future evidence receipts',async()=>{
    const {t}=setup(),data=fixture();data.events=[event({id:'guarantee-r2',revision:2,supersedes:'missing-r1'})];
    await expect(t.mutation(mutation('importCase'),{owner,externalId:'broken-revision',caseJson:JSON.stringify(data)})).rejects.toThrow('complete history');
    const future=fixture();future.sources.push(source({id:'future-source',publishedAt:Date.now()+1000,receivedAt:Date.now()+2000,supports:[]}));
    await expect(t.mutation(mutation('importCase'),{owner,externalId:'future-receipt',caseJson:JSON.stringify(future)})).rejects.toThrow('Future evidence');
  });
  it('does not backdate workspace knowledge using an imported historical receipt',async()=>{
    const {t,alice}=setup(),caseId=await t.mutation(mutation('importCase'),{owner,externalId:'old-receipts',caseJson:JSON.stringify(fixture())});
    await expect(alice.mutation(mutation('freezeSnapshot'),{caseId,cutoff:Date.now()-500})).rejects.toThrow('imported into this workspace after cutoff');
    await expect(alice.mutation(mutation('freezeSnapshot'),{caseId,cutoff:Date.now()+1000})).rejects.toThrow('nonfuture cutoff');
  });
  it('freezes eligible evidence while excluding outcomes and retains the earlier snapshot after a new signed version',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-31T12:00:00Z'));
    const {t,alice}=setup(),data=fixture();data.sources.push(source({id:'market-outcome',role:'outcome',supports:[]}));
    const caseId=await t.mutation(mutation('importCase'),{owner,externalId:'case-v1',caseJson:JSON.stringify(data)});
    await alice.mutation(mutation('freezeSnapshot'),{caseId,cutoff:Date.now()});
    const old=await alice.query(query('detail'),{caseId});expect(old.snapshots[0].snapshot.case.sources.map((s:InfrastructureSource)=>s.id)).not.toContain('market-outcome');expect(old.snapshots[0].snapshot.excluded.some((r:{id:string})=>r.id==='market-outcome')).toBe(true);
    vi.setSystemTime(Date.now()+10000);
    const signedSource=source({id:'filing-signed',title:'Verified signed obligation filing',kind:'filing',verification:'verified',supports:[{eventId:'guarantee',status:'signed',binding:true}]});
    const signed=event({id:'guarantee-r2',revision:2,supersedes:'guarantee-r1',status:'signed',claimType:'contingent',sourceIds:[signedSource.id]});
    const next={...data,sources:[...data.sources,signedSource],events:[...data.events,signed]};
    await t.mutation(mutation('importCase'),{owner,externalId:'case-v2',caseJson:JSON.stringify(next)});
    const retained=await alice.query(query('detail'),{caseId});expect(retained.snapshots[0].snapshotJson).toBe(old.snapshots[0].snapshotJson);expect(retained.case.events[0].status).toBe('reported_discussion');
  });
  it('requires matching owned registry links without rewriting existing research evidence',async()=>{
    const {t}=setup();const ids=await t.run(async ctx=>{const row={source:'https://example.test/financing',symbol:'NVDA',metric:'funding-report',value:50,unit:'USD',period:'2026-Q4',definition:'Reported proposed guarantee',status:'estimated' as const,publishedAt:Date.now()-2000,receivedAt:Date.now()-1000};const aliceId=await ctx.db.insert('evidence',{...row,owner}),bobId=await ctx.db.insert('evidence',{...row,owner:'test|bob'});return {aliceId,bobId};});
    await expect(t.mutation(mutation('importCase'),{owner,externalId:'cross-owner',caseJson:JSON.stringify(fixture()),linkedEvidenceIds:[ids.bobId]})).rejects.toThrow('Record unavailable');
    await t.mutation(mutation('importCase'),{owner,externalId:'owned-link',caseJson:JSON.stringify(fixture()),linkedEvidenceIds:[ids.aliceId]});
    await t.run(async ctx=>{expect((await ctx.db.get(ids.aliceId))?.status).toBe('estimated');expect(await ctx.db.query('evidence').collect()).toHaveLength(2);});
  });
  it('a financing risk record and frozen snapshot cannot create paper or broker orders',async()=>{
    const {t,alice}=setup(),caseId=await t.mutation(mutation('importCase'),{owner,externalId:'risk-alert',caseJson:JSON.stringify(fixture())});await alice.mutation(mutation('freezeSnapshot'),{caseId,cutoff:Date.now()});
    await t.run(async ctx=>{expect(await ctx.db.query('proposals').collect()).toHaveLength(0);expect(await ctx.db.query('fills').collect()).toHaveLength(0);expect(await ctx.db.query('brokerConnections').collect()).toHaveLength(0);expect(await ctx.db.query('brokerSnapshots').collect()).toHaveLength(0);});
  });
});
