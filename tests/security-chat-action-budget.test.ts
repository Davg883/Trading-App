import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({generate:vi.fn(),get:vi.fn()}));
vi.mock('@google/genai',async orig=>({...(await orig<typeof import('@google/genai')>()),GoogleGenAI:class{models={generateContent:h.generate,get:h.get,list:vi.fn(async()=>({page:[]}))};}}));
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';

/** Pre-merge risk H2 (Convex action path): askEvidenceLockedQuestion reserves budget before any provider call. */
const modules={'./_generated/server.ts':async()=>({}),'./acceptanceNonces.ts':()=>import('../convex/acceptanceNonces'),'./chatBudget.ts':()=>import('../convex/chatBudget'),'./evidenceChat.ts':()=>import('../convex/evidenceChat'),'./operations.ts':()=>import('../convex/operations')};
const ISS='https://issuer.test';
const ask=makeFunctionReference<'action'>('evidenceChat:askEvidenceLockedQuestion');
const liveReply={text:JSON.stringify({shortAnswer:'Not covered by approved evidence.',supportStatus:'unsupported',executiveTldr:[],supportingClaims:[],missingInformation:['x'],abstentionReason:'Insufficient approved evidence.',suggestedFollowUpQuestions:[]}),responseId:'resp-a',usageMetadata:{promptTokenCount:100,candidatesTokenCount:20}};
let n=0;
beforeEach(()=>{h.generate.mockReset();h.get.mockReset();h.get.mockResolvedValue({});vi.stubEnv('GEMINI_API_KEY','test-key-not-real');vi.stubEnv('EVIDENCE_CHAT_GEMINI_ENABLED','true');vi.stubEnv('TYPEDB_HTTP_ADDRESS','');vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN',ISS);});
afterEach(()=>vi.unstubAllEnvs());
function setup(){const owner=`${ISS}|user_action_${++n}`;const t=convexTest(schema,modules);return {t,owner,user:t.withIdentity({subject:`user_action_${n}`,tokenIdentifier:owner,issuer:ISS})};}

describe('H2 — Convex action reserves before calling the provider',()=>{
 it('records a live turn only by settling its reservation',async()=>{
  const {t,user}=setup();h.generate.mockResolvedValue(liveReply);
  const r=await user.action(ask,{question:'Which hyperscalers fund the Irish data-centre build-out?'}) as {telemetry:{generationMode:string}};
  expect(r.telemetry.generationMode).toBe('gemini_live');
  expect(h.generate).toHaveBeenCalledTimes(1);
  expect(await t.run(ctx=>ctx.db.query('chatBudgetReservations').collect())).toMatchObject([{source:'convex_action',status:'settled'}]);
  expect(await t.run(ctx=>ctx.db.query('evidenceChatAudit').collect())).toMatchObject([{generationMode:'gemini_live',recordedVia:'convex_action'}]);
 });
 it('with the ceiling exhausted, makes no provider call and records an explicit budget abstention',async()=>{
  const {t,owner,user}=setup();
  await t.run(ctx=>ctx.db.insert('operationsSettings',{owner,systemEnabled:true,disabledReason:null,activeEnvironment:'remote',dailyCostCeilingGbp:0.01,monthlyCostCeilingGbp:1,updatedAt:Date.now()}));
  const r=await user.action(ask,{question:'Which hyperscalers fund the Irish data-centre build-out?'}) as {telemetry:{generationMode:string;providerStatus:string;estimatedCostGbp:number}};
  expect(h.generate).not.toHaveBeenCalled();
  expect(r.telemetry).toMatchObject({generationMode:'abstention_only',providerStatus:'budget_exceeded',estimatedCostGbp:0});
  expect(await t.run(ctx=>ctx.db.query('chatBudgetReservations').collect())).toEqual([]);
 });
 it('a provider failure is recorded as provider_error and settles the reservation without cost',async()=>{
  const {t,user}=setup();h.generate.mockRejectedValue(new Error('HTTP 400 INVALID_ARGUMENT'));
  const r=await user.action(ask,{question:'Which hyperscalers fund the Irish data-centre build-out?'}) as {telemetry:{generationMode:string;providerStatus:string}};
  expect(r.telemetry).toMatchObject({generationMode:'abstention_only',providerStatus:'provider_error'});
  expect(await t.run(ctx=>ctx.db.query('chatBudgetReservations').collect())).toMatchObject([{status:'settled'}]);
  expect(await t.run(ctx=>ctx.db.query('evidenceChatAudit').collect())).toMatchObject([{providerStatus:'provider_error',estimatedCostGbp:0}]);
 });
});
