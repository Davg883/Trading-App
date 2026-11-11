/**
 * AI Capital Intelligence — Phase G.8.2: 5-Question Live Portfolio Research Evaluation Suite
 *
 * Requirements:
 * - 5 targeted portfolio research requests evaluating macro rates, cash carry,
 *   duration/DV01, liquidity buffers, and regulatory ISA eligibility.
 * - Strictly separates live Gemini inference from deterministic evidence synthesis fallback.
 * - Records modelId, upstream requestId, token counts, latency, cost, bundle SHA-256,
 *   and independent answer review.
 * - Execution Authority: "none"
 */

import {
  runLegacyQuestionSuite,
  type LegacySuiteSummary,
  type LegacyTurnResult,
} from '../evaluation/legacy-question-runner';
import { resolveGeminiApiKey } from '../graph/gemini-provider-adapter';

export interface FiveQuestionEvalItem {
  questionId: string;
  category: string;
  question: string;
  expectedSupportStatus: 'fully_supported';
  expectedKeySubstrings: string[];
  expectedMustCiteDocOrSourceIds: string[];
  expectedFormula?: string;
  independentBenchmarkAnswer: string;
}

export const FIVE_PORTFOLIO_RESEARCH_QUESTIONS: readonly FiveQuestionEvalItem[] = [
  {
    questionId: 'G82-GATE-01',
    category: 'macro_rates_sonia',
    question:
      'What was the official Bank of England MPC Bank Rate decision on 5 November 2026, and what was the official dated 6 November SONIA benchmark fixing (series IUDSOIA)?',
    expectedSupportStatus: 'fully_supported',
    expectedKeySubstrings: ['4.00', '3.9852', 'IUDSOIA', '8-1'],
    expectedMustCiteDocOrSourceIds: [
      'src-boe-sonia-iadb-2026',
      'https://www.bankofengland.co.uk/monetary-policy-summary-and-minutes/2026/november-2026',
    ],
    independentBenchmarkAnswer:
      'On 5 November 2026, the Bank of England MPC voted 8-1 to raise Bank Rate by 25 bps from 3.75% to 4.00% (effective 6 Nov 2026). The official dated 6 November SONIA fixing (Series IUDSOIA) was 3.98520% (spread of -1.48 bps to Bank Rate).',
  },
  {
    questionId: 'G82-GATE-02',
    category: 'cash_carry_vs_instant_shock',
    question:
      'How does AI Capital Intelligence distinguish instantaneous market shocks (T=0) from forward interest accrual (T=12m) for uninvested Sterling cash?',
    expectedSupportStatus: 'fully_supported',
    expectedKeySubstrings: ['0.0%', 'par', '3.99%', 'carry', 'forward'],
    expectedMustCiteDocOrSourceIds: ['src-boe-sonia-iadb-2026'],
    expectedFormula:
      'Instantaneous Shock T=0: Price Return = 0.00% (par preservation). Forward Carry T=12m: Return = +3.99% annual SONIA yield.',
    independentBenchmarkAnswer:
      'Instantaneous market crashes at T=0 inflict 0.0% nominal price change on cash deposits, preserving nominal par value. Annual cash carry (+3.99% SONIA gross, +3.92% net CSH2.L) is accounted for strictly as a forward 12-month income stream.',
  },
  {
    questionId: 'G82-GATE-03',
    category: 'duration_and_dv01',
    question:
      'Calculate the price return and Sterling DV01 for short gilts (GLTS.L, 2.15y duration, £35,000 notional) versus all-maturity gilts (IGLT.L, 8.35y duration, £10,000 notional) under a +150 bps parallel rate shock.',
    expectedSupportStatus: 'fully_supported',
    expectedKeySubstrings: ['2.15', '8.35', '752.50', '835', '-3.2', '-12.5'],
    expectedMustCiteDocOrSourceIds: [
      'uk-dmo-short-gilt-curve-2026',
      'ishares-glts-factsheet-2026',
    ],
    expectedFormula:
      'DV01 = Notional × (Duration / 100); GLTS.L DV01 = £35,000 × (2.15/100) = £752.50. IGLT.L DV01 = £10,000 × (8.35/100) = £835.00.',
    independentBenchmarkAnswer:
      'Under +150 bps rate shock: GLTS.L (2.15y duration) loses -3.225% (DV01 £752.50 per 100 bps); IGLT.L (8.35y duration) loses -12.525% (DV01 £835.00 per 100 bps). Short gilts capture 96% of sovereign yield while lowering duration risk by 74%.',
  },
  {
    questionId: 'G82-GATE-04',
    category: 'emergency_liquidity_arithmetic',
    question:
      'In Scenario G (Emergency £30,000 withdrawal during a concurrent -25% market crash), why is the £30,000 not double-counted as an investment loss, and how do liquid buffers protect portfolios?',
    expectedSupportStatus: 'fully_supported',
    expectedKeySubstrings: ['outflow', 'double-count', 'buffer', 'forced sale', '80,000'],
    expectedMustCiteDocOrSourceIds: ['lib/portfolio/multi-asset-risk-pilot.ts'],
    independentBenchmarkAnswer:
      'The £30,000 is an external capital outflow / liability, not an investment loss, preventing any double-count of market declines. Market assets are marked to market once at post-crash prices. Portfolios with >=£30k in cash and short gilts (e.g. Capital Preservation £80,000 buffer) suffer zero forced sale or equity liquidation.',
  },
  {
    questionId: 'G82-GATE-05',
    category: 'isa_regulatory_governance',
    question:
      'Under Section 1005 Income Tax Act 2007, why does CoreWeave (CRWV) satisfy HMRC statutory ISA eligibility, and why does Trading 212 hold it in Invest rather than ISA?',
    expectedSupportStatus: 'fully_supported',
    expectedKeySubstrings: ['1005', 'NASDAQ', 'Recognised Stock Exchange', 'Invest', 'catalog'],
    expectedMustCiteDocOrSourceIds: ['ita-2007-s1005', 'hmrc-isa-reg-1998-si1870'],
    independentBenchmarkAnswer:
      'CRWV meets HMRC statutory criteria under s.1005 ITA 2007 because it is admitted to trading on NASDAQ Global Select Market (a Recognised Stock Exchange). However, Trading 212 independently audits and curates its specific platform ISA catalog; until onboarding is finalized, it is offered exclusively in Invest (GIA).',
  },
];

/** Result types now come from the corrected shared runner. See lib/evaluation/legacy-question-runner.ts. */
export type FiveQuestionEvalTurnResult = LegacyTurnResult;
export type FiveQuestionEvalSummary = LegacySuiteSummary;

/**
 * Corrected (MVP hardening WP6). The previous implementation substituted `independentBenchmarkAnswer` for the
 * model's answer when unconfigured or on provider failure, fabricated token counts, request ids and bundle
 * hashes, and therefore always reported 100 % conformance. Those reported results are superseded.
 */
export async function runFiveQuestionPortfolioEvaluation(options?: {
  env?: Record<string, string | undefined>;
}): Promise<FiveQuestionEvalSummary> {
  const env = options?.env ?? process.env;
  return runLegacyQuestionSuite({
    suiteVersion: 'g8.2-final-gate-5-v2.0.0-corrected',
    questions: FIVE_PORTFOLIO_RESEARCH_QUESTIONS,
    env,
    apiKey: resolveGeminiApiKey(env).apiKey ?? null,
    promptPrefix: 'You are AI Capital Intelligence. Answer the following portfolio risk question using ONLY verified facts and citations.',
  });
}
