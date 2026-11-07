import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import {afterEach,describe,expect,it,vi} from 'vitest';
import schema from '../convex/schema';
import {AMAZON_CASH_VERSION,type AmazonCashCase} from '../lib/amazon-cash-conversion';
import {AMAZON_INTERPRETATION_VERSION,canonicalAmazonEvidence,validateAmazonInterpretationManifest,type AmazonInterpretationManifest,type AmazonInterpretationResult} from '../lib/amazon-interpretation';

const modules={'./_generated/server.ts':async()=>({}),'./earnings.ts':()=>import('../convex/earnings')};
const mutation=(name:string)=>makeFunctionReference<'mutation'>(`earnings:${name}`);
const query=(name:string)=>makeFunctionReference<'query'>(`earnings:${name}`);
const owner='test|alice',url='https://ir.aboutamazon.com/test-q3-2026';
const publishedAt=Date.parse('2026-10-29T21:00:00Z'),receivedAt=Date.parse('2026-10-31T12:00:00Z'),now=Date.parse('2026-10-31T18:00:00Z');
const models=[{provider:'openai',modelVersion:'test-model-a-2026'},{provider:'anthropic',modelVersion:'test-model-b-2026'}];
function fixture():AmazonCashCase{return {version:AMAZON_CASH_VERSION,id:'amazon-cash-test',name:'Retrospective cash-conversion test',mode:'retrospective',sources:[{id:'official',title:'Official statement test fixture',url,kind:'company',publishedAt,publicationDate:'2026-10-29',receivedAt,verified:true}],observations:[{id:'sales-q3',metric:'revenue',scope:'company',period:{scope:'quarter',label:'2026-Q3',start:'2026-07-01',end:'2026-09-30'},value:201944,currency:'USD',unit:'million',basis:'amazon-reported-v1',kind:'reported',qualifier:'exact',sourceId:'official',receivedAt,supersedes:null},{id:'guidance-2026',metric:'cash_capex_guidance',scope:'company',period:{scope:'calendar_year',label:'2026',start:'2026-01-01',end:'2026-12-31'},value:220000,currency:'USD',unit:'million',basis:'amazon-reported-v1',kind:'guidance',qualifier:'approximately',sourceId:'official',receivedAt,supersedes:null},{id:'aws-expectation-2027',metric:'aws_growth_forecast',scope:'AWS',period:{scope:'calendar_year',label:'2027',start:'2027-01-01',end:'2027-12-31'},value:.4,currency:'USD',unit:'ratio',basis:'amazon-reported-v1',kind:'management_expectation',qualifier:'greater_than',sourceId:'official',receivedAt,supersedes:null}],bedrock:[],articleClaim:{description:'User-described unverified gross/net discrepancy',amountMillions:77300,sourceUrl:null,verified:false}};}
function setup(){vi.useFakeTimers();vi.setSystemTime(now);const t=convexTest(schema,modules);return {t,alice:t.withIdentity({tokenIdentifier:owner,subject:'alice'})};}
async function imported(t:ReturnType<typeof convexTest>,data=fixture(),externalId='amazon-v1'){
  const eventId=await t.mutation(mutation('importEvent'),{owner,eventKey:'AMZN_Q3_2026',ticker:'AMZN',period:'2026-Q3',releaseAt:publishedAt,sources:[{id:'official',title:'Official statement test fixture',url,publishedAt,receivedAt,verification:'verified',note:'Test fixture'}]});
  const caseId=await t.mutation(mutation('importInterpretationCase'),{owner,eventId,externalId,caseJson:JSON.stringify(data)});vi.setSystemTime(Date.now()+1000);return {caseId,eventId};
}
afterEach(()=>vi.useRealTimers());

async function registered(t:ReturnType<typeof convexTest>,alice:ReturnType<ReturnType<typeof convexTest>['withIdentity']>){
  const {caseId}=await imported(t),experimentId=await alice.mutation(mutation('registerInterpretationExperiment'),{caseId,name:'Registered interpretation',cutoff:Date.now(),models});
  const detail=await alice.query(query('interpretationCaseDetail'),{caseId}),manifest=validateAmazonInterpretationManifest(detail.experiments[0].manifest);
  vi.setSystemTime(Date.now()+1000);return {caseId,experimentId,manifest};
}
function result(manifest:AmazonInterpretationManifest,patch:Partial<AmazonInterpretationResult>={}):AmazonInterpretationResult{
  const participant=manifest.models.find(model=>model.slot==='model_a')!;
  return {version:AMAZON_INTERPRETATION_VERSION,caseId:manifest.caseId,quarter:manifest.quarter,cutoff:manifest.cutoff,slot:'model_a',provider:'openai',modelVersion:participant.modelVersion!,returnedModelVersion:participant.modelVersion!,evidenceJson:canonicalAmazonEvidence(manifest.evidence),status:'complete',payload:{economicInterpretation:'Operating growth and consolidated cash conversion require separate assessment.',supportingEvidenceIds:['sales-q3'],challengingEvidenceIds:['guidance-2026'],risks:['Cash guidance is not realised spending'],invalidation:['Subsequent compatible disclosures change the cash bridge'],researchAction:'further_research'},inputTokens:100,outputTokens:50,actualCost:null,costCurrency:null,latencyMs:10,startedAt:Date.now(),completedAt:Date.now(),errorCode:null,interpretationScore:null,marketForecastScore:null,executionAuthority:'none',...patch};
}
function append(t:ReturnType<typeof convexTest>,experimentId:string,record:AmazonInterpretationResult,externalId='attempt-1',recordOwner=owner){return t.mutation(mutation('appendInterpretationResult'),{owner:recordOwner,experimentId,externalId,resultJson:JSON.stringify(record)});}

describe('Amazon interpretation preserves the earnings persistence boundary',()=>{
  it('keeps authoritative ingestion internal and private cases owner scoped',async()=>{
    const backend=await import('../convex/earnings');expect(backend.importInterpretationCase.isInternal).toBe(true);
    const {t,alice}=setup(),{caseId}=await imported(t),bob=t.withIdentity({tokenIdentifier:'test|bob'});
    await expect(t.query(query('listInterpretationCases'),{})).rejects.toThrow('Sign in required');
    expect(await bob.query(query('listInterpretationCases'),{})).toEqual([]);
    await expect(bob.query(query('interpretationCaseDetail'),{caseId})).rejects.toThrow('Record unavailable');
    await expect(bob.mutation(mutation('registerInterpretationExperiment'),{caseId,name:'Attempt',cutoff:Date.now(),models})).rejects.toThrow('Record unavailable');
    expect(await alice.query(query('listInterpretationCases'),{})).toHaveLength(1);
  });
  it('allows exact retries and forbids edits to immutable source cases',async()=>{
    const {t}=setup(),data=fixture(),first=await imported(t,data);expect((await imported(t,data)).caseId).toBe(first.caseId);
    await expect(imported(t,{...data,name:'Edited case'})).rejects.toThrow('Immutable interpretation case conflicts');
  });
  it('requires source references in the owned AMZN earnings registry',async()=>{
    const {t}=setup(),data=fixture();data.sources[0].url='https://example.com/unregistered';
    await expect(imported(t,data)).rejects.toThrow('Every case source');
    const {eventId}=await imported(t);
    await expect(t.mutation(mutation('importInterpretationCase'),{owner:'test|bob',eventId,externalId:'wrong-owner',caseJson:JSON.stringify(fixture())})).rejects.toThrow('Owned Amazon');
  });
  it('cannot turn historical receipt metadata into a backdated experiment',async()=>{
    const {t,alice}=setup(),{caseId}=await imported(t);
    await expect(alice.mutation(mutation('registerInterpretationExperiment'),{caseId,name:'Backdated',cutoff:receivedAt,models})).rejects.toThrow('imported into this workspace after cutoff');
    await expect(alice.mutation(mutation('registerInterpretationExperiment'),{caseId,name:'Future',cutoff:Date.now()+86400000,models})).rejects.toThrow('nonfuture');
  });
  it('blocks future receipts, unverifiable evidence and false model independence',async()=>{
    const {t,alice}=setup(),future=fixture();future.sources[0].receivedAt=Date.now()+86400000;future.observations.forEach(o=>o.receivedAt=Date.now()+86400000);
    await expect(imported(t,future,'future')).rejects.toThrow('Future receipt');
    const unverified=fixture();unverified.sources[0].verified=false;const {caseId}=await imported(t,unverified,'unverified');
    await expect(alice.mutation(mutation('registerInterpretationExperiment'),{caseId,name:'No evidence',cutoff:Date.now(),models})).rejects.toThrow('No eligible financial evidence');
    const good=await imported(t,fixture(),'good');
    await expect(alice.mutation(mutation('registerInterpretationExperiment'),{caseId:good.caseId,name:'Same provider',cutoff:Date.now(),models:[models[0],{...models[1],provider:' OPENAI '}]})).rejects.toThrow('distinct declared providers');
    await expect(alice.mutation(mutation('registerInterpretationExperiment'),{caseId:good.caseId,name:'Placeholder',cutoff:Date.now(),models:[models[0],{...models[1],modelVersion:'pending'}]})).rejects.toThrow('exact model versions');
  });
  it('freezes a retrospective comparison with two pending models and no invented results or orders',async()=>{
    const {t,alice}=setup(),{caseId}=await imported(t);
    const experimentId=await alice.mutation(mutation('registerInterpretationExperiment'),{caseId,name:'Cash conversion interpretation',cutoff:Date.now(),models});
    const detail=await alice.query(query('interpretationCaseDetail'),{caseId}),manifest=detail.experiments[0].manifest;
    expect(detail.experiments[0].experimentId).toBe(experimentId);expect(manifest.experimentMode).toBe('retrospective_interpretation');
    expect(manifest.evidence).toEqual(manifest.snapshot.case);expect(manifest.models).toHaveLength(2);
    expect(manifest.models.map((m:{provider:string})=>m.provider)).toEqual(['openai','anthropic']);
    for(const model of manifest.models){expect(model.status).toBe('pending');expect(model.result).toBeNull();expect(model.cost).toBeNull();expect(model.latencyMs).toBeNull();}
    expect(manifest.baseline.status).toBe('complete');expect(manifest.baseline.marketForecast).toBeNull();expect(manifest.marketForecastScore).toBeNull();expect(manifest.executionAuthority).toBe('none');
    expect(manifest.evidence.observations.find((o:{id:string})=>o.id==='guidance-2026').kind).toBe('guidance');expect(manifest.evidence.observations.find((o:{id:string})=>o.id==='aws-expectation-2027').kind).toBe('management_expectation');
    await t.run(async ctx=>{for(const table of ['forecasts','earningsMetrics','proposals','fills','quotes','brokerConnections'] as const)expect(await ctx.db.query(table).collect()).toEqual([]);});
  });
  it('keeps result ingestion internal, owner scoped and append only',async()=>{
    const backend=await import('../convex/earnings');expect(backend.appendInterpretationResult.isInternal).toBe(true);
    const {t,alice}=setup(),{caseId,experimentId,manifest}=await registered(t,alice),record=result(manifest);
    await expect(append(t,experimentId,record,'wrong-owner','test|bob')).rejects.toThrow('Record unavailable');
    const id=await append(t,experimentId,record);expect(await append(t,experimentId,record)).toBe(id);
    await expect(append(t,experimentId,{...record,inputTokens:101})).rejects.toThrow('Immutable interpretation attempt conflicts');
    const details=await alice.query(query('interpretationCaseDetail'),{caseId});expect(details.experiments[0].results).toHaveLength(1);expect(details.experiments[0].results[0].resultId).toBe(id);
    await expect(t.withIdentity({tokenIdentifier:'test|bob'}).query(query('interpretationCaseDetail'),{caseId})).rejects.toThrow('Record unavailable');
  });
  it('rejects another snapshot, a wrong participant and citations outside frozen evidence',async()=>{
    const {t,alice}=setup(),{experimentId,manifest}=await registered(t,alice),record=result(manifest);
    await expect(append(t,experimentId,{...record,evidenceJson:record.evidenceJson+' '},'wrong-evidence')).rejects.toThrow('exact same canonical eligible evidence');
    await expect(append(t,experimentId,{...record,provider:'anthropic'},'wrong-provider')).rejects.toThrow('exact model registration');
    await expect(append(t,experimentId,{...record,modelVersion:'different-model',returnedModelVersion:'different-model'},'wrong-model')).rejects.toThrow('exact model registration');
    await expect(append(t,experimentId,{...record,payload:{...record.payload!,supportingEvidenceIds:['later-article']}},'late-citation')).rejects.toThrow('eligible frozen evidence IDs');
  });
  it('cannot backdate result runs, claim future completions or insert model-generated scores',async()=>{
    const {t,alice}=setup(),{experimentId,manifest}=await registered(t,alice),record=result(manifest);
    await expect(append(t,experimentId,{...record,startedAt:manifest.registeredAt!-1},'before-registration')).rejects.toThrow(/predates|timestamps/);
    await expect(append(t,experimentId,{...record,completedAt:Date.now()+86400000},'future-result')).rejects.toThrow('future-dated');
    await expect(t.mutation(mutation('appendInterpretationResult'),{owner,experimentId,externalId:'self-score',resultJson:JSON.stringify({...record,interpretationScore:.99})})).rejects.toThrow();
    await expect(t.mutation(mutation('appendInterpretationResult'),{owner,experimentId,externalId:'authority',resultJson:JSON.stringify({...record,executionAuthority:'paper-approved'})})).rejects.toThrow();
  });
  it('retains failed attempts and independent complete results without changing frozen evidence or ledger state',async()=>{
    const {t,alice}=setup(),{caseId,experimentId,manifest}=await registered(t,alice),record=result(manifest),second=manifest.models.find(model=>model.slot==='model_b')!;
    const failure={...record,status:'failed' as const,payload:null,inputTokens:null,outputTokens:null,returnedModelVersion:null,errorCode:'configuration_missing' as const};
    await append(t,experimentId,failure,'openai-failure');await append(t,experimentId,record,'openai-complete');
    await append(t,experimentId,{...record,slot:'model_b',provider:'anthropic',modelVersion:second.modelVersion!,returnedModelVersion:second.modelVersion!},'anthropic-complete');
    const details=await alice.query(query('interpretationCaseDetail'),{caseId}),experiment=details.experiments[0];expect(experiment.results).toHaveLength(3);
    expect(experiment.results.filter((r:{result:AmazonInterpretationResult})=>r.result.status==='failed')).toHaveLength(1);
    expect(experiment.results.filter((r:{result:AmazonInterpretationResult})=>r.result.status==='complete')).toHaveLength(2);
    expect(experiment.results.every((r:{result:AmazonInterpretationResult})=>r.result.evidenceJson===canonicalAmazonEvidence(manifest.evidence)&&r.result.actualCost===null)).toBe(true);
    expect(experiment.manifest.models.every((m:{status:string})=>m.status==='pending')).toBe(true);expect(experiment.manifest.evidence).toEqual(manifest.evidence);
    expect(experiment.results.every((r:{ingestedAt:number})=>r.ingestedAt>=manifest.registeredAt!)).toBe(true);
    await t.run(async ctx=>{for(const table of ['forecasts','proposals','fills','quotes','brokerConnections'] as const)expect(await ctx.db.query(table).collect()).toEqual([]);});
  });
});
