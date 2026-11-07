import 'server-only';
import {auth} from '@clerk/nextjs/server';
import {timingSafeEqual} from 'node:crypto';
import {ConvexHttpClient} from 'convex/browser';
import {makeFunctionReference} from 'convex/server';
import {z} from 'zod';
import {BrokerError,BROKER_ERROR_MESSAGES,brokerCredentialsSchema,brokerEnvironmentSchema,syncSnapshotSchema,type BrokerEnvironment,type BrokerErrorCode} from './contracts';
import {encryptCredentials,decryptCredentials,encryptedBrokerCredentialsSchema,maskApiKey,vaultConfigured} from './vault';
import {Trading212Adapter} from './trading212';

const serverMessages={not_configured:'Secure broker storage is not configured. Ask the application owner to complete the server setup.',sign_in_required:'Sign in before accessing broker connections.',forbidden_origin:'This request must come from the application itself.',invalid_request:'Check the required connection fields and selected environment.',storage_unavailable:'The private broker store is unavailable. No provider credentials were returned.',sync_in_progress:'A connection check is already running. Wait before trying again.',connection_changed:'This connection changed while synchronising. Refresh the page before trying again.'} as const;
type ServerCode=keyof typeof serverMessages;
class BrokerRequestError extends Error{constructor(readonly code:ServerCode,readonly status:number,readonly retryAfterAt?:number){super(serverMessages[code]);}}
const headers={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
const ref=(name:string)=>makeFunctionReference<'query'>(`brokers:${name}`);
const mutationRef=(name:string)=>makeFunctionReference<'mutation'>(`brokers:${name}`);
type Lease={ok:true;connectionId:string;environment:BrokerEnvironment;revision:number;leaseToken:string;encryptedPayload:string;operation:'test'|'sync'}|{ok:false;code:'rate_limited'|'sync_in_progress';retryAfterAt:number};

/** New, quiet clients per request. Admin capability never enters React props or a client bundle. */
function client(){
  const url=process.env.NEXT_PUBLIC_CONVEX_URL;if(!url)throw new BrokerRequestError('not_configured',503);
  return new ConvexHttpClient(url,{logger:false,fetch:(input,init)=>fetch(input,{...init,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)})});
}
async function context(admin=false){
  if(!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY||!process.env.CLERK_SECRET_KEY||!process.env.NEXT_PUBLIC_CONVEX_URL)throw new BrokerRequestError('not_configured',503);
  const session=await auth();if(!session.userId)throw new BrokerRequestError('sign_in_required',401);
  const token=await session.getToken({template:'convex'});if(!token)throw new BrokerRequestError('sign_in_required',401);
  const user=client();user.setAuth(token);
  let identity:{owner:string};try{identity=await user.query(ref('viewer'),{});}catch{throw new BrokerRequestError('storage_unavailable',503);}
  if(!identity.owner)throw new BrokerRequestError('sign_in_required',401);
  if(!admin)return {owner:identity.owner,user,admin:null};
  const key=process.env.CONVEX_BROKER_ADMIN_KEY;if(!key)throw new BrokerRequestError('not_configured',503);
  const privileged=client();
  // Convex 1.48 ships this server-admin method at runtime; @internal removes its declaration.
  // The pinned runtime is verified by a regression test. No caller can supply actingAsIdentity.
  (privileged as unknown as {setAdminAuth(token:string):void}).setAdminAuth(key);
  return {owner:identity.owner,user,admin:privileged};
}
function sameOrigin(request:Request){
  const origin=request.headers.get('origin'),url=new URL(request.url);let expected=process.env.BROKER_APP_ORIGIN;
  if(!expected&&process.env.NODE_ENV!=='production'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))expected=url.origin;
  if(!expected)throw new BrokerRequestError('not_configured',503);
  const allowed=new Set<string>();
  for(const raw of expected.split(',').map(s=>s.trim()).filter(Boolean)){
    try{const configured=new URL(raw);if(configured.username||configured.password||configured.pathname!=='/'||configured.search||configured.hash)throw new Error();if(process.env.NODE_ENV==='production'&&configured.protocol!=='https:')throw new Error();allowed.add(configured.origin);}catch{throw new BrokerRequestError('not_configured',503);}
  }
  if(allowed.size===0)throw new BrokerRequestError('not_configured',503);
  if(!origin||!allowed.has(origin)||request.headers.get('sec-fetch-site')==='cross-site')throw new BrokerRequestError('forbidden_origin',403);
}
async function jsonBody(request:Request){
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw new BrokerRequestError('invalid_request',400);
  const declared=request.headers.get('content-length');if(declared&&Number(declared)>16000)throw new BrokerRequestError('invalid_request',400);
  // Bounded stream, so chunked requests cannot bypass the body-size limit.
  const reader=request.body?.getReader();if(!reader)throw new BrokerRequestError('invalid_request',400);
  const chunks:Uint8Array[]=[];let length=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>16000){await reader.cancel();throw new BrokerRequestError('invalid_request',400);}chunks.push(value);}const joined=new Uint8Array(length);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(joined)) as unknown;}catch{throw new BrokerRequestError('invalid_request',400);}
}
function success(data:unknown,status=200){return Response.json(data,{status,headers});}
function failure(error:unknown){
  if(error instanceof BrokerRequestError)return Response.json({error:{code:error.code,message:error.message,...(error.retryAfterAt?{retryAfterAt:error.retryAfterAt}:{})}},{status:error.status,headers});
  if(error instanceof BrokerError){const status=error.code==='rate_limited'?429:['invalid_credentials','missing_permissions','environment_mismatch','credentials_revoked'].includes(error.code)?422:502;return Response.json({error:{code:error.code,message:BROKER_ERROR_MESSAGES[error.code],...(error.retryAfterMs!==null?{retryAfterAt:Date.now()+error.retryAfterMs}:{})}},{status,headers});}
  if(error instanceof z.ZodError)return Response.json({error:{code:'invalid_request',message:serverMessages.invalid_request}},{status:400,headers});
  // Deliberately do not log/return error.message, request bodies or provider responses.
  return Response.json({error:{code:'storage_unavailable',message:serverMessages.storage_unavailable}},{status:503,headers});
}
const saveSchema=z.object({provider:z.literal('trading212'),environment:brokerEnvironmentSchema,...brokerCredentialsSchema.shape}).strict();
const connectionSchema=z.object({connectionId:z.string().min(1).max(200),environment:brokerEnvironmentSchema}).strict();
const syncSchema=connectionSchema.extend({operation:z.enum(['test','sync'])});

export async function listBrokerConnections(request:Request){try{const ctx=await context();const connectionId=new URL(request.url).searchParams.get('connectionId');if(connectionId){z.string().min(1).max(200).parse(connectionId);return success({connection:await ctx.user.query(ref('detail'),{connectionId})});}return success({connections:await ctx.user.query(ref('list'),{}),schedules:await ctx.user.query(ref('schedules'),{})});}catch(error){return failure(error);}}
export async function saveBrokerConnection(request:Request){try{sameOrigin(request);const ctx=await context(true);if(!vaultConfigured())throw new BrokerRequestError('not_configured',503);const input=saveSchema.parse(await jsonBody(request));const encrypted=encryptCredentials({apiKey:input.apiKey,apiSecret:input.apiSecret},ctx.owner,input.environment);const result=await ctx.admin!.mutation(mutationRef('saveInternal'),{owner:ctx.owner,environment:input.environment,maskedKey:maskApiKey(input.apiKey),encryptedPayload:JSON.stringify(encrypted)});return success({saved:true,connectionId:result.connectionId,environment:input.environment,readOnly:true});}catch(error){return failure(error);}}
export async function deleteBrokerConnection(request:Request){try{sameOrigin(request);const ctx=await context(true);const input=connectionSchema.parse(await jsonBody(request));await ctx.admin!.mutation(mutationRef('deleteInternal'),{owner:ctx.owner,...input});return success({deleted:true,providerRevocationRequired:true,message:'Local credentials and snapshots deleted. Revoke the API key separately in Trading 212 Settings → API (Beta).'});}catch(error){return failure(error);}}
type SyncInput={connectionId:string;environment:BrokerEnvironment;operation:'test'|'sync'};
type SyncResult={synchronised:true;scope:'test'|'sync';partial:boolean;historyErrorCode:BrokerErrorCode|null;readOnly:true};
/**
 * One read-only synchronisation, shared by manual, dashboard and scheduled runs. Coordination is in Convex: an atomic
 * per-connection lease and a persistent cooldown that also honours provider rate-limit headers, so tabs, server
 * instances and the scheduler cannot run concurrently or exhaust the account limits. Credentials are decrypted only
 * here, only for the connection's own environment (AAD-bound), and are never returned or logged.
 */
async function runSync(privileged:ConvexHttpClient,owner:string,input:SyncInput):Promise<SyncResult>{
  let lease:Extract<Lease,{ok:true}>|null=null,adapter:Trading212Adapter|null=null;
  try{
    const acquired:Lease=await privileged.mutation(mutationRef('acquireSyncInternal'),{owner,...input});
    if(!acquired.ok){if(acquired.code==='sync_in_progress')throw new BrokerRequestError('sync_in_progress',409,acquired.retryAfterAt);throw new BrokerError('rate_limited',Math.max(0,acquired.retryAfterAt-Date.now()));}
    lease=acquired;const envelope=encryptedBrokerCredentialsSchema.parse(JSON.parse(lease.encryptedPayload));const credentials=decryptCredentials(envelope,owner,lease.environment);
    adapter=new Trading212Adapter(lease.environment,credentials,{timeoutMs:10000});
    const summary=await adapter.testConnection();let positions=null,transactions=null,historyErrorCode:BrokerErrorCode|null=null,historyRetryAfterAt:number|undefined;
    if(input.operation==='sync'){positions=await adapter.getPositions();try{transactions=await adapter.getTransactions();}catch(error){if(!(error instanceof BrokerError))throw error;historyErrorCode=error.code;if(error.retryAfterMs!==null)historyRetryAfterAt=Date.now()+error.retryAfterMs;}}
    const snapshot=syncSnapshotSchema.parse({scope:input.operation,summary,positions,transactions,historyErrorCode});
    const stored=await privileged.mutation(mutationRef('recordSyncInternal'),{owner,connectionId:lease.connectionId,environment:lease.environment,leaseToken:lease.leaseToken,revision:lease.revision,snapshotJson:JSON.stringify(snapshot),rateLimitJson:JSON.stringify(adapter.rateLimits()),...(historyErrorCode?{errorCode:historyErrorCode}:{}),...(historyRetryAfterAt!==undefined?{retryAfterAt:historyRetryAfterAt}:{})}) as {stored:boolean};
    lease=null;if(!stored.stored)throw new BrokerRequestError('connection_changed',409);
    return {synchronised:true,scope:input.operation,partial:historyErrorCode!==null,historyErrorCode,readOnly:true};
  }catch(error){
    if(lease){const code=error instanceof BrokerError?error.code:'invalid_configuration';let classified:BrokerErrorCode|null=null;
      // A failed run never overwrites the last successful snapshot; it only records status, classification and cooldown.
      try{const recorded=await privileged.mutation(mutationRef('recordSyncInternal'),{owner,connectionId:lease.connectionId,environment:lease.environment,leaseToken:lease.leaseToken,revision:lease.revision,errorCode:code,...(adapter?{rateLimitJson:JSON.stringify(adapter.rateLimits())}:{}),...(error instanceof BrokerError&&error.retryAfterMs!==null?{retryAfterAt:Date.now()+error.retryAfterMs}:{})}) as {errorCode?:BrokerErrorCode};
        if(recorded.errorCode&&recorded.errorCode!==code)classified=recorded.errorCode;}catch{/* No response/error body is logged. The lease expires independently. */}
      if(classified)throw new BrokerError(classified);}
    throw error;
  }finally{adapter?.disconnect();}
}

export async function synchroniseBrokerConnection(request:Request){
  try{sameOrigin(request);const ctx=await context(true);if(!vaultConfigured())throw new BrokerRequestError('not_configured',503);
    const input=syncSchema.parse(await jsonBody(request));return success(await runSync(ctx.admin!,ctx.owner,input));}
  catch(error){return failure(error);}
}

/** Owner opt-in toggle for automatic synchronisation (stored in Convex under the verified owner). */
const scheduleSchema=z.object({environment:brokerEnvironmentSchema,enabled:z.boolean(),intervalMinutes:z.number().int().min(5).max(1440)}).strict();
export async function setBrokerAutoSync(request:Request){
  try{sameOrigin(request);const ctx=await context();const input=scheduleSchema.parse(await jsonBody(request));
    await ctx.user.mutation(makeFunctionReference<'mutation'>('brokers:setAutoSync'),input);return success({saved:true,...input});}
  catch(error){const m=error instanceof Error?/Uncaught Error: ([^\n]+)/.exec(error.message)?.[1]:null;if(m)return Response.json({error:{code:'invalid_request',message:m.slice(0,200)}},{status:409,headers});return failure(error);}
}

/**
 * Dashboard heartbeat. Cheap when nothing is due: one Convex mutation and no provider request. When one of the owner's
 * opted-in schedules is due, exactly one caller (across tabs and servers) claims it and runs a read-only sync.
 */
export async function brokerAutoSyncHeartbeat(request:Request){
  try{sameOrigin(request);const ctx=await context(true);if(!vaultConfigured())throw new BrokerRequestError('not_configured',503);
    const claimed=await ctx.admin!.mutation(mutationRef('claimDueInternal'),{owner:ctx.owner,limit:2}) as Claimed[];
    const runs=[];for(const c of claimed)runs.push(await scheduledRun(ctx.admin!,c));
    return success({ran:runs.length,runs});}
  catch(error){return failure(error);}
}
type Claimed={owner:string;environment:BrokerEnvironment;connectionId:string};
async function scheduledRun(privileged:ConvexHttpClient,c:Claimed){
  try{const r=await runSync(privileged,c.owner,{connectionId:c.connectionId,environment:c.environment,operation:'sync'});
    await privileged.mutation(mutationRef('recordScheduledOutcomeInternal'),{owner:c.owner,environment:c.environment,outcome:r.partial?'partial':'synchronised'});return {environment:c.environment,outcome:r.partial?'partial':'synchronised'} as {environment:BrokerEnvironment;outcome:string;errorCode?:string};}
  catch(error){const code=error instanceof BrokerError?error.code:error instanceof BrokerRequestError?error.code:'invalid_configuration';const skipped=code==='sync_in_progress'||code==='rate_limited';
    try{await privileged.mutation(mutationRef('recordScheduledOutcomeInternal'),{owner:c.owner,environment:c.environment,outcome:skipped?'skipped':'failed',errorCode:code});}catch{/* monitoring write failed; the claim expires */}
    return {environment:c.environment,outcome:skipped?'skipped':'failed',errorCode:code};}
}

/**
 * Scheduler endpoint for a future persistent deployment (e.g. a platform cron). Authenticated by a server-only bearer
 * secret, not a browser session. Processes opted-in schedules only, sequentially, with the same per-account lease,
 * cooldown and rate limits, and returns a monitoring summary with no owner data or credentials.
 */
export async function runScheduledBrokerSync(request:Request){
  try{
    const secret=process.env.BROKER_SCHEDULER_SECRET;if(!secret||secret.length<32)throw new BrokerRequestError('not_configured',503);
    const given=request.headers.get('authorization')??'',expected=`Bearer ${secret}`;
    if(given.length!==expected.length||!timingSafeEqual(Buffer.from(given),Buffer.from(expected)))return Response.json({error:{code:'forbidden',message:'Scheduler authentication failed'}},{status:401,headers});
    if(!vaultConfigured()||!process.env.CONVEX_BROKER_ADMIN_KEY||!process.env.NEXT_PUBLIC_CONVEX_URL)throw new BrokerRequestError('not_configured',503);
    const privileged=client();(privileged as unknown as {setAdminAuth(token:string):void}).setAdminAuth(process.env.CONVEX_BROKER_ADMIN_KEY);
    const claimed=await privileged.mutation(mutationRef('claimDueInternal'),{limit:10}) as Claimed[];
    const outcomes:Record<string,number>={};for(const c of claimed){const r=await scheduledRun(privileged,c);const k=r.errorCode?`${r.outcome}:${r.errorCode}`:r.outcome;outcomes[k]=(outcomes[k]??0)+1;}
    return success({processed:claimed.length,outcomes,at:Date.now()});
  }catch(error){return failure(error);}
}
