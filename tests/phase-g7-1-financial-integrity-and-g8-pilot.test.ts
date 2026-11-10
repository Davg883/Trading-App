import { describe, expect, it } from 'vitest';
import {
  auditG71SevenCompanyFinancialIntegrityGate,
  evaluateUniverseG71ExpandedValuationLayer,
  getSecXbrlExpansionPackage,
} from '../lib/research-ratings/sec-xbrl-expansion';
import {
  auditThesisMonitorMaterialClaims,
  evaluateAiCapexModerationThesis,
} from '../lib/research-ratings/thesis-monitor';
import {
  FIFTY_QUESTION_CHAT_BENCHMARK,
  investigateThirtySevenSecondGeminiResponse,
  runFiftyQuestionEvidenceLockedBenchmark,
} from '../lib/graph/chat-benchmark-50';
import {
  MARKET_DATA_PROVIDER_COMPARISON,
  PHASE_G8_EDUCATIONAL_BENCHMARK_PORTFOLIOS,
  PHASE_G8_STRESS_SCENARIOS,
  evaluatePhaseG8MultiAssetPilot,
} from '../lib/portfolio/multi-asset-risk-pilot';

describe('Phase G.7.1 Financial Integrity Gate & Phase G.8 Multi-Asset Readiness', () => {
  it('Requirement 1: reconciles AMZN $797,455M vs $759,776M TTM revenue, 2025-Q4 bridge, and Gross vs Net Capex/FCF ratios with zero discrepancy', () => {
    const pkg = getSecXbrlExpansionPackage();
    const amzn = pkg.companies.AMZN;
    const ttm = amzn.normalisedFinancialValues.trailingTwelveMonths;
    const quarterlySeries = amzn.normalisedFinancialValues.quarterlySeries;

    // 1. Exact TTM revenue and window alignment
    expect(ttm.revenueUsdMillions).toBe(797455);
    expect(ttm.periodStart).toBe('2025-10-01');
    expect(ttm.periodEnd).toBe('2026-09-30');

    // 2. Last 4 quarters in quarterlySeries include derived 2025-Q4 ($213,386M) and sum to $797,455M
    const last4Quarters = quarterlySeries.slice(-4);
    expect(last4Quarters.map((q) => q.periodEnd)).toEqual([
      '2025-12-31',
      '2026-03-31',
      '2026-06-30',
      '2026-09-30',
    ]);
    expect(last4Quarters.map((q) => q.revenueUsdMillions)).toEqual([
      213386,
      181519,
      200606,
      201944,
    ]);
    const fourQuarterSum = last4Quarters.reduce(
      (sum, q) => sum + (q.revenueUsdMillions ?? 0),
      0,
    );
    expect(fourQuarterSum).toBe(797455);

    // 3. Gross vs Net Capex, FCF, FCF Margin, and Capex/OCF ratios
    expect(ttm.operatingCashFlowUsdMillions).toBe(168300);
    expect(ttm.grossCapexUsdMillions).toBe(215192);
    expect(ttm.netCapexUsdMillions).toBe(210657);
    expect(ttm.grossFreeCashFlowUsdMillions).toBe(-46892);
    expect(ttm.freeCashFlowUsdMillions).toBe(-42357);
    expect(ttm.grossFcfMarginPct).toBe(-5.88);
    expect(ttm.ttmFcfMarginPct).toBe(-5.31);
    expect(ttm.grossCapexToOcfPct).toBe(127.86);
    expect(ttm.ttmCapexToOcfPct).toBe(125.17);

    // 4. Audit gate object confirms YTD bridge == 4Q sum == $797,455M
    const gate = auditG71SevenCompanyFinancialIntegrityGate();
    const rec = gate.amazonTtmRevenueReconciliation;
    expect(rec.authoritativeTtmRevenueUsdMillions).toBe(797455);
    expect(rec.erroneousChatSummaryFigureUsdBillions).toBe(759.776);
    expect(rec.discrepancyUsdMillions).toBe(37679);
    expect(rec.ytdBridgeCalculation.computedTotalUsdMillions).toBe(797455);
    expect(rec.discreteFourQuarterSum.computedTotalUsdMillions).toBe(797455);
    expect(rec.quarterlySeriesFourQuarterSumMatchesTtmBridge).toBe(true);
    expect(rec.ttmPeriodStartMatchesOct1).toBe(true);
  });

  it('Requirement 2 & 3: verifies all 98 seven-company SEC XBRL & valuation metrics and separates spot valuation eligibility from directional rating eligibility', () => {
    const gate = auditG71SevenCompanyFinancialIntegrityGate();

    expect(gate.sevenCompanyVerificationSummary.totalMetricsAudited).toBe(98);
    expect(
      gate.sevenCompanyVerificationSummary.countsByClassification
        .independently_verified,
    ).toBe(70);
    expect(
      gate.sevenCompanyVerificationSummary.countsByClassification
        .calculated_provisionally_suitable,
    ).toBe(24);
    expect(
      gate.sevenCompanyVerificationSummary.countsByClassification.conflicting,
    ).toBe(0);
    expect(
      gate.sevenCompanyVerificationSummary.countsByClassification.unusable,
    ).toBe(4);

    expect(
      gate.valuationVsDirectionalRatingSeparation.spotValuationEligibleCount,
    ).toBe(7);
    expect(
      gate.valuationVsDirectionalRatingSeparation
        .directionalRatingEligibleCount,
    ).toBe(0);
    expect(
      gate.valuationVsDirectionalRatingSeparation
        .allSevenStocksSpotValuationEligible,
    ).toBe(true);
    expect(
      gate.valuationVsDirectionalRatingSeparation
        .allSevenStocksDirectionalRatingsLockedInsufficientData,
    ).toBe(true);

    const valLayerResults = evaluateUniverseG71ExpandedValuationLayer();
    expect(valLayerResults.length).toBe(7);
    for (const res of valLayerResults) {
      expect(res.allValuationMultiplesResolved).toBe(false);
      expect(res.valuationEligibility.spotValuationCalculationEligible).toBe(true);
      expect(res.valuationEligibility.directionalInvestmentRatingEligible).toBe(
        false,
      );
      expect(res.valuationEligibility.historicalPercentileComparisonEligible).toBe(
        false,
      );
      expect(res.valuationEligibility.backtestAndMultiPeriodReturnEligible).toBe(
        false,
      );
      expect(res.metrics.marketCapUsdMillions.verificationClassification).toBe(
        'calculated_provisionally_suitable',
      );
      expect(
        res.metrics.marketCapUsdMillions.spotValuationCalculationEligible,
      ).toBe(true);
      expect(res.metrics.marketCapUsdMillions.directionalRatingEligible).toBe(
        false,
      );
    }
  });

  it('Requirement 4: audits all 15 material claims in the AI Capex Moderation Thesis Monitor with strict provenance and cutoff enforcement', () => {
    const thesis = evaluateAiCapexModerationThesis();
    expect(thesis.leadingIndicators.length).toBe(8);
    expect(thesis.evidenceChangeAssessment.counts).toEqual({
      supports: 1,
      contradicts: 4,
      neutral: 2,
      insufficient_evidence: 1,
    });
    const sumOfCounts =
      thesis.evidenceChangeAssessment.counts.supports +
      thesis.evidenceChangeAssessment.counts.contradicts +
      thesis.evidenceChangeAssessment.counts.neutral +
      thesis.evidenceChangeAssessment.counts.insufficient_evidence;
    expect(sumOfCounts).toBe(8);

    const claimsAudit = auditThesisMonitorMaterialClaims();
    expect(claimsAudit.totalClaimsAudited).toBe(15);
    expect(claimsAudit.zeroLookAheadViolationAtCutoff).toBe(true);
    expect(claimsAudit.zeroOpinionPromotedToFact).toBe(true);
    expect(claimsAudit.countsBySourceClassification).toEqual({
      verified_primary_sec_filing: 9,
      verified_regulatory_or_macro_release: 2,
      verified_contractual_lineage: 1,
      management_guidance_non_fact: 1,
      unofficial_pending_statutory_certification: 1,
      external_commentary_opinion_quarantined: 1,
    });
  });

  it('Requirement 5: executes the 50-question Evidence-Locked Chat benchmark and verifies the 37-second Gemini latency root cause', async () => {
    expect(FIFTY_QUESTION_CHAT_BENCHMARK.length).toBe(50);

    const summary = await runFiftyQuestionEvidenceLockedBenchmark();
    expect(summary.totalQuestions).toBe(50);
    expect(summary.categoryCounts).toEqual({
      primary_sec_filing_facts: 10,
      multi_hop_typedb_graph: 10,
      historical_cutoff_and_supersession: 10,
      provenance_separation: 10,
      abstention_and_adversarial_guardrails: 10,
    });
    expect(
      summary.results
        .filter((r) => r.sourceOmissionDetected)
        .map((r) => ({ id: r.questionId, cited: r.citedEvidenceIds })),
    ).toEqual([]);
    expect(summary.metrics.citationValidityRatePct).toBe(100);
    expect(summary.metrics.sourceOmissionRatePct).toBe(0);
    expect(
      summary.results
        .filter((r) => !r.factualAccuracyPassed)
        .map((r) => ({
          id: r.questionId,
          status: r.supportStatus,
          short: r.shortAnswer.slice(0, 120),
        })),
    ).toEqual([]);
    expect(summary.metrics.factualAccuracyRatePct).toBe(100);
    expect(summary.metrics.unsupportedClaimLeakageCount).toBe(0);
    expect(summary.metrics.correctAbstentionRatePct).toBe(100);
    expect(summary.metrics.abstentionQuestionsPassed).toBe(12);
    expect(summary.metrics.abstentionQuestionsTotal).toBe(12);

    const inv = investigateThirtySevenSecondGeminiResponse();
    expect(inv.observedWallClockLatencyMs).toBe(37393);
    expect(inv.providerRequestId).toBe('Tj3yaoqeGa6xuMYPoMuKoAk');
    const stepSum = inv.rootCauseWaterfallBreakdown.reduce(
      (s, step) => s + step.durationMs,
      0,
    );
    expect(stepSum).toBe(37393);
    expect(inv.remediationApplied.reorderedCandidateModels[0]).toBe(
      'gemini-3.5-flash',
    );
  });

  it('Requirement 6 & 7: verifies the Data Provider Comparison governance and Phase G.8 Multi-Asset Risk & Stress Pilot', () => {
    const pilot = evaluatePhaseG8MultiAssetPilot();

    expect(pilot.executionAuthority).toBe('none');
    expect(pilot.dataPurchaseGovernance.purchaseStatus).toBe(
      'awaiting_owner_approval_no_purchase_made',
    );
    expect(MARKET_DATA_PROVIDER_COMPARISON.length).toBe(7);

    expect(pilot.multiAssetUniverse.assetClassCount).toBe(8);
    expect(pilot.economicRegimeMonitor.indicators.length).toBe(9);
    expect(pilot.assetClassOpportunityScreening.length).toBe(8);
    expect(PHASE_G8_STRESS_SCENARIOS.length).toBe(7);
    expect(PHASE_G8_EDUCATIONAL_BENCHMARK_PORTFOLIOS.length).toBe(4);

    // Verify Owner Live Trading 212 Account (£250 GBP cash, 0 positions)
    expect(pilot.ownerLiveAccountRiskSummary.totalCashGbp).toBe(250);
    expect(pilot.ownerLiveAccountRiskSummary.openPositionsCount).toBe(0);
    expect(
      pilot.ownerLiveAccountRiskSummary.maxStressDrawdownAcrossAllScenariosPct,
    ).toBe(0);

    // Verify each benchmark portfolio allocations sum to 100% (£100,000) and ETF look-through overlap works
    for (const bench of pilot.educationalBenchmarkPortfolios) {
      expect(bench.notionalBasisGbp).toBe(100000);
      expect(bench.executionAuthority).toBe('none');
      const weightSum = bench.allocations.reduce((s, a) => s + a.weightPct, 0);
      expect(weightSum).toBe(100);
      expect(bench.stressScenarioImpacts.length).toBe(7);
    }

    const capPres = pilot.educationalBenchmarkPortfolios.find(
      (b) => b.portfolioId === 'bench-capital-preservation',
    )!;
    const techConc = pilot.educationalBenchmarkPortfolios.find(
      (b) => b.portfolioId === 'bench-tech-concentrated',
    )!;

    expect(capPres.riskAndExposureMetrics.totalTrueAiUniverseExposurePct).toBe(0);
    expect(
      capPres.riskAndExposureMetrics
        .monthsOfEmergencyReserveCoveredAt2500GbpPerMonth,
    ).toBe(32);

    // 70% direct AI + 25% S&P 500 (24.8% embedded AI = 6.20%) = 76.20% true AI exposure
    expect(techConc.riskAndExposureMetrics.directAiUniverseWeightPct).toBe(70);
    expect(techConc.riskAndExposureMetrics.etfLookThroughAiUniverseWeightPct).toBe(
      6.2,
    );
    expect(techConc.riskAndExposureMetrics.totalTrueAiUniverseExposurePct).toBe(
      76.2,
    );
  });
});
