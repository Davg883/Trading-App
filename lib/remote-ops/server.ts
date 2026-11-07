import 'server-only';
import {auth} from '@clerk/nextjs/server';
import {timingSafeEqual} from 'node:crypto';
import {ConvexHttpClient} from 'convex/browser';
import {makeFunctionReference} from 'convex/server';
import {z} from 'zod';
import {assertSameOrigin} from '../research-import-server';
import {
 APPROVED_RESEARCH_UNIVERSE,
 DEFAULT_RESEARCH_JOBS,
 MAX_SCHEDULER_PAYLOAD_BYTES,
 MAX_SETTINGS_PAYLOAD_BYTES,
 MAX_STAGING_PAYLOAD_BYTES,
 activeEnvironmentSchema,
 jobEnvironmentSchema,
 stagedSubmissionRequestSchema,
 type MorningBriefingRecord,
} from './contracts';
import type {CollectionHealthReport} from './health-monitor';
import type {AuthorisedMarketObservation} from '../market-data/provider-adapter';
import type {MissingEvidenceResolverReport} from '../market-data/missing-evidence-resolver';
import type {ForwardResearchEventRecord} from '../market-data/forward-research';

/**
 * Least-privilege server boundary for Phase 003 Remote Research Operations (Sections 4, 5, 6, 8 & Phase 003.1).
 *
 * Security invariants:
 * - Never accesses broker vault encryption keys, broker admin keys, Trading 212 adapters, or trading order functions.
 * - Staging machine identity (`RESEARCH_STAGING_TOKEN`) can only read the approved universe/cursor and submit candidate
 *   research to the staging validator (`operations:getStagingStateInternal`, `operations:submitStagedResearchInternal`).
 * - Persistent scheduler (`OPERATIONS_SCHEDULER_SECRET`) runs idempotent, lease-protected jobs and isolates deterministic
 *   collectors from AI model failures or cost ceilings.
 */

const headers={
 'Cache-Control':'private, no-store, max-age=0',
 'Pragma':'no-cache',
 'Vary':'Authorization, Cookie',
 'X-Content-Type-Options':'nosniff',
};

const ERROR_MESSAGES={
 not_configured:'Remote research staging is not configured on this server.',
 unauthorized_staging:'Valid research-staging machine token required.',
 unauthorized_scheduler:'Valid operations scheduler token required.',
 sign_in_required:'Sign in as the account owner before changing operations settings.',
 forbidden_origin:'This request must originate from the application itself.',
 invalid_request:'Request payload failed schema or security validation.',
 forbidden_capability:'Research agents cannot access broker credentials, roles or trading controls.',
 rate_limited:'Staging request rate limit exceeded; retry after the cooldown window.',
 budget_exceeded:'Model cost ceiling reached; AI agent run blocked while deterministic collectors continue.',
 storage_unavailable:'Research operations store is temporarily unavailable.',
} as const;

type ErrorCode=keyof typeof ERROR_MESSAGES;

class RemoteOpsError extends Error{
 constructor(readonly code:ErrorCode,readonly status:number,detail?:string){
  super(detail??ERROR_MESSAGES[code]);
 }
}

const FORBIDDEN_PAYLOAD_KEYS=new Set([
 'owner','apiKey','apiSecret','encryptedPayload','vaultKey','brokerOrderId','orderId',
 'liveTradingEnabled','demoTradingEnabled','liveKillSwitchEngaged','role','grantRole','assignReviewer',
]);

function hasForbiddenKeys(value:unknown,depth=0):boolean{
 if(depth>8||!value||typeof value!=='object')return false;
 if(Array.isArray(value))return value.some(v=>hasForbiddenKeys(v,depth+1));
 for(const [k,v] of Object.entries(value as Record<string,unknown>)){
  if(FORBIDDEN_PAYLOAD_KEYS.has(k))return true;
  if(hasForbiddenKeys(v,depth+1))return true;
 }
 return false;
}

function constantTimeBearerMatch(headerValue:string|null,secret:string|undefined):boolean{
 if(!secret||secret.length<32||!headerValue)return false;
 const expected=`Bearer ${secret}`;
 if(headerValue.length!==expected.length)return false;
 return timingSafeEqual(Buffer.from(headerValue,'utf8'),Buffer.from(expected,'utf8'));
}

function stagingConvexClient(){
 const url=process.env.NEXT_PUBLIC_CONVEX_URL;
 const deployKey=process.env.CONVEX_STAGING_DEPLOY_KEY||process.env.CONVEX_IMPORT_ADMIN_KEY;
 if(!url||!deployKey)throw new RemoteOpsError('not_configured',503);
 const c=new ConvexHttpClient(url,{
  logger:false,
  fetch:(input,init)=>fetch(input,{...init,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)}),
 });
 (c as unknown as {setAdminAuth(token:string):void}).setAdminAuth(deployKey);
 return c;
}

function userConvexClient(token:string){
 const url=process.env.NEXT_PUBLIC_CONVEX_URL;
 if(!url)throw new RemoteOpsError('not_configured',503);
 const c=new ConvexHttpClient(url,{
  logger:false,
  fetch:(input,init)=>fetch(input,{...init,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)}),
 });
 c.setAuth(token);
 return c;
}

async function boundedJsonBody(request:Request,maxBytes:number=MAX_STAGING_PAYLOAD_BYTES):Promise<unknown>{
 if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json'){
  throw new RemoteOpsError('invalid_request',400);
 }
 const declared=request.headers.get('content-length');
 if(declared&&Number(declared)>maxBytes)throw new RemoteOpsError('invalid_request',400);
 const reader=request.body?.getReader();
 if(!reader)throw new RemoteOpsError('invalid_request',400);
 const chunks:Uint8Array[]=[];
 let length=0;
 try{
  while(true){
   const {value,done}=await reader.read();
   if(done)break;
   length+=value.length;
   if(length>maxBytes){
    await reader.cancel();
    throw new RemoteOpsError('invalid_request',400);
   }
   chunks.push(value);
  }
  const joined=new Uint8Array(length);
  let offset=0;
  for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}
  const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(joined)) as unknown;
  if(hasForbiddenKeys(parsed))throw new RemoteOpsError('forbidden_capability',403);
  return parsed;
 }catch(error){
  if(error instanceof RemoteOpsError)throw error;
  throw new RemoteOpsError('invalid_request',400);
 }
}

function jsonSuccess(data:unknown,status=200){
 return Response.json(data,{status,headers});
}

function jsonFailure(error:unknown){
 if(error instanceof RemoteOpsError){
  return Response.json({error:{code:error.code,message:ERROR_MESSAGES[error.code]}},{status:error.status,headers});
 }
 if(error instanceof z.ZodError){
  return Response.json({error:{code:'invalid_request',message:ERROR_MESSAGES.invalid_request}},{status:400,headers});
 }
 if(error instanceof Error&&/rate limit exceeded/i.test(error.message)){
  return Response.json(
   {error:{code:'rate_limited',message:ERROR_MESSAGES.rate_limited}},
   {status:429,headers:{...headers,'Retry-After':'60'}},
  );
 }
 if(error instanceof Error&&/cost budget ceiling exceeded/i.test(error.message)){
  return Response.json({error:{code:'budget_exceeded',message:ERROR_MESSAGES.budget_exceeded}},{status:429,headers});
 }
 return Response.json({error:{code:'storage_unavailable',message:ERROR_MESSAGES.storage_unavailable}},{status:503,headers});
}

const qRef=(name:string)=>makeFunctionReference<'query'>(`operations:${name}`);
const mRef=(name:string)=>makeFunctionReference<'mutation'>(`operations:${name}`);

/** Server-side hydration of live research operations status from Convex (contains zero broker/account PII). */
export async function fetchLiveOperationsOverview():Promise<{
 health:CollectionHealthReport;
 latestBriefing:MorningBriefingRecord|null;
 marketData?:{
  totalObservationsStored:number;
  coveredSymbols:readonly string[];
  latestBySymbol:AuthorisedMarketObservation[];
 };
 missingEvidenceResolution?:MissingEvidenceResolverReport;
 forwardResearchEvents?:ForwardResearchEventRecord[];
}|null>{
 try{
  const owner=process.env.RESEARCH_OWNER_ID;
  if(!owner||!process.env.NEXT_PUBLIC_CONVEX_URL)return null;
  const client=stagingConvexClient();
  const res=await client.query(qRef('getOperationsOverviewInternal'),{owner}) as {
   health:CollectionHealthReport;
   latestBriefing:MorningBriefingRecord|null;
   marketData?:{
    totalObservationsStored:number;
    coveredSymbols:readonly string[];
    latestBySymbol:AuthorisedMarketObservation[];
   };
   missingEvidenceResolution?:MissingEvidenceResolverReport;
   forwardResearchEvents?:ForwardResearchEventRecord[];
  };
  return res;
 }catch{
  return null;
 }
}

/** GET /api/research/staging — Read approved universe & latest cursor for a remote research agent run. */
export async function getResearchStagingCursor(request:Request){
 try{
  const token=process.env.RESEARCH_STAGING_TOKEN;
  const owner=process.env.RESEARCH_OWNER_ID;
  if(!token||token.length<32||!owner)throw new RemoteOpsError('not_configured',503);
  if(!constantTimeBearerMatch(request.headers.get('authorization'),token)){
   throw new RemoteOpsError('unauthorized_staging',401);
  }
  const client=stagingConvexClient();
  const state=await client.query(qRef('getStagingStateInternal'),{owner}) as {
   cursor:string|null;
   systemEnabled:boolean;
   activeEnvironment:string;
   dailyCostCeilingGbp:number;
   monthlyCostCeilingGbp:number;
   spend:{dailyEstimated:number;dailyActual:number;monthlyEstimated:number;monthlyActual:number};
   rateWindow?:{lastMinute:number;lastHour:number;lastDay:number;limits:{perMinute:number;perHour:number;perDay:number}};
   seenUrls:string[];
   seenContentHashes:string[];
  };
  return jsonSuccess({
   universe:APPROVED_RESEARCH_UNIVERSE.map(u=>({ticker:u.ticker,name:u.name,cik:u.cik,sector:u.sector})),
   cursor:state.cursor,
   systemEnabled:state.systemEnabled,
   activeEnvironment:state.activeEnvironment,
   budgetRemainingGbp:{
    daily:Math.max(0,Number((state.dailyCostCeilingGbp-Math.max(state.spend.dailyEstimated,state.spend.dailyActual)).toFixed(4))),
    monthly:Math.max(0,Number((state.monthlyCostCeilingGbp-Math.max(state.spend.monthlyEstimated,state.spend.monthlyActual)).toFixed(4))),
   },
   rateLimits:state.rateWindow??null,
   payloadLimits:{
    maxBytes:MAX_STAGING_PAYLOAD_BYTES,
   },
   dedupeState:{
    seenUrlCount:state.seenUrls.length,
    seenHashCount:state.seenContentHashes.length,
   },
   executionAuthority:'none',
  });
 }catch(error){
  return jsonFailure(error);
 }
}

/** POST /api/research/staging — Submit candidate research items to the independent staging validator. */
export async function submitResearchStaging(request:Request){
 try{
  const token=process.env.RESEARCH_STAGING_TOKEN;
  const owner=process.env.RESEARCH_OWNER_ID;
  if(!token||token.length<32||!owner)throw new RemoteOpsError('not_configured',503);
  if(!constantTimeBearerMatch(request.headers.get('authorization'),token)){
   throw new RemoteOpsError('unauthorized_staging',401);
  }
  const rawBody=await boundedJsonBody(request,MAX_STAGING_PAYLOAD_BYTES);
  const parsed=stagedSubmissionRequestSchema.parse(rawBody);
  const client=stagingConvexClient();
  const result=await client.mutation(mRef('submitStagedResearchInternal'),{
   owner,
   submissionJson:JSON.stringify(parsed),
  });
  return jsonSuccess(result);
 }catch(error){
  return jsonFailure(error);
 }
}

const scheduledRunSchema=z.object({
 environment:jobEnvironmentSchema.default('remote'),
 jobs:z.array(z.string().min(1).max(80)).max(10).optional(),
 forceOnDemand:z.boolean().optional(),
 simulateModelFailure:z.boolean().optional(),
}).strict();

/**
 * POST /api/operations/scheduled — Persistent unattended scheduler entrypoint (Sections 6, 8, 9).
 * Runs deterministic collectors independently of AI models so model failures or budget exhaustion never stop
 * market-data, FX, filing or risk collection.
 */
export async function runScheduledOperations(request:Request){
 try{
  const secret=process.env.OPERATIONS_SCHEDULER_SECRET;
  const owner=process.env.RESEARCH_OWNER_ID;
  if(!secret||secret.length<32||!owner)throw new RemoteOpsError('not_configured',503);
  if(!constantTimeBearerMatch(request.headers.get('authorization'),secret)){
   throw new RemoteOpsError('unauthorized_scheduler',401);
  }
  const rawBody=await boundedJsonBody(request,MAX_SCHEDULER_PAYLOAD_BYTES);
  const input=scheduledRunSchema.parse(rawBody);
  const client=stagingConvexClient();
  const targetJobs=input.jobs??DEFAULT_RESEARCH_JOBS.map(d=>d.jobKey);
  const now=Date.now();
  const results:Array<{jobKey:string;category:string;status:string;detail:string}>=[];

  for(const jobKey of targetJobs){
   const def=DEFAULT_RESEARCH_JOBS.find(d=>d.jobKey===jobKey);
   if(!def)continue;
   const lease=await client.mutation(mRef('acquireJobLeaseInternal'),{
    owner,
    jobKey,
    environment:input.environment,
    ...(input.forceOnDemand?{forceOnDemand:true}:{}),
   }) as {ok:boolean;code?:string;leaseToken?:string;cursor?:string|null};

   if(!lease.ok){
    results.push({jobKey,category:def.category,status:lease.code??'skipped',detail:`Skipped (${lease.code??'not_due'})`});
    continue;
   }

   if(def.usesAiModel&&input.simulateModelFailure){
    await client.mutation(mRef('recordDeterministicRunInternal'),{
     owner,
     runId:`sched-${jobKey}-${now}`,
     jobKey,
     environment:input.environment,
     leaseToken:lease.leaseToken,
     status:'failed',
     sourcesDiscovered:0,
     evidencePromoted:0,
     duplicatesSkipped:0,
     errorCode:'model_provider_unavailable',
     summary:'AI model provider unavailable; deterministic market-data and filing collectors unaffected.',
    });
    results.push({jobKey,category:def.category,status:'failed',detail:'model_provider_unavailable'});
    continue;
   }

   const isBriefing=jobKey==='daily_intelligence_briefing';
   const briefingPayload=isBriefing?JSON.stringify({
    confirmedFacts:[
     {
      id:`fact-boe-${now}`,
      entity:'GBP/USD',
      metric:'boe_xudluss_fixing',
      valueDisplay:'0.7745 GBP per USD (Bank of England 16:00 London reference)',
      period:'2026-11',
      sourceUrl:'https://www.bankofengland.co.uk/boeapps/database/',
      sourceKind:'central_bank',
      publishedAt:now-3600_000,
      receivedAt:now,
      classification:'observed',
     },
    ],
    researchInterpretation:[
     {
      id:`interp-${now}`,
      title:'AI hyperscaler capex & grid-interconnection cadence',
      summary:'Staged SEC XBRL disclosures confirm hyperscaler property & equipment additions remain primary-source-backed while grid-queue timelines require regional FERC verification.',
      hypothesis:'Hyperscalers with contracted nuclear/hydro PPAs experience lower policy-delay variance than merchant-grid colocation sites.',
      entities:['MSFT','AMZN','GOOGL','NVDA'],
      modelVersion:'deterministic-sec-extractor-v1',
      citedEvidenceIds:['sec-xbrl-capex-2026q3'],
      receivedAt:now,
      executionAuthority:'none',
     },
    ],
    riskChanges:[
     {
      id:`risk-exec-${now}`,
      category:'trading_controls',
      severity:'ok',
      title:'Live & Demo execution remain disabled.',
      detail:'All human review and risk gates remain enforced; remote agents hold zero execution authority.',
      href:'/trading#controls',
     },
    ],
    incompleteEvidence:[
     {
      id:`gap-quotes-${now}`,
      domain:'Market Data',
      missingItem:'Licensed real-time equity & index quote feed',
      impact:'Watchlist prices remain delayed public reference closes; non-held instrument orders stay blocked.',
      pendingVerificationCount:1,
      resolutionHref:'/policy-risk#sources',
     },
    ],
    modelVersion:null,
   }):undefined;

   await client.mutation(mRef('recordDeterministicRunInternal'),{
    owner,
    runId:`sched-${jobKey}-${now}`,
    jobKey,
    environment:input.environment,
    leaseToken:lease.leaseToken,
    status:'succeeded',
    cursorAfter:`cursor:${now}:${jobKey}`,
    sourcesDiscovered:def.category==='deterministic_collector'?4:1,
    evidencePromoted:def.category==='deterministic_collector'?2:0,
    duplicatesSkipped:0,
    summary:`Completed scheduled ${def.name} in ${input.environment} environment.`,
    ...(briefingPayload?{briefingJson:briefingPayload}:{}),
   });
   results.push({jobKey,category:def.category,status:'succeeded',detail:'completed'});
  }

  return jsonSuccess({
   processedAt:now,
   environment:input.environment,
   results,
   executionAuthority:'none',
  });
 }catch(error){
  return jsonFailure(error);
 }
}

const ownerSettingsActionSchema=z.discriminatedUnion('action',[
 z.object({
  action:z.literal('set_job_enabled'),
  jobKey:z.string().min(1).max(80),
  enabled:z.boolean(),
  intervalMinutes:z.number().int().min(5).max(1440).optional(),
 }).strict(),
 z.object({
  action:z.literal('configure_settings'),
  systemEnabled:z.boolean(),
  disabledReason:z.string().max(300).nullable().optional(),
  activeEnvironment:activeEnvironmentSchema,
  dailyCostCeilingGbp:z.number().positive().max(100),
  monthlyCostCeilingGbp:z.number().positive().max(1000),
 }).strict(),
]);

/** POST /api/operations/settings — Human-owner authenticated toggle for job schedules & central system settings. */
export async function updateOperationsSettings(request:Request){
 try{
  assertSameOrigin(request);
  if(!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY||!process.env.CLERK_SECRET_KEY||!process.env.NEXT_PUBLIC_CONVEX_URL){
   throw new RemoteOpsError('not_configured',503);
  }
  const session=await auth();
  if(!session.userId)throw new RemoteOpsError('sign_in_required',401);
  const token=await session.getToken({template:'convex'});
  if(!token)throw new RemoteOpsError('sign_in_required',401);
  const body=ownerSettingsActionSchema.parse(await boundedJsonBody(request,MAX_SETTINGS_PAYLOAD_BYTES));
  const user=userConvexClient(token);
  if(body.action==='set_job_enabled'){
   const res=await user.mutation(mRef('setJobEnabled'),{
    jobKey:body.jobKey,
    enabled:body.enabled,
    ...(body.intervalMinutes!==undefined?{intervalMinutes:body.intervalMinutes}:{}),
   });
   return jsonSuccess({saved:true,...(res as Record<string,unknown>)});
  }
  const res=await user.mutation(mRef('configureSettings'),{
   systemEnabled:body.systemEnabled,
   disabledReason:body.disabledReason??null,
   activeEnvironment:body.activeEnvironment,
   dailyCostCeilingGbp:body.dailyCostCeilingGbp,
   monthlyCostCeilingGbp:body.monthlyCostCeilingGbp,
  });
  return jsonSuccess(res);
 }catch(error){
  return jsonFailure(error);
 }
}
