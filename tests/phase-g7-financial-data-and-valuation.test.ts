import { describe, expect, it } from 'vitest';
import {
  LEGITIMATE_DATA_SOURCES_CATALOG,
  SEVEN_STOCK_COVERAGE_MATRIX,
  auditProductionIntegrityAndMetricProvenance,
  evaluateFiveTierReleaseGates,
  summariseSevenStockCoverageAudit,
} from '../lib/research-ratings/financial-data-readiness';
import {
  VALUATION_LAYER_VERSION,
  computeDeterministicValuationMetrics,
  evaluateUniverseCurrentValuationLayer,
  normaliseToUsdMillions,
  type ValuationInputBundle,
} from '../lib/research-ratings/valuation-layer';
import {
  computeAssessmentTransitionLedger,
  createImmutableAssessmentSnapshot,
  evaluateForwardAssessmentOutcomes,
  verifyAssessmentSnapshotIntegrity,
  type ForwardMarketBar,
} from '../lib/research-ratings/forward-evaluation';

describe('Phase G.7 — Financial Data Completeness, Deterministic Valuation Layer & Forward Evaluation', () => {
  it('Stage 1: audits all 7 stocks across all 12 financial categories (84 cells) and separates £0 SEC XBRL fixes from paid feeds', () => {
    const summary = summariseSevenStockCoverageAudit();
    expect(summary.totalCells).toBe(84);

    const tickers = new Set(SEVEN_STOCK_COVERAGE_MATRIX.map((c) => c.ticker));
    expect([...tickers].sort()).toEqual([
      'AMD',
      'AMZN',
      'CRWV',
      'GOOGL',
      'INTC',
      'MSFT',
      'NVDA',
    ]);

    const categories = new Set(SEVEN_STOCK_COVERAGE_MATRIX.map((c) => c.category));
    expect(categories.size).toBe(12);

    // Every cell must have a valid audit status
    for (const cell of SEVEN_STOCK_COVERAGE_MATRIX) {
      expect(['verified', 'stale', 'missing', 'conflicting', 'unsuitable']).toContain(
        cell.status,
      );
      expect(cell.auditFinding.length).toBeGreaterThan(10);
    }

    // Verify exact breakdown: 18 verified (4 companies x 4 income/cashflow + 2 exact SEC timestamps),
    // and majority of non-verified cells are achievable at £0 via SEC EDGAR XBRL API
    expect(summary.byStatus.verified).toBe(18);
    expect(summary.resolvableAtZeroCostCount).toBeGreaterThanOrEqual(45);
    expect(summary.requiresPaidCommercialFeedCount).toBe(20);
  });

  it('Stage 2: documents legitimate data sources, licensing, commercial reuse rights, and ongoing costs', () => {
    expect(LEGITIMATE_DATA_SOURCES_CATALOG.length).toBeGreaterThanOrEqual(8);

    const secSource = LEGITIMATE_DATA_SOURCES_CATALOG.find(
      (s) => s.sourceId === 'sec_edgar_xbrl_api',
    )!;
    expect(secSource.commercialRedistributionPermitted).toBe('yes');
    expect(secSource.estimatedMonthlyCostGbpOrUsd).toContain('£0');

    const nasdaqPublic = LEGITIMATE_DATA_SOURCES_CATALOG.find(
      (s) => s.sourceId === 'nasdaq_public_historical_api',
    )!;
    expect(nasdaqPublic.commercialRedistributionPermitted).toBe('no');
    expect(nasdaqPublic.internalPersonalResearchPermitted).toBe('yes');

    const trading212 = LEGITIMATE_DATA_SOURCES_CATALOG.find(
      (s) => s.sourceId === 'trading212_personal_account_api',
    )!;
    expect(trading212.recommendationStatus).toBe('Prohibited for Market Data Feed');
  });

  it('Stage 3a: evaluates the current stored repository universe, verifying same-period margins and preserving null for missing multiples', () => {
    const results = evaluateUniverseCurrentValuationLayer();
    expect(results).toHaveLength(7);

    const byTicker = Object.fromEntries(results.map((r) => [r.ticker, r]));

    // NVDA: FY2027 Q2 operating margin = 63,734 / 96,221 = 66.24%, FCF margin = 21,341 / 96,221 = 22.18%
    expect(byTicker.NVDA!.version).toBe(VALUATION_LAYER_VERSION);
    expect(byTicker.NVDA!.metrics.gaapOperatingMarginPct.value).toBe(66.24);
    expect(byTicker.NVDA!.metrics.gaapNetMarginPct.value).toBe(62.03);
    expect(byTicker.NVDA!.metrics.fcfMarginPct.value).toBe(22.18);
    expect(byTicker.NVDA!.metrics.netCapexToOcfPct.value).toBe(11.12);
    // Valuation multiples must be null because diluted shares, balance sheet debt/cash, and 4Q TTM flows are missing
    expect(byTicker.NVDA!.metrics.marketCapUsdMillions.value).toBeNull();
    expect(byTicker.NVDA!.metrics.enterpriseValueUsdMillions.value).toBeNull();
    expect(byTicker.NVDA!.metrics.trailingGaapPe.value).toBeNull();
    expect(byTicker.NVDA!.metrics.trailingGaapPe.status).toBe(
      'blocked_period_mismatch_requires_ttm',
    );

    // MSFT: FY2027 Q1 operating margin = 45,915 / 92,279 = 49.76%, FCF margin = 18,633 / 92,279 = 20.19%
    expect(byTicker.MSFT!.metrics.gaapOperatingMarginPct.value).toBe(49.76);
    expect(byTicker.MSFT!.metrics.fcfMarginPct.value).toBe(20.19);
    expect(byTicker.MSFT!.metrics.netCapexToOcfPct.value).toBe(67.87);
    expect(byTicker.MSFT!.metrics.marketCapUsdMillions.value).toBeNull();

    // GOOGL: 2026-Q3 YoY revenue growth = (127.577 - 102.346)/102.346 = +24.65%, operating margin = 31.81%, FCF margin = -7.11%
    expect(byTicker.GOOGL!.metrics.revenueYoYGrowthPct.value).toBe(24.65);
    expect(byTicker.GOOGL!.metrics.gaapOperatingMarginPct.value).toBe(31.81);
    expect(byTicker.GOOGL!.metrics.fcfMarginPct.value).toBe(-7.11);
    expect(byTicker.GOOGL!.metrics.netCapexToOcfPct.value).toBe(121.44);
    expect(byTicker.GOOGL!.shareCountReconciliation.multiClassReconciled).toBe(false);

    // AMZN: TTM-2026-Q3 revenue = $797,455M, TTM op margin = 13.09% ($104,405M / $797,455M), TTM net capex/OCF = 125.17%, TTM FCF margin = -5.31%
    expect(byTicker.AMZN!.metrics.gaapOperatingMarginPct.value).toBe(13.09);
    expect(byTicker.AMZN!.metrics.netCapexToOcfPct.value).toBe(125.17);
    expect(byTicker.AMZN!.metrics.fcfMarginPct.value).toBe(-5.31);
    // AMZN has TTM scope, so its valuation multiples are blocked specifically by missing_essential_input (shares & debt/cash), NOT period mismatch
    expect(byTicker.AMZN!.metrics.evToTtmRevenue.status).toBe('missing_essential_input');

    // AMD, CRWV, INTC preserve null across all flow & valuation metrics
    for (const sym of ['AMD', 'CRWV', 'INTC'] as const) {
      expect(byTicker[sym]!.metrics.gaapOperatingMarginPct.value).toBeNull();
      expect(byTicker[sym]!.metrics.marketCapUsdMillions.value).toBeNull();
      expect(byTicker[sym]!.allValuationMultiplesResolved).toBe(false);
    }
  });

  it('Stage 3b: verifies exact deterministic arithmetic, unit normalisation, share-count reconciliation, and loss-making / negative-FCF guards', () => {
    expect(normaliseToUsdMillions(127.577, 'billions', 'USD')).toBe(127577);
    expect(normaliseToUsdMillions(42422, 'millions', 'USD')).toBe(42422);
    expect(normaliseToUsdMillions(24_500_000_000, 'ones', 'USD')).toBe(24500);
    expect(() => normaliseToUsdMillions(100, 'millions', 'GBP')).toThrow();

    // 1. Complete profitable & positive-FCF TTM bundle
    const completeBundle: ValuationInputBundle = {
      ticker: 'NVDA',
      companyName: 'NVIDIA Corporation',
      currency: 'USD',
      asOfMs: Date.parse('2026-11-05T00:00:00Z'),
      price: {
        closeUsd: 200.0,
        sessionDate: '2026-11-04',
        eventAtMs: Date.parse('2026-11-04T21:00:00Z'),
        priceBasis: 'split-adjusted',
        corporateActionsReviewed: true,
        commerciallyLicensedForRedistribution: true,
        sourceId: 'tiingo-nvda-20261104',
        sourceLabel: 'Tiingo Split-Adjusted EOD',
      },
      shareCount: {
        dilutedSharesMillions: 24_500, // Market Cap = 200 * 24,500 = $4,900,000M ($4.9T)
        basicSharesMillions: 24_300,
        shareClassesIncluded: ['Common Stock'],
        multiClassReconciled: true,
        derivedFromRoundedEps: false,
        periodEnd: '2026-07-26',
        publishedAtMs: Date.parse('2026-08-26T20:30:00Z'),
        receivedAtMs: Date.parse('2026-08-26T20:35:00Z'),
        sourceId: 'sec-xbrl-nvda-10q-fy27q2',
        xbrlConcept: 'us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding',
      },
      balanceSheet: {
        cashAndEquivalentsMillions: 15_000,
        shortTermInvestmentsMillions: 25_000, // Total Cash = $40,000M
        totalDebtMillions: 8_500,
        financeLeaseLiabilitiesMillions: 1_500, // Total Debt = $10,000M -> Net Debt = -$30,000M (Net Cash)
        bookEquityMillions: 245_000,
        periodEnd: '2026-07-26',
        publishedAtMs: Date.parse('2026-08-26T20:30:00Z'),
        receivedAtMs: Date.parse('2026-08-26T20:35:00Z'),
        isRestated: false,
        supersedesEvidenceId: null,
        sourceIds: ['sec-xbrl-nvda-10q-fy27q2'],
      },
      primaryFlow: {
        periodScope: 'TTM',
        periodLabel: 'TTM-FY2027-Q2',
        periodStart: '2025-07-28',
        periodEnd: '2026-07-26',
        revenueMillions: 350_000,
        priorYearRevenueMillions: 200_000, // +75.00% YoY
        operatingIncomeMillions: 220_000,
        netIncomeMillions: 196_000, // P/E = 4,900,000 / 196,000 = 25.00x
        operatingCashFlowMillions: 180_000,
        grossCapexMillions: 10_000,
        capexProceedsMillions: 0,
        netCapexMillions: 10_000,
        freeCashFlowMillions: 170_000,
        publishedAtMs: Date.parse('2026-08-26T20:30:00Z'),
        receivedAtMs: Date.parse('2026-08-26T20:35:00Z'),
        isRestated: false,
        restatementNote: null,
        supersedesEvidenceId: null,
        sourceIds: ['sec-xbrl-nvda-10q-fy27q2'],
      },
    };

    const res = computeDeterministicValuationMetrics(completeBundle);
    expect(res.allValuationMultiplesResolved).toBe(true);
    expect(res.metrics.marketCapUsdMillions.value).toBe(4_900_000);
    expect(res.metrics.netDebtUsdMillions.value).toBe(-30_000);
    // EV = 4,900,000 + (-30,000) = 4,870,000
    expect(res.metrics.enterpriseValueUsdMillions.value).toBe(4_870_000);
    // P/B = 4,900,000 / 245,000 = 20.00x
    expect(res.metrics.priceToBook.value).toBe(20);
    // Trailing P/E = 4,900,000 / 196,000 = 25.00x
    expect(res.metrics.trailingGaapPe.value).toBe(25);
    // EV / TTM Revenue = 4,870,000 / 350,000 = 13.91x
    expect(res.metrics.evToTtmRevenue.value).toBe(13.91);
    // EV / TTM EBIT = 4,870,000 / 220,000 = 22.14x
    expect(res.metrics.evToTtmEbit.value).toBe(22.14);
    // EV / TTM FCF = 4,870,000 / 170,000 = 28.65x
    expect(res.metrics.evToTtmFcf.value).toBe(28.65);
    // FCF Yield on Market Cap = (170,000 / 4,900,000) * 100 = 3.47%
    expect(res.metrics.fcfYieldOnMarketCapPct.value).toBe(3.47);
    // Net Debt / TTM OCF = -30,000 / 180,000 = -0.17x
    expect(res.metrics.netDebtToTtmOcf.value).toBe(-0.17);

    // 2. Reject share count derived from rounded EPS
    const epsDerivedBundle: ValuationInputBundle = {
      ...completeBundle,
      shareCount: {
        ...completeBundle.shareCount,
        derivedFromRoundedEps: true,
      },
    };
    const epsRes = computeDeterministicValuationMetrics(epsDerivedBundle);
    expect(epsRes.metrics.marketCapUsdMillions.value).toBeNull();
    expect(epsRes.metrics.marketCapUsdMillions.status).toBe(
      'blocked_derived_share_count_unsuitable',
    );
    expect(epsRes.allValuationMultiplesResolved).toBe(false);

    // 3. Loss-making & negative-FCF company safeguards (suppresses P/E, EV/EBIT, EV/FCF as null)
    const lossMakingBundle: ValuationInputBundle = {
      ...completeBundle,
      ticker: 'INTC',
      companyName: 'Intel Corporation',
      primaryFlow: {
        ...completeBundle.primaryFlow,
        revenueMillions: 54_000,
        operatingIncomeMillions: -2_400, // Operating loss
        netIncomeMillions: -6_800, // Net loss
        operatingCashFlowMillions: 8_000,
        netCapexMillions: 21_000,
        freeCashFlowMillions: -13_000, // Negative FCF
      },
    };
    const lossRes = computeDeterministicValuationMetrics(lossMakingBundle);
    expect(lossRes.metrics.trailingGaapPe.value).toBeNull();
    expect(lossRes.metrics.trailingGaapPe.status).toBe('not_meaningful_negative_earnings');
    expect(lossRes.metrics.evToTtmEbit.value).toBeNull();
    expect(lossRes.metrics.evToTtmEbit.status).toBe('not_meaningful_negative_ebit');
    expect(lossRes.metrics.evToTtmFcf.value).toBeNull();
    expect(lossRes.metrics.evToTtmFcf.status).toBe('not_meaningful_negative_fcf');
    // Meanwhile EV/Revenue and Price/Book remain valid positive ratios, and FCF Yield shows negative cash burn!
    expect(lossRes.metrics.evToTtmRevenue.value).toBeGreaterThan(0);
    expect(lossRes.metrics.priceToBook.value).toBe(20);
    expect(lossRes.metrics.fcfYieldOnMarketCapPct.value).toBeLessThan(0);
    expect(lossRes.metrics.fcfYieldOnMarketCapPct.formattedDisplay).toContain('Cash Burn');
  });

  it('Stage 4: defines 5 distinct directional-rating release gate tiers and confirms 252 price bars do not prove predictive validity', () => {
    const tiers = evaluateFiveTierReleaseGates();
    expect(tiers).toHaveLength(5);

    expect(tiers[0]!.tierKey).toBe('tier_1_fundamental_research_screening');
    expect(tiers[0]!.permitsDirectionalBuyHoldSell).toBe(false);
    expect(tiers[0]!.qualifyingTickers).toEqual(['NVDA', 'MSFT', 'GOOGL', 'AMZN']);
    expect(tiers[0]!.blockedTickers).toEqual(['AMD', 'CRWV', 'INTC']);

    expect(tiers[1]!.tierKey).toBe('tier_2_valuation_supported_investment_assessment');
    expect(tiers[1]!.permitsDirectionalBuyHoldSell).toBe(false);
    expect(tiers[1]!.status).toBe('blocked');

    expect(tiers[2]!.tierKey).toBe('tier_3_risk_and_momentum_analysis');
    expect(tiers[2]!.permitsDirectionalBuyHoldSell).toBe(false);
    expect(tiers[2]!.why252PriceBarsDoNotSufficeNote).toContain('NOT proof');

    expect(tiers[3]!.tierKey).toBe('tier_4_historically_validated_methodology');
    expect(tiers[3]!.permitsDirectionalBuyHoldSell).toBe(false);
    expect(tiers[3]!.why252PriceBarsDoNotSufficeNote).toContain('effective sample size N = 1');

    expect(tiers[4]!.tierKey).toBe('tier_5_prospectively_evaluated_signals');
    expect(tiers[4]!.permitsDirectionalBuyHoldSell).toBe(true);
    expect(tiers[4]!.status).toBe('blocked');
  });

  it('Stage 5: creates immutable SHA-256 assessment snapshots, detects retrospective tampering, blocks look-ahead bars, and measures outcomes vs QQQ, SOXX, and passive equal-weight', () => {
    const t0 = Date.parse('2026-11-04T21:30:00Z');
    const snap = createImmutableAssessmentSnapshot({
      recordedAtMs: t0,
      horizonKey: '20D_TACTICAL',
    });

    expect(snap.snapshotSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(snap.topPriorityCohortTickers).toEqual(['NVDA', 'MSFT']);
    expect(snap.entries.every((e) => e.assessmentLabel === 'INSUFFICIENT DATA')).toBe(true);

    // 1. Verify tamper detection
    const checkClean = verifyAssessmentSnapshotIntegrity(snap);
    expect(checkClean.isTamperFree).toBe(true);

    const tampered = {
      ...snap,
      entries: snap.entries.map((e, i) =>
        i === 0 ? { ...e, assessmentLabel: 'BUY' as const } : e,
      ),
    };
    const checkTampered = verifyAssessmentSnapshotIntegrity(tampered);
    expect(checkTampered.isTamperFree).toBe(false);

    const tamperedReport = evaluateForwardAssessmentOutcomes({
      snapshot: tampered,
      postSnapshotBars: [],
      evaluationAsOfMs: snap.targetEndAtMs + 86_400_000,
    });
    expect(tamperedReport.evaluationStatus).toBe('blocked_tampered_snapshot');

    // 2. Verify unelapsed horizon is blocked
    const unelapsedReport = evaluateForwardAssessmentOutcomes({
      snapshot: snap,
      postSnapshotBars: [],
      evaluationAsOfMs: t0 + 5 * 86_400_000,
    });
    expect(unelapsedReport.evaluationStatus).toBe('horizon_not_elapsed');

    // 3. Verify look-ahead bar (dated on or before snapshot.recordedAtMs) is rejected
    const lookAheadBar: ForwardMarketBar = {
      symbol: 'NVDA',
      sessionDate: '2026-11-04',
      eventAtMs: t0 - 1000,
      serverReceivedAtMs: t0 + 1000,
      closeUsd: 190,
      usdToGbp: 0.78,
      closeGbp: 148.2,
      priceBasis: 'split-adjusted',
      corporateActionsReviewed: true,
      sourceId: 'test-bar',
    };
    const lookAheadReport = evaluateForwardAssessmentOutcomes({
      snapshot: snap,
      postSnapshotBars: [lookAheadBar],
      evaluationAsOfMs: snap.targetEndAtMs + 86_400_000,
    });
    expect(lookAheadReport.evaluationStatus).toBe('blocked_look_ahead_violation');

    // 4. Verify complete post-horizon outcome calculation vs QQQ, SOXX, and Passive Equal-Weight
    const symbols = [
      ...snap.entries.map((e) => {
        const startUsd = e.anchorCloseUsd ?? 100;
        const fx =
          e.anchorCloseGbp && e.anchorCloseUsd
            ? e.anchorCloseGbp / e.anchorCloseUsd
            : 0.7745;
        return {
          symbol: e.ticker,
          startUsd,
          fx,
          endMultiplier: e.ticker === 'NVDA' || e.ticker === 'MSFT' ? 1.08 : 1.02,
        };
      }),
      { symbol: 'QQQ', startUsd: 691.95, fx: 0.7745, endMultiplier: 1.04 },
      { symbol: 'SOXX', startUsd: 240.0, fx: 0.7745, endMultiplier: 1.05 },
    ];

    const postBars: ForwardMarketBar[] = [];
    for (let s = 1; s <= 5; s++) {
      const barAt = t0 + s * 86_400_000 * 3;
      const frac = s / 5;
      for (const item of symbols) {
        const closeUsd = Number(
          (item.startUsd * (1 + (item.endMultiplier - 1) * frac)).toFixed(2),
        );
        postBars.push({
          symbol: item.symbol,
          sessionDate: new Date(barAt).toISOString().slice(0, 10),
          eventAtMs: barAt,
          serverReceivedAtMs: barAt + 60_000,
          closeUsd,
          usdToGbp: item.fx,
          closeGbp: Number((closeUsd * item.fx).toFixed(2)),
          priceBasis: 'split-adjusted',
          corporateActionsReviewed: true,
          sourceId: `verified-bar-${item.symbol}-${s}`,
        });
      }
    }

    const completeReport = evaluateForwardAssessmentOutcomes({
      snapshot: snap,
      postSnapshotBars: postBars,
      evaluationAsOfMs: snap.targetEndAtMs + 86_400_000,
    });

    expect(completeReport.evaluationStatus).toBe('evaluated_complete');
    expect(completeReport.cohortPerformance.grossReturnUsdPct).toBeCloseTo(8.0, 1);
    expect(completeReport.cohortPerformance.netReturnGbpPct).toBeCloseTo(7.4, 1); // 8.0% - 0.60% round-trip friction
    expect(completeReport.benchmarks.qqqBroadMarket.returnUsdPct).toBeGreaterThan(0);
    expect(completeReport.benchmarks.sectorBenchmark.benchmarkSymbol).toBe('SOXX');
    expect(completeReport.benchmarks.sectorBenchmark.returnUsdPct).toBeGreaterThan(0);
    expect(
      completeReport.benchmarks.passiveEqualWeightUniverse
        .cohortNetExcessVsPassiveEqualWeightGbpPct,
    ).toBeGreaterThan(0);

    // 5. Verify transition ledger between two snapshots
    const snap2 = createImmutableAssessmentSnapshot({
      recordedAtMs: t0 + 86_400_000,
      horizonKey: '20D_TACTICAL',
    });
    const ledger = computeAssessmentTransitionLedger(snap, snap2);
    expect(ledger.transitions).toHaveLength(7);
    expect(ledger.anyDirectionalLabelChanged).toBe(false);
  });

  it('Stage 6: confirms production integrity, metric provenance completeness, unauthenticated chat fallback labelling, and broker privacy', () => {
    const report = auditProductionIntegrityAndMetricProvenance();
    expect(report.allDirectionalRatingsLockedInsufficientData).toBe(true);
    expect(report.brokerValuesRequireLastSyncLabel).toBe(true);
    expect(report.unauthenticatedChatFallbackClearlyLabelledNonGemini).toBe(true);
    expect(report.publicResearchInferenceExcludesPrivateBrokerData).toBe(true);
    expect(report.allScreeningNumbersHavePeriodSourceAndFormula).toBe(true);
    expect(report.incompleteProvenanceMetricsCount).toBe(0);
    expect(report.totalAuditedScreeningMetrics).toBe(42);
    expect(report.executionAuthority).toBe('none');
  });
});
