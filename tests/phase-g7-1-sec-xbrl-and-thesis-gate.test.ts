import { describe, expect, it } from 'vitest';
import {
  evaluateAiCapexModerationThesis,
  runValidatedThesisChatExplanationTest,
} from '../lib/research-ratings/thesis-monitor';
import {
  SEC_XBRL_EXPANSION_VERSION,
  buildG71ValuationInputBundles,
  evaluateUniverseG71ExpandedValuationLayer,
  getSecXbrlCompanyRecord,
  getSecXbrlExpansionPackage,
  getSevenStockCoverageMatrixG71,
  summariseG71BeforeAfterCoverage,
} from '../lib/research-ratings/sec-xbrl-expansion';
import { evaluateUniverseResearchAssessments } from '../lib/research-ratings/engine';

describe('Phase G.7.1 — Thesis Monitor v2.1.0 Quality Gate & SEC XBRL Expansion', () => {
  it('Part A.1 & A.2: explains the v2.0.0 9-across-8 root cause and enforces 1+4+2+1=8 unique indicator sum invariant', () => {
    const report = evaluateAiCapexModerationThesis();
    expect(report.version).toBe('aci-thesis-monitor-v2.1.0');
    expect(report.partAQualityGateAudit.priorVersionReportedCounts.sum).toBe(9);
    expect(
      report.partAQualityGateAudit.priorVersionReportedCounts.declaredIndicatorsCount,
    ).toBe(8);
    expect(report.partAQualityGateAudit.rootCauseOfNineCountMismatch).toContain(
      '9-item `rawChangeItems` list',
    );
    expect(
      report.partAQualityGateAudit.correctedCountsDerivedFromUniqueIndicators.sum,
    ).toBe(8);
    expect(
      report.partAQualityGateAudit.correctedCountsDerivedFromUniqueIndicators
        .declaredIndicatorsCount,
    ).toBe(8);
    expect(
      report.partAQualityGateAudit.correctedCountsDerivedFromUniqueIndicators
        .sumEqualsDeclaredCount,
    ).toBe(true);
    expect(report.evidenceChangeAssessment.zeroDuplicateIndicatorIds).toBe(true);
    expect(
      report.evidenceChangeAssessment.sumOfMutuallyExclusiveCountsEqualsTotal,
    ).toBe(true);

    const { counts } = report.evidenceChangeAssessment;
    expect(counts).toEqual({
      supports: 1,
      contradicts: 4,
      neutral: 2,
      insufficient_evidence: 1,
    });
    expect(
      counts.supports + counts.contradicts + counts.neutral + counts.insufficient_evidence,
    ).toBe(report.leadingIndicators.length);
  });

  it('Part A.3–A.6: separates fact, hypothesis, relevance, direction, confidence, and freshness, and never counts neutral/insufficient as supporting', () => {
    const report = evaluateAiCapexModerationThesis();
    const indicators = report.leadingIndicators;
    expect(indicators).toHaveLength(8);

    const byId = Object.fromEntries(indicators.map((ind) => [ind.indicatorId, ind]));
    expect(byId['ind-capex-to-ocf']?.evidenceClassification).toBe('contradicts');
    expect(byId['ind-free-cash-flow']?.evidenceClassification).toBe('contradicts');
    expect(byId['ind-cloud-revenue-growth']?.evidenceClassification).toBe('supports');
    expect(byId['ind-semiconductor-demand']?.evidenceClassification).toBe('contradicts');
    expect(byId['ind-project-deployment-delays']?.evidenceClassification).toBe('neutral');
    expect(byId['ind-credit-spreads-and-financing']?.evidenceClassification).toBe('contradicts');
    expect(byId['ind-power-availability']?.evidenceClassification).toBe('neutral');
    expect(byId['ind-regulatory-developments']?.evidenceClassification).toBe(
      'insufficient_evidence',
    );

    for (const ind of indicators) {
      expect(ind.observedFinancialFact.length).toBeGreaterThan(10);
      expect(ind.hypothesisBeingTested.length).toBeGreaterThan(10);
      expect(ind.relevanceOfObservation.length).toBeGreaterThan(10);
      expect(ind.evidenceDirection).toBe(ind.evidenceClassification);
      expect(ind.sourceConfidence.level).toMatch(
        /^(high_primary_filing_or_regulator|medium_mixed_primary_and_reported|low_unofficial_or_secondary)$/,
      );
      expect(ind.freshnessAndHistoricalEligibility.freshnessStatus).toBe(
        ind.freshnessStatus,
      );
      expect(ind.latestEligibleObservation.length).toBeGreaterThan(3);
      expect(ind.previousComparableObservation.length).toBeGreaterThan(3);
      expect(ind.materialChange.summary.length).toBeGreaterThan(3);

      if (
        ind.evidenceClassification === 'neutral' ||
        ind.evidenceClassification === 'insufficient_evidence'
      ) {
        expect(ind.hypothesisResolution).toBe('does_not_resolve');
      }
    }
  });

  it('Part A.7: validates Thesis Monitor v2.1.0 evidence-locked chat explanation across all 9 deterministic checks', async () => {
    const chatAudit = await runValidatedThesisChatExplanationTest();
    expect(chatAudit.validationReport.valid).toBe(true);
    expect(chatAudit.validationReport.checks.every((check) => check.passed)).toBe(true);
  });

  it('Part B: verifies SEC EDGAR XBRL expansion package across all 7 stocks with 16/16 staging verification checks', () => {
    const pkg = getSecXbrlExpansionPackage();
    expect(pkg.schemaVersion).toBe(SEC_XBRL_EXPANSION_VERSION);
    expect(pkg.stagingSampleVerification.allSamplesMatched).toBe(true);
    expect(pkg.stagingSampleVerification.totalSamplesChecked).toBe(16);

    for (const ticker of ['NVDA', 'MSFT', 'GOOGL', 'AMZN', 'AMD', 'CRWV', 'INTC'] as const) {
      const { record, eligibleQuarters } = getSecXbrlCompanyRecord(ticker);
      expect(record.cik).toMatch(/^\d{10}$/);
      expect(eligibleQuarters.length).toBeGreaterThanOrEqual(4);
      expect(
        record.normalisedFinancialValues.balanceSheet.totalCashAndLiquidityUsdMillions,
      ).toBeGreaterThan(0);
      expect(
        record.normalisedFinancialValues.shareCounts
          .weightedAverageDilutedSharesMillions,
      ).toBeGreaterThan(0);
    }

    const summary = summariseG71BeforeAfterCoverage();
    expect(summary.beforeByStatus.verified).toBe(18);
    expect(summary.afterByStatus.verified).toBe(49);
    expect(summary.verifiedCellsAdded).toBe(31);
    expect(getSevenStockCoverageMatrixG71()).toHaveLength(84);
  });

  it('Part C: updates non-directional priority scores for AMD, CRWV, and INTC while keeping all 7 stocks locked at INSUFFICIENT DATA', () => {
    const bundles = buildG71ValuationInputBundles();
    expect(bundles).toHaveLength(7);
    const valLayer = evaluateUniverseG71ExpandedValuationLayer();
    expect(
      valLayer.every(
        (v) =>
          v.metrics.evToTtmRevenue.value !== null &&
          v.metrics.fcfYieldOnMarketCapPct.value !== null,
      ),
    ).toBe(true);

    const assessments = evaluateUniverseResearchAssessments();
    const byTicker = Object.fromEntries(assessments.map((a) => [a.ticker, a]));

    expect(byTicker.AMD?.researchPriorityScore).toBe(63.0);
    expect(byTicker.INTC?.researchPriorityScore).toBe(54.1);
    expect(byTicker.CRWV?.researchPriorityScore).toBe(36.1);

    for (const a of assessments) {
      expect(a.executionAuthority).toBe('none');
      expect(a.assessment).toBe('INSUFFICIENT DATA');
      expect(a.evidenceCoverage.essentialGatesPassed).toBe(false);
    }
  });
});
