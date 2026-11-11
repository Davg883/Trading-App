import {afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {evidenceTurnFields} from './helpers/turn-fixture';
import {convexTest,type TestConvex} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';

/**
 * Pre-merge risk H1. A signed-in user could call the public `recordEvidenceChatTurn` mutation with a fabricated
 * but schema-valid "gemini_live / succeeded" turn, and the telemetry functions counted any such row as genuine
 * provider inference. Live-provider evidence must come only from server-attested paths.
 */
const modules={'./_generated/server.ts':async()=>({}),'./evidenceChat.ts':()=>import('../convex/evidenceChat'),'./acceptanceNonces.ts':()=>import('../convex/acceptanceNonces'),'./operations.ts':()=>import('../convex/operations')};
const ISS='https://issuer.test',A=`${ISS}|user_a`,NOW=Date.parse('2026-11-10T12:00:00Z');
type T=TestConvex<typeof schema>;
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
function setup(){
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(NOW);
 for(const k of ['GEMINI_API_KEY','GOOGLE_API_KEY','GOOGLE_GEMINI_API_KEY','GOOGLE_GENERATIVE_AI_API_KEY','EVIDENCE_CHAT_GEMINI_ENABLED','GEMINI_MODEL_ID','OPENAI_API_KEY','ANTHROPIC_API_KEY'])vi.stubEnv(k,'');
 vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN',ISS);
 const t=convexTest(schema,modules);
 return {t,asA:t.withIdentity({subject:'user_a',tokenIdentifier:A,issuer:ISS})};
}
let EV_A:Awaited<ReturnType<typeof evidenceTurnFields>>;
beforeAll(async()=>{EV_A=await evidenceTurnFields('Which hyperscalers fund the Irish data-centre build-out?',A);});
function turn(o:Record<string,unknown>={}){
 // Evidence fields come from a real, consistent deterministic turn (strict inner evidence validation, Correction 4).
 return {turnId:'chat-1',modelId:'fabricated-model-x',generationMode:'gemini_live',providerStatus:'succeeded',inputTokens:100,outputTokens:50,cachedTokens:0,estimatedCostGbp:0.01,actualCostGbp:0.01,latencyMs:5,createdAtMs:NOW,...EV_A,...o};
}
const rec=makeFunctionReference<'mutation'>('evidenceChat:recordEvidenceChatTurn');
const tel=makeFunctionReference<'query'>('evidenceChat:getChatOperationsTelemetry');
const ov=makeFunctionReference<'query'>('operations:overview');
async function insertRow(t:T,o:Record<string,unknown>){await t.run(async ctx=>{await ctx.db.insert('evidenceChatAudit',{owner:A,...turn(o),executionAuthority:'none'} as never);});}

describe('H1 — public mutation cannot register live provider evidence',()=>{
 it('rejects a client-recorded turn claiming live inference, provider success or provider cost',async()=>{
  const {t,asA}=setup();
  await expect(asA.mutation(rec,turn())).rejects.toThrow(/live provider/i);
  await expect(asA.mutation(rec,turn({generationMode:'abstention_only',providerStatus:'budget_exceeded',estimatedCostGbp:0.01,actualCostGbp:null}))).rejects.toThrow();
  expect(await t.run(ctx=>ctx.db.query('evidenceChatAudit').collect())).toHaveLength(0);
 });
 it('still accepts a non-live, zero-cost turn from the signed-in owner',async()=>{
  const {t,asA}=setup();
  await asA.mutation(rec,turn({generationMode:'deterministic_evidence_synthesis',providerStatus:'not_invoked',inputTokens:0,outputTokens:0,estimatedCostGbp:0,actualCostGbp:0}));
  expect(await t.run(ctx=>ctx.db.query('evidenceChatAudit').collect())).toMatchObject([{owner:A,recordedVia:'client_jwt_legacy'}]);
 });
});

describe('H1 — only server-attested rows count as live inference',()=>{
 for(const via of ['client_jwt_legacy',undefined]){
  it(`a gemini_live row recorded via ${String(via)} is not counted as live`,async()=>{
   const {t,asA}=setup();
   await insertRow(t,via?{recordedVia:via}:{});
   const tm=await asA.query(tel,{}) as {modelId:string;geminiConfigured:boolean;geminiEnabled:boolean;attestedLiveTurns:number};
   expect(tm.attestedLiveTurns).toBe(0);
   expect(tm.modelId).not.toBe('fabricated-model-x');
   expect(tm.geminiConfigured).toBe(false);expect(tm.geminiEnabled).toBe(false);
   const o=await asA.query(ov,{}) as {health:{evidenceChat:{modelId:string;geminiConfigured:boolean;geminiEnabled:boolean}}};
   expect(o.health.evidenceChat.modelId).not.toBe('fabricated-model-x');
   expect(o.health.evidenceChat.geminiConfigured).toBe(false);expect(o.health.evidenceChat.geminiEnabled).toBe(false);
  });
 }
 it('a server-attested gemini_live row is counted',async()=>{
  const {t,asA}=setup();
  await insertRow(t,{recordedVia:'server_gateway',modelId:'gemini-2.5-flash'});
  const tm=await asA.query(tel,{}) as {modelId:string;attestedLiveTurns:number;geminiEnabled:boolean};
  expect(tm).toMatchObject({attestedLiveTurns:1,modelId:'gemini-2.5-flash',geminiEnabled:true});
 });
});
