import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  evaluatePhaseG81PortfolioRisk,
  reconcileCoreWeaveIsaStatus,
  reconcileOfficialSoniaObservation,
  reconcileAnthropicCommitmentLedger,
  auditSevenStressScenarios,
  calculatePortfolioConcentrationIntelligence,
  evaluateUnseenBenchmarkSample,
  UNSEEN_BENCHMARK_EVALUATION_QUESTIONS,
  PHASE_G8_MULTI_ASSET_UNIVERSE,
} from '../lib/portfolio/multi-asset-risk-pilot';
import { PortfolioRiskDashboard } from '../components/portfolio-risk-dashboard';

describe('Phase G.8.1 — Portfolio Risk Intelligence & Data Quality Acceptance', () => {
  describe('Stage 1: Source & Classification Reconciliations', () => {
    it('verifies CoreWeave ISA qualification under HMRC s.1005 ITA 2007 and removes blanket disqualification', () => {
      const crwvReport = reconcileCoreWeaveIsaStatus();

      expect(crwvReport.ticker).toBe('CRWV');
      expect(crwvReport.blanketClassificationRemoved).toBe(true);
      expect(crwvReport.hmrcStatutoryCriteria.meetsExchangeRequirement).toBe(true);
      expect(crwvReport.hmrcStatutoryCriteria.exchange).toBe('NASDAQ Global Select Market');
      expect(crwvReport.brokerSpecificCriteria.currentCatalogStatus).toBe('trading212_invest_only');

      // Universe instrument check
      const crwvInst = PHASE_G8_MULTI_ASSET_UNIVERSE.find((i) => i.ticker === 'CRWV');
      expect(crwvInst).toBeDefined();
      expect(crwvInst?.isaEligibilityStatus.qualifyingExchangeStatus).toBe('hmrc_recognised_exchange');
      expect(crwvInst?.isaEligibilityStatus.brokerCatalogStatus).toBe('trading212_invest_only');
      expect(crwvInst?.isaEligibilityStatus.isIsaEligible).toBe(false);
      expect(crwvInst?.isaEligibilityStatus.statutoryBasis).toContain('s.1005 ITA 2007');
    });

    it('reconciles official Bank of England SONIA observation (3.99%), observation date, and IADB series code', () => {
      const soniaReport = reconcileOfficialSoniaObservation();

      expect(soniaReport.observationDate).toBe('2026-11-06');
      expect(soniaReport.publicationTimestamp).toBe('2026-11-09T09:00:00Z');
      expect(soniaReport.sourceSeriesCode).toBe('IUDSOIA');
      expect(soniaReport.soniaRatePct).toBe(3.99);
      expect(soniaReport.soniaExactReportedPct).toBe(3.9852);
      expect(soniaReport.bankRatePct).toBe(4.0);
      expect(soniaReport.spreadToBankRateBps).toBe(-1.48);
      expect(soniaReport.reconciliationNotes.length).toBeGreaterThanOrEqual(4);
    });

    it('reconciles Anthropic commitment totals ($895.4B canonical vs $940.0B gross vs $955.4B options)', () => {
      const anthropicReport = reconcileAnthropicCommitmentLedger();

      expect(anthropicReport.canonicalDeduplicatedEnvelopeUsdBillions).toBe(895.4);
      expect(anthropicReport.naiveGrossHeadlineAUsdBillions).toBe(940.0);
      expect(anthropicReport.naiveGrossHeadlineBUsdBillions).toBe(955.4);
      expect(anthropicReport.doubleCountingPreventedUsdBillions).toBe(60.0);

      // Verify line items
      const aws = anthropicReport.lineItems.find((i) => i.itemId === 'anthropic-aws-binding');
      const gcp = anthropicReport.lineItems.find((i) => i.itemId === 'anthropic-gcp-binding');
      const azure = anthropicReport.lineItems.find((i) => i.itemId === 'anthropic-azure-binding');
      const nscale = anthropicReport.lineItems.find((i) => i.itemId === 'anthropic-nscale-monarch-subcontract');
      const options = anthropicReport.lineItems.find((i) => i.itemId === 'anthropic-gpu-options-uncommitted');

      expect(aws?.includedInCanonicalDeduplicatedEnvelope).toBe(true);
      expect(gcp?.includedInCanonicalDeduplicatedEnvelope).toBe(true);
      expect(azure?.includedInCanonicalDeduplicatedEnvelope).toBe(true);
      expect(nscale?.includedInCanonicalDeduplicatedEnvelope).toBe(false);
      expect(options?.includedInCanonicalDeduplicatedEnvelope).toBe(false);

      expect(aws!.nominalAmountUsdBillions + gcp!.nominalAmountUsdBillions + azure!.nominalAmountUsdBillions).toBe(895.4);
      expect(895.4 + nscale!.nominalAmountUsdBillions).toBe(940.0);
      expect(940.0 + options!.nominalAmountUsdBillions).toBe(955.4);
    });
  });

  describe('Stage 2: Audit of Seven Stress Scenarios', () => {
    it('audits all seven scenarios and verifies arithmetic, assumptions, and key influencers', () => {
      const sheets = auditSevenStressScenarios();
      expect(sheets).toHaveLength(7);

      const [scA, scB, scC, scD, scE, scF, scG] = sheets;
      expect(scA?.scenarioCode).toBe('Scenario A');
      expect(scB?.scenarioCode).toBe('Scenario B');
      expect(scC?.scenarioCode).toBe('Scenario C');
      expect(scD?.scenarioCode).toBe('Scenario D');
      expect(scE?.scenarioCode).toBe('Scenario E');
      expect(scF?.scenarioCode).toBe('Scenario F');
      expect(scG?.scenarioCode).toBe('Scenario G');

      // Verify Scenario E stagflation positive correlation invariant
      expect(scE?.underlyingAssumptions.stockBondCorrelation).toBe('positive_stagflationary');
      expect(scE?.assetShocksPct.uk_gilts_and_quality_bonds).toBe(-6.5);
      expect(scE?.assetShocksPct.developed_market_equities).toBe(-15.0);
      expect(scE?.assetShocksPct.ai_and_semiconductor_equities).toBe(-24.0);
      expect(scE?.assetShocksPct.gold_and_diversifiers).toBe(11.5);
      expect(scE?.assetShocksPct.cyclical_equity_sectors).toBe(4.5);
      expect(scE?.assetShocksPct.sterling_cash_and_deposits).toBe(0.0);

      // Verify Scenario F FX translation shock (-9.09% rounded to -9.1%)
      expect(scF?.assetShocksPct.ai_and_semiconductor_equities).toBe(-9.1);
      expect(scF?.underlyingAssumptions.fxChangePct).toBe(10.0);

      // Verify every scenario enforces the non-guaranteed disclaimer
      for (const sc of sheets) {
        expect(sc.disclaimer).toContain('NOT a guaranteed maximum drawdown');
        expect(sc.sensitivityVariations.length).toBeGreaterThanOrEqual(2);
        expect(sc.keyInfluencerAnalysis.length).toBeGreaterThan(20);
      }
    });
  });

  describe('Stage 3 & 4: Portfolio Concentration & Look-Through Intelligence', () => {
    it('evaluates owner baseline (£250 cash fixture) with £0 stress loss across all scenarios and distinguishes development fixture', () => {
      const report = calculatePortfolioConcentrationIntelligence({
        accountSummary: { totalValue: 250.0, cash: 250.0 },
        positions: [],
      });

      expect(report.totalPortfolioValueGbp).toBe(250.0);
      expect(report.cashGbp).toBe(250.0);
      expect(report.investedPositionsValueGbp).toBe(0.0);
      expect(report.openPositionsCount).toBe(0);
      expect(report.cashAllocationPct).toBe(100.0);
      expect(report.equityAllocationPct).toBe(0.0);
      expect(report.portfolioEffectiveDurationYears).toBe(0.0);
      expect(report.aiSectorExposure.totalAiExposurePct).toBe(0.0);
      expect(report.currencyExposure.GBP.weightPct).toBe(100.0);
      expect(report.currencyExposure.USD.weightPct).toBe(0.0);
      expect(report.isDevelopmentFixture).toBe(true);
      expect(report.connectionStatus).toBe('fixture_baseline');

      // Instantaneous stress shocks: cash experiences exactly £0 price loss (par preserved)
      for (const sens of report.scenarioSensitivities) {
        expect(sens.estimatedPnlGbp).toBe(0);
        expect(sens.estimatedPortfolioReturnPct).toBe(0);
      }
    });

    it('calculates true AI exposure via direct holdings and ETF look-through and reports unknown constituent exposure', () => {
      const report = calculatePortfolioConcentrationIntelligence({
        accountSummary: { totalValue: 100_000, cash: 10_000 },
        positions: [
          // S&P 500 ETF (£25k) -> 24.8% AI weight
          { ticker: 'CSP1.L', name: 'iShares Core S&P 500', currency: 'GBP', valuationGbp: 25_000 },
          // Direct NVDA (£15k)
          { ticker: 'NVDA', name: 'NVIDIA Corp', currency: 'USD', valuationGbp: 15_000 },
          // Opaque/Unverified ETF (£10k)
          { ticker: 'OPAQUE.L', name: 'Opaque Thematic Fund', currency: 'GBP', valuationGbp: 10_000 },
          // UK Gilts (£40k)
          { ticker: 'GLTS.L', name: 'iShares UK Gilts 0-5yr', currency: 'GBP', valuationGbp: 40_000 },
        ],
      });

      expect(report.totalPortfolioValueGbp).toBe(100_000);
      expect(report.cashAllocationPct).toBe(10.0);

      // Direct AI = 15.0% (NVDA)
      expect(report.aiSectorExposure.directWeightPct).toBe(15.0);

      // Look-through AI from CSP1 = 25% * 24.8% = 6.20%
      expect(report.aiSectorExposure.etfLookThroughWeightPct).toBe(6.2);

      // Total true AI = 15.0 + 6.2 = 21.2%
      expect(report.aiSectorExposure.totalAiExposurePct).toBe(21.2);

      // Unknown constituent exposure from OPAQUE.L = 10.0%
      expect(report.unknownConstituentExposurePct).toBe(10.0);
      expect(report.etfLookThroughSummary.find((e) => e.etfTicker === 'OPAQUE.L')?.hasVerifiedConstituents).toBe(false);

      // Verify risk alert triggers for >20% AI concentration
      expect(report.riskAlerts.some((a) => a.id === 'alert-high-ai-exposure')).toBe(true);
      expect(report.riskAlerts.some((a) => a.id === 'alert-unknown-etf-constituents')).toBe(true);
    });
  });

  describe('Stage 5: Portfolio Risk Dashboard UI Component', () => {
    it('renders the complete PortfolioRiskDashboard static markup with all 5 sections and governance tags', () => {
      const report = evaluatePhaseG81PortfolioRisk();
      const markup = renderToStaticMarkup(
        React.createElement(PortfolioRiskDashboard, { initialReport: report }),
      );

      expect(markup).toContain('data-testid="portfolio-risk-page"');
      expect(markup).toContain('data-testid="portfolio-overview-section"');
      expect(markup).toContain('data-testid="portfolio-diversification-section"');
      expect(markup).toContain('data-testid="portfolio-stress-section"');
      expect(markup).toContain('data-testid="portfolio-alerts-section"');
      expect(markup).toContain('data-testid="portfolio-ai-chat-section"');
      expect(markup).toContain('data-testid="portfolio-drawers-section"');

      // Disclaimers and governance pills
      expect(markup).toContain('Execution: Read-Only (Disabled)');
      expect(markup).toContain('CRITICAL GOVERNANCE DISCLAIMER');
      expect(markup).toContain('guaranteed maximum drawdown');

      // Stage 1 reconciliations in technical drawers
      expect(markup).toContain('Series IUDSOIA');
      expect(markup).toContain('3.99%');
      expect(markup).toContain('$895.4B');
      expect(markup).toContain('Section 1005 Income Tax Act 2007');
    });
  });

  describe('Stage 6: Independent AI Benchmark (Unseen Evaluation Sample)', () => {
    it('evaluates 15 previously unseen out-of-distribution questions with full accuracy, citation, and abstention compliance as a deterministic local validation suite', () => {
      const summary = evaluateUnseenBenchmarkSample();

      expect(summary.totalQuestions).toBe(15);
      expect(summary.supportedEvaluated).toBe(10);
      expect(summary.abstentionsEvaluated).toBe(5);
      expect(summary.factualAccuracyRatePct).toBe(100.0);
      expect(summary.citationValidityRatePct).toBe(100.0);
      expect(summary.correctAbstentionRatePct).toBe(100.0);
      expect(summary.sourceOmissionRatePct).toBe(0.0);
      expect(summary.averageLatencyMs).toBeLessThan(1500);
      expect(summary.estimatedTotalCostUsd).toBeLessThan(0.01);
      expect(summary.inferenceProvider).toBe('deterministic_local_validator');
      expect(summary.generationMode).toBe('deterministic_local_fallback');
      expect(summary.liveModelInferenceClaimed).toBe(false);
      expect(summary.reliabilityDeclaration).toContain('without claiming live-model inference');

      expect(UNSEEN_BENCHMARK_EVALUATION_QUESTIONS).toHaveLength(15);
      const q2 = UNSEEN_BENCHMARK_EVALUATION_QUESTIONS.find((q) => q.questionId === 'UNSEEN-02');
      expect(q2?.question).toContain('3.99%');
      expect(q2?.question).toContain('4.00%');
      expect(q2?.expectedKeySubstrings).toContain('3.9852');
    });
  });

  describe('Stage 7: Production Acceptance Verification', () => {
    it('executes evaluatePhaseG81PortfolioRisk and confirms all production criteria are satisfied', () => {
      const report = evaluatePhaseG81PortfolioRisk();

      expect(report.version).toBe('aci-phase-g8-1-portfolio-risk-v1.0.0');
      expect(report.executionAuthority).toBe('none');
      expect(report.productionAcceptanceStatus).toBe('production_ready_read_only_governance_enforced');
      expect(report.stage2StressScenarioAudit.scenariosAuditedCount).toBe(7);
      expect(report.stage6IndependentAiBenchmark.unseenSampleSummary.totalQuestions).toBe(15);
      expect(report.stage6IndependentAiBenchmark.fixed50QuestionBenchmarkSummary.totalQuestions).toBe(50);
    });
  });
});
