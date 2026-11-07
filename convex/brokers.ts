import {signedIn} from './authz';
import {v,type GenericId} from 'convex/values';
import {internalQueryGeneric,type QueryBuilder,type GenericMutationCtx,type GenericQueryCtx} from 'convex/server';
import {query,mutation,internalMutation,type DataModel} from './server';
import {brokerEnvironment,brokerErrorCode,brokerOperation} from './brokerValidators';
import {syncSnapshotSchema} from '../lib/brokers/contracts';
import {parseRateLimits} from '../lib/brokers/rate-limits';

const internalQuery:QueryBuilder<DataModel,'internal'>=internalQueryGeneric;
type Ctx=GenericMutationCtx<DataModel>|GenericQueryCtx<DataModel>;
type Connection=DataModel['brokerConnections']['document'];
const COOLDOWN_MS=60_000,LEASE_MS=90_000;
function validOwner(owner:string){if(!owner.trim()||owner.length>1000)throw new Error('Owner required');}
function metadata(row:Connection){return {connectionId:row._id,provider:row.provider,environment:row.environment,maskedKey:row.maskedKey,status:row.status,readOnly:true as const,createdAt:row.createdAt,updatedAt:row.updatedAt,lastSuccessfulSyncAt:row.lastSuccessfulSyncAt,lastVerifiedAt:row.lastVerifiedAt,lastAttemptAt:row.lastAttemptAt,lastErrorCode:row.lastErrorCode,nextAllowedAt:row.nextAllowedAt,rateLimits:parseRateLimits(row.rateLimitJson)};}
async function authenticatedOwner(ctx:Ctx){const identity=await signedIn(ctx);return identity.tokenIdentifier;}
async function owned(ctx:Ctx,connectionId:GenericId<'brokerConnections'>,owner:string,environment?:'demo'|'live'){validOwner(owner);const row=await ctx.db.get(connectionId);if(!row||row.owner!==owner||environment!==undefined&&row.environment!==environment)throw new Error('Connection unavailable');return row;}
function validEncryptedPayload(value:string){
  if(value.length>20_000)throw new Error('Invalid encrypted credential envelope');
  try{const row=JSON.parse(value) as Record<string,unknown>;if(!row||Array.isArray(row)||Object.keys(row).sort().join(',')!=='ciphertext,iv,keyVersion,tag,version'||row.version!=='broker-vault-v1'||typeof row.keyVersion!=='string'||!/^[A-Za-z0-9._-]{1,64}$/.test(row.keyVersion))throw new Error();for(const key of ['iv','tag','ciphertext'])if(typeof row[key]!=='string'||!row[key]||!/^[A-Za-z0-9+/]+={0,2}$/.test(row[key] as string))throw new Error();if((row.iv as string).length!==16||(row.tag as string).length!==24)throw new Error();return JSON.stringify(row);}catch{throw new Error('Invalid encrypted credential envelope');}
}
function validMaskedKey(value:string){if(!/^[*•]{4,12}[A-Za-z0-9_-]{0,4}$/.test(value))throw new Error('Masked key identifier required');}

/**
 * A 401 is classified without ever trying the key in the other environment:
 * - verified before under this same revision -> credentials_revoked (expired or revoked at Trading 212);
 * - the same masked key is verified in the other environment -> environment_mismatch;
 * - otherwise -> invalid_credentials.
 */
async function classifyError(ctx:GenericMutationCtx<DataModel>,row:Connection,code:string){
  if(code!=='invalid_credentials')return code as Connection['lastErrorCode'] & string;
  if(row.lastVerifiedAt!==null)return 'credentials_revoked' as const;
  const other=await ctx.db.query('brokerConnections').withIndex('by_environment',q=>q.eq('owner',row.owner).eq('environment',row.environment==='live'?'demo':'live')).first();
  if(other&&other.maskedKey===row.maskedKey&&other.lastVerifiedAt!==null)return 'environment_mismatch' as const;
  return 'invalid_credentials' as const;
}

// Provider credentials have no public query or mutation. Next.js authenticates the
// Clerk user, then invokes these internal functions with a server-only admin key.
export const viewer=query({args:{},handler:async ctx=>({owner:await authenticatedOwner(ctx)})});
export const list=query({args:{},handler:async ctx=>{const owner=await authenticatedOwner(ctx);return (await ctx.db.query('brokerConnections').withIndex('by_owner',q=>q.eq('owner',owner)).take(10)).map(metadata);}});
export const detail=query({args:{connectionId:v.id('brokerConnections')},handler:async(ctx,args)=>{const owner=await authenticatedOwner(ctx),row=await owned(ctx,args.connectionId,owner);const snapshot=await ctx.db.query('brokerSnapshots').withIndex('by_connection',q=>q.eq('owner',owner).eq('connectionId',row._id)).order('desc').first();return {...metadata(row),snapshot:snapshot&&snapshot.revision===row.revision?JSON.parse(snapshot.snapshotJson):null};}});

export const saveInternal=internalMutation({args:{owner:v.string(),environment:brokerEnvironment,maskedKey:v.string(),encryptedPayload:v.string()},handler:async(ctx,args)=>{
  validOwner(args.owner);validMaskedKey(args.maskedKey);const encryptedPayload=validEncryptedPayload(args.encryptedPayload),now=Date.now();
  const previous=await ctx.db.query('brokerConnections').withIndex('by_environment',q=>q.eq('owner',args.owner).eq('environment',args.environment)).first();
  let id:GenericId<'brokerConnections'>,revision:number;
  if(previous){id=previous._id;revision=previous.revision+1;await ctx.db.patch(id,{maskedKey:args.maskedKey,revision,status:'saved',updatedAt:now,lastSuccessfulSyncAt:null,lastVerifiedAt:null,lastErrorCode:null,leaseToken:null,leaseUntil:0,operation:null});const snapshots=await ctx.db.query('brokerSnapshots').withIndex('by_connection',q=>q.eq('owner',args.owner).eq('connectionId',id)).collect();for(const snapshot of snapshots)await ctx.db.delete(snapshot._id);}
  else{revision=1;id=await ctx.db.insert('brokerConnections',{owner:args.owner,provider:'trading212',environment:args.environment,maskedKey:args.maskedKey,revision,status:'saved',createdAt:now,updatedAt:now,lastSuccessfulSyncAt:null,lastVerifiedAt:null,lastAttemptAt:null,lastErrorCode:null,nextAllowedAt:0,leaseToken:null,leaseUntil:0,leaseNumber:0,operation:null});}
  const credential=await ctx.db.query('brokerCredentials').withIndex('by_connection',q=>q.eq('connectionId',id)).unique();
  if(credential)await ctx.db.replace(credential._id,{owner:args.owner,connectionId:id,encryptedPayload,revision,createdAt:now});else await ctx.db.insert('brokerCredentials',{owner:args.owner,connectionId:id,encryptedPayload,revision,createdAt:now});
  const schedule=await ctx.db.query('brokerSyncSchedules').withIndex('by_owner_env',q=>q.eq('owner',args.owner).eq('environment',args.environment)).first();
  if(schedule)await ctx.db.patch(schedule._id,{pausedReason:null,consecutiveFailures:0,nextRunAt:now,updatedAt:now});
  return {connectionId:id,revision};
}});
export const getVaultInternal=internalQuery({args:{owner:v.string(),connectionId:v.id('brokerConnections'),environment:brokerEnvironment},handler:async(ctx,args)=>{const row=await owned(ctx,args.connectionId,args.owner,args.environment),vault=await ctx.db.query('brokerCredentials').withIndex('by_connection',q=>q.eq('connectionId',row._id)).unique();if(!vault||vault.owner!==args.owner||vault.revision!==row.revision)throw new Error('Connection unavailable');return {connectionId:row._id,environment:row.environment,revision:row.revision,encryptedPayload:vault.encryptedPayload};}});
export const acquireSyncInternal=internalMutation({args:{owner:v.string(),connectionId:v.id('brokerConnections'),environment:brokerEnvironment,operation:brokerOperation},handler:async(ctx,args)=>{
  const row=await owned(ctx,args.connectionId,args.owner,args.environment),now=Date.now();
  if(row.leaseToken&&row.leaseUntil>now)return {ok:false as const,code:'sync_in_progress' as const,retryAfterAt:row.leaseUntil};
  if(row.nextAllowedAt>now)return {ok:false as const,code:'rate_limited' as const,retryAfterAt:row.nextAllowedAt};
  const vault=await ctx.db.query('brokerCredentials').withIndex('by_connection',q=>q.eq('connectionId',row._id)).unique();if(!vault||vault.owner!==args.owner||vault.revision!==row.revision)throw new Error('Connection unavailable');
  const leaseNumber=row.leaseNumber+1,leaseToken=`${row._id}:${row.revision}:${leaseNumber}`;
  await ctx.db.patch(row._id,{status:'syncing',leaseToken,leaseNumber,leaseUntil:now+LEASE_MS,nextAllowedAt:now+COOLDOWN_MS,lastAttemptAt:now,updatedAt:now,operation:args.operation});
  return {ok:true as const,connectionId:row._id,environment:row.environment,revision:row.revision,leaseToken,encryptedPayload:vault.encryptedPayload,operation:args.operation};
}});
export const recordSyncInternal=internalMutation({args:{owner:v.string(),connectionId:v.id('brokerConnections'),environment:brokerEnvironment,leaseToken:v.string(),revision:v.number(),snapshotJson:v.optional(v.string()),errorCode:v.optional(brokerErrorCode),retryAfterAt:v.optional(v.number()),rateLimitJson:v.optional(v.string())},handler:async(ctx,args)=>{
  const row=await ctx.db.get(args.connectionId),now=Date.now();validOwner(args.owner);
  // Completion after credential replacement/deletion must not recreate a vault or
  // publish another generation's account snapshot.
  if(!row||row.owner!==args.owner||row.environment!==args.environment||row.revision!==args.revision||row.leaseToken!==args.leaseToken||row.leaseUntil<now)return {stored:false};
  if(args.retryAfterAt!==undefined&&(!Number.isFinite(args.retryAfterAt)||args.retryAfterAt<0))throw new Error('Invalid provider retry time');
  const limits=parseRateLimits(args.rateLimitJson),exhausted=limits.filter(l=>l.remaining===0&&l.resetAt!==null&&l.resetAt>now).map(l=>l.resetAt as number);
  // Provider headers are authoritative: an exhausted bucket suppresses requests until its reset, across tabs and servers.
  const nextAllowedAt=Math.max(row.nextAllowedAt,Math.min(Math.max(args.retryAfterAt??0,...exhausted),now+86400000));
  const rateLimitPatch=args.rateLimitJson!==undefined?{rateLimitJson:JSON.stringify(limits)}:{};
  if(args.snapshotJson!==undefined){
    if(args.snapshotJson.length>800_000)throw new Error('Broker snapshot exceeds limit');
    let snapshot;try{snapshot=syncSnapshotSchema.parse(JSON.parse(args.snapshotJson));}catch{throw new Error('Invalid sanitized broker snapshot');}
    if(snapshot.summary.environment!==row.environment||snapshot.scope!==row.operation)throw new Error('Snapshot environment or operation differs');
    for(const observation of [snapshot.summary,snapshot.positions,snapshot.transactions])if(observation&&observation.retrievedAt>now)throw new Error('Future broker observations are unavailable');
    const prior=await ctx.db.query('brokerSnapshots').withIndex('by_connection',q=>q.eq('owner',args.owner).eq('connectionId',row._id)).collect();
    const previous=prior.find(p=>p.revision===row.revision);const priorSnapshot=previous?syncSnapshotSchema.parse(JSON.parse(previous.snapshotJson)):null;
    const merged=snapshot.scope==='test'&&priorSnapshot?.scope==='sync'?{...priorSnapshot,summary:snapshot.summary}:snapshot;
    for(const p of prior)await ctx.db.delete(p._id);
    await ctx.db.insert('brokerSnapshots',{owner:args.owner,connectionId:row._id,environment:row.environment,revision:row.revision,retrievedAt:now,snapshotJson:JSON.stringify(merged),operation:merged.scope});
    // Append-only valuation history and external cash flows for performance reporting (latest snapshot is still replaced).
    const sum=snapshot.summary;await ctx.db.insert('accountValuations',{owner:args.owner,environment:row.environment,connectionId:row._id,observedAt:sum.retrievedAt,currency:sum.data.currency,totalValue:sum.data.totalValue,cash:sum.data.cash.availableToTrade,investedCost:sum.data.investments.totalCost,investmentsValue:sum.data.investments.currentValue,realisedProfitLoss:sum.data.investments.realizedProfitLoss,unrealisedProfitLoss:sum.data.investments.unrealizedProfitLoss,source:sum.sourceUrl});
    if(snapshot.transactions)for(const t of snapshot.transactions.data.items){if(!['DEPOSIT','WITHDRAW','TRANSFER'].includes(t.type))continue;const seen=await ctx.db.query('accountCashFlows').withIndex('by_reference',q=>q.eq('owner',args.owner).eq('environment',row.environment).eq('reference',t.reference)).first();if(seen)continue;await ctx.db.insert('accountCashFlows',{owner:args.owner,environment:row.environment,reference:t.reference,type:t.type,amount:t.type==='WITHDRAW'?-Math.abs(t.amount):t.amount,currency:t.currency,occurredAt:Date.parse(t.dateTime),observedAt:snapshot.transactions.retrievedAt});}
    const errorCode=args.errorCode??merged.historyErrorCode;const partial=Boolean(errorCode);
    await ctx.db.patch(row._id,{...rateLimitPatch,status:partial?'partial':'connected',lastSuccessfulSyncAt:snapshot.scope==='sync'?now:row.lastSuccessfulSyncAt,lastVerifiedAt:now,lastErrorCode:errorCode??null,updatedAt:now,nextAllowedAt,leaseToken:null,leaseUntil:0,operation:null});
  }else{
    const classified=await classifyError(ctx,row,args.errorCode??'provider_unavailable');
    await ctx.db.patch(row._id,{...rateLimitPatch,status:'error',lastErrorCode:classified,updatedAt:now,nextAllowedAt,leaseToken:null,leaseUntil:0,operation:null});
    return {stored:true,errorCode:classified};
  }
  return {stored:true};
}});
export const deleteInternal=internalMutation({args:{owner:v.string(),connectionId:v.id('brokerConnections'),environment:brokerEnvironment},handler:async(ctx,args)=>{
  const row=await owned(ctx,args.connectionId,args.owner,args.environment);
  const vaults=await ctx.db.query('brokerCredentials').withIndex('by_connection',q=>q.eq('connectionId',row._id)).collect();for(const vault of vaults)await ctx.db.delete(vault._id);
  const snapshots=await ctx.db.query('brokerSnapshots').withIndex('by_connection',q=>q.eq('owner',args.owner).eq('connectionId',row._id)).collect();for(const snapshot of snapshots)await ctx.db.delete(snapshot._id);
  const schedules=await ctx.db.query('brokerSyncSchedules').withIndex('by_owner_env',q=>q.eq('owner',args.owner).eq('environment',args.environment)).collect();for(const schedule of schedules)await ctx.db.delete(schedule._id);
  await ctx.db.delete(row._id);return {deleted:true,providerRevocationRequired:true};
}});


// ---------- Automatic synchronisation schedules (owner opt-in) ----------
const MIN_INTERVAL=5,MAX_INTERVAL=1440,CLAIM_MS=120_000,MAX_BACKOFF_MS=6*3600_000;
const PAUSE_ON=new Set(['invalid_credentials','credentials_revoked','environment_mismatch','missing_permissions','invalid_configuration']);
type Schedule=DataModel['brokerSyncSchedules']['document'];
function scheduleView(s:Schedule){return {environment:s.environment,enabled:s.enabled,intervalMinutes:s.intervalMinutes,optedInAt:s.optedInAt,nextRunAt:s.nextRunAt,lastRunAt:s.lastRunAt,lastOutcome:s.lastOutcome,consecutiveFailures:s.consecutiveFailures,pausedReason:s.pausedReason};}
async function humanOwner(ctx:Ctx){const identity=await signedIn(ctx);if(identity.actorType!==undefined&&identity.actorType!=='human')throw new Error('Only the account owner can change automatic synchronisation');return identity.tokenIdentifier;}

export const schedules=query({args:{},handler:async ctx=>{const owner=await authenticatedOwner(ctx);return (await ctx.db.query('brokerSyncSchedules').withIndex('by_owner_env',q=>q.eq('owner',owner)).collect()).map(scheduleView);}});

/** Owner opt-in. Scheduled runs use only the saved read-only credentials and the same lease, cooldown and rate limits. */
export const setAutoSync=mutation({args:{environment:brokerEnvironment,enabled:v.boolean(),intervalMinutes:v.number()},handler:async(ctx,args)=>{
  const owner=await humanOwner(ctx),now=Date.now();
  if(!Number.isInteger(args.intervalMinutes)||args.intervalMinutes<MIN_INTERVAL||args.intervalMinutes>MAX_INTERVAL)throw new Error(`Interval must be ${MIN_INTERVAL}–${MAX_INTERVAL} minutes`);
  const connection=await ctx.db.query('brokerConnections').withIndex('by_environment',q=>q.eq('owner',owner).eq('environment',args.environment)).first();
  if(args.enabled&&!connection)throw new Error('Save a read-only connection for this environment first');
  const existing=await ctx.db.query('brokerSyncSchedules').withIndex('by_owner_env',q=>q.eq('owner',owner).eq('environment',args.environment)).first();
  const patch={enabled:args.enabled,intervalMinutes:args.intervalMinutes,updatedAt:now,...(args.enabled?{nextRunAt:Math.max(now,connection?.nextAllowedAt??0),pausedReason:null,consecutiveFailures:0}:{})};
  if(existing)await ctx.db.patch(existing._id,patch);
  else await ctx.db.insert('brokerSyncSchedules',{owner,environment:args.environment,enabled:args.enabled,intervalMinutes:args.intervalMinutes,optedInAt:now,updatedAt:now,nextRunAt:Math.max(now,connection?.nextAllowedAt??0),claimedUntil:0,lastRunAt:null,lastOutcome:null,consecutiveFailures:0,pausedReason:null});
  await ctx.db.insert('audit',{owner,action:args.enabled?'broker.autosync.enabled':'broker.autosync.disabled',recordId:owner,detail:`${args.environment} every ${args.intervalMinutes} min; read-only credentials only`,at:now});
}});

/**
 * Claims due schedules atomically (one claimant per schedule across tabs, servers and the scheduler).
 * With `owner`, only that owner's schedules are considered (dashboard heartbeat); without it, the global due list (scheduler).
 */
export const claimDueInternal=internalMutation({args:{owner:v.optional(v.string()),limit:v.number()},handler:async(ctx,args)=>{
  const now=Date.now(),limit=Math.max(1,Math.min(25,Math.floor(args.limit)));
  const rows=args.owner!==undefined?(validOwner(args.owner),await ctx.db.query('brokerSyncSchedules').withIndex('by_owner_env',q=>q.eq('owner',args.owner!)).collect()):await ctx.db.query('brokerSyncSchedules').withIndex('by_due',q=>q.eq('enabled',true).lte('nextRunAt',now)).take(limit*4);
  const claimed:{owner:string;environment:'demo'|'live';connectionId:GenericId<'brokerConnections'>}[]=[];
  for(const s of rows){
    if(claimed.length>=limit)break;
    if(!s.enabled||s.pausedReason!==null||s.nextRunAt>now||s.claimedUntil>now)continue;
    const connection=await ctx.db.query('brokerConnections').withIndex('by_environment',q=>q.eq('owner',s.owner).eq('environment',s.environment)).first();
    if(!connection){await ctx.db.patch(s._id,{pausedReason:'no_connection',updatedAt:now});continue;}
    if(connection.nextAllowedAt>now||(connection.leaseToken&&connection.leaseUntil>now)){await ctx.db.patch(s._id,{nextRunAt:Math.max(connection.nextAllowedAt,connection.leaseUntil,now+60_000),updatedAt:now});continue;}
    await ctx.db.patch(s._id,{claimedUntil:now+CLAIM_MS,updatedAt:now});
    claimed.push({owner:s.owner,environment:s.environment,connectionId:connection._id});
  }
  return claimed;
}});

/** Records a scheduled run. Credential problems pause the schedule; temporary failures back off exponentially. */
export const recordScheduledOutcomeInternal=internalMutation({args:{owner:v.string(),environment:brokerEnvironment,outcome:v.union(v.literal('synchronised'),v.literal('partial'),v.literal('failed'),v.literal('skipped')),errorCode:v.optional(v.string())},handler:async(ctx,args)=>{
  validOwner(args.owner);const now=Date.now();
  const s=await ctx.db.query('brokerSyncSchedules').withIndex('by_owner_env',q=>q.eq('owner',args.owner).eq('environment',args.environment)).first();if(!s)return;
  const connection=await ctx.db.query('brokerConnections').withIndex('by_environment',q=>q.eq('owner',args.owner).eq('environment',args.environment)).first();
  const interval=s.intervalMinutes*60_000,notBefore=connection?.nextAllowedAt??0;
  if(args.outcome==='failed'){
    const code=args.errorCode??'provider_unavailable',failures=s.consecutiveFailures+1;
    if(PAUSE_ON.has(code))await ctx.db.patch(s._id,{lastRunAt:now,lastOutcome:`failed:${code}`,consecutiveFailures:failures,pausedReason:code,claimedUntil:0,updatedAt:now});
    else await ctx.db.patch(s._id,{lastRunAt:now,lastOutcome:`failed:${code}`,consecutiveFailures:failures,nextRunAt:Math.max(notBefore,now+Math.min(interval*2**Math.min(failures,6),MAX_BACKOFF_MS)),claimedUntil:0,updatedAt:now});
  }else await ctx.db.patch(s._id,{lastRunAt:now,lastOutcome:args.outcome,consecutiveFailures:args.outcome==='skipped'?s.consecutiveFailures:0,nextRunAt:Math.max(notBefore,now+interval),claimedUntil:0,updatedAt:now});
}});
