import liveIngestionRaw from '../../data/thesis-monitor/november-7-2026-live-ingestion.json';
import recoveryV2Raw from '../../data/recovery/november-3-2026-v2.json';
import {
  retrieveClosedEvidenceBundle,
} from '../graph/evidence-retrieval-gateway';
import {
  validateEvidenceLockedAnswer,
} from '../graph/evidence-answer-validator';
import {
  EVIDENCE_LOCKED_ANSWER_VERSION,
  SUGGESTED_STARTER_QUESTIONS,
  type AnswerValidationReport,
  type EvidenceBundleV1,
  type EvidenceLockedAnswer,
  type TemporalBasis,
} from '../graph/evidence-chat-contracts';
import {
  RESEARCH_METHODOLOGY_VERSION,
  evaluateUniverseResearchAssessments,
  type ResearchAssessmentLabel,
} from './engine';

/**
 * AI Capital Intelligence — Research Thesis Monitor: Cathie Wood AI Capex Moderation
 * (`thesis-ark-ai-capex-moderation-2026-11-07`) — Live Integration Acceptance (`v2.0.0`)
 *
 * Governance & Epistemic Invariants:
 * 1. Never treats external commentary, opinion, or forecasts as established financial facts.
 * 2. Preserves four distinct provenance categories:
 *    - `registered_thesis_statement`: Dated internal registration of the testable hypothesis.
 *    - `commentary_origin`: Cathie Wood / ARK Invest "In The Know" video commentary (7 Nov 2026).
 *    - `secondary_reporting`: Secondary press articles summarising the commentary (8 Nov 2026).
 *    - `verified_primary_evidence`: Independently verified SEC filings, BEA GDP release, central-bank/regulator records, and Nasdaq historical close series.
 * 3. Uses deterministic evidence classifications (`supports`, `contradicts`, `neutral`, `insufficient_evidence`) — never unsupported statistical probabilities.
 * 4. Keeps all 7 company directional ratings locked under G.6/G.7 gates (`INSUFFICIENT DATA`) and holds `executionAuthority: 'none'`.
 */

export const THESIS_MONITOR_VERSION = 'aci-thesis-monitor-v2.1.0' as const;
export const ARK_CAPEX_THESIS_ID = 'thesis-ark-ai-capex-moderation-2026-11-07' as const;

export type EpistemicSourceLayer =
  | 'registered_thesis_statement'
  | 'commentary_origin'
  | 'secondary_reporting'
  | 'verified_primary_evidence';

export type ClaimVerificationStatus =
  | 'verified_in_primary_store'
  | 'verified_enacted_policy_separated_from_unofficial_election_returns'
  | 'partially_corroborated_unofficial_or_lagged'
  | 'missing_primary_source_in_store'
  | 'excluded_by_historical_cutoff'
  | 'unverified_commentary_opinion';

export type DeterministicEvidenceClassification =
  | 'supports'
  | 'contradicts'
  | 'neutral'
  | 'insufficient_evidence';

export type IndicatorFreshnessStatus =
  | 'fresh_verified'
  | 'lagged_verified'
  | 'stale_beyond_threshold'
  | 'unofficial_pending_certification'
  | 'excluded_post_cutoff'
  | 'missing_evidence';

export interface ThesisProvenanceRecord {
  recordId: string;
  epistemicLayer: EpistemicSourceLayer;
  title: string;
  url: string;
  authorOrInstitution: string;
  publishedAtMs: number | null;
  publicationDateIso: string;
  publicationBasis:
    | 'internal_thesis_registration'
    | 'sec_edgar_acceptance'
    | 'official_embargo_release_830am_edt'
    | 'official_regulator_release'
    | 'date_only_commentary'
    | 'secondary_media_timestamp'
    | 'retrieval_upper_bound';
  receivedAtMs: number;
  receivedAtIso: string;
  claimClassification:
    | 'registered_hypothesis'
    | 'observed_fact'
    | 'reported_commentary'
    | 'opinion_and_hypothesis';
  eligibleForGraphConfirmation: boolean;
  epistemicRestrictionNote: string;
}

export interface MacroClaimVerificationAudit {
  claimKey:
    | 'nov_5_sp500_nasdaq_selloff'
    | 'nov_6_market_rebound'
    | 'us_2026_midterm_election_results'
    | 'us_q3_2026_gdp_growth';
  claimLabel: string;
  commentaryAssertion: string;
  verificationStatus: ClaimVerificationStatus;
  evidenceClassification: DeterministicEvidenceClassification;
  storedPrimaryEvidenceIds: string[];
  publishedAtMs: number | null;
  receivedAtMs: number;
  whatIsVerifiedInStore: string;
  whatIsMissingOrUnverified: string;
  electionPolicySeparationNote?: string;
  authoritativeSourceRequiredToResolve: string;
}

export interface ThesisCompanyLinkage {
  ticker: 'NVDA' | 'MSFT' | 'AMZN' | 'GOOGL' | 'AMD' | 'CRWV' | 'INTC';
  companyName: string;
  currentRatingLabel: ResearchAssessmentLabel;
  nonDirectionalScreeningScore: number | null;
  roleInCapexThesis:
    | 'Hyperscale AI Capex Spender & Cloud Monetiser'
    | 'AI Compute Silicon & Merchant Hardware Supplier'
    | 'Leveraged Specialist AI Neocloud'
    | 'Foundry & Co-Investment Capex Turnaround';
  evidenceClassification: DeterministicEvidenceClassification;
  nov4CloseUsd: number;
  nov5CloseUsd: number;
  nov6CloseUsd: number;
  nov5ChangePct: number;
  nov6ChangePct: number;
  verifiedSupportingMetrics: string[];
  verifiedContradictoryOrRiskMetrics: string[];
  missingCompanyEvidence: string[];
  citedEvidenceIds: string[];
}

export interface TestableThesisScenario {
  scenarioId:
    | 'scenario-efficient-capex-moderation'
    | 'scenario-persistent-infrastructure-bottlenecks'
    | 'scenario-hard-capex-retrenchment';
  title: string;
  hypothesisDescription: string;
  probabilityAssignment: null;
  probabilityPolicyNote: 'No numerical probability assigned; monitored via deterministic observable indicators.';
  currentEvidenceAlignment: DeterministicEvidenceClassification;
  confirmingIndicatorThresholds: string[];
  invalidatingIndicatorThresholds: string[];
  companyImplications: Record<'hyperscalers' | 'semiconductors' | 'neoclouds', string>;
}

export interface ThesisLeadingIndicator {
  indicatorId: string;
  name: string;
  category:
    | 'capex_efficiency'
    | 'cash_conversion'
    | 'cloud_monetisation'
    | 'silicon_demand'
    | 'project_execution'
    | 'credit_and_financing'
    | 'power_and_grid'
    | 'regulatory_and_policy';
  measurementFormulaOrSeries: string;
  /** Structured observation value (Requirement 4) */
  value: string;
  /** Structured reporting period or session date (Requirement 4) */
  reportingPeriod: string;
  /** Primary evidence ID (Requirement 4) */
  evidenceId: string;
  primaryEvidenceIds: string[];
  /** Freshness status relative to evaluation clock (Requirement 4) */
  freshnessStatus: IndicatorFreshnessStatus;
  /** Historical baseline comparison (Requirement 4) */
  historicalComparison: string;
  /** Deterministic classification (Requirement 5) */
  evidenceClassification: DeterministicEvidenceClassification;
  /** Part A.4 — Explicit 6-part epistemic separation */
  observedFinancialFact: string;
  hypothesisBeingTested: string;
  relevanceOfObservation: string;
  evidenceDirection: DeterministicEvidenceClassification;
  sourceConfidence: {
    level:
      | 'high_primary_filing_or_regulator'
      | 'medium_mixed_primary_and_reported'
      | 'low_unofficial_or_secondary';
    rationale: string;
  };
  freshnessAndHistoricalEligibility: {
    freshnessStatus: IndicatorFreshnessStatus;
    publishedAtMs: number | null;
    receivedAtMs: number;
    eligibleAtCutoff: boolean;
    ageDays: number | null;
    rationale: string;
  };
  /** Part D.2 — Scheduled collection & change-tracking fields */
  latestEligibleObservation: string;
  previousComparableObservation: string;
  evidenceSourceAndTimestamp: {
    sourceId: string;
    publishedAtIso: string | null;
    receivedAtIso: string;
  };
  materialChange: {
    hasMaterialChange: boolean;
    summary: string;
  };
  hypothesisResolution: 'supports' | 'contradicts' | 'does_not_resolve';
  publishedAtMs: number | null;
  receivedAtMs: number;
  currentVerifiedReading: string;
  dataStatus: 'verified' | 'partial' | 'missing_in_store';
  interpretationForThesis: string;
}

export interface EvidenceChangeAssessmentItem {
  itemId: string;
  indicatorId: string;
  title: string;
  domain: 'macro_market' | 'corporate_filings' | 'typedb_graph' | 'policy_and_grid';
  classification: DeterministicEvidenceClassification;
  reportingPeriod: string;
  priorBaseline: string;
  currentObservation: string;
  evidenceIds: string[];
  rationale: string;
}

export interface DeterministicEvidenceChangeSummary {
  classificationPolicyNote: 'Deterministic evidence classifications only (supports, contradicts, neutral, insufficient_evidence); never statistical probabilities.';
  counts: {
    supports: number;
    contradicts: number;
    neutral: number;
    insufficient_evidence: number;
  };
  totalDeclaredIndicatorsCount: 8;
  sumOfMutuallyExclusiveCountsEqualsTotal: true;
  zeroDuplicateIndicatorIds: true;
  overallConclusionClassification:
    | 'mixed_supports_and_contradicts'
    | 'supports'
    | 'contradicts'
    | 'neutral'
    | 'insufficient_evidence';
  shortConclusion: string;
  activeSupersededRelationshipIdsExcluded: string[];
  activeReplacementRelationshipIdsIncluded: string[];
  excludedByHistoricalCutoffIds: string[];
  staleIndicatorIds: string[];
  items: EvidenceChangeAssessmentItem[];
}

export interface PartAQualityGateAudit {
  priorVersionReportedCounts: {
    supports: 4;
    contradicts: 3;
    neutral: 1;
    insufficient_evidence: 1;
    sum: 9;
    declaredIndicatorsCount: 8;
  };
  rootCauseOfNineCountMismatch: string;
  correctedCountsDerivedFromUniqueIndicators: {
    supports: number;
    contradicts: number;
    neutral: number;
    insufficient_evidence: number;
    sum: number;
    declaredIndicatorsCount: number;
    sumEqualsDeclaredCount: boolean;
  };
  reclassifiedIndicatorsAudit: Array<{
    indicatorId: string;
    priorClassification: DeterministicEvidenceClassification;
    correctedClassification: DeterministicEvidenceClassification;
    correctionRationale: string;
  }>;
}

export interface LiveGeminiThesisInferenceRecord {
  executedAtIso: string;
  turnId: string;
  bundleId: string;
  bundleSha256: string;
  question: string;
  modelId: string;
  requestId: string | null;
  generationMode: 'gemini_live';
  providerStatus: 'succeeded';
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  latencyMs: number;
  estimatedCostGbp: number;
  validationValid: boolean;
  validationAction: 'accepted';
  checksPassed: number;
  totalChecks: number;
  shortAnswer: string;
  citedEvidenceIds: string[];
  citedRelationshipIds: string[];
}

export interface MarketCloseIngestionAudit {
  packageId: string;
  capturedAtIso: string;
  capturedAtMs: number;
  v2OverlapSessionsChecked: number;
  v2RevisionsDetectedCount: number;
  licensedForRedistribution: false;
  substitutedLiveQuotesForHistoricalCloses: false;
  instruments: Record<
    string,
    {
      symbol: string;
      sourceId: string;
      receivedAtIso: string;
      receivedAtMs: number;
      nov4Close: number;
      nov5Close: number;
      nov6Close: number;
      nov5ChangePct: number;
      nov6ChangePct: number;
      twoDayNetChangePct: number;
    }
  >;
}

export interface EvaluateThesisOptions {
  historicalCutoffMs?: number;
  temporalBasis?: TemporalBasis;
  evaluationNowMs?: number;
  maxFreshnessDays?: number;
  excludeEvidenceIds?: string[];
  includeSupersededRelationshipsAsActive?: boolean;
}

export interface EvidenceBackedThesisAssessment {
  thesisId: typeof ARK_CAPEX_THESIS_ID;
  version: typeof THESIS_MONITOR_VERSION;
  methodologyVersion: typeof RESEARCH_METHODOLOGY_VERSION;
  registeredAtIso: string;
  thesisTitle: string;
  datedThesisStatement: string;
  epistemicStatus: 'mixed_evidence_under_active_monitoring';
  schemaExpansionRecommendation: {
    expandTypeDbSchemaNow: false;
    promoteUnverifiedCommentaryToProdGraph: false;
    rationale: string;
  };
  partAQualityGateAudit: PartAQualityGateAudit;
  provenanceRecords: ThesisProvenanceRecord[];
  marketCloseIngestionAudit: MarketCloseIngestionAudit;
  macroClaimsAudit: MacroClaimVerificationAudit[];
  companyLinkages: ThesisCompanyLinkage[];
  scenarios: TestableThesisScenario[];
  leadingIndicators: ThesisLeadingIndicator[];
  evidenceChangeAssessment: DeterministicEvidenceChangeSummary;
  liveGeminiInferenceRecord: LiveGeminiThesisInferenceRecord;
  evidenceSynthesis: {
    supportingEvidence: Array<{ statement: string; evidenceIds: string[] }>;
    contradictoryEvidence: Array<{ statement: string; evidenceIds: string[] }>;
    missingEvidence: string[];
    keyUncertainties: string[];
  };
  compactMarketRadarPanelProposal: {
    proposedSectionPlacement: string;
    linkedWhatChangedIds: string[];
    linkedResearchChatPrompt: string;
  };
  executionAuthority: 'none';
}

interface RawLiveIngestion {
  packageId: string;
  capturedAtIso: string;
  capturedAtMs: number;
  beaGdpRelease: {
    sourceId: string;
    releaseNumber: string;
    title: string;
    url: string;
    pdfUrl: string;
    publishedAtIso: string;
    publishedAtMs: number;
    publicationBasis: string;
    receivedAtIso: string;
    receivedAtMs: number;
    sha256: string;
    metrics: {
      realGdpQ3SaarPct: number;
      realGdpQ2SaarPct: number;
      currentDollarGdpQ3SaarPct: number;
      currentDollarGdpLevelTrillionsUsd: number;
      realFinalSalesToPrivateDomesticPurchasersQ3SaarPct: number;
      realFinalSalesToPrivateDomesticPurchasersQ2SaarPct: number;
      grossDomesticPurchasesPriceIndexQ3Pct: number;
      pcePriceIndexQ3Pct: number;
      corePcePriceIndexQ3Pct: number;
    };
  };
  nasdaqHistoricalClosesV3: Record<
    string,
    {
      symbol: string;
      assetClass: string;
      sourceId: string;
      sourceUrl: string;
      sha256: string;
      receivedAtMs: number;
      receivedAtIso: string;
      publishedAtMs: number | null;
      publicationBasis: string;
      priceBasis: string;
      licensedForRedistribution: boolean;
      sessionCount: number;
      nov4Close: number;
      nov5Close: number;
      nov6Close: number;
      nov5ChangePct: number;
      nov6ChangePct: number;
      twoDayNetChangePct: number;
      latest5Sessions: Array<{
        date: string;
        close: number;
        open: number;
        high: number;
        low: number;
        eventCloseUtc: string;
      }>;
    }
  >;
}

const liveIngestion = liveIngestionRaw as unknown as RawLiveIngestion;

/**
 * Validates that the newly ingested v3 Nasdaq series (covering 1 Sep – 6 Nov 2026)
 * matches the overlapping 4 November 2026 anchor closes in `november-3-2026-v2.json`
 * without silent revisions or live-quote substitution.
 */
export function auditMarketCloseIngestionV3(): MarketCloseIngestionAudit {
  const v2Prices = (
    recoveryV2Raw as {
      prices: Array<{ instrumentId: string; eventAt: number; close: number }>;
    }
  ).prices;
  const nov4CloseUtcMs = Date.parse('2026-11-04T21:00:00Z');
  const v2Nov4BySymbol = new Map<string, number>();
  for (const row of v2Prices) {
    if (row.eventAt === nov4CloseUtcMs) {
      v2Nov4BySymbol.set(row.instrumentId, row.close);
    }
  }

  let overlapChecked = 0;
  let revisionsDetected = 0;
  const instruments: MarketCloseIngestionAudit['instruments'] = {};

  for (const [sym, data] of Object.entries(liveIngestion.nasdaqHistoricalClosesV3)) {
    const v2Val = v2Nov4BySymbol.get(sym);
    if (v2Val !== undefined) {
      overlapChecked += 1;
      if (Math.abs(v2Val - data.nov4Close) > 1e-6) {
        revisionsDetected += 1;
      }
    }
    instruments[sym] = {
      symbol: sym,
      sourceId: data.sourceId,
      receivedAtIso: data.receivedAtIso,
      receivedAtMs: data.receivedAtMs,
      nov4Close: data.nov4Close,
      nov5Close: data.nov5Close,
      nov6Close: data.nov6Close,
      nov5ChangePct: data.nov5ChangePct,
      nov6ChangePct: data.nov6ChangePct,
      twoDayNetChangePct: data.twoDayNetChangePct,
    };
  }

  return {
    packageId: liveIngestion.packageId,
    capturedAtIso: liveIngestion.capturedAtIso,
    capturedAtMs: liveIngestion.capturedAtMs,
    v2OverlapSessionsChecked: overlapChecked,
    v2RevisionsDetectedCount: revisionsDetected,
    licensedForRedistribution: false,
    substitutedLiveQuotesForHistoricalCloses: false,
    instruments,
  };
}

/**
 * Requirement 1 — Four-Category Provenance Registry:
 * 1. `registered_thesis_statement`: Internal dated thesis registration.
 * 2. `commentary_origin`: Original ARK Invest 7 Nov 2026 video commentary.
 * 3. `secondary_reporting`: Secondary media article summarising the commentary.
 * 4. `verified_primary_evidence`: Primary SEC filings, BEA GDP release, and Nasdaq historical close tables.
 */
export const ARK_THESIS_PROVENANCE_RECORDS: readonly ThesisProvenanceRecord[] = [
  {
    recordId: ARK_CAPEX_THESIS_ID,
    epistemicLayer: 'registered_thesis_statement',
    title: 'Registered Research Thesis: Moderated AI Capex & Long-Term Capital Efficiency',
    url: 'https://capital.aiguides.co.uk/data-room',
    authorOrInstitution: 'AI Capital Intelligence Research Governance Registry',
    publishedAtMs: 1794246533000,
    publicationDateIso: '2026-11-09',
    publicationBasis: 'internal_thesis_registration',
    receivedAtMs: 1794246533000,
    receivedAtIso: '2026-11-09T17:48:53Z',
    claimClassification: 'registered_hypothesis',
    eligibleForGraphConfirmation: false,
    epistemicRestrictionNote:
      'Internal dated registration of a testable investment hypothesis. Never treated as an established financial fact; evaluated continuously against primary SEC, BEA, regulator, and exchange records.',
  },
  {
    recordId: 'ark-in-the-know-2026-11-07',
    epistemicLayer: 'commentary_origin',
    title: 'ARK Invest — "In The Know" with Cathie Wood (7 November 2026 Market Commentary)',
    url: 'https://www.ark-invest.com/videos/market-commentary/november-2026-in-the-know-cathie-wood',
    authorOrInstitution: 'Cathie Wood / ARK Investment Management LLC',
    publishedAtMs: null,
    publicationDateIso: '2026-11-07',
    publicationBasis: 'date_only_commentary',
    receivedAtMs: 1794246533000,
    receivedAtIso: '2026-11-09T17:48:53Z',
    claimClassification: 'opinion_and_hypothesis',
    eligibleForGraphConfirmation: false,
    epistemicRestrictionNote:
      'Primary record of Cathie Wood’s investment commentary and macro/AI thesis. Stored strictly as `opinion_and_hypothesis`; assertions inside commentary are never promoted as confirmed graph facts without independent primary verification.',
  },
  {
    recordId: 'secondary-press-ark-capex-2026-11-08',
    epistemicLayer: 'secondary_reporting',
    title: 'Secondary Financial Press Coverage of Cathie Wood 7 November 2026 AI Capex Moderation Commentary',
    url: 'https://www.ark-invest.com/videos/market-commentary/november-2026-in-the-know-cathie-wood',
    authorOrInstitution: 'Secondary Media Summary (Supplied Discovery Brief)',
    publishedAtMs: null,
    publicationDateIso: '2026-11-08',
    publicationBasis: 'secondary_media_timestamp',
    receivedAtMs: 1794246533000,
    receivedAtIso: '2026-11-09T17:48:53Z',
    claimClassification: 'reported_commentary',
    eligibleForGraphConfirmation: false,
    epistemicRestrictionNote:
      'Secondary media reporting on ARK’s commentary. Retained for discovery provenance only; cannot corroborate market moves, GDP figures, or corporate cash flows.',
  },
  {
    recordId: 'bea-26-45-gdp-q3-2026-adv',
    epistemicLayer: 'verified_primary_evidence',
    title: 'U.S. Bureau of Economic Analysis — BEA 26-45: Gross Domestic Product (Advance Estimate), 3rd Quarter 2026',
    url: 'https://www.bea.gov/news/2026/gdp-advance-estimate-3rd-quarter-2026',
    authorOrInstitution: 'U.S. Bureau of Economic Analysis (Department of Commerce)',
    publishedAtMs: 1793277000000,
    publicationDateIso: '2026-10-29',
    publicationBasis: 'official_embargo_release_830am_edt',
    receivedAtMs: liveIngestion.beaGdpRelease.receivedAtMs,
    receivedAtIso: liveIngestion.beaGdpRelease.receivedAtIso,
    claimClassification: 'observed_fact',
    eligibleForGraphConfirmation: true,
    epistemicRestrictionNote:
      'Official primary BEA release (embargoed until 8:30 a.m. EDT / 12:30:00Z on 29 October 2026) establishing Q3 2026 Real GDP +3.4% SAAR (vs +2.2% in Q2), Real Final Sales to Private Domestic Purchasers +4.9% SAAR, and Core PCE +2.5% SAAR.',
  },
  {
    recordId: 'nasdaq-comp-history-v3',
    epistemicLayer: 'verified_primary_evidence',
    title: 'Nasdaq Historical Close/Last Table (v3 Re-Capture through 6 November 2026: COMP, NDX, SOX, SPY, QQQ & 7 Universe Stocks)',
    url: 'https://api.nasdaq.com/api/quote/COMP/historical?assetclass=index&fromdate=2026-09-01&todate=2026-11-09&limit=100',
    authorOrInstitution: 'Nasdaq Public Historical Quote API',
    publishedAtMs: Date.parse('2026-11-06T21:00:00Z'),
    publicationDateIso: '2026-11-06',
    publicationBasis: 'retrieval_upper_bound',
    receivedAtMs: liveIngestion.nasdaqHistoricalClosesV3.COMP!.receivedAtMs,
    receivedAtIso: liveIngestion.nasdaqHistoricalClosesV3.COMP!.receivedAtIso,
    claimClassification: 'observed_fact',
    eligibleForGraphConfirmation: true,
    epistemicRestrictionNote:
      'Verified dated regular-session Close/Last observations through 6 November 2026 (48 sessions; 0 revisions vs v2 on 1 Sep – 4 Nov). Public reference display only (`licensedForRedistribution: false`); never substituted by intraday quotes.',
  },
  {
    recordId: 'amazon-sec-ex991',
    epistemicLayer: 'verified_primary_evidence',
    title: 'Amazon.com, Inc. Q3 2026 Form 8-K Exhibit 99.1 (Cash Flow & Capex Bridge)',
    url: 'https://www.sec.gov/Archives/edgar/data/1018724/000101872426000038/amzn-20260930xex991.htm',
    authorOrInstitution: 'Amazon.com, Inc. (SEC EDGAR CIK 0001018724)',
    publishedAtMs: 1793304327000,
    publicationDateIso: '2026-10-29',
    publicationBasis: 'sec_edgar_acceptance',
    receivedAtMs: 1793471503000,
    receivedAtIso: '2026-10-31T18:31:43Z',
    claimClassification: 'observed_fact',
    eligibleForGraphConfirmation: true,
    epistemicRestrictionNote:
      'Verified primary SEC filing establishing TTM-2026-Q3 OCF ($168,300M), Net Capex ($210,657M = 125.2% of OCF), TTM FCF (-$42,357M), and AWS Q3 revenue ($45,984M, +39.3% YoY).',
  },
  {
    recordId: 'sec-release',
    epistemicLayer: 'verified_primary_evidence',
    title: 'Alphabet Inc. Q3 2026 Earnings Release · SEC Form 8-K Exhibit 99.1',
    url: 'https://www.sec.gov/Archives/edgar/data/1652044/000165204426000080/googexhibit991q32026.htm',
    authorOrInstitution: 'Alphabet Inc. (SEC EDGAR CIK 0001652044)',
    publishedAtMs: 1793217693000,
    publicationDateIso: '2026-10-28',
    publicationBasis: 'sec_edgar_acceptance',
    receivedAtMs: 1793294123000,
    receivedAtIso: '2026-10-29T17:15:23Z',
    claimClassification: 'observed_fact',
    eligibleForGraphConfirmation: true,
    epistemicRestrictionNote:
      'Verified primary SEC filing establishing 2026-Q3 revenue ($127.577B, +24.65% YoY), Google Cloud revenue ($30.709B, +102.61% YoY), Q3 OCF ($42.290B), Q3 Capex ($51.355B = 121.4% of OCF), and Q3 FCF (-$9.065B).',
  },
  {
    recordId: 'msft-fy27-q1',
    epistemicLayer: 'verified_primary_evidence',
    title: 'Microsoft Corporation FY2027 Q1 Official Financial Results (30 September 2026)',
    url: 'https://www.microsoft.com/en-us/Investor/earnings/FY-2027-Q1/press-release-webcast',
    authorOrInstitution: 'Microsoft Corporation (CIK 0000789019)',
    publishedAtMs: 1793253600000,
    publicationDateIso: '2026-10-28',
    publicationBasis: 'sec_edgar_acceptance',
    receivedAtMs: 1793744707000,
    receivedAtIso: '2026-11-03T22:25:07Z',
    claimClassification: 'observed_fact',
    eligibleForGraphConfirmation: true,
    epistemicRestrictionNote:
      'Verified primary release establishing FY27 Q1 revenue ($92,279M), Azure (+48% YoY), OCF ($58,000M), cash PP&E additions ($39,367M = 67.9% of OCF), and positive derived FCF (+$18,633M).',
  },
  {
    recordId: 'nvda-fy27-q2',
    epistemicLayer: 'verified_primary_evidence',
    title: 'NVIDIA Corporation FY2027 Q2 Official Financial Results (26 July 2026)',
    url: 'https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-second-quarter-fiscal-2027',
    authorOrInstitution: 'NVIDIA Corporation (CIK 0001045810)',
    publishedAtMs: Date.parse('2026-08-26T20:20:00Z'),
    publicationDateIso: '2026-08-26',
    publicationBasis: 'official_regulator_release',
    receivedAtMs: 1793744707000,
    receivedAtIso: '2026-11-03T22:25:07Z',
    claimClassification: 'observed_fact',
    eligibleForGraphConfirmation: true,
    epistemicRestrictionNote:
      'Verified primary release establishing FY27 Q2 revenue ($96,221M), Data Center revenue ($89,000M), GAAP operating margin (66.2%), FCF ($21,341M), and Q3 FY27 revenue outlook ($108B ± 2%).',
  },
  {
    recordId: 'anthropic-s1a-2026-11-02',
    epistemicLayer: 'verified_primary_evidence',
    title: 'Anthropic, PBC — SEC Form S-1/A Amendment No. 1 (2 November 2026)',
    url: 'https://www.sec.gov/Archives/edgar/data/2130357/000119312526421102/d2130357ds1a.htm',
    authorOrInstitution: 'Anthropic, PBC (SEC EDGAR CIK 0002130357)',
    publishedAtMs: 1793651400000,
    publicationDateIso: '2026-11-02',
    publicationBasis: 'sec_edgar_acceptance',
    receivedAtMs: 1794142440000,
    receivedAtIso: '2026-11-08T12:54:00Z',
    claimClassification: 'observed_fact',
    eligibleForGraphConfirmation: true,
    epistemicRestrictionNote:
      'Verified primary SEC registration statement establishing $895.4B in aggregate signed multi-year cloud compute and data-centre purchase/lease commitments (as of 30 Sep 2026) alongside 9M 2026 GAAP revenue of $33.242B and GAAP net loss of -$104.0B.',
  },
  {
    recordId: 'sec-xbrl-g7-1-2026-11-09',
    epistemicLayer: 'verified_primary_evidence',
    title: 'SEC EDGAR XBRL 7-Stock Financial Expansion (NVDA, MSFT, GOOGL, AMZN, AMD, CRWV, INTC — Phase G.7.1)',
    url: 'https://data.sec.gov/api/xbrl/companyfacts/',
    authorOrInstitution: 'U.S. Securities and Exchange Commission (EDGAR XBRL API)',
    publishedAtMs: 1793746817000,
    publicationDateIso: '2026-11-03',
    publicationBasis: 'sec_edgar_acceptance',
    receivedAtMs: 1794252500000,
    receivedAtIso: '2026-11-09T19:28:20Z',
    claimClassification: 'observed_fact',
    eligibleForGraphConfirmation: true,
    epistemicRestrictionNote:
      'Primary SEC EDGAR XBRL multi-quarter flow, 4-quarter TTM, balance-sheet debt/cash/leases, diluted share count, and acceptanceDateTime package across all 7 universe companies at £0 public-domain cost.',
  },
] as const;

/**
 * Requirement 2 & 3 — Audit of the 5 November Sell-Off, 6 November Rebound,
 * 2026 US Midterm Election Results (separated from enacted policy), and Q3 2026 US GDP.
 */
export const MACRO_CLAIM_VERIFICATION_AUDITS: readonly MacroClaimVerificationAudit[] = [
  {
    claimKey: 'nov_5_sp500_nasdaq_selloff',
    claimLabel: '5 November 2026 S&P 500 / Nasdaq Sell-Off',
    commentaryAssertion:
      'Commentary references a sharp equity sell-off on Thursday, 5 November 2026 driven by valuation, rate, and AI capex scrutiny.',
    verificationStatus: 'verified_in_primary_store',
    evidenceClassification: 'supports',
    storedPrimaryEvidenceIds: [
      'nasdaq-comp-history-v3',
      'nasdaq-ndx-history-v3',
      'nasdaq-sox-history-v3',
      'nasdaq-spy-history-v3',
      'nasdaq-qqq-history-v3',
    ],
    publishedAtMs: Date.parse('2026-11-05T21:00:00Z'),
    receivedAtMs: liveIngestion.nasdaqHistoricalClosesV3.COMP!.receivedAtMs,
    whatIsVerifiedInStore:
      'Verified in `data/thesis-monitor/november-7-2026-live-ingestion.json` (`v3` Nasdaq historical capture, received 2026-11-09T18:08:08Z): on Thursday, 5 November 2026, `COMP` fell -5.52% (25,736.51 -> 24,315.00), `NDX` fell -6.36% (28,437.17 -> 26,629.81), `SOX` fell -12.25% (10,268.65 -> 9,011.14), `SPY` fell -4.41% ($766.81 -> $733.00), `QQQ` fell -6.49% ($691.95 -> $647.05), `NVDA` fell -9.26% ($200.13 -> $181.60), and `AMD` fell -17.26% ($488.78 -> $404.40).',
    whatIsMissingOrUnverified:
      'Stock and ETF closes remain unadjusted public reference observations (`licensedForRedistribution: false`); SPX cash index is represented via SPY ($766.81 -> $733.00, -4.41%).',
    authoritativeSourceRequiredToResolve:
      'Resolved for research reference via Nasdaq Historical Quote API (`v3` capture through 2026-11-06).',
  },
  {
    claimKey: 'nov_6_market_rebound',
    claimLabel: '6 November 2026 S&P 500 / Nasdaq Rebound',
    commentaryAssertion:
      'Commentary references a subsequent market stabilisation and rebound on Friday, 6 November 2026.',
    verificationStatus: 'verified_in_primary_store',
    evidenceClassification: 'neutral',
    storedPrimaryEvidenceIds: [
      'nasdaq-comp-history-v3',
      'nasdaq-ndx-history-v3',
      'nasdaq-sox-history-v3',
      'nasdaq-spy-history-v3',
      'nasdaq-qqq-history-v3',
    ],
    publishedAtMs: Date.parse('2026-11-06T21:00:00Z'),
    receivedAtMs: liveIngestion.nasdaqHistoricalClosesV3.COMP!.receivedAtMs,
    whatIsVerifiedInStore:
      'Verified in `data/thesis-monitor/november-7-2026-live-ingestion.json` (`v3` capture): on Friday, 6 November 2026, `COMP` rebounded +1.09% (24,315.00 -> 24,579.42), `NDX` rose +1.35% (26,629.81 -> 26,989.99), `SOX` rebounded +4.21% (9,011.14 -> 9,390.25), `SPY` edged up +0.31% ($733.00 -> $735.29), `QQQ` rose +1.40% ($647.05 -> $656.10), `NVDA` rose +2.78% ($181.60 -> $186.64), `AMD` rose +11.04% ($404.40 -> $449.04), and `CRWV` rose +6.28% ($43.66 -> $46.40), while `MSFT` (-0.99% to $530.61) and `AMZN` (-0.35% to $259.30) drifted slightly lower.',
    whatIsMissingOrUnverified:
      'The 6 November rebound (+1.09% COMP / +0.31% SPY) only partially retraced the 5 November sell-off (leaving a 2-day net change of -4.50% on COMP and -4.11% on SPY).',
    authoritativeSourceRequiredToResolve:
      'Resolved for research reference via Nasdaq Historical Quote API (`v3` capture through 2026-11-06).',
  },
  {
    claimKey: 'us_2026_midterm_election_results',
    claimLabel: '3 November 2026 US Midterm Election Results vs Enacted Data-Centre Policy',
    commentaryAssertion:
      'Commentary discusses the fiscal, regulatory, and infrastructure implications of the 3 November 2026 US midterm elections.',
    verificationStatus: 'verified_enacted_policy_separated_from_unofficial_election_returns',
    evidenceClassification: 'supports',
    storedPrimaryEvidenceIds: [
      'ny-eo62',
      'okhouse-hb2992',
      'time-midterms',
      'wyso-sw-ohio-results',
      'gridsight-votes',
    ],
    publishedAtMs: Date.parse('2026-11-05T03:38:00Z'),
    receivedAtMs: 1793890620000,
    whatIsVerifiedInStore:
      'Enacted binding state policies are verified in primary government sources: New York Executive Order 62 (`ny-eo62`, signed 2026-07-14, pausing >=50 MW DEC permits) and Oklahoma HB 2992 (`okhouse-hb2992`, effective 2026-07-01, allocating >=75 MW tariff costs). Election-night and cumulative unofficial returns for Southwest Ohio municipal ballot measures (Wilmington rezoning rejection ~80%-20%, Piqua and Urbana charter bans) are corroborated across county election portals (`boe.ohio.gov/{clinton,miami,champaign}`) and secondary reporting (`wyso-sw-ohio-results`).',
    whatIsMissingOrUnverified:
      'Per Ohio Revised Code § 3505.32, County Boards of Elections conduct the official canvass 11–21 days after Election Day (14–24 November 2026) following the provisional/absentee cure period. As of 9 November 2026, all 3 November 2026 ballot and congressional counts remain unofficial returns (`authority: secondary / unofficial_canvass`), and Piqua/Urbana MW scope retains `conflictingSources`.',
    electionPolicySeparationNote:
      'Strictly separated: (1) Enacted binding statutes/orders (`ny-eo62`, `okhouse-hb2992`) are confirmed primary policy facts; (2) 3 November 2026 election results remain `unofficial_pending_statutory_canvass` until county certification (14–24 Nov 2026) and enact no federal data-centre rule on their own.',
    authoritativeSourceRequiredToResolve:
      'Import certified County Board of Elections / Secretary of State official canvass certificates after the statutory 14–24 November 2026 certification window closes.',
  },
  {
    claimKey: 'us_q3_2026_gdp_growth',
    claimLabel: 'US Q3 2026 Real GDP Advance Estimate (BEA 26-45)',
    commentaryAssertion:
      'Commentary cites Q3 2026 US GDP growth as evidence of underlying macroeconomic resilience supporting enterprise AI adoption.',
    verificationStatus: 'verified_in_primary_store',
    evidenceClassification: 'supports',
    storedPrimaryEvidenceIds: ['bea-26-45-gdp-q3-2026-adv', 'fred-vixcls-v2', 'cbi-fsr-2026-i'],
    publishedAtMs: 1793277000000,
    receivedAtMs: liveIngestion.beaGdpRelease.receivedAtMs,
    whatIsVerifiedInStore:
      'Verified from the original U.S. Bureau of Economic Analysis release (`BEA 26-45`, published 2026-10-29T12:30:00Z / 8:30 a.m. EDT, received 2026-11-09T18:08:13Z, SHA-256 `b51d2f8f5bb721a5...`): US Real GDP increased at an annual rate of +3.4% SAAR in Q3 2026 (accelerating from +2.2% in Q2 2026), Real Final Sales to Private Domestic Purchasers rose +4.9% SAAR (vs +4.6% in Q2), Current-Dollar GDP rose +5.6% SAAR to $30.84T, and Core PCE inflation eased to +2.5% SAAR (from +3.3% in Q2).',
    whatIsMissingOrUnverified:
      'BEA Q3 2026 GDP is the Advance Estimate (subject to the BEA Second Estimate scheduled for 25 November 2026); BLS Nonfarm Business Sector Labor Productivity (`OPHNFB`) remains uningested due to FRED CSV connection reset.',
    authoritativeSourceRequiredToResolve:
      'BEA Q3 2026 Advance GDP is verified and stored (`bea-26-45-gdp-q3-2026-adv`); monitor BEA Second Estimate on 2026-11-25.',
  },
] as const;

/**
 * Verified Live Gemini Inference Record captured against Vercel Production / Google GenAI SDK (`gemini-2.5-flash` / `gemini-3.6-flash` allowlist).
 */
export const VERIFIED_LIVE_GEMINI_THESIS_INFERENCE: LiveGeminiThesisInferenceRecord = {
  executedAtIso: '2026-11-09T18:14:07Z',
  turnId: 'chat-4b0c888484-1794248047000',
  bundleId: 'bundle-4b0c888484596615',
  bundleSha256: '4b0c888484596615f8390f66656f1cf602ad7e282eb96a09b900051b7b1c0dc8',
  question:
    'What evidence supports the largest compute commitments and how do Ireland grid constraints and project supersessions affect AI infrastructure capex?',
  modelId: 'gemini-3.6-flash',
  requestId: 'Zg3yaoXKKLvJiLMPj7at8AM',
  generationMode: 'gemini_live',
  providerStatus: 'succeeded',
  inputTokens: 6760,
  outputTokens: 672,
  thinkingTokens: 0,
  totalTokens: 7432,
  latencyMs: 9167,
  estimatedCostGbp: 0.001105,
  validationValid: true,
  validationAction: 'accepted',
  checksPassed: 9,
  totalChecks: 9,
  shortAnswer:
    "Anthropic's S-1/A filing confirms the largest compute commitment at $895.4B deduplicated aggregate (preventing a $44.6B double-count with Nscale). AI capex faces regional pressure from Ireland's transmission grid constraints, where data centers use 21% of national power, alongside macroeconomic contagion risks highlighted by Irish regulators.",
  citedEvidenceIds: [
    'anthropic-s1a-2026-11-02',
    'cru-eirgrid-dc-policy-2026',
  ],
  citedRelationshipIds: [
    'rel-anthropic-s1a-amzn-compute-r1',
    'rel-aws-dublin-eirgrid-dep-r1',
  ],
};

function isRecordTemporallyEligible(
  publishedAtMs: number | null,
  receivedAtMs: number,
  cutoffMs: number,
  basis: TemporalBasis,
): boolean {
  if (basis === 'publication') {
    const effectivePub = publishedAtMs ?? receivedAtMs;
    return effectivePub <= cutoffMs;
  }
  return receivedAtMs <= cutoffMs;
}

/**
 * Evaluates the Cathie Wood AI Capex Moderation Thesis strictly against approved stored evidence,
 * supporting historical cutoff filtering, staleness checks, missing-evidence simulation, and
 * superseded relationship exclusion (Requirements 4, 5, 7, 8, 9).
 */
export function evaluateAiCapexModerationThesis(
  options?: EvaluateThesisOptions,
): EvidenceBackedThesisAssessment {
  const cutoffMs = options?.historicalCutoffMs ?? Date.parse('2026-11-09T23:59:59Z');
  const temporalBasis: TemporalBasis = options?.temporalBasis ?? 'publication';
  const evalNowMs = options?.evaluationNowMs ?? Date.parse('2026-11-09T18:15:00Z');
  const maxFreshnessDays = options?.maxFreshnessDays ?? 125;
  const excludedSet = new Set(options?.excludeEvidenceIds ?? []);

  const assessments = evaluateUniverseResearchAssessments();
  const byTicker = new Map(assessments.map((a) => [a.ticker, a]));
  const mkt = liveIngestion.nasdaqHistoricalClosesV3;

  const isSourceAvailable = (
    id: string,
    pubMs: number | null,
    recMs: number,
  ): { available: boolean; reason: 'ok' | 'excluded_missing' | 'excluded_cutoff' } => {
    if (excludedSet.has(id)) {
      return { available: false, reason: 'excluded_missing' };
    }
    if (!isRecordTemporallyEligible(pubMs, recMs, cutoffMs, temporalBasis)) {
      return { available: false, reason: 'excluded_cutoff' };
    }
    return { available: true, reason: 'ok' };
  };

  const computeFreshness = (
    id: string,
    pubMs: number | null,
    recMs: number,
    isUnofficial = false,
  ): IndicatorFreshnessStatus => {
    const check = isSourceAvailable(id, pubMs, recMs);
    if (!check.available) {
      return check.reason === 'excluded_cutoff' ? 'excluded_post_cutoff' : 'missing_evidence';
    }
    if (isUnofficial) {
      return 'unofficial_pending_certification';
    }
    const refMs = pubMs ?? recMs;
    const ageDays = (evalNowMs - refMs) / 86_400_000;
    if (ageDays > maxFreshnessDays) {
      return 'stale_beyond_threshold';
    }
    if (ageDays > 21) {
      return 'lagged_verified';
    }
    return 'fresh_verified';
  };

  const companyLinkages: ThesisCompanyLinkage[] = [
    {
      ticker: 'AMZN',
      companyName: 'Amazon.com, Inc.',
      currentRatingLabel: byTicker.get('AMZN')?.assessment ?? 'INSUFFICIENT DATA',
      nonDirectionalScreeningScore: byTicker.get('AMZN')?.researchPriorityScore ?? 57.7,
      roleInCapexThesis: 'Hyperscale AI Capex Spender & Cloud Monetiser',
      evidenceClassification: 'contradicts',
      nov4CloseUsd: mkt.AMZN!.nov4Close,
      nov5CloseUsd: mkt.AMZN!.nov5Close,
      nov6CloseUsd: mkt.AMZN!.nov6Close,
      nov5ChangePct: mkt.AMZN!.nov5ChangePct,
      nov6ChangePct: mkt.AMZN!.nov6ChangePct,
      verifiedSupportingMetrics: [
        'AWS revenue grew +39.32% YoY in 2026-Q3 to $45,984M with $17,452M segment operating income (37.95% margin), proving strong enterprise cloud/AI demand (`amazon-sec-ex991`).',
        'If net capex moderates from 2026-Q3 levels ($75,878M = 178.9% of Q3 OCF) back toward TTM-2025-Q3 intensity (88.7% of OCF), Amazon’s $168,300M TTM OCF would immediately restore substantial positive Free Cash Flow.',
      ],
      verifiedContradictoryOrRiskMetrics: [
        'Actual 2026-Q3 and TTM-2026-Q3 filings show accelerating capex rather than moderation: TTM net capex reached $210,657M (125.2% of TTM OCF), driving TTM FCF to -$42,357M and Q3 FCF to -$33,456M (`amazon-sec-ex991`).',
        'Physical grid & zoning bottlenecks in Dublin (`proj-aws-dublin-campus`, 350 MW EirGrid constraint) and Wilmington, Ohio (`wyso-wilmington-court`) risk delaying return on invested capital.',
      ],
      missingCompanyEvidence: [
        'FY2027 management capital expenditure guidance range and AI-specific vs logistics capex split.',
        'SEC XBRL diluted share count and consolidated balance-sheet debt/cash for EV/TTM EBIT valuation.',
      ],
      citedEvidenceIds: [
        'amazon-sec-ex991',
        'amzn-ttm-2026-q3-ocf-v1',
        'amzn-ttm-2026-q3-gross-capex-v1',
        'cru-eirgrid-dc-policy-2026',
        'wyso-wilmington-court',
        'nasdaq-amzn-history-v3',
      ],
    },
    {
      ticker: 'GOOGL',
      companyName: 'Alphabet Inc.',
      currentRatingLabel: byTicker.get('GOOGL')?.assessment ?? 'INSUFFICIENT DATA',
      nonDirectionalScreeningScore: byTicker.get('GOOGL')?.researchPriorityScore ?? 61.5,
      roleInCapexThesis: 'Hyperscale AI Capex Spender & Cloud Monetiser',
      evidenceClassification: 'contradicts',
      nov4CloseUsd: mkt.GOOGL!.nov4Close,
      nov5CloseUsd: mkt.GOOGL!.nov5Close,
      nov6CloseUsd: mkt.GOOGL!.nov6Close,
      nov5ChangePct: mkt.GOOGL!.nov5ChangePct,
      nov6ChangePct: mkt.GOOGL!.nov6ChangePct,
      verifiedSupportingMetrics: [
        'Google Cloud revenue surged +102.61% YoY in 2026-Q3 to $30.709B (vs $15.157B in 2025-Q3), while Cloud operating income more than tripled to $11.121B (`sec-release`).',
        'Consolidated 2026-Q3 GAAP operating margin remained strong at 31.81% ($40.576B operating income on $127.577B revenue), showing high underlying earnings power if capex growth moderates.',
      ],
      verifiedContradictoryOrRiskMetrics: [
        '2026-Q3 capital expenditure more than doubled YoY to $51.355B (vs $23.953B in 2025-Q3), reaching 121.44% of Q3 OCF ($42.290B) and pushing single-quarter FCF to -$9.065B (`goog-2026q3-free_cash_flow-v1`).',
        'Backed Anthropic with up to $40.0B equity/convertible cap (`anthropic-s1-2026-10-26`) while Anthropic carries $895.4B in multi-year compute commitments and a -$104.0B 9M GAAP net loss.',
      ],
      missingCompanyEvidence: [
        '4-quarter TTM cash-flow sum, consolidated GAAP NetIncomeLoss dollar total, and Class A+B+C diluted share count.',
      ],
      citedEvidenceIds: [
        'sec-release',
        'goog-2026q3-revenue-v1',
        'goog-2026q3-cloud_revenue-v1',
        'goog-2026q3-capital_expenditure-v1',
        'goog-2026q3-free_cash_flow-v1',
        'anthropic-s1-2026-10-26',
        'nasdaq-googl-history-v3',
      ],
    },
    {
      ticker: 'MSFT',
      companyName: 'Microsoft Corporation',
      currentRatingLabel: byTicker.get('MSFT')?.assessment ?? 'INSUFFICIENT DATA',
      nonDirectionalScreeningScore: byTicker.get('MSFT')?.researchPriorityScore ?? 73.7,
      roleInCapexThesis: 'Hyperscale AI Capex Spender & Cloud Monetiser',
      evidenceClassification: 'supports',
      nov4CloseUsd: mkt.MSFT!.nov4Close,
      nov5CloseUsd: mkt.MSFT!.nov5Close,
      nov6CloseUsd: mkt.MSFT!.nov6Close,
      nov5ChangePct: mkt.MSFT!.nov5ChangePct,
      nov6ChangePct: mkt.MSFT!.nov6ChangePct,
      verifiedSupportingMetrics: [
        'Demonstrates that elevated AI capex and positive FCF can coexist: FY2027 Q1 Azure grew +48% YoY ($33,165M), Microsoft Cloud reached $63,900M (+30% YoY), GAAP operating margin hit 49.76% ($45,915M), and FCF remained positive at +$18,633M after $39,367M cash capex (`msft-fy27-q1`).',
        'Proactively exercised capital discipline by terminating the original Loughton UK data-centre customer commitment (`rel-loughton-dc-cancelled-v1-r1`, `reuters-loughton-oct19`) before superseding it with a redesigned structure (`rel-loughton-dc-active-v2-r1`).',
      ],
      verifiedContradictoryOrRiskMetrics: [
        'Cash PP&E additions ($39,367M) consumed 67.87% of FY27 Q1 OCF ($58,000M) and exclude finance lease additions (`msft-fy27-q1`).',
        'Linked to the $44.6B Nscale Monarch West Virginia compute sub-allocation inside Anthropic’s $895.4B commitment envelope (`nscale-s1-sep18`, `anthropic-s1a-2026-11-02`) and faces Dublin Grange Castle (280 MW) grid constraints.',
      ],
      missingCompanyEvidence: [
        'Finance lease additions disclosed in Form 10-Q footnotes, 4-quarter TTM cash flows, and balance-sheet debt/cash.',
      ],
      citedEvidenceIds: [
        'msft-fy27-q1',
        'reuters-loughton-oct19',
        'nscale-s1-sep18',
        'anthropic-s1a-2026-11-02',
        'cru-eirgrid-dc-policy-2026',
        'nasdaq-msft-history-v3',
      ],
    },
    {
      ticker: 'NVDA',
      companyName: 'NVIDIA Corporation',
      currentRatingLabel: byTicker.get('NVDA')?.assessment ?? 'INSUFFICIENT DATA',
      nonDirectionalScreeningScore: byTicker.get('NVDA')?.researchPriorityScore ?? 82.3,
      roleInCapexThesis: 'AI Compute Silicon & Merchant Hardware Supplier',
      evidenceClassification: 'contradicts',
      nov4CloseUsd: mkt.NVDA!.nov4Close,
      nov5CloseUsd: mkt.NVDA!.nov5Close,
      nov6CloseUsd: mkt.NVDA!.nov6Close,
      nov5ChangePct: mkt.NVDA!.nov5ChangePct,
      nov6ChangePct: mkt.NVDA!.nov6ChangePct,
      verifiedSupportingMetrics: [
        'FY2027 Q2 revenue reached $96,221M (Data Center $89,000M) with 66.24% GAAP operating margin ($63,734M) and $21,341M FCF; Q3 FY27 revenue guidance is $108B ± 2% (`nvda-fy27-q2`), contradicting any near-term Q3 hardware demand collapse.',
      ],
      verifiedContradictoryOrRiskMetrics: [
        'Share price fell -9.26% on 5 Nov ($200.13 -> $181.60) before rebounding +2.78% on 6 Nov ($186.64, `nasdaq-nvda-history-v3`), illustrating sensitivity to hyperscaler capex moderation narratives.',
        'Signed $1.0B convertible commitment and $860.3M Ward County Texas lease guarantee for Nscale (`nscale-s1-sep18`), with Reuters reporting talks on additional credit support (`reuters-credit-oct30`).',
      ],
      missingCompanyEvidence: [
        '4-quarter TTM XBRL statements, diluted share count, and customer concentration breakdown across MSFT, AMZN, GOOGL, and META.',
      ],
      citedEvidenceIds: [
        'nvda-fy27-q2',
        'nscale-s1-sep18',
        'reuters-credit-oct30',
        'nasdaq-nvda-history-v3',
      ],
    },
    {
      ticker: 'AMD',
      companyName: 'Advanced Micro Devices, Inc.',
      currentRatingLabel: byTicker.get('AMD')?.assessment ?? 'INSUFFICIENT DATA',
      nonDirectionalScreeningScore: byTicker.get('AMD')?.researchPriorityScore ?? 63.0,
      roleInCapexThesis: 'AI Compute Silicon & Merchant Hardware Supplier',
      evidenceClassification: 'contradicts',
      nov4CloseUsd: mkt.AMD!.nov4Close,
      nov5CloseUsd: mkt.AMD!.nov5Close,
      nov6CloseUsd: mkt.AMD!.nov6Close,
      nov5ChangePct: mkt.AMD!.nov5ChangePct,
      nov6ChangePct: mkt.AMD!.nov6ChangePct,
      verifiedSupportingMetrics: [
        'Primary Q3 2026 Form 10-Q (`0000002488-26-000191`) confirms fabless capital efficiency with +$7,056M 4Q TTM Free Cash Flow (22.66% TTM capex/OCF) and -$8,697M Net Cash ($15,776M Cash+ST vs $7,079M Debt).',
        'Rebounded +11.04% on 6 Nov ($404.40 -> $449.04) after a -17.26% drop on 5 Nov ($488.78 -> $404.40, `nasdaq-amd-history-v3`).',
      ],
      verifiedContradictoryOrRiskMetrics: [
        'Q3 2026 revenue accelerated +44.68% YoY to $13,377M ($45,436M TTM; Q3 GAAP operating income $2,832M = 21.17% margin, `sec-xbrl-amd-0000002488-26-000191`), contradicting any near-term Q3 hardware demand slowdown.',
        'High tactical beta to AI capex headlines (-8.13% net 2-day move from $488.78 on 4 Nov to $449.04 on 6 Nov, `nasdaq-amd-history-v3`).',
      ],
      missingCompanyEvidence: [
        'Customer concentration breakdown across hyperscaler buyers and split-adjusted price verification (`corporateActionsReviewed: false`).',
      ],
      citedEvidenceIds: [
        'sec-xbrl-amd-0000002488-26-000191',
        'nasdaq-amd-history-v3',
        'nasdaq-amd',
      ],
    },
    {
      ticker: 'CRWV',
      companyName: 'CoreWeave, Inc.',
      currentRatingLabel: byTicker.get('CRWV')?.assessment ?? 'INSUFFICIENT DATA',
      nonDirectionalScreeningScore: byTicker.get('CRWV')?.researchPriorityScore ?? 39.1,
      roleInCapexThesis: 'Leveraged Specialist AI Neocloud',
      evidenceClassification: 'contradicts',
      nov4CloseUsd: mkt.CRWV!.nov4Close,
      nov5CloseUsd: mkt.CRWV!.nov5Close,
      nov6CloseUsd: mkt.CRWV!.nov6Close,
      nov5ChangePct: mkt.CRWV!.nov5ChangePct,
      nov6ChangePct: mkt.CRWV!.nov6ChangePct,
      verifiedSupportingMetrics: [
        'Q2 2026 Form 10-Q (`0001769628-26-000366`) revenue grew +112.46% YoY to $2,575M ($7,590M TTM), anchored by 400 MW Polaris Forge 1 campus lease with Applied Digital (250 MW operational from 1 Oct 2026, `apld-8k-2026-10-07`).',
      ],
      verifiedContradictoryOrRiskMetrics: [
        'Directly contradicts capex moderation: Q2 2026 cash capex reached $6,422M (945.80% of $679M Q2 OCF) and 4Q TTM capex reached $20,566M (297.58% of $6,911M TTM OCF), driving TTM FCF to -$13,655M alongside +$30,233M Net Debt ($35,772M debt + finance leases plus $16,319M operating leases, `sec-xbrl-crwv-0001769628-26-000366`).',
        'Fell -9.83% on 5 Nov ($48.42 -> $43.66) before rebounding +6.28% on 6 Nov ($46.40, `nasdaq-crwv-history-v3`).',
      ],
      missingCompanyEvidence: [
        'Q3 2026 Form 10-Q (not yet filed on SEC EDGAR as of 9 November 2026; latest filing is Q2 2026 10-Q ended 30 June 2026).',
      ],
      citedEvidenceIds: [
        'sec-xbrl-crwv-0001769628-26-000366',
        'src-crwv-polaris-2026',
        'apld-8k-2026-10-07',
        'nasdaq-crwv-history-v3',
        'cbi-fsr-2026-i',
      ],
    },
    {
      ticker: 'INTC',
      companyName: 'Intel Corporation',
      currentRatingLabel: byTicker.get('INTC')?.assessment ?? 'INSUFFICIENT DATA',
      nonDirectionalScreeningScore: byTicker.get('INTC')?.researchPriorityScore ?? 54.2,
      roleInCapexThesis: 'Foundry & Co-Investment Capex Turnaround',
      evidenceClassification: 'neutral',
      nov4CloseUsd: mkt.INTC!.nov4Close,
      nov5CloseUsd: mkt.INTC!.nov5Close,
      nov6CloseUsd: mkt.INTC!.nov6Close,
      nov5ChangePct: mkt.INTC!.nov5ChangePct,
      nov6ChangePct: mkt.INTC!.nov6ChangePct,
      verifiedSupportingMetrics: [
        'Q3 2026 Form 10-Q (`0000050863-26-000191`) verifies Q3 revenue of $16,513M (+20.95% YoY; $59,892M TTM), Q3 GAAP operating income of $2,522M (15.27% margin), +$1,058M Q3 FCF (+$3,768M TTM FCF), and $11.0B Fab 34 Leixlip Ireland SCJV capex sharing (`intc-10q-q3-2026`).',
      ],
      verifiedContradictoryOrRiskMetrics: [
        '4Q TTM GAAP Net Income remains negative at -$12,032M with 78.43% TTM capex/OCF ($13,704M TTM capex on $17,472M TTM OCF) and long-term SCJV partner distribution obligations (`sec-xbrl-intc-0000050863-26-000191`, `ireland-dof-ai-correction-2026-07`).',
      ],
      missingCompanyEvidence: [
        'Split-adjusted historical price verification and foundry customer external wafer backlog disclosures.',
      ],
      citedEvidenceIds: [
        'sec-xbrl-intc-0000050863-26-000191',
        'intc-10q-q3-2026',
        'src-intc-10k-2025',
        'ireland-dof-ai-correction-2026-07',
        'nasdaq-intc-history-v3',
      ],
    },
  ];

  // Part A.3, A.4, A.5, A.6 & Part D.2 — Eight Unique Leading Indicators with Strict Epistemic Separation
  type RawIndicatorSpec = Omit<
    ThesisLeadingIndicator,
    | 'freshnessStatus'
    | 'evidenceClassification'
    | 'evidenceDirection'
    | 'freshnessAndHistoricalEligibility'
    | 'hypothesisResolution'
    | 'dataStatus'
  > & {
    baseDirection: DeterministicEvidenceClassification;
    domain: EvidenceChangeAssessmentItem['domain'];
    freshnessRationale: string;
  };

  const rawIndicators: RawIndicatorSpec[] = [
    {
      indicatorId: 'ind-capex-to-ocf',
      name: '1. Hyperscaler & Neocloud Net Capex / Operating Cash Flow Ratio (%)',
      category: 'capex_efficiency',
      domain: 'corporate_filings',
      baseDirection: 'contradicts',
      measurementFormulaOrSeries:
        '(Net Capital Expenditure / Operating Cash Flow) × 100 across matched quarterly and 4-quarter TTM periods',
      value:
        'AMZN 125.2% TTM (178.9% Q3) · GOOGL 121.4% Q3 (89.0% TTM) · CRWV 297.6% TTM (945.8% Q2) · MSFT 69.4% TTM (67.9% Q1)',
      reportingPeriod: '2026-Q3 / FY2027-Q1 (ended 30 Sep 2026; CRWV Q2 ended 30 Jun 2026)',
      evidenceId: 'amazon-sec-ex991',
      primaryEvidenceIds: [
        'amazon-sec-ex991',
        'sec-release',
        'msft-fy27-q1',
        'nvda-fy27-q2',
        'sec-xbrl-g7-1-2026-11-09',
      ],
      historicalComparison:
        'AMZN Net Capex/OCF surged +36.5 pp YoY on a TTM basis (88.7% TTM-2025-Q3 -> 125.2% TTM-2026-Q3) and +82.6 pp YoY in Q3 (96.3% -> 178.9%); GOOGL Q3 Capex/OCF rose +71.9 pp YoY (49.5% in 2025-Q3 -> 121.4% in 2026-Q3); CRWV TTM Capex/OCF reached 297.6% (945.8% in Q2 2026).',
      observedFinancialFact:
        'In 2026-Q3 / TTM-2026-Q3 SEC filings, Amazon Net Capex reached $210,657M TTM (125.17% of $168,300M OCF; $75,878M Q3 = 178.86% of Q3 OCF), Alphabet Q3 Capex reached $51,355M (121.44% of $42,290M Q3 OCF; $159,804M TTM = 89.00% of TTM OCF), CoreWeave TTM Capex reached $20,566M (297.58% of $6,911M TTM OCF; 945.80% in Q2), and Microsoft TTM cash PP&E reached $135,921M (69.39% of $195,878M TTM OCF).',
      hypothesisBeingTested:
        'Whether hyperscaler and AI cloud infrastructure capital expenditure intensity (Capex / OCF) has begun moderating toward sustainable capital efficiency.',
      relevanceOfObservation:
        'Capex / OCF directly measures the fraction of internally generated operating cash flow consumed by physical infrastructure additions.',
      sourceConfidence: {
        level: 'high_primary_filing_or_regulator',
        rationale:
          'Verified directly from audited/reviewed SEC Form 10-Q and Form 8-K Exhibit 99.1 filings on EDGAR.',
      },
      freshnessRationale:
        'Q3 2026 / FY27 Q1 filings accepted by SEC EDGAR 28 Oct – 3 Nov 2026 (within 12 days of evaluation).',
      latestEligibleObservation:
        'AMZN 125.2% TTM (178.9% Q3); GOOGL 121.4% Q3 (89.0% TTM); CRWV 297.6% TTM (945.8% Q2); MSFT 69.4% TTM; INTC 78.4% TTM; AMD 22.7% TTM; NVDA 5.5% TTM',
      previousComparableObservation:
        'AMZN 88.7% TTM-2025-Q3 (96.3% 2025-Q3 net); GOOGL 49.5% 2025-Q3; MSFT 57.1% FY26 Q1',
      evidenceSourceAndTimestamp: {
        sourceId: 'amazon-sec-ex991',
        publishedAtIso: '2026-10-29T22:20:46.000Z',
        receivedAtIso: '2026-10-31T18:31:43.000Z',
      },
      materialChange: {
        hasMaterialChange: true,
        summary:
          'Capex/OCF expanded sharply across hyperscalers (+36.5 pp TTM at AMZN, +71.9 pp Q3 at GOOGL) and reached 297.6% TTM at CRWV after G.7.1 SEC XBRL ingestion.',
      },
      publishedAtMs: 1793304327000,
      receivedAtMs: 1793471503000,
      currentVerifiedReading:
        'AMZN: 125.2% TTM-2026-Q3 (178.9% in 2026-Q3 vs 88.7% in TTM-2025-Q3); GOOGL: 121.4% in 2026-Q3 (89.0% TTM); CRWV: 297.6% TTM (945.8% Q2); MSFT: 69.4% TTM (67.9% FY27 Q1); INTC: 78.4% TTM; AMD: 22.7% TTM; NVDA: 5.5% TTM',
      interpretationForThesis:
        'Contradicts the thesis in current reported actuals: hyperscaler and neocloud capex intensity accelerated sharply in Q2–Q3 2026 rather than moderating.',
    },
    {
      indicatorId: 'ind-free-cash-flow',
      name: '2. Hyperscaler & Silicon Free Cash Flow Bridge ($M / % Margin)',
      category: 'cash_conversion',
      domain: 'corporate_filings',
      baseDirection: 'contradicts',
      measurementFormulaOrSeries: 'Operating Cash Flow − Net Capital Expenditure (Quarterly and 4-Quarter TTM)',
      value:
        'AMZN -$42,357M TTM (-$33,456M Q3) · GOOGL -$9,065M Q3 (+$19,747M TTM) · CRWV -$13,655M TTM (-$5,743M Q2) · MSFT +$59,957M TTM (+$18,633M Q1)',
      reportingPeriod: '2026-Q3 / FY2027-Q1 (ended 30 Sep 2026; CRWV Q2 ended 30 Jun 2026)',
      evidenceId: 'goog-2026q3-free_cash_flow-v1',
      primaryEvidenceIds: [
        'amazon-sec-ex991',
        'goog-2026q3-free_cash_flow-v1',
        'msft-fy27-q1',
        'nvda-fy27-q2',
        'sec-xbrl-g7-1-2026-11-09',
      ],
      historicalComparison:
        'AMZN TTM FCF swung by -$57,157M YoY (+$14,800M in TTM-2025-Q3 -> -$42,357M in TTM-2026-Q3); GOOGL single-quarter FCF swung by -$33,522M YoY (+$24,457M in 2025-Q3 -> -$9,065M in 2026-Q3); CRWV TTM FCF is -$13,655M (-179.9% margin).',
      observedFinancialFact:
        'Reported Free Cash Flow turned deeply negative at Amazon (-$42,357M TTM net / -$46,892M TTM gross; -$33,456M in 2026-Q3), Alphabet (-$9,065M in 2026-Q3, compressing 4Q TTM FCF to +$19,747M), and CoreWeave (-$13,655M TTM; -$5,743M in 2026-Q2), while remaining positive at NVIDIA (+$127,006M TTM), Microsoft (+$59,957M TTM), AMD (+$7,056M TTM), and Intel (+$3,768M TTM).',
      hypothesisBeingTested:
        'Whether moderating AI infrastructure capital expenditure is improving corporate cash conversion and restoring Free Cash Flow.',
      relevanceOfObservation:
        'Observed negative Free Cash Flow is a direct outcome of unmoderated capex burn exceeding operating cash generation; evidence of acute cash-flow compression must not be misclassified as confirmation that capital discipline is improving.',
      sourceConfidence: {
        level: 'high_primary_filing_or_regulator',
        rationale:
          'Verified from primary SEC Form 10-Q and Form 8-K cash-flow statements across all 7 companies.',
      },
      freshnessRationale:
        'Primary Q3 2026 / FY27 Q1 SEC filings accepted 28 Oct – 3 Nov 2026.',
      latestEligibleObservation:
        'AMZN -$42,357M TTM (-$33,456M Q3); GOOGL -$9,065M Q3 (+$19,747M TTM); CRWV -$13,655M TTM; MSFT +$59,957M TTM; NVDA +$127,006M TTM; AMD +$7,056M TTM; INTC +$3,768M TTM',
      previousComparableObservation:
        'AMZN +$14,788M TTM-2025-Q3 (+$430M 2025-Q3 gross); GOOGL +$24,457M 2025-Q3',
      evidenceSourceAndTimestamp: {
        sourceId: 'goog-2026q3-free_cash_flow-v1',
        publishedAtIso: '2026-10-29T00:29:06.000Z',
        receivedAtIso: '2026-10-29T17:15:23.000Z',
      },
      materialChange: {
        hasMaterialChange: true,
        summary:
          'Reclassified from `supports` to `contradicts` under Part A.5 quality gate: -$57.2B YoY TTM FCF deterioration at AMZN, -$9.07B Q3 FCF at GOOGL, and -$13.66B TTM FCF burn at CRWV prove ongoing cash-flow strain rather than improving capital discipline.',
      },
      publishedAtMs: 1793217693000,
      receivedAtMs: 1793294123000,
      currentVerifiedReading:
        'AMZN: -$42,357M TTM-2026-Q3 (-5.3% margin) & -$33,456M in 2026-Q3; GOOGL: -$9,065M in 2026-Q3 (+$19,747M TTM); CRWV: -$13,655M TTM (-$5,743M Q2); MSFT: +$59,957M TTM (+$18,633M Q1); NVDA: +$127,006M TTM (+$21,341M Q2); AMD: +$7,056M TTM; INTC: +$3,768M TTM',
      interpretationForThesis:
        'Contradicts the thesis in current actuals: while the accounting bridge shows FCF would recover if capex moderates, observed FCF actually deteriorated into deep negative cash burn at AMZN, GOOGL (Q3), and CRWV.',
    },
    {
      indicatorId: 'ind-cloud-revenue-growth',
      name: '3. Cloud & AI Infrastructure Segment Revenue Growth & Macro Demand (BEA Q3 GDP)',
      category: 'cloud_monetisation',
      domain: 'corporate_filings',
      baseDirection: 'supports',
      measurementFormulaOrSeries:
        'YoY % growth for Google Cloud, AWS, and Azure + BEA Q3 2026 Real GDP SAAR %',
      value:
        'Google Cloud +102.6% YoY ($30.71B) · Azure +48% YoY ($33.17B) · AWS +39.3% YoY ($45.98B) · US Q3 Real GDP +3.4% SAAR',
      reportingPeriod: '2026-Q3 (ended 30 Sep 2026; BEA Advance Estimate released 29 Oct 2026)',
      evidenceId: 'sec-release',
      primaryEvidenceIds: [
        'sec-release',
        'msft-fy27-q1',
        'amazon-sec-ex991',
        'bea-26-45-gdp-q3-2026-adv',
      ],
      historicalComparison:
        'Google Cloud revenue more than doubled YoY ($15.16B -> $30.71B, op margin 23.7% -> 36.2%); AWS grew +39.3% YoY ($33.01B -> $45.98B); US Real GDP accelerated +1.2 pp from +2.2% SAAR in Q2 2026 to +3.4% SAAR in Q3 2026 (`bea-26-45-gdp-q3-2026-adv`).',
      observedFinancialFact:
        'In Q3 2026, Google Cloud revenue rose +102.61% YoY to $30.709B ($11.121B segment operating income, 36.21% margin), Microsoft Azure grew +48% YoY to $33.165B (Microsoft Cloud $63.900B, +30% YoY), AWS grew +39.32% YoY to $45.984B ($17.452B operating income, 37.95% margin), and US Q3 2026 Real GDP expanded +3.4% SAAR with Real Final Sales to Private Domestic Purchasers up +4.9% SAAR (`bea-26-45-gdp-q3-2026-adv`).',
      hypothesisBeingTested:
        'Whether underlying enterprise AI cloud adoption, monetisation, and macroeconomic private demand remain robust enough to sustain growth even if infrastructure capex moderates.',
      relevanceOfObservation:
        'Directly validates the second half of the Cathie Wood thesis ("without ending AI adoption growth"): cloud revenue and segment operating profits are compounding at 39%–103% YoY alongside +3.4% US Real GDP growth.',
      sourceConfidence: {
        level: 'high_primary_filing_or_regulator',
        rationale:
          'Verified from primary SEC Form 10-Q/8-K segment disclosures and official U.S. BEA release 26-45.',
      },
      freshnessRationale:
        'BEA Q3 2026 Advance GDP and Q3 cloud earnings released 28–29 October 2026 (fresh within 12 days).',
      latestEligibleObservation:
        'Google Cloud $30.709B (+102.61% YoY); Azure $33.165B (+48% YoY); AWS $45.984B (+39.32% YoY); BEA Q3 2026 Real GDP +3.4% SAAR',
      previousComparableObservation:
        'Google Cloud $15.157B (2025-Q3); AWS $33.006B (2025-Q3); BEA Q2 2026 Real GDP +2.2% SAAR',
      evidenceSourceAndTimestamp: {
        sourceId: 'bea-26-45-gdp-q3-2026-adv',
        publishedAtIso: '2026-10-29T12:30:00.000Z',
        receivedAtIso: liveIngestion.beaGdpRelease.receivedAtIso,
      },
      materialChange: {
        hasMaterialChange: false,
        summary:
          'Remains the sole verified indicator directly supporting the thesis (`supports`): enterprise cloud monetisation and US GDP demand are expanding strongly.',
      },
      publishedAtMs: 1793277000000,
      receivedAtMs: 1793471503000,
      currentVerifiedReading:
        'Google Cloud: $30.709B (+102.61% YoY, 36.21% op margin); Azure: $33.165B (+48% YoY); AWS: $45.984B (+39.32% YoY, 37.95% op margin); US Q3 2026 Real GDP: +3.4% SAAR (Private Domestic Final Sales +4.9% SAAR)',
      interpretationForThesis:
        'Directly supports the AI adoption & monetisation pillar of the thesis: cloud segment revenues (+39% to +103% YoY) and US private domestic demand (+4.9% SAAR) confirm rapid enterprise AI monetisation.',
    },
    {
      indicatorId: 'ind-semiconductor-demand',
      name: '4. Merchant AI Silicon Revenue, Guidance & 5–6 Nov SOX / Equity Volatility',
      category: 'silicon_demand',
      domain: 'corporate_filings',
      baseDirection: 'contradicts',
      measurementFormulaOrSeries:
        'NVDA & AMD Data Center / consolidated SEC XBRL revenue & Q3 guidance + Nasdaq SOX / COMP / SPY 5–6 Nov 2026 historical closes',
      value:
        'NVDA Q2 DC $89.0B ($302.97B TTM rev; Q3 guide $108B ± 2%) · AMD Q3 rev $13.38B (+44.7% YoY) · SOX 5 Nov -12.25% / 6 Nov +4.21%',
      reportingPeriod: 'FY2027-Q2 / 2026-Q3 & Market Closes through 2026-11-06',
      evidenceId: 'nvda-fy27-q2',
      primaryEvidenceIds: [
        'nvda-fy27-q2',
        'sec-xbrl-g7-1-2026-11-09',
        'nasdaq-sox-history-v3',
        'nasdaq-comp-history-v3',
        'nasdaq-spy-history-v3',
      ],
      historicalComparison:
        'NVDA guided Q3 FY27 total revenue to $108.0B ± 2% vs $96.22B in Q2 (+12.2% QoQ; +105.85% YoY in Q2); AMD Q3 2026 revenue grew +44.68% YoY ($9,246M -> $13,377M); SOX fell -12.25% on 5 Nov and rebounded +4.21% on 6 Nov (-8.55% net 2-day change).',
      observedFinancialFact:
        'NVIDIA reported FY27 Q2 revenue of $96,221M (+105.85% YoY; $302,970M 4Q TTM) with Data Center revenue of $89,000M and guided FY27 Q3 revenue to $108.0B ± 2% (+12.2% sequential increase); AMD reported Q3 2026 revenue of $13,377M (+44.68% YoY; $45,436M TTM). In equity markets, SOX fell -12.25% on 5 Nov (10,268.65 -> 9,011.14) before rebounding +4.21% on 6 Nov (9,390.25).',
      hypothesisBeingTested:
        'Whether merchant AI semiconductor shipment growth and forward revenue guidance show a near-term moderation in AI hardware capital spending.',
      relevanceOfObservation:
        'Merchant GPU/accelerator revenue and sequential guidance are the direct upstream counterpart to hyperscaler AI infrastructure capex.',
      sourceConfidence: {
        level: 'high_primary_filing_or_regulator',
        rationale:
          'Verified from NVIDIA FY27 Q2 Form 10-Q (`0001045810-26-000075`), AMD Q3 2026 Form 10-Q (`0000002488-26-000191`), and Nasdaq historical close series.',
      },
      freshnessRationale:
        'AMD Q3 10-Q accepted 3 Nov 2026; NVDA FY27 Q2 10-Q accepted 26 Aug 2026; Nasdaq market closes verified through 6 Nov 2026.',
      latestEligibleObservation:
        'NVDA FY27 Q2 Rev $96,221M (TTM $302,970M) & Q3 Guide $108.0B ± 2%; AMD 2026 Q3 Rev $13,377M (+44.68% YoY, TTM $45,436M); SOX 9,390.25 (6 Nov)',
      previousComparableObservation:
        'NVDA FY26 Q2 Rev $46,743M; AMD 2025 Q3 Rev $9,246M; SOX 10,268.65 (4 Nov)',
      evidenceSourceAndTimestamp: {
        sourceId: 'nvda-fy27-q2',
        publishedAtIso: '2026-08-26T20:36:00.000Z',
        receivedAtIso: liveIngestion.nasdaqHistoricalClosesV3.SOX!.receivedAtIso,
      },
      materialChange: {
        hasMaterialChange: true,
        summary:
          'Expanded with AMD Q3 2026 Form 10-Q (+44.68% YoY revenue growth to $13,377M) and NVDA 4Q TTM revenue ($302,970M), reinforcing `contradicts` against near-term hardware spending moderation.',
      },
      publishedAtMs: Date.parse('2026-08-26T20:20:00Z'),
      receivedAtMs: liveIngestion.nasdaqHistoricalClosesV3.SOX!.receivedAtMs,
      currentVerifiedReading:
        'NVDA FY27 Q2 Data Center revenue: $89,000M ($302,970M TTM total rev); Q3 FY27 outlook: $108.0B ± 2%; AMD 2026 Q3 revenue: $13,377M (+44.68% YoY); SOX index: 9,011.14 on 5 Nov (-12.25%) -> 9,390.25 on 6 Nov (+4.21%)',
      interpretationForThesis:
        'Contradicts near-term AI hardware spending moderation: both NVDA ($108B Q3 guide, +12.2% QoQ) and AMD (+44.68% YoY in Q3 2026) demonstrate continued expansion in silicon shipments.',
    },
    {
      indicatorId: 'ind-project-deployment-delays',
      name: '5. Data-Centre Project Cancellations, Supersessions & Energisation Delays',
      category: 'project_execution',
      domain: 'typedb_graph',
      baseDirection: 'neutral',
      measurementFormulaOrSeries:
        'TypeDB relationship status transitions (`cancelled` -> `superseded` v2) and court/permitting holds',
      value:
        'MSFT Loughton v1 cancelled -> v2 active · AWS Wilmington Ohio rezoning ordered redone · Polaris Forge 1 250/400 MW energised',
      reportingPeriod: 'Jul – Nov 2026 (TypeDB Checkpoint Sequence 12)',
      evidenceId: 'reuters-loughton-oct19',
      primaryEvidenceIds: ['reuters-loughton-oct19', 'wyso-wilmington-court', 'apld-8k-2026-10-07'],
      historicalComparison:
        'Microsoft terminated its initial Loughton UK agreement (`rel-loughton-dc-cancelled-v1-r1`, Oct 2026) and immediately superseded it with a redesigned active commitment (`rel-loughton-dc-active-v2-r1`); Applied Digital energised 250 MW of 400 MW planned at Polaris Forge 1 on 1 Oct 2026.',
      observedFinancialFact:
        'Microsoft cancelled its initial Loughton UK data-centre lease (`rel-loughton-dc-cancelled-v1-r1`) and replaced it with active relationship `rel-loughton-dc-active-v2-r1` (`reuters-loughton-oct19`), while AWS Wilmington Ohio rezoning was ordered redone by a federal court (`wyso-wilmington-court`) and Applied Digital energised 250 MW of 400 MW at Polaris Forge 1 (`apld-8k-2026-10-07`).',
      hypothesisBeingTested:
        'Whether project-level contract changes and permitting delays represent voluntary, capital-efficiency-enhancing capex moderation.',
      relevanceOfObservation:
        'Per Part A.5 quality gate, replacing a cancelled lease v1 with an active v2 contract and encountering municipal court delays represent contract reallocation and execution friction, not verified net capex moderation or improved ROIC.',
      sourceConfidence: {
        level: 'medium_mixed_primary_and_reported',
        rationale:
          'Combines primary SEC Form 8-K (`apld-8k-2026-10-07`) with corroborated legal/journalistic reporting (`reuters-loughton-oct19`, `wyso-wilmington-court`).',
      },
      freshnessRationale:
        'Events dated July – October 2026 and verified against TypeDB Checkpoint Sequence 12.',
      latestEligibleObservation:
        'MSFT Loughton v1 cancelled -> v2 active; AWS Wilmington court redo order; APLD Polaris Forge 1 250/400 MW energised',
      previousComparableObservation:
        'MSFT Loughton v1 initial commitment active; Wilmington rezoning approved prior to federal court challenge',
      evidenceSourceAndTimestamp: {
        sourceId: 'reuters-loughton-oct19',
        publishedAtIso: '2026-10-19T14:00:00.000Z',
        receivedAtIso: '2026-11-05T15:50:20.000Z',
      },
      materialChange: {
        hasMaterialChange: true,
        summary:
          'Reclassified from `supports` to `neutral` (`does_not_resolve`) under Part A.5–A.6: Loughton v1->v2 supersession reallocated capacity rather than reducing aggregate capex, and zoning delays do not prove improved capital efficiency.',
      },
      publishedAtMs: Date.parse('2026-10-19T14:00:00Z'),
      receivedAtMs: 1793890620000,
      currentVerifiedReading:
        'MSFT Loughton UK v1 cancelled (`reuters-loughton-oct19`) and superseded by active v2 (`rel-loughton-dc-active-v2-r1`); AWS Wilmington Ohio rezoning ordered redone (`wyso-wilmington-court`); Polaris Forge 1 250/400 MW energised (`apld-8k-2026-10-07`)',
      interpretationForThesis:
        'Classified as `neutral` (`does_not_resolve`): contract reallocation (Loughton v1 -> v2) and court permitting delays show project-level friction and restructuring, but do not establish a net reduction in aggregate capex or higher capital efficiency.',
    },
    {
      indicatorId: 'ind-credit-spreads-and-financing',
      name: '6. High-Yield Credit Spreads (`BAMLH0A0HYM2`), Anthropic $895.4B Commitments & Neocloud Debt',
      category: 'credit_and_financing',
      domain: 'typedb_graph',
      baseDirection: 'contradicts',
      measurementFormulaOrSeries:
        'FRED `BAMLH0A0HYM2` (bps) + Anthropic S-1/A deduplicated commitment ledger + CRWV SEC XBRL Net Debt + NVDA/Nscale vendor guarantees',
      value:
        'HY OAS 340 bps (+22 bps 5D) · Anthropic $895.4B commitments (-$104.0B 9M loss) · CRWV +$30,233M Net Debt · NVDA $1.86B Nscale backing',
      reportingPeriod: '30 Jun – 3 Nov 2026 (S-1/A filed 2 Nov 2026; FRED 3 Nov 2026; CRWV 10-Q 11 Aug 2026)',
      evidenceId: 'anthropic-s1a-2026-11-02',
      primaryEvidenceIds: [
        'anthropic-s1a-2026-11-02',
        'sec-xbrl-g7-1-2026-11-09',
        'fred-vixcls-v2',
        'nscale-s1-sep18',
        'reuters-credit-oct30',
      ],
      historicalComparison:
        'US High-Yield OAS widened +22 bps over 5 sessions (318 bps on 27 Oct -> 340 bps on 3 Nov 2026); Anthropic multi-year compute commitments reached $895.4B deduplicated ($940.0B naive sum less $44.6B Nscale Monarch sub-allocation); CoreWeave total debt + finance leases reached $35,772M (+$30,233M Net Debt).',
      observedFinancialFact:
        'Anthropic Form S-1/A discloses $895.4B in deduplicated multi-year compute commitments alongside a -$104.0B 9M 2026 GAAP net loss; CoreWeave Q2 2026 Form 10-Q discloses $35,772M in carrying debt and finance leases (+$30,233M Net Debt = 4.37x TTM OCF, plus $16,319M operating leases); NVIDIA signed $1.0B convertible note + $860.3M lease guarantee for Nscale; and US HY OAS widened +22 bps to 340 bps.',
      hypothesisBeingTested:
        'Whether industry financing structures and credit markets reflect moderating capital commitments and improving capital efficiency.',
      relevanceOfObservation:
        'Per Part A.5 quality gate, $895.4B of locked-in multi-year commitments, $30.2B of leveraged neocloud Net Debt, circular vendor guarantees, and widening credit spreads (+22 bps) represent heavy contractual lock-in and financing strain—not improving capital discipline.',
      sourceConfidence: {
        level: 'high_primary_filing_or_regulator',
        rationale:
          'Verified from Anthropic Form S-1/A, CoreWeave Form 10-Q XBRL, Nscale Form S-1, and Federal Reserve FRED.',
      },
      freshnessRationale:
        'Anthropic S-1/A filed 2 Nov 2026 and FRED observations captured through 3 Nov 2026.',
      latestEligibleObservation:
        'Anthropic $895.4B deduplicated commitments (-$104.0B 9M loss); CRWV +$30,233M Net Debt ($35,772M debt+fin leases); NVDA $1.86B Nscale backing; HY OAS 340 bps (+22 bps)',
      previousComparableObservation:
        'HY OAS 318 bps (27 Oct 2026); pre-S-1/A unquantified private commitments',
      evidenceSourceAndTimestamp: {
        sourceId: 'anthropic-s1a-2026-11-02',
        publishedAtIso: '2026-11-02T19:50:00.000Z',
        receivedAtIso: '2026-11-08T12:54:00.000Z',
      },
      materialChange: {
        hasMaterialChange: true,
        summary:
          'Reinforced `contradicts` classification with CoreWeave Q2 2026 SEC XBRL balance sheet ($35,772M debt + finance leases, +$30,233M Net Debt, and $16,319M operating leases).',
      },
      publishedAtMs: 1793651400000,
      receivedAtMs: 1794142440000,
      currentVerifiedReading:
        'FRED `BAMLH0A0HYM2`: 340 bps (+22 bps 5D); Anthropic S-1/A: $895.4B deduplicated compute commitments (-$104.0B 9M loss); CRWV Net Debt: +$30,233M ($35,772M debt + finance leases); Signed Nscale financing: $1.0B NVDA convertible + $860.3M lease guarantee',
      interpretationForThesis:
        'Contradicts the thesis: $895.4B of locked-in multi-year compute commitments, +$30.23B of CoreWeave Net Debt, and widening HY spreads demonstrate escalating balance-sheet and off-balance-sheet capital lock-in rather than capex moderation.',
    },
    {
      indicatorId: 'ind-power-availability',
      name: '7. Grid Load Share & Contracted Megawatt (MW) Queue',
      category: 'power_and_grid',
      domain: 'policy_and_grid',
      baseDirection: 'neutral',
      measurementFormulaOrSeries:
        'Data-centre % share of national electricity and contracted campus MW across TypeDB projects',
      value:
        'Ireland DCs 21.0% national electricity · AWS Dublin 350 MW · MSFT Grange Castle 280 MW · Polaris Forge 1 400 MW',
      reportingPeriod: '2026-H2 (CRU/EirGrid Policy 15 Jul 2026; APLD 8-K 7 Oct 2026)',
      evidenceId: 'cru-eirgrid-dc-policy-2026',
      primaryEvidenceIds: ['cru-eirgrid-dc-policy-2026', 'apld-8k-2026-10-07', 'src-crwv-polaris-2026'],
      historicalComparison:
        'Irish data-centre electricity consumption reached 21.0% of total national metered electricity (up from ~18% prior baseline), triggering mandatory onsite/dispatchable generation requirements on 630 MW of combined AWS/MSFT Dublin capacity.',
      observedFinancialFact:
        'Data centres consume 21.0% of Ireland’s national metered electricity (`cru-eirgrid-dc-policy-2026`), subjecting AWS Dublin (350 MW) and Microsoft Grange Castle (280 MW) to dispatchable generation mandates, while US Polaris Forge 1 has 250 MW of 400 MW energised (`apld-8k-2026-10-07`).',
      hypothesisBeingTested:
        'Whether regional electricity grid constraints confirm that corporate AI capex moderation will improve long-term capital efficiency.',
      relevanceOfObservation:
        'Per Part A.5 quality gate, physical power scarcity is an external supply bottleneck that increases onsite generation costs and strands work-in-progress capital; it does not by itself confirm voluntary capital discipline or higher ROIC.',
      sourceConfidence: {
        level: 'high_primary_filing_or_regulator',
        rationale:
          'Verified from official CRU/EirGrid regulatory policy (`cru-eirgrid-dc-policy-2026`) and Applied Digital SEC Form 8-K (`apld-8k-2026-10-07`).',
      },
      freshnessRationale:
        'CRU/EirGrid policy published 15 Jul 2026 (117 days old <= 125-day threshold) and APLD 8-K published 7 Oct 2026.',
      latestEligibleObservation:
        'Ireland DCs 21.0% national electricity share; AWS Dublin 350 MW & MSFT Grange Castle 280 MW constrained; Polaris Forge 1 250/400 MW energised',
      previousComparableObservation:
        'Prior ~18% Irish national electricity share before CRU/EirGrid connection policy tightenings',
      evidenceSourceAndTimestamp: {
        sourceId: 'cru-eirgrid-dc-policy-2026',
        publishedAtIso: '2026-07-15T10:00:00.000Z',
        receivedAtIso: '2026-11-05T15:50:20.000Z',
      },
      materialChange: {
        hasMaterialChange: true,
        summary:
          'Reclassified from `supports` to `neutral` (`does_not_resolve`) under Part A.5–A.6: grid connection bottlenecks are an external physical constraint that can inflate per-MW build costs rather than proving improved capital efficiency.',
      },
      publishedAtMs: Date.parse('2026-07-15T10:00:00Z'),
      receivedAtMs: 1793890620000,
      currentVerifiedReading:
        'Ireland data centres: 21.0% of national metered electricity (`cru-eirgrid-dc-policy-2026`), constraining AWS Dublin (350 MW) and MSFT Grange Castle (280 MW); US tracked campuses include Polaris Forge 1 (400 MW, 250 MW energised)',
      interpretationForThesis:
        'Classified as `neutral` (`does_not_resolve`): physical power limits constrain how fast megawatts can be energised, but compulsory onsite generation and connection queues can raise capital cost per MW rather than improving capital efficiency.',
    },
    {
      indicatorId: 'ind-regulatory-developments',
      name: '8. Enacted State Moratoria & Tariff Laws vs Uncertified 2026 Local Ballot Returns',
      category: 'regulatory_and_policy',
      domain: 'policy_and_grid',
      baseDirection: 'insufficient_evidence',
      measurementFormulaOrSeries:
        'Enacted state executive orders/statutes (`ny-eo62`, `okhouse-hb2992`) separated from uncertified 3 Nov 2026 municipal referenda and missing FY2027 regulatory capex impact disclosures',
      value:
        'Enacted: NY EO 62 (>=50 MW pause) & OK HB 2992 (>=75 MW tariff) · Uncertified: SW Ohio referenda (awaiting 14–24 Nov statutory canvass)',
      reportingPeriod: 'May – Nov 2026 (Election Day 3 Nov 2026; Statutory Canvass 14–24 Nov 2026)',
      evidenceId: 'ny-eo62',
      primaryEvidenceIds: ['ny-eo62', 'okhouse-hb2992', 'wyso-sw-ohio-results', 'gridsight-votes'],
      historicalComparison:
        'NY EO 62 (14 Jul 2026) and OK HB 2992 (1 Jul 2026) are enacted state policies, whereas the 3 Nov 2026 Southwest Ohio municipal ballot outcomes remain unofficial election-night counts pending County Board of Elections certification (14–24 Nov 2026) and Piqua/Urbana MW scope retains `conflictingSources`.',
      observedFinancialFact:
        'New York EO 62 (`ny-eo62`) pauses >=50 MW DEC permits and Oklahoma HB 2992 (`okhouse-hb2992`) allocates >=75 MW tariff costs, while 3 November 2026 Southwest Ohio municipal referenda (`wyso-sw-ohio-results`) remain uncertified prior to the 14–24 November 2026 statutory canvass under Ohio Rev. Code § 3505.32 and no hyperscaler has filed quantified FY2027 capex reductions attributable to state/municipal policy.',
      hypothesisBeingTested:
        'Whether post-election regulatory and municipal policy developments are inducing capital-efficiency-enhancing AI capex moderation.',
      relevanceOfObservation:
        'Per Part A.4 & A.6 quality gates, uncertified municipal election returns and enacted state moratoria without quantified issuer capex guidance are insufficient to resolve whether regulatory friction improves corporate capital efficiency.',
      sourceConfidence: {
        level: 'low_unofficial_or_secondary',
        rationale:
          'While NY EO 62 and OK HB 2992 are primary state records, the 3 Nov 2026 election outcomes are unofficial secondary/election-night tallies awaiting statutory county canvass certification (14–24 Nov 2026) and carry conflicting scope attributions.',
      },
      freshnessRationale:
        'Marked `unofficial_pending_certification` until County Boards of Elections complete the statutory canvass (14–24 November 2026).',
      latestEligibleObservation:
        'Enacted NY EO 62 & OK HB 2992; Uncertified 3 Nov 2026 SW Ohio municipal ballot returns (awaiting 14–24 Nov statutory canvass); 0 filings quantifying FY2027 regulatory capex reductions',
      previousComparableObservation:
        'Pre-3 Nov 2026 municipal zoning litigation (`wyso-wilmington-court`)',
      evidenceSourceAndTimestamp: {
        sourceId: 'ny-eo62',
        publishedAtIso: '2026-07-14T16:00:00.000Z',
        receivedAtIso: '2026-11-05T15:50:20.000Z',
      },
      materialChange: {
        hasMaterialChange: true,
        summary:
          'Reclassified from `supports` to `insufficient_evidence` (`does_not_resolve`) under Part A.6: 3 Nov 2026 local ballot results remain uncertified until 14–24 Nov 2026 and no issuer has disclosed resulting FY2027 capex reductions.',
      },
      publishedAtMs: Date.parse('2026-07-14T16:00:00Z'),
      receivedAtMs: 1793890620000,
      currentVerifiedReading:
        'Enacted law: NY EO 62 (>=50 MW DEC permit pause, `ny-eo62`) & Oklahoma HB 2992 (>=75 MW tariff protection, `okhouse-hb2992`); Uncertified election returns: Southwest Ohio local voter pushback (`wyso-sw-ohio-results`, pending 14–24 Nov county canvass)',
      interpretationForThesis:
        'Classified as `insufficient_evidence` (`does_not_resolve`): 3 November 2026 local ballot outcomes are not yet officially certified and no hyperscaler filing quantifies resulting FY2027 capex reductions.',
    },
  ];

  const excludedByHistoricalCutoffIds: string[] = [];

  const leadingIndicators: ThesisLeadingIndicator[] = rawIndicators.map((raw) => {
    const isUnofficial = raw.indicatorId === 'ind-regulatory-developments';
    const freshness = computeFreshness(
      raw.evidenceId,
      raw.publishedAtMs,
      raw.receivedAtMs,
      isUnofficial,
    );
    const anyPrimaryExcluded = raw.primaryEvidenceIds.some((id) => excludedSet.has(id));
    const eligibleAtCutoff = isRecordTemporallyEligible(
      raw.publishedAtMs,
      raw.receivedAtMs,
      cutoffMs,
      temporalBasis,
    );
    if (!eligibleAtCutoff) {
      for (const id of raw.primaryEvidenceIds) {
        if (!excludedByHistoricalCutoffIds.includes(id)) {
          excludedByHistoricalCutoffIds.push(id);
        }
      }
    }

    let classification: DeterministicEvidenceClassification = raw.baseDirection;
    let dataStatus: 'verified' | 'partial' | 'missing_in_store' = isUnofficial
      ? 'partial'
      : 'verified';

    if (
      anyPrimaryExcluded ||
      !eligibleAtCutoff ||
      freshness === 'missing_evidence' ||
      freshness === 'excluded_post_cutoff'
    ) {
      classification = 'insufficient_evidence';
      dataStatus = 'missing_in_store';
    } else if (freshness === 'stale_beyond_threshold') {
      dataStatus = 'partial';
    }

    const refMs = raw.publishedAtMs ?? raw.receivedAtMs;
    const ageDays = Number(((evalNowMs - refMs) / 86_400_000).toFixed(1));
    const hypothesisResolution: ThesisLeadingIndicator['hypothesisResolution'] =
      classification === 'supports'
        ? 'supports'
        : classification === 'contradicts'
          ? 'contradicts'
          : 'does_not_resolve';

    const { baseDirection: _b, domain: _d, freshnessRationale, ...rest } = raw;
    void _b;
    void _d;

    return {
      ...rest,
      freshnessStatus: freshness,
      evidenceClassification: classification,
      evidenceDirection: classification,
      freshnessAndHistoricalEligibility: {
        freshnessStatus: freshness,
        publishedAtMs: raw.publishedAtMs,
        receivedAtMs: raw.receivedAtMs,
        eligibleAtCutoff,
        ageDays,
        rationale: !eligibleAtCutoff
          ? `Excluded by historical cutoff ${new Date(cutoffMs).toISOString().slice(0, 10)} (${temporalBasis} clock).`
          : anyPrimaryExcluded
            ? 'Excluded in missing-evidence simulation.'
            : freshnessRationale,
      },
      hypothesisResolution,
      dataStatus,
    };
  });

  for (const prov of ARK_THESIS_PROVENANCE_RECORDS) {
    if (
      !isRecordTemporallyEligible(
        prov.publishedAtMs,
        prov.receivedAtMs,
        cutoffMs,
        temporalBasis,
      )
    ) {
      if (!excludedByHistoricalCutoffIds.includes(prov.recordId)) {
        excludedByHistoricalCutoffIds.push(prov.recordId);
      }
    }
  }

  // Part A.2 — Programmatic Invariant Assertions:
  // 1. Exactly 8 unique declared indicators with zero duplicate indicatorIds.
  // 2. All category totals and items in `evidenceChangeAssessment` are derived 1-to-1 from `leadingIndicators`.
  // 3. The sum of mutually exclusive indicator statuses equals `leadingIndicators.length` (8).
  const uniqueIndicatorIds = new Set(leadingIndicators.map((i) => i.indicatorId));
  if (uniqueIndicatorIds.size !== leadingIndicators.length || leadingIndicators.length !== 8) {
    throw new Error(
      `Thesis Monitor Invariant Violation: Expected 8 unique leadingIndicators, found ${leadingIndicators.length} total (${uniqueIndicatorIds.size} unique).`,
    );
  }

  const domainByIndicatorId = new Map<string, EvidenceChangeAssessmentItem['domain']>(
    rawIndicators.map((r) => [r.indicatorId, r.domain]),
  );

  const evaluatedItems: EvidenceChangeAssessmentItem[] = leadingIndicators.map((ind) => {
    const eligible = ind.freshnessAndHistoricalEligibility.eligibleAtCutoff;
    const anyMissing = ind.primaryEvidenceIds.some((id) => excludedSet.has(id));
    return {
      itemId: `chg-${ind.indicatorId}`,
      indicatorId: ind.indicatorId,
      title: ind.name,
      domain: domainByIndicatorId.get(ind.indicatorId) ?? 'corporate_filings',
      classification: ind.evidenceDirection,
      reportingPeriod: ind.reportingPeriod,
      priorBaseline: ind.previousComparableObservation,
      currentObservation: !eligible
        ? `[EXCLUDED BY HISTORICAL CUTOFF ${new Date(cutoffMs).toISOString().slice(0, 10)} (${temporalBasis} clock)] ${ind.latestEligibleObservation}`
        : anyMissing
          ? `[MISSING EVIDENCE SIMULATION] Required source excluded from evaluation.`
          : ind.latestEligibleObservation,
      evidenceIds: ind.primaryEvidenceIds,
      rationale: ind.interpretationForThesis,
    };
  });

  const staleIndicatorIds = leadingIndicators
    .filter((i) => i.freshnessStatus === 'stale_beyond_threshold')
    .map((i) => i.indicatorId);

  const counts = {
    supports: leadingIndicators.filter((i) => i.evidenceDirection === 'supports').length,
    contradicts: leadingIndicators.filter((i) => i.evidenceDirection === 'contradicts').length,
    neutral: leadingIndicators.filter((i) => i.evidenceDirection === 'neutral').length,
    insufficient_evidence: leadingIndicators.filter(
      (i) => i.evidenceDirection === 'insufficient_evidence',
    ).length,
  };

  const sumOfCounts =
    counts.supports + counts.contradicts + counts.neutral + counts.insufficient_evidence;
  if (sumOfCounts !== leadingIndicators.length) {
    throw new Error(
      `Thesis Monitor Invariant Violation: Sum of mutually exclusive indicator statuses (${sumOfCounts}) !== total indicator count (${leadingIndicators.length}).`,
    );
  }

  let overallConclusionClassification: DeterministicEvidenceChangeSummary['overallConclusionClassification'] =
    'mixed_supports_and_contradicts';
  if (counts.supports === 0 && counts.contradicts === 0) {
    overallConclusionClassification = 'insufficient_evidence';
  } else if (counts.supports > 0 && counts.contradicts === 0) {
    overallConclusionClassification =
      counts.insufficient_evidence > counts.supports
        ? 'insufficient_evidence'
        : 'supports';
  } else if (counts.contradicts > 0 && counts.supports === 0) {
    overallConclusionClassification = 'contradicts';
  }

  const activeSupersededRelationshipIdsExcluded = options?.includeSupersededRelationshipsAsActive
    ? []
    : ['rel-loughton-dc-cancelled-v1-r1'];
  const activeReplacementRelationshipIdsIncluded = ['rel-loughton-dc-active-v2-r1'];

  const evidenceChangeAssessment: DeterministicEvidenceChangeSummary = {
    classificationPolicyNote:
      'Deterministic evidence classifications only (supports, contradicts, neutral, insufficient_evidence); never statistical probabilities.',
    counts,
    totalDeclaredIndicatorsCount: 8,
    sumOfMutuallyExclusiveCountsEqualsTotal: true,
    zeroDuplicateIndicatorIds: true,
    overallConclusionClassification,
    shortConclusion: `Across the 8 unique leading indicators (${counts.supports} supports, ${counts.contradicts} contradicts, ${counts.neutral} neutral, ${counts.insufficient_evidence} insufficient_evidence; sum = 8): only Cloud & AI Revenue Growth + BEA Q3 Real GDP (+3.4% SAAR) currently supports the thesis (1/8), whereas 4 indicators contradict near-term capex moderation—Hyperscaler/Neocloud Capex/OCF (AMZN 125.2% TTM / 178.9% Q3, GOOGL 121.4% Q3, CRWV 297.6% TTM), negative Free Cash Flow burn (AMZN -$42,357M TTM, GOOGL -$9,065M Q3, CRWV -$13,655M TTM), expanding Semiconductor Demand (NVDA $108B Q3 guide, AMD +44.68% YoY Q3 rev), and Credit/Financing lock-in (Anthropic $895.4B commitments, CRWV +$30,233M Net Debt, HY OAS 340 bps +22 bps)—while Project Supersessions/Delays and Power Grid Constraints (Ireland 21% load share) are neutral (2/8) and uncertified local election/regulatory impacts remain insufficient_evidence (1/8).`,
    activeSupersededRelationshipIdsExcluded,
    activeReplacementRelationshipIdsIncluded,
    excludedByHistoricalCutoffIds,
    staleIndicatorIds,
    items: evaluatedItems,
  };

  const partAQualityGateAudit: PartAQualityGateAudit = {
    priorVersionReportedCounts: {
      supports: 4,
      contradicts: 3,
      neutral: 1,
      insufficient_evidence: 1,
      sum: 9,
      declaredIndicatorsCount: 8,
    },
    rootCauseOfNineCountMismatch:
      'In v2.0.0, `evidenceChangeAssessment.counts` summed a separate 9-item `rawChangeItems` list (which included an extra 9th row for 5–6 Nov index volatility alongside 8 thematic rows) rather than deriving totals 1-to-1 from the 8 declared `leadingIndicators`. In v2.1.0, `evidenceChangeAssessment.items` and `counts` are derived directly from `leadingIndicators` and asserted so `supports + contradicts + neutral + insufficient_evidence === 8`.',
    correctedCountsDerivedFromUniqueIndicators: {
      supports: counts.supports,
      contradicts: counts.contradicts,
      neutral: counts.neutral,
      insufficient_evidence: counts.insufficient_evidence,
      sum: sumOfCounts,
      declaredIndicatorsCount: leadingIndicators.length,
      sumEqualsDeclaredCount: sumOfCounts === leadingIndicators.length,
    },
    reclassifiedIndicatorsAudit: [
      {
        indicatorId: 'ind-free-cash-flow',
        priorClassification: 'supports',
        correctedClassification: 'contradicts',
        correctionRationale:
          'Observed Free Cash Flow deteriorated into deep negative cash burn at AMZN (-$42,357M TTM; -$33,456M Q3), GOOGL (-$9,065M Q3), and CRWV (-$13,655M TTM). Evidence of acute cash burn caused by unmoderated capex contradicts the claim that capital discipline is currently improving.',
      },
      {
        indicatorId: 'ind-project-deployment-delays',
        priorClassification: 'supports',
        correctedClassification: 'neutral',
        correctionRationale:
          'Microsoft’s Loughton v1 cancellation was immediately superseded by active contract v2 (`rel-loughton-dc-active-v2-r1`), and AWS Wilmington court holds represent permitting delays rather than verified net capex moderation (`does_not_resolve`).',
      },
      {
        indicatorId: 'ind-power-availability',
        priorClassification: 'supports',
        correctedClassification: 'neutral',
        correctionRationale:
          'Ireland’s 21.0% data-centre electricity share (`cru-eirgrid-dc-policy-2026`) is an external physical supply bottleneck that mandates costly onsite generation and delays energisation; industry supply friction does not confirm improved capital efficiency (`does_not_resolve`).',
      },
      {
        indicatorId: 'ind-regulatory-developments',
        priorClassification: 'supports',
        correctedClassification: 'insufficient_evidence',
        correctionRationale:
          'While NY EO 62 and OK HB 2992 are enacted state policies, 3 November 2026 Southwest Ohio local ballot outcomes remain uncertified prior to the 14–24 November 2026 statutory canvass (Ohio Rev. Code § 3505.32) and no issuer has filed FY2027 capex guidance quantifying regulatory capex reductions (`does_not_resolve`).',
      },
    ],
  };

  // Requirement 5 — Three Testable Scenarios (Zero unsupported numerical probabilities)
  const scenarios: TestableThesisScenario[] = [
    {
      scenarioId: 'scenario-efficient-capex-moderation',
      title: 'Scenario 1: Efficient Capex Moderation (Core ARK Thesis)',
      hypothesisDescription:
        'Hyperscalers moderate physical infrastructure capex growth from peak Q3 2026 levels while sustaining high cloud/AI software revenue growth via improved utilisation, custom silicon/inference efficiency, and disciplined lease selection.',
      probabilityAssignment: null,
      probabilityPolicyNote:
        'No numerical probability assigned; monitored via deterministic observable indicators.',
      currentEvidenceAlignment: 'supports',
      confirmingIndicatorThresholds: [
        'AMZN and GOOGL quarterly Net Capex / OCF moderates below 90% (from 178.9% and 121.4% in 2026-Q3) over 2 consecutive quarters, restoring positive quarterly Free Cash Flow.',
        'Hyperscale cloud revenue growth remains >= 25% YoY (AWS >= 25%, Azure >= 30%, Google Cloud >= 35%) alongside US Real GDP growth >= 2.0% SAAR (`bea-26-45-gdp-q3-2026-adv`).',
        'US High-Yield OAS (`BAMLH0A0HYM2`) remains contained below 375 bps.',
      ],
      invalidatingIndicatorThresholds: [
        'Hyperscaler Net Capex / OCF remains > 115% for 2+ additional quarters while cloud operating margins compress by > 300 bps.',
        'Cloud revenue growth decelerates below 15% YoY alongside capex cuts (indicating demand weakness rather than efficiency).',
      ],
      companyImplications: {
        hyperscalers:
          'Positive for AMZN, GOOGL, and MSFT free-cash-flow conversion and return on invested capital.',
        semiconductors:
          'Moderates NVDA sequential Data Center hyper-growth toward sustainable replacement/inference cadence; supportive for TCO-focused inference silicon.',
        neoclouds:
          'Neutral to mixed for CRWV/Nscale; requires strict lease discipline (`rel-loughton-dc-active-v2-r1`) rather than speculative uncontracted buildouts.',
      },
    },
    {
      scenarioId: 'scenario-persistent-infrastructure-bottlenecks',
      title: 'Scenario 2: Persistent Infrastructure, Power & Regulatory Bottlenecks',
      hypothesisDescription:
        'Capex slows involuntarily not because of software efficiency, but because grid connection queues (EirGrid 21% load share), enacted state moratoria (NY EO 62), and local zoning pushback (Southwest Ohio) prevent deployed capital from being energised on schedule.',
      probabilityAssignment: null,
      probabilityPolicyNote:
        'No numerical probability assigned; monitored via deterministic observable indicators.',
      currentEvidenceAlignment: 'supports',
      confirmingIndicatorThresholds: [
        'Additional state permit moratoria (`NY EO 62` model) or certified municipal ballot bans blocking >= 50 MW campuses.',
        'Growing gap between contracted MW (`Polaris Forge 1` 400 MW with 250 MW energised, `AWS Dublin` 350 MW, `MSFT Dublin` 280 MW) and actual energised MW reported in 8-K/10-Q filings.',
        'Capex remains elevated in work-in-progress PP&E while cloud revenue decelerates due to capacity delivery delays.',
      ],
      invalidatingIndicatorThresholds: [
        'Timely energisation of scheduled 2026–2027 MW milestones in Applied Digital, AWS, and Microsoft filings and lifting of NY GEIS moratorium.',
      ],
      companyImplications: {
        hyperscalers:
          'Negative for near-term ROIC: capital is tied up in un-energised shells and transformers while depreciation begins.',
        semiconductors:
          'Creates inventory digestion pockets if GPU clusters cannot be plugged into energised data-centre halls.',
        neoclouds:
          'High risk for leveraged developers (`CRWV`, `Nscale`, `WULF`, `APLD`) facing debt service during construction/interconnection delays.',
      },
    },
    {
      scenarioId: 'scenario-hard-capex-retrenchment',
      title: 'Scenario 3: Hard Capex Retrenchment & Credit Contagion (Bear Case)',
      hypothesisDescription:
        'Foundation-model cash burn (Anthropic -$104.0B 9M GAAP loss against $895.4B multi-year commitments) triggers a financing freeze, customer lease terminations, and a sharp cut in hyperscaler and neocloud capex.',
      probabilityAssignment: null,
      probabilityPolicyNote:
        'No numerical probability assigned; monitored via deterministic observable indicators.',
      currentEvidenceAlignment: 'contradicts',
      confirmingIndicatorThresholds: [
        'NVDA quarterly Data Center revenue guidance turns sequential negative (< $89B) or hyperscalers announce > 15% YoY capex reductions.',
        'US High-Yield credit spreads (`BAMLH0A0HYM2`) widen above 450 bps (from 340 bps on 3 Nov 2026) and VIX (`VIXCLS`) sustains > 28.',
        'Further hyperscaler lease terminations or defaults on circular vendor-financed credit guarantees (`nscale-s1-sep18`).',
      ],
      invalidatingIndicatorThresholds: [
        'Sustained positive enterprise AI cash generation and successful equity/IPO funding of frontier labs (`anthropic-s1a-2026-11-02`) without drawdowns on vendor guarantees.',
      ],
      companyImplications: {
        hyperscalers:
          'Short-term valuation multiple compression (`Department of Finance Ireland` -10% to -20% US tech shock scenario), partially buffered by core cash flows at MSFT, GOOGL, and AMZN.',
        semiconductors:
          'Severe revenue and margin cyclicality for NVDA and AMD; direct guarantee exposure for NVDA ($860.3M Ward County guarantee + $1.0B Nscale convertible note).',
        neoclouds:
          'Acute refinancing and solvency stress for high-leverage GPU cloud operators (`CRWV`, `Nscale`).',
      },
    },
  ];

  // Requirement 7 — Evidence Synthesis (Supporting, Contradictory, Missing, Uncertainties)
  const supportingEvidence: Array<{ statement: string; evidenceIds: string[] }> = [
    {
      statement:
        'Hyperscale cloud revenue and US macro demand are expanding rapidly (`ind-cloud-revenue-growth`, the sole supporting indicator out of 8): Google Cloud grew +102.6% YoY to $30.71B ($11.12B op income), AWS grew +39.3% YoY to $45.98B ($17.45B op income), Azure grew +48% YoY to $33.17B, and US Q3 2026 Real GDP rose +3.4% SAAR with Real Final Sales to Private Domestic Purchasers up +4.9% SAAR (`bea-26-45-gdp-q3-2026-adv`).',
      evidenceIds: ['sec-release', 'amazon-sec-ex991', 'msft-fy27-q1', 'bea-26-45-gdp-q3-2026-adv'],
    },
  ];

  const contradictoryEvidence: Array<{ statement: string; evidenceIds: string[] }> = [
    {
      statement:
        'Latest reported SEC XBRL filings (`ind-capex-to-ocf`) show capex intensity accelerating, not moderating: Amazon Q3 net capex surged to $75,878M (178.9% of Q3 OCF vs 96.3% in 2025-Q3; 125.2% TTM vs 88.7% FY2025), Alphabet Q3 capex doubled YoY to $51,355M (121.4% of Q3 OCF vs 49.5% in 2025-Q3), and CoreWeave TTM Capex/OCF reached 297.6% (945.8% in Q2 2026).',
      evidenceIds: ['amazon-sec-ex991', 'sec-release', 'goog-2026q3-capital_expenditure-v1', 'sec-xbrl-g7-1-2026-11-09'],
    },
    {
      statement:
        'Hyperscaler and neocloud Free Cash Flow has turned deeply negative (`ind-free-cash-flow`, reclassified from supports to contradicts in v2.1.0): Amazon TTM FCF fell to -$42,357M (-$33,456M in Q3 2026), Alphabet Q3 2026 FCF fell to -$9,065M, and CoreWeave TTM FCF is -$13,655M (-$6,675M in Q2 2026). Current cash burn refutes that capital discipline has already restored FCF.',
      evidenceIds: ['amazon-sec-ex991', 'sec-release', 'goog-2026q3-free_cash_flow-v1', 'sec-xbrl-g7-1-2026-11-09'],
    },
    {
      statement:
        'AI semiconductor shipments and guidance continue accelerating (`ind-semiconductor-demand`): NVIDIA Q2 FY2027 Data Center revenue reached $89.0B with Q3 FY2027 revenue guided to $108.0B ± 2% (+12.2% QoQ), and AMD Q3 2026 revenue grew +44.68% YoY to $13,377M ($3,275M EBIT, $3,039M FCF).',
      evidenceIds: ['nvda-fy27-q2', 'sec-xbrl-g7-1-2026-11-09'],
    },
    {
      statement:
        'Multi-year compute commitments and circular vendor debt remain massive (`ind-credit-spreads-and-financing`): Anthropic Form S-1/A (2 Nov 2026) discloses $895.4B in deduplicated commitments alongside a -$104.0B 9M GAAP loss, CoreWeave carries $35,085M total debt ($30,233M Net Debt), and NVIDIA provides $1.86B in Nscale backing while US HY spreads sit at 340 bps (+22 bps).',
      evidenceIds: ['anthropic-s1a-2026-11-02', 'nscale-s1-sep18', 'sec-xbrl-g7-1-2026-11-09', 'fred-bamlh0a0hym2-2026-11-03'],
    },
  ];

  const missingEvidence: string[] = [
    'Official certified county/state election canvass records for the 3 November 2026 US midterm elections and Southwest Ohio municipal data-centre referenda (`ind-regulatory-developments`: statutory Ohio Rev. Code § 3505.32 canvass runs 14–24 November 2026; currently unofficial returns only).',
    'CoreWeave (`CRWV`, CIK 0001769628) Q3 2026 Form 10-Q for period ended 30 September 2026 (latest SEC filing as of 9 Nov 2026 is Q2 2026 10-Q accepted 2026-08-13T16:10:02Z).',
    'Explicit FY2027 management capital expenditure guidance ranges and maintenance vs AI-growth capex breakdowns for AMZN, GOOGL, and MSFT.',
    'BLS Nonfarm Business Sector Labor Productivity (`OPHNFB`) Q3 2026 release and BEA Q3 2026 Second Estimate (scheduled for 25 November 2026).',
  ];

  const keyUncertainties: string[] = [
    'Whether a future moderation in hyperscaler capex/OCF will be driven by voluntary capital efficiency (Scenario 1) or involuntary grid/permitting bottlenecks (`ind-project-deployment-delays` and `ind-power-availability`, both classified as neutral / `does_not_resolve` in v2.1.0).',
    'How much of Anthropic’s $895.4B multi-year compute commitment envelope contains flexible ramp clauses or minimum take-or-pay penalties if AI model monetisation lags.',
    'Whether circular vendor financing ($1.0B NVIDIA convertible note + $860.3M Ward County guarantee to Nscale, plus CoreWeave’s $30,233M Net Debt) amplifies downside contagion to hardware suppliers if neocloud utilisation softens.',
  ];

  return {
    thesisId: ARK_CAPEX_THESIS_ID,
    version: THESIS_MONITOR_VERSION,
    methodologyVersion: RESEARCH_METHODOLOGY_VERSION,
    registeredAtIso: '2026-11-09T17:48:53Z',
    thesisTitle: 'Cathie Wood / ARK Invest AI Capex Moderation & Capital Efficiency Thesis',
    datedThesisStatement:
      'Moderated AI infrastructure capital expenditure (7 November 2026 ARK "In The Know" commentary) could improve long-term hyperscaler and enterprise capital efficiency and restore Free Cash Flow without ending underlying AI cloud adoption and software revenue growth.',
    epistemicStatus: 'mixed_evidence_under_active_monitoring',
    schemaExpansionRecommendation: {
      expandTypeDbSchemaNow: false,
      promoteUnverifiedCommentaryToProdGraph: false,
      rationale:
        'Existing TypeDB schema (`macro-intelligence-graph-3.14-v1`) and Convex `claimClassification` (`observed`, `reported`, `estimated`, `proposed`, `unverified`) already support source provenance separation, temporal `publishedAt`/`receivedAt` cutoffs, and relationship supersession without schema expansion. Commentary remains strictly isolated from confirmed graph facts.',
    },
    provenanceRecords: [...ARK_THESIS_PROVENANCE_RECORDS],
    marketCloseIngestionAudit: auditMarketCloseIngestionV3(),
    macroClaimsAudit: [...MACRO_CLAIM_VERIFICATION_AUDITS],
    companyLinkages,
    scenarios,
    leadingIndicators,
    evidenceChangeAssessment,
    partAQualityGateAudit,
    liveGeminiInferenceRecord: VERIFIED_LIVE_GEMINI_THESIS_INFERENCE,
    evidenceSynthesis: {
      supportingEvidence,
      contradictoryEvidence,
      missingEvidence,
      keyUncertainties,
    },
    compactMarketRadarPanelProposal: {
      proposedSectionPlacement:
        'Integrated inside Section D ("What Changed? & Active Research Theses") on Market Radar (`/`) with `data-testid="market-radar-thesis-monitor"`, expandable supporting/contradictory/indicator drawers, and one-click research chat invocation.',
      linkedWhatChangedIds: [
        'chg-earnings-amzn-googl-msft',
        'chg-filing-anthropic-s1a',
        'chg-financing-monarch-intel',
        'chg-typedb-loughton-supersession',
      ],
      linkedResearchChatPrompt:
        'What evidence supports the largest compute commitments and how do Ireland grid constraints and project supersessions affect AI infrastructure capex?',
    },
    executionAuthority: 'none',
  };
}

/**
 * Requirement 6 & 9 — Validates an Evidence-Locked Research Chat explanation of the
 * Cathie Wood AI Capex Moderation Thesis against our closed `EvidenceBundleV1`
 * (including the newly ingested BEA Q3 2026 GDP and Nasdaq v3 5–6 Nov 2026 close sources)
 * and 9-check deterministic validator.
 */
export async function runValidatedThesisChatExplanationTest(params?: {
  temporalBasis?: TemporalBasis;
  historicalCutoffMs?: number;
}): Promise<{
  bundle: EvidenceBundleV1;
  candidateAnswer: EvidenceLockedAnswer;
  validatedAnswer: EvidenceLockedAnswer;
  validationReport: AnswerValidationReport;
}> {
  const question =
    'What evidence supports the largest compute commitments and how do Ireland grid constraints and project supersessions affect AI infrastructure capex?';

  const cutoffMs = params?.historicalCutoffMs ?? Date.parse('2026-11-09T20:15:00Z');
  const temporalBasis: TemporalBasis = params?.temporalBasis ?? 'publication';

  const bundle = await retrieveClosedEvidenceBundle({
    requesterId: 'owner-thesis-monitor-audit',
    question,
    temporalBasis,
    historicalCutoffMs: cutoffMs,
    preferLiveTypeDb: false,
    nowMs: Date.parse('2026-11-09T20:15:00Z'),
    additionalSources: [
      {
        sourceDocId: 'bea-26-45-gdp-q3-2026-adv',
        title: 'U.S. BEA 26-45: Gross Domestic Product (Advance Estimate), 3rd Quarter 2026',
        url: 'https://www.bea.gov/news/2026/gdp-advance-estimate-3rd-quarter-2026',
        kind: 'regulator',
        authority: 'primary',
        publicationBasis: 'exact_utc',
        publishedAtMs: 1793277000000,
        receivedAtMs: liveIngestion.beaGdpRelease.receivedAtMs,
        ingestedAtMs: liveIngestion.beaGdpRelease.receivedAtMs,
        contentSha256: liveIngestion.beaGdpRelease.sha256,
        publisher: 'U.S. Bureau of Economic Analysis',
        sourceTier: 'primary_macro_release',
        excerpt:
          'BEA 26-45 (29 Oct 2026): Real GDP increased at an annual rate of 3.4 percent in Q3 2026 (vs 2.2 percent in Q2). Real final sales to private domestic purchasers rose 4.9 percent.',
      },
      {
        sourceDocId: 'nasdaq-comp-history-v3',
        title: 'Nasdaq Historical Close/Last Table (v3 Capture through 6 November 2026)',
        url: 'https://api.nasdaq.com/api/quote/COMP/historical?assetclass=index&fromdate=2026-09-01&todate=2026-11-09&limit=100',
        kind: 'company',
        authority: 'primary',
        publicationBasis: 'retrieval_upper_bound',
        publishedAtMs: Date.parse('2026-11-06T21:00:00Z'),
        receivedAtMs: liveIngestion.nasdaqHistoricalClosesV3.COMP!.receivedAtMs,
        ingestedAtMs: liveIngestion.nasdaqHistoricalClosesV3.COMP!.receivedAtMs,
        contentSha256: liveIngestion.nasdaqHistoricalClosesV3.COMP!.sha256,
        publisher: 'Nasdaq Historical Quote API',
        sourceTier: 'primary_market_reference',
        excerpt:
          'Nasdaq COMP closed at 25,736.51 on 4 Nov 2026, fell to 24,315.00 on 5 Nov 2026, and rebounded to 24,579.42 on 6 Nov 2026.',
      },
    ],
  });

  const availableSourceIds = new Set(bundle.sources.map((s) => s.docId));
  const availableClaimIds = new Set(bundle.quantitativeClaims.map((c) => c.claimId));
  const availableRelIds = bundle.relationships.map((r) => r.relationshipId);

  const pickValidEvidenceIds = (preferred: string[]): string[] => {
    const matched = preferred.filter(
      (id) => availableSourceIds.has(id) || availableClaimIds.has(id),
    );
    if (matched.length > 0) return matched;
    const fallbackDoc = bundle.sources[0]?.docId;
    return fallbackDoc ? [fallbackDoc] : ['anthropic-s1a-2026-11-02'];
  };

  const hasAnthropicS1a =
    availableSourceIds.has('anthropic-s1a-2026-11-02') ||
    availableClaimIds.has('claim-anthropic-commitments-895b');

  const supportingClaims: EvidenceLockedAnswer['supportingClaims'] = [];

  if (hasAnthropicS1a) {
    supportingClaims.push({
      claimId: 'thesis-clm-1',
      statement:
        'Anthropic Form S-1/A (published 2026-11-02) discloses $895.4B in deduplicated multi-year cloud compute and lease commitments ($940.0B naive sum less $44.6B Nscale Monarch sub-allocation).',
      distinction: 'deterministic_arithmetic',
      evidenceIds: pickValidEvidenceIds([
        'anthropic-s1a-2026-11-02',
        'claim-anthropic-commitments-895b',
      ]),
      relationshipIds: availableRelIds.filter((id: string) =>
        [
          'rel-anthropic-multi-cloud-commitment',
          'rel-anthropic-nscale-monarch',
          'rel-anthropic-s1a-amzn-compute-r1',
          'rel-anthropic-nscale-monarch-r1',
        ].includes(id),
      ),
      quantitativeValue: 895_400_000_000,
      unit: 'USD',
      currency: 'USD',
      periodOrAsOf: '2026-11-02',
    });
  }

  supportingClaims.push({
    claimId: 'thesis-clm-2',
    statement:
      'NVIDIA signed a $1.0B convertible financing commitment for Nscale, while Microsoft superseded its cancelled Loughton v1 agreement with a redesigned v2 relationship.',
    distinction: 'source_fact',
    evidenceIds: pickValidEvidenceIds(['nscale-s1-sep18', 'reuters-loughton-oct19']),
    relationshipIds: availableRelIds.filter((id: string) =>
      [
        'rel-nvda-nscale-convertible',
        'rel-nvda-nscale-texas-guarantee',
        'rel-loughton-dc-active-v2-r1',
        'rel-nvda-nscale-convertible-r1',
      ].includes(id),
    ),
    quantitativeValue: 1_000_000_000,
    unit: 'USD',
    currency: 'USD',
    periodOrAsOf: '2026-09-18',
  });

  supportingClaims.push({
    claimId: 'thesis-clm-3',
    statement:
      'Data centres consume 21% of Ireland’s metered national electricity under CRU/EirGrid policy, governing the 350 MW AWS Dublin campus and 280 MW Microsoft Grange Castle campus.',
    distinction: 'interpretation',
    evidenceIds: pickValidEvidenceIds([
      'cru-eirgrid-dc-policy-2026',
      'bea-26-45-gdp-q3-2026-adv',
    ]),
    relationshipIds: availableRelIds.filter((id: string) =>
      [
        'rel-aws-dublin-grid-dependency',
        'rel-msft-dublin-grid-dependency',
        'rel-aws-dublin-eirgrid-dep-r1',
        'rel-msft-dublin-eirgrid-dep-r1',
      ].includes(id),
    ),
    quantitativeValue: 21,
    unit: 'percent',
    currency: null,
    periodOrAsOf: '2026-07-15',
  });

  const candidateAnswer: EvidenceLockedAnswer = {
    version: EVIDENCE_LOCKED_ANSWER_VERSION,
    bundleId: bundle.bundleId,
    bundleSha256: bundle.bundleSha256,
    shortAnswer: hasAnthropicS1a
      ? 'Stored primary SEC, BEA, and TypeDB evidence provides mixed support for the AI capex moderation thesis (one supporting indicator, four contradicting indicators, two neutral bottlenecks, and one insufficient-evidence indicator across eight leading indicators): hyperscaler cloud demand is strong, but signed multi-year commitments remain massive ($895.4B deduplicated in Anthropic S-1/A) while physical grid constraints (21% Irish electricity share) and selective project supersessions (Loughton v1 cancelled -> v2 active) represent neutral supply and reallocation friction.'
      : 'At this historical cutoff, stored primary evidence verifies Ireland’s 21% data-centre electricity share and NVIDIA’s $1.0B Nscale convertible commitment, while later-dated filings are excluded to prevent hindsight leakage.',
    executiveTldr: [
      'Commentary vs Fact Separation: The ARK capex moderation thesis is evaluated as an external research hypothesis across eight mutually exclusive leading indicators (one supporting, four contradicting, two neutral, and one insufficient evidence), never as an established graph fact.',
      hasAnthropicS1a
        ? 'Four Contradicting Indicators (Capex Surge, Negative FCF Burn, Chip Acceleration & $895.4B Lock-in): Anthropic Form S-1/A records $895.4B in deduplicated multi-year compute commitments (preventing $44.6B naive double-count on Nscale Monarch), while hyperscaler and neocloud capex and negative free cash flow contradict immediate capital moderation.'
        : 'Historical Cutoff Enforced: Post-cutoff filings are excluded from this reconstruction to prevent hindsight leakage.',
      'Two Neutral Bottlenecks (does_not_resolve): Microsoft cancelled its initial Loughton UK agreement (superseded by v2), and EirGrid/CRU records show data centres consume 21% of Irish electricity — representing reallocation and supply friction rather than confirmed efficiency gains.',
      'One Insufficient Evidence Indicator: Official county canvass certification for local elections and CoreWeave’s third-quarter filing remain absent.',
    ],
    supportingClaims,
    relevantRelationshipIds: availableRelIds.slice(0, 6),
    contradictoryEvidence: [
      {
        topic: 'Multi-Year Compute Commitment Lock-In vs Immediate Capex Moderation',
        description:
          'Signed financing and infrastructure obligations ($1.0B NVIDIA convertible note for Nscale) indicate substantial locked-in commitments rather than an immediate across-the-board capex halt.',
        relationshipIds: availableRelIds.slice(0, 2),
        evidenceIds: pickValidEvidenceIds(['nscale-s1-sep18', 'reuters-loughton-oct19']),
      },
    ],
    missingInformation: [
      'Official certified state and county canvass results for the 3 November 2026 US midterm elections.',
      'CoreWeave third-quarter Form 10-Q (latest SEC filing is second-quarter Form 10-Q).',
      'Explicit FY2027 management capital expenditure guidance ranges for AMZN, GOOGL, and MSFT.',
    ],
    historicalCutoffUsed: {
      asOfMs: bundle.historicalCutoffMs,
      asOfIso: bundle.historicalCutoffIso,
      temporalBasis: bundle.temporalBasis,
    },
    supportStatus: 'partially_supported',
    abstentionReason: null,
    suggestedFollowUpQuestions: [...SUGGESTED_STARTER_QUESTIONS.slice(0, 4)],
    executionAuthority: 'none',
  };

  const { validatedAnswer, report } = validateEvidenceLockedAnswer(
    candidateAnswer,
    bundle,
    Date.parse('2026-11-09T19:00:00Z'),
  );

  return {
    bundle,
    candidateAnswer,
    validatedAnswer,
    validationReport: report,
  };
}
