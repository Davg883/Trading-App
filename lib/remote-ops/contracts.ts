import {z} from 'zod';

export const REMOTE_OPS_VERSION='remote-ops-003-v1' as const;

/** Approved research universe (Section 4.1). Only covered symbols and benchmarks are processed. */
export const APPROVED_RESEARCH_UNIVERSE=[
 {ticker:'MSFT',name:'Microsoft Corporation',cik:'0000789019',sector:'ai_hyperscaler',irDomains:['microsoft.com','www.microsoft.com']},
 {ticker:'GOOGL',name:'Alphabet Inc.',cik:'0001652044',sector:'ai_hyperscaler',irDomains:['abc.xyz','www.abc.xyz']},
 {ticker:'AMZN',name:'Amazon.com, Inc.',cik:'0001018724',sector:'ai_hyperscaler',irDomains:['ir.aboutamazon.com','aboutamazon.com']},
 {ticker:'NVDA',name:'NVIDIA Corporation',cik:'0001045810',sector:'ai_semiconductors',irDomains:['investor.nvidia.com','nvidianews.nvidia.com']},
 {ticker:'CRWV',name:'CoreWeave, Inc.',cik:'0001769628',sector:'ai_neocloud',irDomains:['investors.coreweave.com','coreweave.com']},
 {ticker:'INTC',name:'Intel Corporation',cik:'0000050863',sector:'ai_semiconductors',irDomains:['intc.com','www.intc.com']},
 {ticker:'AMD',name:'Advanced Micro Devices, Inc.',cik:'0000002488',sector:'ai_semiconductors',irDomains:['ir.amd.com','amd.com']},
 {ticker:'AVGO',name:'Broadcom Inc.',cik:'0001730168',sector:'ai_semiconductors',irDomains:['investors.broadcom.com']},
 {ticker:'META',name:'Meta Platforms, Inc.',cik:'0001326801',sector:'ai_hyperscaler',irDomains:['investor.atmeta.com','about.fb.com']},
 {ticker:'ORCL',name:'Oracle Corporation',cik:'0001341439',sector:'ai_hyperscaler',irDomains:['investor.oracle.com']},
 {ticker:'QQQ',name:'Invesco QQQ Trust',cik:'0001067839',sector:'benchmark',irDomains:['invesco.com','www.invesco.com']},
] as const;

export const UNIVERSE_TICKERS=APPROVED_RESEARCH_UNIVERSE.map(u=>u.ticker) as [string,...string[]];
export type UniverseTicker=(typeof APPROVED_RESEARCH_UNIVERSE)[number]['ticker'];

/** Authoritative primary regulatory, central-bank and official exchange domains. */
export const PRIMARY_AUTHORITATIVE_DOMAINS=new Set<string>([
 'sec.gov','www.sec.gov','data.sec.gov','efts.sec.gov',
 'fred.stlouisfed.org','api.stlouisfed.org',
 'bankofengland.co.uk','www.bankofengland.co.uk',
 'ferc.gov','www.ferc.gov','energy.gov','www.energy.gov',
 ...APPROVED_RESEARCH_UNIVERSE.flatMap(u=>u.irDomains),
]);

export const claimClassificationSchema=z.enum(['observed','reported','estimated','proposed','unverified']);
export type ClaimClassification=z.infer<typeof claimClassificationSchema>;

export const stagingValidationStatusSchema=z.enum(['pending_verification','promoted','rejected','quarantined_injection','duplicate']);
export type StagingValidationStatus=z.infer<typeof stagingValidationStatusSchema>;

export const jobCategorySchema=z.enum(['deterministic_collector','remote_agent','risk_evaluation','briefing_generator']);
export type JobCategory=z.infer<typeof jobCategorySchema>;

export const jobEnvironmentSchema=z.enum(['remote','local']);
export type JobEnvironment=z.infer<typeof jobEnvironmentSchema>;

export const activeEnvironmentSchema=z.enum(['remote','local','disabled']);
export type ActiveEnvironment=z.infer<typeof activeEnvironmentSchema>;

export const jobRunStatusSchema=z.enum(['running','succeeded','failed','skipped','timed_out','budget_exceeded']);
export type JobRunStatus=z.infer<typeof jobRunStatusSchema>;

/** Configurable schedule proposals (Section 6). Separates deterministic collection from AI research (Section 3). */
export type DefaultJobDefinition={
 jobKey:string;
 name:string;
 purpose:string;
 category:JobCategory;
 scheduleCron:string;
 intervalMinutes:number;
 minIntervalMinutes:number;
 maxIntervalMinutes:number;
 timeoutMs:number;
 usesAiModel:boolean;
};

export const DEFAULT_RESEARCH_JOBS:readonly DefaultJobDefinition[]=[
 {
  jobKey:'market_data_collect',
  name:'Market & FX Data Collector',
  purpose:'Deterministic non-AI collector for licensed/public equity & index closes, BoE XUDLUSS GBP/USD rates and FRED macro series.',
  category:'deterministic_collector',
  scheduleCron:'CRON_TZ=America/New_York */15 9-16 * * 1-5',
  intervalMinutes:15,
  minIntervalMinutes:5,
  maxIntervalMinutes:60,
  timeoutMs:60_000,
  usesAiModel:false,
 },
 {
  jobKey:'sec_filings_collect',
  name:'SEC Financial Filings Collector',
  purpose:'Deterministic hourly SEC EDGAR XBRL disclosure collector with SHA-256 change detection across the covered AI universe.',
  category:'deterministic_collector',
  scheduleCron:'CRON_TZ=UTC 0 * * * *',
  intervalMinutes:60,
  minIntervalMinutes:30,
  maxIntervalMinutes:240,
  timeoutMs:90_000,
  usesAiModel:false,
 },
 {
  jobKey:'news_discovery_agent',
  name:'Remote Financial News & Filing Research Agent',
  purpose:'Antigravity Remote Agent discovering AI-sector developments, classifying claims, identifying primary sources and staging candidate evidence.',
  category:'remote_agent',
  scheduleCron:'CRON_TZ=UTC */30 * * * *',
  intervalMinutes:30,
  minIntervalMinutes:30,
  maxIntervalMinutes:60,
  timeoutMs:120_000,
  usesAiModel:true,
 },
 {
  jobKey:'portfolio_risk_refresh',
  name:'Post-Refresh Portfolio & Policy Risk Evaluator',
  purpose:'Deterministic portfolio concentration, AI-sector exposure, drawdown and policy-risk re-evaluation triggered after validated data refreshes.',
  category:'risk_evaluation',
  scheduleCron:'CRON_TZ=UTC 10 * * * *',
  intervalMinutes:60,
  minIntervalMinutes:15,
  maxIntervalMinutes:240,
  timeoutMs:60_000,
  usesAiModel:false,
 },
 {
  jobKey:'daily_intelligence_briefing',
  name:'Morning Intelligence Brief Generator',
  purpose:'Weekday 07:30 Europe/London briefing separating confirmed facts, research interpretation, risk changes and incomplete evidence.',
  category:'briefing_generator',
  scheduleCron:'CRON_TZ=Europe/London 30 7 * * 1-5',
  intervalMinutes:1440,
  minIntervalMinutes:60,
  maxIntervalMinutes:1440,
  timeoutMs:90_000,
  usesAiModel:false,
 },
] as const;

export const httpsUrlSchema=z.string().url().max(2000).refine(v=>{
 try{
  const u=new URL(v);
  return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash;
 }catch{return false;}
},'HTTPS URL without credentials or fragments is required');

export const stagedClaimSchema=z.object({
 id:z.string().min(1).max(120),
 entity:z.string().min(1).max(20),
 metric:z.string().min(1).max(120),
 value:z.number().finite(),
 unit:z.string().min(1).max(40),
 period:z.string().min(1).max(40),
 definition:z.string().min(1).max(300),
 excerpt:z.string().min(1).max(600),
 classification:claimClassificationSchema,
 isPrimarySource:z.boolean(),
 primarySourceUrl:httpsUrlSchema.nullable(),
}).strict();
export type StagedClaim=z.infer<typeof stagedClaimSchema>;

export const MAX_STAGING_PAYLOAD_BYTES=64_000 as const;
export const MAX_SCHEDULER_PAYLOAD_BYTES=16_000 as const;
export const MAX_SETTINGS_PAYLOAD_BYTES=8_000 as const;
export const MAX_ITEMS_PER_REQUEST=15 as const;
export const MAX_CLAIMS_PER_ITEM=25 as const;
export const MAX_STAGING_REQUESTS_PER_MINUTE=6 as const;
export const MAX_STAGING_REQUESTS_PER_HOUR=30 as const;
export const MAX_STAGING_REQUESTS_PER_DAY=120 as const;

export const stagedCandidateItemSchema=z.object({
 externalId:z.string().min(1).max(160),
 sourceUrl:httpsUrlSchema,
 title:z.string().min(1).max(400),
 text:z.string().min(1).max(60_000),
 summary:z.string().min(1).max(2_000),
 hypothesis:z.string().max(1_000).optional(),
 publishedAt:z.number().finite().nonnegative().nullable(),
 receivedAt:z.number().finite().positive(),
 entities:z.array(z.string().min(1).max(20)).min(1).max(20),
 claims:z.array(stagedClaimSchema).max(MAX_CLAIMS_PER_ITEM),
 primarySourceUrl:httpsUrlSchema.nullable().optional(),
}).strict();
export type StagedCandidateItem=z.infer<typeof stagedCandidateItemSchema>;

export const stagedSubmissionRequestSchema=z.object({
 runId:z.string().min(1).max(120),
 agentId:z.string().min(1).max(120),
 environment:jobEnvironmentSchema.default('remote'),
 cursorBefore:z.string().max(500).nullable(),
 cursorAfter:z.string().min(1).max(500),
 modelVersion:z.string().min(1).max(120),
 inputTokens:z.number().int().nonnegative().max(2_000_000),
 outputTokens:z.number().int().nonnegative().max(500_000),
 estimatedCostGbp:z.number().finite().nonnegative().max(100),
 actualCostGbp:z.number().finite().nonnegative().max(100).nullable().optional(),
 providerRequestsCount:z.number().int().nonnegative().max(10_000).optional(),
 processingDurationMs:z.number().int().nonnegative().max(3_600_000).optional(),
 conditionalSkip:z.boolean().optional(),
 items:z.array(stagedCandidateItemSchema).max(MAX_ITEMS_PER_REQUEST),
}).strict();
export type StagedSubmissionRequest=z.infer<typeof stagedSubmissionRequestSchema>;

export type ConfirmedFactItem={
 id:string;
 entity:string;
 metric:string;
 valueDisplay:string;
 period:string;
 sourceUrl:string;
 sourceKind:'sec_filing'|'central_bank'|'economic_release'|'broker_readonly'|'official_ir';
 publishedAt:number|null;
 receivedAt:number;
 classification:'observed'|'reported';
};

export type ResearchInterpretationItem={
 id:string;
 title:string;
 summary:string;
 hypothesis:string|null;
 entities:string[];
 modelVersion:string;
 citedEvidenceIds:string[];
 receivedAt:number;
 executionAuthority:'none';
};

export type RiskChangeItem={
 id:string;
 category:'concentration'|'ai_exposure'|'drawdown'|'policy_risk'|'broker_sync'|'trading_controls'|'provider_health';
 severity:'ok'|'warn'|'alert';
 title:string;
 detail:string;
 href:string;
};

export type IncompleteEvidenceItem={
 id:string;
 domain:string;
 missingItem:string;
 impact:string;
 pendingVerificationCount:number;
 resolutionHref:string;
};

export type MorningBriefingRecord={
 briefingDate:string;
 generatedAt:number;
 timezone:'Europe/London';
 confirmedFacts:ConfirmedFactItem[];
 researchInterpretation:ResearchInterpretationItem[];
 riskChanges:RiskChangeItem[];
 incompleteEvidence:IncompleteEvidenceItem[];
 modelVersion:string|null;
 executionAuthority:'none';
 version:typeof REMOTE_OPS_VERSION;
};
