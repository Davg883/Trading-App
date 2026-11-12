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
});
