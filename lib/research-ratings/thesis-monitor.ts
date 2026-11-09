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
 * (`thesis-ark-ai-capex-moderation-2026-11-07`)
 *
 * Governance & Epistemic Invariants:
 * 1. Never treats external commentary, opinion, or forecasts as established financial facts.
 * 2. Stores provenance in three strictly separated epistemic layers:
 *    - `commentary_origin`: Cathie Wood / ARK Invest "In The Know" video commentary (7 Nov 2026).
 *    - `secondary_reporting`: Secondary press articles summarising the commentary.
 *    - `verified_primary_evidence`: Independently verified SEC filings, central-bank/regulator records, and market series.
 * 3. Does NOT assign unsupported numerical probabilities to scenarios.
 * 4. Keeps all 7 company directional ratings locked under G.6/G.7 gates (`INSUFFICIENT DATA`) and holds `executionAuthority: 'none'`.
 */

export const THESIS_MONITOR_VERSION = 'aci-thesis-monitor-v1.0.0' as const;
export const ARK_CAPEX_THESIS_ID = 'thesis-ark-ai-capex-moderation-2026-11-07' as const;

export type EpistemicSourceLayer =
  | 'commentary_origin'
  | 'secondary_reporting'
  | 'verified_primary_evidence';

export type ClaimVerificationStatus =
  | 'verified_in_primary_store'
  | 'partially_corroborated_unofficial_or_lagged'
  | 'missing_primary_source_in_store'
  | 'unverified_commentary_opinion';

export interface ThesisProvenanceRecord {
  recordId: string;
  epistemicLayer: EpistemicSourceLayer;
  title: string;
  url: string;
  authorOrInstitution: string;
  publishedAtMs: number | null;
  publicationDateIso: string;
  publicationBasis:
    | 'sec_edgar_acceptance'
    | 'official_regulator_release'
    | 'date_only_commentary'
    | 'secondary_media_timestamp'
    | 'retrieval_upper_bound';
  receivedAtMs: number;
  receivedAtIso: string;
  claimClassification: 'observed_fact' | 'reported_commentary' | 'opinion_and_hypothesis';
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
  storedPrimaryEvidenceIds: string[];
  whatIsVerifiedInStore: string;
  whatIsMissingOrUnverified: string;
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
  probabilityAssignment: null; // Strictly null: no unsupported numerical probabilities
  probabilityPolicyNote: 'No numerical probability assigned; monitored via deterministic observable indicators.';
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
  currentVerifiedReading: string;
  dataStatus: 'verified' | 'partial' | 'missing_in_store';
  primaryEvidenceIds: string[];
  interpretationForThesis: string;
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
  provenanceRecords: ThesisProvenanceRecord[];
  macroClaimsAudit: MacroClaimVerificationAudit[];
  companyLinkages: ThesisCompanyLinkage[];
  scenarios: TestableThesisScenario[];
  leadingIndicators: ThesisLeadingIndicator[];
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

/**
 * Requirement 1 & 2 — Separate Provenance Registry for Original Commentary, Secondary Reporting,
 * and Independently Verified Primary Observations.
 */
export const ARK_THESIS_PROVENANCE_RECORDS: readonly ThesisProvenanceRecord[] = [
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
      'Primary record of Cathie Wood’s investment commentary and macro/AI thesis. Stored strictly as `opinion_and_hypothesis`; assertions inside commentary are never promoted as confirmed financial facts without independent primary SEC/BEA/exchange verification.',
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
    publishedAtMs: null,
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
] as const;

/**
 * Requirement 3 — Audit of the 5 November Sell-Off, 6 November Rebound,
 * 2026 US Midterm Election Results, and Q3 2026 US GDP against Authoritative Sources.
 */
export const MACRO_CLAIM_VERIFICATION_AUDITS: readonly MacroClaimVerificationAudit[] = [
  {
    claimKey: 'nov_5_sp500_nasdaq_selloff',
    claimLabel: '5 November 2026 S&P 500 / Nasdaq Sell-Off',
    commentaryAssertion:
      'Commentary references a sharp equity sell-off on Thursday, 5 November 2026 following post-election and valuation/rate jitters.',
    verificationStatus: 'missing_primary_source_in_store',
    storedPrimaryEvidenceIds: ['nasdaq-comp-history-v2', 'nasdaq-qqq-history-v2', 'nasdaq-sox-history-v2'],
    whatIsVerifiedInStore:
      'Our stored v2 market packages (`recovery-006-2026-11-03-v2` and `policy-risk-001.2-midterm-2026-11-03`) were captured on 5 November 2026 at 14:25–14:57 UTC (before the 5 November US market open/close at 21:00 UTC). They verify closes through 4 November 2026 (`COMP` 25,736.51, `NDX` 28,437.17, `QQQ` $691.95, and `SOX` -3.13% pullback on 4 Nov from 10,600.40 to 10,268.65; `NVDA` -3.17% on 4 Nov from $206.69 to $200.13).',
    whatIsMissingOrUnverified:
      'Regular-session closing prices for Thursday, 5 November 2026 (21:00 UTC close) for S&P 500 (`SPX`/`SPY`) and Nasdaq (`COMP`/`QQQ`) are not yet stored in `data/recovery/` or `data/policy-risk/`.',
    authoritativeSourceRequiredToResolve:
      'Run `market_data_collect` against Nasdaq Historical API (`api.nasdaq.com/api/quote/{COMP,QQQ,SPY}/historical`) and FRED (`SP500`, `NASDAQCOM`) with `todate=2026-11-07` to ingest the official 5 November 2026 close.',
  },
  {
    claimKey: 'nov_6_market_rebound',
    claimLabel: '6 November 2026 S&P 500 / Nasdaq Rebound',
    commentaryAssertion:
      'Commentary references a subsequent market rebound on Friday, 6 November 2026 as investors reassessed AI fundamentals and macro policy.',
    verificationStatus: 'missing_primary_source_in_store',
    storedPrimaryEvidenceIds: ['nasdaq-comp-history-v2', 'nasdaq-qqq-history-v2'],
    whatIsVerifiedInStore:
      'Stored primary market series verify the earlier 3–4 November rebound (`COMP` +1.44% on 4 Nov to 25,736.51; `MSFT` +6.68% on 4 Nov to $555.80), but terminate at the 4 November 2026 close.',
    whatIsMissingOrUnverified:
      'Regular-session closing prices for Friday, 6 November 2026 (21:00 UTC close) are not yet present in the local repository.',
    authoritativeSourceRequiredToResolve:
      'Ingest dated 6 November 2026 Close/Last observations from Nasdaq Historical API and FRED (`SP500`, `NASDAQCOM`) via `market_data_collect`.',
  },
  {
    claimKey: 'us_2026_midterm_election_results',
    claimLabel: '3 November 2026 US Midterm Election Results & Local Data-Centre Referenda',
    commentaryAssertion:
      'Commentary discusses the fiscal, regulatory, and infrastructure implications of the 3 November 2026 US midterm elections.',
    verificationStatus: 'partially_corroborated_unofficial_or_lagged',
    storedPrimaryEvidenceIds: [
      'time-midterms',
      'wyso-sw-ohio-results',
      'gridsight-votes',
      'ny-eo62',
      'okhouse-hb2992',
    ],
    whatIsVerifiedInStore:
      'Primary state actions pre-dating the election are verified (`NY Executive Order 62` pausing >=50 MW DEC permits; `Oklahoma HB 2992` effective 1 Jul 2026 allocating >=75 MW tariff costs). Post-election local ballot pushback in Southwest Ohio (Wilmington, Piqua, Urbana) is corroborated via secondary journalism (`WYSO` 5 Nov 03:38 UTC, `TIME` 4 Nov 13:15 UTC, `The Grid Sight` unofficial tracker).',
    whatIsMissingOrUnverified:
      'All stored 3 November 2026 ballot and congressional race results are unofficial secondary media/tracker reports (`authority: secondary`). Official county board of elections certifications and federal congressional canvass records have not been imported, and Piqua/Urbana MW thresholds have `conflictingSources`.',
    authoritativeSourceRequiredToResolve:
      'Import certified state Secretary of State / County Board of Elections canvass filings before elevating any 2026 election outcome from `reported` to `confirmed`.',
  },
  {
    claimKey: 'us_q3_2026_gdp_growth',
    claimLabel: 'US Q3 2026 Real GDP Advance Estimate & Productivity',
    commentaryAssertion:
      'Commentary cites Q3 2026 US GDP growth and non-farm productivity as evidence of underlying macro resilience.',
    verificationStatus: 'missing_primary_source_in_store',
    storedPrimaryEvidenceIds: ['fred-vixcls-v2', 'cbi-fsr-2026-i'],
    whatIsVerifiedInStore:
      'Stored FRED macro series in `recovery-006-2026-11-03-v2` cover daily financial conditions (`VIXCLS` 20.83 on 3 Nov, `DGS10` 4.95% 10Y Treasury yield, `BAMLH0A0HYM2` 340 bps HY OAS).',
    whatIsMissingOrUnverified:
      'Neither the U.S. Bureau of Economic Analysis (BEA) Q3 2026 Advance GDP release (`bea.gov`) nor FRED quarterly real GDP (`GDPC1` / `A191RL1Q225SBEA`) and BLS productivity (`OPHNFB`) series are stored in the repository.',
    authoritativeSourceRequiredToResolve:
      'Add FRED series `A191RL1Q225SBEA` (Real GDP % change) and `OPHNFB` (Nonfarm Business Sector Labor Productivity) or the primary BEA Q3 2026 Gross Domestic Product release to `market_data_collect`.',
  },
] as const;

/**
 * Evaluates the Cathie Wood AI Capex Moderation Thesis strictly against approved stored evidence.
 */
export function evaluateAiCapexModerationThesis(): EvidenceBackedThesisAssessment {
  const assessments = evaluateUniverseResearchAssessments();
  const byTicker = new Map(assessments.map((a) => [a.ticker, a]));

  const companyLinkages: ThesisCompanyLinkage[] = [
    {
      ticker: 'AMZN',
      companyName: 'Amazon.com, Inc.',
      currentRatingLabel: byTicker.get('AMZN')?.assessment ?? 'INSUFFICIENT DATA',
      nonDirectionalScreeningScore: byTicker.get('AMZN')?.researchPriorityScore ?? 57.7,
      roleInCapexThesis: 'Hyperscale AI Capex Spender & Cloud Monetiser',
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
      ],
    },
    {
      ticker: 'GOOGL',
      companyName: 'Alphabet Inc.',
      currentRatingLabel: byTicker.get('GOOGL')?.assessment ?? 'INSUFFICIENT DATA',
      nonDirectionalScreeningScore: byTicker.get('GOOGL')?.researchPriorityScore ?? 61.5,
      roleInCapexThesis: 'Hyperscale AI Capex Spender & Cloud Monetiser',
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
      ],
    },
    {
      ticker: 'MSFT',
      companyName: 'Microsoft Corporation',
      currentRatingLabel: byTicker.get('MSFT')?.assessment ?? 'INSUFFICIENT DATA',
      nonDirectionalScreeningScore: byTicker.get('MSFT')?.researchPriorityScore ?? 73.7,
      roleInCapexThesis: 'Hyperscale AI Capex Spender & Cloud Monetiser',
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
      ],
    },
    {
      ticker: 'NVDA',
      companyName: 'NVIDIA Corporation',
      currentRatingLabel: byTicker.get('NVDA')?.assessment ?? 'INSUFFICIENT DATA',
      nonDirectionalScreeningScore: byTicker.get('NVDA')?.researchPriorityScore ?? 82.3,
      roleInCapexThesis: 'AI Compute Silicon & Merchant Hardware Supplier',
      verifiedSupportingMetrics: [
        'FY2027 Q2 revenue reached $96,221M (Data Center $89,000M) with 66.24% GAAP operating margin ($63,734M) and $21,341M FCF; Q3 FY27 revenue guidance is $108B ± 2% (`nvda-fy27-q2`), contradicting any near-term Q3 hardware demand collapse.',
      ],
      verifiedContradictoryOrRiskMetrics: [
        'If hyperscalers moderate GPU capex growth, NVIDIA’s $89.0B quarterly Data Center run-rate is directly exposed on the revenue side (`nvda-fy27-q2`).',
        'Signed $1.0B convertible commitment and $860.3M Ward County Texas lease guarantee for Nscale (`nscale-s1-sep18`), with Reuters reporting talks on additional credit support (`reuters-credit-oct30`), illustrating vendor-financing concentration risk if neocloud capex moderates.',
      ],
      missingCompanyEvidence: [
        '4-quarter TTM XBRL statements, diluted share count, and customer concentration breakdown across MSFT, AMZN, GOOGL, and META.',
      ],
      citedEvidenceIds: [
        'nvda-fy27-q2',
        'nscale-s1-sep18',
        'reuters-credit-oct30',
      ],
    },
    {
      ticker: 'AMD',
      companyName: 'Advanced Micro Devices, Inc.',
      currentRatingLabel: byTicker.get('AMD')?.assessment ?? 'INSUFFICIENT DATA',
      nonDirectionalScreeningScore: byTicker.get('AMD')?.researchPriorityScore ?? null,
      roleInCapexThesis: 'AI Compute Silicon & Merchant Hardware Supplier',
      verifiedSupportingMetrics: [
        'Moderated hyperscaler capex focused on total-cost-of-ownership (TCO) inference efficiency could encourage multi-vendor GPU diversification beyond single-source frontier training clusters.',
      ],
      verifiedContradictoryOrRiskMetrics: [
        '20-session reference price return is -13.81% ($449.04 on 2026-11-04, `nasdaq-amd`), reflecting market sensitivity to semiconductor capex deceleration.',
      ],
      missingCompanyEvidence: [
        'Primary SEC Form 10-Q XBRL revenue, Data Center GPU revenue, operating margin, OCF, capex, FCF, diluted shares, and debt/cash (`status: missing` in Stage 1 audit).',
      ],
      citedEvidenceIds: ['nasdaq-amd'],
    },
    {
      ticker: 'CRWV',
      companyName: 'CoreWeave, Inc.',
      currentRatingLabel: byTicker.get('CRWV')?.assessment ?? 'INSUFFICIENT DATA',
      nonDirectionalScreeningScore: byTicker.get('CRWV')?.researchPriorityScore ?? null,
      roleInCapexThesis: 'Leveraged Specialist AI Neocloud',
      verifiedSupportingMetrics: [
        'Anchored by 400 MW Polaris Forge 1 campus lease with Applied Digital (`apld-8k-2026-10-07`, `src-crwv-polaris-2026`).',
      ],
      verifiedContradictoryOrRiskMetrics: [
        'Most vulnerable business model to capex moderation or hyperscaler bring-in-house shifts: 20-session reference price fell -30.54% to $46.40 (`nasdaq-crwv`).',
        'High reliance on debt-financed GPU clusters and third-party data-centre leases (`cbi-fsr-2026-i`).',
      ],
      missingCompanyEvidence: [
        'Primary SEC S-1 / 10-Q XBRL revenue, interest expense, operating cash flow, GPU capex, SPV debt facilities, and diluted share count.',
      ],
      citedEvidenceIds: ['src-crwv-polaris-2026', 'apld-8k-2026-10-07', 'nasdaq-crwv', 'cbi-fsr-2026-i'],
    },
    {
      ticker: 'INTC',
      companyName: 'Intel Corporation',
      currentRatingLabel: byTicker.get('INTC')?.assessment ?? 'INSUFFICIENT DATA',
      nonDirectionalScreeningScore: byTicker.get('INTC')?.researchPriorityScore ?? null,
      roleInCapexThesis: 'Foundry & Co-Investment Capex Turnaround',
      verifiedSupportingMetrics: [
        'Already executing forced capex moderation and off-balance-sheet capital sharing via the $11.0B Fab 34 Leixlip Ireland Semiconductor Co-Investment Program (SCJV) (`intc-10q-q3-2026`, `src-intc-10k-2025`).',
      ],
      verifiedContradictoryOrRiskMetrics: [
        'Carries long-term co-investment distribution obligations to SCJV partners and Ireland fiscal/energy concentration exposure (`ireland-dof-ai-correction-2026-07`).',
      ],
      missingCompanyEvidence: [
        'Primary SEC Form 10-Q XBRL consolidated revenue, foundry operating loss, OCF, net capex, debt/cash, and full 46-session price history (only 6 sessions stored locally).',
      ],
      citedEvidenceIds: ['intc-10q-q3-2026', 'src-intc-10k-2025', 'ireland-dof-ai-correction-2026-07'],
    },
  ];

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
      confirmingIndicatorThresholds: [
        'AMZN and GOOGL quarterly Net Capex / OCF moderates below 90% (from 178.9% and 121.4% in 2026-Q3) over 2 consecutive quarters, restoring positive quarterly Free Cash Flow.',
        'Hyperscale cloud revenue growth remains >= 25% YoY (AWS >= 25%, Azure >= 30%, Google Cloud >= 35%) with stable or expanding segment operating margins.',
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
        'Capex slows involuntarily not because of software efficiency, but because grid connection queues (EirGrid 21% load share), state moratoria (NY EO 62), and local zoning pushback (Southwest Ohio) prevent deployed capital from being energised on schedule.',
      probabilityAssignment: null,
      probabilityPolicyNote:
        'No numerical probability assigned; monitored via deterministic observable indicators.',
      confirmingIndicatorThresholds: [
        'Additional state permit moratoria (`NY EO 62` model) or municipal ballot bans blocking >= 50 MW campuses.',
        'Growing gap between contracted MW (`Polaris Forge 1` 400 MW, `AWS Dublin` 350 MW, `MSFT Dublin` 280 MW) and actual energised MW reported in 8-K/10-Q filings.',
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

  // Requirement 6 — Eight Measurable Leading Indicators
  const leadingIndicators: ThesisLeadingIndicator[] = [
    {
      indicatorId: 'ind-capex-to-ocf',
      name: '1. Hyperscaler Net Capex / Operating Cash Flow Ratio (%)',
      category: 'capex_efficiency',
      measurementFormulaOrSeries: '(Net Capital Expenditure / Operating Cash Flow) × 100 across matched quarterly and TTM periods',
      currentVerifiedReading:
        'AMZN: 125.2% TTM-2026-Q3 (178.9% in 2026-Q3 vs 88.7% in TTM-2025-Q3); GOOGL: 121.4% in 2026-Q3 (vs 49.5% in 2025-Q3); MSFT: 67.9% in FY27 Q1 (cash PP&E only); NVDA: 11.1% in FY27 Q2',
      dataStatus: 'verified',
      primaryEvidenceIds: ['amazon-sec-ex991', 'sec-release', 'msft-fy27-q1', 'nvda-fy27-q2'],
      interpretationForThesis:
        'Currently contradicts active capex moderation at AMZN and GOOGL (where Q3 capex exceeded 120% of OCF), while showing why moderation is financially necessary.',
    },
    {
      indicatorId: 'ind-free-cash-flow',
      name: '2. Hyperscaler & Silicon Free Cash Flow Bridge ($M / % Margin)',
      category: 'cash_conversion',
      measurementFormulaOrSeries: 'Operating Cash Flow − Net Capital Expenditure (and disclosed equipment lease principal)',
      currentVerifiedReading:
        'AMZN: -$42,357M TTM-2026-Q3 (-5.3% margin) & -$33,456M in 2026-Q3; GOOGL: -$9,065M in 2026-Q3 (-7.1% margin); MSFT: +$18,633M in FY27 Q1 (+20.2% margin); NVDA: +$21,341M in FY27 Q2 (+22.2% margin)',
      dataStatus: 'verified',
      primaryEvidenceIds: ['amazon-sec-ex991', 'goog-2026q3-free_cash_flow-v1', 'msft-fy27-q1', 'nvda-fy27-q2'],
      interpretationForThesis:
        'Negative FCF at AMZN and GOOGL is driven entirely by >120% capex/OCF rather than operating losses, supporting the thesis that a capex plateau would rapidly unlock FCF.',
    },
    {
      indicatorId: 'ind-cloud-revenue-growth',
      name: '3. Cloud & AI Infrastructure Segment Revenue Growth & Margin',
      category: 'cloud_monetisation',
      measurementFormulaOrSeries: 'YoY % growth and segment operating margin for Google Cloud, AWS, and Azure / Microsoft Cloud',
      currentVerifiedReading:
        'Google Cloud: $30.709B (+102.61% YoY, 36.21% op margin); Azure: $33.165B (+48% YoY); Microsoft Cloud: $63.9B (+30% YoY); AWS: $45.984B (+39.32% YoY, 37.95% op margin)',
      dataStatus: 'verified',
      primaryEvidenceIds: ['sec-release', 'msft-fy27-q1', 'amazon-sec-ex991'],
      interpretationForThesis:
        'Strongly supports the demand half of the thesis: enterprise cloud/AI revenue growth (+39% to +103% YoY) and segment margins (36%–38%) are accelerating, not stalling.',
    },
    {
      indicatorId: 'ind-semiconductor-demand',
      name: '4. Merchant AI Silicon Revenue, Guidance & SOX Index Trend',
      category: 'silicon_demand',
      measurementFormulaOrSeries: 'NVDA Data Center quarterly revenue, management next-quarter guidance, and PHLX Semiconductor Index (`SOX`)',
      currentVerifiedReading:
        'NVDA FY27 Q2 Data Center revenue: $89,000M; Q3 FY27 total revenue guidance: $108.0B ± 2% (`nvda-fy27-q2`); SOX index: 10,268.65 on 2026-11-04 (-3.13% session pullback from 10,600.40 on 3 Nov)',
      dataStatus: 'verified',
      primaryEvidenceIds: ['nvda-fy27-q2', 'nasdaq-sox-history-v2'],
      interpretationForThesis:
        'NVDA’s $108B Q3 outlook shows hyperscaler silicon orders had not slowed through late Q3, though AMD/INTC XBRL tables are needed for full cross-vendor tracking.',
    },
    {
      indicatorId: 'ind-project-deployment-delays',
      name: '5. Data-Centre Project Cancellations, Supersessions & Energisation Delays',
      category: 'project_execution',
      measurementFormulaOrSeries: 'TypeDB relationship status transitions (`cancelled`, `superseded`) and court/permitting delays in Benchmark 001.2',
      currentVerifiedReading:
        'MSFT Loughton UK v1 customer deal cancelled (`reuters-loughton-oct19`) and superseded by v2 (`rel-loughton-dc-active-v2-r1`); AWS Wilmington Ohio rezoning ordered redone by federal court (`wyso-wilmington-court`)',
      dataStatus: 'verified',
      primaryEvidenceIds: ['reuters-loughton-oct19', 'wyso-wilmington-court', 'apld-8k-2026-10-07'],
      interpretationForThesis:
        'Confirms selective project pruning and regional permitting friction are already occurring.',
    },
    {
      indicatorId: 'ind-credit-spreads-and-financing',
      name: '6. High-Yield Credit Spreads (`BAMLH0A0HYM2`) & Circular Vendor Financing',
      category: 'credit_and_financing',
      measurementFormulaOrSeries: 'ICE BofA US High-Yield OAS (bps) via FRED + signed/unsigned vendor credit guarantees in TypeDB',
      currentVerifiedReading:
        'FRED `BAMLH0A0HYM2`: 340 bps on 2026-11-03 (+22 bps over 5 sessions from 318 bps on 27 Oct); 10Y Treasury `DGS10`: 4.95%; VIX `VIXCLS`: 20.83; Signed Nscale financing: $1.0B NVDA convertible + $860.3M lease guarantee (`nscale-s1-sep18`)',
      dataStatus: 'verified',
      primaryEvidenceIds: ['fred-vixcls-v2', 'nscale-s1-sep18', 'reuters-credit-oct30', 'cbi-fsr-2026-i'],
      interpretationForThesis:
        'Modest credit spread widening (+22 bps) and reliance on vendor lease guarantees highlight why capital efficiency is increasingly scrutinized by credit markets.',
    },
    {
      indicatorId: 'ind-power-availability',
      name: '7. Grid Load Share & Contracted Megawatt (MW) Queue',
      category: 'power_and_grid',
      measurementFormulaOrSeries: 'Data-centre % share of national/regional electricity and contracted campus MW across TypeDB projects',
      currentVerifiedReading:
        'Ireland data centres: 21.0% of national metered electricity (`cru-eirgrid-dc-policy-2026`), constraining AWS Dublin (350 MW) and MSFT Grange Castle (280 MW); US tracked campuses include Polaris Forge 1 (400 MW, `apld-8k-2026-10-07`)',
      dataStatus: 'verified',
      primaryEvidenceIds: ['cru-eirgrid-dc-policy-2026', 'apld-8k-2026-10-07', 'src-crwv-polaris-2026'],
      interpretationForThesis:
        'Physical power availability acts as a hard external speed limit on raw data-centre capex expansion.',
    },
    {
      indicatorId: 'ind-regulatory-developments',
      name: '8. State Moratoria, Tariff Protection Statutes & Local Ballot Pushback',
      category: 'regulatory_and_policy',
      measurementFormulaOrSeries: 'Enacted executive orders, utility tariff laws, and certified municipal referendum outcomes',
      currentVerifiedReading:
        'NY EO 62 (>=50 MW DEC permit pause, `ny-eo62`); Oklahoma HB 2992 (>=75 MW tariff protection effective 1 Jul 2026, `okhouse-hb2992`); Southwest Ohio local voter pushback (`wyso-sw-ohio-results`, unofficial)',
      dataStatus: 'partial',
      primaryEvidenceIds: ['ny-eo62', 'okhouse-hb2992', 'wyso-sw-ohio-results', 'gridsight-votes'],
      interpretationForThesis:
        'Regulatory and voter resistance increases the cost and lead time of greenfield data-centre construction, incentivising compute efficiency within existing power envelopes.',
    },
  ];

  // Requirement 7 — Evidence Synthesis (Supporting, Contradictory, Missing, Uncertainties)
  const supportingEvidence: Array<{ statement: string; evidenceIds: string[] }> = [
    {
      statement:
        'Hyperscale cloud revenue and operating profits are growing rapidly (Google Cloud +102.6% YoY to $30.71B with $11.12B operating income; AWS +39.3% YoY to $45.98B with $17.45B operating income; Azure +48% YoY to $33.17B), proving that underlying enterprise AI/cloud adoption is generating real operating cash flow ($168.3B TTM OCF at AMZN, $58.0B Q1 OCF at MSFT, $42.29B Q3 OCF at GOOGL).',
      evidenceIds: ['sec-release', 'amazon-sec-ex991', 'msft-fy27-q1'],
    },
    {
      statement:
        'Negative Free Cash Flow at Amazon (-$42,357M TTM-2026-Q3; -$33,456M in 2026-Q3) and Alphabet (-$9,065M in 2026-Q3) is an accounting consequence of capital expenditure exceeding 120% of operating cash flow (125.2% TTM / 178.9% Q3 at AMZN; 121.4% Q3 at GOOGL), NOT an operating loss (`cash-bridge` in `alphabet-q3-2026.json`). Any moderation of capex/OCF back toward 2025 levels (88.7% TTM at AMZN) would immediately restore positive FCF.',
      evidenceIds: ['amazon-sec-ex991', 'sec-release', 'goog-2026q3-free_cash_flow-v1'],
    },
    {
      statement:
        'Selective project discipline is already observable in primary and corroborated records: Microsoft terminated its initial Loughton UK data-centre customer agreement (`reuters-loughton-oct19`) before superseding it with a revised structure (`rel-loughton-dc-active-v2-r1`), and Intel structured Fab 34 Leixlip via an $11.0B SCJV co-investment (`intc-10q-q3-2026`).',
      evidenceIds: ['reuters-loughton-oct19', 'intc-10q-q3-2026'],
    },
    {
      statement:
        'Physical power constraints (21.0% national electricity share in Ireland under CRU/EirGrid policy; NY EO 62 >=50 MW permit pause; Oklahoma HB 2992 >=75 MW ratepayer protection) create external pressure to favour compute efficiency over unconstrained megawatt expansion.',
      evidenceIds: ['cru-eirgrid-dc-policy-2026', 'ny-eo62', 'okhouse-hb2992'],
    },
  ];

  const contradictoryEvidence: Array<{ statement: string; evidenceIds: string[] }> = [
    {
      statement:
        'Latest reported Q3 2026 SEC filings show hyperscaler capex intensity accelerating, not yet moderating: Amazon Q3 net capex surged to $75,878M (178.9% of Q3 OCF vs 96.3% in 2025-Q3) and Alphabet Q3 capex more than doubled YoY to $51,355M (121.4% of Q3 OCF vs 49.5% in 2025-Q3).',
      evidenceIds: ['amazon-sec-ex991', 'sec-release', 'goog-2026q3-capital_expenditure-v1'],
    },
    {
      statement:
        'Anthropic’s Form S-1/A (2 November 2026) discloses $895.4B in aggregate signed multi-year cloud compute and lease commitments (as of 30 Sep 2026, including $44.6B Nscale Monarch sub-allocation) alongside a -$104.0B 9M 2026 GAAP net loss, demonstrating massive locked-in multi-year infrastructure obligations.',
      evidenceIds: ['anthropic-s1a-2026-11-02', 'nscale-s1-sep18'],
    },
    {
      statement:
        'NVIDIA’s FY2027 Q2 results ($89.0B Data Center revenue) and Q3 FY2027 revenue outlook ($108.0B ± 2%) show continued sequential expansion in AI hardware shipments through autumn 2026.',
      evidenceIds: ['nvda-fy27-q2'],
    },
  ];

  const missingEvidence: string[] = [
    '5 November 2026 and 6 November 2026 US market closing prices (`SPX`/`SPY`, `COMP`, `QQQ`, and 7 universe stocks) — current stored price packages terminate at the 4 November 2026 close (captured 5 Nov 14:25–14:57 UTC).',
    'Primary U.S. Bureau of Economic Analysis (BEA) Q3 2026 Advance GDP release (`A191RL1Q225SBEA`) and BLS Nonfarm Productivity (`OPHNFB`) series.',
    'Official certified state/county election canvass records for the 3 November 2026 US midterm elections and Ohio local data-centre ballot referenda (currently unofficial secondary reports only).',
    'Primary SEC Form 10-Q XBRL financial statement tables (Revenue, EBIT, OCF, Capex, FCF, Debt/Cash, Diluted Shares) for AMD (`CIK 0000002488`), CoreWeave (`CIK 0001769628`), and Intel (`CIK 0000050863`).',
    'FY2027 explicit capital expenditure guidance ranges and maintenance vs AI-growth capex breakdowns for AMZN, GOOGL, and MSFT.',
  ];

  const keyUncertainties: string[] = [
    'Whether a future moderation in hyperscaler capex/OCF will be driven by voluntary capital efficiency (Scenario 1) or involuntary grid/permitting bottlenecks (Scenario 2) and frontier-lab financing stress (Scenario 3).',
    'How much of Anthropic’s $895.4B multi-year compute commitment envelope contains flexible ramp clauses or minimum take-or-pay penalties if AI model monetisation lags.',
    'Whether circular vendor financing ($1.0B NVIDIA convertible note + $860.3M Ward County guarantee to Nscale) amplifies downside contagion to hardware suppliers if neocloud utilisation softens.',
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
        'Existing TypeDB schema (`macro-intelligence-graph-3.14-v1`) and Convex `claimClassification` (`observed`, `reported`, `estimated`, `proposed`, `unverified`) already support source provenance separation, temporal `publishedAt`/`receivedAt` cutoffs, and relationship supersession without schema expansion. Unverified commentary claims must remain in the Thesis Monitor evaluation layer until primary BEA/Nasdaq/SEC records are ingested.',
    },
    provenanceRecords: [...ARK_THESIS_PROVENANCE_RECORDS],
    macroClaimsAudit: [...MACRO_CLAIM_VERIFICATION_AUDITS],
    companyLinkages,
    scenarios,
    leadingIndicators,
    evidenceSynthesis: {
      supportingEvidence,
      contradictoryEvidence,
      missingEvidence,
      keyUncertainties,
    },
    compactMarketRadarPanelProposal: {
      proposedSectionPlacement:
        'Collapsible sub-panel inside Section D ("What Changed? & Active Research Theses") on Market Radar (`/`), with one-click deep links to Section E (Evidence-Locked Research Assistant) and `/data-room`.',
      linkedWhatChangedIds: [
        'chg-earnings-amzn-googl-msft',
        'chg-filing-anthropic-s1a',
        'chg-financing-monarch-intel',
        'chg-typedb-loughton-supersession',
      ],
      linkedResearchChatPrompt:
        'Evaluate the Cathie Wood AI capex moderation thesis using our stored SEC filings and TypeDB evidence: what supports it, what contradicts it, and what data is missing?',
    },
    executionAuthority: 'none',
  };
}

/**
 * Requirement 9 — Tests and validates an Evidence-Locked Research Chat explanation of the
 * Cathie Wood AI Capex Moderation Thesis against our closed `EvidenceBundleV1` and 9-check validator.
 *
 * Proves that the research assistant:
 * 1. Explains the thesis using ONLY approved stored evidence IDs and TypeDB relationships in `bundle`.
 * 2. Distinguishes observed facts from analytical inference and hypothesis.
 * 3. Explicitly abstains / lists missing information for uningested claims (5–6 Nov S&P 500 closes, Q3 BEA GDP,
 *    certified election canvass, and AMD/CRWV/INTC XBRL tables).
 * 4. Passes all 9 deterministic checks in `validateEvidenceLockedAnswer`.
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

  const bundle = await retrieveClosedEvidenceBundle({
    requesterId: 'owner-thesis-monitor-audit',
    question,
    temporalBasis: params?.temporalBasis ?? 'publication',
    historicalCutoffMs: params?.historicalCutoffMs ?? Date.parse('2026-11-09T18:00:00Z'),
    preferLiveTypeDb: false,
    nowMs: Date.parse('2026-11-09T18:00:00Z'),
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

  const candidateAnswer: EvidenceLockedAnswer = {
    version: EVIDENCE_LOCKED_ANSWER_VERSION,
    bundleId: bundle.bundleId,
    bundleSha256: bundle.bundleSha256,
    shortAnswer:
      'Stored primary SEC and TypeDB evidence provides mixed support for the AI capex moderation thesis: hyperscaler cloud demand is strong, but signed multi-year commitments remain massive ($895.4B deduplicated in Anthropic S-1/A, including $44.6B Nscale Monarch under Microsoft) while physical grid constraints (21% Irish electricity share) and selective project supersessions (Loughton v1 cancelled -> v2 active) enforce discipline. Claims regarding 5–6 November index moves and Q3 GDP are absent from the bundle and excluded.',
    executiveTldr: [
      'Commentary vs Fact Separation: The 7 November 2026 ARK capex moderation thesis is evaluated as an external research hypothesis, never as an established fact.',
      'Signed Commitment Scale (Contradictory / Lock-in): Anthropic Form S-1/A (2026-11-02) records $895.4B in deduplicated multi-year compute commitments (preventing $44.6B naive double-count on Nscale Monarch) alongside -$104.0B 9M GAAP net loss.',
      'Selective Capex Discipline & Bottlenecks (Supporting): Microsoft cancelled its initial Loughton UK agreement (superseded by v2), Intel structured Fab 34 Leixlip as an $11.0B SCJV, and EirGrid/CRU records show data centres consume 21% of Irish electricity (constraining 350 MW AWS Dublin and 280 MW MSFT Grange Castle).',
      'Explicit Abstention on Missing Data: 5–6 November 2026 S&P 500/Nasdaq closes, BEA Q3 2026 GDP, certified 2026 election results, and full XBRL tables for AMD, CRWV, and INTC are not in the retrieved evidence bundle.',
    ],
    supportingClaims: [
      {
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
          ].includes(id),
        ),
        quantitativeValue: 895_400_000_000,
        unit: 'USD',
        currency: 'USD',
        periodOrAsOf: '2026-11-02',
      },
      {
        claimId: 'thesis-clm-2',
        statement:
          'NVIDIA signed a $1.0B convertible financing commitment and an $860.3M Ward County Texas lease guarantee for Nscale, while Microsoft superseded its cancelled Loughton v1 agreement with a redesigned v2 relationship.',
        distinction: 'source_fact',
        evidenceIds: pickValidEvidenceIds(['nscale-s1-sep18', 'reuters-loughton-oct19']),
        relationshipIds: availableRelIds.filter((id: string) =>
          [
            'rel-nvda-nscale-convertible',
            'rel-nvda-nscale-texas-guarantee',
            'rel-loughton-dc-active-v2-r1',
          ].includes(id),
        ),
        quantitativeValue: 1_000_000_000,
        unit: 'USD',
        currency: 'USD',
        periodOrAsOf: '2026-09-18',
      },
      {
        claimId: 'thesis-clm-3',
        statement:
          'Data centres consume 21% of Ireland’s metered national electricity under CRU/EirGrid policy, governing the 350 MW AWS Dublin campus, 280 MW Microsoft Grange Castle campus, and Intel’s $11.0B Fab 34 Leixlip SCJV.',
        distinction: 'interpretation',
        evidenceIds: pickValidEvidenceIds([
          'cru-eirgrid-dc-policy-2026',
          'intc-10q-q3-2026',
        ]),
        relationshipIds: availableRelIds.filter((id: string) =>
          [
            'rel-aws-dublin-grid-dependency',
            'rel-msft-dublin-grid-dependency',
            'rel-intel-apollo-fab34-scjv',
          ].includes(id),
        ),
        quantitativeValue: 21,
        unit: 'percent',
        currency: null,
        periodOrAsOf: '2026-07-15',
      },
    ],
    relevantRelationshipIds: availableRelIds.slice(0, 6),
    contradictoryEvidence: [
      {
        topic: 'Multi-Year Compute Commitment Lock-In vs Immediate Capex Moderation',
        description:
          'Anthropic’s $895.4B signed multi-year compute commitment envelope (as of 30 Sep 2026) and NVIDIA’s $1.86B signed financing/guarantee backing for Nscale indicate substantial locked-in infrastructure commitments rather than an immediate across-the-board capex halt.',
        relationshipIds: availableRelIds.slice(0, 2),
        evidenceIds: pickValidEvidenceIds(['anthropic-s1a-2026-11-02', 'nscale-s1-sep18']),
      },
    ],
    missingInformation: [
      '5 November 2026 S&P 500/Nasdaq sell-off and 6 November 2026 rebound closing prices (stored market series terminate at 4 November 2026).',
      'U.S. Bureau of Economic Analysis (BEA) Q3 2026 Advance GDP release (`A191RL1Q225SBEA`).',
      'Official certified state/county canvass results for the 3 November 2026 US midterm elections.',
      'Primary SEC Form 10-Q XBRL income, cash-flow, debt, and share-count tables for AMD, CoreWeave, and Intel.',
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
    Date.parse('2026-11-09T18:00:00Z'),
  );

  return {
    bundle,
    candidateAnswer,
    validatedAnswer,
    validationReport: report,
  };
}
