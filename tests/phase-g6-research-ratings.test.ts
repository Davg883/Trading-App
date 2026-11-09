import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  RESEARCH_METHODOLOGY_CLASSIFICATION,
  RESEARCH_METHODOLOGY_VERSION,
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
      'AMZN',
      'GOOGL',
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

    // Verify primary SEC filing earnings scores for NVDA, MSFT, AMZN, GOOGL
    const nvda = evaluateCompanyResearchAssessment('NVDA');
    const msft = evaluateCompanyResearchAssessment('MSFT');
    const amzn = evaluateCompanyResearchAssessment('AMZN');
    const googl = evaluateCompanyResearchAssessment('GOOGL');
    const intc = evaluateCompanyResearchAssessment('INTC');

    expect(
      nvda.layers.quantitativeCalculation.dimensions.earnings_financial_health
        .score,
    ).toBe(89);
    expect(
      msft.layers.quantitativeCalculation.dimensions.earnings_financial_health
        .score,
    ).toBe(75.6);
    expect(
      amzn.layers.quantitativeCalculation.dimensions.earnings_financial_health
        .score,
    ).toBe(54.7);
    expect(
      googl.layers.quantitativeCalculation.dimensions.earnings_financial_health
        .score,
    ).toBe(53.4);
    expect(
      intc.layers.quantitativeCalculation.dimensions.earnings_financial_health
        .score,
    ).toBeNull();
    expect(
      intc.layers.quantitativeCalculation.dimensions.earnings_financial_health
        .status,
    ).toBe('insufficient_data');

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

  it('runs weight sensitivity analysis across 4 schemes and point-in-time backtest vs QQQ with transaction friction', () => {
    const report = runResearchMethodologyValidation();
    expect(report.methodologyVersion).toBe('aci-stock-rating-v1.0.0-exp');
    expect(report.weightSensitivity).toHaveLength(4);
    for (const scheme of report.weightSensitivity) {
      expect(scheme.rankedTickersByPriority[0]).toBe('NVDA');
      expect(scheme.topTwoTickers).toEqual(['NVDA', 'MSFT']);
      expect(scheme.spearmanRankCorrelationVsBaseline).toBeGreaterThanOrEqual(
        0.85,
      );
      expect(scheme.directionalLabelsEmitted).toBe(0);
    }

    // Point-in-time backtest vs QQQ with realistic costs (10bps spread + 5bps slippage + 15bps FX + £1 fee)
    expect(report.sampleSummary.tradingSessionsAvailable).toBe(46);
    expect(report.sampleSummary.requiredSessionsForProductionSignOff).toBe(252);
    expect(report.sampleSummary.sampleSufficientForPredictiveClaims).toBe(
      false,
    );
    expect(report.frictionAssumptions.spreadBps).toBe(10);
    expect(report.frictionAssumptions.slippageBps).toBe(5);
    expect(report.frictionAssumptions.fxConversionBps).toBe(15);
    expect(
      report.benchmarkComparisonVsQqq.cohortCumulativeGrossReturnUsdPct,
    ).toBeGreaterThan(
      report.benchmarkComparisonVsQqq.qqqCumulativeReturnUsdPct,
    );
  });

  it('builds the 5-sentence Today’s Market Briefing and What Changed historical delta feed', () => {
    const assessments = evaluateUniverseResearchAssessments();
    const briefing = buildExecutiveMarketBriefing(assessments);

    expect(briefing.sentences.marketEnvironment.length).toBeGreaterThan(30);
    expect(briefing.sentences.sectorDevelopments.length).toBeGreaterThan(30);
    expect(
      briefing.sentences.strongestResearchOpportunities.length,
    ).toBeGreaterThan(30);
    expect(briefing.sentences.highestMaterialRisks.length).toBeGreaterThan(30);
    expect(briefing.sentences.changesSincePriorSession.length).toBeGreaterThan(
      30,
    );
    expect(briefing.citedSourceIds.length).toBeGreaterThanOrEqual(5);

    const changes = buildWhatChangedSummary(assessments);
    expect(changes.length).toBeGreaterThanOrEqual(6);
    expect(changes.some((c) => c.category === 'typedb_relationship')).toBe(
      true,
    );
    expect(changes.some((c) => c.category === 'earnings_update')).toBe(true);
    expect(changes.some((c) => c.category === 'financing_change')).toBe(true);
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
    ).toBe(84.1);
  });
});
