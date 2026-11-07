import { convexTest } from 'convex-test';
import {grantReviewers} from './helpers/roles';
import { makeFunctionReference } from 'convex/server';
import { describe,it,expect,vi } from 'vitest';
import schema from '../convex/schema';
import { GATE_TYPES,type IntegrityEvidence,type ProofGate } from '../lib/proof-scale';

const modules={'./_generated/server.ts':async()=>({}),'./proofScale.ts':()=>import('../convex/proofScale')};
const mutation=(name:string)=>makeFunctionReference<'mutation'>(`proofScale:${name}`);
const query=(name:string)=>makeFunctionReference<'query'>(`proofScale:${name}`);
const owner='test|alice',day=86400000;
function evidence(patch:Partial<IntegrityEvidence>={}):IntegrityEvidence{const now=Date.now();return {id:'source-v1',sourceId:'metered-workflow',authoritativeSource:'Signed workload and invoice ledger',sourceUrl:'https://example.test/ledger',dataOwner:'Operations owner',lastVerifiedAt:now-500,permittedUses:['research'],reconciliation:'matched',exceptionPolicy:'Block critical exceptions; independent review required',revision:1,supersedes:null,publishedAt:now-2000,receivedAt:now-1000,mode:'forward',critical:true,content:'Measured workload and complete cost entries',...patch};}
function gate(type:typeof GATE_TYPES[number]):ProofGate{return {id:type,type,owner:'Named reviewer',state:'passed',evidenceIds:['source-v1'],thresholds:[{metric:'quality',operator:'gte',value:.9,unit:'ratio'}],measurements:[],evaluatedAt:null,revalidateAt:null,decisionBy:'forged-model',decisionActor:'model',audit:[]};}
async function setup(){const t=convexTest(schema,modules),alice=t.withIdentity({subject:'alice',tokenIdentifier:owner,actorType:'human'});await grantReviewers(t,[owner,'test|bob']);return {t,alice};}
async function pilotAndSource(){const {t,alice}=await setup();const pilotId=await alice.mutation(mutation('createPilot'),{name:'Forward workload pilot',domain:'vectis',mode:'forward',permittedUse:'research'});const source=evidence();const sourceId=await t.mutation(mutation('importEvidence'),{owner,pilotId,recordJson:JSON.stringify(source)});return {t,alice,pilotId,source,sourceId};}
async function readyPilot(){const fixture=await pilotAndSource();const gateIds=[];for(const type of GATE_TYPES){const gateId=await fixture.alice.mutation(mutation('defineGate'),{pilotId:fixture.pilotId,gateJson:JSON.stringify(gate(type))});gateIds.push(gateId);await fixture.t.mutation(mutation('recordMeasurement'),{owner,pilotId:fixture.pilotId,type,externalId:`measured-${type}`,record:{metric:'quality',value:.95,unit:'ratio',evidenceIds:['source-v1'],kind:'measured',observedAt:Date.now()-1000,receivedAt:Date.now()-500}});const result=await fixture.alice.mutation(mutation('reviewGate'),{pilotId:fixture.pilotId,gateId,decision:'pass',revalidateAt:Date.now()+day,reason:'Independent reviewer checked original evidence and measured thresholds'});expect(result.decision).toBe('pass');}return {...fixture,gateIds};}
function scope(){return {users:['pilot-user'],workflows:['one defined workflow'],sourceIds:['metered-workflow'],capexCeilingGbp:100,operatingBudgetGbp:50,nextReviewAt:Date.now()+day};}

describe('Proof & Scale authenticated evidence gates',()=>{
  it('requires a signed human claim; model and missing-claim identities cannot authorize or alter gates',async()=>{
    const {t,alice}=await setup();const args={name:'Pilot',domain:'investment' as const,mode:'historical' as const,permittedUse:'research'};
    await expect(t.mutation(mutation('createPilot'),args)).rejects.toThrow('Sign in required');
    const model=t.withIdentity({subject:'model',tokenIdentifier:owner,actorType:'model'}),untyped=t.withIdentity({subject:'carol',tokenIdentifier:'test|carol'});
    await expect(model.mutation(mutation('createPilot'),args)).rejects.toThrow('Model or automated actors cannot act as researchers or reviewers');
    const pilotId=await alice.mutation(mutation('createPilot'),args);
    await expect(model.mutation(mutation('defineGate'),{pilotId,gateJson:JSON.stringify(gate('business_value'))})).rejects.toThrow('Model or automated actors cannot act as researchers or reviewers');
    await expect(model.mutation(mutation('decideExpansion'),{pilotId,nextStage:'limited_pilot',scopeJson:JSON.stringify(scope()),decision:'approve',reason:'Model authorizes itself'})).rejects.toThrow('Model or automated actors cannot act as researchers or reviewers');
    await expect(untyped.mutation(mutation('decideExpansion'),{pilotId,nextStage:'limited_pilot',scopeJson:JSON.stringify(scope()),decision:'approve',reason:'Signed in without reviewer grant'})).rejects.toThrow('Reviewer role required');
    const list=await alice.query(query('list'),{});expect(list).toHaveLength(1);
  });
  it('isolates ownership and records immutable source revisions with actual application receipt',async()=>{
    const {t,alice,pilotId,source,sourceId}=await pilotAndSource();const bob=t.withIdentity({subject:'bob',tokenIdentifier:'test|bob',actorType:'human'});
    expect(await bob.query(query('list'),{})).toEqual([]);await expect(bob.query(query('detail'),{pilotId})).rejects.toThrow('Record unavailable');
    expect(await t.mutation(mutation('importEvidence'),{owner,pilotId,recordJson:JSON.stringify(source)})).toBe(sourceId);
    await expect(t.mutation(mutation('importEvidence'),{owner,pilotId,recordJson:JSON.stringify({...source,content:'Rewritten'})})).rejects.toThrow('Immutable integrity');
    const loaded=await alice.query(query('detail'),{pilotId});expect(loaded.evidence[0].receivedAt).toBeGreaterThan(source.receivedAt);
    await expect(t.mutation(mutation('importEvidence'),{owner,pilotId,recordJson:JSON.stringify({...source,id:'bad-next',revision:2,supersedes:null})})).rejects.toThrow('Revision history');
  });
  it('persists failed human pass attempts and model recommendations never create gate decisions',async()=>{
    const {t,alice,pilotId}=await pilotAndSource();const gateId=await alice.mutation(mutation('defineGate'),{pilotId,gateJson:JSON.stringify(gate('business_value'))});
    await t.mutation(mutation('recommendGate'),{owner,pilotId,type:'business_value',modelVersion:'independent-model-v1',recommendation:'Recommend pass',evidenceIds:['source-v1']});
    let loaded=await alice.query(query('detail'),{pilotId});expect(loaded.gates[0].gate.state).toBe('not_assessed');expect(loaded.gates[0].decisions).toHaveLength(0);
    const result=await alice.mutation(mutation('reviewGate'),{pilotId,gateId,decision:'pass',revalidateAt:Date.now()+day,reason:'Attempt with missing measured proof'});expect(result.decision).toBe('fail');expect(result.evaluation.blockers.join(' ')).toContain('measurement');
    loaded=await alice.query(query('detail'),{pilotId});expect(loaded.gates[0].decisions).toHaveLength(1);expect(loaded.gates[0].gate.state).toBe('failed');
  });
  it('approves only one scoped increment and records rejected checks and rollback actions',async()=>{
    const {t,alice,pilotId}=await readyPilot();
    const rejected=await alice.mutation(mutation('decideExpansion'),{pilotId,nextStage:'expanded_pilot',scopeJson:JSON.stringify(scope()),decision:'approve',reason:'Attempt to skip a stage'});expect(rejected.decision).toBe('reject');expect(rejected.evaluation.blockers).toContain('Only the next defined stage may be approved');
    const allowed=await alice.mutation(mutation('decideExpansion'),{pilotId,nextStage:'limited_pilot',scopeJson:JSON.stringify(scope()),decision:'approve',reason:'Approve exactly the named users, workflow, sources and ceilings'});expect(allowed.decision).toBe('approve');
    await alice.mutation(mutation('rollback'),{pilotId,toStage:'idea',reason:'Operator requested rollback',actions:['Disable pilot access','Retain evidence and review failed checks']});const loaded=await alice.query(query('detail'),{pilotId});expect(loaded.pilot.stage).toBe('idea');expect(loaded.expansions).toHaveLength(2);expect(loaded.rollbacks[0].actions).toHaveLength(2);
    const audits=await t.run(ctx=>ctx.db.query('audit').collect());expect(audits.some(a=>a.action==='proof.expansion.reject')).toBe(true);expect(audits.some(a=>a.action==='proof.rollback')).toBe(true);
  });
  it('expired gates block expansion',async()=>{
    const {alice,pilotId}=await readyPilot();const original=Date.now();vi.useFakeTimers();vi.setSystemTime(original+2*day);try{const result=await alice.mutation(mutation('decideExpansion'),{pilotId,nextStage:'limited_pilot',scopeJson:JSON.stringify(scope()),decision:'approve',reason:'Attempt after revalidation expired'});expect(result.decision).toBe('reject');expect(result.evaluation.blockers.join(' ')).toContain('expired');}finally{vi.useRealTimers();}
  });
  it('a revised contradictory source blocks expansion without rewriting earlier decision snapshots',async()=>{
    const {t,alice,pilotId,source}=await readyPilot();const prior=await alice.query(query('detail'),{pilotId}),snapshot=prior.gates[0].decisions[0].gateJson;
    await t.mutation(mutation('importEvidence'),{owner,pilotId,recordJson:JSON.stringify({...source,id:'source-v2',revision:2,supersedes:source.id,reconciliation:'contradictory',receivedAt:Date.now(),lastVerifiedAt:Date.now()})});
    const result=await alice.mutation(mutation('decideExpansion'),{pilotId,nextStage:'limited_pilot',scopeJson:JSON.stringify(scope()),decision:'approve',reason:'Attempt despite source correction'});expect(result.decision).toBe('reject');expect(result.evaluation.blockers.join(' ')).toContain('superseded');
    const after=await alice.query(query('detail'),{pilotId});expect(after.gates[0].decisions[0].gateJson).toBe(snapshot);
  });
  it('new measurements require re-review and cannot mutate a passed evidence snapshot',async()=>{
    const {t,alice,pilotId}=await readyPilot();const before=await alice.query(query('detail'),{pilotId});const frozen=JSON.stringify(before.gates[0].gate.measurements);
    await t.mutation(mutation('recordMeasurement'),{owner,pilotId,type:'business_value',externalId:'correction',record:{metric:'quality',value:.1,unit:'ratio',evidenceIds:['source-v1'],kind:'measured',observedAt:Date.now(),receivedAt:Date.now()}});
    const after=await alice.query(query('detail'),{pilotId});expect(JSON.stringify(after.gates[0].gate.measurements)).toBe(frozen);expect(after.gates[0].evaluation.state).toBe('failed');expect(after.gates[0].evaluation.blockers).toContain('New measurement requires human re-review');
    const expansion=await alice.mutation(mutation('decideExpansion'),{pilotId,nextStage:'limited_pilot',scopeJson:JSON.stringify(scope()),decision:'approve',reason:'Attempt with superseded measurement'});expect(expansion.decision).toBe('reject');
  });
  it('missing critical authoritative data prevents a human approval',async()=>{
    const {t,alice,pilotId}=await pilotAndSource();await t.mutation(mutation('importEvidence'),{owner,pilotId,recordJson:JSON.stringify(evidence({id:'missing-source',sourceId:'missing-critical',authoritativeSource:'',dataOwner:'',critical:true}))});
    const result=await alice.mutation(mutation('decideExpansion'),{pilotId,nextStage:'limited_pilot',scopeJson:JSON.stringify({...scope(),sourceIds:['missing-critical']}),decision:'approve',reason:'Attempt despite critical missing authority'});expect(result.decision).toBe('reject');expect(result.evaluation.blockers.join(' ')).toContain('authoritative source missing');
  });
  it('run economics are immutable, mode checked and retain nullable hardware readings',async()=>{
    const {t,alice,pilotId}=await pilotAndSource();const args={owner,pilotId,record:{id:'run-1',mode:'forward',provider:'recorded-provider',modelVersion:'version-1',inputTokens:100,outputTokens:10,inferenceCostGbp:null,latencyMs:200,quality:'not_evaluated',fallbackCalls:0,hardware:{energyKwh:null,depreciationGbp:null,utilisation:null,throughputPerSecond:null}},evidenceIds:['source-v1'],observedAt:Date.now()-500,receivedAt:Date.now()};
    const id=await t.mutation(mutation('recordRun'),args);expect(await t.mutation(mutation('recordRun'),args)).toBe(id);await expect(t.mutation(mutation('recordRun'),{...args,record:{...args.record,outputTokens:20}})).rejects.toThrow('Immutable run');await expect(t.mutation(mutation('recordRun'),{...args,record:{...args.record,id:'demo-mix',mode:'synthetic'}})).rejects.toThrow('Run mode');const loaded=await alice.query(query('detail'),{pilotId});expect(loaded.runs[0].record.hardware.energyKwh).toBeNull();
  });
  it('stores realised economics separately from forecast savings and freezes the source calculation',async()=>{
    const {t,alice,pilotId,source}=await pilotAndSource();const verified=(value:number)=>({value,status:'verified',evidenceIds:['source-v1']});
    const costs=Object.fromEntries(['inferenceGbp','labourGbp','dataGbp','energyGbp','hardwareDepreciationGbp','operationsGbp','correctionGbp','otherGbp'].map(key=>[key,verified(10)]));
    const input={mode:'forward',baselineWorkflowCostGbp:verified(200),attemptedTasks:verified(10),successfulTasks:verified(8),avoidedExpenditureGbp:{value:99999,status:'unverified',evidenceIds:['source-v1']},incrementalContributionGbp:verified(20),customerIncomeGbp:verified(350),costs};
    const args={owner,pilotId,externalId:'economics-1',recordJson:JSON.stringify(input),observedAt:Date.now()-100,receivedAt:Date.now()};
    const id=await t.mutation(mutation('recordEconomics'),args);expect(await t.mutation(mutation('recordEconomics'),args)).toBe(id);
    let loaded=await alice.query(query('detail'),{pilotId});expect(loaded.economics[0].calculation.avoidedExpenditureGbp).toBeNull();expect(loaded.economics[0].calculation.realisedProfitGbp).toBe(270);
    await expect(t.mutation(mutation('recordEconomics'),{...args,recordJson:JSON.stringify({...input,customerIncomeGbp:verified(1000)})})).rejects.toThrow('Immutable economics');
    await t.mutation(mutation('importEvidence'),{owner,pilotId,recordJson:JSON.stringify({...source,id:'source-v2',revision:2,supersedes:source.id,reconciliation:'contradictory',receivedAt:Date.now(),lastVerifiedAt:Date.now()})});
    loaded=await alice.query(query('detail'),{pilotId});expect(loaded.economics[0].calculation.realisedProfitGbp).toBe(270);expect(loaded.economics[0].currentCalculation.realisedProfitGbp).toBeNull();expect(JSON.parse(loaded.economics[0].evidenceJson)).toHaveLength(1);
  });
});
