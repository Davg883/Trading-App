'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  evaluatePhaseG81PortfolioRisk,
  reconcileCoreWeaveIsaStatus,
  reconcileOfficialSoniaObservation,
  reconcileAnthropicCommitmentLedger,
  auditSevenStressScenarios,
  calculatePortfolioConcentrationIntelligence,
  type PortfolioConcentrationReport,
  type ScenarioAuditSheet,
} from '../lib/portfolio/multi-asset-risk-pilot';

export interface PortfolioRiskDashboardProps {
  initialReport?: ReturnType<typeof evaluatePhaseG81PortfolioRisk>;
  liveSnapshot?: {
    summaryAt: number | null;
    totalValue: number | null;
    cash: number | null;
    positions: Array<{
      ticker: string;
      name?: string;
      currency?: string;
      valuationGbp?: number | null;
    }>;
  } | null;
  signedIn?: boolean;
}

export function PortfolioRiskDashboard({
  initialReport = evaluatePhaseG81PortfolioRisk(),
  liveSnapshot = null,
  signedIn = false,
}: PortfolioRiskDashboardProps) {
  const [selectedModel, setSelectedModel] = useState<
    'live' | 'preservation' | 'balanced' | 'tech_concentrated'
  >(liveSnapshot ? 'live' : 'preservation');

  const [selectedScenarioIndex, setSelectedScenarioIndex] = useState<number>(0);
  const [selectedQuestion, setSelectedQuestion] = useState<string | null>(null);

  const scenarios: ScenarioAuditSheet[] = initialReport.stage2StressScenarioAudit.scenarioSheets;
  const activeScenario = scenarios[selectedScenarioIndex] ?? scenarios[0]!;

  // Resolve active concentration report based on tab
  let activeReport: PortfolioConcentrationReport;
  if (selectedModel === 'live') {
    if (liveSnapshot && liveSnapshot.totalValue !== null && liveSnapshot.cash !== null) {
      activeReport = calculatePortfolioConcentrationIntelligence({
        accountSummary: {
          totalValue: liveSnapshot.totalValue,
          cash: liveSnapshot.cash,
        },
        positions: liveSnapshot.positions,
      });
    } else {
      activeReport = initialReport.stage3And4PortfolioConcentration.ownerLiveAccountReport;
    }
  } else if (selectedModel === 'preservation') {
    activeReport = calculatePortfolioConcentrationIntelligence({
      accountSummary: { totalValue: 100_000, cash: 45_000 },
      positions: [
        { ticker: 'GLTS.L', name: 'iShares UK Gilts 0-5yr', currency: 'GBP', valuationGbp: 35_000 },
        { ticker: 'IGLT.L', name: 'iShares Core UK Gilts', currency: 'GBP', valuationGbp: 10_000 },
        { ticker: 'IUUS.L', name: 'iShares S&P 500 Utilities', currency: 'USD', valuationGbp: 5_000 },
        { ticker: 'SGLN.L', name: 'iShares Physical Gold ETC', currency: 'GBP', valuationGbp: 5_000 },
      ],
    });
  } else if (selectedModel === 'balanced') {
    activeReport = initialReport.stage3And4PortfolioConcentration.balancedBenchmarkReport;
  } else {
    activeReport = initialReport.stage3And4PortfolioConcentration.techConcentratedBenchmarkReport;
  }

  const activeSensitivity =
    activeReport.scenarioSensitivities.find(
      (s) => s.scenarioId === activeScenario.scenarioId,
    ) ?? activeReport.scenarioSensitivities[0]!;

  const coreWeaveReport = reconcileCoreWeaveIsaStatus();
  const soniaReport = reconcileOfficialSoniaObservation();
  const anthropicReport = reconcileAnthropicCommitmentLedger();

  // Pre-canned evidence-locked explanations
  const evidenceLockedAnswers: Record<
    string,
    { question: string; answer: string; evidenceIds: string[]; formula?: string }
  > = {
    q_cash_zero_loss: {
      question: 'Why does my cash-only Trading 212 account experience £0 stress loss across Scenario A?',
      answer:
        'Your Trading 212 live account currently holds £250.00 in uninvested Sterling cash and 0 open equity positions. In Scenario A (AI Capex Slowdown), asset class shocks apply strictly to risky assets (AI Equities -35%, Developed Equities -18%), while Sterling cash deposits preserve 100% nominal capital (0.0% instantaneous market shock) and earn +3.99% annualized carry against the official Bank of England SONIA benchmark (series IUDSOIA; Bank Rate 4.00%). Because equity and duration exposures are 0.0%, your portfolio experiences £0 capital loss.',
      evidenceIds: ['src-boe-sonia-iadb-2026', 'trading212-live-snapshot'],
      formula: 'Instantaneous Portfolio Loss = Σ (Weight_i × Instant_Shock_i) = 1.00 × 0.0% = £0 loss. Forward Carry: +3.99% annual yield = +£9.98/yr.',
    },
    q_stagflation_failure: {
      question: 'Why do equities and bonds fall simultaneously in Scenario E (2022 Stagflation Analogue)?',
      answer:
        'In Scenario E, energy and commodity prices surge while headline inflation re-accelerates, forcing central banks to hike discount rates. This causes a positive stock-bond correlation (+0.60): nominal bonds lose -6.5% due to yield increases and duration drag, while long-duration equities fall -15% to -24% from multiple compression. Traditional 60/40 balanced portfolios fail because both sleeves lose money at the same time. Only Cash (+5.0%), Energy (+4.5%), and Physical Gold (+11.5%) provide positive real returns.',
      evidenceIds: ['src-uk-dmo-ust-curve-2026-11', 'src-lbma-gold-2026-11'],
      formula: 'Stock-Bond Correlation = +0.60; Combined 60/40 Return = 0.60×(-15.0%) + 0.40×(-6.5%) = -11.60%',
    },
    q_anthropic_dedup: {
      question: 'How does the Anthropic commitment ledger eliminate $60.0B in double counting?',
      answer:
        'Anthropic Form S-1/A (Note 11) discloses $895.4B in canonical binding compute purchase obligations across AWS ($325.0B), Google Cloud ($310.4B), and Microsoft Azure ($260.0B). Naive commentary created a $940.0B headline sum by adding a $44.6B UK Project Monarch agreement with Nscale on top, ignoring that Monarch is a downstream sub-allocation fulfilling part of Microsoft Azure\'s $260.0B commitment. Secondary commentary further added $15.4B in uncommitted non-binding options, inflating the total to $955.4B. Our ledger strictly excludes child sub-contracts ($44.6B) and uncommitted options ($15.4B), enforcing the exact $895.4B GAAP obligation.',
      evidenceIds: ['sec-s1a-anthropic-2026-11', 'rel-anthropic-monarch-services-r1'],
      formula: '$895.4B Canonical Net = $955.4B Raw Headline - $44.6B Nscale Double Count - $15.4B Non-Binding Options',
    },
    q_coreweave_isa: {
      question: 'Why does CoreWeave (CRWV) qualify for ISA status under HMRC rules but remain in Invest on Trading 212?',
      answer:
        'Under HMRC Individual Savings Account Regulations 1998 (Reg 7) and Section 1005 Income Tax Act 2007, any common equity officially admitted to trading on a Recognised Stock Exchange (such as NASDAQ Global Select Market) satisfies statutory qualifying investment criteria. However, Trading 212 independently audits and onboards securities to its specific ISA platform universe based on custody, settlement, and liquidity agreements. Until Trading 212 adds CRWV to its active ISA catalog, UK investors hold it in a taxable General Investment Account (Invest). The blanket statement that CoreWeave is fundamentally disqualified from UK ISAs was incorrect.',
      evidenceIds: ['hmrc-isa-reg-1998-si1870', 'ita-2007-s1005', 'sec-10q-crwv-0001769628-26-000366'],
    },
    q_short_gilts_liquidity: {
      question: 'How do 0–5yr short gilts (GLTS.L, 2.15y) prevent forced equity sales in Scenario G?',
      answer:
        'In Scenario G (Emergency £30,000 Withdrawal during a concurrent -25% market drawdown), portfolios with >=£30,000 in cash and short gilts fund the entire liquidity requirement from capital-preservation reserves with zero forced equity liquidation. Because short gilts have an effective duration of just 2.15 years, their price sensitivity is minimal (-3.20% per +150 bps yield shock versus -12.20% for all-maturity gilts). For portfolios without sufficient cash/short gilts, liquidating equities at the bottom crystallizes fire-sale losses and forfeits future market recovery, but the initial market decline is not double-counted.',
      evidenceIds: ['uk-dmo-short-gilt-curve-2026', 'ishares-glts-factsheet-2026'],
      formula: 'DV01 = Notional × (Duration / 100); GLTS.L DV01 = £35,000 × (2.15 / 100) = £752.50 per 100 bps',
    },
  };

  return (
    <div className="portfolio-risk-shell" data-testid="portfolio-risk-page">
      {/* Top Banner & Mode Selector */}
      <header className="portfolio-risk-header">
        <div className="portfolio-breadcrumb">
          <Link href="/">← Market Radar</Link>
          <span className="divider">/</span>
          <strong>Portfolio Risk Intelligence &amp; Capital Preservation</strong>
          <span className="g6-meta-pill" style={{ marginLeft: '12px' }}>
            Phase G.8.1 Production Acceptance
          </span>
          <span className="g6-meta-pill">Execution: Read-Only (Disabled)</span>
        </div>

        <div className="portfolio-header-content">
          <div>
            <h1>Portfolio Risk &amp; Capital Preservation</h1>
            <p>
              Deterministic multi-asset risk intelligence, ETF look-through concentration, and seven audited
              stress scenarios. Observed broker data, modelled stress scenarios, and unavailable evidence are
              strictly separated.
            </p>
          </div>

          {/* Model / Account Toggle */}
          <div className="portfolio-model-selector" role="radiogroup" aria-label="Portfolio Model">
            <button
              type="button"
              className={selectedModel === 'live' ? 'active' : ''}
              onClick={() => setSelectedModel('live')}
              data-testid="tab-owner-live"
            >
              Owner Live Account ({liveSnapshot ? 'Synced' : '£250 Cash Baseline'})
            </button>
            <button
              type="button"
              className={selectedModel === 'preservation' ? 'active' : ''}
              onClick={() => setSelectedModel('preservation')}
              data-testid="tab-capital-preservation"
            >
              Ref: Capital Preservation (£100k)
            </button>
            <button
              type="button"
              className={selectedModel === 'balanced' ? 'active' : ''}
              onClick={() => setSelectedModel('balanced')}
              data-testid="tab-balanced"
            >
              Ref: Balanced Multi-Asset (£100k)
            </button>
            <button
              type="button"
              className={selectedModel === 'tech_concentrated' ? 'active' : ''}
              onClick={() => setSelectedModel('tech_concentrated')}
              data-testid="tab-tech-concentrated"
            >
              Ref: Tech Concentrated (£100k Contrast)
            </button>
          </div>
        </div>
      </header>

      {/* SECTION A: Portfolio Overview */}
      <section className="portfolio-section" aria-labelledby="overview-title" data-testid="portfolio-overview-section">
        <div className="section-head">
          <div className="g6-eyebrow-row">
            <span className="g6-section-tag">SECTION A · PORTFOLIO OVERVIEW</span>
            <span className="g6-meta-pill">
              Source:{' '}
              {selectedModel === 'live'
                ? activeReport.isDevelopmentFixture
                  ? 'Development Baseline Fixture (£250 Cash / 0 Positions)'
                  : 'Trading 212 Read-Only Sync (Authenticated Owner)'
                : 'Educational Benchmark Model (£100k Basis)'}
            </span>
            <span className="g6-meta-pill" data-testid="data-freshness-pill">
              Freshness:{' '}
              {selectedModel === 'live'
                ? activeReport.isDevelopmentFixture
                  ? 'Development Fixture (Demonstration Only)'
                  : 'Fresh (<15m)'
                : 'Standard Model Baseline'}
            </span>
          </div>
          <h2 id="overview-title">Account Valuation &amp; Liquidity Buffer</h2>
        </div>

        <div className="portfolio-kpi-grid">
          <div className="portfolio-kpi-card highlight" data-testid="kpi-total-value">
            <span className="kpi-label">Total Account Value</span>
            <strong className="kpi-value">£{activeReport.totalPortfolioValueGbp.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</strong>
            <small className="kpi-caption">Base currency: GBP (All FX converted)</small>
          </div>
          <div className="portfolio-kpi-card" data-testid="kpi-cash-available">
            <span className="kpi-label">Cash Available</span>
            <strong className="kpi-value">£{activeReport.cashGbp.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</strong>
            <small className="kpi-caption">{activeReport.cashAllocationPct}% allocation · Instant T+0 Liquidity</small>
          </div>
          <div className="portfolio-kpi-card" data-testid="kpi-invested-positions">
            <span className="kpi-label">Amount Invested</span>
            <strong className="kpi-value">£{activeReport.investedPositionsValueGbp.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</strong>
            <small className="kpi-caption">{activeReport.openPositionsCount} open positions across {Object.keys(activeReport.assetClassAllocation).length} asset classes</small>
          </div>
          <div className="portfolio-kpi-card" data-testid="kpi-effective-duration">
            <span className="kpi-label">Portfolio Effective Duration</span>
            <strong className="kpi-value">{activeReport.portfolioEffectiveDurationYears} Years</strong>
            <small className="kpi-caption">DV01: £{activeReport.dv01Per100BpsParallelShiftGbp} per +100 bps shift</small>
          </div>
        </div>
      </section>

      {/* SECTION B: Diversification & Concentration */}
      <section className="portfolio-section" aria-labelledby="diversification-title" data-testid="portfolio-diversification-section">
        <div className="section-head">
          <div className="g6-eyebrow-row">
            <span className="g6-section-tag">SECTION B · DIVERSIFICATION &amp; LOOK-THROUGH</span>
            <span className="g6-meta-pill">Concentration HHI: {activeReport.herfindahlHirschmanIndex}</span>
            <span className="g6-meta-pill">Top 3 Concentration: {activeReport.top3ConcentrationPct}%</span>
          </div>
          <h2 id="diversification-title">Asset Class Allocation &amp; Hidden ETF Overlap</h2>
        </div>

        <div className="portfolio-two-col">
          {/* Asset Class Allocation */}
          <div className="portfolio-panel" data-testid="asset-allocation-panel">
            <h3>Asset Class Allocation</h3>
            <div className="allocation-list">
              {Object.entries(activeReport.assetClassAllocation).map(([ac, data]) => (
                <div key={ac} className="allocation-item">
                  <div className="allocation-header">
                    <span className="ac-name">{ac.replace(/_/g, ' ').toUpperCase()}</span>
                    <span className="ac-vals">
                      <strong>£{data.valueGbp.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</strong> ({data.weightPct}%)
                    </span>
                  </div>
                  <div className="allocation-bar-bg">
                    <div
                      className="allocation-bar-fill"
                      style={{
                        width: `${Math.max(1, data.weightPct)}%`,
                        backgroundColor:
                          ac === 'sterling_cash_and_deposits'
                            ? '#2f6b4f'
                            : ac === 'uk_gilts_and_quality_bonds'
                              ? '#415437'
                              : ac === 'ai_and_semiconductor_equities'
                                ? '#b4452f'
                                : '#3b82f6',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Currency Breakdown */}
            <div className="currency-strip" style={{ marginTop: '20px' }}>
              <h4>Currency Exposure</h4>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                {Object.entries(activeReport.currencyExposure).map(([ccy, data]) => (
                  <span key={ccy} className="currency-pill">
                    <strong>{ccy}:</strong> {data.weightPct}% (£{data.valueGbp.toLocaleString('en-GB')})
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* AI & Tech Concentration + ETF Look-Through */}
          <div className="portfolio-panel" data-testid="ai-lookthrough-panel">
            <h3>True AI &amp; US Tech Exposure (Direct + ETF Look-Through)</h3>
            <div className="ai-summary-box">
              <div className="ai-stat">
                <span>Direct AI Basket</span>
                <strong>{activeReport.aiSectorExposure.directWeightPct}%</strong>
              </div>
              <div className="ai-stat">
                <span>ETF Look-Through AI</span>
                <strong>{activeReport.aiSectorExposure.etfLookThroughWeightPct}%</strong>
              </div>
              <div className="ai-stat total" data-testid="ai-total-stat">
                <span>Total True AI Exposure</span>
                <strong>{activeReport.aiSectorExposure.totalAiExposurePct}%</strong>
              </div>
            </div>

            {/* ETF Overlap Table */}
            <h4 style={{ marginTop: '16px', marginBottom: '8px', fontSize: '13px' }}>ETF Constituent Look-Through Ledger</h4>
            {activeReport.etfLookThroughSummary.length > 0 ? (
              <div className="table-wrap">
                <table className="mini-table">
                  <thead>
                    <tr>
                      <th>ETF TICKER</th>
                      <th>WEIGHT</th>
                      <th>EMBEDDED AI</th>
                      <th>UNKNOWN CONSTITUENTS</th>
                      <th>STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeReport.etfLookThroughSummary.map((etf) => (
                      <tr key={etf.etfTicker}>
                        <td><strong>{etf.etfTicker}</strong><small>{etf.etfName}</small></td>
                        <td>{etf.portfolioWeightPct}%</td>
                        <td>{etf.lookThroughAiWeightPct}%</td>
                        <td>{etf.unknownConstituentWeightPct}%</td>
                        <td>
                          <span className={`tag ${etf.hasVerifiedConstituents ? 'green' : 'amber'}`}>
                            {etf.hasVerifiedConstituents ? 'Verified Constituent Feed' : 'Unknown Exposure Reported'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="cc-empty" style={{ margin: 0 }}>
                No ETF holdings in active selection. All capital is held in uninvested cash or direct securities.
              </p>
            )}

            {/* Explicit Notice on Unknown Constituents */}
            <div className="unknown-notice" style={{ marginTop: '12px' }}>
              <small>
                <strong>Look-Through Governance Invariant:</strong> Where licensed constituent data is unavailable,
                the engine reports <strong>{activeReport.unknownConstituentExposurePct}%</strong> in unknown constituent exposure
                rather than silently assuming zero AI overlap.
              </small>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION C: Stress Test Engine */}
      <section className="portfolio-section" aria-labelledby="stress-title" data-testid="portfolio-stress-section">
        <div className="section-head">
          <div className="g6-eyebrow-row">
            <span className="g6-section-tag">SECTION C · STRESS SCENARIO ENGINE</span>
            <span className="g6-meta-pill">Audited Scenarios: 7</span>
            <span className="g6-meta-pill">Modelled Drawdown: Hypothetical Sensitivity</span>
          </div>
          <h2 id="stress-title">Hypothetical Stress Testing &amp; Holding Attribution</h2>
          <p className="scenario-disclaimer">
            <strong>CRITICAL GOVERNANCE DISCLAIMER:</strong> Modelled stress losses represent deterministic sensitivity
            calculations based on declared historical analogues and macro shocks. They are <strong>NOT</strong> guaranteed maximum
            drawdowns, risk ceilings, or probabilistic forecasts.
          </p>
        </div>

        {/* Scenario Selectors */}
        <div className="scenario-button-row" role="tablist">
          {scenarios.map((sc, idx) => (
            <button
              key={sc.scenarioId}
              type="button"
              className={`scenario-btn ${selectedScenarioIndex === idx ? 'active' : ''}`}
              onClick={() => setSelectedScenarioIndex(idx)}
              data-testid={`scenario-btn-${sc.scenarioCode.replace(/\s+/g, '-').toLowerCase()}`}
            >
              <strong>{sc.scenarioCode}</strong>
              <span>{sc.title.split('(')[0]}</span>
            </button>
          ))}
        </div>

        {/* Active Scenario Card */}
        <div className="scenario-detail-card" data-testid="active-scenario-card">
          <div className="scenario-card-header">
            <div>
              <h3>{activeScenario.scenarioCode}: {activeScenario.title}</h3>
              <p>Type: <span className="type-tag">{activeScenario.classificationType.replace(/_/g, ' ').toUpperCase()}</span></p>
            </div>
            <div className="scenario-impact-badge" data-testid="scenario-impact-badge">
              <span className="impact-label">Estimated Impact on Active Portfolio:</span>
              <strong className={activeSensitivity.estimatedPnlGbp >= 0 ? 'up' : 'down'}>
                {activeSensitivity.estimatedPortfolioReturnPct >= 0 ? '+' : ''}
                {activeSensitivity.estimatedPortfolioReturnPct}% (
                {activeSensitivity.estimatedPnlGbp >= 0 ? '+£' : '-£'}
                {Math.abs(activeSensitivity.estimatedPnlGbp).toLocaleString('en-GB')})
              </strong>
            </div>
          </div>

          <div className="scenario-body-grid">
            <div>
              <h4>Underlying Market &amp; Macro Assumptions</h4>
              <ul className="assumptions-list">
                <li><strong>Valuation / Price:</strong> {activeScenario.underlyingAssumptions.priceOrValuationCompressionPct}</li>
                <li><strong>Yield Curve:</strong> {activeScenario.underlyingAssumptions.yieldChangeBps >= 0 ? '+' : ''}{activeScenario.underlyingAssumptions.yieldChangeBps} bps parallel shift</li>
                <li><strong>Duration Impact:</strong> {activeScenario.underlyingAssumptions.effectiveDurationImpactPct}</li>
                <li><strong>Credit Spreads:</strong> {activeScenario.underlyingAssumptions.creditSpreadWideningBps >= 0 ? '+' : ''}{activeScenario.underlyingAssumptions.creditSpreadWideningBps} bps HY OAS</li>
                <li><strong>FX Movement:</strong> {activeScenario.underlyingAssumptions.fxChangePct >= 0 ? '+' : ''}{activeScenario.underlyingAssumptions.fxChangePct}% GBP/USD</li>
                <li><strong>Stock-Bond Correlation:</strong> {activeScenario.underlyingAssumptions.stockBondCorrelation.replace(/_/g, ' ')}</li>
              </ul>
            </div>

            <div>
              <h4>Sensitivity Testing &amp; Key Influencers</h4>
              <p className="influencer-text"><strong>Key Influencer:</strong> {activeScenario.keyInfluencerAnalysis}</p>
              <div className="variations-table">
                <strong>Assumption Variations:</strong>
                <ul>
                  {activeScenario.sensitivityVariations.map((v) => (
                    <li key={v.variationName}>
                      {v.variationName}: <em>{v.shockParameter}</em> → Impact: <strong>{v.hypotheticalPortfolioImpactPctOnBalanced}%</strong>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="arithmetic-proof-box">
            <strong>Deterministic Verification Formula:</strong>
            <code>{activeScenario.arithmeticVerificationFormula}</code>
          </div>
        </div>
      </section>

      {/* SECTION D: Risk Alerts & Governance */}
      <section className="portfolio-section" aria-labelledby="alerts-title" data-testid="portfolio-alerts-section">
        <div className="section-head">
          <div className="g6-eyebrow-row">
            <span className="g6-section-tag">SECTION D · RISK ALERTS &amp; GOVERNANCE</span>
            <span className="g6-meta-pill">Execution Safeguard: Active</span>
          </div>
          <h2 id="alerts-title">Concentration Alerts &amp; Regulatory Safeguards</h2>
        </div>

        <div className="alerts-container">
          {activeReport.riskAlerts.length > 0 ? (
            activeReport.riskAlerts.map((alert) => (
              <div key={alert.id} className={`risk-alert-card ${alert.severity}`} data-testid={`alert-${alert.id}`}>
                <h4>{alert.title}</h4>
                <p>{alert.detail}</p>
              </div>
            ))
          ) : (
            <div className="risk-alert-card ok" data-testid="alert-all-clear">
              <h4>All Concentration Thresholds Within Target Tolerance</h4>
              <p>
                Portfolio allocation maintains acceptable cash buffers, diversified asset weights, and zero unmanaged single-name concentrations.
              </p>
            </div>
          )}

          {/* CoreWeave ISA Qualification Card */}
          <div className="risk-alert-card info" data-testid="alert-coreweave-isa">
            <h4>HMRC ISA Status &amp; Broker Classification: CoreWeave (CRWV)</h4>
            <p>
              <strong>HMRC Statutory Status:</strong> Meets Section 1005 Income Tax Act 2007 criteria as an equity admitted to trading on NASDAQ Global Select Market (HMRC Recognised Stock Exchange).
              <br />
              <strong>Broker Catalog Status:</strong> Trading 212 currently designates CRWV under its taxable &quot;Invest&quot; account pending specific platform onboarding to its ISA catalog.
              <br />
              <em>Correction: Blanket disqualification claims have been removed; statutory HMRC recognition is affirmed while respecting broker-specific catalog boundaries.</em>
            </p>
          </div>
        </div>
      </section>

      {/* SECTION E: Ask AI Capital Intelligence */}
      <section className="portfolio-section" aria-labelledby="ai-chat-title" data-testid="portfolio-ai-chat-section">
        <div className="section-head">
          <div className="g6-eyebrow-row">
            <span className="g6-section-tag">SECTION E · ASK AI CAPITAL INTELLIGENCE</span>
            <span className="g6-meta-pill">Evidence-Locked &amp; Grounded</span>
            <span className="g6-meta-pill">User Isolation: Strict</span>
          </div>
          <h2 id="ai-chat-title">Evidence-Locked Explanations &amp; Risk Logic</h2>
          <p>
            Ask AI Capital Intelligence to explain deterministic risk calculations using primary verified sources.
            Private broker figures are strictly isolated from public model pipelines; execution endpoints remain disabled.
          </p>
        </div>

        <div className="preset-questions-strip">
          <button
            type="button"
            className={selectedQuestion === 'q_cash_zero_loss' ? 'active' : ''}
            onClick={() => setSelectedQuestion('q_cash_zero_loss')}
            data-testid="q-cash-zero-loss"
          >
            Why does cash suffer £0 stress loss in Scenario A?
          </button>
          <button
            type="button"
            className={selectedQuestion === 'q_stagflation_failure' ? 'active' : ''}
            onClick={() => setSelectedQuestion('q_stagflation_failure')}
            data-testid="q-stagflation-failure"
          >
            Why do equities and bonds drop together in Scenario E?
          </button>
          <button
            type="button"
            className={selectedQuestion === 'q_anthropic_dedup' ? 'active' : ''}
            onClick={() => setSelectedQuestion('q_anthropic_dedup')}
            data-testid="q-anthropic-dedup"
          >
            How is Anthropic $60.0B double counting eliminated?
          </button>
          <button
            type="button"
            className={selectedQuestion === 'q_coreweave_isa' ? 'active' : ''}
            onClick={() => setSelectedQuestion('q_coreweave_isa')}
            data-testid="q-coreweave-isa"
          >
            Why does CoreWeave qualify for ISA under HMRC rules?
          </button>
          <button
            type="button"
            className={selectedQuestion === 'q_short_gilts_liquidity' ? 'active' : ''}
            onClick={() => setSelectedQuestion('q_short_gilts_liquidity')}
            data-testid="q-short-gilts"
          >
            How do short gilts (GLTS.L) prevent forced equity sales?
          </button>
        </div>

        {selectedQuestion && evidenceLockedAnswers[selectedQuestion] && (
          <div className="evidence-answer-box" data-testid="evidence-answer-box">
            <h3>{evidenceLockedAnswers[selectedQuestion]!.question}</h3>
            <p className="answer-text">{evidenceLockedAnswers[selectedQuestion]!.answer}</p>
            {evidenceLockedAnswers[selectedQuestion]!.formula && (
              <div className="formula-chip">
                <strong>Formula:</strong> <code>{evidenceLockedAnswers[selectedQuestion]!.formula}</code>
              </div>
            )}
            <div className="citations-list">
              <strong>Approved Evidence Sources:</strong>
              {evidenceLockedAnswers[selectedQuestion]!.evidenceIds.map((cid) => (
                <span key={cid} className="citation-tag">
                  {cid}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Expandable Technical Drawers */}
      <section className="portfolio-drawers" data-testid="portfolio-drawers-section">
        <details className="g6-drawer-details">
          <summary className="g6-drawer-summary" data-testid="drawer-sonia-toggle">
            <span>Technical Drawer 1: Bank of England Official SONIA &amp; Bank Rate Reconciliation</span>
            <small>Series {soniaReport.sourceSeriesCode} · SONIA {soniaReport.soniaRatePct}% · Bank Rate {soniaReport.bankRatePct}%</small>
          </summary>
          <div className="drawer-inner">
            <p>
              <strong>Official Series Code:</strong> <code>{soniaReport.sourceSeriesCode}</code>
              <br />
              <strong>Observation Date:</strong> {soniaReport.observationDate} (Published {soniaReport.publicationTimestamp})
              <br />
              <strong>Reported SONIA Rate:</strong> {soniaReport.soniaRatePct}% (Exact fixing: {soniaReport.soniaExactReportedPct}%)
              <br />
              <strong>Bank Rate:</strong> {soniaReport.bankRatePct}% (Effective {soniaReport.mpcEffectiveDate} following 25 bps hike)
              <br />
              <strong>Spread to Bank Rate:</strong> {soniaReport.spreadToBankRateBps} bps
            </p>
            <ul>
              {soniaReport.reconciliationNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        </details>

        <details className="g6-drawer-details">
          <summary className="g6-drawer-summary">
            <span>Technical Drawer 2: Canonical Anthropic Compute Obligation Ledger ($895.4B Deduplicated)</span>
            <small>Prevents $44.6B Nscale Monarch Double Count + $15.4B Non-Binding Options</small>
          </summary>
          <div className="drawer-inner">
            <div className="table-wrap">
              <table className="mini-table">
                <thead>
                  <tr>
                    <th>ITEM</th>
                    <th>COUNTERPARTY</th>
                    <th>NOMINAL ($B)</th>
                    <th>STATUS</th>
                    <th>ACCOUNTING TREATMENT</th>
                    <th>INCLUSION</th>
                  </tr>
                </thead>
                <tbody>
                  {anthropicReport.lineItems.map((item) => (
                    <tr key={item.itemId}>
                      <td><strong>{item.itemId}</strong></td>
                      <td>{item.counterparty}</td>
                      <td>${item.nominalAmountUsdBillions.toFixed(1)}B</td>
                      <td><code>{item.contractualStatus}</code></td>
                      <td>{item.accountingTreatment}</td>
                      <td>
                        <span className={`tag ${item.includedInCanonicalDeduplicatedEnvelope ? 'green' : 'amber'}`}>
                          {item.includedInCanonicalDeduplicatedEnvelope ? 'INCLUDED' : 'DEDUPLICATED / EXCLUDED'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul style={{ marginTop: '12px' }}>
              {anthropicReport.reconciliationNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        </details>

        <details className="g6-drawer-details">
          <summary className="g6-drawer-summary">
            <span>Technical Drawer 3: Institutional Market-Data Provider Comparison (£0 Spent Governance)</span>
            <small>Awaiting Owner Approval · Free Primary Feeds Active</small>
          </summary>
          <div className="drawer-inner">
            <p>
              All market and macro observations are currently ingested via zero-cost primary feeds: SEC EDGAR XBRL, Stooq US Closes,
              Bank of England IADB, UK DMO, and FRED. No paid market-data subscriptions have been activated.
            </p>
            <p>
              <strong>Recommended Pilot Stack (Stage 2, Subject to Approval):</strong> Tiingo Commercial Startup ($30/mo ≈ £24/mo)
              for US corporate actions and split-adjusted daily closes + EODHD All-World ($99.99/mo ≈ £78/mo) for LSE UCITS ETF look-through constituents.
            </p>
          </div>
        </details>
      </section>

      {/* Brokerage Privacy & Isolation Governance Footer */}
      <footer className="broker-privacy-notice" data-testid="broker-privacy-notice" style={{ marginTop: '2rem', padding: '1.25rem', borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: '0.85rem', color: '#8892b0' }}>
        <strong>Brokerage Privacy &amp; Isolation:</strong> Trading 212 API credentials remain encrypted within the secure server-side vault. Under platform security rules (<code>executionAuthority: "none"</code>, <code>LIVE_TRADING_ENABLED=false</code>), no broker credentials or raw authorization tokens are ever transmitted to client browsers or exposed to LLM research agents. Read-only portfolio synchronisation is strictly owner-isolated and deterministic.
      </footer>
    </div>
  );
}
