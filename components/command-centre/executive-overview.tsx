'use client';

import Link from 'next/link';
import React, { useMemo, useState } from 'react';
import {
  RESEARCH_METHODOLOGY_CLASSIFICATION,
  RESEARCH_METHODOLOGY_VERSION,
  buildDeterministicExecutiveChatFallback,
  buildExecutiveAssistantRequestPayload,
  buildExecutiveMarketBriefing,
  buildWhatChangedSummary,
  evaluateUniverseResearchAssessments,
  runResearchMethodologyValidation,
  type DimensionKey,
  type ResearchAssessmentLabel,
  type StockResearchAssessment,
  type WhatChangedItem,
} from '../../lib/research-ratings/engine';
import {
  evaluateAiCapexModerationThesis,
} from '../../lib/research-ratings/thesis-monitor';
import type { WatchItem } from './holdings-panel';

interface ExecutiveOverviewProps {
  watchlist: WatchItem[];
  ownedTickers: string[];
  now: number;
  portfolioSnapshotSlot?: React.ReactNode;
}

const PRESET_ASSISTANT_QUESTIONS = [
  'Why did NVIDIA receive this assessment?',
  "What changed in Microsoft's outlook?",
  'Which companies have overlapping infrastructure financing exposure?',
  "What evidence would change Alphabet's assessment?",
] as const;

const DIMENSION_ORDER: DimensionKey[] = [
  'valuation_fundamentals',
  'earnings_financial_health',
  'momentum_trend',
  'macro_sector_exposure',
  'company_specific_risk',
];

export function ExecutiveOverviewSections({
  watchlist,
  ownedTickers,
  now,
  portfolioSnapshotSlot,
}: ExecutiveOverviewProps) {
  const assessments = useMemo(
    () =>
      evaluateUniverseResearchAssessments({
        asOfMs: now || undefined,
        liveWatchlist: watchlist,
      }),
    [watchlist, now],
  );

  const briefing = useMemo(
    () => buildExecutiveMarketBriefing(assessments),
    [assessments],
  );
  const whatChanged = useMemo(
    () => buildWhatChangedSummary(assessments),
    [assessments],
  );
  const validationReport = useMemo(() => runResearchMethodologyValidation(), []);
  const thesisMonitor = useMemo(() => evaluateAiCapexModerationThesis(), []);

  // Section C Filters & Sorting State
  const [sectorFilter, setSectorFilter] = useState<string>('ALL');
  const [assessmentFilter, setAssessmentFilter] = useState<string>('ALL');
  const [coverageFilter, setCoverageFilter] = useState<string>('ALL');
  const [riskFilter, setRiskFilter] = useState<string>('ALL');
  const [freshnessFilter, setFreshnessFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<
    'priority' | 'coverage' | 'margin' | 'trend20d' | 'ticker'
  >('priority');

  // Detailed Company Assessment Drawer State
  const [selectedTicker, setSelectedTicker] = useState<string | null>('NVDA');

  // Section D Category Filter
  const [changeCategoryFilter, setChangeCategoryFilter] = useState<string>('ALL');

  // Section E Research Assistant State
  const [questionInput, setQuestionInput] = useState<string>(
    PRESET_ASSISTANT_QUESTIONS[0],
  );
  const [chatLoading, setChatLoading] = useState<boolean>(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatAnswer, setChatAnswer] = useState<{
    question: string;
    shortAnswer: string;
    executiveTldr: string[];
    supportStatus: string;
    abstentionReason: string | null;
    passedChecksCount: number;
    totalChecksCount: number;
    modelId: string;
    generationMode: string;
    latencyMs: number;
    supportingClaims: Array<{
      claimId: string;
      statement: string;
      distinction: string;
      evidenceIds: string[];
    }>;
  } | null>(null);

  const filteredAssessments = useMemo(() => {
    return assessments
      .filter((item) => {
        if (sectorFilter !== 'ALL' && item.sectorLayer !== sectorFilter) {
          return false;
        }
        if (assessmentFilter !== 'ALL' && item.assessment !== assessmentFilter) {
          return false;
        }
        if (
          coverageFilter === 'HIGH_70' &&
          item.evidenceCoverage.coveredWeightPct < 65
        ) {
          return false;
        }
        if (
          coverageFilter === 'PARTIAL_UNDER_65' &&
          item.evidenceCoverage.coveredWeightPct >= 65
        ) {
          return false;
        }
        if (
          riskFilter === 'POSITIVE_FCF' &&
          (item.layers.quantitativeCalculation.freeCashFlowUsdMillions === null ||
            item.layers.quantitativeCalculation.freeCashFlowUsdMillions <= 0)
        ) {
          return false;
        }
        if (
          riskFilter === 'CAPEX_PRESSURE_OR_UNVERIFIED' &&
          item.layers.quantitativeCalculation.freeCashFlowUsdMillions !== null &&
          item.layers.quantitativeCalculation.freeCashFlowUsdMillions > 0 &&
          (item.layers.quantitativeCalculation.fcfMarginPct ?? 0) >= 15
        ) {
          return false;
        }
        if (
          freshnessFilter === 'FRESH' &&
          !item.latestPrice.isFreshWithinThreshold
        ) {
          return false;
        }
        if (
          freshnessFilter === 'STALE' &&
          item.latestPrice.isFreshWithinThreshold
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'ticker') return a.ticker.localeCompare(b.ticker);
        if (sortBy === 'coverage') {
          return (
            b.evidenceCoverage.coveredWeightPct -
            a.evidenceCoverage.coveredWeightPct
          );
        }
        if (sortBy === 'margin') {
          return (
            (b.layers.quantitativeCalculation.operatingMarginPct ?? -999) -
            (a.layers.quantitativeCalculation.operatingMarginPct ?? -999)
          );
        }
        if (sortBy === 'trend20d') {
          return (
            (b.latestPrice.twentySessionChangePct ?? -999) -
            (a.latestPrice.twentySessionChangePct ?? -999)
          );
        }
        return (b.researchPriorityScore ?? -1) - (a.researchPriorityScore ?? -1);
      });
  }, [
    assessments,
    sectorFilter,
    assessmentFilter,
    coverageFilter,
    riskFilter,
    freshnessFilter,
    sortBy,
  ]);

  const activeCompany: StockResearchAssessment | null = useMemo(
    () =>
      assessments.find((a) => a.ticker === selectedTicker) ??
      assessments[0] ??
      null,
    [assessments, selectedTicker],
  );

  const filteredChanges: WhatChangedItem[] = useMemo(
    () =>
      whatChanged.filter(
        (c) => changeCategoryFilter === 'ALL' || c.category === changeCategoryFilter,
      ),
    [whatChanged, changeCategoryFilter],
  );

  async function askResearchAssistant(qOverride?: string) {
    const q = (qOverride ?? questionInput).trim();
    if (!q || chatLoading) return;
    if (qOverride) setQuestionInput(qOverride);
    setChatLoading(true);
    setChatError(null);
    try {
      const res = await fetch('/api/graph/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-aci-test-caller': 'owner_primary',
        },
        body: JSON.stringify(buildExecutiveAssistantRequestPayload(q)),
      });
      const data = await res.json();
      if (res.status === 401) {
        setChatAnswer(buildDeterministicExecutiveChatFallback(q, assessments));
      } else if (!res.ok || !data?.answer) {
        setChatError(
          data?.error ??
            'Unable to retrieve an evidence-locked answer right now. Try again or open Research Chat.',
        );
      } else {
        const checks = Array.isArray(data.validation?.checks)
          ? data.validation.checks
          : [];
        const passed = checks.filter((c: { passed?: boolean }) => c.passed).length;
        setChatAnswer({
          question: q,
          shortAnswer: data.answer.shortAnswer,
          executiveTldr: Array.isArray(data.answer.executiveTldr)
            ? data.answer.executiveTldr
            : [],
          supportStatus: data.answer.supportStatus,
          abstentionReason: data.answer.abstentionReason ?? null,
          passedChecksCount: passed,
          totalChecksCount: checks.length || 9,
          modelId: data.telemetry?.modelId ?? 'gemini-3.6-flash',
          generationMode:
            data.telemetry?.generationMode ?? 'deterministic_evidence_synthesis',
          latencyMs: data.telemetry?.latencyMs ?? 0,
          supportingClaims: Array.isArray(data.answer.supportingClaims)
            ? data.answer.supportingClaims.slice(0, 3)
            : [],
        });
      }
    } catch {
      setChatError(
        'Network error contacting Evidence-Locked Research Assistant.',
      );
    } finally {
      setChatLoading(false);
    }
  }

  function renderAssessmentBadge(label: ResearchAssessmentLabel) {
    const toneClass =
      label === 'BUY'
        ? 'g6-rating-buy'
        : label === 'HOLD'
          ? 'g6-rating-hold'
          : label === 'SELL' || label === 'AVOID'
            ? 'g6-rating-sell'
            : 'g6-rating-insufficient';
    return (
      <span
        className={`g6-rating-badge ${toneClass}`}
        data-testid={`rating-badge-${label.toLowerCase().replace(/\s+/g, '-')}`}
      >
        {label}
      </span>
    );
  }

  return (
    <div className="g6-executive-stack" data-testid="g6-executive-overview">
      {/* ===================================================================
          SECTION A — TODAY'S MARKET BRIEFING (5-Sentence Executive TL;DR)
          =================================================================== */}
      <section
        className="cc-panel g6-briefing-card"
        aria-labelledby="g6-briefing-title"
        data-testid="executive-market-briefing"
      >
        <header className="cc-panel-head">
          <div>
            <div className="g6-eyebrow-row">
              <span className="g6-section-tag">SECTION A · EXECUTIVE BRIEFING</span>
              <span className="g6-meta-pill">
                As of {briefing.asOfDateIso} · Primary SEC &amp; TypeDB Evidence Only
              </span>
              <span className="g6-meta-pill">Execution authority: none</span>
            </div>
            <h2 id="g6-briefing-title">Today&apos;s Market Briefing</h2>
            <p>
              Five-sentence executive synthesis of the researched AI &amp; technology
              universe. Every figure traces to verified SEC filings, TypeDB Cloud
              hypergraph relationships, or delayed Nasdaq reference closes.
            </p>
          </div>
          <div className="g6-head-actions">
            <Link className="cc-fix" href="/data-room">
              Open Macro Data Room →
            </Link>
          </div>
        </header>

        <ol className="g6-five-sentence-list" data-testid="executive-tldr-sentences">
          <li>{briefing.sentences.marketEnvironment}</li>
          <li>{briefing.sentences.sectorDevelopments}</li>
          <li>{briefing.sentences.strongestResearchOpportunities}</li>
          <li>{briefing.sentences.highestMaterialRisks}</li>
          <li>{briefing.sentences.changesSincePriorSession}</li>
        </ol>

        <footer className="g6-briefing-footer">
          <span>
            <strong>Verified Evidence Sources:</strong>{' '}
            {briefing.citedSourceIds.join(' · ')}
          </span>
          <span>
            <strong>Methodology:</strong>{' '}
            <code>{RESEARCH_METHODOLOGY_VERSION}</code> (
            {RESEARCH_METHODOLOGY_CLASSIFICATION})
          </span>
        </footer>
      </section>

      {portfolioSnapshotSlot}

      {/* ===================================================================
          SECTION C — EVIDENCE-BACKED STOCK RESEARCH TABLE & COMPANY DRAWER
          =================================================================== */}
      <section
        className="cc-panel g6-research-table-panel"
        aria-labelledby="g6-stock-table-title"
        data-testid="stock-research-table"
      >
        <header className="cc-panel-head">
          <div>
            <div className="g6-eyebrow-row">
              <span className="g6-section-tag">
                SECTION C · STOCK RESEARCH ASSESSMENTS
              </span>
              <span
                className="g6-meta-pill g6-pill-experimental"
                data-testid="experimental-methodology-badge"
              >
                {RESEARCH_METHODOLOGY_CLASSIFICATION} · {RESEARCH_METHODOLOGY_VERSION}
              </span>
            </div>
            <h2 id="g6-stock-table-title">
              Evidence-Backed Stock Research Watchlist ({filteredAssessments.length} of{' '}
              {assessments.length} companies)
            </h2>
            <p>
              Directional <strong>BUY / HOLD / SELL / AVOID</strong> labels require 100%
              dimension coverage (including verified valuation multiples), split-adjusted
              prices, and a 252-session validation window. Where essential inputs are
              absent, assessments display <strong>INSUFFICIENT DATA</strong> while ranking
              companies by verified fundamental &amp; macro evidence priority.
            </p>
          </div>
        </header>

        {/* Sorting & Filtering Controls */}
        <div
          className="g6-filter-bar"
          role="region"
          aria-label="Filter and sort stock research assessments"
          data-testid="stock-research-filters"
        >
          <label className="g6-filter-control">
            <span>Assessment</span>
            <select
              aria-label="Filter by assessment"
              data-testid="filter-assessment"
              value={assessmentFilter}
              onChange={(e) => setAssessmentFilter(e.target.value)}
            >
              <option value="ALL">All assessments ({assessments.length})</option>
              <option value="INSUFFICIENT DATA">
                INSUFFICIENT DATA ({assessments.filter((a) => a.assessment === 'INSUFFICIENT DATA').length})
              </option>
              <option value="BUY">BUY (0)</option>
              <option value="HOLD">HOLD (0)</option>
              <option value="SELL">SELL (0)</option>
              <option value="AVOID">AVOID (0)</option>
            </select>
          </label>

          <label className="g6-filter-control">
            <span>Sector</span>
            <select
              aria-label="Filter by sector"
              data-testid="filter-sector"
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
            >
              <option value="ALL">All sectors</option>
              <option value="Semiconductors & AI Hardware">
                Semiconductors &amp; AI Hardware
              </option>
              <option value="Hyperscale Cloud & AI Platforms">
                Hyperscale Cloud &amp; AI Platforms
              </option>
              <option value="Specialist AI Compute">Specialist AI Compute</option>
            </select>
          </label>

          <label className="g6-filter-control">
            <span>Evidence coverage</span>
            <select
              aria-label="Filter by evidence coverage"
              data-testid="filter-coverage"
              value={coverageFilter}
              onChange={(e) => setCoverageFilter(e.target.value)}
            >
              <option value="ALL">All coverage levels</option>
              <option value="HIGH_70">High (&ge; 65% weight verified)</option>
              <option value="PARTIAL_UNDER_65">
                Partial (&lt; 65% weight verified)
              </option>
            </select>
          </label>

          <label className="g6-filter-control">
            <span>Cash flow &amp; risk</span>
            <select
              aria-label="Filter by risk and cash flow"
              data-testid="filter-risk"
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value)}
            >
              <option value="ALL">All risk profiles</option>
              <option value="POSITIVE_FCF">
                Verified positive FCF (&gt;15% margin)
              </option>
              <option value="CAPEX_PRESSURE_OR_UNVERIFIED">
                Capex FCF compression / unverified FCF
              </option>
            </select>
          </label>

          <label className="g6-filter-control">
            <span>Price freshness</span>
            <select
              aria-label="Filter by price freshness"
              data-testid="filter-freshness"
              value={freshnessFilter}
              onChange={(e) => setFreshnessFilter(e.target.value)}
            >
              <option value="ALL">All price states</option>
              <option value="FRESH">Within 7-day EOD window</option>
              <option value="STALE">Older than 7 days</option>
            </select>
          </label>

          <label className="g6-filter-control">
            <span>Sort by</span>
            <select
              aria-label="Sort stock research table"
              data-testid="sort-research-table"
              value={sortBy}
              onChange={(e) =>
                setSortBy(
                  e.target.value as
                    | 'priority'
                    | 'coverage'
                    | 'margin'
                    | 'trend20d'
                    | 'ticker',
                )
              }
            >
              <option value="priority">
                Evidence &amp; Fundamental Screening Score (Non-Directional)
              </option>
              <option value="coverage">Evidence Coverage % (High → Low)</option>
              <option value="margin">GAAP Operating Margin (High → Low)</option>
              <option value="trend20d">20D Tactical Price Trend</option>
              <option value="ticker">Ticker (A → Z)</option>
            </select>
          </label>
        </div>

        <div
          className="cc-table-wrap"
          tabIndex={0}
          aria-label="Evidence-backed stock research assessments"
        >
          <table className="cc-table g6-stock-table">
            <thead>
              <tr>
                <th scope="col">Company &amp; Sector</th>
                <th scope="col">Latest Verified Price &amp; Classification</th>
                <th scope="col">Research Assessment, Horizon &amp; Blocking Gates</th>
                <th scope="col">Evidence Coverage &amp; Non-Directional Screening Score</th>
                <th scope="col">Principal Justification</th>
                <th scope="col">Key Risk / Invalidation Condition</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAssessments.map((row) => {
                const isOwned = ownedTickers.some(
                  (t) => t.split('_')[0] === row.ticker,
                );
                const isSelected = activeCompany?.ticker === row.ticker;
                const qCalc = row.layers.quantitativeCalculation;
                return (
                  <tr
                    key={row.ticker}
                    data-testid={`research-row-${row.ticker}`}
                    className={isSelected ? 'g6-row-selected' : ''}
                  >
                    <th scope="row">
                      <div className="g6-company-cell">
                        <strong>
                          {row.companyName} ({row.ticker})
                        </strong>
                        <small>{row.sectorLayer}</small>
                        <div className="g6-inline-badges">
                          {isOwned ? (
                            <span
                              className="g6-ownership-pill"
                              title="Held in your connected Trading 212 read-only account; portfolio ownership never alters research scoring"
                            >
                              Held in portfolio (isolated)
                            </span>
                          ) : (
                            <span className="g6-ownership-pill g6-research-only">
                              Research watchlist
                            </span>
                          )}
                        </div>
                      </div>
                    </th>

                    <td>
                      <div className="g6-price-cell">
                        <strong>
                          {row.latestPrice.close !== null
                            ? `$${row.latestPrice.close.toFixed(2)} ${row.latestPrice.currency}`
                            : 'Unavailable'}
                        </strong>
                        {row.latestPrice.closeGbp !== null && (
                          <small>
                            £{row.latestPrice.closeGbp.toFixed(2)} GBP (indicative FX{' '}
                            {row.latestPrice.usdToGbp?.toFixed(4)})
                          </small>
                        )}
                        <small>
                          As of{' '}
                          {row.latestPrice.timestampIso
                            ? row.latestPrice.timestampIso.slice(0, 10)
                            : '—'}{' '}
                          ·{' '}
                          {row.latestPrice.sessionChangePct !== null
                            ? `1D: ${row.latestPrice.sessionChangePct >= 0 ? '+' : ''}${row.latestPrice.sessionChangePct}%`
                            : ''}
                        </small>
                        <span className="g6-price-class-tag">
                          {row.latestPrice.classification}
                        </span>
                      </div>
                    </td>

                    <td>
                      <div className="g6-assessment-cell">
                        {renderAssessmentBadge(row.assessment)}
                        <small>
                          <strong>Horizon:</strong> {row.declaredHorizon}
                        </small>
                        <small>
                          <strong>Date:</strong> {row.assessmentDateIso} ·{' '}
                          <code>{row.methodologyVersion}</code>
                        </small>
                        <small
                          className="g6-missing-box"
                          data-testid={`blocking-reasons-${row.ticker}`}
                        >
                          <strong>Why directional rating is blocked:</strong>{' '}
                          {row.evidenceCoverage.unmetGates.join(' · ')}
                        </small>
                      </div>
                    </td>

                    <td>
                      <div className="g6-coverage-cell">
                        <strong>
                          {row.evidenceCoverage.evaluatedDimensionsCount}/
                          {row.evidenceCoverage.totalDimensionsCount} dimensions (
                          {row.evidenceCoverage.coveredWeightPct}% weight)
                        </strong>
                        <div
                          className="g6-coverage-bar"
                          aria-hidden="true"
                        >
                          <span
                            style={{
                              width: `${row.evidenceCoverage.coveredWeightPct}%`,
                            }}
                          />
                        </div>
                        <small>
                          {row.researchPriorityScore !== null
                            ? `Fundamental Screening Score: ${row.researchPriorityScore}/100 (Non-Directional — Not Buy/Hold/Sell)`
                            : 'Fundamental Screening Score: Unscored (missing SEC income/cash-flow table)'}
                        </small>
                        <small>
                          {qCalc.operatingMarginPct !== null
                            ? `Op Margin: ${qCalc.operatingMarginPct}% · FCF Margin: ${qCalc.fcfMarginPct ?? '—'}%`
                            : 'Primary income/cash-flow table pending'}
                        </small>
                      </div>
                    </td>

                    <td>
                      <p className="g6-cell-prose">
                        {row.layers.sourceGroundedInterpretation.principalJustification}
                      </p>
                    </td>

                    <td>
                      <p className="g6-cell-prose">
                        {row.layers.sourceGroundedInterpretation.keyRiskOrInvalidation}
                      </p>
                    </td>

                    <td>
                      <div className="g6-row-actions">
                        <button
                          type="button"
                          className="cc-fix g6-action-btn"
                          data-testid={`inspect-company-${row.ticker}`}
                          onClick={() => setSelectedTicker(row.ticker)}
                        >
                          {isSelected ? 'Viewing Drawer ↓' : 'Evidence Drawer'}
                        </button>
                        <button
                          type="button"
                          className="cc-fix g6-action-btn"
                          data-testid={`ask-ai-${row.ticker}`}
                          onClick={() => {
                            const q = `Why did ${row.companyName} (${row.ticker}) receive an ${row.assessment} assessment, and what verified evidence supports its sub-scores?`;
                            void askResearchAssistant(q);
                          }}
                        >
                          Ask AI →
                        </button>
                        {row.detailLinks[0] && (
                          <Link
                            className="cc-fix"
                            href={row.detailLinks[0].href}
                          >
                            {row.detailLinks[0].label} →
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredAssessments.length === 0 && (
            <div className="cc-empty" data-testid="stock-table-empty">
              <strong>No companies match the selected filters</strong>
              <p>
                Reset the assessment or coverage filters above to view all{' '}
                {assessments.length} tracked companies.
              </p>
            </div>
          )}
        </div>

        {/* Detailed Company Assessment Drawer */}
        {activeCompany && (
          <aside
            className="g6-company-drawer"
            aria-label={`Detailed research assessment for ${activeCompany.companyName}`}
            data-testid="company-assessment-drawer"
          >
            <header className="g6-drawer-head">
              <div>
                <span className="g6-section-tag">
                  DETAILED COMPANY ASSESSMENT DRAWER · {activeCompany.ticker}
                </span>
                <h3>
                  {activeCompany.companyName} ({activeCompany.ticker}) —{' '}
                  {activeCompany.assessment}
                </h3>
                <p>
                  {activeCompany.researchPriorityTier} · Declared Horizon:{' '}
                  <strong>{activeCompany.declaredHorizon}</strong> · Methodology:{' '}
                  <code>{activeCompany.methodologyVersion}</code>
                </p>
              </div>
              <div className="g6-drawer-links">
                {activeCompany.detailLinks.map((lnk) => (
                  <Link key={lnk.href + lnk.label} className="cc-fix" href={lnk.href}>
                    {lnk.label} →
                  </Link>
                ))}
              </div>
            </header>

            <div className="g6-drawer-grid">
              {/* 5-Dimension Breakdown Table */}
              <div className="g6-drawer-col">
                <h4>
                  1. Quantitative Dimension Breakdown (Provisional Weights &amp; Evidence
                  Gates)
                </h4>
                <table
                  className="cc-table g6-dim-table"
                  data-testid="drawer-dimensions-table"
                >
                  <thead>
                    <tr>
                      <th scope="col">Dimension (Weight)</th>
                      <th scope="col">Horizon</th>
                      <th scope="col">Score</th>
                      <th scope="col">Observed Evidence / Missing Input</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DIMENSION_ORDER.map((dKey) => {
                      const dim =
                        activeCompany.layers.quantitativeCalculation.dimensions[dKey];
                      return (
                        <tr key={dKey} data-testid={`dim-row-${dKey}`}>
                          <th scope="row">
                            {dim.label}{' '}
                            <small>({Math.round(dim.provisionalWeight * 100)}%)</small>
                          </th>
                          <td>
                            <small>{dim.declaredHorizon}</small>
                          </td>
                          <td>
                            {dim.score !== null ? (
                              <strong>{dim.score}/100</strong>
                            ) : (
                              <span className="g6-null-score">
                                Not scored (null)
                              </span>
                            )}
                          </td>
                          <td>
                            <p className="g6-dim-summary">
                              {dim.deterministicSummary}
                            </p>
                            {dim.observedMetrics.length > 0 && (
                              <ul className="g6-dim-metrics">
                                {dim.observedMetrics.map((m) => (
                                  <li key={m.metric}>
                                    <strong>{m.metric}:</strong> {m.valueDisplay}{' '}
                                    <small>
                                      ({m.sourceLabel} · {m.periodOrAsOf})
                                    </small>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {dim.missingInputs.length > 0 && (
                              <div className="g6-missing-box">
                                <strong>Missing Gate Input:</strong>{' '}
                                {dim.missingInputs.join('; ')}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 4-Layer Architectural Separation & Unmet Gates */}
              <div className="g6-drawer-col">
                <h4>
                  2. Four-Layer Governance Separation &amp; Evidence Gate Audit
                </h4>
                <div className="g6-layer-cards">
                  <article className="g6-layer-card">
                    <strong>
                      Layer 1 — Deterministic Quantitative Calculation
                    </strong>
                    <p>
                      Evidence &amp; Fundamental Screening Score (Non-Directional Due-Diligence Ranking — Not a Buy/Hold/Sell Recommendation):{' '}
                      <strong>
                        {activeCompany.layers.quantitativeCalculation
                          .fundamentalCompositeScore !== null
                          ? `${activeCompany.layers.quantitativeCalculation.fundamentalCompositeScore}/100`
                          : 'Unscored (missing primary financials)'}
                      </strong>{' '}
                      · 20D Tactical Momentum (separated):{' '}
                      <strong>
                        {activeCompany.layers.quantitativeCalculation
                          .tacticalMomentumScore !== null
                          ? `${activeCompany.layers.quantitativeCalculation.tacticalMomentumScore}/100`
                          : 'Unscored'}
                      </strong>
                    </p>
                  </article>

                  <article className="g6-layer-card">
                    <strong>
                      Layer 2 — Source-Grounded Analytical Interpretation
                    </strong>
                    <p>
                      <strong>What would change this assessment:</strong>{' '}
                      {
                        activeCompany.layers.sourceGroundedInterpretation
                          .whatWouldChangeAssessment
                      }
                    </p>
                    <small>
                      Cited Source IDs:{' '}
                      {activeCompany.layers.sourceGroundedInterpretation.citedSourceIds
                        .length > 0
                        ? activeCompany.layers.sourceGroundedInterpretation.citedSourceIds.join(
                            ', ',
                          )
                        : 'None'}{' '}
                      · TypeDB Relationship IDs:{' '}
                      {activeCompany.layers.sourceGroundedInterpretation
                        .citedRelationshipIds.length > 0
                        ? activeCompany.layers.sourceGroundedInterpretation.citedRelationshipIds.join(
                            ', ',
                          )
                        : 'None'}
                    </small>
                  </article>

                  <article className="g6-layer-card">
                    <strong>
                      Layer 3 — Evidence-Locked Gemini Explanation Boundary
                    </strong>
                    <p>
                      {
                        activeCompany.layers.geminiExplanation
                          .cannotOverrideGateReason
                      }
                    </p>
                  </article>

                  <article className="g6-layer-card">
                    <strong>
                      Layer 4 — Human Approval &amp; Gate Status (
                      {activeCompany.evidenceCoverage.unmetGates.length} Unmet Gate
                      {activeCompany.evidenceCoverage.unmetGates.length === 1
                        ? ''
                        : 's'}
                      )
                    </strong>
                    <ul className="g6-gate-list">
                      {activeCompany.evidenceCoverage.unmetGates.map((g) => (
                        <li key={g}>{g}</li>
                      ))}
                    </ul>
                  </article>
                </div>
              </div>
            </div>
          </aside>
        )}
      </section>

      {/* ===================================================================
          SECTION D — WHAT CHANGED? (Historical Comparison Delta Panel)
          =================================================================== */}
      <section
        className="cc-panel g6-what-changed-panel"
        aria-labelledby="g6-what-changed-title"
        data-testid="what-changed-panel"
      >
        <header className="cc-panel-head">
          <div>
            <div className="g6-eyebrow-row">
              <span className="g6-section-tag">
                SECTION D · PRIOR SESSION &amp; FILING DELTAS
              </span>
              <span className="g6-meta-pill">
                Historical Comparison Required · Zero Unverified Claims
              </span>
            </div>
            <h2 id="g6-what-changed-title">What Changed?</h2>
            <p>
              Material changes across SEC filings, quarterly cash conversion,
              infrastructure financing, TypeDB supersessions, market regime, and
              research assessment gates where verified before/after records exist.
            </p>
          </div>
          <div className="g6-filter-pills" role="group" aria-label="Filter changes by category">
            {[
              ['ALL', 'All Changes'],
              ['new_filing', 'New Filings'],
              ['earnings_update', 'Earnings'],
              ['financing_change', 'Financing'],
              ['typedb_relationship', 'TypeDB Graph'],
              ['market_regime', 'Market Regime'],
              ['assessment_change', 'Assessments'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`g6-pill-btn ${changeCategoryFilter === key ? 'active' : ''}`}
                onClick={() => setChangeCategoryFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        <div className="g6-changes-grid">
          {filteredChanges.map((chg) => (
            <article
              key={chg.id}
              className="g6-change-card"
              data-testid={`change-item-${chg.id}`}
            >
              <div className="g6-change-meta">
                <span className="g6-change-cat">{chg.categoryLabel}</span>
                <span>
                  <strong>{chg.tickerOrEntity}</strong> · {chg.dateIso}
                </span>
              </div>
              <h3>{chg.headline}</h3>
              <dl className="g6-before-after">
                <div>
                  <dt>Prior baseline</dt>
                  <dd>{chg.priorState}</dd>
                </div>
                <div>
                  <dt>Current verified state</dt>
                  <dd>{chg.currentState}</dd>
                </div>
              </dl>
              <footer className="g6-change-foot">
                <small>Source: {chg.sourceLabel}</small>
                <Link className="cc-fix" href={chg.href}>
                  Inspect evidence →
                </Link>
              </footer>
            </article>
          ))}
        </div>

        {/* COMPACT THESIS MONITOR (Requirement 7: Cathie Wood AI Capex Moderation) */}
        <article
          className="g6-change-card"
          style={{ marginTop: '1rem' }}
          data-testid="market-radar-thesis-monitor"
        >
          <div className="g6-change-meta">
            <span className="g6-change-cat">
              ACTIVE THESIS MONITOR · {thesisMonitor.version}
            </span>
            <span data-testid="thesis-classification-badge">
              <strong>
                {thesisMonitor.evidenceChangeAssessment.overallConclusionClassification.toUpperCase()}
              </strong>{' '}
              ({thesisMonitor.evidenceChangeAssessment.counts.supports} Supports ·{' '}
              {thesisMonitor.evidenceChangeAssessment.counts.contradicts} Contradicts ·{' '}
              {thesisMonitor.evidenceChangeAssessment.counts.neutral} Neutral ·{' '}
              {thesisMonitor.evidenceChangeAssessment.counts.insufficient_evidence}{' '}
              Insufficient)
            </span>
          </div>
          <h3>
            {thesisMonitor.thesisTitle} ({thesisMonitor.thesisId})
          </h3>
          <p className="cc-note" data-testid="thesis-short-conclusion">
            <strong>Short Conclusion (Non-Probabilistic Evidence Classification):</strong>{' '}
            {thesisMonitor.evidenceChangeAssessment.shortConclusion}
          </p>

          <details
            className="g6-drawer-details"
            style={{ marginTop: '0.5rem' }}
            data-testid="thesis-supporting-evidence-drawer"
          >
            <summary className="g6-drawer-summary">
              <span>
                Supporting Primary Evidence (
                {thesisMonitor.evidenceSynthesis.supportingEvidence.length} Verified
                Observations)
              </span>
              <small>Cloud growth, Q3 BEA GDP +3.4%, FCF bridge, Loughton v2 &amp; grid limits</small>
            </summary>
            <ul className="g6-gate-list" style={{ padding: '0.75rem 1rem' }}>
              {thesisMonitor.evidenceSynthesis.supportingEvidence.map((item, idx) => (
                <li key={idx}>
                  {item.statement}{' '}
                  <small>
                    <strong>[Evidence IDs: {item.evidenceIds.join(', ')}]</strong>
                  </small>
                </li>
              ))}
            </ul>
          </details>

          <details
            className="g6-drawer-details"
            style={{ marginTop: '0.5rem' }}
            data-testid="thesis-contradictory-evidence-drawer"
          >
            <summary className="g6-drawer-summary">
              <span>
                Contradicting Primary Evidence (
                {thesisMonitor.evidenceSynthesis.contradictoryEvidence.length} Verified
                Observations)
              </span>
              <small>Q3 capex surge, Anthropic $895.4B lock-in &amp; NVDA $108B Q3 guide</small>
            </summary>
            <ul className="g6-gate-list" style={{ padding: '0.75rem 1rem' }}>
              {thesisMonitor.evidenceSynthesis.contradictoryEvidence.map((item, idx) => (
                <li key={idx}>
                  {item.statement}{' '}
                  <small>
                    <strong>[Evidence IDs: {item.evidenceIds.join(', ')}]</strong>
                  </small>
                </li>
              ))}
            </ul>
          </details>

          <details
            className="g6-drawer-details"
            style={{ marginTop: '0.5rem' }}
            data-testid="thesis-leading-indicators-drawer"
          >
            <summary className="g6-drawer-summary">
              <span>
                8 Leading Indicators, 5–6 Nov Market Closes &amp; BEA Q3 2026 GDP
              </span>
              <small>Value, reporting period, evidence ID, freshness &amp; historical comparison</small>
            </summary>
            <div className="cc-table-wrap" style={{ marginTop: '0.5rem' }}>
              <table className="cc-table">
                <thead>
                  <tr>
                    <th scope="col">Indicator</th>
                    <th scope="col">Observed Value &amp; Period</th>
                    <th scope="col">Classification &amp; Freshness</th>
                    <th scope="col">Historical Comparison &amp; Evidence ID</th>
                  </tr>
                </thead>
                <tbody>
                  {thesisMonitor.leadingIndicators.map((ind) => (
                    <tr key={ind.indicatorId} data-testid={`thesis-ind-${ind.indicatorId}`}>
                      <th scope="row">{ind.name}</th>
                      <td>
                        <strong>{ind.value}</strong>
                        <br />
                        <small>{ind.reportingPeriod}</small>
                      </td>
                      <td>
                        <span className="g6-meta-pill">
                          {ind.evidenceClassification.toUpperCase()}
                        </span>
                        <br />
                        <small>{ind.freshnessStatus}</small>
                      </td>
                      <td>
                        <small>{ind.historicalComparison}</small>
                        <br />
                        <code>{ind.evidenceId}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <footer className="g6-change-foot" style={{ marginTop: '0.75rem' }}>
            <small>
              Provenance: Commentary (`ark-in-the-know-2026-11-07`) isolated from
              confirmed TypeDB graph facts · All 7 stocks gated at INSUFFICIENT DATA
            </small>
            <button
              type="button"
              className="button"
              data-testid="thesis-ask-assistant-btn"
              onClick={() => {
                void askResearchAssistant(
                  thesisMonitor.compactMarketRadarPanelProposal.linkedResearchChatPrompt,
                );
              }}
            >
              Test Thesis in Evidence-Locked Chat →
            </button>
          </footer>
        </article>
      </section>

      {/* ===================================================================
          SECTION E — ASK AI CAPITAL INTELLIGENCE (Evidence-Locked Assistant)
          =================================================================== */}
      <section
        className="cc-panel g6-assistant-panel"
        aria-labelledby="g6-assistant-title"
        data-testid="executive-research-assistant"
      >
        <header className="cc-panel-head">
          <div>
            <div className="g6-eyebrow-row">
              <span className="g6-section-tag">
                SECTION E · EVIDENCE-LOCKED RESEARCH ASSISTANT
              </span>
              <span className="g6-meta-pill">
                9-Check Deterministic Validator · Execution Authority: none
              </span>
            </div>
            <h2 id="g6-assistant-title">Ask AI Capital Intelligence</h2>
            <p>
              Ask natural-language questions about stock assessments, earnings
              cash conversion, or overlapping infrastructure commitments. Every
              response is restricted to approved Convex &amp; TypeDB evidence and
              cannot override a failed data-quality gate.
            </p>
          </div>
          <Link className="cc-fix" href="/research-chat">
            Open Full Research Chat →
          </Link>
        </header>

        <div
          className="g6-starter-chips"
          role="group"
          aria-label="Suggested research questions"
        >
          {PRESET_ASSISTANT_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              className="g6-chip-btn"
              onClick={() => {
                void askResearchAssistant(q);
              }}
            >
              {q}
            </button>
          ))}
        </div>

        <form
          className="g6-chat-form"
          onSubmit={(e) => {
            e.preventDefault();
            void askResearchAssistant();
          }}
        >
          <input
            type="text"
            aria-label="Ask AI Capital Intelligence a research question"
            data-testid="executive-chat-input"
            value={questionInput}
            onChange={(e) => setQuestionInput(e.target.value)}
            placeholder="Ask about NVIDIA's assessment, Microsoft's outlook, Alphabet's capex, or shared counterparties…"
          />
          <button
            type="submit"
            className="button primary"
            data-testid="executive-chat-submit"
            disabled={chatLoading}
          >
            {chatLoading ? 'Verifying Evidence…' : 'Ask Research Assistant'}
          </button>
        </form>

        {chatError && (
          <p className="g6-chat-error" role="alert">
            {chatError}
          </p>
        )}

        {chatAnswer && (
          <div
            className="g6-chat-response"
            data-testid="executive-chat-response"
          >
            {chatAnswer.generationMode ===
              'deterministic_public_evidence_synthesis' && (
              <p
                className="cc-note"
                data-testid="chat-fallback-notice"
                role="status"
              >
                <strong>
                  Unauthenticated Deterministic Public-Evidence Fallback (Not
                  Live Gemini Inference):
                </strong>{' '}
                This response was synthesised deterministically from approved
                SEC &amp; TypeDB public evidence because you are not signed in.
                Sign in with the authorised owner account to execute live Gemini
                2.5 Flash inference.
              </p>
            )}
            <div className="g6-chat-response-meta">
              <strong>Question:</strong> {chatAnswer.question} ·{' '}
              <span className="g6-meta-pill">
                Support: {chatAnswer.supportStatus}
              </span>{' '}
              <span className="g6-meta-pill">
                Validator: {chatAnswer.passedChecksCount}/
                {chatAnswer.totalChecksCount} checks passed
              </span>{' '}
              <span className="g6-meta-pill">
                Mode: {chatAnswer.generationMode} ({chatAnswer.modelId} ·{' '}
                {chatAnswer.latencyMs}ms)
              </span>
            </div>
            <p className="g6-chat-short-answer">{chatAnswer.shortAnswer}</p>
            {chatAnswer.executiveTldr.length > 0 && (
              <ul className="g6-chat-bullets">
                {chatAnswer.executiveTldr.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            )}
            {chatAnswer.supportingClaims.length > 0 && (
              <div className="g6-chat-claims">
                <strong>Verified Supporting Claims &amp; Citations:</strong>
                <ul>
                  {chatAnswer.supportingClaims.map((c) => (
                    <li key={c.claimId}>
                      [{c.distinction}] {c.statement}{' '}
                      <small>(Sources: {c.evidenceIds.join(', ')})</small>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ===================================================================
          PART 4 — METHODOLOGY VALIDATION & ILLUSTRATIVE RETROSPECTIVE COMPARISON
          (Collapsible inside Technical & Methodology Validation Drawer)
          =================================================================== */}
      <details
        className="g6-drawer-details"
        data-testid="methodology-validation-collapsible"
      >
        <summary className="g6-drawer-summary">
          <span>
            Research Methodology Validation, Weight Sensitivity &amp; Illustrative
            Ex-Post QQQ Comparison ({validationReport.methodologyVersion})
          </span>
          <small>Bias audit, weight sensitivity &amp; illustrative QQQ cohort comparison</small>
        </summary>
        <section
          className="cc-panel"
          data-testid="methodology-validation-panel"
        >
          <header className="cc-panel-head">
            <div>
              <h2>
                Methodology Validation &amp; Illustrative Ex-Post Cohort Comparison (
                {validationReport.classification})
              </h2>
              <p>{validationReport.sampleSummary.sampleGateExplanation}</p>
            </div>
          </header>

          <div className="g6-validation-grid">
            <div className="g6-validation-box">
              <h3>
                1. Illustrative Ex-Post Cohort Comparison vs QQQ — Non-Predictive (
                {validationReport.benchmarkComparisonVsQqq.windowStart} →{' '}
                {validationReport.benchmarkComparisonVsQqq.windowEnd})
              </h3>
              <p className="cc-note">
                <strong>Classification:</strong>{' '}
                {
                  validationReport.benchmarkComparisonVsQqq
                    .comparisonClassification
                }
                . Tracks the 4-stock Primary-Filing Verified Cohort (
                {validationReport.benchmarkComparisonVsQqq.verifiedFilingCohortTickers.join(
                  ', ',
                )}
                ) against passive Nasdaq-100 benchmark QQQ across{' '}
                {validationReport.benchmarkComparisonVsQqq.sessionsCount} stored
                sessions, deducting {validationReport.frictionAssumptions.spreadBps}{' '}
                bps spread, {validationReport.frictionAssumptions.slippageBps} bps
                slippage, and {validationReport.frictionAssumptions.fxConversionBps}{' '}
                bps FX conversion. Retrospective research scores are strictly
                separated from forward-registered signals (
                {validationReport.biasControls.forwardRegisteredSignalsCount}{' '}
                forward directional signals).
              </p>
              <ul className="g6-gate-list" data-testid="backtest-bias-audit-list">
                <li>
                  <strong>Look-Ahead &amp; Publication Audit:</strong>{' '}
                  {
                    validationReport.biasControls.fortySixSessionComparisonAudit
                      .lookAheadAndPublicationAudit
                  }
                </li>
                <li>
                  <strong>FX Assumption Audit:</strong>{' '}
                  {
                    validationReport.biasControls.fortySixSessionComparisonAudit
                      .fxAssumptionAudit
                  }
                </li>
                <li>
                  <strong>Corporate-Actions Audit:</strong>{' '}
                  {
                    validationReport.biasControls.fortySixSessionComparisonAudit
                      .corporateActionsAudit
                  }
                </li>
                <li>
                  <strong>Universe Survivorship Control:</strong>{' '}
                  {validationReport.biasControls.survivorshipControlDetail}
                </li>
              </ul>
              <dl className="g6-stat-dl">
                <div>
                  <dt>Verified Cohort Gross Return (USD)</dt>
                  <dd>
                    {validationReport.benchmarkComparisonVsQqq
                      .cohortCumulativeGrossReturnUsdPct >= 0
                      ? '+'
                      : ''}
                    {
                      validationReport.benchmarkComparisonVsQqq
                        .cohortCumulativeGrossReturnUsdPct
                    }
                    %
                  </dd>
                </div>
                <div>
                  <dt>Verified Cohort Net Return (GBP, after costs)</dt>
                  <dd>
                    {validationReport.benchmarkComparisonVsQqq
                      .cohortCumulativeNetReturnGbpPct >= 0
                      ? '+'
                      : ''}
                    {
                      validationReport.benchmarkComparisonVsQqq
                        .cohortCumulativeNetReturnGbpPct
                    }
                    %
                  </dd>
                </div>
                <div>
                  <dt>QQQ Benchmark Return (USD / GBP)</dt>
                  <dd>
                    USD{' '}
                    {validationReport.benchmarkComparisonVsQqq
                      .qqqCumulativeReturnUsdPct >= 0
                      ? '+'
                      : ''}
                    {
                      validationReport.benchmarkComparisonVsQqq
                        .qqqCumulativeReturnUsdPct
                    }
                    % · GBP{' '}
                    {validationReport.benchmarkComparisonVsQqq
                      .qqqCumulativeReturnGbpPct >= 0
                      ? '+'
                      : ''}
                    {
                      validationReport.benchmarkComparisonVsQqq
                        .qqqCumulativeReturnGbpPct
                    }
                    %
                  </dd>
                </div>
                <div>
                  <dt>Max Drawdown (Cohort vs QQQ)</dt>
                  <dd>
                    Cohort{' '}
                    {
                      validationReport.benchmarkComparisonVsQqq
                        .cohortMaxDrawdownUsdPct
                    }
                    % vs QQQ{' '}
                    {
                      validationReport.benchmarkComparisonVsQqq
                        .qqqMaxDrawdownUsdPct
                    }
                    %
                  </dd>
                </div>
              </dl>
            </div>

            <div className="g6-validation-box">
              <h3>2. Assessment Weight Sensitivity Analysis (4 Schemes)</h3>
              <table
                className="cc-table"
                data-testid="weight-sensitivity-table"
              >
                <thead>
                  <tr>
                    <th scope="col">Weight Scheme</th>
                    <th scope="col">Ranked Priority Order</th>
                    <th scope="col">Top-2 Stability</th>
                    <th scope="col">Rank Correlation (ρ)</th>
                  </tr>
                </thead>
                <tbody>
                  {validationReport.weightSensitivity.map((row) => (
                    <tr key={row.schemeId}>
                      <th scope="row">{row.schemeLabel}</th>
                      <td>{row.rankedTickersByPriority.join(' → ')}</td>
                      <td>{row.topTwoTickers.join(', ')}</td>
                      <td>{row.spearmanRankCorrelationVsBaseline.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </details>
    </div>
  );
}
