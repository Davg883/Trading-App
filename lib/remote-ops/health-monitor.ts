import {z} from 'zod';
import {DEFAULT_RESEARCH_JOBS,type JobCategory,type JobEnvironment} from './contracts';
import {getLondonTimeParts} from './morning-briefing';

/**
 * Market-data collection & agent operations health monitor (Deliverable 5, Sections 3, 7, 8, 9).
 *
 * Guarantees:
 * 1. Delayed or unlicensed prices cannot be presented as live quotes.
 * 2. Expired or revoked provider credentials trigger immediate high-priority alerts.
 * 3. Model failures or AI cost-budget exhaustion never halt deterministic market-data collection.
 * 4. Freshness is computed against each job's configured interval and exchange session window.
 */

export const priceObservationPresentationSchema=z.object({
 symbol:z.string().min(1).max(20),
 price:z.number().finite().positive(),
 currency:z.string().regex(/^[A-Z]{3}$/),
 eventAt:z.number().finite().nonnegative(),
 receivedAt:z.number().finite().nonnegative(),
 declaredDelayMs:z.number().finite().nonnegative(),
 licensedForLiveQuotes:z.boolean(),
 licensedForExecution:z.boolean(),
 presentedAsLiveQuote:z.boolean(),
 source:z.string().min(1),
}).strict();
export type PriceObservationPresentation=z.infer<typeof priceObservationPresentationSchema>;

export function validatePricePresentation(obs:PriceObservationPresentation,now:number){
 const parsed=priceObservationPresentationSchema.parse(obs);
 if(parsed.receivedAt>now)throw new Error('Future receipt timestamp is invalid');
 if(parsed.receivedAt<parsed.eventAt)throw new Error('Receipt timestamp cannot precede observation event time');
 const ageMs=now-parsed.eventAt;
 const isDelayed=parsed.declaredDelayMs>0||!parsed.licensedForLiveQuotes||ageMs>120_000;
 if(parsed.presentedAsLiveQuote&&isDelayed){
  throw new Error(`Delayed or unlicensed price for ${parsed.symbol} cannot be presented as a live quote`);
 }
 return {
  symbol:parsed.symbol,
  price:parsed.price,
  currency:parsed.currency,
  eventAt:parsed.eventAt,
  receivedAt:parsed.receivedAt,
  isDelayed,
  licensedForExecution:parsed.licensedForExecution&&!isDelayed,
  badge:isDelayed?'Delayed reference close (not a live quote)' as const:'Licensed live quote' as const,
  source:parsed.source,
 };
}

export type ProviderCredentialState={
 providerId:string;
 label:string;
 category:'deterministic_collector'|'broker_readonly'|'ai_model';
 status:'connected'|'delayed_public'|'unconfigured'|'credentials_expired'|'rate_limited'|'outage';
 errorCode:string|null;
 lastSuccessAt:number|null;
 nextAllowedAt:number;
 detail:string;
};

export type JobHealthSummary={
 jobKey:string;
 name:string;
 purpose:string;
 category:JobCategory;
 usesAiModel:boolean;
 enabled:boolean;
 environment:JobEnvironment;
 pausedReason:string|null;
 lastSuccessAt:number|null;
 lastFailureAt:number|null;
 lastRunAt:number|null;
 nextRunAt:number;
 freshness:'fresh'|'delayed'|'stale'|'unavailable';
 ageMs:number|null;
 sourcesAdded:number;
 evidenceAdded:number;
 pendingVerification:number;
 estimatedCostGbp:number;
 actualCostGbp:number|null;
 providerRequestsLastRun:number;
 processingDurationMsLastRun:number|null;
 conditionalSkipLastRun:boolean;
 lastOutcome:string|null;
 lastErrorCode:string|null;
 /** Sprint G9.2: newest upstream observation this job has stored (market close, filing publication, briefing generation). */
 latestSourceObservationAt:number|null;
 /** Sprint G9.2: false when the cron gate is disabled, so nextRunAt is not a real scheduled execution. */
 scheduled:boolean;
 /** Sprint G9.2: the stored next run time has passed without a run. */
 nextRunOverdue:boolean;
};

/** Sprint G9.2: honest status of external (non-SEC) financial-news ingestion, separate from SEC filing discovery. */
export type ExternalNewsIngestionStatus={
 status:'NOT_IMPLEMENTED'|'DISABLED'|'HEALTHY';
 label:string;
 detail:string;
};

export type OperationalLayerStatus={
 scheduler:{
  status:'working'|'degraded'|'paused';
  label:string;
  detail:string;
  lastTickAt:number|null;
  /** Sprint G9.2: RESEARCH_SCHEDULER_ENV as configured on the backend ('unset' when not reported). */
  schedulerEnv:'remote'|'local'|'disabled'|'unset';
  /** Sprint G9.2: the cron gate is open but no job has run within the expected tick window. */
  overdue:boolean;
  nextExpectedTickAt:number|null;
 };
 collector:{
  /** Sprint G9.3.1: 'idle' when the cron gate is closed — no collector runs, whatever the last results were. */
  status:'working'|'partial'|'failed'|'idle';
  label:string;
  detail:string;
  healthyJobsCount:number;
  failedJobsCount:number;
 };
 source:{
  status:'available'|'partial'|'unavailable';
  label:string;
  detail:string;
  availableCount:number;
  unavailableCount:number;
 };
 evidence:{
  status:'imported'|'unchanged_cursor'|'none_imported';
  label:string;
  detail:string;
  promotedTotal:number;
  pendingVerification:number;
 };
 briefing:{
  status:'generated'|'awaiting_uk_0730'|'stale'|'missing';
  label:string;
  detail:string;
  ukDate:string;
  ukRegime:'GMT'|'BST';
  generatedAt:number|null;
  /** Sprint G9.2: date of the newest stored briefing (never today's date when none exists). */
  latestBriefingDate:string|null;
 };
};

export type HostedExecutionPathItem={
 id:string;
 label:string;
 deployment:'cloud_hosted'|'local_cli_only'|'undeployed_config'|'unconfigured_provider';
 status:'active'|'standby'|'unavailable';
 detail:string;
};

export type HealthMonitorAlert={
 id:string;
 severity:'alert'|'warn'|'info';
 providerOrJob:string;
 title:string;
 detail:string;
 href:string;
};

export type ProductionConnectionStatus =
 | 'connected'
 | 'configured_not_tested'
 | 'degraded'
 | 'unavailable'
 | 'intentionally_disabled';

export type ProductionEnvironmentServiceAudit = {
 serviceId: string;
 name: string;
 environmentTarget: string;
 status: ProductionConnectionStatus;
 lastVerifiedAt: number | null;
 detail: string;
};

export type GraphProjectionOperationsSummary = {
 databaseName: string;
 productionIsolated: boolean;
 schemaVersion: string;
 lastProjectedSequence: number;
 projectedCount: number;
 pendingCount: number;
 retryingCount: number;
 deadLetterCount: number;
 maxProjectionLagMs: number;
 humanReviewCount: number;
 reconciled: boolean;
 updatedAtMs: number | null;
};

export type OperationRunAuditItem = {
 runId: string;
 jobKey: string;
 category: JobCategory;
 environment: JobEnvironment;
 status: string;
 startedAt: number;
 finishedAt: number | null;
 cursorBefore: string | null;
 cursorAfter: string | null;
 sourcesDiscovered: number;
 evidenceStaged: number;
 evidencePromoted: number;
 duplicatesSkipped: number;
 pendingVerification: number;
 modelVersion: string | null;
 estimatedCostGbp: number;
 actualCostGbp: number | null;
 providerRequestsCount: number;
 processingDurationMs: number | null;
 conditionalSkip: boolean;
 errorCode: string | null;
 summary: string;
};

export type EvidenceChatOperationsSummary = {
 totalTurns: number;
 turnsToday: number;
 supportedCount: number;
 partiallySupportedCount: number;
 unsupportedCount: number;
 validationRejectionCount: number;
 providerErrorCount: number;
 inputTokensTotal: number;
 outputTokensTotal: number;
 dailySpendGbp: number;
 totalSpendGbp: number;
 dailyCeilingGbp: number;
 unsupportedRate: number;
 modelId: string;
 geminiConfigured: boolean;
 geminiEnabled: boolean;
 lastChatAtMs: number | null;
};

export type ModelProviderExecutionState =
 | 'unconfigured'
 | 'disabled'
 | 'not_tested'
 | 'attempted'
 | 'failed'
 | 'successful';

export type AgentAndProviderStageDistinction = {
 collectorRunning: boolean;
 deterministicProcessingCompleted: boolean;
 modelInferenceAttempted: boolean;
 modelInferenceSucceeded: boolean;
 providerUnavailable: boolean;
 providerState: ModelProviderExecutionState;
 researchValidated: boolean;
 briefingPublished: boolean;
 liveAgentInferenceStatus: 'NOT IMPLEMENTED';
 externalNewsFeedCollectionStatus: 'NOT IMPLEMENTED';
 detail: string;
};

export function isNonDeterministicModelRun(run: {
 category?: JobCategory;
 modelVersion?: string | null;
 estimatedCostGbp?: number;
 actualCostGbp?: number | null;
 providerRequestsCount?: number;
 conditionalSkip?: boolean;
 summary?: string | null;
}): boolean {
 if (run.category !== 'remote_agent') return false;
 if (run.conditionalSkip) return false;
 const mv = (run.modelVersion ?? '').trim();
 const mvLower = mv.toLowerCase();
 const summaryLower = (run.summary ?? '').toLowerCase();
 if (
  mvLower.startsWith('deterministic-') ||
  mvLower.startsWith('cursor-change-detector') ||
  mvLower.includes('0 model calls') ||
  mvLower.includes('not implemented') ||
  summaryLower.includes('0 model calls') ||
  summaryLower.includes('not implemented')
 ) {
  return false;
 }
 const hasRealModelId =
  mv.length > 0 &&
  /\b(gemini|gpt|claude|o1|o3|o4|sonnet|opus|haiku|flash|pro)\b/i.test(mv);
 const hasCostSignal =
  (run.estimatedCostGbp ?? 0) > 0 ||
  (run.actualCostGbp !== null && run.actualCostGbp !== undefined && run.actualCostGbp > 0);
 const hasRequestSignal = hasRealModelId && (run.providerRequestsCount ?? 0) > 0;
 return hasCostSignal || hasRequestSignal || hasRealModelId;
}

export type CollectionHealthReport={
 evaluatedAt:number;
 systemEnabled:boolean;
 activeEnvironment:'remote'|'local'|'disabled';
 deterministicCollectionHealthy:boolean;
 aiResearchHealthy:boolean;
 modelFailureIsolated:true;
 pendingVerificationCount:number;
 dailyCostGbp:{estimated:number;actual:number;ceiling:number;exceeded:boolean};
 monthlyCostGbp:{estimated:number;actual:number;ceiling:number;exceeded:boolean};
 operationalLayers:OperationalLayerStatus;
 agentAndProviderStages:AgentAndProviderStageDistinction;
 executionPaths:HostedExecutionPathItem[];
 jobs:JobHealthSummary[];
 providers:ProviderCredentialState[];
 alerts:HealthMonitorAlert[];
 environmentAudit?:ProductionEnvironmentServiceAudit[];
 graphProjection?:GraphProjectionOperationsSummary;
 recentRuns?:OperationRunAuditItem[];
 evidenceChat?:EvidenceChatOperationsSummary;
 externalNewsIngestion:ExternalNewsIngestionStatus;
};

/** Convex cron cadence for the research cycle (convex/crons.ts). */
export const SCHEDULER_TICK_INTERVAL_MS=15*60_000;
/** The scheduler is overdue when no job has run for three cron intervals. */
export const SCHEDULER_OVERDUE_AFTER_MS=3*SCHEDULER_TICK_INTERVAL_MS;

const CREDENTIAL_ERROR_CODES=new Set([
 'credentials_revoked','invalid_credentials','environment_mismatch','missing_permissions','unauthorized','401','403','expired_token',
]);

export function evaluateCollectionHealth(input:{
 now:number;
 systemEnabled:boolean;
 activeEnvironment:'remote'|'local'|'disabled';
 dailyCostCeilingGbp:number;
 monthlyCostCeilingGbp:number;
 dailyEstimatedCostGbp:number;
 dailyActualCostGbp:number;
 monthlyEstimatedCostGbp:number;
 monthlyActualCostGbp:number;
 pendingVerificationCount:number;
 latestBriefingDate?:string|null;
 latestBriefingGeneratedAt?:number|null;
 /** Sprint G9.2: RESEARCH_SCHEDULER_ENV read on the backend. Omitted by legacy callers (treated as 'unset'). */
 schedulerEnv?:'remote'|'local'|'disabled'|'unset';
 /** Sprint G9.2: whether any external (non-SEC) financial-news collector is wired. None is today. */
 externalNewsCollectorImplemented?:boolean;
 /** RC002.1: count of unquarantined invalid SEC/XBRL staging items withheld fail-closed on read before ledger execution. */
 pendingQuarantineCount?:number;
 jobs:Array<{
  jobKey:string;
  name?:string;
  purpose?:string;
  category?:JobCategory;
  environment?:JobEnvironment;
  intervalMinutes:number;
  enabled:boolean;
  pausedReason:string|null;
  lastSuccessAt:number|null;
  lastFailureAt?:number|null;
  lastRunAt:number|null;
  nextRunAt:number;
  sourcesAddedTotal:number;
  evidenceAddedTotal:number;
  estimatedCostGbpTotal:number;
  actualCostGbpTotal:number|null;
  lastProviderRequests?:number;
  lastDurationMs?:number|null;
  lastConditionalSkip?:boolean;
  lastOutcome:string|null;
  lastErrorCode:string|null;
  latestSourceObservationAt?:number|null;
 }>;
 providers?:ProviderCredentialState[];
 executionPaths?:HostedExecutionPathItem[];
 environmentAudit?:ProductionEnvironmentServiceAudit[];
 graphProjection?:GraphProjectionOperationsSummary;
 recentRuns?:OperationRunAuditItem[];
 evidenceChat?:EvidenceChatOperationsSummary;
}):CollectionHealthReport{
 const {now}=input;
 const londonNow=getLondonTimeParts(now);
 const schedulerEnv=input.schedulerEnv??'unset';
 const cronGateOpen=input.systemEnabled&&input.activeEnvironment!=='disabled'&&schedulerEnv!=='disabled';
 const alerts:HealthMonitorAlert[]=[];

 if(!input.systemEnabled||input.activeEnvironment==='disabled'){
  alerts.push({
   id:'ops-system-disabled',
   severity:'warn',
   providerOrJob:'system',
   title:'Remote operations paused centrally.',
   detail:'Scheduled research and deterministic collection are centrally disabled.',
   href:'#agent-operations',
  });
 }

 if((input.pendingQuarantineCount??0)>0){
  alerts.push({
   id:'ops-safe-withheld-pending-quarantine',
   severity:'alert',
   providerOrJob:'evidence_integrity',
   title:'SAFE_WITHHELD_PENDING_QUARANTINE: Contaminated SEC/XBRL claims withheld automatically.',
   detail:`${input.pendingQuarantineCount} invalid SEC/XBRL staging record(s) have not yet been written to the evidenceQuarantines ledger; affected facts, briefings, and downstream studies are automatically withheld on read while unaffected verified observations remain accessible.`,
   href:'#morning-brief',
  });
 }

 const dailySpend=Math.max(input.dailyEstimatedCostGbp,input.dailyActualCostGbp);
 const monthlySpend=Math.max(input.monthlyEstimatedCostGbp,input.monthlyActualCostGbp);
 const dailyExceeded=dailySpend>=input.dailyCostCeilingGbp;
 const monthlyExceeded=monthlySpend>=input.monthlyCostCeilingGbp;

 if(dailyExceeded||monthlyExceeded){
  alerts.push({
   id:'ops-budget-ceiling',
   severity:'alert',
   providerOrJob:'ai_budget',
   title:'AI model cost ceiling reached.',
   detail:`Model spend (£${dailySpend.toFixed(2)} today / £${monthlySpend.toFixed(2)} month) reached the configured ceiling. Remote AI agents are paused while deterministic market-data collection continues normally.`,
   href:'#agent-operations',
  });
 }

 if(input.evidenceChat){
  if(input.evidenceChat.providerErrorCount>=2){
   alerts.push({
    id:'evidence-chat-repeated-errors',
    severity:'warn',
    providerOrJob:'evidence_chat',
    title:'Repeated Evidence-Locked Chat provider errors detected.',
    detail:`${input.evidenceChat.providerErrorCount} provider error(s) recorded in audit log. Closed-evidence validator automatically downgraded affected turns to explicit abstention.`,
    href:'/research-chat',
   });
  }
  if(input.evidenceChat.totalTurns>=3&&input.evidenceChat.unsupportedRate>0.5){
   alerts.push({
    id:'evidence-chat-high-unsupported-rate',
    severity:'info',
    providerOrJob:'evidence_chat',
    title:'High Evidence-Locked Chat abstention / unsupported-answer rate.',
    detail:`${Math.round(input.evidenceChat.unsupportedRate*100)}% of recent research questions (${input.evidenceChat.unsupportedCount}/${input.evidenceChat.totalTurns}) returned explicit abstention due to closed-evidence scope or historical cutoffs.`,
    href:'/research-chat',
   });
  }
  if(input.evidenceChat.dailySpendGbp>=input.evidenceChat.dailyCeilingGbp){
   alerts.push({
    id:'evidence-chat-budget-ceiling',
    severity:'alert',
    providerOrJob:'evidence_chat',
    title:'Evidence-Locked Chat daily budget ceiling reached.',
    detail:`Chat spend (£${input.evidenceChat.dailySpendGbp.toFixed(4)}) reached the £${input.evidenceChat.dailyCeilingGbp.toFixed(2)} daily ceiling.`,
    href:'/research-chat',
   });
  }
 }

 const defaultByKey=new Map(DEFAULT_RESEARCH_JOBS.map(d=>[d.jobKey,d]));
 const jobs:JobHealthSummary[]=input.jobs.map(j=>{
  const def=defaultByKey.get(j.jobKey);
  const category=j.category??def?.category??'deterministic_collector';
  const usesAiModel=def?.usesAiModel??(category==='remote_agent');
  const ageMs=j.lastSuccessAt===null?null:Math.max(0,now-j.lastSuccessAt);
  const staleThresholdMs=Math.max(j.intervalMinutes*3*60_000,36*3600_000);
  const freshThresholdMs=Math.max(j.intervalMinutes*1.5*60_000,2*3600_000);
  const jobBriefingDate=
   j.jobKey==='daily_intelligence_briefing'
    ?(input.latestBriefingDate??(j.lastSuccessAt?getLondonTimeParts(j.lastSuccessAt).dateKey:null))
    :null;
  const briefingWeekendHold=
   j.jobKey==='daily_intelligence_briefing'&&
   !londonNow.isWeekday&&
   ageMs!==null&&
   ageMs<=72*3600_000;
  const freshness:JobHealthSummary['freshness']=
   ageMs===null?'unavailable':
   j.jobKey==='daily_intelligence_briefing'&&jobBriefingDate!==londonNow.dateKey
    ?((londonNow.isWeekday&&londonNow.minutesSinceMidnight<7*60+30&&ageMs<=staleThresholdMs)||briefingWeekendHold?'delayed':'stale')
    :ageMs<=freshThresholdMs?'fresh':
    ageMs<=staleThresholdMs?'delayed':'stale';

  if(j.lastErrorCode&&CREDENTIAL_ERROR_CODES.has(j.lastErrorCode)){
   alerts.push({
    id:`cred-${j.jobKey}`,
    severity:'alert',
    providerOrJob:j.jobKey,
    title:`Expired or invalid credentials on ${j.name??def?.name??j.jobKey}.`,
    detail:`Job paused (${j.lastErrorCode}). Rotate or re-verify the provider credential before resuming.`,
    href:'/settings/brokers',
   });
  }else if(j.lastErrorCode){
   alerts.push({
    id:`err-${j.jobKey}`,
    severity:usesAiModel?'warn':'alert',
    providerOrJob:j.jobKey,
    title:`${j.name??def?.name??j.jobKey} reported an error.`,
    detail:`Last error: ${j.lastErrorCode}.${usesAiModel?' Deterministic market-data collectors remain unaffected.':''}`,
    href:'#agent-operations',
   });
  }

  const inferredLastFailureAt=
   j.lastFailureAt!==undefined
    ?j.lastFailureAt
    :(j.lastErrorCode&&j.lastRunAt!==null?j.lastRunAt:null);

  return {
   jobKey:j.jobKey,
   // Sprint G9.2: the "news" agent only discovers SEC filings; never present it as general financial-news collection.
   name:j.jobKey==='news_discovery_agent'?'SEC Filing Discovery Agent (deterministic XBRL; external news not implemented)':(j.name??def?.name??j.jobKey),
   purpose:j.purpose??def?.purpose??'Scheduled research job',
   category,
   usesAiModel,
   // `enabled` keeps the owner's job toggle semantics; `scheduled` (below) reports whether the cron will actually run it.
   enabled:j.enabled&&input.systemEnabled&&input.activeEnvironment!=='disabled',
   environment:j.environment??(input.activeEnvironment==='local'?'local':'remote'),
   pausedReason:j.pausedReason??(usesAiModel&&(dailyExceeded||monthlyExceeded)?'budget_exceeded':null),
   lastSuccessAt:j.lastSuccessAt,
   lastFailureAt:inferredLastFailureAt,
   lastRunAt:j.lastRunAt,
   nextRunAt:j.nextRunAt,
   freshness,
   ageMs,
   sourcesAdded:j.sourcesAddedTotal,
   evidenceAdded:j.evidenceAddedTotal,
   pendingVerification:category==='remote_agent'?input.pendingVerificationCount:0,
   estimatedCostGbp:j.estimatedCostGbpTotal,
   actualCostGbp:j.actualCostGbpTotal,
   providerRequestsLastRun:j.lastProviderRequests??0,
   processingDurationMsLastRun:j.lastDurationMs??null,
   conditionalSkipLastRun:j.lastConditionalSkip??false,
   lastOutcome:j.lastOutcome,
   lastErrorCode:j.lastErrorCode,
   latestSourceObservationAt:j.latestSourceObservationAt??null,
   scheduled:j.enabled&&cronGateOpen,
   nextRunOverdue:j.nextRunAt<now&&(j.lastRunAt===null||j.lastRunAt<j.nextRunAt),
  };
 });

 const providers:ProviderCredentialState[]=input.providers??[];
 for(const p of providers){
  if(p.status==='credentials_expired'||(p.errorCode&&CREDENTIAL_ERROR_CODES.has(p.errorCode))){
   alerts.push({
    id:`provider-cred-${p.providerId}`,
    severity:'alert',
    providerOrJob:p.providerId,
    title:`Provider credentials expired: ${p.label}.`,
    detail:p.detail,
    href:p.category==='broker_readonly'?'/settings/brokers':'#agent-operations',
   });
  }else if(p.status==='outage'){
   alerts.push({
    id:`provider-outage-${p.providerId}`,
    severity:p.category==='ai_model'?'warn':'alert',
    providerOrJob:p.providerId,
    title:`Provider outage: ${p.label}.`,
    detail:`${p.detail}${p.category==='ai_model'?' Deterministic market-data collection continues normally.':''}`,
    href:'#agent-operations',
   });
  }
 }

 const deterministicJobs=jobs.filter(j=>!j.usesAiModel);
 const aiJobs=jobs.filter(j=>j.usesAiModel);
 const deterministicCollectionHealthy=deterministicJobs.every(j=>!j.lastErrorCode&&j.pausedReason===null);
 const aiResearchHealthy=aiJobs.every(j=>!j.lastErrorCode&&j.pausedReason===null)&&!dailyExceeded&&!monthlyExceeded;

 // 5-layer operational distinction (Phase 003.2 Section 4):
 // A healthy scheduler does NOT automatically imply healthy data ingestion.
 const lastTickAt=jobs.reduce<number|null>((acc,j)=>j.lastRunAt!==null&&(acc===null||j.lastRunAt>acc)?j.lastRunAt:acc,null);
 // Sprint G9.2: "working" requires an open cron gate AND an observed recent tick. Enabled job rows alone prove nothing.
 const schedulerOverdue=cronGateOpen&&(lastTickAt===null||now-lastTickAt>SCHEDULER_OVERDUE_AFTER_MS);
 const schedulerWorking=cronGateOpen&&!schedulerOverdue;
 const nextExpectedTickAt=cronGateOpen?(lastTickAt===null?now:lastTickAt+SCHEDULER_TICK_INTERVAL_MS):null;
 const lastTickIso=lastTickAt===null?'never':new Date(lastTickAt).toISOString();
 const healthyJobsCount=jobs.filter(j=>!j.lastErrorCode&&j.pausedReason===null&&j.lastSuccessAt!==null).length;
 const failedJobsCount=jobs.filter(j=>Boolean(j.lastErrorCode)||j.pausedReason!==null).length;
 const collectorStatus:OperationalLayerStatus['collector']['status']=
  !cronGateOpen?'idle':
  failedJobsCount===0&&healthyJobsCount>0?'working':
  healthyJobsCount>0?'partial':'failed';
 const idleReason=schedulerEnv==='disabled'?'scheduler disabled':'operations disabled';

 const availableProvidersCount=providers.filter(p=>p.status==='connected'||p.status==='delayed_public').length;
 const unavailableProvidersCount=providers.filter(p=>p.status!=='connected'&&p.status!=='delayed_public').length;
 const sourceStatus:OperationalLayerStatus['source']['status']=
  unavailableProvidersCount===0&&failedJobsCount===0?'available':
  (availableProvidersCount>0||healthyJobsCount>0)?'partial':'unavailable';

 const promotedTotal=jobs.reduce((acc,j)=>acc+j.evidenceAdded,0);
 const anyConditionalSkip=jobs.some(j=>j.conditionalSkipLastRun);
 const evidenceStatus:OperationalLayerStatus['evidence']['status']=
  promotedTotal>0?'imported':
  anyConditionalSkip?'unchanged_cursor':'none_imported';

 const briefJob=jobs.find(j=>j.jobKey==='daily_intelligence_briefing')??null;
 const briefingDate=input.latestBriefingDate??(briefJob?.lastSuccessAt?getLondonTimeParts(briefJob.lastSuccessAt).dateKey:null);
 const briefingGeneratedAt=input.latestBriefingGeneratedAt??briefJob?.lastSuccessAt??null;
 const briefingIsToday=briefingDate===londonNow.dateKey;
 const briefingWeekendHoldLayer=
  !londonNow.isWeekday&&
  briefingGeneratedAt!==null&&
  Math.max(0,now-briefingGeneratedAt)<=72*3600_000;
 const briefingStatus:OperationalLayerStatus['briefing']['status']=
  briefingIsToday?'generated':
  ((londonNow.isWeekday&&londonNow.minutesSinceMidnight<7*60+30)||briefingWeekendHoldLayer)?'awaiting_uk_0730':
  briefingGeneratedAt!==null?'stale':'missing';

 const operationalLayers:OperationalLayerStatus={
  scheduler:{
   status:!cronGateOpen?'paused':schedulerOverdue?'degraded':'working',
   label:!input.systemEnabled||input.activeEnvironment==='disabled'
    ?'Paused (operations disabled)'
    :schedulerEnv==='disabled'
     ?'Scheduler disabled (RESEARCH_SCHEDULER_ENV=disabled)'
     :schedulerOverdue
      ?(lastTickAt===null?'Scheduler overdue (no run recorded)':'Scheduler overdue')
      :'Scheduler working',
   detail:!input.systemEnabled||input.activeEnvironment==='disabled'
    ?'Central operations disabled.'
    :schedulerEnv==='disabled'
     ?`Convex cron cycles exit without collecting (RESEARCH_SCHEDULER_ENV=disabled). No automatic SEC, market or briefing run will occur; last run ${lastTickIso}.`
     :schedulerOverdue
      ?`No research job has run for more than ${SCHEDULER_OVERDUE_AFTER_MS/60_000} minutes (last run ${lastTickIso}); the cron is configured but not executing.`
      :`Convex cloud cron (${schedulerEnv==='unset'?input.activeEnvironment:schedulerEnv}) last ticked ${lastTickIso}; a working scheduler does not imply every upstream source succeeded.`,
   lastTickAt,
   schedulerEnv,
   overdue:schedulerOverdue,
   nextExpectedTickAt,
  },
  collector:{
   status:collectorStatus,
   label:collectorStatus==='idle'?`Collectors idle (${idleReason})`:collectorStatus==='working'?'All collectors working':collectorStatus==='partial'?`Partial (${healthyJobsCount}/${jobs.length} healthy)`:'Collectors failing',
   detail:collectorStatus==='idle'
    ?`No collector runs while the ${idleReason==='scheduler disabled'?'scheduler is':'operations are'} disabled. Last recorded results: ${healthyJobsCount} succeeded, ${failedJobsCount} reported an error or pause.`
    :failedJobsCount>0
    ?`${healthyJobsCount} collector(s) succeeded; ${failedJobsCount} reported an upstream error (${jobs.filter(j=>j.lastErrorCode).map(j=>`${j.jobKey}:${j.lastErrorCode}`).join(', ')}).`
    :`All ${healthyJobsCount} scheduled collector(s) completed without error.`,
   healthyJobsCount,
   failedJobsCount,
  },
  source:{
   status:sourceStatus,
   label:sourceStatus==='available'?'All sources available':sourceStatus==='partial'?'Partial source coverage':'Sources unavailable',
   detail:sourceStatus==='partial'
    ?'SEC EDGAR XBRL & ECB FX reference feeds available; licensed intraday quote feed unconfigured.'
    :sourceStatus==='available'?'All configured upstream sources reachable.':'Upstream data sources unreachable or unconfigured.',
   availableCount:availableProvidersCount,
   unavailableCount:unavailableProvidersCount,
  },
  evidence:{
   status:evidenceStatus,
   label:evidenceStatus==='imported'?`Valid evidence imported (${promotedTotal})`:evidenceStatus==='unchanged_cursor'?'Cursor unchanged (no new filings)':'No valid evidence imported',
   detail:evidenceStatus==='imported'
    ?`${promotedTotal} primary-source fact(s) promoted with trusted serverReceivedAt${anyConditionalSkip?' · latest cycle skipped unchanged sources via cursor':''}.`
    :'Awaiting primary-source evidence promotion.',
   promotedTotal,
   pendingVerification:input.pendingVerificationCount,
  },
  briefing:{
   status:briefingStatus,
   label:briefingStatus==='generated'
    ?`Briefing generated (${londonNow.dateKey} ${londonNow.regime})`
    :briefingStatus==='awaiting_uk_0730'
     ?`Awaiting 07:30 Europe/London (${londonNow.regime})`
     :briefingStatus==='stale'?'Briefing stale':'Briefing missing',
   detail:briefingStatus==='generated'
    ?`Deduplicated 1 briefing for ${londonNow.dateKey} (07:30 Europe/London ${londonNow.regime}).`
    :`Scheduled for 07:30 Europe/London (${londonNow.regime}, UTC${londonNow.offsetMinutes===60?'+1':'+0'}).`,
   ukDate:londonNow.dateKey,
   ukRegime:londonNow.regime,
   generatedAt:briefingGeneratedAt,
   latestBriefingDate:input.latestBriefingDate??null,
  },
 };

 const executionPaths:HostedExecutionPathItem[]=input.executionPaths??[
  {
   id:'convex_cloud_scheduler_and_collectors',
   label:'Convex Cloud Scheduler & SEC/FX Collectors',
   deployment:'cloud_hosted',
   status:schedulerWorking?'active':'standby',
   detail:schedulerWorking
    ?'Hosted Convex scheduler: 15-minute research cycle and the weekday 07:30 Europe/London briefing schedule.'
    :`Hosted Convex scheduler not executing (${schedulerEnv==='disabled'?'RESEARCH_SCHEDULER_ENV=disabled':schedulerOverdue?'overdue':'operations disabled'}).`,
  },
  {
   id:'python_remote_research_cli',
   label:'Python Research Worker CLI (worker/remote_research.py)',
   deployment:'local_cli_only',
   status:'standby',
   detail:'On-demand CLI & parity evaluator only; not a continuously deployed cloud daemon. Recurring SEC/FX collection runs natively in Convex Cloud.',
  },
  {
   id:'github_actions_workflow',
   label:'GitHub Actions CI Workflow (.github/workflows/remote-research-operations.yml)',
   deployment:'undeployed_config',
   status:'standby',
   detail:'Runs least-privilege checks and Python unit tests (test_remote_research.py) on schedule; skips HTTP collector triggers because OPERATIONS_SCHEDULER_SECRET and RESEARCH_APP_ORIGIN are unset, while Convex crons execute collection independently.',
  },
  {
   id:'antigravity_desktop_sidecars',
   label:'Antigravity Desktop Sidecars (config/antigravity/sidecars/*)',
   deployment:'local_cli_only',
   status:'standby',
   detail:'Local workstation daemon schedules; automatically yield when activeEnvironment="remote".',
  },
  {
   id:'licensed_intraday_market_data',
   label:'Licensed Intraday Equity/Index Quote Feed (LICENSED_MARKET_DATA_API_KEY)',
   deployment:'unconfigured_provider',
   status:'unavailable',
   detail:'Unconfigured; market_data_collect uses delayed EOD reference closes and refuses to treat delayed closes as live quotes.',
  },
 ];

 // Explicit 7-stage & 6-provider-state distinction (Phase 3):
 // Never infer model inference or live provider health from historical chat records or 0-token deterministic runs.
 // Do NOT automatically classify "no successful model inference" as `providerUnavailable: true` when the provider
 // is intentionally disabled or configured-not-tested.
 const recentRuns=input.recentRuns??[];
 const collectorRunning=
  schedulerWorking&&
  jobs.some(j=>j.enabled&&j.lastRunAt!==null&&j.freshness!=='stale'&&j.freshness!=='unavailable');
 const deterministicProcessingCompleted=
  jobs.some(j=>j.lastSuccessAt!==null&&!j.lastErrorCode)||
  recentRuns.some(r=>r.status==='succeeded');
 const modelInferenceRuns=recentRuns.filter(r=>isNonDeterministicModelRun(r));
 const modelInferenceAttempted=modelInferenceRuns.length>0;
 const modelInferenceSucceeded=modelInferenceRuns.some(
  r=>r.status==='succeeded'&&!r.errorCode,
 );
 const modelInferenceFailed=
  modelInferenceAttempted&&
  !modelInferenceSucceeded&&
  modelInferenceRuns.some(r=>r.status==='failed'||r.status==='timed_out'||Boolean(r.errorCode));

 const agentJobSummary=jobs.find(j=>j.jobKey==='news_discovery_agent')??null;
 const remoteAiProvider=providers.find(p=>p.providerId==='antigravity_remote_agent'||p.category==='ai_model')??null;
 const remoteAiEnvAudit=input.environmentAudit?.find(s=>s.serviceId==='remote_ai_models')??null;

 const isProviderIntentionallyDisabled=
  !input.systemEnabled||
  input.activeEnvironment==='disabled'||
  (agentJobSummary!==null&&!agentJobSummary.enabled)||
  remoteAiEnvAudit?.status==='intentionally_disabled';

 const isProviderConfigured=Boolean(
  remoteAiEnvAudit?.status==='configured_not_tested'||
  (remoteAiEnvAudit?.status==='connected'&&modelInferenceSucceeded)||
  remoteAiEnvAudit?.status==='degraded'||
  (remoteAiProvider&&remoteAiProvider.status!=='unconfigured')||
  input.evidenceChat?.geminiConfigured,
 );

 const hasProviderOutageOrCredError=Boolean(
  modelInferenceFailed||
  remoteAiProvider?.status==='outage'||
  remoteAiProvider?.status==='credentials_expired'||
  remoteAiProvider?.status==='rate_limited'||
  (agentJobSummary?.lastErrorCode&&!isProviderIntentionallyDisabled),
 );

 const providerState:ModelProviderExecutionState=
  modelInferenceSucceeded?'successful':
  hasProviderOutageOrCredError?'failed':
  modelInferenceAttempted?'attempted':
  isProviderIntentionallyDisabled?'disabled':
  isProviderConfigured?'not_tested':
  'unconfigured';

 // `providerUnavailable` is true ONLY when the provider is unconfigured or has failed/outage —
 // never merely because a configured or disabled provider has not yet executed a successful inference run.
 const providerUnavailable=providerState==='unconfigured'||providerState==='failed';

 const researchValidated=
  promotedTotal>0||recentRuns.some(r=>r.evidencePromoted>0);
 const briefingPublished=
  briefingStatus==='generated'&&briefingGeneratedAt!==null;

 const agentAndProviderStages:AgentAndProviderStageDistinction={
  collectorRunning,
  deterministicProcessingCompleted,
  modelInferenceAttempted,
  modelInferenceSucceeded,
  providerUnavailable,
  providerState,
  researchValidated,
  briefingPublished,
  liveAgentInferenceStatus:'NOT IMPLEMENTED',
  externalNewsFeedCollectionStatus:'NOT IMPLEMENTED',
  detail:
   providerState==='successful'
    ?'Authenticated background LLM inference succeeded.'
    :providerState==='failed'
     ?'Background LLM provider invocation failed or reported an upstream credential/quota error; deterministic collection remains isolated.'
     :providerState==='attempted'
      ?'Background LLM provider invocation attempted and in progress or awaiting verification.'
      :providerState==='disabled'
       ?'Background AI research agent is intentionally disabled; deterministic market-data collection remains isolated.'
       :providerState==='not_tested'
        ?'Model provider credentials configured but not yet verified by a live background inference run (deterministic SEC XBRL & EOD market collection active; live background LLM inference NOT IMPLEMENTED).'
        :'Deterministic SEC XBRL & EOD market collection completed (0 LLM calls); live background LLM inference and external news feed ingestion are NOT IMPLEMENTED.',
 };

 // Prevent historical chat records or 0-call deterministic runs from marking remote_ai_models as 'connected'
 const sanitizedEnvironmentAudit=input.environmentAudit?.map(svc=>{
  if(svc.serviceId==='remote_ai_models'&&!modelInferenceSucceeded&&svc.status==='connected'){
   const fallbackStatus:ProductionConnectionStatus=
    providerState==='failed'?'degraded':
    providerState==='disabled'?'intentionally_disabled':
    isProviderConfigured?'configured_not_tested':'unavailable';
   return {
    ...svc,
    status:fallbackStatus,
    lastVerifiedAt:null,
    detail:'Live background LLM inference and external news collection are NOT IMPLEMENTED (0 background LLM calls, £0.00 cost); deterministic SEC XBRL extractor active.',
   };
  }
  return svc;
 });

 return {
  evaluatedAt:now,
  systemEnabled:input.systemEnabled,
  activeEnvironment:input.activeEnvironment,
  deterministicCollectionHealthy,
  aiResearchHealthy,
  modelFailureIsolated:true,
  pendingVerificationCount:input.pendingVerificationCount,
  dailyCostGbp:{
   estimated:input.dailyEstimatedCostGbp,
   actual:input.dailyActualCostGbp,
   ceiling:input.dailyCostCeilingGbp,
   exceeded:dailyExceeded,
  },
  monthlyCostGbp:{
   estimated:input.monthlyEstimatedCostGbp,
   actual:input.monthlyActualCostGbp,
   ceiling:input.monthlyCostCeilingGbp,
   exceeded:monthlyExceeded,
  },
  operationalLayers,
  agentAndProviderStages,
  executionPaths,
  jobs,
  providers,
  alerts,
  ...(sanitizedEnvironmentAudit?{environmentAudit:sanitizedEnvironmentAudit}:{}),
  ...(input.graphProjection?{graphProjection:input.graphProjection}:{}),
  ...(input.recentRuns?{recentRuns:input.recentRuns}:{}),
  ...(input.evidenceChat?{evidenceChat:input.evidenceChat}:{}),
  externalNewsIngestion:input.externalNewsCollectorImplemented
   ?{status:cronGateOpen?'HEALTHY':'DISABLED',label:cronGateOpen?'External news ingestion healthy':'External news ingestion disabled',detail:'External financial-news collector wired.'}
   :{status:'NOT_IMPLEMENTED',label:'External financial-news ingestion: NOT IMPLEMENTED',detail:'No external news collector exists. The only discovery agent reads SEC EDGAR filings and extracts XBRL facts deterministically; it never collects or summarises general financial news.'},
 };
}
