import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import amazonCashRaw from '../data/earnings/amazon-q3-2026-cash.json';
import { amazonCashKpis } from '../lib/amazon-cash-conversion';
import {
  RESEARCH_METHODOLOGY_CLASSIFICATION,
  RESEARCH_METHODOLOGY_VERSION,
  buildExecutiveAssistantRequestPayload,
  buildExecutiveMarketBriefing,
  buildWhatChangedSummary,
  classifyAssessmentFromValidatedScores,
  evaluateCompanyResearchAssessment,
  evaluateUniverseResearchAssessments,
  runResearchMethodologyValidation,
} from '../lib/research-ratings/engine';
import { ExecutiveOverviewSections } from '../components/command-centre/executive-overview';

describe('Phase G.6 — Deterministic Stock Research Assessment Engine & Executive Dashboard', () => {
  it('versions the methodology and labels it Experimental research assessment while validation gates are incomplete', () => {
    expect(RESEARCH_METHODOLOGY_VERSION).toBe('aci-stock-rating-v1.0.0-exp');
    expect(RESEARCH_METHODOLOGY_CLASSIFICATION).toBe(
      'Experimental research assessment',
    );
  });

  it('evaluates all 7 companies, preserves null for missing dimensions instead of zero, and locks production ratings to INSUFFICIENT DATA', () => {
    const assessments = evaluateUniverseResearchAssessments();
    expect(assessments).toHaveLength(7);
    expect(assessments.map((a) => a.ticker)).toEqual([
      'NVDA',
      'MSFT',
      'GOOGL',
      'AMZN',
      'AMD',
      'CRWV',
      'INTC',
    ]);

    for (const item of assessments) {
      // Gate enforcement: no directional BUY/HOLD/SELL in production when valuation (30%) or 252-day validation is missing
      expect(item.assessment).toBe('INSUFFICIENT DATA');
      expect(item.evidenceCoverage.essentialGatesPassed).toBe(false);
      expect(item.methodologyVersion).toBe('aci-stock-rating-v1.0.0-exp');
      expect(item.executionAuthority).toBe('none');

      const dims = item.layers.quantitativeCalculation.dimensions;
      // Dimension 1 (Valuation & fundamentals, 30%) must be null (insufficient_data), never 0
      expect(dims.valuation_fundamentals.score).toBeNull();
      expect(dims.valuation_fundamentals.status).toBe('insufficient_data');
      expect(dims.valuation_fundamentals.provisionalWeight).toBe(0.3);

      // Dimension 3 (20D tactical momentum) is kept separate from 6-12M fundamental score
      expect(dims.momentum_trend.declaredHorizon).toBe(
        '20D Tactical (Separated from Fundamental Rating)',
      );
      expect(dims.earnings_financial_health.declaredHorizon).toBe(
        '6-12M Fundamental',
      );
    }

    // Verify primary SEC filing earnings & TypeDB macro scores for NVDA, MSFT, GOOGL, AMZN, INTC, AMD, CRWV
    const nvda = evaluateCompanyResearchAssessment('NVDA');
    const msft = evaluateCompanyResearchAssessment('MSFT');
    const googl = evaluateCompanyResearchAssessment('GOOGL');
    const amzn = evaluateCompanyResearchAssessment('AMZN');
    const intc = evaluateCompanyResearchAssessment('INTC');
    const amd = evaluateCompanyResearchAssessment('AMD');
    const crwv = evaluateCompanyResearchAssessment('CRWV');

    expect(nvda.evidenceCoverage.coveredWeightPct).toBe(70);
    expect(msft.evidenceCoverage.coveredWeightPct).toBe(70);
    expect(googl.evidenceCoverage.coveredWeightPct).toBe(70);
    expect(amzn.evidenceCoverage.coveredWeightPct).toBe(70);
    expect(amd.evidenceCoverage.coveredWeightPct).toBe(35);
    expect(crwv.evidenceCoverage.coveredWeightPct).toBe(35);
    expect(intc.evidenceCoverage.coveredWeightPct).toBe(25);

    expect(
      nvda.layers.quantitativeCalculation.dimensions.earnings_financial_health
        .score,
    ).toBe(89);
    expect(
      msft.layers.quantitativeCalculation.dimensions.earnings_financial_health
        .score,
    ).toBe(75.6);
    expect(
      googl.layers.quantitativeCalculation.dimensions.earnings_financial_health
        .score,
    ).toBe(53.4);
    expect(
      amzn.layers.quantitativeCalculation.dimensions.earnings_financial_health
        .score,
    ).toBe(49);
    expect(
      intc.layers.quantitativeCalculation.dimensions.earnings_financial_health
        .score,
    ).toBeNull();
    expect(
      intc.layers.quantitativeCalculation.dimensions.earnings_financial_health
        .status,
    ).toBe('insufficient_data');

    // Non-directional screening scores require SEC earnings table; INTC/AMD/CRWV remain null
    expect(nvda.researchPriorityScore).toBe(82.3);
    expect(msft.researchPriorityScore).toBe(73.7);
    expect(googl.researchPriorityScore).toBe(61.5);
    expect(amzn.researchPriorityScore).toBe(57.7);
    expect(intc.researchPriorityScore).toBeNull();
    expect(amd.researchPriorityScore).toBeNull();
    expect(crwv.researchPriorityScore).toBeNull();

    // Verify 4 distinct epistemic layers exist on every company assessment
    expect(nvda.layers.quantitativeCalculation.revenueUsdMillions).toBe(96221);
    expect(
      nvda.layers.sourceGroundedInterpretation.principalJustification,
    ).toContain('66.2% GAAP operating margin');
    expect(
      nvda.layers.geminiExplanation.cannotOverrideGateReason,
    ).toContain('hard-blocked from overriding');
    expect(nvda.layers.humanReviewerCommentary.reviewerNote).toContain(
      'remain locked until licensed valuation multiples',
    );
  });

  it('reconciles Amazon Q3 2026 and TTM-2026-Q3 vs TTM-2025-Q3 financial metrics 100% with lib/amazon-cash-conversion.ts', () => {
    const kpis = amazonCashKpis(
      amazonCashRaw,
      '2026-Q3',
      Date.parse('2026-11-03T16:05:00Z'),
    );
    const amzn = evaluateCompanyResearchAssessment('AMZN');
    const qCalc = amzn.layers.quantitativeCalculation;

    // 2026-Q3 revenue = $201,944M, operating income = $28,076M -> 13.9% GAAP operating margin
    expect(kpis.quarterly.companyRevenue.value).toBe(201944);
    expect(kpis.quarterly.companyOperatingIncome.value).toBe(28076);
    expect(qCalc.revenueUsdMillions).toBe(201944);
    expect(qCalc.operatingMarginPct).toBe(13.9);

    // TTM-2026-Q3 revenue = $797,455M, OCF = $168,300M, net capex = $210,657M (125.2% of OCF), FCF = -$42,357M (-5.3% of TTM revenue)
    expect(kpis.ttm.revenue.value).toBe(797455);
    expect(kpis.ttm.operatingCashFlow.value).toBe(168300);
    expect(kpis.ttm.netCapex.value).toBe(210657);
    expect(kpis.ttm.freeCashFlow.value).toBe(-42357);
    expect(qCalc.freeCashFlowUsdMillions).toBe(-42357);
    expect(qCalc.fcfMarginPct).toBe(-5.3);
    expect(qCalc.capexIntensityPct).toBe(26.4);

    // Confirm observedMetrics explicitly reconcile TTM-2026-Q3 (125.2%), TTM-2025-Q3 (88.7%), and 2025-Q3 gross capex/OCF (98.8%)
    const earningsDim = qCalc.dimensions.earnings_financial_health;
    const reconciliationMetric = earningsDim.observedMetrics.find((m) =>
      m.metric.includes('TTM-2026-Q3 vs Prior-Year TTM-2025-Q3'),
    );
    expect(reconciliationMetric?.valueDisplay).toContain('125.2% of TTM OCF');
    expect(reconciliationMetric?.valueDisplay).toContain('88.7%');
    expect(reconciliationMetric?.valueDisplay).toContain('98.8%');
  });

  it('deterministically classifies BUY, HOLD, SELL, AVOID, and INSUFFICIENT DATA and ignores chatbot override attempts', () => {
    // 1. Missing any dimension -> INSUFFICIENT DATA even if chatbot suggests BUY
    const missingVal = classifyAssessmentFromValidatedScores({
      dimensionScores: {
        valuation_fundamentals: null,
        earnings_financial_health: 89,
        momentum_trend: 80,
        macro_sector_exposure: 86,
        company_specific_risk: 76,
      },
      priceFresh: true,
      corporateActionsReviewed: true,
      backtestSampleSessions: 300,
      chatbotSuggestedOverride: 'BUY',
    });
    expect(missingVal.assessment).toBe('INSUFFICIENT DATA');
    expect(missingVal.gatesPassed).toBe(false);

    // 2. Backtest sample < 252 sessions -> INSUFFICIENT DATA even when all 5 dimensions are scored
    const shortSample = classifyAssessmentFromValidatedScores({
      dimensionScores: {
        valuation_fundamentals: 78,
        earnings_financial_health: 89,
        momentum_trend: 80,
        macro_sector_exposure: 86,
        company_specific_risk: 76,
      },
      priceFresh: true,
      corporateActionsReviewed: true,
      backtestSampleSessions: 46,
      chatbotSuggestedOverride: 'BUY',
    });
    expect(shortSample.assessment).toBe('INSUFFICIENT DATA');
    expect(shortSample.gatesPassed).toBe(false);

    // 3. All 5 dimensions present + >= 252 sessions + corporate actions verified + high scores -> BUY
    const buyResult = classifyAssessmentFromValidatedScores({
      dimensionScores: {
        valuation_fundamentals: 74,
        earnings_financial_health: 89,
        momentum_trend: 78,
        macro_sector_exposure: 86,
        company_specific_risk: 76,
      },
      priceFresh: true,
      corporateActionsReviewed: true,
      backtestSampleSessions: 252,
      chatbotSuggestedOverride: 'SELL', // Chatbot opinion cannot override deterministic BUY
    });
    expect(buyResult.assessment).toBe('BUY');
    expect(buyResult.gatesPassed).toBe(true);

    // 4. Moderate fundamental scores (48 <= composite < 72) -> HOLD
    const holdResult = classifyAssessmentFromValidatedScores({
      dimensionScores: {
        valuation_fundamentals: 58,
        earnings_financial_health: 62,
        momentum_trend: 55,
        macro_sector_exposure: 60,
        company_specific_risk: 58,
      },
      priceFresh: true,
      corporateActionsReviewed: true,
      backtestSampleSessions: 252,
    });
    expect(holdResult.assessment).toBe('HOLD');

    // 5. Weak composite (30 <= composite < 48) -> SELL
    const sellResult = classifyAssessmentFromValidatedScores({
      dimensionScores: {
        valuation_fundamentals: 35,
        earnings_financial_health: 42,
        momentum_trend: 40,
        macro_sector_exposure: 45,
        company_specific_risk: 45,
      },
      priceFresh: true,
      corporateActionsReviewed: true,
      backtestSampleSessions: 252,
    });
    expect(sellResult.assessment).toBe('SELL');

    // 6. Severe company-specific risk (< 30) or composite < 30 -> AVOID
    const avoidResult = classifyAssessmentFromValidatedScores({
      dimensionScores: {
        valuation_fundamentals: 55,
        earnings_financial_health: 50,
        momentum_trend: 45,
        macro_sector_exposure: 50,
        company_specific_risk: 25,
      },
      priceFresh: true,
      corporateActionsReviewed: true,
      backtestSampleSessions: 252,
    });
    expect(avoidResult.assessment).toBe('AVOID');
  });

  it('audits the 46-session comparison as an Illustrative Ex-Post Cohort Comparison and runs weight sensitivity across 4 schemes', () => {
    const report = runResearchMethodologyValidation();
    expect(report.methodologyVersion).toBe('aci-stock-rating-v1.0.0-exp');
    expect(report.weightSensitivity).toHaveLength(4);
    for (const scheme of report.weightSensitivity) {
      expect(scheme.rankedTickersByPriority[0]).toBe('NVDA');
      expect(scheme.topTwoTickers).toEqual(['NVDA', 'MSFT']);
      expect(scheme.spearmanRankCorrelationVsBaseline).toBeGreaterThanOrEqual(
        0.89,
      );
      expect(scheme.directionalLabelsEmitted).toBe(0);
    }

    // Verify 46-session comparison bias audit disclosures
    expect(report.sampleSummary.tradingSessionsAvailable).toBe(46);
    expect(report.sampleSummary.requiredSessionsForProductionSignOff).toBe(252);
    expect(report.sampleSummary.sampleSufficientForPredictiveClaims).toBe(
      false,
    );
    expect(
      report.biasControls.fortySixSessionComparisonAudit
        .isStrictPointInTimeBacktest,
    ).toBe(false);
    expect(
      report.benchmarkComparisonVsQqq.comparisonClassification,
    ).toBe(
      'Illustrative Ex-Post Cohort Comparison (Non-Predictive; Not Strict Point-in-Time)',
    );
    expect(
      report.benchmarkComparisonVsQqq.windows[0]
        ?.eligibleTickersWithPrimaryFilings,
    ).toEqual(['NVDA']);
    // At the final weekly window anchor (2026-10-28 -> 2026-11-04), NVDA (2026-08-26), MSFT (2026-10-28), and GOOGL (2026-10-28)
    // were published on or before the anchor date, whereas AMZN (2026-10-29) published 1 day after the anchor.
    expect(
      report.benchmarkComparisonVsQqq.windows.at(-1)
        ?.eligibleTickersWithPrimaryFilings,
    ).toEqual(['NVDA', 'MSFT', 'GOOGL']);
  });

  it('builds the dated 5-sentence Today’s Market Briefing, What Changed delta feed, and privacy-isolated assistant payload', () => {
    const assessments = evaluateUniverseResearchAssessments();
    const briefing = buildExecutiveMarketBriefing(assessments);

    expect(briefing.sentences.marketEnvironment).toContain('2026-11-04');
    expect(briefing.sentences.sectorDevelopments).toContain('$895.4B USD');
    expect(briefing.sentences.strongestResearchOpportunities).toContain(
      'Not Buy/Hold/Sell Recommendations',
    );
    expect(briefing.sentences.highestMaterialRisks).toContain('125.2%');
    expect(briefing.sentences.highestMaterialRisks).toContain('88.7%');
    expect(briefing.sentences.changesSincePriorSession).toContain('23/23');
    expect(briefing.citedSourceIds.length).toBeGreaterThanOrEqual(5);

    const changes = buildWhatChangedSummary(assessments);
    expect(changes.length).toBeGreaterThanOrEqual(6);
    expect(changes.some((c) => c.category === 'typedb_relationship')).toBe(
      true,
    );
    expect(changes.some((c) => c.category === 'earnings_update')).toBe(true);
    expect(changes.some((c) => c.category === 'financing_change')).toBe(true);

    // Confirm public-research assistant payload never contains private broker fields
    const payload = buildExecutiveAssistantRequestPayload(
      'Why did NVIDIA receive this assessment?',
    );
    expect(Object.keys(payload)).toEqual([
      'question',
      'temporalBasis',
      'mode',
    ]);
  });

  it('renders ExecutiveOverviewSections with Section A, Section B slot, Section C, Section D, and Section E cleanly and isolates portfolio holdings from research scores', () => {
    const now = Date.parse('2026-11-06T15:00:00Z');
    const htmlWithoutHoldings = renderToStaticMarkup(
      React.createElement(ExecutiveOverviewSections, {
        watchlist: [],
        ownedTickers: [],
        now,
        portfolioSnapshotSlot: React.createElement(
          'section',
          { 'data-testid': 'portfolio-snapshot' },
          'Portfolio Snapshot Slot',
        ),
      }),
    );

    const htmlWithHoldings = renderToStaticMarkup(
      React.createElement(ExecutiveOverviewSections, {
        watchlist: [],
        ownedTickers: ['NVDA_US_EQ', 'MSFT_US_EQ'],
        now,
        portfolioSnapshotSlot: React.createElement(
          'section',
          { 'data-testid': 'portfolio-snapshot' },
          'Portfolio Snapshot Slot',
        ),
      }),
    );

    expect(htmlWithoutHoldings).toContain(
      'data-testid="executive-market-briefing"',
    );
    expect(htmlWithoutHoldings).toContain('data-testid="portfolio-snapshot"');
    expect(htmlWithoutHoldings).toContain('data-testid="stock-research-table"');
    expect(htmlWithoutHoldings).toContain('data-testid="blocking-reasons-NVDA"');
    expect(htmlWithoutHoldings).toContain(
      'Non-Directional — Not Buy/Hold/Sell',
    );
    expect(htmlWithoutHoldings).toContain(
      'Illustrative Ex-Post Cohort Comparison vs QQQ',
    );
    expect(htmlWithoutHoldings).toContain(
      'data-testid="company-assessment-drawer"',
    );
    expect(htmlWithoutHoldings).toContain('data-testid="what-changed-panel"');
    expect(htmlWithoutHoldings).toContain(
      'data-testid="executive-research-assistant"',
    );

    // Verify that owning NVDA or MSFT in Trading 212 adds the 'Held in portfolio (isolated)' badge but never alters the INSUFFICIENT DATA assessment or priority score
    expect(htmlWithHoldings).toContain('Held in portfolio (isolated)');
    expect(
      evaluateCompanyResearchAssessment('NVDA').researchPriorityScore,
    ).toBe(82.3);
  });
});
