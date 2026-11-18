import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExecutiveOverviewSections } from '../components/command-centre/executive-overview';
import MacroDataRoom from '../components/macro-data-room';
import DataRoomPage from '../app/data-room/page';
import {
  buildNvidiaGraphSummaryFromDataset,
  isSyntheticMacroCase001Dataset,
  loadAlignedNvidiaGraphIntelligence,
} from '../lib/graph/nvidia-dashboard-alignment';
import { loadInitialAcceptanceDataset } from '../lib/graph/query-gateway';
import { runGraphVsConvexBenchmark } from '../lib/graph/benchmark-evaluator';
import {
  CASE_007_PRE_EARNINGS_CAPTURED_AT_MS,
  CASE_007B_POST_EARNINGS_INGESTED_AT_MS,
  runCase007PostEarningsPipeline,
} from '../lib/remote-ops/case-007-nvidia-ingestor';

const CASE007B_DATASET = runCase007PostEarningsPipeline({ owner: 'public_research' }).dataset;

const NVDA_WATCH_ITEM = {
  ticker: 'NVDA',
  name: 'NVIDIA Corp.',
  currency: 'USD' as const,
  close: 142.84,
  closeGbp: 109.77,
  usdToGbp: 0.7685,
  closeAt: Date.parse('2026-11-17T21:00:00Z'),
  serverReceivedAt: Date.parse('2026-11-17T21:05:00Z'),
  priceBasis: 'delayed_eod_reference_close',
  corporateActionsReviewed: false,
  source: 'https://api.nasdaq.com/api/quote/NVDA/historical?assetclass=stocks',
  signals: [],
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('RC002 Workstream D — Home (/) and Data Room (/data-room) NVIDIA Alignment (B-005)', () => {
  it('aligns / and /data-room on FY2027 Q3 post-earnings observations from the verified TypeDB read path with zero Case 001 synthetic leakage', async () => {
    const summaryPost = buildNvidiaGraphSummaryFromDataset(CASE007B_DATASET, {
      asOfMs: CASE_007B_POST_EARNINGS_INGESTED_AT_MS,
      graphSourceMode: 'LIVE_GRAPH',
      sourceDatabase: 'aci_case007b_verified_dev',
      serverVersion: '3.14.2',
    });

    expect(summaryPost.graphSourceMode).toBe('LIVE_GRAPH');
    expect(summaryPost.isPostEarningsQ3Available).toBe(true);
    expect(summaryPost.latestReportedPeriodLabel).toBe('FY2027 Q3 (Three Months Ended 2026-10-25)');
    expect(summaryPost.reported.revenueUsd).toBe(115_844_000_000);
    expect(summaryPost.reported.freeCashFlowUsd).toBe(43_777_000_000);
    expect(summaryPost.reported.cashCapexUsd).toBe(4_422_000_000);

    const homeHtml = renderToStaticMarkup(
      React.createElement(ExecutiveOverviewSections, {
        watchlist: [NVDA_WATCH_ITEM],
        ownedTickers: [],
        now: CASE_007B_POST_EARNINGS_INGESTED_AT_MS,
        nvidiaGraphSummary: summaryPost,
      }),
    );

    const benchmark = await runGraphVsConvexBenchmark(CASE007B_DATASET);
    const dataRoomHtml = renderToStaticMarkup(
      React.createElement(MacroDataRoom, {
        dataset: CASE007B_DATASET,
        benchmark,
        graphSourceMode: 'LIVE_GRAPH',
        sourceModeDetail: 'Hydrated from aci_case007b_verified_dev',
        queryTimestampIso: '2026-11-18T12:00:00.000Z',
        initialFocalId: 'org-nvda',
        initialAsOfMs: CASE_007B_POST_EARNINGS_INGESTED_AT_MS,
        liveTypeDbStatus: {
          reachable: true,
          authenticated: true,
          databaseExists: true,
          databaseName: 'aci_case007b_verified_dev',
          distribution: 'TypeDB',
          version: '3.14.2',
          latencyMs: 12,
          tlsEnabled: true,
        },
      }),
    );

    // Both `/` and `/data-room` agree on FY2027 Q3 as the latest reported period and show Q3 figures
    expect(homeHtml).toContain('FY2027 Q3');
    expect(homeHtml).toContain('$115,844M USD');
    expect(homeHtml).toContain('USD 115.844B');
    expect(homeHtml).toContain('USD 43.777B');
    expect(homeHtml).toContain('USD 4.422B');
    expect(homeHtml).toContain('LIVE GRAPH (aci_case007b_verified_dev)');
    expect(dataRoomHtml).toContain('FY2027 Q3');

    // Never display synthetic Macro Case 001 Nscale / Monarch / Ward County strings as NVDA intelligence
    expect(homeHtml).not.toContain('rel-nscale-nvda-convertible-r1');
    expect(homeHtml).not.toContain('rel-ward-county-guarantee-r1');
    expect(homeHtml).not.toContain('Nscale lease/convertible');
  });

  it('preserves historical pre-earnings as-of views (FY2027 Q2 + $108.0B Q3 forecast) without hindsight leakage', () => {
    const summaryPre = buildNvidiaGraphSummaryFromDataset(CASE007B_DATASET, {
      asOfMs: CASE_007_PRE_EARNINGS_CAPTURED_AT_MS,
      graphSourceMode: 'LIVE_GRAPH',
      sourceDatabase: 'aci_case007b_verified_dev',
      serverVersion: '3.14.2',
    });

    expect(summaryPre.isPostEarningsQ3Available).toBe(false);
    expect(summaryPre.latestReportedPeriodLabel).toBe('FY2027 Q2 (Three Months Ended 2026-07-26)');
    expect(summaryPre.reported.revenueUsd).toBe(96_221_000_000);
    expect(summaryPre.forwardGuidance.revenueMidpointUsd).toBe(108_000_000_000);

    const homePreHtml = renderToStaticMarkup(
      React.createElement(ExecutiveOverviewSections, {
        watchlist: [NVDA_WATCH_ITEM],
        ownedTickers: [],
        now: CASE_007_PRE_EARNINGS_CAPTURED_AT_MS,
        nvidiaGraphSummary: summaryPre,
      }),
    );

    expect(homePreHtml).toContain('FY2027 Q2 (Three Months Ended 2026-07-26)');
    expect(homePreHtml).toContain('USD 96.221B');
    expect(homePreHtml).toContain('USD 108.0B');
    expect(homePreHtml).not.toContain('115.844');
    expect(homePreHtml).not.toContain('130.0B');
  });

  it('displays explicit GRAPH UNAVAILABLE state on failure and refuses to display synthetic Macro Case 001 as NVIDIA intelligence on / or /data-room', async () => {
    const case001 = loadInitialAcceptanceDataset();
    expect(isSyntheticMacroCase001Dataset(case001)).toBe(true);

    // Passing synthetic Macro Case 001 into NVIDIA summary builder MUST reject as GRAPH_UNAVAILABLE
    const rejectedCase001Summary = buildNvidiaGraphSummaryFromDataset(case001, {
      asOfMs: CASE_007B_POST_EARNINGS_INGESTED_AT_MS,
      graphSourceMode: 'LIVE_GRAPH',
      sourceDatabase: 'aci_macro_intelligence_staging',
    });
    expect(rejectedCase001Summary.graphSourceMode).toBe('GRAPH_UNAVAILABLE');

    // Unreachable TypeDB server fails closed to GRAPH_UNAVAILABLE
    const unavailableSummary = await loadAlignedNvidiaGraphIntelligence({
      asOfMs: CASE_007B_POST_EARNINGS_INGESTED_AT_MS,
      typeDbConfig: {
        httpAddress: 'http://127.0.0.1:59996',
        username: 'admin',
        password: 'password',
        databaseName: 'aci_unreachable_nvda_test',
      },
    });
    expect(unavailableSummary.graphSourceMode).toBe('GRAPH_UNAVAILABLE');

    const unavailableHomeHtml = renderToStaticMarkup(
      React.createElement(ExecutiveOverviewSections, {
        watchlist: [NVDA_WATCH_ITEM],
        ownedTickers: [],
        now: CASE_007B_POST_EARNINGS_INGESTED_AT_MS,
        nvidiaGraphSummary: unavailableSummary,
      }),
    );
    expect(unavailableHomeHtml).toContain('data-testid="nvidia-graph-unavailable-banner"');
    expect(unavailableHomeHtml).toContain('GRAPH UNAVAILABLE');
    expect(unavailableHomeHtml).not.toContain('Nscale lease/convertible');

    // `/data-room?focal=org-nvda` with unreachable TypeDB MUST NOT fall back to Macro Case 001
    vi.stubEnv('TYPEDB_HTTP_ADDRESS', 'http://127.0.0.1:59996');
    vi.stubEnv('TYPEDB_DATABASE', 'aci_unreachable_nvda_test');
    const dataRoomElement = await DataRoomPage({
      searchParams: Promise.resolve({ focal: 'org-nvda' }),
    });
    const dataRoomUnavailableHtml = renderToStaticMarkup(dataRoomElement);
    expect(dataRoomUnavailableHtml).toContain('GRAPH UNAVAILABLE');
    expect(dataRoomUnavailableHtml).not.toContain('rel-loughton-msft-r2');
    expect(dataRoomUnavailableHtml).not.toContain('EirGrid');
  });
});
