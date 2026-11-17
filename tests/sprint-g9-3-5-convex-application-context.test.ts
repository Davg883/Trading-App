import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {convexTest,type TestConvex} from 'convex-test';
import {makeFunctionReference,type UserIdentity} from 'convex/server';
import schema from '../convex/schema';
import {verifyIdentityClaims} from '../convex/authz';
import {APP_SESSION,CONVEX_TEMPLATE_SESSION,TEST_APP_ORIGIN} from './helpers/app-identity';

/**
 * G9.3.5 — Convex application context is mandatory for every identity.
 *
 * Before: only the chat HTTP gateway required `azp` or `aud`; every other Convex function accepted a valid-issuer
 * token carrying neither (G9.3.3 Preview finding: a Clerk Backend-API token was accepted by brokers:viewer and
 * evidenceChat:listChatHistory). Now convex/authz.ts verifyIdentityClaims refuses such tokens for all callers.
 *
 * Covered here: the claim matrix (unit), every public query and mutation in every Convex module (sweep: a token
 * without application context never gets more than an anonymous caller), owner isolation through owner-scoped
 * functions, and the chat HTTP gateway (missing context, expired token).
 */
const ISS='https://issuer.test';
const A=`${ISS}|user_a`,B=`${ISS}|user_b`;
const NOW=Date.parse('2026-11-17T12:00:00Z');
const MARK_A='PRIVATE-MARKER-OWNER-A';
const G='g'.repeat(48);

const MODULE_NAMES=['acceptanceNonces','brokers','chatBudget','consensus','defence','earnings','evidenceChat','graph','infrastructure','operations','policyRisk','portfolio','proofScale','recovery','release','remoteOpsCloud','research','reviewContext','roles','stress','trading'] as const;
const modules:Record<string,()=>Promise<unknown>>={'./_generated/server.ts':async()=>({}),'./http.ts':()=>import('../convex/http')};
for(const name of MODULE_NAMES)modules[`./${name}.ts`]=()=>import(`../convex/${name}.ts`);

type T=TestConvex<typeof schema>;
const identity=(claims:Record<string,unknown>,subject='user_a')=>({subject,tokenIdentifier:`${ISS}|${subject}`,issuer:ISS,...claims});
const NO_CONTEXT={} as const;

beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(NOW);vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN',ISS);});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});

async function seedOwnerA(t:T){
 await t.run(async ctx=>{
  await ctx.db.insert('brokerConnections',{owner:A,provider:'trading212',environment:'live',maskedKey:'••••AA00',revision:1,status:'connected',createdAt:NOW-5000,updatedAt:NOW-1000,lastSuccessfulSyncAt:NOW-1000,lastVerifiedAt:NOW-1000,lastAttemptAt:NOW-1000,lastErrorCode:null,nextAllowedAt:0,leaseToken:null,leaseUntil:0,leaseNumber:0,operation:null});
  await ctx.db.insert('evidenceChatAudit',{owner:A,turnId:`turn-${MARK_A}`,bundleId:`bundle-${MARK_A}`,bundleSha256:'0'.repeat(64),question:`${MARK_A} private question`,queryType:'ownership_chain',intentCategory:'graph',historicalCutoffMs:NOW,temporalBasis:'receipt',graphDatabaseName:'test',graphSchemaVersion:'v1',lastProjectedSequence:0,supportStatus:'fully_supported',validationValid:true,validationAction:'accepted',modelId:'gemini-2.5-flash',generationMode:'gemini_live',providerStatus:'succeeded',inputTokens:1111,outputTokens:1111,cachedTokens:0,estimatedCostGbp:0.5,actualCostGbp:null,latencyMs:10,bundleJson:'{}',answerJson:'{}',validationJson:'{}',createdAtMs:NOW-2000,executionAuthority:'none'});
  await ctx.db.insert('researchJobRuns',{owner:A,runId:`run-${MARK_A}`,jobKey:'news_discovery_agent',category:'remote_agent',environment:'remote',status:'succeeded',startedAt:NOW-4000,finishedAt:NOW-3500,cursorBefore:null,cursorAfter:`cursor-${MARK_A}`,sourcesDiscovered:1,evidenceStaged:1,evidencePromoted:0,duplicatesSkipped:0,pendingVerification:1,modelVersion:'gemini-2.5-flash',inputTokens:10,outputTokens:10,estimatedCostGbp:0.25,actualCostGbp:0.25,errorCode:null,summary:`${MARK_A} run summary`,executionAuthority:'none'});
  await ctx.db.insert('morningBriefings',{owner:A,briefingDate:'2026-11-17',generatedAt:NOW-6000,timezone:'Europe/London',confirmedFactsJson:JSON.stringify([`${MARK_A} fact`]),researchInterpretationJson:'[]',riskChangesJson:'[]',incompleteEvidenceJson:'[]',modelVersion:null,executionAuthority:'none',version:'remote-ops-003-v1'});
  await ctx.db.insert('roleGrants',{subject:A,role:'reviewer',grantedBy:'deployment-admin:test',grantedVia:'deployment_admin',reason:'G9.3.5 test reviewer',grantedAt:0,expiresAt:8.64e15});
 });
}

describe('verifyIdentityClaims — application-context claim matrix (default policy, no options)',()=>{
 const allowed='https://trading-app-git-verify-combined-864cea-david-grannums-projects.vercel.app';
 beforeEach(()=>vi.stubEnv('CLERK_ALLOWED_AZP_ORIGINS',`${TEST_APP_ORIGIN},${allowed}`));
 const check=(claims:Record<string,unknown>,iss=ISS)=>verifyIdentityClaims({tokenIdentifier:`${iss}|user_a`,subject:'user_a',issuer:iss,...claims} as UserIdentity);

 it('accepts a valid browser-origin session token without an audience',()=>{expect(check({azp:allowed}).subject).toBe('user_a');});
 it('accepts a valid origin together with aud "convex"',()=>{expect(check({azp:allowed,aud:'convex'}).subject).toBe('user_a');});
 it('accepts the approved audience without an origin (Clerk "convex" JWT template)',()=>{expect(check({aud:'convex'}).subject).toBe('user_a');});
 it('rejects a wrong origin even with a valid audience',()=>{expect(()=>check({azp:'https://attacker.example.com',aud:'convex'})).toThrow('Untrusted token authorized party');});
 it('rejects a wrong audience even with a valid origin',()=>{expect(()=>check({azp:allowed,aud:'foreign-relying-party'})).toThrow('Untrusted token audience');});
 it('rejects a token missing both claims (Clerk Backend-API / secret-minted token)',()=>{expect(()=>check({})).toThrow('Missing token application context');});
 it('rejects an invalid issuer before any application-context check',()=>{expect(()=>check({azp:allowed},'https://attacker.clerk.accounts.dev')).toThrow('Untrusted token issuer');});
 it('rejects undefined-valued claims as missing context, and null claims as untrusted',()=>{
  expect(()=>check({azp:undefined,aud:undefined})).toThrow('Missing token application context');
  expect(()=>check({azp:null})).toThrow('Untrusted token authorized party');
  expect(()=>check({aud:null})).toThrow('Untrusted token audience');
 });
 it('takes no options: there is no opt-out parameter left to weaken the policy',()=>{
  expect(verifyIdentityClaims.length).toBe(1);
  expect(()=>(verifyIdentityClaims as unknown as (u:UserIdentity,o:unknown)=>UserIdentity)({tokenIdentifier:`${ISS}|user_a`,subject:'user_a',issuer:ISS} as UserIdentity,{requireApplicationContext:false})).toThrow('Missing token application context');
 });
});

describe('owner-scoped functions: application context and cross-user isolation',()=>{
 const listHistory=makeFunctionReference<'query'>('evidenceChat:listChatHistory');
 const brokerViewer=makeFunctionReference<'query'>('brokers:viewer');
 const myRoles=makeFunctionReference<'query'>('roles:myRoles');
 const telemetry=makeFunctionReference<'query'>('evidenceChat:getChatOperationsTelemetry');

 it('a browser-session identity (azp) reaches its own records',async()=>{
  const t=convexTest(schema,modules);await seedOwnerA(t);
  const a=t.withIdentity(identity(APP_SESSION));
  expect(await a.query(brokerViewer,{})).toEqual({owner:A});
  expect(JSON.stringify(await a.query(listHistory,{limit:15}))).toContain(MARK_A);
 });

 it('a Clerk "convex"-template identity (aud only) reaches the same records',async()=>{
  const t=convexTest(schema,modules);await seedOwnerA(t);
  const a=t.withIdentity(identity(CONVEX_TEMPLATE_SESSION));
  expect(await a.query(brokerViewer,{})).toEqual({owner:A});
  expect(JSON.stringify(await a.query(listHistory,{limit:15}))).toContain(MARK_A);
 });

 it('the same subject without application context is refused by every owner-scoped function, so none of its records leak',async()=>{
  const t=convexTest(schema,modules);await seedOwnerA(t);
  const bare=t.withIdentity(identity(NO_CONTEXT));
  for(const [ref,args] of [[brokerViewer,{}],[listHistory,{limit:15}],[myRoles,{}],[telemetry,{}]] as const){
   await expect(bare.query(ref,args)).rejects.toThrow('Missing token application context');
  }
 });

 it('user B with a valid browser session sees none of user A\'s records',async()=>{
  const t=convexTest(schema,modules);await seedOwnerA(t);
  const b=t.withIdentity(identity(APP_SESSION,'user_b'));
  expect(await b.query(brokerViewer,{})).toEqual({owner:B});
  expect(await b.query(listHistory,{limit:15})).toEqual([]);
  expect(JSON.stringify(await b.query(telemetry,{}))).not.toContain('1111');
  expect(await b.query(myRoles,{})).toMatchObject({roles:[]});
 });

 it('a held reviewer grant does not survive the loss of application context',async()=>{
  const t=convexTest(schema,modules);await seedOwnerA(t);
  expect((await t.withIdentity(identity(APP_SESSION)).query(myRoles,{}) as {roles:string[]}).roles).toContain('reviewer');
  await expect(t.withIdentity(identity(NO_CONTEXT)).query(myRoles,{})).rejects.toThrow('Missing token application context');
 });
});

type Registered={isQuery?:boolean;isMutation?:boolean;isAction?:boolean;isPublic?:boolean;exportArgs?:()=>string};
type Outcome={ok:true;value:string}|{ok:false;error:string};
type ValidatorJson={type:string;value?:unknown;tableName?:string};

/**
 * Minimal argument values that satisfy a function's exported validator, so the sweep reaches the handler (and its
 * identity check) instead of stopping at argument validation. Ids are well-formed but name no existing document.
 */
function minimalValue(v:ValidatorJson):unknown{
 switch(v.type){
  case 'string':return 'g935';
  case 'number':return 1;
  case 'bigint':case 'int64':return 1n;
  case 'boolean':return false;
  case 'null':return null;
  case 'id':return `999999${v.tableName}`;
  case 'array':return [];
  case 'record':return {};
  case 'bytes':return new ArrayBuffer(0);
  case 'literal':return v.value;
  case 'union':return minimalValue((v.value as ValidatorJson[])[0]!);
  case 'object':{
   const out:Record<string,unknown>={};
   for(const [k,f] of Object.entries(v.value as Record<string,{fieldType:ValidatorJson;optional:boolean}>))if(!f.optional)out[k]=minimalValue(f.fieldType);
   return out;
  }
  default:return {};
 }
}
const minimalArgs=(fn:Registered)=>{try{const a=minimalValue(JSON.parse(fn.exportArgs?.()??'{"type":"any"}') as ValidatorJson);return a&&typeof a==='object'&&!Array.isArray(a)?a as Record<string,unknown>:{};}catch{return {};}};

async function call(kind:'query'|'mutation',path:string,args:Record<string,unknown>,who:Record<string,unknown>|null):Promise<Outcome>{
 const t=convexTest(schema,modules);await seedOwnerA(t);
 const caller=who?t.withIdentity(who as Partial<UserIdentity>):t;
 try{
  const value=kind==='query'?await caller.query(makeFunctionReference<'query'>(path),args):await caller.mutation(makeFunctionReference<'mutation'>(path),args);
  return {ok:true,value:JSON.stringify(value)??'undefined'};
 }catch(e){return {ok:false,error:e instanceof Error?e.message:String(e)};}
}

describe('sweep: every public query and mutation in every Convex module',()=>{
 it('a token without application context never gets more than an anonymous caller, and is refused wherever a signed-in user is required',async()=>{
  const functions:Array<{path:string;kind:'query'|'mutation';args:Record<string,unknown>}>=[];
  for(const name of MODULE_NAMES){
   const mod=await import(`../convex/${name}.ts`) as Record<string,Registered>;
   for(const [exportName,fn] of Object.entries(mod)){
    if(!fn||typeof fn!=='function'&&typeof fn!=='object'||!fn.isPublic)continue;
    if(fn.isQuery)functions.push({path:`${name}:${exportName}`,kind:'query',args:minimalArgs(fn)});
    else if(fn.isMutation)functions.push({path:`${name}:${exportName}`,kind:'mutation',args:minimalArgs(fn)});
   }
  }
  expect(functions.length).toBeGreaterThan(50);

  const leaks:string[]=[];
  let refusedForMissingContext=0,signedInOnly=0,publicSame=0,argsRequired=0;
  const unreached:string[]=[],otherRefusals:string[]=[],publicNames:string[]=[];
  for(const f of functions){
   const bare=await call(f.kind,f.path,f.args,identity(NO_CONTEXT));
   const anon=await call(f.kind,f.path,f.args,null);
   const full=await call(f.kind,f.path,f.args,identity(APP_SESSION));
   if(bare.ok){
    // The context-less token got a result: it must be exactly what an anonymous caller gets.
    if(!anon.ok||anon.value!==bare.value)leaks.push(`${f.path}: context-less token got a result an anonymous caller does not get`);
    else {publicSame++;publicNames.push(f.path);}
    continue;
   }
   if(bare.error.includes('Missing token application context')){
    refusedForMissingContext++;
    if(full.ok)signedInOnly++;
    continue;
   }
   if(/Validator error|ArgumentValidationError|missing the required field|Object is missing/i.test(bare.error)){argsRequired++;unreached.push(f.path);continue;}
   // Any other refusal must be one the anonymous caller also receives (no context-less-only path past authz).
   if(anon.ok)leaks.push(`${f.path}: context-less token refused with "${bare.error.slice(0,80)}" but anonymous caller succeeded`);
   else otherRefusals.push(`${f.path} (${bare.error.split('\n').find(l=>/Error:/.test(l))?.trim().slice(0,70)??bare.error.slice(0,70)})`);
  }
  expect(leaks).toEqual([]);
  // The policy is actually exercised: functions a valid browser session can use refuse the context-less token.
  expect(refusedForMissingContext).toBeGreaterThan(60);
  expect(argsRequired).toBeLessThan(10);
  console.info(`[G9.3.5 sweep] ${functions.length} public queries/mutations: ${refusedForMissingContext} refused for missing context (${signedInOnly} of them completed for a browser session with the same synthetic arguments), ${publicSame} public with identical anonymous result (${publicNames.join(", ")}), ${argsRequired} not reachable with synthetic arguments.`);
  if(argsRequired>0)console.info(`[G9.3.5 sweep] not reached: ${unreached.join(', ')}`);
  if(otherRefusals.length>0)console.info(`[G9.3.5 sweep] refused earlier for every caller, including anonymous: ${otherRefusals.join('; ')}`);
 },120_000);
});

describe('chat HTTP gateway (Bearer path)',()=>{
 const H={'content-type':'application/json','x-aci-gateway-authorization':`Bearer ${G}`};
 const b64u=(o:unknown)=>Buffer.from(JSON.stringify(o),'utf8').toString('base64url');
 const jwt=(payload:Record<string,unknown>)=>`${b64u({alg:'RS256',typ:'JWT',kid:'ins_test'})}.${b64u(payload)}.${'s'.repeat(86)}`;
 const reserve=(t:{fetch:T['fetch']},bearer?:string)=>t.fetch('/api/evidence-chat/budget/reserve',{method:'POST',headers:{...H,...(bearer?{authorization:`Bearer ${bearer}`}:{})},body:'{}'});
 beforeEach(()=>vi.stubEnv('EVIDENCE_CHAT_GATEWAY_SECRET',G));
 const exp=()=>Math.floor(NOW/1000)+60;

 it('positive control: a browser-session identity with a matching session bearer is served',async()=>{
  const t=convexTest(schema,modules);
  const res=await reserve(t.withIdentity(identity(APP_SESSION)),jwt({iss:ISS,sub:'user_a',azp:TEST_APP_ORIGIN,exp:exp()}));
  expect(res.status).toBe(200);
 });
 it('a bearer token without application context is refused (403 forbidden_identity) and reserves nothing',async()=>{
  const t=convexTest(schema,modules);
  const res=await reserve(t.withIdentity(identity(APP_SESSION)),jwt({iss:ISS,sub:'user_a',exp:exp()}));
  expect(res.status).toBe(403);
  expect(await t.run(ctx=>ctx.db.query('chatBudgetReservations').collect())).toEqual([]);
 });
 it('a Convex identity without application context is refused even with no bearer header',async()=>{
  const t=convexTest(schema,modules);
  expect((await reserve(t.withIdentity(identity(NO_CONTEXT)))).status).toBe(403);
 });
 it('an expired bearer token is refused (401 sign_in_required)',async()=>{
  const t=convexTest(schema,modules);
  const res=await reserve(t.withIdentity(identity(APP_SESSION)),jwt({iss:ISS,sub:'user_a',azp:TEST_APP_ORIGIN,exp:Math.floor(NOW/1000)-1}));
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({error:{code:'sign_in_required'}});
 });
 it('an invalid-issuer bearer token is refused',async()=>{
  const t=convexTest(schema,modules);
  const res=await reserve(t.withIdentity(identity(APP_SESSION)),jwt({iss:'https://attacker.clerk.accounts.dev',sub:'user_a',azp:TEST_APP_ORIGIN,exp:exp()}));
  expect(res.status).toBe(403);
 });
});
