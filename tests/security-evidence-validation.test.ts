import {afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';
import {chatTurnAuditViolations} from '../lib/graph/chat-turn-audit-validation';
import {evidenceTurnFields} from './helpers/turn-fixture';

/**
 * Correction 4: strict inner evidence validation. The bundle, answer and validation JSON must parse against
 * their schemas, the bundle digest must be the canonical SHA-256 of its content, and every identity field of
 * the audit row must agree with the evidence it carries. Previously any JSON object was accepted.
 */
const ISS='https://issuer.test',A=`${ISS}|user_a`;
const Q='Which hyperscalers fund the Irish data-centre build-out?';
let base:Awaited<ReturnType<typeof evidenceTurnFields>>;
beforeAll(async()=>{base=await evidenceTurnFields(Q,A);});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
const telemetry={turnId:'chat-ev-1',modelId:'gemini-2.5-flash',generationMode:'deterministic_evidence_synthesis',providerStatus:'not_invoked',inputTokens:0,outputTokens:0,cachedTokens:0,estimatedCostGbp:0,actualCostGbp:0,latencyMs:3};
const rec=(o:Record<string,unknown>={})=>({...base,...telemetry,createdAtMs:Date.now(),...o});
const violations=(o:Record<string,unknown>={},owner=A)=>chatTurnAuditViolations(rec(o) as never,Date.now(),{owner});
// eslint-compatible: the callback edits a parsed copy of untyped JSON fixture data.
type Json={[k:string]:unknown}&{dataQualityWarnings:string[];supportingClaims:unknown[];relevantRelationshipIds:string[];bundleSha256:string;injected?:boolean;valid:boolean;actionTaken:string};
const mutate=(json:string,f:(x:Json)=>void)=>{const x=JSON.parse(json) as Json;f(x);return JSON.stringify(x);};

describe('Correction 4 — a consistent record passes',()=>{
 it('the real deterministic turn has no violations',()=>{expect(violations()).toEqual([]);});
});

describe('Correction 4 — malformed inner JSON is rejected',()=>{
 for(const [field,value] of [['bundleJson','{}'],['answerJson','{}'],['validationJson','{}'],['bundleJson','{"bundleId":"x"}'],['answerJson',JSON.stringify({shortAnswer:'x'})]] as const){
  it(`${field}=${value.slice(0,30)} is rejected`,()=>{expect(violations({[field]:value}).join(' ')).toMatch(new RegExp(field));});
 }
 it('extra fields in the bundle are rejected (strict schema)',()=>{
  expect(violations({bundleJson:mutate(base.bundleJson,b=>{b.injected=true;})}).join(' ')).toMatch(/bundleJson/);
 });
});

describe('Correction 4 — digest and identity consistency',()=>{
 it('a bundle whose content was altered no longer matches its canonical SHA-256',()=>{
  const tampered=mutate(base.bundleJson,b=>{b.dataQualityWarnings=[...b.dataQualityWarnings,'tampered'];});
  expect(violations({bundleJson:tampered}).join(' ')).toMatch(/canonical SHA-256/);
 });
 it('a row digest or bundle id that differs from the bundle is rejected',()=>{
  expect(violations({bundleSha256:'f'.repeat(64)}).join(' ')).toMatch(/bundleSha256/);
  expect(violations({bundleId:'bundle-0000000000000000'}).join(' ')).toMatch(/bundleId/);
 });
 it('an answer bound to a different bundle is rejected',()=>{
  expect(violations({answerJson:mutate(base.answerJson,a=>{a.bundleSha256='e'.repeat(64);})}).join(' ')).toMatch(/answer.*bundle/i);
 });
 it('question, query, cutoff, basis, database, schema and checkpoint must match the bundle',()=>{
  for(const [k,v] of [['question','A different question?'],['queryType','shared_counterparties_x'],['intentCategory','other'],['historicalCutoffMs',1],['temporalBasis',base.temporalBasis==='receipt'?'publication':'receipt'],['graphDatabaseName','other_db'],['graphSchemaVersion','other'],['lastProjectedSequence',999]] as const){
   expect(violations({[k]:v}).length,k).toBeGreaterThan(0);
  }
 });
 it('support status and validation outcome must match the answer and the validation report',()=>{
  expect(violations({supportStatus:base.supportStatus==='unsupported'?'fully_supported':'unsupported'}).join(' ')).toMatch(/supportStatus/);
  expect(violations({validationValid:!base.validationValid}).join(' ')).toMatch(/validationValid/);
  expect(violations({validationAction:base.validationAction==='accepted'?'downgraded_to_abstention':'accepted'}).join(' ')).toMatch(/validationAction/);
 });
 it('a record validated as valid may not cite evidence or relationships outside its bundle',()=>{
  const forged=mutate(base.answerJson,a=>{a.supportingClaims=[{claimId:'c1',statement:'Forged claim.',distinction:'source_fact',evidenceIds:['not-in-bundle'],relationshipIds:[],quantitativeValue:null,unit:null,currency:null,periodOrAsOf:null}];a.relevantRelationshipIds=['rel-not-in-bundle'];});
  const v=violations({answerJson:forged,validationJson:mutate(base.validationJson,r=>{r.valid=true;r.actionTaken='accepted';}),validationValid:true,validationAction:'accepted'}).join(' ');
  expect(v).toMatch(/not-in-bundle/);expect(v).toMatch(/rel-not-in-bundle/);
 });
 it('the bundle must have been retrieved for the recording owner',()=>{
  expect(violations({},`${ISS}|user_b`).join(' ')).toMatch(/requesterId/);
  expect(violations({},`${ISS}|${'x'}`).join(' ')).toMatch(/requesterId/);
 });
});

describe('Correction 4 — enforced on every write path; legacy rows are labelled, not modified',()=>{
 const modules={'./_generated/server.ts':async()=>({}),'./evidenceChat.ts':()=>import('../convex/evidenceChat'),'./acceptanceNonces.ts':()=>import('../convex/acceptanceNonces'),'./chatBudget.ts':()=>import('../convex/chatBudget'),'./operations.ts':()=>import('../convex/operations')};
 it('the signed-in mutation rejects an inconsistent record and accepts a consistent one, marked strict',async()=>{
  vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN',ISS);
  const t=convexTest(schema,modules),asA=t.withIdentity({subject:'user_a',tokenIdentifier:A,issuer:ISS});
  const ref=makeFunctionReference<'mutation'>('evidenceChat:recordEvidenceChatTurn');
  await expect(asA.mutation(ref,rec({bundleJson:'{}'}))).rejects.toThrow(/bundleJson/);
  await asA.mutation(ref,rec());
  expect(await t.run(ctx=>ctx.db.query('evidenceChatAudit').collect())).toMatchObject([{evidenceIntegrity:'strict_v1'}]);
 });
 it('a historical row without the strict marker is returned unmodified and labelled legacy_unvalidated',async()=>{
  vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN',ISS);
  const t=convexTest(schema,modules),asA=t.withIdentity({subject:'user_a',tokenIdentifier:A,issuer:ISS});
  await t.run(ctx=>ctx.db.insert('evidenceChatAudit',{owner:A,...rec({bundleJson:'{"legacy":true}',answerJson:'{"legacy":true}',validationJson:'{"legacy":true}'}),executionAuthority:'none'} as never));
  const history=await asA.query(makeFunctionReference<'query'>('evidenceChat:listChatHistory'),{}) as Array<{evidenceIntegrity:string;bundle:unknown}>;
  expect(history).toMatchObject([{evidenceIntegrity:'legacy_unvalidated',bundle:{legacy:true}}]);
  const raw=await t.run(ctx=>ctx.db.query('evidenceChatAudit').first());
  expect(raw!.bundleJson).toBe('{"legacy":true}');
 });
});
