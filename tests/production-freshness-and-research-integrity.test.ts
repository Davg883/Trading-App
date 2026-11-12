import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  buildExecutiveMarketBriefing,
  evaluateUniverseResearchAssessments,
} from '../lib/research-ratings/engine';
import { ExecutiveOverviewSections } from '../components/command-centre/executive-overview';
import { CommandCentre } from '../components/command-centre/command-centre';
import { researchFeed } from '../lib/portfolio/research-feed';
import { evaluateCollectionHealth } from '../lib/remote-ops/health-monitor';
import { buildWorkspaceConnectionsReport } from '../lib/remote-ops/workspace-connections';
import { selectCurrentSecXbrlFact } from '../lib/remote-ops/sec-xbrl-fact-selector';
import {
  getSecXbrlCompanyRecord,
  getSecXbrlExpansionPackage,
} from '../lib/research-ratings/sec-xbrl-expansion';
import secXbrlExpansionRaw from '../data/sec-xbrl/phase-g7-1-sec-xbrl-expansion.json';
import { runScheduledCloudCycle } from '../convex/remoteOpsCloud';

describe('Production Freshness Recovery & Research Integrity Regression Suite', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('Priority 1A & 1B: buildExecutiveMarketBriefing uses persisted live QQQ observations, separates source observation time from report generation time, and removes duplicate list numbering', () => {
    const liveWatchlist = [
      {
        ticker: 'QQQ',
        name: 'Invesco QQQ Trust',
        close: 690.38,
        closeGbp: 534.7,
        usdToGbp: 0.7745,
        closeAt: Date.parse('2026-11-11T21:00:00Z'),
        change1d: null,
        change5d: null,
        ai: true,
        source: 'https://api.nasdaq.com/api/quote/QQQ/historical',
      },
      {
        ticker: 'NVDA',
        name: 'NVIDIA Corp.',
        close: 195.88,
        closeGbp: 151.71,
        usdToGbp: 0.7745,
        closeAt: Date.parse('2026-11-11T21:00:00Z'),
        change1d: null,
        change5d: null,
        ai: true,
        source: 'https://api.nasdaq.com/api/quote/NVDA/historical',
      },
    ];

    const reportGeneratedAtMs = Date.parse('2026-11-12T07:30:16.435Z');
    const assessments = evaluateUniverseResearchAssessments({
      asOfMs: Date.parse('2026-11-12T15:00:00Z'),
      liveWatchlist,
    });

    const briefing = buildExecutiveMarketBriefing(assessments, {
      liveWatchlist,
      morningBriefing: {
        briefingDate: '2026-11-12',
        generatedAt: reportGeneratedAtMs,
        modelVersion: null,
        confirmedFactsCount: 7,
        incompleteEvidenceCount: 2,
      },
      nowMs: Date.parse('2026-11-12T15:00:00Z'),
      reportGeneratedAtMs,
    } as never);

    // Must reflect the persisted 2026-11-11 QQQ observation ($690.38), not hard-coded 2026-11-04 ($691.95)
    expect(briefing.asOfDateIso).toBe('2026-11-11');
    expect(briefing.sentences.marketEnvironment).toContain('2026-11-11');
    expect(briefing.sentences.marketEnvironment).toContain('$690.38');
    // Must not falsely claim a 1-day return against 2026-11-03 ($685.28)
    expect(briefing.sentences.marketEnvironment).not.toContain('vs $685.28 on 2026-11-03');

    // Must explicitly separate source observation time from report generation time and fundamental cut-off
    expect((briefing as unknown as Record<string, unknown>).sourceObservationAtMs).toBe(
      Date.parse('2026-11-11T21:00:00Z'),
    );
    expect((briefing as unknown as Record<string, unknown>).reportGeneratedAtMs).toBe(
      reportGeneratedAtMs,
    );
    expect((briefing as unknown as Record<string, unknown>).fundamentalCutoffDateIso).toBe(
      '2026-11-04',
    );

    // Must not prepend literal "1. ".."5. " numbers to sentences rendered inside <ol>
    for (const sentence of Object.values(briefing.sentences)) {
      expect(sentence).not.toMatch(/^\d+\.\s+/);
    }
  });

  it('Priority 1C & 1D: ExecutiveOverviewSections and CommandCentre prevent silent cross-cutoff return mixing, replace misleading Today’s Market Briefing heading, and raise a warning when snapshot data is stale', () => {
    const now = Date.parse('2026-11-12T15:00:00Z');
    const discontinuousWatchlist = [
      {
        ticker: 'NVDA',
        name: 'NVIDIA Corp.',
        close: 195.88,
        closeGbp: 151.71,
        usdToGbp: 0.7745,
        closeAt: Date.parse('2026-11-11T21:00:00Z'),
        change1d: null,
        change5d: null,
        ai: true,
        source: 'https://api.nasdaq.com/api/quote/NVDA/historical',
      },
    ];

    const assessments = evaluateUniverseResearchAssessments({
      asOfMs: now,
      liveWatchlist: discontinuousWatchlist,
    });
    const nvda = assessments.find((a) => a.ticker === 'NVDA')!;
    // Without contiguous intermediate bars between 2026-11-04 and 2026-11-11, latestPrice.sessionChangePct must not divide 2026-11-11 by 2026-11-03
    expect(nvda.latestPrice.sessionChangePct).toBeNull();

    const baseFeed = researchFeed();
    // Render CommandCentre when only the 2026-11-04 static snapshot is available on 2026-11-12 (8 days stale)
    const html = renderToStaticMarkup(
      React.createElement(CommandCentre, {
        portfolio: null,
        trading: null,
        operations: null,
        feed: baseFeed,
        flags: { demo: false, live: false },
        now,
        signedIn: true,
        configured: true,
      }),
    );

    // Must not claim "Today's Market Briefing" for an 8-day-old snapshot or claim "No items need attention"
    expect(html).not.toContain('Today&#x27;s Market Briefing');
    expect(html).not.toContain("Today's Market Briefing");
    expect(html).not.toContain('No items need attention');
    expect(html).toContain('Historical Research Snapshot');
  });

  it('Priority 2: evaluateCollectionHealth and buildWorkspaceConnectionsReport distinguish 7 pipeline/agent states and never infer live AI provider health from historical chat turns or 0-token deterministic runs', () => {
    const now = Date.parse('2026-11-12T15:00:00Z');
    const health = evaluateCollectionHealth({
      now,
      systemEnabled: true,
      activeEnvironment: 'remote',
      dailyCostCeilingGbp: 2,
      monthlyCostCeilingGbp: 20,
      dailyEstimatedCostGbp: 0,
      dailyActualCostGbp: 0,
      monthlyEstimatedCostGbp: 0.005674,
      monthlyActualCostGbp: 0.005674,
      pendingVerificationCount: 1,
      latestBriefingDate: '2026-11-12',
      latestBriefingGeneratedAt: Date.parse('2026-11-12T07:30:16.435Z'),
      jobs: [
        {
          jobKey: 'news_discovery_agent',
          intervalMinutes: 15,
          enabled: true,
          pausedReason: null,
          lastSuccessAt: Date.parse('2026-11-12T14:40:23.220Z'),
          lastRunAt: Date.parse('2026-11-12T14:40:23.220Z'),
          nextRunAt: Date.parse('2026-11-12T14:55:23.220Z'),
          sourcesAddedTotal: 10,
          evidenceAddedTotal: 8,
          estimatedCostGbpTotal: 0,
          actualCostGbpTotal: 0,
          lastProviderRequests: 7,
          lastDurationMs: 1080,
          lastConditionalSkip: true,
          lastOutcome: 'succeeded:cursor_unchanged',
          lastErrorCode: null,
        },
      ],
      recentRuns: [
        {
          runId: 'cloud-news_discovery_agent-1794487222559',
          jobKey: 'news_discovery_agent',
          category: 'remote_agent',
          environment: 'remote',
          status: 'succeeded',
          startedAt: Date.parse('2026-11-12T12:40:22.559Z'),
          finishedAt: Date.parse('2026-11-12T12:40:23.632Z'),
          cursorBefore: 'agent:v2:old',
          cursorAfter: 'agent:v2:new',
          sourcesDiscovered: 1,
          evidenceStaged: 1,
          evidencePromoted: 1,
          duplicatesSkipped: 0,
          pendingVerification: 0,
          modelVersion: 'deterministic-sec-xbrl-extractor-v1 (GEMINI_API_KEY not configured)',
          estimatedCostGbp: 0,
          actualCostGbp: null,
          providerRequestsCount: 8,
          processingDurationMs: 1073,
          conditionalSkip: false,
          errorCode: null,
          summary: 'Deterministic SEC XBRL extraction completed.',
        },
      ],
      evidenceChat: {
        totalTurns: 33,
        turnsToday: 0,
        supportedCount: 5,
        partiallySupportedCount: 0,
        unsupportedCount: 28,
        validationRejectionCount: 0,
        providerErrorCount: 26,
        inputTokensTotal: 41340,
        outputTokensTotal: 4471,
        dailySpendGbp: 0,
        totalSpendGbp: 0.005674,
        dailyCeilingGbp: 2,
        unsupportedRate: 0.8485,
        modelId: 'gemini-3.5-flash',
        geminiConfigured: false, // Historical chat turns from 2026-11-09 must not set current geminiConfigured=true when env key is absent
        geminiEnabled: true,
        lastChatAtMs: Date.parse('2026-11-09T21:37:50.531Z'),
      },
      environmentAudit: [
        {
          serviceId: 'remote_ai_models',
          name: 'Remote AI Model Providers (Gemini / OpenAI / Anthropic)',
          environmentTarget: 'GEMINI_API_KEY · OPENAI_API_KEY · ANTHROPIC_API_KEY',
          status: 'connected', // Previously polluted by historical chat turn
          lastVerifiedAt: Date.parse('2026-11-12T14:40:23.220Z'), // Previously polluted by 0-token agent run
          detail: 'Cloud LLM provider keys configured.',
        },
      ],
    });

    const stages = (health as unknown as Record<string, unknown>).agentAndProviderStages as
      | Record<string, unknown>
      | undefined;
    expect(stages).toBeDefined();
    expect(stages).toMatchObject({
      collectorRunning: true,
      deterministicProcessingCompleted: true,
      modelInferenceAttempted: false,
      modelInferenceSucceeded: false,
      providerUnavailable: true,
      researchValidated: true,
      briefingPublished: true,
    });

    const report = buildWorkspaceConnectionsReport({
      liveOps: { health, latestBriefing: null },
      convexUrlConfigured: true,
      convexIsProduction: true,
      modelProviderConfigured: false,
      now,
    });
    const modelSvc = report.services.find((s) => s.id === 'model_providers')!;
    expect(modelSvc.status).not.toBe('Connected and healthy');
    expect(modelSvc.detail).toContain('NOT IMPLEMENTED');
  });

  it('Priority 3: SEC XBRL fact selector chooses current reporting periods over comparative 2017/2020 rows and refuses to misattribute 10-Q facts to 8-K accessions', async () => {
    vi.stubEnv('RESEARCH_OWNER_ID', 'user_test_owner');
    vi.stubEnv('RESEARCH_SCHEDULER_ENV', 'remote');

    const submittedPayloads: Array<Record<string, unknown>> = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/submissions/CIK0001045810.json')) {
        return new Response(
          JSON.stringify({
            cik: '1045810',
            name: 'NVIDIA CORP',
            tickers: ['NVDA'],
            filings: {
              recent: {
                accessionNumber: ['0001045810-26-000064'],
                filingDate: ['2026-08-26'],
                reportDate: ['2026-07-26'],
                acceptanceDateTime: ['2026-08-26T20:15:00.000Z'],
                form: ['10-Q'],
                primaryDocument: ['nvda-20260726.htm'],
              },
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes('/companyfacts/CIK0001045810.json')) {
        return new Response(
          JSON.stringify({
            cik: 1045810,
            entityName: 'NVIDIA CORP',
            facts: {
              'us-gaap': {
                PaymentsToAcquirePropertyPlantAndEquipment: {
                  units: {
                    USD: [
                      // Comparative historical row in the same filing (exact bug reproduced from prod staged-e2523ed83a7c0247)
                      {
                        val: 1070000000,
                        fy: 2020,
                        fp: 'Q2',
                        form: '10-Q',
                        filed: '2026-08-26',
                        accn: '0001045810-26-000064',
                        end: '2020-07-26',
                        frame: 'CY2020Q2',
                      },
                      // Current period row in the same filing
                      {
                        val: 2715000000,
                        fy: 2027,
                        fp: 'Q2',
                        form: '10-Q',
                        filed: '2026-08-26',
                        accn: '0001045810-26-000064',
                        end: '2026-07-26',
                        frame: 'CY2026Q2',
                      },
                    ],
                  },
                },
              },
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes('/submissions/CIK0001018724.json')) {
        return new Response(
          JSON.stringify({
            cik: '1018724',
            name: 'AMAZON COM INC',
            tickers: ['AMZN'],
            filings: {
              recent: {
                accessionNumber: ['0001018724-26-000040'],
                filingDate: ['2026-10-30'],
                reportDate: ['2026-09-30'],
                acceptanceDateTime: ['2026-10-30T20:05:00.000Z'],
                form: ['10-Q'],
                primaryDocument: ['amzn-20260930.htm'],
              },
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes('/companyfacts/CIK0001018724.json')) {
        return new Response(
          JSON.stringify({
            cik: 1018724,
            entityName: 'AMAZON COM INC',
            facts: {
              'us-gaap': {
                PaymentsToAcquirePropertyPlantAndEquipment: {
                  units: {
                    USD: [
                      // Comparative historical row in the same filing (exact bug reproduced from prod staged-dcf44b009199d49a)
                      {
                        val: 10058000000,
                        fy: 2017,
                        fp: 'Q1',
                        form: '10-Q',
                        filed: '2026-10-30',
                        accn: '0001018724-26-000040',
                        end: '2017-03-31',
                        frame: 'CY2017Q1',
                      },
                      // Current period row in the same filing
                      {
                        val: 22620000000,
                        fy: 2026,
                        fp: 'Q3',
                        form: '10-Q',
                        filed: '2026-10-30',
                        accn: '0001018724-26-000040',
                        end: '2026-09-30',
                        frame: 'CY2026Q3',
                      },
                    ],
                  },
                },
              },
            },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ filings: { recent: {} } }), { status: 200 });
    });

    const mockCtx = {
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        if (typeof args.submissionJson === 'string') {
          submittedPayloads.push(JSON.parse(args.submissionJson));
          return {
            evidenceStaged: 2,
            evidencePromoted: 2,
            duplicatesSkipped: 0,
            conditionalSkip: false,
            serverReceivedAt: Date.now(),
          };
        }
        return { ok: true, leaseToken: 'lease-1', cursor: null };
      },
      runQuery: async () => ({
        cursor: null,
        seenUrls: [],
        seenContentHashes: [],
        seenFactKeys: [],
        existingBriefingDates: [],
      }),
    };

    const handler = (
      runScheduledCloudCycle as unknown as {
        _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>;
      }
    )._handler;
    await handler(mockCtx, {
      environment: 'remote',
      forceOnDemand: true,
      jobs: ['news_discovery_agent'],
    });

    expect(submittedPayloads.length).toBe(1);
    const items = (submittedPayloads[0]!.items ?? []) as Array<{ title: string; summary: string }>;
    const nvdaItem = items.find((i) => i.title.includes('NVDA'))!;
    const amznItem = items.find((i) => i.title.includes('AMZN'))!;

    expect(nvdaItem.title).toContain('Q2 2027');
    expect(nvdaItem.title).not.toContain('Q2 2020');
    expect(amznItem.title).toContain('Q3 2026');
    expect(amznItem.title).not.toContain('Q1 2017');
  });

  it('Priority 4: evaluateCollectionHealth truthfully explains Convex scheduled collectors vs GitHub Actions test-only workflow', () => {
    const health = evaluateCollectionHealth({
      now: Date.parse('2026-11-12T15:00:00Z'),
      systemEnabled: true,
      activeEnvironment: 'remote',
      dailyCostCeilingGbp: 2,
      monthlyCostCeilingGbp: 20,
      dailyEstimatedCostGbp: 0,
      dailyActualCostGbp: 0,
      monthlyEstimatedCostGbp: 0,
      monthlyActualCostGbp: 0,
      pendingVerificationCount: 0,
      jobs: [],
    });

    const ghaPath = health.executionPaths.find((p) => p.id === 'github_actions_workflow')!;
    expect(ghaPath).toBeDefined();
    // Must not falsely claim it has no remote GitHub origin; must truthfully state it runs CI unit tests only while Convex crons run collection
    expect(ghaPath.detail).not.toContain('until a remote GitHub origin');
    expect(ghaPath.detail).toContain('unit tests');
  });

  it('Priority 3B: selectCurrentSecXbrlFact enforces explicit rules for 8-K rejection, 10-Q/A amendment supersession, 3M vs 9M YTD frame selection, point-in-time cutoffs, and comparative-period rejection', () => {
    const asOfMs = Date.parse('2026-11-12T15:00:00Z');

    // 1. Rejects 8-K non-periodic form rather than misattributing a 10-Q fact
    const eightKResult = selectCurrentSecXbrlFact({
      factsPayload: {
        facts: {
          'us-gaap': {
            Revenues: {
              units: {
                USD: [
                  {
                    val: 30000000000,
                    fy: 2027,
                    fp: 'Q2',
                    form: '10-Q',
                    filed: '2026-08-26',
                    accn: '0001045810-26-000064',
                    end: '2026-07-26',
                  },
                ],
              },
            },
          },
        },
      },
      header: {
        ticker: 'NVDA',
        cik: '1045810',
        name: 'NVIDIA CORP',
        accession: '0001045810-26-000082',
        form: '8-K',
        filed: '2026-11-12',
        docUrl: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000082/nvda-20261111.htm',
        publishedMs: Date.parse('2026-11-12T12:00:00Z'),
      },
      asOfMs,
    });
    expect(eightKResult.eligible).toBe(false);
    expect(eightKResult.rejectionReason).toBe('unsupported_non_periodic_form:8-K');

    // 2. Prefers 3-month quarterly frame (CY2026Q3) over 9-month YTD cumulative span and prefers 10-Q/A amendment over 10-Q
    const amendAndFrameResult = selectCurrentSecXbrlFact({
      factsPayload: {
        facts: {
          'us-gaap': {
            PaymentsToAcquirePropertyPlantAndEquipment: {
              units: {
                USD: [
                  // 9-month YTD cumulative span (no quarterly frame, 273 days)
                  {
                    val: 65000000000,
                    fy: 2026,
                    fp: 'Q3',
                    form: '10-Q',
                    filed: '2026-10-30',
                    accn: '0001018724-26-000040',
                    start: '2026-01-01',
                    end: '2026-09-30',
                  },
                  // Original 3-month single quarter
                  {
                    val: 22620000000,
                    fy: 2026,
                    fp: 'Q3',
                    form: '10-Q',
                    filed: '2026-10-30',
                    accn: '0001018724-26-000040',
                    start: '2026-07-01',
                    end: '2026-09-30',
                    frame: 'CY2026Q3',
                  },
                  // Amended 10-Q/A for the same 3-month quarter
                  {
                    val: 22750000000,
                    fy: 2026,
                    fp: 'Q3',
                    form: '10-Q/A',
                    filed: '2026-11-05',
                    accn: '0001018724-26-000045',
                    start: '2026-07-01',
                    end: '2026-09-30',
                    frame: 'CY2026Q3',
                  },
                ],
              },
            },
          },
        },
      },
      header: {
        ticker: 'AMZN',
        cik: '1018724',
        name: 'AMAZON COM INC',
        accession: '0001018724-26-000045',
        form: '10-Q/A',
        filed: '2026-11-05',
        reportDate: '2026-09-30',
        docUrl: 'https://www.sec.gov/Archives/edgar/data/1018724/000101872426000045/amzn-10qa.htm',
        publishedMs: Date.parse('2026-11-05T16:00:00Z'),
      },
      asOfMs,
    });
    expect(amendAndFrameResult.eligible).toBe(true);
    expect(amendAndFrameResult.isCurrentReportingPeriod).toBe(true);
    expect(amendAndFrameResult.isAmendment).toBe(true);
    expect(amendAndFrameResult.valueBillions).toBe(22.75);
    expect(amendAndFrameResult.periodLabel).toBe('Q3 2026');

    // 3. Rejects historical comparative period when only a 2020 period exists in a 2026 filing
    const staleComparativeOnly = selectCurrentSecXbrlFact({
      factsPayload: {
        facts: {
          'us-gaap': {
            PaymentsToAcquirePropertyPlantAndEquipment: {
              units: {
                USD: [
                  {
                    val: 1070000000,
                    fy: 2020,
                    fp: 'Q2',
                    form: '10-Q',
                    filed: '2026-08-26',
                    accn: '0001045810-26-000064',
                    end: '2020-07-26',
                    frame: 'CY2020Q2',
                  },
                ],
              },
            },
          },
        },
      },
      header: {
        ticker: 'NVDA',
        cik: '1045810',
        name: 'NVIDIA CORP',
        accession: '0001045810-26-000064',
        form: '10-Q',
        filed: '2026-08-26',
        reportDate: '2026-07-26',
        docUrl: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000064/nvda.htm',
        publishedMs: Date.parse('2026-08-26T16:00:00Z'),
      },
      asOfMs,
    });
    expect(staleComparativeOnly.eligible).toBe(false);
    expect(staleComparativeOnly.isCurrentReportingPeriod).toBe(false);

    // 4. Rejects future filing after point-in-time cutoff
    const futureCutoff = selectCurrentSecXbrlFact({
      factsPayload: {},
      header: {
        ticker: 'NVDA',
        cik: '1045810',
        name: 'NVIDIA CORP',
        accession: '0001045810-26-000099',
        form: '10-Q',
        filed: '2026-11-20',
        docUrl: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000099/nvda.htm',
        publishedMs: Date.parse('2026-11-20T16:00:00Z'),
      },
      asOfMs,
    });
    expect(futureCutoff.eligible).toBe(false);
    expect(futureCutoff.pointInTimeEligible).toBe(false);
  });

  it('Phase 3: evaluateCollectionHealth and buildWorkspaceConnectionsReport distinguish unconfigured, disabled, not_tested, attempted, failed, and successful states without relying solely on non-zero cost', () => {
    const now = Date.parse('2026-11-12T15:00:00Z');
    const baseInput = {
      now,
      systemEnabled: true,
      activeEnvironment: 'remote' as const,
      dailyCostCeilingGbp: 2,
      monthlyCostCeilingGbp: 20,
      dailyEstimatedCostGbp: 0,
      dailyActualCostGbp: 0,
      monthlyEstimatedCostGbp: 0,
      monthlyActualCostGbp: 0,
      pendingVerificationCount: 0,
      jobs: [
        {
          jobKey: 'news_discovery_agent',
          intervalMinutes: 15,
          enabled: true,
          pausedReason: null,
          lastSuccessAt: now - 300_000,
          lastRunAt: now - 300_000,
          nextRunAt: now + 600_000,
          sourcesAddedTotal: 4,
          evidenceAddedTotal: 4,
          estimatedCostGbpTotal: 0,
          actualCostGbpTotal: 0,
          lastOutcome: 'succeeded',
          lastErrorCode: null,
        },
      ],
    };

    // 1. Unconfigured: no key, only deterministic runs
    const unconfiguredHealth = evaluateCollectionHealth({
      ...baseInput,
      environmentAudit: [
        {
          serviceId: 'remote_ai_models',
          name: 'Remote AI Model Providers',
          environmentTarget: 'GEMINI_API_KEY',
          status: 'unavailable',
          lastVerifiedAt: null,
          detail: 'Unconfigured',
        },
      ],
    });
    expect(unconfiguredHealth.agentAndProviderStages.providerState).toBe('unconfigured');
    expect(unconfiguredHealth.agentAndProviderStages.providerUnavailable).toBe(true);

    // 2. Disabled: intentionally disabled by owner -> NOT automatically classified as providerUnavailable
    const disabledHealth = evaluateCollectionHealth({
      ...baseInput,
      jobs: [{ ...baseInput.jobs[0]!, enabled: false, pausedReason: 'disabled_by_owner' }],
      environmentAudit: [
        {
          serviceId: 'remote_ai_models',
          name: 'Remote AI Model Providers',
          environmentTarget: 'GEMINI_API_KEY',
          status: 'intentionally_disabled',
          lastVerifiedAt: null,
          detail: 'Intentionally disabled',
        },
      ],
    });
    expect(disabledHealth.agentAndProviderStages.providerState).toBe('disabled');
    expect(disabledHealth.agentAndProviderStages.providerUnavailable).toBe(false);
    expect(disabledHealth.agentAndProviderStages.modelInferenceSucceeded).toBe(false);

    // 3. Configured, not tested: key present, 0 model runs -> NOT automatically classified as providerUnavailable
    const notTestedHealth = evaluateCollectionHealth({
      ...baseInput,
      environmentAudit: [
        {
          serviceId: 'remote_ai_models',
          name: 'Remote AI Model Providers',
          environmentTarget: 'GEMINI_API_KEY',
          status: 'configured_not_tested',
          lastVerifiedAt: null,
          detail: 'Key present, 0 background calls',
        },
      ],
    });
    expect(notTestedHealth.agentAndProviderStages.providerState).toBe('not_tested');
    expect(notTestedHealth.agentAndProviderStages.providerUnavailable).toBe(false);
    expect(notTestedHealth.agentAndProviderStages.modelInferenceAttempted).toBe(false);

    // 4. Attempted: real model run in progress (even with £0.00 cost so far)
    const attemptedHealth = evaluateCollectionHealth({
      ...baseInput,
      recentRuns: [
        {
          runId: 'run-attempt-1',
          jobKey: 'news_discovery_agent',
          category: 'remote_agent',
          environment: 'remote',
          status: 'running',
          startedAt: now - 5_000,
          finishedAt: null,
          cursorBefore: null,
          cursorAfter: null,
          sourcesDiscovered: 1,
          evidenceStaged: 0,
          evidencePromoted: 0,
          duplicatesSkipped: 0,
          pendingVerification: 0,
          modelVersion: 'gemini-2.5-flash',
          estimatedCostGbp: 0,
          actualCostGbp: null,
          providerRequestsCount: 1,
          processingDurationMs: null,
          conditionalSkip: false,
          errorCode: null,
          summary: 'Invoking Gemini 2.5 Flash...',
        },
      ],
    });
    expect(attemptedHealth.agentAndProviderStages.providerState).toBe('attempted');
    expect(attemptedHealth.agentAndProviderStages.modelInferenceAttempted).toBe(true);
    expect(attemptedHealth.agentAndProviderStages.modelInferenceSucceeded).toBe(false);
    expect(attemptedHealth.agentAndProviderStages.providerUnavailable).toBe(false);

    // 5. Failed: real model invocation attempted and failed with quota/402 error (with £0.00 cost)
    const failedHealth = evaluateCollectionHealth({
      ...baseInput,
      recentRuns: [
        {
          runId: 'run-failed-1',
          jobKey: 'news_discovery_agent',
          category: 'remote_agent',
          environment: 'remote',
          status: 'failed',
          startedAt: now - 10_000,
          finishedAt: now - 9_000,
          cursorBefore: null,
          cursorAfter: null,
          sourcesDiscovered: 0,
          evidenceStaged: 0,
          evidencePromoted: 0,
          duplicatesSkipped: 0,
          pendingVerification: 0,
          modelVersion: 'gemini-2.5-flash',
          estimatedCostGbp: 0,
          actualCostGbp: 0,
          providerRequestsCount: 1,
          processingDurationMs: 1000,
          conditionalSkip: false,
          errorCode: 'http_402_quota_exceeded',
          summary: 'Gemini API returned 402 quota exceeded',
        },
      ],
    });
    expect(failedHealth.agentAndProviderStages.providerState).toBe('failed');
    expect(failedHealth.agentAndProviderStages.modelInferenceAttempted).toBe(true);
    expect(failedHealth.agentAndProviderStages.modelInferenceSucceeded).toBe(false);
    expect(failedHealth.agentAndProviderStages.providerUnavailable).toBe(true);

    // 6. Successful: real model invocation succeeded on free tier (£0.00 cost, real modelVersion + providerRequestsCount > 0)
    const successfulZeroCostHealth = evaluateCollectionHealth({
      ...baseInput,
      recentRuns: [
        {
          runId: 'run-success-free-tier',
          jobKey: 'news_discovery_agent',
          category: 'remote_agent',
          environment: 'remote',
          status: 'succeeded',
          startedAt: now - 10_000,
          finishedAt: now - 8_000,
          cursorBefore: 'c1',
          cursorAfter: 'c2',
          sourcesDiscovered: 2,
          evidenceStaged: 2,
          evidencePromoted: 2,
          duplicatesSkipped: 0,
          pendingVerification: 0,
          modelVersion: 'gemini-2.5-flash',
          estimatedCostGbp: 0,
          actualCostGbp: 0,
          providerRequestsCount: 2,
          processingDurationMs: 2000,
          conditionalSkip: false,
          errorCode: null,
          summary: 'Gemini 2.5 Flash extracted 2 disclosures',
        },
      ],
    });
    expect(successfulZeroCostHealth.agentAndProviderStages.providerState).toBe('successful');
    expect(successfulZeroCostHealth.agentAndProviderStages.modelInferenceAttempted).toBe(true);
    expect(successfulZeroCostHealth.agentAndProviderStages.modelInferenceSucceeded).toBe(true);
    expect(successfulZeroCostHealth.agentAndProviderStages.providerUnavailable).toBe(false);
  });

  it('Phase 4: selectCurrentSecXbrlFact supports negative losses/cash flows, zero-value facts, instant vs duration concepts, 3M/YTD/FY spans, non-calendar fiscal years, publication & receipt cutoffs, and duplicate/conflict detection', () => {
    const asOfMs = Date.parse('2026-11-12T15:00:00Z');
    const baseHeader = {
      ticker: 'GOOGL',
      cik: '1652044',
      name: 'ALPHABET INC.',
      accession: '0001652044-26-000050',
      form: '10-Q',
      filed: '2026-10-28',
      reportDate: '2026-09-30',
      docUrl: 'https://www.sec.gov/Archives/edgar/data/1652044/goog-20260930.htm',
      publishedMs: Date.parse('2026-10-28T20:00:00Z'),
      receivedMs: Date.parse('2026-10-28T20:05:00Z'),
    };

    // 1. Negative operating loss / negative cash flow fact is accepted when concept allows negative values
    const negativeLossResult = selectCurrentSecXbrlFact({
      factsPayload: {
        facts: {
          'us-gaap': {
            OperatingIncomeLoss: {
              units: {
                USD: [
                  {
                    val: -3450000000,
                    fy: 2026,
                    fp: 'Q3',
                    form: '10-Q',
                    filed: '2026-10-28',
                    accn: '0001652044-26-000050',
                    start: '2026-07-01',
                    end: '2026-09-30',
                    frame: 'CY2026Q3',
                  },
                ],
              },
            },
          },
        },
      },
      header: baseHeader,
      asOfMs,
      preferredConceptName: 'OperatingIncomeLoss',
    });
    expect(negativeLossResult.eligible).toBe(true);
    expect(negativeLossResult.isNegativeValue).toBe(true);
    expect(negativeLossResult.val).toBe(-3450000000);
    expect(negativeLossResult.valueBillions).toBe(-3.45);
    expect(negativeLossResult.periodSpanKind).toBe('three_month');

    // 2. Zero-value fact (`val === 0`) is accepted as a valid reported numerical fact
    const zeroValueResult = selectCurrentSecXbrlFact({
      factsPayload: {
        facts: {
          'us-gaap': {
            CapitalExpendituresIncurredButNotYetPaid: {
              units: {
                USD: [
                  {
                    val: 0,
                    fy: 2026,
                    fp: 'Q3',
                    form: '10-Q',
                    filed: '2026-10-28',
                    accn: '0001652044-26-000050',
                    start: '2026-07-01',
                    end: '2026-09-30',
                    frame: 'CY2026Q3',
                  },
                ],
              },
            },
          },
        },
      },
      header: baseHeader,
      asOfMs,
    });
    expect(zeroValueResult.eligible).toBe(true);
    expect(zeroValueResult.isZeroValue).toBe(true);
    expect(zeroValueResult.val).toBe(0);
    expect(zeroValueResult.valueBillions).toBe(0);

    // 3. Instant concept (balance sheet cash or shares outstanding with `end` only and no `start`)
    const instantBalanceResult = selectCurrentSecXbrlFact({
      factsPayload: {
        facts: {
          'us-gaap': {
            CashAndCashEquivalentsAtCarryingValue: {
              units: {
                USD: [
                  {
                    val: 93200000000,
                    fy: 2026,
                    fp: 'Q3',
                    form: '10-Q',
                    filed: '2026-10-28',
                    accn: '0001652044-26-000050',
                    end: '2026-09-30',
                    frame: 'CY2026Q3I',
                  },
                ],
              },
            },
          },
        },
      },
      header: baseHeader,
      asOfMs,
      preferredConceptName: 'CashAndCashEquivalentsAtCarryingValue',
    });
    expect(instantBalanceResult.eligible).toBe(true);
    expect(instantBalanceResult.conceptTiming).toBe('instant');
    expect(instantBalanceResult.periodSpanKind).toBe('instant');
    expect(instantBalanceResult.valueBillions).toBe(93.2);

    // 4. Receipt timestamp cutoff: rejects if `receivedMs > asOfMs` even when `publishedMs <= asOfMs`
    const receiptAfterAsOf = selectCurrentSecXbrlFact({
      factsPayload: {
        facts: {
          'us-gaap': {
            Revenues: {
              units: {
                USD: [
                  {
                    val: 88000000000,
                    fy: 2026,
                    fp: 'Q3',
                    form: '10-Q',
                    filed: '2026-10-28',
                    accn: '0001652044-26-000050',
                    start: '2026-07-01',
                    end: '2026-09-30',
                    frame: 'CY2026Q3',
                  },
                ],
              },
            },
          },
        },
      },
      header: {
        ...baseHeader,
        receivedMs: asOfMs + 60_000,
      },
      asOfMs,
    });
    expect(receiptAfterAsOf.eligible).toBe(false);
    expect(receiptAfterAsOf.pointInTimeEligible).toBe(false);
    expect(receiptAfterAsOf.rejectionReason).toContain('receipt_after_point_in_time_cutoff');

    // 5. Exact duplicates are deduplicated cleanly; conflicting values for the same period/frame/accession are rejected
    const exactDuplicateResult = selectCurrentSecXbrlFact({
      factsPayload: {
        facts: {
          'us-gaap': {
            Revenues: {
              units: {
                USD: [
                  {
                    val: 88268000000,
                    fy: 2026,
                    fp: 'Q3',
                    form: '10-Q',
                    filed: '2026-10-28',
                    accn: '0001652044-26-000050',
                    start: '2026-07-01',
                    end: '2026-09-30',
                    frame: 'CY2026Q3',
                  },
                  {
                    val: 88268000000,
                    fy: 2026,
                    fp: 'Q3',
                    form: '10-Q',
                    filed: '2026-10-28',
                    accn: '0001652044-26-000050',
                    start: '2026-07-01',
                    end: '2026-09-30',
                    frame: 'CY2026Q3',
                  },
                ],
              },
            },
          },
        },
      },
      header: baseHeader,
      asOfMs,
    });
    expect(exactDuplicateResult.eligible).toBe(true);
    expect(exactDuplicateResult.deduplicatedExactDuplicatesCount).toBe(1);
    expect(exactDuplicateResult.hasConflictingDuplicate).toBe(false);

    const conflictingDuplicateResult = selectCurrentSecXbrlFact({
      factsPayload: {
        facts: {
          'us-gaap': {
            Revenues: {
              units: {
                USD: [
                  {
                    val: 88268000000,
                    fy: 2026,
                    fp: 'Q3',
                    form: '10-Q',
                    filed: '2026-10-28',
                    accn: '0001652044-26-000050',
                    start: '2026-07-01',
                    end: '2026-09-30',
                    frame: 'CY2026Q3',
                  },
                  {
                    val: 91500000000,
                    fy: 2026,
                    fp: 'Q3',
                    form: '10-Q',
                    filed: '2026-10-28',
                    accn: '0001652044-26-000050',
                    start: '2026-07-01',
                    end: '2026-09-30',
                    frame: 'CY2026Q3',
                  },
                ],
              },
            },
          },
        },
      },
      header: baseHeader,
      asOfMs,
    });
    expect(conflictingDuplicateResult.eligible).toBe(false);
    expect(conflictingDuplicateResult.hasConflictingDuplicate).toBe(true);
    expect(conflictingDuplicateResult.rejectionReason).toContain(
      'conflicting_duplicate_facts_for_same_period',
    );
  });

  it('Phase 5: Homepage / CommandCentre renders recent 2026-11-11 market observation with PR #1 reduced public telemetry payload (latestBriefing: null) without implying 2026-11-04 fundamentals are equally current', () => {
    const now = Date.parse('2026-11-12T15:00:00Z');
    const baseFeed = researchFeed();
    const updatedWatchlist = baseFeed.watchlist.map((w) =>
      w.ticker === 'QQQ'
        ? {
            ...w,
            close: 690.38,
            closeGbp: 534.7,
            usdToGbp: 0.7745,
            closeAt: Date.parse('2026-11-11T21:00:00Z'),
          }
        : w.ticker === 'NVDA'
          ? {
              ...w,
              close: 195.88,
              closeGbp: 151.71,
              usdToGbp: 0.7745,
              closeAt: Date.parse('2026-11-11T21:00:00Z'),
            }
          : w,
    );

    // Simulate PR #1's `toPublicOperationsStatus` where `latestBriefing` is `null` and `briefing.generatedAt` lives in `health.operationalLayers.briefing.generatedAt`
    const publicHealth = evaluateCollectionHealth({
      now,
      systemEnabled: true,
      activeEnvironment: 'remote',
      dailyCostCeilingGbp: 0,
      monthlyCostCeilingGbp: 0,
      dailyEstimatedCostGbp: 0,
      dailyActualCostGbp: 0,
      monthlyEstimatedCostGbp: 0,
      monthlyActualCostGbp: 0,
      pendingVerificationCount: 0,
      latestBriefingDate: '2026-11-12',
      latestBriefingGeneratedAt: Date.parse('2026-11-12T07:30:16.435Z'),
      jobs: [],
    });

    const html = renderToStaticMarkup(
      React.createElement(CommandCentre, {
        portfolio: null,
        trading: null,
        operations: {
          health: publicHealth,
          latestBriefing: null, // PR #1 publicOperationsOverview returns null here
        },
        feed: {
          ...baseFeed,
          watchlist: updatedWatchlist,
          marketDataAsOf: Date.parse('2026-11-11T21:00:00Z'),
          agentOperations: publicHealth,
        },
        flags: { demo: false, live: false },
        now,
        signedIn: false,
        configured: true,
      }),
    );

    // Renders the recent 2026-11-11 market observation ($690.38)
    expect(html).toContain('Research as of 2026-11-11');
    expect(html).toContain('$690.38');
    // Explicitly discloses that fundamental SEC/TypeDB tables remain anchored to 2026-11-04
    expect(html).toContain('Market price observations are as of 2026-11-11');
    expect(html).toContain('anchored to the 2026-11-04 verified filing cut-off');
    // Includes the morning briefing generation timestamp from `health.operationalLayers.briefing.generatedAt` even when `latestBriefing` is null
    expect(html).toContain('2026-11-12 07:30:16 UTC');
  });

  it('Phase 4B: Source-backed point-in-time SEC XBRL validation against actual repository-stored primary EDGAR filings (non-calendar fiscal years, comparative rows, 3M vs YTD vs 12M durations, negative losses/cash flows, instant facts, amended 10-K/A vs 8-K/A, and receipt-time cutoffs)', () => {
    const asOfNov12Ms = Date.parse('2026-11-12T15:00:00Z');
    const rawCompanies = secXbrlExpansionRaw.companies;
    const toRawUnits = (
      rows: Array<{
        rawVal: number;
        fy?: number | null;
        fp?: string | null;
        form?: string;
        filed?: string;
        accn?: string;
        frame?: string | null;
        start?: string | null;
        end?: string;
      }>,
    ) =>
      rows.map((r) => ({
        val: r.rawVal,
        fy: r.fy ?? undefined,
        fp: r.fp ?? undefined,
        form: r.form,
        filed: r.filed,
        accn: r.accn,
        frame: r.frame ?? undefined,
        start: r.start ?? undefined,
        end: r.end,
      }));

    // 1. Non-calendar fiscal calendars & comparative-period / YTD rejection using actual stored NVDA (FY27 Q2 ended 2026-07-26) & MSFT (FY27 Q1 ended 2026-09-30) EDGAR facts
    const nvdaStored = rawCompanies.NVDA;
    const nvdaResult = selectCurrentSecXbrlFact({
      factsPayload: {
        cik: nvdaStored.cik,
        entityName: nvdaStored.entityName,
        facts: {
          'us-gaap': {
            Revenues: {
              units: {
                USD: [
                  ...toRawUnits(nvdaStored.rawXbrlFacts.quarterlyRevenues),
                  ...toRawUnits(nvdaStored.rawXbrlFacts.ytdRevenues),
                ],
              },
            },
          },
        },
      },
      header: {
        ticker: nvdaStored.ticker,
        cik: nvdaStored.cik,
        name: nvdaStored.entityName,
        accession: nvdaStored.latestFiling.accessionNumber, // 0001045810-26-000075
        form: nvdaStored.latestFiling.form, // 10-Q
        filed: nvdaStored.latestFiling.filingDate, // 2026-08-26
        reportDate: nvdaStored.latestFiling.reportDate, // 2026-07-26
        acceptanceDateTime: nvdaStored.latestFiling.acceptanceDateTime,
        docUrl: nvdaStored.latestFiling.docUrl,
        publishedMs: nvdaStored.latestFiling.publishedAtMs,
        receivedMs: nvdaStored.receivedAtMs,
      },
      asOfMs: asOfNov12Ms,
    });

    // Must select current 3M quarter ($96,221,000,000 for 2026-04-27..2026-07-26, FY2027 Q2 / CY2026Q2)
    // and reject both comparative prior-year Q2 ($46,743,000,000 ended 2025-07-27) and 6M YTD ($177,837,000,000) in the same filing
    expect(nvdaResult.eligible).toBe(true);
    expect(nvdaResult.accession).toBe('0001045810-26-000075');
    expect(nvdaResult.form).toBe('10-Q');
    expect(nvdaResult.fiscalYear).toBe(2027);
    expect(nvdaResult.fiscalPeriod).toBe('Q2');
    expect(nvdaResult.reportingFrame).toBe('CY2026Q2');
    expect(nvdaResult.periodStart).toBe('2026-04-27');
    expect(nvdaResult.periodEnd).toBe('2026-07-26');
    expect(nvdaResult.periodSpanKind).toBe('three_month');
    expect(nvdaResult.val).toBe(96_221_000_000);
    expect(nvdaResult.valueBillions).toBe(96.22);

    const msftStored = rawCompanies.MSFT;
    const msftResult = selectCurrentSecXbrlFact({
      factsPayload: {
        cik: msftStored.cik,
        entityName: msftStored.entityName,
        facts: {
          'us-gaap': {
            RevenueFromContractWithCustomerExcludingAssessedTax: {
              units: {
                USD: [
                  ...toRawUnits(msftStored.rawXbrlFacts.quarterlyRevenues),
                  ...toRawUnits(msftStored.rawXbrlFacts.ytdRevenues),
                ],
              },
            },
          },
        },
      },
      header: {
        ticker: msftStored.ticker,
        cik: msftStored.cik,
        name: msftStored.entityName,
        accession: msftStored.latestFiling.accessionNumber, // 0001193125-26-436133
        form: msftStored.latestFiling.form, // 10-Q
        filed: msftStored.latestFiling.filingDate, // 2026-10-28
        reportDate: msftStored.latestFiling.reportDate, // 2026-09-30
        acceptanceDateTime: msftStored.latestFiling.acceptanceDateTime,
        docUrl: msftStored.latestFiling.docUrl,
        publishedMs: msftStored.latestFiling.publishedAtMs,
        receivedMs: msftStored.receivedAtMs,
      },
      asOfMs: asOfNov12Ms,
    });
    expect(msftResult.eligible).toBe(true);
    expect(msftResult.accession).toBe('0001193125-26-436133');
    expect(msftResult.fiscalYear).toBe(2027);
    expect(msftResult.fiscalPeriod).toBe('Q1');
    expect(msftResult.reportingFrame).toBe('CY2026Q3');
    expect(msftResult.periodStart).toBe('2026-07-01');
    expect(msftResult.periodEnd).toBe('2026-09-30');
    expect(msftResult.val).toBe(92_279_000_000);
    expect(msftResult.valueBillions).toBe(92.28);

    // 2. Negative operating loss, negative net loss, and negative cash flows from actual stored CRWV (0001769628-26-000366) & INTC (0000050863-26-000157) filings
    const crwvStored = rawCompanies.CRWV;
    const crwvNetLossResult = selectCurrentSecXbrlFact({
      factsPayload: {
        cik: crwvStored.cik,
        entityName: crwvStored.entityName,
        facts: {
          'us-gaap': {
            NetIncomeLoss: {
              units: {
                USD: toRawUnits(crwvStored.rawXbrlFacts.quarterlyNetIncome),
              },
            },
          },
        },
      },
      header: {
        ticker: crwvStored.ticker,
        cik: crwvStored.cik,
        name: crwvStored.entityName,
        accession: crwvStored.latestFiling.accessionNumber, // 0001769628-26-000366
        form: crwvStored.latestFiling.form, // 10-Q
        filed: crwvStored.latestFiling.filingDate, // 2026-08-12
        reportDate: crwvStored.latestFiling.reportDate, // 2026-06-30
        acceptanceDateTime: crwvStored.latestFiling.acceptanceDateTime,
        docUrl: crwvStored.latestFiling.docUrl,
        publishedMs: crwvStored.latestFiling.publishedAtMs,
        receivedMs: crwvStored.receivedAtMs,
      },
      asOfMs: asOfNov12Ms,
      preferredConceptName: 'NetIncomeLoss',
    });
    // Selects current Q2 2026 net loss (-$626,000,000 ended 2026-06-30) and rejects comparative Q1 net loss (-$740,000,000 ended 2026-03-31) in the same filing
    expect(crwvNetLossResult.eligible).toBe(true);
    expect(crwvNetLossResult.accession).toBe('0001769628-26-000366');
    expect(crwvNetLossResult.isNegativeValue).toBe(true);
    expect(crwvNetLossResult.periodStart).toBe('2026-04-01');
    expect(crwvNetLossResult.periodEnd).toBe('2026-06-30');
    expect(crwvNetLossResult.val).toBe(-626_000_000);
    expect(crwvNetLossResult.valueBillions).toBe(-0.63);

    const intcStored = rawCompanies.INTC;
    const intcQ2Filing = intcStored.filingsHistory.find(
      (f) => f.accessionNumber === '0000050863-26-000157',
    )!;
    const intcNetLossResult = selectCurrentSecXbrlFact({
      factsPayload: {
        cik: intcStored.cik,
        entityName: intcStored.entityName,
        facts: {
          'us-gaap': {
            NetIncomeLoss: {
              units: {
                USD: toRawUnits(intcStored.rawXbrlFacts.quarterlyNetIncome),
              },
            },
          },
        },
      },
      header: {
        ticker: intcStored.ticker,
        cik: intcStored.cik,
        name: intcStored.entityName,
        accession: intcQ2Filing.accessionNumber, // 0000050863-26-000157
        form: intcQ2Filing.form, // 10-Q
        filed: intcQ2Filing.filingDate, // 2026-07-24
        reportDate: intcQ2Filing.reportDate, // 2026-06-27
        acceptanceDateTime: intcQ2Filing.acceptanceDateTime,
        docUrl: intcQ2Filing.docUrl,
        publishedMs: intcQ2Filing.publishedAtMs,
        receivedMs: intcStored.receivedAtMs,
      },
      asOfMs: asOfNov12Ms,
      preferredConceptName: 'NetIncomeLoss',
    });
    expect(intcNetLossResult.eligible).toBe(true);
    expect(intcNetLossResult.accession).toBe('0000050863-26-000157');
    expect(intcNetLossResult.isNegativeValue).toBe(true);
    expect(intcNetLossResult.periodEnd).toBe('2026-06-27');
    expect(intcNetLossResult.val).toBe(-11_033_000_000);
    expect(intcNetLossResult.valueBillions).toBe(-11.03);

    // Also verify negative Free Cash Flow in the normalised SEC XBRL expansion package for GOOGL (-$9,065M Q3) and AMZN (-$33,456M Q3 / -$42,357M TTM)
    const expPkg = getSecXbrlExpansionPackage();
    expect(
      expPkg.companies.GOOGL.normalisedFinancialValues.quarterlySeries.at(-1)
        ?.freeCashFlowUsdMillions,
    ).toBe(-9065);
    expect(
      expPkg.companies.AMZN.normalisedFinancialValues.quarterlySeries.at(-1)
        ?.freeCashFlowUsdMillions,
    ).toBe(-33456);
    expect(
      expPkg.companies.AMZN.normalisedFinancialValues.trailingTwelveMonths
        .freeCashFlowUsdMillions,
    ).toBe(-42357);

    // 3. Duration values (3M vs 9M YTD vs 12M FY) from stored GOOGL (0001652044-26-000084) & AMD (0000002488-26-000018)
    const googlStored = rawCompanies.GOOGL;
    const googlFactsPayload = {
      cik: googlStored.cik,
      entityName: googlStored.entityName,
      facts: {
        'us-gaap': {
          Revenues: {
            units: {
              USD: [
                ...toRawUnits(googlStored.rawXbrlFacts.quarterlyRevenues),
                ...toRawUnits(googlStored.rawXbrlFacts.ytdRevenues),
              ],
            },
          },
        },
      },
    };
    const googlHeader = {
      ticker: googlStored.ticker,
      cik: googlStored.cik,
      name: googlStored.entityName,
      accession: googlStored.latestFiling.accessionNumber, // 0001652044-26-000084
      form: googlStored.latestFiling.form, // 10-Q
      filed: googlStored.latestFiling.filingDate, // 2026-10-29
      reportDate: googlStored.latestFiling.reportDate, // 2026-09-30
      acceptanceDateTime: googlStored.latestFiling.acceptanceDateTime,
      docUrl: googlStored.latestFiling.docUrl,
      publishedMs: googlStored.latestFiling.publishedAtMs,
      receivedMs: googlStored.receivedAtMs,
    };

    const googl3M = selectCurrentSecXbrlFact({
      factsPayload: googlFactsPayload,
      header: googlHeader,
      asOfMs: asOfNov12Ms,
    });
    expect(googl3M.eligible).toBe(true);
    expect(googl3M.periodSpanKind).toBe('three_month');
    expect(googl3M.periodStart).toBe('2026-07-01');
    expect(googl3M.periodEnd).toBe('2026-09-30');
    expect(googl3M.val).toBe(127_577_000_000);
    expect(googl3M.valueBillions).toBe(127.58);

    const googl9MYtd = selectCurrentSecXbrlFact({
      factsPayload: googlFactsPayload,
      header: googlHeader,
      asOfMs: asOfNov12Ms,
      preferredSpan: 'cumulative_ytd',
    });
    expect(googl9MYtd.eligible).toBe(true);
    expect(googl9MYtd.periodSpanKind).toBe('cumulative_ytd');
    expect(googl9MYtd.periodStart).toBe('2026-01-01');
    expect(googl9MYtd.periodEnd).toBe('2026-09-30');
    expect(googl9MYtd.val).toBe(357_269_000_000);
    expect(googl9MYtd.valueBillions).toBe(357.27);

    const amdStored = rawCompanies.AMD;
    const amd10kFiling = amdStored.filingsHistory.find(
      (f) => f.accessionNumber === '0000002488-26-000018',
    )!;
    const amd12M = selectCurrentSecXbrlFact({
      factsPayload: {
        cik: amdStored.cik,
        entityName: amdStored.entityName,
        facts: {
          'us-gaap': {
            RevenueFromContractWithCustomerExcludingAssessedTax: {
              units: {
                USD: toRawUnits(amdStored.rawXbrlFacts.annualRevenues),
              },
            },
          },
        },
      },
      header: {
        ticker: amdStored.ticker,
        cik: amdStored.cik,
        name: amdStored.entityName,
        accession: amd10kFiling.accessionNumber, // 0000002488-26-000018
        form: amd10kFiling.form, // 10-K
        filed: amd10kFiling.filingDate, // 2026-02-04
        reportDate: amd10kFiling.reportDate, // 2025-12-27
        acceptanceDateTime: amd10kFiling.acceptanceDateTime,
        docUrl: amd10kFiling.docUrl,
        publishedMs: amd10kFiling.publishedAtMs,
        receivedMs: amdStored.receivedAtMs,
      },
      asOfMs: asOfNov12Ms,
    });
    // Selects FY2025 ($34,639,000,000 ended 2025-12-27) and rejects comparative FY2024 ($25,785,000,000 ended 2024-12-28) in the same 10-K
    expect(amd12M.eligible).toBe(true);
    expect(amd12M.periodSpanKind).toBe('full_year');
    expect(amd12M.periodStart).toBe('2024-12-29');
    expect(amd12M.periodEnd).toBe('2025-12-27');
    expect(amd12M.val).toBe(34_639_000_000);
    expect(amd12M.valueBillions).toBe(34.64);

    // 4. Amended filings: AMD stored 10-K/A (0000002488-26-000021) vs 10-K (0000002488-26-000018) and MSFT stored 8-K/A (0001193125-24-062997) rejection
    const amd10kAmendment = amdStored.restatementsAndAmendments.find(
      (r) => r.accessionNumber === '0000002488-26-000021',
    )!;
    const amdAmendedFact = {
      ...amdStored.rawXbrlFacts.annualRevenues[0]!,
      accn: amd10kAmendment.accessionNumber,
      form: amd10kAmendment.form,
      filed: amd10kAmendment.filingDate,
    };
    const amdAmendmentResult = selectCurrentSecXbrlFact({
      factsPayload: {
        cik: amdStored.cik,
        entityName: amdStored.entityName,
        facts: {
          'us-gaap': {
            RevenueFromContractWithCustomerExcludingAssessedTax: {
              units: {
                USD: toRawUnits([
                  amdStored.rawXbrlFacts.annualRevenues[0]!,
                  amdAmendedFact,
                ]),
              },
            },
          },
        },
      },
      header: {
        ticker: amdStored.ticker,
        cik: amdStored.cik,
        name: amdStored.entityName,
        accession: amd10kAmendment.accessionNumber, // 0000002488-26-000021
        form: amd10kAmendment.form, // 10-K/A
        filed: amd10kAmendment.filingDate, // 2026-02-04
        reportDate: amd10kAmendment.reportDate, // 2025-12-27
        acceptanceDateTime: amd10kAmendment.acceptanceDateTime,
        docUrl: amd10kAmendment.docUrl,
        publishedMs: amd10kAmendment.publishedAtMs,
        receivedMs: amdStored.receivedAtMs,
      },
      asOfMs: asOfNov12Ms,
    });
    expect(amdAmendmentResult.eligible).toBe(true);
    expect(amdAmendmentResult.isAmendment).toBe(true);
    expect(amdAmendmentResult.form).toBe('10-K/A');
    expect(amdAmendmentResult.accession).toBe('0000002488-26-000021');

    const msft8kAmendment = msftStored.restatementsAndAmendments[0]!; // 8-K/A 0001193125-24-062997
    const msft8kRejected = selectCurrentSecXbrlFact({
      factsPayload: {},
      header: {
        ticker: msftStored.ticker,
        cik: msftStored.cik,
        name: msftStored.entityName,
        accession: msft8kAmendment.accessionNumber,
        form: msft8kAmendment.form, // 8-K/A
        filed: msft8kAmendment.filingDate,
        reportDate: msft8kAmendment.reportDate,
        acceptanceDateTime: msft8kAmendment.acceptanceDateTime,
        docUrl: msft8kAmendment.docUrl,
        publishedMs: msft8kAmendment.publishedAtMs,
      },
      asOfMs: asOfNov12Ms,
    });
    expect(msft8kRejected.eligible).toBe(false);
    expect(msft8kRejected.rejectionReason).toBe('unsupported_non_periodic_form:8-K/A');

    // 5. Instant values (balance sheet cash and common shares outstanding) from stored AMZN (0001018724-26-000040)
    const amznStored = rawCompanies.AMZN;
    const amznHeader = {
      ticker: amznStored.ticker,
      cik: amznStored.cik,
      name: amznStored.entityName,
      accession: amznStored.latestFiling.accessionNumber, // 0001018724-26-000040
      form: amznStored.latestFiling.form, // 10-Q
      filed: amznStored.latestFiling.filingDate, // 2026-10-30
      reportDate: amznStored.latestFiling.reportDate, // 2026-09-30
      acceptanceDateTime: amznStored.latestFiling.acceptanceDateTime,
      docUrl: amznStored.latestFiling.docUrl,
      publishedMs: amznStored.latestFiling.publishedAtMs,
      receivedMs: amznStored.receivedAtMs,
    };
    const amznCashInstant = selectCurrentSecXbrlFact({
      factsPayload: {
        cik: amznStored.cik,
        entityName: amznStored.entityName,
        facts: {
          'us-gaap': {
            CashAndCashEquivalentsAtCarryingValue: {
              units: {
                USD: toRawUnits(amznStored.rawXbrlFacts.cashInstant),
              },
            },
          },
        },
      },
      header: amznHeader,
      asOfMs: asOfNov12Ms,
      preferredConceptName: 'CashAndCashEquivalentsAtCarryingValue',
    });
    expect(amznCashInstant.eligible).toBe(true);
    expect(amznCashInstant.conceptTiming).toBe('instant');
    expect(amznCashInstant.periodSpanKind).toBe('instant');
    expect(amznCashInstant.unit).toBe('USD');
    expect(amznCashInstant.periodEnd).toBe('2026-09-30');
    expect(amznCashInstant.val).toBe(55_783_000_000);
    expect(amznCashInstant.valueBillions).toBe(55.78);

    const amznSharesInstant = selectCurrentSecXbrlFact({
      factsPayload: {
        cik: amznStored.cik,
        entityName: amznStored.entityName,
        facts: {
          'us-gaap': {
            CommonStockSharesOutstanding: {
              units: {
                shares: toRawUnits(
                  amznStored.rawXbrlFacts.commonSharesOutstandingInstant,
                ),
              },
            },
          },
        },
      },
      header: amznHeader,
      asOfMs: asOfNov12Ms,
      preferredConceptName: 'CommonStockSharesOutstanding',
    });
    expect(amznSharesInstant.eligible).toBe(true);
    expect(amznSharesInstant.conceptTiming).toBe('instant');
    expect(amznSharesInstant.periodSpanKind).toBe('instant');
    expect(amznSharesInstant.unit).toBe('shares');
    expect(amznSharesInstant.periodEnd).toBe('2026-09-30');
    expect(amznSharesInstant.val).toBe(10_811_000_000);

    // 6. Point-in-time publication (`publishedAtMs`) and server receipt (`receivedAtMs`) cutoff consistency using AMD Q3 10-Q (accepted 2026-11-03T23:00:17.000Z, received 2026-11-09T19:48:35.472Z)
    const beforeAmdQ3PublicationMs = Date.parse('2026-11-01T12:00:00Z');
    const amdPointInTimeBeforeQ3 = getSecXbrlCompanyRecord('AMD', {
      asOfMs: beforeAmdQ3PublicationMs,
    });
    expect(amdPointInTimeBeforeQ3.latestFilingEligibleAtCutoff).toBe(false);
    expect(amdPointInTimeBeforeQ3.eligibleQuarters.at(-1)?.accessionNumber).toBe(
      '0000002488-26-000123', // Q2 2026 10-Q accepted 2026-08-04T21:40:01.000Z
    );

    const betweenPublicationAndReceiptMs = Date.parse('2026-11-05T12:00:00Z');
    const amdReceiptGated = selectCurrentSecXbrlFact({
      factsPayload: {
        cik: amdStored.cik,
        entityName: amdStored.entityName,
        facts: {
          'us-gaap': {
            RevenueFromContractWithCustomerExcludingAssessedTax: {
              units: {
                USD: toRawUnits(amdStored.rawXbrlFacts.quarterlyRevenues),
              },
            },
          },
        },
      },
      header: {
        ticker: amdStored.ticker,
        cik: amdStored.cik,
        name: amdStored.entityName,
        accession: amdStored.latestFiling.accessionNumber, // 0000002488-26-000191
        form: amdStored.latestFiling.form,
        filed: amdStored.latestFiling.filingDate, // 2026-11-04
        reportDate: amdStored.latestFiling.reportDate, // 2026-09-26
        acceptanceDateTime: amdStored.latestFiling.acceptanceDateTime, // 2026-11-03T23:00:17.000Z
        docUrl: amdStored.latestFiling.docUrl,
        publishedMs: amdStored.latestFiling.publishedAtMs, // 1793746817000
        receivedMs: amdStored.receivedAtMs, // 1794253715476 (2026-11-09T19:48:35.472Z)
      },
      asOfMs: betweenPublicationAndReceiptMs,
    });
    expect(amdReceiptGated.eligible).toBe(false);
    expect(amdReceiptGated.pointInTimeEligible).toBe(false);
    expect(amdReceiptGated.rejectionReason).toContain(
      'receipt_after_point_in_time_cutoff',
    );
  });

  it('Phase 5B: Combined application verification — enforces all 8 release-gate invariants across public telemetry, stale/discontinuous market observations, deterministic vs Gemini labelling, and NOT IMPLEMENTED capabilities', () => {
    const now = Date.parse('2026-11-12T15:00:00Z');
    const baseFeed = researchFeed();

    // Watchlist with 2026-11-11 persisted prices (discontinuous vs 2026-11-04 historical fundamental series)
    const discontinuousWatchlist = baseFeed.watchlist.map((w) =>
      w.ticker === 'QQQ'
        ? {
            ...w,
            close: 690.38,
            closeGbp: 534.7,
            usdToGbp: 0.7745,
            closeAt: Date.parse('2026-11-11T21:00:00Z'),
            change1d: null,
          }
        : w.ticker === 'NVDA'
          ? {
              ...w,
              close: 195.88,
              closeGbp: 151.71,
              usdToGbp: 0.7745,
              closeAt: Date.parse('2026-11-11T21:00:00Z'),
              change1d: null,
            }
          : w,
    );

    const assessments = evaluateUniverseResearchAssessments({
      asOfMs: now,
      liveWatchlist: discontinuousWatchlist,
    });
    const nvdaAssessment = assessments.find((a) => a.ticker === 'NVDA')!;

    // Invariant 5: No unsupported 1-day return is derived from non-consecutive price observations (2026-11-11 vs 2026-11-04)
    expect(nvdaAssessment.latestPrice.close).toBe(195.88);
    expect(nvdaAssessment.latestPrice.timestampIso?.slice(0, 10)).toBe('2026-11-11');
    expect(nvdaAssessment.latestPrice.sessionChangePct).toBeNull();

    // Invariant 7: Deterministic processing (`deterministic-sec-xbrl-extractor-v1`, 0 model calls) is never labelled as successful Gemini inference
    const deterministicRunHealth = evaluateCollectionHealth({
      now,
      systemEnabled: true,
      activeEnvironment: 'remote',
      dailyCostCeilingGbp: 0,
      monthlyCostCeilingGbp: 0,
      dailyEstimatedCostGbp: 0,
      dailyActualCostGbp: 0,
      monthlyEstimatedCostGbp: 0,
      monthlyActualCostGbp: 0,
      pendingVerificationCount: 0,
      latestBriefingDate: '2026-11-12',
      latestBriefingGeneratedAt: Date.parse('2026-11-12T07:30:16.435Z'),
      jobs: [],
      recentRuns: [
        {
          runId: 'run-det-sec-1',
          jobKey: 'sec_filings_collector',
          category: 'collector',
          environment: 'remote',
          status: 'succeeded',
          startedAt: now - 60_000,
          finishedAt: now - 55_000,
          cursorBefore: null,
          cursorAfter: '0001045810-26-000075',
          sourcesDiscovered: 1,
          evidenceStaged: 1,
          evidencePromoted: 1,
          duplicatesSkipped: 0,
          pendingVerification: 0,
          modelVersion: 'deterministic-sec-xbrl-extractor-v1',
          estimatedCostGbp: 0,
          actualCostGbp: 0,
          providerRequestsCount: 0,
          processingDurationMs: 5000,
          conditionalSkip: false,
          errorCode: null,
          summary: 'Deterministic SEC XBRL fact extracted',
        },
      ],
    });
    expect(deterministicRunHealth.agentAndProviderStages.modelInferenceAttempted).toBe(
      false,
    );
    expect(deterministicRunHealth.agentAndProviderStages.modelInferenceSucceeded).toBe(
      false,
    );

    // Invariant 8: Background inference and external news collection remain explicitly NOT IMPLEMENTED
    expect(deterministicRunHealth.agentAndProviderStages.liveAgentInferenceStatus).toBe(
      'NOT IMPLEMENTED',
    );
    expect(
      deterministicRunHealth.agentAndProviderStages.externalNewsFeedCollectionStatus,
    ).toBe('NOT IMPLEMENTED');
    const connectionsReport = buildWorkspaceConnectionsReport({
      liveOps: { health: deterministicRunHealth, latestBriefing: null },
      convexUrlConfigured: true,
      convexIsProduction: true,
      modelProviderConfigured: false,
      now,
    });
    const modelSvc = connectionsReport.services.find((s) => s.id === 'model_providers')!;
    expect(modelSvc.detail).toContain('NOT IMPLEMENTED');

    // Invariants 1, 3, 4: Public telemetry redacted (`latestBriefing: null`), current market observation (`2026-11-11`) displayed, and historical fundamental analysis (`2026-11-04`) clearly identified as historical
    const freshCommandCentreHtml = renderToStaticMarkup(
      React.createElement(CommandCentre, {
        portfolio: null,
        trading: null,
        operations: {
          health: deterministicRunHealth,
          latestBriefing: null,
        },
        feed: {
          ...baseFeed,
          watchlist: discontinuousWatchlist,
          marketDataAsOf: Date.parse('2026-11-11T21:00:00Z'),
          agentOperations: deterministicRunHealth,
        },
        flags: { demo: false, live: false },
        now,
        signedIn: false,
        configured: true,
      }),
    );
    expect(freshCommandCentreHtml).toContain('Research as of 2026-11-11');
    expect(freshCommandCentreHtml).toContain('Fundamental &amp; graph cut-off: 2026-11-04');
    expect(freshCommandCentreHtml).toContain(
      'Cross-cutoff returns are never blended.',
    );
    expect(freshCommandCentreHtml).not.toContain('vs $685.28 on 2026-11-03');

    // Invariant 6: Status banner (`AlertsCentre`) correctly identifies degraded or stale research when fallback snapshot is older than 4 days
    const staleCommandCentreHtml = renderToStaticMarkup(
      React.createElement(CommandCentre, {
        portfolio: null,
        trading: null,
        operations: {
          health: deterministicRunHealth,
          latestBriefing: null,
        },
        feed: {
          ...baseFeed,
          marketDataAsOf: Date.parse('2026-11-04T21:00:00Z'),
          agentOperations: deterministicRunHealth,
        },
        flags: { demo: false, live: false },
        now,
        signedIn: false,
        configured: true,
      }),
    );
    expect(staleCommandCentreHtml).toContain(
      'Historical research snapshot active (collector stale or unverified)',
    );
  });
});
