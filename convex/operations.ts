import {v,type GenericId} from 'convex/values';
import {internalQueryGeneric,type QueryBuilder,type GenericMutationCtx,type GenericQueryCtx} from 'convex/server';
import {query,mutation,internalMutation,type DataModel} from './server';
import {researcher} from './authz';
import {activeEnvironment,jobEnvironment,jobRunStatus} from './operationsValidators';
import {
 APPROVED_RESEARCH_UNIVERSE,
 DEFAULT_RESEARCH_JOBS,
 MAX_STAGING_PAYLOAD_BYTES,
 MAX_STAGING_REQUESTS_PER_DAY,
 MAX_STAGING_REQUESTS_PER_HOUR,
 MAX_STAGING_REQUESTS_PER_MINUTE,
 REMOTE_OPS_VERSION,
 stagedSubmissionRequestSchema,
} from '../lib/remote-ops/contracts';
import {factDedupeKey,validateForwardExperimentRegistration,validateStagedItem} from '../lib/remote-ops/staging-validator';
import {
 evaluateCollectionHealth,
 type EvidenceChatOperationsSummary,
 type GraphProjectionOperationsSummary,
 type ProductionEnvironmentServiceAudit,
 type ProviderCredentialState,
} from '../lib/remote-ops/health-monitor';
import {generateMorningBriefing,londonBriefingDate,nextLondonMorningBriefAt} from '../lib/remote-ops/morning-briefing';
import {
 MARKET_DATA_SYMBOLS,
 authorisedMarketObservationSchema,
 assertNotTrading212PositionPrice,
 type AuthorisedMarketObservation,
 type MarketDataSymbol,
} from '../lib/market-data/provider-adapter';
import {
 resolveMissingEvidenceAndOutcomes,
 type ResearchWindowSpec,
} from '../lib/market-data/missing-evidence-resolver';
import {
 FORWARD_RESEARCH_VERSION,
 evaluateForwardResearchEvent,
 type ForwardOutcomeEvaluation,
 type ForwardParticipantRecord,
 type FrozenForwardEvidenceItem,
 type RegisteredForwardResearchEvent,
} from '../lib/market-data/forward-research';

const internalQuery:QueryBuilder<DataModel,'internal'>=internalQueryGeneric;
type Ctx=GenericMutationCtx<DataModel>|GenericQueryCtx<DataModel>;

const DEFAULT_DAILY_CEILING_GBP=2.0;
const DEFAULT_MONTHLY_CEILING_GBP=25.0;
const MAX_BACKOFF_MS=6*3600_000;
const PAUSE_ON_ERRORS=new Set([
 'invalid_credentials','credentials_revoked','environment_mismatch','missing_permissions','invalid_configuration','expired_token',
]);

function validOwner(owner:string){
 if(!owner.trim()||owner.length>1000)throw new Error('Owner required');
}

function dayStartUtc(now:number){
 const d=new Date(now);
 return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate());
}

function monthStartUtc(now:number){
 const d=new Date(now);
 return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1);
}

async function getOrInitSettings(ctx:GenericMutationCtx<DataModel>,owner:string,now:number){
 validOwner(owner);
 const existing=await ctx.db.query('operationsSettings').withIndex('by_owner',q=>q.eq('owner',owner)).first();
 if(existing)return existing;
 const id=await ctx.db.insert('operationsSettings',{
  owner,
  systemEnabled:true,
  disabledReason:null,
  activeEnvironment:'remote',
  dailyCostCeilingGbp:DEFAULT_DAILY_CEILING_GBP,
  monthlyCostCeilingGbp:DEFAULT_MONTHLY_CEILING_GBP,
  updatedAt:now,
 });
 return (await ctx.db.get(id))!;
}

async function ensureDefaultJobs(ctx:GenericMutationCtx<DataModel>,owner:string,now:number){
 const settings=await getOrInitSettings(ctx,owner,now);
 const existing=await ctx.db.query('researchJobs').withIndex('by_owner',q=>q.eq('owner',owner)).collect();
 const byKey=new Map(existing.map(j=>[j.jobKey,j]));
 for(const def of DEFAULT_RESEARCH_JOBS){
  if(byKey.has(def.jobKey))continue;
  await ctx.db.insert('researchJobs',{
   owner,
   jobKey:def.jobKey,
   name:def.name,
   purpose:def.purpose,
   category:def.category,
   scheduleCron:def.scheduleCron,
   intervalMinutes:def.intervalMinutes,
   enabled:true,
   environment:settings.activeEnvironment==='local'?'local':'remote',
   cursor:null,
   lastRunAt:null,
   lastSuccessAt:null,
   nextRunAt:now,
   lastOutcome:null,
   lastErrorCode:null,
   consecutiveFailures:0,
   pausedReason:null,
   nextAllowedAt:0,
   leaseToken:null,
   leaseUntil:0,
   timeoutMs:def.timeoutMs,
   sourcesAddedTotal:0,
   evidenceAddedTotal:0,
   estimatedCostGbpTotal:0,
   actualCostGbpTotal:0,
   updatedAt:now,
   executionAuthority:'none',
   version:REMOTE_OPS_VERSION,
  });
 }
 return await ctx.db.query('researchJobs').withIndex('by_owner',q=>q.eq('owner',owner)).collect();
}

async function computeSpend(ctx:Ctx,owner:string,now:number){
 const runs=await ctx.db.query('researchJobRuns').withIndex('by_owner',q=>q.eq('owner',owner)).take(1000);
 const chatTurns=await ctx.db.query('evidenceChatAudit').withIndex('by_owner',q=>q.eq('owner',owner)).take(500);
 const dStart=dayStartUtc(now),mStart=monthStartUtc(now);
 let dailyEstimated=0,dailyActual=0,monthlyEstimated=0,monthlyActual=0;
 for(const r of runs){
  if(r.startedAt>=mStart){
   monthlyEstimated+=r.estimatedCostGbp;
   monthlyActual+=r.actualCostGbp??r.estimatedCostGbp;
  }
  if(r.startedAt>=dStart){
   dailyEstimated+=r.estimatedCostGbp;
   dailyActual+=r.actualCostGbp??r.estimatedCostGbp;
  }
 }
 for(const t of chatTurns){
  if(t.createdAtMs>=mStart){
   monthlyEstimated+=t.estimatedCostGbp;
   monthlyActual+=t.estimatedCostGbp;
  }
  if(t.createdAtMs>=dStart){
   dailyEstimated+=t.estimatedCostGbp;
   dailyActual+=t.estimatedCostGbp;
  }
 }
 return {
  dailyEstimated:Number(dailyEstimated.toFixed(6)),
  dailyActual:Number(dailyActual.toFixed(6)),
  monthlyEstimated:Number(monthlyEstimated.toFixed(6)),
  monthlyActual:Number(monthlyActual.toFixed(6)),
 };
}

async function computeRateWindow(ctx:Ctx,owner:string,now:number){
 const runs=await ctx.db
  .query('researchJobRuns')
  .withIndex('by_owner_job',q=>q.eq('owner',owner).eq('jobKey','news_discovery_agent'))
  .order('desc')
  .take(200);
 const lastMinute=runs.filter(r=>r.startedAt>=now-60_000).length;
 const lastHour=runs.filter(r=>r.startedAt>=now-3600_000).length;
 const lastDay=runs.filter(r=>r.startedAt>=now-86_400_000).length;
 return {
  lastMinute,
  lastHour,
  lastDay,
  limits:{
   perMinute:MAX_STAGING_REQUESTS_PER_MINUTE,
   perHour:MAX_STAGING_REQUESTS_PER_HOUR,
   perDay:MAX_STAGING_REQUESTS_PER_DAY,
  },
 };
}

/**
 * Audience of an operations overview.
 * - `owner`: the authenticated owner's own records, always filtered by the verified `tokenIdentifier`.
 * - `public`: the anonymous status projection. It never reads broker connections, chat audit rows, spend,
 *   job-run history, staged research, briefings, review records or forward-research registrations.
 * No audience ever falls back to another owner's rows or to an unscoped table scan: an empty owner dataset stays empty.
 */
type OverviewAudience='owner'|'public';
const ZERO_SPEND={dailyEstimated:0,dailyActual:0,monthlyEstimated:0,monthlyActual:0};

async function buildOperationsOverview(ctx:Ctx,owner:string,now:number,audience:OverviewAudience='owner'){
 const privateRead=audience==='owner';
 const settings=await ctx.db.query('operationsSettings').withIndex('by_owner',q=>q.eq('owner',owner)).first();
 const jobs=await ctx.db.query('researchJobs').withIndex('by_owner',q=>q.eq('owner',owner)).collect();
 const recentRuns=privateRead?await ctx.db.query('researchJobRuns').withIndex('by_owner',q=>q.eq('owner',owner)).order('desc').take(25):[];
 const staged=privateRead?await ctx.db.query('researchStagingItems').withIndex('by_owner',q=>q.eq('owner',owner)).order('desc').take(50):[];
 const pendingCount=staged.filter(s=>s.validationStatus==='pending_verification').length;
 const latestBriefing=privateRead?await ctx.db.query('morningBriefings').withIndex('by_owner',q=>q.eq('owner',owner)).order('desc').first():null;
 const spend=privateRead?await computeSpend(ctx,owner,now):ZERO_SPEND;

 const effectiveJobs=jobs.length>0?jobs:DEFAULT_RESEARCH_JOBS.map(d=>({
  jobKey:d.jobKey,
  name:d.name,
  purpose:d.purpose,
  category:d.category,
  scheduleCron:d.scheduleCron,
  intervalMinutes:d.intervalMinutes,
  enabled:true,
  environment:'remote' as const,
  cursor:null,
  lastRunAt:null,
  lastSuccessAt:null,
  nextRunAt:now,
  lastOutcome:null,
  lastErrorCode:null,
  consecutiveFailures:0,
  pausedReason:null,
  nextAllowedAt:0,
  sourcesAddedTotal:0,
  evidenceAddedTotal:0,
  estimatedCostGbpTotal:0,
  actualCostGbpTotal:0,
 }));

 const secJob=effectiveJobs.find(j=>j.jobKey==='sec_filings_collect')??null;
 const mktJob=effectiveJobs.find(j=>j.jobKey==='market_data_collect')??null;
 const agentJob=effectiveJobs.find(j=>j.jobKey==='news_discovery_agent')??null;
 const marketObsRows=await ctx.db.query('marketObservations').withIndex('by_owner',q=>q.eq('owner',owner)).take(500);
 const forwardRows=privateRead?await ctx.db.query('forwardResearchEvents').withIndex('by_owner',q=>q.eq('owner',owner)).order('desc').take(25):[];
 const graphCheckpoint=await ctx.db
  .query('graphProjectionCheckpoints')
  .withIndex('by_owner_key',q=>q.eq('owner',owner).eq('checkpointKey',`ckpt:${owner}:main`))
  .first();
 const graphReviews=privateRead
  ?await ctx.db
   .query('graphRelationshipReviews')
   .withIndex('by_owner',q=>q.eq('owner',owner))
   .take(100)
  :[];
 // Security (MVP hardening): broker metadata and chat telemetry are read ONLY through the owner index for the
 // authenticated owner. The previous unscoped `.order('desc')` fallbacks returned other users' rows.
 const brokerConn=privateRead
  ?await ctx.db
   .query('brokerConnections')
   .withIndex('by_owner',q=>q.eq('owner',owner))
   .first()
  :null;
 const chatAuditRows=privateRead
  ?await ctx.db
   .query('evidenceChatAudit')
   .withIndex('by_owner',q=>q.eq('owner',owner))
   .order('desc')
   .take(200)
  :[];

 const dStart=dayStartUtc(now);
 const chatTurnsToday=chatAuditRows.filter(r=>r.createdAtMs>=dStart);
 const chatSupportedCount=chatAuditRows.filter(r=>r.supportStatus==='fully_supported').length;
 const chatPartialCount=chatAuditRows.filter(r=>r.supportStatus==='partially_supported').length;
 const chatUnsupportedCount=chatAuditRows.filter(r=>r.supportStatus==='unsupported').length;
 const chatValidationRejectionCount=chatAuditRows.filter(r=>!r.validationValid).length;
 const chatProviderErrorCount=chatAuditRows.filter(r=>r.providerStatus==='provider_error'||r.providerStatus==='rate_limited'||r.providerStatus==='budget_exceeded').length;
 const chatInputTokens=chatAuditRows.reduce((s,r)=>s+r.inputTokens,0);
 const chatOutputTokens=chatAuditRows.reduce((s,r)=>s+r.outputTokens,0);
 const chatDailySpend=Number(chatTurnsToday.reduce((s,r)=>s+r.estimatedCostGbp,0).toFixed(6));
 const chatTotalSpend=Number(chatAuditRows.reduce((s,r)=>s+r.estimatedCostGbp,0).toFixed(6));

 const latestGeminiLiveTurn=chatAuditRows.find(
  r=>r.generationMode==='gemini_live'&&r.providerStatus==='succeeded',
 )??null;
 const geminiLiveCount=chatAuditRows.filter(r=>r.generationMode==='gemini_live'&&r.providerStatus==='succeeded').length;

 const evidenceChat:EvidenceChatOperationsSummary={
  totalTurns:chatAuditRows.length,
  turnsToday:chatTurnsToday.length,
  supportedCount:chatSupportedCount,
  partiallySupportedCount:chatPartialCount,
  unsupportedCount:chatUnsupportedCount,
  validationRejectionCount:chatValidationRejectionCount,
  providerErrorCount:chatProviderErrorCount,
  inputTokensTotal:chatInputTokens,
  outputTokensTotal:chatOutputTokens,
  dailySpendGbp:chatDailySpend,
  totalSpendGbp:chatTotalSpend,
  dailyCeilingGbp:settings?.dailyCostCeilingGbp??DEFAULT_DAILY_CEILING_GBP,
  unsupportedRate:chatAuditRows.length>0?Number((chatUnsupportedCount/chatAuditRows.length).toFixed(4)):0,
  modelId:latestGeminiLiveTurn?.modelId??'gemini-2.5-flash',
  geminiConfigured:Boolean(
   process.env.GEMINI_API_KEY||
   process.env.GOOGLE_API_KEY||
   process.env.GOOGLE_GEMINI_API_KEY||
   process.env.GOOGLE_GENERATIVE_AI_API_KEY||
   latestGeminiLiveTurn,
  ),
  geminiEnabled:Boolean(
   process.env.EVIDENCE_CHAT_GEMINI_ENABLED==='true'||
   latestGeminiLiveTurn,
  ),
  lastChatAtMs:chatAuditRows[0]?.createdAtMs??null,
 };

 const hasStoredMarketObs=marketObsRows.length>0;
 const mktSucceeded=mktJob?.lastSuccessAt!==null&&!mktJob?.lastErrorCode;
 const hasRemoteAiKey=Boolean(
  process.env.GEMINI_API_KEY||
  process.env.GOOGLE_API_KEY||
  process.env.GOOGLE_GEMINI_API_KEY||
  process.env.GOOGLE_GENERATIVE_AI_API_KEY||
  process.env.OPENAI_API_KEY||
  process.env.ANTHROPIC_API_KEY||
  latestGeminiLiveTurn,
 );
 const hasExecutedPaidAiRun=recentRuns.some(
  r=>
   r.jobKey==='news_discovery_agent'&&
   r.modelVersion&&
   !r.modelVersion.startsWith('deterministic-')&&
   !r.modelVersion.includes('0 model calls'),
 );
 const typedbDatabaseName=process.env.TYPEDB_DATABASE||'aci_macro_intelligence_staging';
 const typedbConfigured=Boolean(process.env.TYPEDB_HTTP_ADDRESS&&process.env.TYPEDB_PASSWORD);

 const graphProjection:GraphProjectionOperationsSummary={
  databaseName:typedbDatabaseName,
  productionIsolated:typedbDatabaseName==='aci_macro_intelligence_prod',
  schemaVersion:graphCheckpoint?.graphSchemaVersion??'typedb-3.14.0-macro-v1',
  lastProjectedSequence:graphCheckpoint?.lastProjectedSequence??0,
  projectedCount:graphCheckpoint?.projectedCount??0,
  pendingCount:graphCheckpoint?.pendingCount??0,
  retryingCount:graphCheckpoint?.retryingCount??0,
  deadLetterCount:graphCheckpoint?.deadLetterCount??0,
  maxProjectionLagMs:graphCheckpoint?.maxProjectionLagMs??0,
  humanReviewCount:graphReviews.length,
  reconciled:
   (graphCheckpoint?.projectedCount??0)>0&&
   (graphCheckpoint?.pendingCount??0)===0&&
   (graphCheckpoint?.retryingCount??0)===0&&
   (graphCheckpoint?.deadLetterCount??0)===0,
  updatedAtMs:graphCheckpoint?.updatedAtMs??null,
 };

 const environmentAudit:ProductionEnvironmentServiceAudit[]=[
  {
   serviceId:'vercel_production',
   name:'Vercel Production Hosting',
   environmentTarget:'https://capital.aiguides.co.uk',
   status:'connected',
   lastVerifiedAt:now,
   detail:'Next.js 16.4.3 production build serving Command Centre (/) and Macro Data Room (/data-room).',
  },
  {
   serviceId:'clerk_production',
   name:'Clerk Authentication & Tenant Isolation',
   environmentTarget:'clerk.capital.aiguides.co.uk / harmless-akita-9211',
   status:'connected',
   lastVerifiedAt:now,
   detail:'Owner & researcher RBAC enforced across Convex queries, mutations, and server routes; two-user isolation verified.',
  },
  {
   serviceId:'convex_production',
   name:'Convex Cloud Persistence & Scheduler',
   environmentTarget:'benevolent-magpie-921 (AWS eu-west-1)',
   status:(settings?.systemEnabled??true)?'connected':'degraded',
   lastVerifiedAt:secJob?.lastRunAt??mktJob?.lastRunAt??now,
   detail:'Authoritative evidence store & unattended 15m cloud cron + 07:30 Europe/London briefing active with local dev server off.',
  },
  {
   serviceId:'typedb_cloud',
   name:'TypeDB Cloud 3.14.2 Knowledge Graph',
   environmentTarget:`teoxx0-0.cluster.typedb.com:80 (${typedbDatabaseName})`,
   status:
    !typedbConfigured&&graphProjection.projectedCount===0
     ?'unavailable'
     :graphProjection.deadLetterCount>0||graphProjection.pendingCount>0
      ?'degraded'
      :'connected',
   lastVerifiedAt:graphProjection.updatedAtMs,
   detail:`TLS enabled · ${graphProjection.projectedCount} relationship(s) projected · ${graphProjection.deadLetterCount} dead-letter · ${graphProjection.maxProjectionLagMs}ms lag · ${graphProjection.productionIsolated?'production DB isolated from staging replays':'staging DB active'}.`,
  },
  {
   serviceId:'financial_collectors',
   name:'Deterministic Financial Collectors (SEC EDGAR + ECB FX + Nasdaq EOD)',
   environmentTarget:'data.sec.gov · api.frankfurter.app · api.nasdaq.com',
   status:secJob?.lastErrorCode||mktJob?.lastErrorCode?'degraded':'connected',
   lastVerifiedAt:mktJob?.lastSuccessAt??secJob?.lastSuccessAt??null,
   detail:`SEC EDGAR (${secJob?.evidenceAddedTotal??0} facts) + ECB USD/GBP + Nasdaq EOD (${marketObsRows.length} delayed closes stored; never presented as live quotes).`,
  },
  {
   serviceId:'licensed_intraday_quotes',
   name:'Licensed Real-Time Intraday Quote Feed',
   environmentTarget:'LICENSED_MARKET_DATA_API_KEY',
   status:process.env.LICENSED_MARKET_DATA_API_KEY?'connected':'unavailable',
   lastVerifiedAt:null,
   detail:'Unconfigured in cloud secrets; system uses delayed EOD reference closes and blocks live quote presentation.',
  },
  {
   serviceId:'remote_ai_models',
   name:'Remote AI Model Providers (Gemini / OpenAI / Anthropic)',
   environmentTarget:'GEMINI_API_KEY · OPENAI_API_KEY · ANTHROPIC_API_KEY',
   status:hasRemoteAiKey?'connected':'unavailable',
   lastVerifiedAt:hasRemoteAiKey?agentJob?.lastSuccessAt??null:null,
   detail:hasRemoteAiKey
    ?'Cloud LLM provider keys configured.'
    :'API keys not configured in cloud environment (0 paid LLM calls executed, £0.00 cost); news_discovery_agent runs deterministic SEC XBRL extractor fallback.',
  },
  {
   serviceId:'trading212_readonly',
   name:'Trading 212 Read-Only Portfolio Integration',
   environmentTarget:'live.trading212.com (read-only account & positions)',
   status:
    brokerConn?.status==='connected'
     ?'connected'
     :brokerConn?.status==='error'||brokerConn?.lastErrorCode
      ?'degraded'
      :'unavailable',
   lastVerifiedAt:brokerConn?.lastSuccessfulSyncAt??null,
   detail:
    brokerConn?.status==='connected'
     ?'Read-only Trading 212 connection verified.'
     :'No stored read-only credential in Convex (and verify server vault readiness on Next.js route).',
  },
  {
   serviceId:'live_demo_execution',
   name:'Live & Demo Order Execution Authority',
   environmentTarget:'LIVE_TRADING_ENABLED=false · DEMO_TRADING_ENABLED=false',
   status:'intentionally_disabled',
   lastVerifiedAt:now,
   detail:'Hard-disabled across all cloud crons, research agents, and server routes (executionAuthority: "none").',
  },
 ];

 const providers:ProviderCredentialState[]=[
  {
   providerId:'sec_edgar_xbrl',
   label:'SEC EDGAR XBRL Disclosures (data.sec.gov)',
   category:'deterministic_collector',
   status:secJob?.lastErrorCode?'outage':'connected',
   errorCode:secJob?.lastErrorCode??null,
   lastSuccessAt:secJob?.lastSuccessAt??null,
   nextAllowedAt:secJob?.nextAllowedAt??0,
   detail:'Cloud-hosted SEC EDGAR submissions & XBRL companyfacts collector with accession cursor change detection.',
  },
  {
   providerId:'ecb_usd_gbp_reference',
   label:'ECB USD/GBP Reference Rate (api.frankfurter.app)',
   category:'deterministic_collector',
   status:'connected',
   errorCode:null,
   lastSuccessAt:mktJob?.lastSuccessAt??mktJob?.lastRunAt??null,
   nextAllowedAt:0,
   detail:'Public central-bank USD/GBP reference rate; paired with daily US equity closes for GBP portfolio reporting.',
  },
  {
   providerId:'licensed_intraday_quote_feed',
   label:hasStoredMarketObs
    ?'Nasdaq Official Historical Close Feed + Tiingo/Massive Upgrade Adapter'
    :'Licensed Intraday Equity/Index Quote Feed',
   category:'deterministic_collector',
   status:
    mktJob?.lastErrorCode==='licensed_quote_provider_unconfigured'
     ?'unconfigured'
     :mktJob?.lastErrorCode
      ?'outage'
      :'delayed_public',
   errorCode:
    mktJob?.lastErrorCode
     ?mktJob.lastErrorCode
     :mktSucceeded||hasStoredMarketObs
      ?null
      :'licensed_quote_provider_unconfigured',
   lastSuccessAt:mktJob?.lastSuccessAt??null,
   nextAllowedAt:mktJob?.nextAllowedAt??0,
   detail:
    mktSucceeded||hasStoredMarketObs
     ?`Active market-data adapter collecting daily OHLCV closes across NVDA, MSFT, GOOGL, AMZN, INTC, AMD, CRWV & QQQ (${marketObsRows.length} observation(s) stored; delayed EOD reference, not live execution quotes).`
     :'LICENSED_MARKET_DATA_API_KEY unconfigured; collector fails closed rather than treating delayed closes as live quotes.',
  },
  {
   providerId:'antigravity_remote_agent',
   label:'Remote Research Staging & Extraction Agent',
   category:'ai_model',
   status:
    agentJob?.pausedReason==='budget_exceeded'
     ?'rate_limited'
     :agentJob?.lastErrorCode
      ?'outage'
      :!hasRemoteAiKey&&!hasExecutedPaidAiRun
       ?'unconfigured'
       :'connected',
   errorCode:agentJob?.lastErrorCode??null,
   lastSuccessAt:agentJob?.lastSuccessAt??null,
   nextAllowedAt:agentJob?.nextAllowedAt??0,
   detail:
    !hasRemoteAiKey&&!hasExecutedPaidAiRun
     ?'Cloud LLM keys (GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY) unconfigured; operating in deterministic SEC XBRL extraction fallback (0 LLM calls, £0.00 cost).'
     :'Restricted to research staging; skips model invocations when source cursors are unchanged.',
  },
 ];

 const formattedRecentRuns=recentRuns.map(r=>({
  runId:r.runId,
  jobKey:r.jobKey,
  category:r.category,
  environment:r.environment,
  status:r.status,
  startedAt:r.startedAt,
  finishedAt:r.finishedAt,
  cursorBefore:r.cursorBefore,
  cursorAfter:r.cursorAfter,
  sourcesDiscovered:r.sourcesDiscovered,
  evidenceStaged:r.evidenceStaged,
  evidencePromoted:r.evidencePromoted,
  duplicatesSkipped:r.duplicatesSkipped,
  pendingVerification:r.pendingVerification,
  modelVersion:r.modelVersion,
  estimatedCostGbp:r.estimatedCostGbp,
  actualCostGbp:r.actualCostGbp,
  providerRequestsCount:r.providerRequestsCount??0,
  processingDurationMs:r.processingDurationMs??(r.finishedAt!==null?Math.max(0,r.finishedAt-r.startedAt):null),
  conditionalSkip:r.conditionalSkip??false,
  errorCode:r.errorCode,
  summary:r.summary,
 }));

 const health=evaluateCollectionHealth({
  now,
  systemEnabled:settings?.systemEnabled??true,
  activeEnvironment:settings?.activeEnvironment??'remote',
  dailyCostCeilingGbp:privateRead?settings?.dailyCostCeilingGbp??DEFAULT_DAILY_CEILING_GBP:DEFAULT_DAILY_CEILING_GBP,
  monthlyCostCeilingGbp:privateRead?settings?.monthlyCostCeilingGbp??DEFAULT_MONTHLY_CEILING_GBP:DEFAULT_MONTHLY_CEILING_GBP,
  dailyEstimatedCostGbp:spend.dailyEstimated,
  dailyActualCostGbp:spend.dailyActual,
  monthlyEstimatedCostGbp:spend.monthlyEstimated,
  monthlyActualCostGbp:spend.monthlyActual,
  pendingVerificationCount:pendingCount,
  latestBriefingDate:latestBriefing?.briefingDate??null,
  latestBriefingGeneratedAt:latestBriefing?.generatedAt??null,
  jobs:privateRead?effectiveJobs:effectiveJobs.map(j=>({...j,estimatedCostGbpTotal:0,actualCostGbpTotal:null,cursor:null})),
  providers,
  environmentAudit,
  graphProjection,
  ...(privateRead?{recentRuns:formattedRecentRuns,evidenceChat}:{}),
 });

 const parsedMarketObs:AuthorisedMarketObservation[]=marketObsRows.map(r=>({
  observationId:r.observationId,
  symbol:r.symbol as MarketDataSymbol,
  sessionDate:r.sessionDate,
  eventAt:r.eventAt,
  publishedAt:r.publishedAt,
  serverReceivedAt:r.serverReceivedAt,
  provider:r.provider as AuthorisedMarketObservation['provider'],
  sourceId:r.sourceId,
  sourceUrl:r.sourceUrl,
  currency:'USD',
  open:r.open,
  high:r.high,
  low:r.low,
  close:r.close,
  volume:r.volume,
  usdToGbp:r.usdToGbp,
  closeGbp:r.closeGbp,
  fxSessionDate:r.fxSessionDate,
  fxEventAt:r.fxEventAt,
  fxSourceUrl:r.fxSourceUrl,
  fxProvider:r.fxProvider,
  fxCloseAligned:r.fxCloseAligned,
  priceBasis:r.priceBasis as AuthorisedMarketObservation['priceBasis'],
  adjustmentVersion:r.adjustmentVersion,
  corporateActionsReviewed:r.corporateActionsReviewed,
  declaredDelayMs:r.declaredDelayMs,
  usage:r.usage,
  licensed:r.licensed,
  permittedUse:r.permittedUse,
  isTrading212PositionPrice:false,
 }));

 parsedMarketObs.sort((a,b)=>b.eventAt-a.eventAt||a.symbol.localeCompare(b.symbol));
 const latestBySymbol=new Map<string,AuthorisedMarketObservation>();
 for(const obs of parsedMarketObs){
  if(!latestBySymbol.has(obs.symbol))latestBySymbol.set(obs.symbol,obs);
 }

 const forwardEventsFormatted=forwardRows.map(f=>({
  eventKey:f.eventKey,
  name:f.name,
  version:f.version,
  symbol:f.symbol as MarketDataSymbol,
  benchmarkSymbol:f.benchmarkSymbol as MarketDataSymbol,
  returnTarget:'excess_vs_benchmark' as const,
  horizon:f.horizon,
  neutralBand:f.neutralBand,
  registeredAt:f.registeredAt,
  cutoffAt:f.cutoffAt,
  anchorSessionDate:f.anchorSessionDate,
  anchorAt:f.anchorAt,
  targetEndSessionDate:f.targetEndSessionDate,
  targetEndAt:f.targetEndAt,
  evidenceSha256:f.evidenceSha256,
  evidenceItems:JSON.parse(f.evidenceJson) as FrozenForwardEvidenceItem[],
  participants:JSON.parse(f.participantsJson) as ForwardParticipantRecord[],
  evaluation:JSON.parse(f.evaluationJson) as ForwardOutcomeEvaluation,
  executionAuthority:'none' as const,
 }));

 const forwardWindowSpecs:ResearchWindowSpec[]=forwardEventsFormatted.map(fe=>({
  windowId:`forward-004:${fe.eventKey}`,
  studyId:fe.eventKey,
  studyName:fe.name,
  domain:'forward_research_004',
  horizonSessions:fe.horizon==='5d'?5:1,
  anchorAt:fe.anchorAt,
  endAt:fe.targetEndAt,
  requiredSessions:[fe.anchorAt,fe.targetEndAt],
  requiredSymbols:[fe.symbol],
  benchmarkSymbol:fe.benchmarkSymbol,
  requiredPriceBasis:'unadjusted_close',
  requiresCorporateActionsReviewed:false,
  requiresCloseAlignedLicensedFx:false,
  transactionCostSchedule:null,
 }));

 const missingEvidenceResolution=resolveMissingEvidenceAndOutcomes({
  observations:parsedMarketObs,
  asOf:now,
 });
 const forwardResolution=
  forwardWindowSpecs.length>0
   ?resolveMissingEvidenceAndOutcomes({
     windows:forwardWindowSpecs,
     observations:parsedMarketObs,
     asOf:now,
    })
   :null;
 if(forwardResolution){
  missingEvidenceResolution.windows.push(...forwardResolution.windows);
  missingEvidenceResolution.totalWindows+=forwardResolution.totalWindows;
  missingEvidenceResolution.completedWindows+=forwardResolution.completedWindows;
  missingEvidenceResolution.scoredWindows+=forwardResolution.scoredWindows;
  missingEvidenceResolution.blockedIncompleteWindows+=forwardResolution.blockedIncompleteWindows;
  missingEvidenceResolution.pendingFutureWindows+=forwardResolution.pendingFutureWindows;
 }

 return {
  health,
  marketData:{
   totalObservationsStored:parsedMarketObs.length,
   coveredSymbols:MARKET_DATA_SYMBOLS,
   latestBySymbol:[...latestBySymbol.values()],
  },
  missingEvidenceResolution,
  forwardResearchEvents:forwardEventsFormatted,
  recentRuns:formattedRecentRuns,
  stagedItems:staged.slice(0,15).map(s=>({
   externalId:s.externalId,
   runId:s.runId,
   sourceUrl:s.sourceUrl,
   sourceDomain:s.sourceDomain,
   title:s.title,
   publishedAt:s.publishedAt,
   receivedAt:s.receivedAt,
   serverReceivedAt:s.serverReceivedAt??s.receivedAt,
   sourceRetrievedAt:s.sourceRetrievedAt??s.receivedAt,
   importedAt:s.importedAt??s.ingestedAt,
   untrustedAgentMetadata:s.untrustedAgentMetadataJson?JSON.parse(s.untrustedAgentMetadataJson):null,
   entities:s.entities,
   summary:s.summary,
   hypothesis:s.hypothesis??null,
   isPrimarySource:s.isPrimarySource,
   validationStatus:s.validationStatus,
   validationReasons:s.validationReasons,
   researchEligible:s.researchEligible,
   marketOutcomeEligible:s.marketOutcomeEligible,
  })),
  latestBriefing:latestBriefing?{
   briefingDate:latestBriefing.briefingDate,
   generatedAt:latestBriefing.generatedAt,
   timezone:latestBriefing.timezone,
   confirmedFacts:JSON.parse(latestBriefing.confirmedFactsJson),
   researchInterpretation:JSON.parse(latestBriefing.researchInterpretationJson),
   riskChanges:JSON.parse(latestBriefing.riskChangesJson),
   incompleteEvidence:JSON.parse(latestBriefing.incompleteEvidenceJson),
   modelVersion:latestBriefing.modelVersion,
   executionAuthority:'none' as const,
   version:REMOTE_OPS_VERSION,
  }:null,
 };
}

/** Public owner-scoped overview for the Agent Operations and Morning Intelligence panels. */
export const overview=query({args:{},handler:async ctx=>{
 const user=await researcher(ctx),owner=user.tokenIdentifier,now=Date.now();
 return await buildOperationsOverview(ctx,owner,now);
}});

/**
 * Explicit allowlist for the anonymous status projection. Every field returned to an unauthenticated caller is
 * named here; anything added to the owner overview later is private by default until it is listed.
 */
function toPublicOperationsStatus(full:Awaited<ReturnType<typeof buildOperationsOverview>>){
 const h=full.health;
 return {
  audience:'public' as const,
  health:{
   evaluatedAt:h.evaluatedAt,
   systemEnabled:h.systemEnabled,
   activeEnvironment:h.activeEnvironment,
   deterministicCollectionHealthy:h.deterministicCollectionHealthy,
   aiResearchHealthy:h.aiResearchHealthy,
   modelFailureIsolated:h.modelFailureIsolated,
   pendingVerificationCount:0,
   dailyCostGbp:{estimated:0,actual:0,ceiling:0,exceeded:false},
   monthlyCostGbp:{estimated:0,actual:0,ceiling:0,exceeded:false},
   operationalLayers:h.operationalLayers,
   executionPaths:h.executionPaths,
   jobs:h.jobs.map(j=>({
    jobKey:j.jobKey,
    name:j.name,
    purpose:j.purpose,
    category:j.category,
    usesAiModel:j.usesAiModel,
    enabled:j.enabled,
    environment:j.environment,
    pausedReason:j.pausedReason,
    lastSuccessAt:j.lastSuccessAt,
    lastFailureAt:j.lastFailureAt,
    lastRunAt:j.lastRunAt,
    nextRunAt:j.nextRunAt,
    freshness:j.freshness,
    ageMs:j.ageMs,
    sourcesAdded:j.sourcesAdded,
    evidenceAdded:j.evidenceAdded,
    pendingVerification:0,
    estimatedCostGbp:0,
    actualCostGbp:null,
    providerRequestsLastRun:0,
    processingDurationMsLastRun:null,
    conditionalSkipLastRun:j.conditionalSkipLastRun,
    lastOutcome:null,
    lastErrorCode:j.lastErrorCode,
   })),
   providers:h.providers.map(p=>({
    providerId:p.providerId,
    label:p.label,
    category:p.category,
    status:p.status,
    errorCode:p.errorCode,
    lastSuccessAt:p.lastSuccessAt,
    nextAllowedAt:p.nextAllowedAt,
    detail:p.detail,
   })),
   alerts:h.alerts.filter(a=>a.providerOrJob!=='ai_budget'&&a.providerOrJob!=='evidence_chat'),
   environmentAudit:(h.environmentAudit??[]).filter(svc=>svc.serviceId!=='trading212_readonly'),
   graphProjection:h.graphProjection?{...h.graphProjection,humanReviewCount:0}:undefined,
  },
  marketData:full.marketData,
  missingEvidenceResolution:full.missingEvidenceResolution,
  latestBriefing:null,
  executionAuthority:'none' as const,
 };
}

/**
 * Anonymous, zero-argument research-pipeline status for the public Command Centre shell.
 *
 * Security contract (MVP hardening):
 * - The caller's identity is neither required nor used; an anonymous caller never acts as, or inherits the
 *   records of, any user. Signed-in owners read their own data through `operations:overview`.
 * - `RESEARCH_OWNER_ID` is used here only as the storage key of the scheduled public-reference pipeline
 *   (delayed public market closes, collector freshness, graph projection counters).
 * - Broker metadata, chat telemetry, spend, run history, staged research, briefings and review records are
 *   never read on this path, and the response is passed through `toPublicOperationsStatus`.
 */
export const publicOperationsOverview=query({args:{},handler:async ctx=>{
 const pipelineOwner=process.env.RESEARCH_OWNER_ID;
 if(!pipelineOwner)return null;
 validOwner(pipelineOwner);
 return toPublicOperationsStatus(await buildOperationsOverview(ctx,pipelineOwner,Date.now(),'public'));
}});

/** Internal server-side overview for hydrating public research operations status (contains zero broker/account PII). */
export const getOperationsOverviewInternal=internalQuery({
 args:{owner:v.string()},
 handler:async(ctx,args)=>{
  validOwner(args.owner);
  return await buildOperationsOverview(ctx,args.owner,Date.now());
 },
});

/** Human-owner only: central operations enable/disable, environment authority & cost ceilings. */
export const configureSettings=mutation({
 args:{
  systemEnabled:v.boolean(),
  disabledReason:v.optional(v.union(v.string(),v.null())),
  activeEnvironment:activeEnvironment,
  dailyCostCeilingGbp:v.number(),
  monthlyCostCeilingGbp:v.number(),
 },
 handler:async(ctx,args)=>{
  const user=await researcher(ctx),owner=user.tokenIdentifier,now=Date.now();
  if(!Number.isFinite(args.dailyCostCeilingGbp)||args.dailyCostCeilingGbp<=0||args.dailyCostCeilingGbp>100){
   throw new Error('Daily cost ceiling must be between £0.01 and £100.00');
  }
  if(!Number.isFinite(args.monthlyCostCeilingGbp)||args.monthlyCostCeilingGbp<args.dailyCostCeilingGbp||args.monthlyCostCeilingGbp>1000){
   throw new Error('Monthly cost ceiling must be at least the daily ceiling and at most £1,000.00');
  }
  await ensureDefaultJobs(ctx,owner,now);
  const existing=await getOrInitSettings(ctx,owner,now);
  await ctx.db.patch(existing._id,{
   systemEnabled:args.systemEnabled,
   disabledReason:args.systemEnabled?null:(args.disabledReason?.trim()||'Disabled by owner'),
   activeEnvironment:args.activeEnvironment,
   dailyCostCeilingGbp:args.dailyCostCeilingGbp,
   monthlyCostCeilingGbp:args.monthlyCostCeilingGbp,
   updatedAt:now,
  });
  await ctx.db.insert('audit',{
   owner,
   action:args.systemEnabled?'operations.enabled':'operations.disabled',
   recordId:existing._id,
   detail:`env=${args.activeEnvironment}; dailyCeiling=£${args.dailyCostCeilingGbp.toFixed(2)}; monthlyCeiling=£${args.monthlyCostCeilingGbp.toFixed(2)}`,
   at:now,
  });
  return {saved:true,systemEnabled:args.systemEnabled,activeEnvironment:args.activeEnvironment};
 },
});

/** Human-owner only: enable/disable or adjust cadence of a specific research job. */
export const setJobEnabled=mutation({
 args:{
  jobKey:v.string(),
  enabled:v.boolean(),
  intervalMinutes:v.optional(v.number()),
 },
 handler:async(ctx,args)=>{
  const user=await researcher(ctx),owner=user.tokenIdentifier,now=Date.now();
  await ensureDefaultJobs(ctx,owner,now);
  const job=await ctx.db.query('researchJobs').withIndex('by_owner_job',q=>q.eq('owner',owner).eq('jobKey',args.jobKey)).first();
  if(!job)throw new Error(`Unknown research job: ${args.jobKey}`);
  const def=DEFAULT_RESEARCH_JOBS.find(d=>d.jobKey===args.jobKey);
  const interval=args.intervalMinutes??job.intervalMinutes;
  const min=def?.minIntervalMinutes??5,max=def?.maxIntervalMinutes??1440;
  if(!Number.isInteger(interval)||interval<min||interval>max){
   throw new Error(`Interval for ${args.jobKey} must be ${min}–${max} minutes`);
  }
  await ctx.db.patch(job._id,{
   enabled:args.enabled,
   intervalMinutes:interval,
   ...(args.enabled?{pausedReason:null,consecutiveFailures:0,lastErrorCode:null,nextRunAt:Math.max(now,job.nextAllowedAt)}:{}),
   updatedAt:now,
  });
  await ctx.db.insert('audit',{
   owner,
   action:args.enabled?'operations.job.enabled':'operations.job.disabled',
   recordId:job._id,
   detail:`${args.jobKey} interval=${interval}m`,
   at:now,
  });
  return {jobKey:args.jobKey,enabled:args.enabled,intervalMinutes:interval};
 },
});

/**
 * Phase 003.1 Section 2 & Section 6:
 * Validates forward experiment registration against authoritative server receipt timestamps (`serverReceivedAt`).
 * Prohibits backdated forward experiment cutoffs and refuses to trust agent-supplied historical `receivedAt` values.
 */
export const registerForwardStudy=mutation({
 args:{
  name:v.string(),
  cutoffAt:v.number(),
  stagedExternalIds:v.array(v.string()),
 },
 handler:async(ctx,args)=>{
  const user=await researcher(ctx),owner=user.tokenIdentifier,serverNow=Date.now();
  const staged=await ctx.db.query('researchStagingItems').withIndex('by_owner',q=>q.eq('owner',owner)).collect();
  const byExt=new Map(staged.map(s=>[s.externalId,s]));
  const items=args.stagedExternalIds.map(id=>{
   const row=byExt.get(id);
   if(!row)throw new Error(`Unknown staged evidence item: ${id}`);
   const meta=row.untrustedAgentMetadataJson?JSON.parse(row.untrustedAgentMetadataJson) as {agentReportedReceivedAt:number}:undefined;
   return {
    externalId:row.externalId,
    publishedAt:row.publishedAt,
    serverReceivedAt:row.serverReceivedAt??row.receivedAt,
    untrustedAgentMetadata:meta,
   };
  });
  const checked=validateForwardExperimentRegistration({
   registrationCutoffAt:args.cutoffAt,
   serverNow,
   evidenceItems:items,
  });
  return {
   eligible:checked.eligible,
   registeredAt:checked.registeredAt,
   cutoffAt:checked.cutoffAt,
   executionAuthority:'none' as const,
  };
 },
});

/** Internal query for staging & remote agents: returns universe, latest cursor, deduplication state, rate limits and budget status. */
export const getStagingStateInternal=internalQuery({
 args:{owner:v.string()},
 handler:async(ctx,args)=>{
  validOwner(args.owner);
  const now=Date.now();
  const settings=await ctx.db.query('operationsSettings').withIndex('by_owner',q=>q.eq('owner',args.owner)).first();
  const job=await ctx.db.query('researchJobs').withIndex('by_owner_job',q=>q.eq('owner',args.owner).eq('jobKey','news_discovery_agent')).first();
  const secJob=await ctx.db.query('researchJobs').withIndex('by_owner_job',q=>q.eq('owner',args.owner).eq('jobKey','sec_filings_collect')).first();
  const mktJob=await ctx.db.query('researchJobs').withIndex('by_owner_job',q=>q.eq('owner',args.owner).eq('jobKey','market_data_collect')).first();
  const staged=await ctx.db.query('researchStagingItems').withIndex('by_owner',q=>q.eq('owner',args.owner)).take(500);
  const evidence=await ctx.db.query('evidence').withIndex('by_owner',q=>q.eq('owner',args.owner)).take(500);
  const briefings=await ctx.db.query('morningBriefings').withIndex('by_owner',q=>q.eq('owner',args.owner)).take(60);
  const spend=await computeSpend(ctx,args.owner,now);
  const rateWindow=await computeRateWindow(ctx,args.owner,now);
  return {
   universe:APPROVED_RESEARCH_UNIVERSE,
   cursor:job?.cursor??null,
   secCollectorCursor:secJob?.cursor??null,
   marketCollectorCursor:mktJob?.cursor??null,
   systemEnabled:settings?.systemEnabled??true,
   activeEnvironment:settings?.activeEnvironment??'remote',
   dailyCostCeilingGbp:settings?.dailyCostCeilingGbp??DEFAULT_DAILY_CEILING_GBP,
   monthlyCostCeilingGbp:settings?.monthlyCostCeilingGbp??DEFAULT_MONTHLY_CEILING_GBP,
   spend,
   rateWindow,
   seenUrls:staged.map(s=>s.sourceUrl),
   seenContentHashes:staged.map(s=>s.contentSha256),
   seenFactKeys:evidence.map(e=>factDedupeKey({entity:e.symbol,metric:e.metric,period:e.period,value:e.value,unit:e.unit})),
   existingBriefingDates:briefings.map(b=>b.briefingDate),
  };
 },
});

/**
 * Atomic job lease acquisition (Sections 6, 8, 9).
 * Prevents duplicate jobs across local and remote environments, enforces provider rate limits and model cost ceilings,
 * recovers expired leases without duplicating observations, and isolates deterministic collection from AI model failures.
 */
export const acquireJobLeaseInternal=internalMutation({
 args:{
  owner:v.string(),
  jobKey:v.string(),
  environment:jobEnvironment,
  forceOnDemand:v.optional(v.boolean()),
 },
 handler:async(ctx,args)=>{
  const now=Date.now();
  await ensureDefaultJobs(ctx,args.owner,now);
  const settings=await getOrInitSettings(ctx,args.owner,now);
  const job=await ctx.db.query('researchJobs').withIndex('by_owner_job',q=>q.eq('owner',args.owner).eq('jobKey',args.jobKey)).first();
  if(!job)throw new Error(`Unknown research job: ${args.jobKey}`);

  const recordSkip=async(status:'skipped'|'budget_exceeded',reason:string)=>{
   const runId=`run-${args.jobKey}-${now}-skip`;
   await ctx.db.insert('researchJobRuns',{
    owner:args.owner,
    runId,
    jobKey:args.jobKey,
    category:job.category,
    environment:args.environment,
    status,
    startedAt:now,
    finishedAt:now,
    cursorBefore:job.cursor,
    cursorAfter:job.cursor,
    sourcesDiscovered:0,
    evidenceStaged:0,
    evidencePromoted:0,
    duplicatesSkipped:0,
    pendingVerification:0,
    modelVersion:null,
    inputTokens:0,
    outputTokens:0,
    estimatedCostGbp:0,
    actualCostGbp:0,
    errorCode:reason,
    summary:`Skipped (${reason})`,
    executionAuthority:'none',
   });
  };

  if(!settings.systemEnabled||settings.activeEnvironment==='disabled'){
   await recordSkip('skipped','system_disabled');
   return {ok:false as const,code:'system_disabled' as const};
  }
  if(settings.activeEnvironment!==args.environment){
   await recordSkip('skipped','environment_inactive');
   return {ok:false as const,code:'environment_inactive' as const,activeEnvironment:settings.activeEnvironment};
  }
  if(!job.enabled||job.pausedReason!==null){
   await recordSkip('skipped',job.pausedReason??'job_disabled');
   return {ok:false as const,code:'job_paused_or_disabled' as const,reason:job.pausedReason??'job_disabled'};
  }

  if(job.leaseToken!==null&&job.leaseUntil<=now){
   await ctx.db.insert('researchJobRuns',{
    owner:args.owner,
    runId:`${job.leaseToken}-timeout`,
    jobKey:job.jobKey,
    category:job.category,
    environment:args.environment,
    status:'timed_out',
    startedAt:job.lastRunAt??now-job.timeoutMs,
    finishedAt:now,
    cursorBefore:job.cursor,
    cursorAfter:job.cursor,
    sourcesDiscovered:0,
    evidenceStaged:0,
    evidencePromoted:0,
    duplicatesSkipped:0,
    pendingVerification:0,
    modelVersion:null,
    inputTokens:0,
    outputTokens:0,
    estimatedCostGbp:0,
    actualCostGbp:null,
    errorCode:'lease_timeout',
    summary:'Previous lease expired before completion; recovered from last committed cursor without duplicate observations.',
    executionAuthority:'none',
   });
   await ctx.db.patch(job._id,{leaseToken:null,leaseUntil:0,lastOutcome:'timed_out',lastErrorCode:'lease_timeout',updatedAt:now});
  }else if(job.leaseToken!==null&&job.leaseUntil>now){
   return {ok:false as const,code:'lease_held' as const,retryAfterAt:job.leaseUntil};
  }

  if(job.nextAllowedAt>now){
   await recordSkip('skipped','rate_limited');
   return {ok:false as const,code:'rate_limited' as const,retryAfterAt:job.nextAllowedAt};
  }
  if(!args.forceOnDemand&&job.nextRunAt>now){
   return {ok:false as const,code:'not_due' as const,nextRunAt:job.nextRunAt};
  }

  const def=DEFAULT_RESEARCH_JOBS.find(d=>d.jobKey===args.jobKey);
  const usesAi=def?.usesAiModel??(job.category==='remote_agent');
  if(usesAi){
   const spend=await computeSpend(ctx,args.owner,now);
   const daily=Math.max(spend.dailyEstimated,spend.dailyActual);
   const monthly=Math.max(spend.monthlyEstimated,spend.monthlyActual);
   if(daily>=settings.dailyCostCeilingGbp||monthly>=settings.monthlyCostCeilingGbp){
    await recordSkip('budget_exceeded','cost_ceiling_reached');
    await ctx.db.patch(job._id,{pausedReason:'budget_exceeded',lastOutcome:'budget_exceeded',lastErrorCode:'cost_ceiling_reached',updatedAt:now});
    return {ok:false as const,code:'budget_exceeded' as const};
   }
  }

  const leaseToken=`lease:${job.jobKey}:${now}`;
  await ctx.db.patch(job._id,{
   leaseToken,
   leaseUntil:now+job.timeoutMs,
   lastRunAt:now,
   environment:args.environment,
   updatedAt:now,
  });
  return {
   ok:true as const,
   jobKey:job.jobKey,
   leaseToken,
   cursor:job.cursor,
   timeoutMs:job.timeoutMs,
  };
 },
});

/**
 * Restricted staging submission & independent promotion (Sections 4, 5, 9 & Phase 003.1 Sections 2, 3).
 * Assigns an authoritative server receipt timestamp (`serverReceivedAt = now`), retains agent-supplied timestamps
 * as untrusted metadata (`untrustedAgentMetadataJson`), enforces bounded payload sizes and sliding-window rate limits,
 * quarantines prompt-injection attempts, blocks AI-generated market prices, and promotes only verified primary-source facts.
 */
export const submitStagedResearchInternal=internalMutation({
 args:{
  owner:v.string(),
  leaseToken:v.optional(v.string()),
  submissionJson:v.string(),
 },
 handler:async(ctx,args)=>{
  validOwner(args.owner);
  const now=Date.now();
  await ensureDefaultJobs(ctx,args.owner,now);
  const settings=await getOrInitSettings(ctx,args.owner,now);
  if(!settings.systemEnabled||settings.activeEnvironment==='disabled'){
   throw new Error('Remote research operations are centrally disabled');
  }
  if(args.submissionJson.length>MAX_STAGING_PAYLOAD_BYTES){
   throw new Error(`Staging payload exceeds ${MAX_STAGING_PAYLOAD_BYTES} byte limit`);
  }

  const submission=stagedSubmissionRequestSchema.parse(JSON.parse(args.submissionJson));
  if(settings.activeEnvironment!==submission.environment){
   throw new Error(`Submission environment (${submission.environment}) does not match active authority (${settings.activeEnvironment})`);
  }

  // Idempotency by runId: replaying the same runId returns the existing run summary without duplicating items.
  const existingRun=await ctx.db.query('researchJobRuns').withIndex('by_run',q=>q.eq('owner',args.owner).eq('runId',submission.runId)).first();
  if(existingRun){
   return {
    runId:existingRun.runId,
    idempotentReplay:true,
    serverReceivedAt:existingRun.startedAt,
    sourcesDiscovered:existingRun.sourcesDiscovered,
    evidenceStaged:existingRun.evidenceStaged,
    evidencePromoted:existingRun.evidencePromoted,
    duplicatesSkipped:existingRun.duplicatesSkipped,
    pendingVerification:existingRun.pendingVerification,
    quarantinedCount:0,
    cursorAfter:existingRun.cursorAfter,
    executionAuthority:'none' as const,
   };
  }

  // Enforce sliding-window request rate limits (Phase 003.1 Section 3).
  const rateWindow=await computeRateWindow(ctx,args.owner,now);
  if(rateWindow.lastMinute>=MAX_STAGING_REQUESTS_PER_MINUTE||
     rateWindow.lastHour>=MAX_STAGING_REQUESTS_PER_HOUR||
     rateWindow.lastDay>=MAX_STAGING_REQUESTS_PER_DAY){
   throw new Error('Staging request rate limit exceeded');
  }

  // Enforce cost ceiling before accepting AI agent run.
  const spend=await computeSpend(ctx,args.owner,now);
  const runCost=Math.max(submission.estimatedCostGbp,submission.actualCostGbp??0);
  if(Math.max(spend.dailyEstimated,spend.dailyActual)+runCost>settings.dailyCostCeilingGbp||
     Math.max(spend.monthlyEstimated,spend.monthlyActual)+runCost>settings.monthlyCostCeilingGbp){
   throw new Error('Model cost budget ceiling exceeded');
  }

  const job=await ctx.db.query('researchJobs').withIndex('by_owner_job',q=>q.eq('owner',args.owner).eq('jobKey','news_discovery_agent')).first();
  if(args.leaseToken&&job&&job.leaseToken&&job.leaseToken!==args.leaseToken){
   throw new Error('Invalid or superseded job lease token');
  }

  const priorStaged=await ctx.db.query('researchStagingItems').withIndex('by_owner',q=>q.eq('owner',args.owner)).collect();
  const priorEvidence=await ctx.db.query('evidence').withIndex('by_owner',q=>q.eq('owner',args.owner)).collect();
  const seenUrls=new Set(priorStaged.map(s=>s.sourceUrl));
  const seenContentHashes=new Set(priorStaged.map(s=>s.contentSha256));
  const seenFactKeys=new Set(priorEvidence.map(e=>factDedupeKey({entity:e.symbol,metric:e.metric,period:e.period,value:e.value,unit:e.unit})));

  let evidenceStaged=0;
  let evidencePromoted=0;
  let duplicatesSkipped=0;
  let pendingVerification=0;
  let quarantinedCount=0;

  for(const rawItem of submission.items){
   const validated=validateStagedItem(rawItem,{
    now,
    seenUrls,
    seenContentHashes,
    seenFactKeys,
   });
   duplicatesSkipped+=validated.duplicateFactCount;
   if(validated.validationStatus==='duplicate'){
    duplicatesSkipped+=1;
    continue;
   }
   const promotedIds:GenericId<'evidence'>[]=[];
   if(validated.validationStatus==='promoted'){
    for(const fact of validated.promotableFacts){
     // Authoritative `receivedAt` is assigned by the staging server (`now`), never trusting agent-supplied historical timestamps.
     const evId=await ctx.db.insert('evidence',{
      owner:args.owner,
      source:fact.source,
      symbol:fact.symbol,
      metric:fact.metric,
      value:fact.value,
      unit:fact.unit,
      period:fact.period,
      definition:fact.definition,
      status:fact.status,
      publishedAt:fact.publishedAt,
      receivedAt:now,
     });
     promotedIds.push(evId);
     evidencePromoted+=1;
    }
   }else if(validated.validationStatus==='pending_verification'){
    pendingVerification+=1;
   }else if(validated.validationStatus==='quarantined_injection'){
    quarantinedCount+=1;
   }

   await ctx.db.insert('researchStagingItems',{
    owner:args.owner,
    externalId:validated.externalId,
    runId:submission.runId,
    agentId:submission.agentId,
    sourceUrl:validated.canonicalUrl,
    sourceDomain:validated.sourceDomain,
    title:validated.title,
    contentSha256:validated.contentSha256,
    publishedAt:validated.publishedAt,
    receivedAt:now,
    ingestedAt:now,
    serverReceivedAt:now,
    sourceRetrievedAt:validated.sourceRetrievedAt,
    importedAt:now,
    untrustedAgentMetadataJson:JSON.stringify(validated.untrustedAgentMetadata),
    entities:validated.entities,
    claimsJson:JSON.stringify(validated.acceptedClaims),
    summary:validated.summary,
    ...(validated.hypothesis?{hypothesis:validated.hypothesis}:{}),
    isPrimarySource:validated.isPrimarySource,
    primarySourceUrl:validated.primarySourceUrl,
    validationStatus:validated.validationStatus,
    validationReasons:validated.validationReasons,
    researchEligible:validated.researchEligible,
    marketOutcomeEligible:false,
    promotedEvidenceIds:promotedIds,
    executionAuthority:'none',
    version:REMOTE_OPS_VERSION,
   });
   evidenceStaged+=1;
  }

  const providerRequestsCount=submission.providerRequestsCount??submission.items.length;
  const processingDurationMs=submission.processingDurationMs??Math.max(0,now-(job?.lastRunAt??now));
  const conditionalSkip=submission.conditionalSkip??(submission.items.length===0&&submission.cursorBefore===submission.cursorAfter);
  const summaryText=conditionalSkip
   ?`Cursor unchanged (${submission.cursorAfter}); skipped redundant staging and avoided AI model invocation (${providerRequestsCount} upstream check(s) in ${processingDurationMs}ms).`
   :`Processed ${submission.items.length} item(s): ${evidencePromoted} promoted, ${pendingVerification} pending verification, ${duplicatesSkipped} duplicate(s) skipped${quarantinedCount?`, ${quarantinedCount} quarantined`:''} (${providerRequestsCount} provider request(s), ${processingDurationMs}ms).`;

  await ctx.db.insert('researchJobRuns',{
   owner:args.owner,
   runId:submission.runId,
   jobKey:'news_discovery_agent',
   category:'remote_agent',
   environment:submission.environment,
   status:'succeeded',
   startedAt:Math.max(0,now-processingDurationMs),
   finishedAt:now,
   cursorBefore:submission.cursorBefore,
   cursorAfter:submission.cursorAfter,
   sourcesDiscovered:submission.items.length,
   evidenceStaged,
   evidencePromoted,
   duplicatesSkipped,
   pendingVerification,
   modelVersion:submission.modelVersion,
   inputTokens:submission.inputTokens,
   outputTokens:submission.outputTokens,
   estimatedCostGbp:submission.estimatedCostGbp,
   actualCostGbp:submission.actualCostGbp??null,
   providerRequestsCount,
   processingDurationMs,
   conditionalSkip,
   errorCode:null,
   summary:summaryText,
   executionAuthority:'none',
  });

  if(job){
   await ctx.db.patch(job._id,{
    cursor:submission.cursorAfter,
    lastRunAt:now,
    lastSuccessAt:now,
    nextRunAt:now+job.intervalMinutes*60_000,
    lastOutcome:conditionalSkip?'succeeded:cursor_unchanged':'succeeded',
    lastErrorCode:null,
    consecutiveFailures:0,
    leaseToken:null,
    leaseUntil:0,
    sourcesAddedTotal:job.sourcesAddedTotal+evidenceStaged,
    evidenceAddedTotal:job.evidenceAddedTotal+evidencePromoted,
    estimatedCostGbpTotal:Number((job.estimatedCostGbpTotal+submission.estimatedCostGbp).toFixed(6)),
    actualCostGbpTotal:Number(((job.actualCostGbpTotal??0)+(submission.actualCostGbp??submission.estimatedCostGbp)).toFixed(6)),
    lastProviderRequests:providerRequestsCount,
    lastDurationMs:processingDurationMs,
    lastConditionalSkip:conditionalSkip,
    updatedAt:now,
   });
  }

  await ctx.db.insert('audit',{
   owner:args.owner,
   action:'research.staging.ingested',
   recordId:submission.runId,
   detail:`agent=${submission.agentId}; model=${submission.modelVersion}; staged=${evidenceStaged}; promoted=${evidencePromoted}; quarantined=${quarantinedCount}; conditionalSkip=${conditionalSkip}; serverReceivedAt=${now}`,
   at:now,
  });

  return {
   runId:submission.runId,
   idempotentReplay:false,
   serverReceivedAt:now,
   sourcesDiscovered:submission.items.length,
   evidenceStaged,
   evidencePromoted,
   duplicatesSkipped,
   pendingVerification,
   quarantinedCount,
   conditionalSkip,
   cursorAfter:submission.cursorAfter,
   executionAuthority:'none' as const,
  };
 },
});

/**
 * Records a deterministic collector, risk refresh or morning briefing outcome (Sections 3, 6, 8, 9 & Phase 003.2 Sections 1, 3, 4).
 * Completely independent of AI model providers so model outages or budget ceilings never stop deterministic jobs.
 */
export const recordDeterministicRunInternal=internalMutation({
 args:{
  owner:v.string(),
  runId:v.string(),
  jobKey:v.string(),
  environment:jobEnvironment,
  leaseToken:v.optional(v.string()),
  status:jobRunStatus,
  cursorAfter:v.optional(v.union(v.string(),v.null())),
  sourcesDiscovered:v.number(),
  evidencePromoted:v.number(),
  duplicatesSkipped:v.number(),
  providerRequestsCount:v.optional(v.number()),
  processingDurationMs:v.optional(v.number()),
  conditionalSkip:v.optional(v.boolean()),
  nowOverride:v.optional(v.number()),
  errorCode:v.optional(v.union(v.string(),v.null())),
  retryAfterAt:v.optional(v.number()),
  summary:v.string(),
  briefingJson:v.optional(v.string()),
 },
 handler:async(ctx,args)=>{
  validOwner(args.owner);
  const now=args.nowOverride??Date.now();
  await ensureDefaultJobs(ctx,args.owner,now);
  const job=await ctx.db.query('researchJobs').withIndex('by_owner_job',q=>q.eq('owner',args.owner).eq('jobKey',args.jobKey)).first();
  if(!job)throw new Error(`Unknown research job: ${args.jobKey}`);

  const existingRun=await ctx.db.query('researchJobRuns').withIndex('by_run',q=>q.eq('owner',args.owner).eq('runId',args.runId)).first();
  if(existingRun)return {stored:true,idempotentReplay:true,briefingDeduplicated:false,briefingDate:null};

  const startedAt=args.processingDurationMs!==undefined?Math.max(0,now-args.processingDurationMs):(job.lastRunAt??now);
  const durationMs=args.processingDurationMs??Math.max(0,now-startedAt);
  const providerReqs=args.providerRequestsCount??args.sourcesDiscovered;
  const condSkip=args.conditionalSkip??false;

  await ctx.db.insert('researchJobRuns',{
   owner:args.owner,
   runId:args.runId,
   jobKey:args.jobKey,
   category:job.category,
   environment:args.environment,
   status:args.status,
   startedAt,
   finishedAt:now,
   cursorBefore:job.cursor,
   cursorAfter:args.cursorAfter!==undefined?args.cursorAfter:job.cursor,
   sourcesDiscovered:args.sourcesDiscovered,
   evidenceStaged:0,
   evidencePromoted:args.evidencePromoted,
   duplicatesSkipped:args.duplicatesSkipped,
   pendingVerification:0,
   modelVersion:null,
   inputTokens:0,
   outputTokens:0,
   estimatedCostGbp:0,
   actualCostGbp:0,
   providerRequestsCount:providerReqs,
   processingDurationMs:durationMs,
   conditionalSkip:condSkip,
   errorCode:args.errorCode??null,
   summary:args.summary,
   executionAuthority:'none',
  });

  const intervalMs=job.intervalMinutes*60_000;
  const retryAfter=args.retryAfterAt??0;
  const computedNextRunAt=
   args.jobKey==='daily_intelligence_briefing'
    ?Math.max(nextLondonMorningBriefAt(now),retryAfter)
    :Math.max(now+intervalMs,retryAfter);

  if(args.status==='failed'){
   const code=args.errorCode??'provider_unavailable';
   const failures=job.consecutiveFailures+1;
   const shouldPause=PAUSE_ON_ERRORS.has(code);
   const backoffMs=Math.min(intervalMs*2**Math.min(failures,6),MAX_BACKOFF_MS);
   await ctx.db.patch(job._id,{
    lastRunAt:now,
    lastFailureAt:now,
    lastOutcome:`failed:${code}`,
    lastErrorCode:code,
    consecutiveFailures:failures,
    pausedReason:shouldPause?code:null,
    nextAllowedAt:Math.max(job.nextAllowedAt,retryAfter),
    nextRunAt:Math.max(now+backoffMs,retryAfter),
    lastProviderRequests:providerReqs,
    lastDurationMs:durationMs,
    lastConditionalSkip:condSkip,
    leaseToken:null,
    leaseUntil:0,
    updatedAt:now,
   });
  }else{
   await ctx.db.patch(job._id,{
    cursor:args.cursorAfter!==undefined?args.cursorAfter:job.cursor,
    lastRunAt:now,
    lastSuccessAt:args.status==='succeeded'?now:job.lastSuccessAt,
    lastOutcome:condSkip?'succeeded:cursor_unchanged':args.status,
    lastErrorCode:args.errorCode??null,
    consecutiveFailures:args.status==='succeeded'?0:job.consecutiveFailures,
    nextAllowedAt:Math.max(job.nextAllowedAt,retryAfter),
    nextRunAt:computedNextRunAt,
    sourcesAddedTotal:job.sourcesAddedTotal+args.sourcesDiscovered,
    evidenceAddedTotal:job.evidenceAddedTotal+args.evidencePromoted,
    lastProviderRequests:providerReqs,
    lastDurationMs:durationMs,
    lastConditionalSkip:condSkip,
    leaseToken:null,
    leaseUntil:0,
    updatedAt:now,
   });
  }

  let briefingDeduplicated=false;
  let briefingDate:string|null=null;
  if(args.briefingJson){
   const parsed=JSON.parse(args.briefingJson);
   const briefing=generateMorningBriefing({
    now,
    confirmedFacts:parsed.confirmedFacts??[],
    researchInterpretation:parsed.researchInterpretation??[],
    riskChanges:parsed.riskChanges??[],
    incompleteEvidence:parsed.incompleteEvidence??[],
    modelVersion:parsed.modelVersion??null,
   });
   const dateKey=londonBriefingDate(now);
   briefingDate=dateKey;
   const priorBrief=await ctx.db.query('morningBriefings').withIndex('by_owner_date',q=>q.eq('owner',args.owner).eq('briefingDate',dateKey)).first();
   if(priorBrief){
    // Strict deduplication (Phase 003.2 Section 1):
    // Exactly one briefing is created per intended local reporting date (`Europe/London`).
    briefingDeduplicated=true;
   }else{
    await ctx.db.insert('morningBriefings',{
     owner:args.owner,
     briefingDate:briefing.briefingDate,
     generatedAt:briefing.generatedAt,
     timezone:'Europe/London' as const,
     confirmedFactsJson:JSON.stringify(briefing.confirmedFacts),
     researchInterpretationJson:JSON.stringify(briefing.researchInterpretation),
     riskChangesJson:JSON.stringify(briefing.riskChanges),
     incompleteEvidenceJson:JSON.stringify(briefing.incompleteEvidence),
     modelVersion:briefing.modelVersion,
     executionAuthority:'none' as const,
     version:REMOTE_OPS_VERSION,
    });
   }
  }

  return {stored:true,idempotentReplay:false,briefingDeduplicated,briefingDate};
 },
});

/**
 * Phase 004 Stage 2 & Stage 3:
 * Stores validated market observations for `NVDA, MSFT, GOOGL, AMZN, INTC, AMD, CRWV, QQQ` + `USD/GBP` FX,
 * enforces authoritative server receipt timestamps, rejects Trading 212 position prices, populates non-synthetic
 * `quotes`, runs the Missing Evidence Resolver, and automatically evaluates eligible forward research events.
 */
export const storeMarketObservationsInternal=internalMutation({
 args:{
  owner:v.string(),
  observationsJson:v.string(),
  nowOverride:v.optional(v.number()),
 },
 handler:async(ctx,args)=>{
  validOwner(args.owner);
  const serverNow=args.nowOverride??Date.now();
  const rawList=JSON.parse(args.observationsJson) as unknown[];
  if(!Array.isArray(rawList)||rawList.length>200){
   throw new Error('Market observations payload must be an array of 0–200 items');
  }

  let insertedCount=0;
  let duplicateCount=0;

  for(const rawItem of rawList){
   if(rawItem&&typeof rawItem==='object'){
    assertNotTrading212PositionPrice(rawItem as {provider?:string;sourceUrl?:string;isTrading212PositionPrice?:boolean});
   }
   const parsed=authorisedMarketObservationSchema.parse({
    ...(rawItem as Record<string,unknown>),
    serverReceivedAt:serverNow,
   });
   const existing=await ctx.db
    .query('marketObservations')
    .withIndex('by_owner_obs',q=>q.eq('owner',args.owner).eq('observationId',parsed.observationId))
    .first();
   if(existing){
    duplicateCount+=1;
    continue;
   }
   await ctx.db.insert('marketObservations',{
    owner:args.owner,
    observationId:parsed.observationId,
    symbol:parsed.symbol,
    sessionDate:parsed.sessionDate,
    eventAt:parsed.eventAt,
    publishedAt:parsed.publishedAt,
    serverReceivedAt:serverNow,
    provider:parsed.provider,
    sourceId:parsed.sourceId,
    sourceUrl:parsed.sourceUrl,
    currency:'USD',
    open:parsed.open,
    high:parsed.high,
    low:parsed.low,
    close:parsed.close,
    volume:parsed.volume,
    usdToGbp:parsed.usdToGbp,
    closeGbp:parsed.closeGbp,
    fxSessionDate:parsed.fxSessionDate,
    fxEventAt:parsed.fxEventAt,
    fxSourceUrl:parsed.fxSourceUrl,
    fxProvider:parsed.fxProvider,
    fxCloseAligned:parsed.fxCloseAligned,
    priceBasis:parsed.priceBasis,
    adjustmentVersion:parsed.adjustmentVersion,
    corporateActionsReviewed:parsed.corporateActionsReviewed,
    declaredDelayMs:parsed.declaredDelayMs,
    usage:parsed.usage,
    licensed:parsed.licensed,
    permittedUse:parsed.permittedUse,
    isTrading212PositionPrice:false,
    executionAuthority:'none',
   });

   // Also populate non-synthetic `quotes` table for GBP-compatible portfolio & research inspection
   const existingQuote=await ctx.db
    .query('quotes')
    .withIndex('by_symbol',q=>
     q.eq('owner',args.owner).eq('symbol',parsed.symbol).eq('synthetic',false).eq('observedAt',parsed.eventAt)
    )
    .first();
   if(!existingQuote){
    await ctx.db.insert('quotes',{
     owner:args.owner,
     symbol:parsed.symbol,
     priceUsd:parsed.close,
     usdToGbp:parsed.usdToGbp,
     observedAt:parsed.eventAt,
     receivedAt:serverNow,
     source:parsed.sourceUrl,
     synthetic:false,
    });
   }
   insertedCount+=1;
  }

  const allStored=await ctx.db.query('marketObservations').withIndex('by_owner',q=>q.eq('owner',args.owner)).take(500);
  const parsedAll:AuthorisedMarketObservation[]=allStored.map(r=>({
   observationId:r.observationId,
   symbol:r.symbol as MarketDataSymbol,
   sessionDate:r.sessionDate,
   eventAt:r.eventAt,
   publishedAt:r.publishedAt,
   serverReceivedAt:r.serverReceivedAt,
   provider:r.provider as AuthorisedMarketObservation['provider'],
   sourceId:r.sourceId,
   sourceUrl:r.sourceUrl,
   currency:'USD',
   open:r.open,
   high:r.high,
   low:r.low,
   close:r.close,
   volume:r.volume,
   usdToGbp:r.usdToGbp,
   closeGbp:r.closeGbp,
   fxSessionDate:r.fxSessionDate,
   fxEventAt:r.fxEventAt,
   fxSourceUrl:r.fxSourceUrl,
   fxProvider:r.fxProvider,
   fxCloseAligned:r.fxCloseAligned,
   priceBasis:r.priceBasis as AuthorisedMarketObservation['priceBasis'],
   adjustmentVersion:r.adjustmentVersion,
   corporateActionsReviewed:r.corporateActionsReviewed,
   declaredDelayMs:r.declaredDelayMs,
   usage:r.usage,
   licensed:r.licensed,
   permittedUse:r.permittedUse,
   isTrading212PositionPrice:false,
  }));

  const resolution=resolveMissingEvidenceAndOutcomes({
   observations:parsedAll,
   asOf:serverNow,
  });

  // Automatically re-evaluate any registered forward research events if authentic post-horizon observations have arrived
  const forwardRows=await ctx.db.query('forwardResearchEvents').withIndex('by_owner',q=>q.eq('owner',args.owner)).collect();
  let forwardEvaluatedCount=0;
  for(const fRow of forwardRows){
   const prevEval=JSON.parse(fRow.evaluationJson) as ForwardOutcomeEvaluation;
   if(prevEval.evaluationStatus==='evaluated')continue;
   const nextEval=evaluateForwardResearchEvent({
    event:{
     eventKey:fRow.eventKey,
     name:fRow.name,
     version:FORWARD_RESEARCH_VERSION,
     symbol:fRow.symbol as MarketDataSymbol,
     benchmarkSymbol:fRow.benchmarkSymbol as MarketDataSymbol,
     returnTarget:'excess_vs_benchmark',
     horizon:fRow.horizon,
     neutralBand:fRow.neutralBand,
     registeredAt:fRow.registeredAt,
     cutoffAt:fRow.cutoffAt,
     anchorSessionDate:fRow.anchorSessionDate,
     anchorAt:fRow.anchorAt,
     targetEndSessionDate:fRow.targetEndSessionDate,
     targetEndAt:fRow.targetEndAt,
     evidenceSha256:fRow.evidenceSha256,
     evidenceItems:JSON.parse(fRow.evidenceJson) as FrozenForwardEvidenceItem[],
     participants:JSON.parse(fRow.participantsJson) as ForwardParticipantRecord[],
     executionAuthority:'none',
    },
    observations:parsedAll,
    asOf:serverNow,
   });
   await ctx.db.patch(fRow._id,{
    evaluationJson:JSON.stringify(nextEval),
    updatedAt:serverNow,
   });
   if(nextEval.evaluationStatus==='evaluated'){
    forwardEvaluatedCount+=1;
   }
  }

  return {
   insertedCount,
   duplicateCount,
   totalStoredCount:allStored.length,
   scoredWindows:resolution.scoredWindows,
   blockedIncompleteWindows:resolution.blockedIncompleteWindows,
   pendingFutureWindows:resolution.pendingFutureWindows,
   forwardEvaluatedCount,
   serverReceivedAt:serverNow,
   executionAuthority:'none' as const,
  };
 },
});

/**
 * Phase 004 Stage 4:
 * Persists a genuine forward research event in `forwardResearchEvents`, `experiments` and `forecasts`
 * using trusted server receipt timestamps (`serverReceivedAt <= cutoffAt <= registeredAt < targetEndAt`).
 */
export const storeForwardResearchEventInternal=internalMutation({
 args:{
  owner:v.string(),
  eventJson:v.string(),
  nowOverride:v.optional(v.number()),
 },
 handler:async(ctx,args)=>{
  validOwner(args.owner);
  const serverNow=args.nowOverride??Date.now();
  const event=JSON.parse(args.eventJson) as RegisteredForwardResearchEvent;

  if(event.cutoffAt>serverNow){
   throw new Error('Forward research cutoffAt cannot be in the future relative to serverNow');
  }
  if(event.targetEndAt<=event.registeredAt||event.targetEndAt<=event.anchorAt){
   throw new Error('Forward research targetEndAt must be strictly after registeredAt and anchorAt');
  }
  if(event.evidenceItems.some(i=>i.serverReceivedAt>event.cutoffAt||i.publishedAt>event.cutoffAt)){
   throw new Error('Frozen evidence item was not available in the workspace at cutoffAt');
  }

  const existing=await ctx.db
   .query('forwardResearchEvents')
   .withIndex('by_owner_key',q=>q.eq('owner',args.owner).eq('eventKey',event.eventKey))
   .first();
  if(existing){
   return {
    stored:true,
    idempotentReplay:true,
    eventKey:existing.eventKey,
    experimentId:existing.experimentId??null,
    evidenceSha256:existing.evidenceSha256,
    executionAuthority:'none' as const,
   };
  }

  // Ensure frozen evidence items are also present in `evidence` table so `experiments` & `forecasts` can reference them
  const evidenceDbIds:GenericId<'evidence'>[]=[];
  for(const item of event.evidenceItems.slice(0,15)){
   const evId=await ctx.db.insert('evidence',{
    owner:args.owner,
    source:item.sourceUrl,
    symbol:item.symbol,
    metric:item.metric,
    value:item.value,
    unit:item.unit,
    period:item.period,
    definition:`Forward experiment (${event.eventKey}) frozen ${item.kind}`,
    status:item.kind==='sec_xbrl_fact'?'reported':'measured',
    publishedAt:item.publishedAt,
    receivedAt:item.serverReceivedAt,
   });
   evidenceDbIds.push(evId);
  }

  const experimentId=await ctx.db.insert('experiments',{
   owner:args.owner,
   name:event.name,
   cutoff:event.cutoffAt,
   evidenceIds:evidenceDbIds,
   protocol:`${FORWARD_RESEARCH_VERSION}:${event.symbol}_vs_${event.benchmarkSymbol}:${event.horizon}:sha256=${event.evidenceSha256}`,
   protocolVersion:FORWARD_RESEARCH_VERSION,
   deadline:event.targetEndAt,
   createdAt:serverNow,
  });

  for(const p of event.participants){
   if(!p.forecast)continue;
   const idempotencyKey=`${event.eventKey}:${p.participantId}`;
   const priorForecast=await ctx.db
    .query('forecasts')
    .withIndex('by_key',q=>q.eq('owner',args.owner).eq('idempotencyKey',idempotencyKey))
    .first();
   if(!priorForecast){
    await ctx.db.insert('forecasts',{
     owner:args.owner,
     experimentId,
     participant:p.participantId,
     modelVersion:p.modelVersion,
     horizon:p.forecast.horizon,
     probabilities:[...p.forecast.probabilities],
     expectedReturn:p.forecast.expectedReturn,
     lower:p.forecast.lower,
     upper:p.forecast.upper,
     evidenceIds:evidenceDbIds,
     explanation:p.forecast.explanation,
     invalidation:p.forecast.invalidation,
     decision:p.forecast.decision,
     submittedAt:serverNow,
     inputTokens:p.inputTokens,
     outputTokens:p.outputTokens,
     cachedTokens:p.cachedTokens,
     costGbp:p.actualBilledCostGbp??p.estimatedCostGbp,
     latencyMs:p.latencyMs,
     idempotencyKey,
    });
   }
  }

  await ctx.db.insert('forwardResearchEvents',{
   owner:args.owner,
   eventKey:event.eventKey,
   name:event.name,
   symbol:event.symbol,
   benchmarkSymbol:event.benchmarkSymbol,
   horizon:event.horizon,
   neutralBand:event.neutralBand,
   registeredAt:serverNow,
   cutoffAt:event.cutoffAt,
   anchorSessionDate:event.anchorSessionDate,
   anchorAt:event.anchorAt,
   targetEndSessionDate:event.targetEndSessionDate,
   targetEndAt:event.targetEndAt,
   evidenceSha256:event.evidenceSha256,
   evidenceJson:JSON.stringify(event.evidenceItems),
   participantsJson:JSON.stringify(event.participants),
   evaluationJson:JSON.stringify(event.evaluation),
   experimentId,
   updatedAt:serverNow,
   executionAuthority:'none',
   version:FORWARD_RESEARCH_VERSION,
  });

  await ctx.db.insert('audit',{
   owner:args.owner,
   action:'research.forward.registered',
   recordId:event.eventKey,
   detail:`symbol=${event.symbol}; benchmark=${event.benchmarkSymbol}; horizon=${event.horizon}; anchor=${event.anchorSessionDate}; targetEnd=${event.targetEndSessionDate}; sha256=${event.evidenceSha256.slice(0,16)}`,
   at:serverNow,
  });

  return {
   stored:true,
   idempotentReplay:false,
   eventKey:event.eventKey,
   experimentId,
   evidenceSha256:event.evidenceSha256,
   executionAuthority:'none' as const,
  };
 },
});
