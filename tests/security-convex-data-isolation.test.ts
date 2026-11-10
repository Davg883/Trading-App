import {afterEach,describe,expect,it,vi} from 'vitest';
import {convexTest,type TestConvex} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';

/**
 * MVP hardening — work package 1: Convex private-data isolation.
 *
 * Fixtures: Owner A and Owner B each hold private broker metadata, chat telemetry, staged research, job-run
 * spend and a briefing. Owner C holds nothing. The anonymous caller has no identity.
 * Each scenario is run with `RESEARCH_OWNER_ID` pointing at A (the reported owner-fallback leak) and at C
 * (the reported unscoped global-scan leak).
 */
const modules={
 './_generated/server.ts':async()=>({}),
 './operations.ts':()=>import('../convex/operations'),
 './evidenceChat.ts':()=>import('../convex/evidenceChat'),
 './brokers.ts':()=>import('../convex/brokers'),
 './roles.ts':()=>import('../convex/roles'),
};
const opsQ=(n:string)=>makeFunctionReference<'query'>(`operations:${n}`);
const chatQ=(n:string)=>makeFunctionReference<'query'>(`evidenceChat:${n}`);
const ISSUER='https://issuer.test';
const A=`${ISSUER}|user_a`,B=`${ISSUER}|user_b`,C=`${ISSUER}|user_c`;
const NOW=Date.parse('2026-11-10T12:00:00Z');
const MARK_A='PRIVATE-MARKER-OWNER-A',MARK_B='PRIVATE-MARKER-OWNER-B';

afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});

async function seedOwner(t:TestConvex<typeof schema>,owner:string,marker:string,tokens:number){
 await t.run(async ctx=>{
  await ctx.db.insert('brokerConnections',{owner,provider:'trading212',environment:'live',maskedKey:`••••${marker.slice(-1)}${marker.slice(-1)}00`,revision:1,status:'connected',createdAt:NOW-5000,updatedAt:NOW-1000,lastSuccessfulSyncAt:NOW-1000,lastVerifiedAt:NOW-1000,lastAttemptAt:NOW-1000,lastErrorCode:null,nextAllowedAt:0,leaseToken:null,leaseUntil:0,leaseNumber:0,operation:null});
  await ctx.db.insert('evidenceChatAudit',{owner,turnId:`turn-${marker}`,bundleId:`bundle-${marker}`,bundleSha256:'0'.repeat(64),question:`${marker} private question`,queryType:'ownership_chain',intentCategory:'graph',historicalCutoffMs:NOW,temporalBasis:'receipt',graphDatabaseName:'test',graphSchemaVersion:'v1',lastProjectedSequence:0,supportStatus:'fully_supported',validationValid:true,validationAction:'accepted',modelId:'gemini-2.5-flash',generationMode:'gemini_live',providerStatus:'succeeded',inputTokens:tokens,outputTokens:tokens,cachedTokens:0,estimatedCostGbp:0.5,actualCostGbp:null,latencyMs:10,bundleJson:'{}',answerJson:'{}',validationJson:'{}',createdAtMs:NOW-2000,executionAuthority:'none'});
  await ctx.db.insert('researchStagingItems',{owner,externalId:`ext-${marker}`,runId:`run-${marker}`,agentId:'agent',sourceUrl:`https://example.test/${marker}`,sourceDomain:'example.test',title:`${marker} staged title`,contentSha256:'1'.repeat(64),publishedAt:null,receivedAt:NOW-3000,ingestedAt:NOW-3000,entities:[],claimsJson:'[]',summary:`${marker} staged summary`,isPrimarySource:false,primarySourceUrl:null,validationStatus:'pending_verification',validationReasons:[],researchEligible:false,marketOutcomeEligible:false,promotedEvidenceIds:[],executionAuthority:'none',version:'remote-ops-003-v1'});
  await ctx.db.insert('researchJobRuns',{owner,runId:`run-${marker}`,jobKey:'news_discovery_agent',category:'remote_agent',environment:'remote',status:'succeeded',startedAt:NOW-4000,finishedAt:NOW-3500,cursorBefore:null,cursorAfter:`cursor-${marker}`,sourcesDiscovered:1,evidenceStaged:1,evidencePromoted:0,duplicatesSkipped:0,pendingVerification:1,modelVersion:'gemini-2.5-flash',inputTokens:10,outputTokens:10,estimatedCostGbp:0.25,actualCostGbp:0.25,errorCode:null,summary:`${marker} run summary`,executionAuthority:'none'});
  await ctx.db.insert('morningBriefings',{owner,briefingDate:'2026-11-10',generatedAt:NOW-6000,timezone:'Europe/London',confirmedFactsJson:JSON.stringify([`${marker} fact`]),researchInterpretationJson:'[]',riskChangesJson:'[]',incompleteEvidenceJson:'[]',modelVersion:null,executionAuthority:'none',version:'remote-ops-003-v1'});
 });
}

async function setup(researchOwner:string|undefined){
 vi.useFakeTimers();vi.setSystemTime(NOW);
 if(researchOwner===undefined)vi.stubEnv('RESEARCH_OWNER_ID','');else vi.stubEnv('RESEARCH_OWNER_ID',researchOwner);
 const t=convexTest(schema,modules);
 await seedOwner(t,A,MARK_A,1111);
 await seedOwner(t,B,MARK_B,2222);
 return {
  t,
  a:t.withIdentity({subject:'user_a',tokenIdentifier:A,issuer:ISSUER}),
  b:t.withIdentity({subject:'user_b',tokenIdentifier:B,issuer:ISSUER}),
  c:t.withIdentity({subject:'user_c',tokenIdentifier:C,issuer:ISSUER}),
 };
}

type PublicOverview={health:Record<string,unknown>&{environmentAudit?:Array<{serviceId:string;status:string}>;jobs:Array<Record<string,unknown>>};latestBriefing:unknown;[k:string]:unknown}|null;
type OwnerOverview={health:{evidenceChat?:{totalTurns:number;inputTokensTotal:number};environmentAudit?:Array<{serviceId:string;status:string}>;pendingVerificationCount:number;dailyCostGbp:{estimated:number}};stagedItems:Array<{title:string}>;recentRuns:Array<{summary:string}>;latestBriefing:{confirmedFacts:string[]}|null};

function expectNoPrivateTelemetry(res:PublicOverview){
 expect(res).not.toBeNull();
 const text=JSON.stringify(res);
 expect(text).not.toContain(MARK_A);
 expect(text).not.toContain(MARK_B);
 expect(text).not.toContain('user_a');
 expect(text).not.toContain('user_b');
 expect(res!.health.evidenceChat).toBeUndefined();
 expect(res!.health.recentRuns).toBeUndefined();
 expect(res!.stagedItems).toBeUndefined();
 expect(res!.recentRuns).toBeUndefined();
 expect(res!.forwardResearchEvents).toBeUndefined();
 expect(res!.latestBriefing).toBeNull();
 expect(res!.health.pendingVerificationCount).toBe(0);
 expect(res!.health.dailyCostGbp).toEqual({estimated:0,actual:0,ceiling:0,exceeded:false});
 expect(res!.health.monthlyCostGbp).toEqual({estimated:0,actual:0,ceiling:0,exceeded:false});
 // Broker connection state of any user must not be derivable from the anonymous response.
 expect((res!.health.environmentAudit??[]).some(s=>s.serviceId==='trading212_readonly')).toBe(false);
 for(const j of res!.health.jobs){expect(j.estimatedCostGbp).toBe(0);expect(j.actualCostGbp).toBeNull();expect(j.pendingVerification).toBe(0);}
}

describe('WP1 — anonymous callers never inherit an owner or reach private records',()=>{
 it('publicOperationsOverview: anonymous caller receives no private telemetry when RESEARCH_OWNER_ID is Owner A (owner-fallback leak)',async()=>{
  const {t}=await setup(A);
  expectNoPrivateTelemetry(await t.query(opsQ('publicOperationsOverview'),{}) as PublicOverview);
 });

 it('publicOperationsOverview: an owner with no rows never triggers a global scan of other users (unscoped-fallback leak)',async()=>{
  const {t}=await setup(C);
  expectNoPrivateTelemetry(await t.query(opsQ('publicOperationsOverview'),{}) as PublicOverview);
 });

 it('publicOperationsOverview: the response is identity-independent, so a signed-in caller cannot widen it',async()=>{
  const {t,b}=await setup(A);
  const anonymous=await t.query(opsQ('publicOperationsOverview'),{});
  const signedIn=await b.query(opsQ('publicOperationsOverview'),{});
  expect(signedIn).toEqual(anonymous);
  expectNoPrivateTelemetry(signedIn as PublicOverview);
 });

 it('publicOperationsOverview: returns null rather than any data when no pipeline owner is configured',async()=>{
  const {t}=await setup(undefined);
  expect(await t.query(opsQ('publicOperationsOverview'),{})).toBeNull();
 });

 it('publicOperationsOverview: only allowlisted top-level and health fields are present',async()=>{
  const {t}=await setup(A);
  const res=await t.query(opsQ('publicOperationsOverview'),{}) as NonNullable<PublicOverview>;
  expect(Object.keys(res).sort()).toEqual(['audience','executionAuthority','health','latestBriefing','marketData','missingEvidenceResolution']);
  expect(Object.keys(res.health).sort()).toEqual(['activeEnvironment','aiResearchHealthy','alerts','dailyCostGbp','deterministicCollectionHealthy','environmentAudit','evaluatedAt','executionPaths','graphProjection','jobs','modelFailureIsolated','monthlyCostGbp','operationalLayers','pendingVerificationCount','providers','systemEnabled']);
 });

 it('getChatOperationsTelemetry: anonymous caller is denied whichever owner RESEARCH_OWNER_ID names',async()=>{
  for(const researchOwner of [A,C,undefined]){
   const {t}=await setup(researchOwner);
   await expect(t.query(chatQ('getChatOperationsTelemetry'),{})).rejects.toThrow('Sign in required');
   vi.useRealTimers();vi.unstubAllEnvs();
  }
 });

 it('operations:overview and the private chat queries deny anonymous callers',async()=>{
  const {t}=await setup(A);
  await expect(t.query(opsQ('overview'),{})).rejects.toThrow('Sign in required');
  await expect(t.query(chatQ('listChatHistory'),{})).rejects.toThrow('Sign in required');
  await expect(t.query(chatQ('getChatRetrievalContext'),{})).rejects.toThrow('Sign in required');
  await expect(t.query(chatQ('getEvidenceBundleById'),{bundleId:`bundle-${MARK_A}`})).rejects.toThrow('Sign in required');
 });
});

describe('WP1 — authenticated owners see only their own records',()=>{
 it('Owner A and Owner B each receive only their own chat telemetry',async()=>{
  const {a,b}=await setup(A);
  const ta=await a.query(chatQ('getChatOperationsTelemetry'),{}) as {totalTurnsRecorded:number;totalInputTokens:number};
  const tb=await b.query(chatQ('getChatOperationsTelemetry'),{}) as {totalTurnsRecorded:number;totalInputTokens:number};
  expect(ta).toMatchObject({totalTurnsRecorded:1,totalInputTokens:1111});
  expect(tb).toMatchObject({totalTurnsRecorded:1,totalInputTokens:2222});
 });

 it('Owner A cannot retrieve Owner B records and vice versa through the owner overview',async()=>{
  const {a,b}=await setup(C);
  const oa=await a.query(opsQ('overview'),{}) as OwnerOverview,ob=await b.query(opsQ('overview'),{}) as OwnerOverview;
  expect(JSON.stringify(oa)).toContain(MARK_A);expect(JSON.stringify(oa)).not.toContain(MARK_B);
  expect(JSON.stringify(ob)).toContain(MARK_B);expect(JSON.stringify(ob)).not.toContain(MARK_A);
  expect(oa.health.evidenceChat).toMatchObject({totalTurns:1,inputTokensTotal:1111});
  expect(ob.health.evidenceChat).toMatchObject({totalTurns:1,inputTokensTotal:2222});
  expect(oa.stagedItems.map(s=>s.title)).toEqual([`${MARK_A} staged title`]);
  expect(oa.latestBriefing?.confirmedFacts).toEqual([`${MARK_A} fact`]);
 });

 it('Owner C (no data) stays empty even when C is RESEARCH_OWNER_ID — no fallback to other users',async()=>{
  const {c}=await setup(C);
  const oc=await c.query(opsQ('overview'),{}) as OwnerOverview;
  const text=JSON.stringify(oc);
  expect(text).not.toContain(MARK_A);expect(text).not.toContain(MARK_B);
  expect(oc.health.evidenceChat).toMatchObject({totalTurns:0,inputTokensTotal:0});
  expect(oc.health.environmentAudit?.find(s=>s.serviceId==='trading212_readonly')?.status).toBe('unavailable');
  expect(oc.stagedItems).toEqual([]);expect(oc.recentRuns).toEqual([]);expect(oc.latestBriefing).toBeNull();
  const tc=await c.query(chatQ('getChatOperationsTelemetry'),{}) as {totalTurnsRecorded:number;totalInputTokens:number;lastTurnAtMs:number|null};
  expect(tc).toMatchObject({totalTurnsRecorded:0,totalInputTokens:0,lastTurnAtMs:null});
  expect(await c.query(chatQ('listChatHistory'),{})).toEqual([]);
 });

 it('Owner B cannot open Owner A evidence bundle by guessing its identifier',async()=>{
  const {a,b}=await setup(A);
  await expect(b.query(chatQ('getEvidenceBundleById'),{bundleId:`bundle-${MARK_A}`})).rejects.toThrow('not found or unauthorized');
  expect(await a.query(chatQ('getEvidenceBundleById'),{bundleId:`bundle-${MARK_A}`})).toMatchObject({turnId:`turn-${MARK_A}`});
 });

 it('forged client-supplied owner identifiers are rejected by argument validation',async()=>{
  const {t,b}=await setup(A);
  for(const caller of [t,b]){
   await expect(caller.query(opsQ('publicOperationsOverview'),{owner:A} as never)).rejects.toThrow();
   await expect(caller.query(chatQ('getChatOperationsTelemetry'),{owner:A} as never)).rejects.toThrow();
   await expect(caller.query(chatQ('listChatHistory'),{owner:A} as never)).rejects.toThrow();
  }
  await expect(b.query(opsQ('overview'),{owner:A} as never)).rejects.toThrow();
 });

 it('an identity from an untrusted issuer, or with an untrusted audience or authorised party, is denied',async()=>{
  const {t}=await setup(A);
  vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN',ISSUER);
  const forgedIssuer=t.withIdentity({subject:'user_a',tokenIdentifier:'https://evil.test|user_a',issuer:'https://evil.test'});
  await expect(forgedIssuer.query(chatQ('getChatOperationsTelemetry'),{})).rejects.toThrow('Untrusted token issuer');
  await expect(forgedIssuer.query(opsQ('overview'),{})).rejects.toThrow('Untrusted token issuer');
  const wrongAud=t.withIdentity({subject:'user_a',tokenIdentifier:A,issuer:ISSUER,aud:'some-other-app'});
  await expect(wrongAud.query(chatQ('getChatOperationsTelemetry'),{})).rejects.toThrow('Untrusted token audience');
  const wrongAzp=t.withIdentity({subject:'user_a',tokenIdentifier:A,issuer:ISSUER,azp:'https://evil.test'});
  await expect(wrongAzp.query(chatQ('getChatOperationsTelemetry'),{})).rejects.toThrow('Untrusted token authorized party');
 });

 it('model and automation actors cannot read owner chat telemetry',async()=>{
  const {t}=await setup(A);
  const model=t.withIdentity({subject:'user_a',tokenIdentifier:A,issuer:ISSUER,actorType:'model'});
  await expect(model.query(chatQ('getChatOperationsTelemetry'),{})).rejects.toThrow('Model or automated actors');
 });
});
