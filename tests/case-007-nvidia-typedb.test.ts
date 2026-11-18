import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import { TypeDBHttpDriver, isApiErrorResponse } from '@typedb/driver-http';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import { beforeEach, describe, expect, it } from 'vitest';
import schema from '../convex/schema';
import { POST as graphGatewayPost } from '../app/api/graph/query/route';
import MacroDataRoom from '../components/macro-data-room';
import { ExecutiveOverviewSections } from '../components/command-centre/executive-overview';
import { runGraphVsConvexBenchmark } from '../lib/graph/benchmark-evaluator';
import {
  executeAllowlistedGraphQuery,
  loadInitialAcceptanceDataset,
  resetGraphGatewayRateLimitsForTests,
} from '../lib/graph/query-gateway';
import { processProjectionOutboxBatch } from '../lib/graph/projection-engine';
import {
  CASE_007_VERIFIED_DEV_DATABASE,
  CASE_007B_VERIFIED_DEV_DATABASE,
  PRODUCTION_TYPEDB_DATABASE,
  STAGING_TYPEDB_DATABASE,
  TypeDbSchemaOrHydrationError,
  assertCanRecreateTypeDbDatabase,
  assertIsolatedCase007BWriteTarget,
  assertIsolatedCase007WriteTarget,
  executeWriteStatementsOnLiveServer,
  hydrateMacroDatasetFromLiveTypeDb,
  inspectLiveTypeDbGraphCounts,
  projectDatasetIntoLiveTypeDb,
  type TypeDbConnectionConfig,
} from '../lib/graph/typedb-driver-adapter';
import {
  CASE_007_BUNDLE_ID,
  CASE_007_POST_RESULTS_BUNDLE_ID,
  CASE_007_PRE_EARNINGS_CAPTURED_AT_MS,
  CASE_007B_POST_EARNINGS_INGESTED_AT_MS,
  NVDA_Q3_FY27_SCHEDULED_RELEASE_MS,
  appendPostEarningsQ3ResultsBatch,
  assertNoDisputedG9SecRecords,
  assertNoDisputedG9SecRecordsPostEarnings,
  runCase007PostEarningsPipeline,
  runCase007PreEarningsPipeline,
} from '../lib/remote-ops/case-007-nvidia-ingestor';

const LIVE_TYPEDB = process.env.ACI_LIVE_TYPEDB_TESTS === '1';

beforeEach(() => {
  resetGraphGatewayRateLimitsForTests();
});

describe('Case 007: NVIDIA Primary SEC Ingestion, Governance, Live TypeDB Hydration & Dashboard', () => {
  it('1. Deterministically extracts NVIDIA 8-K, Q2/Q3 8-K, 13F-HR ($48.33B / 8 holdings), and Anthropic S-1/A-2 + 8-A12B without mapping proposed investments to completed ownership', () => {
    const res = runCase007PreEarningsPipeline();

    expect(res.bundleId).toBe(CASE_007_BUNDLE_ID);
    expect(res.executionAuthority).toBe('none');
    expect(res.holdingCount).toBe(8);
    expect(res.holdingTotalUsd).toBe(48_330_717_074);

    // Observed market close is delayed public reference, never live
    expect(res.observedMarketReference.symbol).toBe('NVDA');
    expect(res.observedMarketReference.priceBasis).toBe('delayed_eod_reference_close');
    expect(res.observedMarketReference.liveQuoteAvailable).toBe(false);

    // 3 executive persons extracted from Form 8-K 0001045810-26-000082
    expect(res.dataset.executives.map((e) => e.personId)).toEqual([
      'person-jensen-huang',
      'person-colette-kress',
      'person-harvey-jones',
    ]);

    // 20 validated relationships: 3 leadership + 2 IPO (v1 -> v2) + 4 Class N placements + 3 compute/hardware + 8 13F holdings
    expect(res.dataset.relationships).toHaveLength(20);
    expect(res.outboxItems).toHaveLength(20);

    // Proposed NVIDIA $10B Class N commitment is strictly `proposed` / `contingent_signed`, NOT `funded`
    const nvdaCpp = res.dataset.relationships.find(
      (r) => r.relationshipId === 'rel-case007-nvda-anthropic-pp-r1',
    )!;
    expect(nvdaCpp.epistemicStatus).toBe('proposed');
    expect(nvdaCpp.contractualStatus).toBe('contingent_signed');
    expect(nvdaCpp.bindingObligation).toBe(false);
    expect(nvdaCpp.principalAmount).toBe(10_000_000_000);
    expect(nvdaCpp.capacityQuantity).toBe(135_135_135);
    expect(nvdaCpp.capacityUnit).toBe('SHARES');

    // Anthropic IPO v2 supersedes v1 and remains `proposed` / `announced`
    const ipoV2 = res.dataset.relationships.find(
      (r) => r.relationshipId === 'rel-case007-anthropic-ipo-r2',
    )!;
    expect(ipoV2.supersedesRelationshipId).toBe('rel-case007-anthropic-ipo-r1');
    expect(ipoV2.epistemicStatus).toBe('proposed');
    expect(ipoV2.contractualStatus).toBe('announced');

    // SpaceXAI $120.5B ceiling and Lambda $41.3B ($34.9B terminable) are strictly distinguished from unconditional binding obligations
    const spacexCompute = res.dataset.relationships.find(
      (r) => r.relationshipId === 'rel-case007-anthropic-spacexai-nvda-compute-r1',
    )!;
    expect(spacexCompute.bindingObligation).toBe(false);
    expect(spacexCompute.conditionsSummary).toContain('90 days');

    const lambdaCompute = res.dataset.relationships.find(
      (r) => r.relationshipId === 'rel-case007-anthropic-lambda-nvda-compute-r1',
    )!;
    expect(lambdaCompute.bindingObligation).toBe(false);
    expect(lambdaCompute.conditionsSummary).toContain('34.9B is currently terminable');

    // Only the 7 verified primary SEC/IR disclosures enter promoted dataset.sources
    expect(res.dataset.sources).toHaveLength(7);
    expect(res.dataset.sources.every((s) => s.authority === 'primary')).toBe(true);

    // Hard write-target isolation & disputed G9 XBRL blocklist guards
    expect(() =>
      assertIsolatedCase007WriteTarget(CASE_007_VERIFIED_DEV_DATABASE),
    ).not.toThrow();
    expect(() => assertIsolatedCase007WriteTarget(STAGING_TYPEDB_DATABASE)).toThrow(
      /aci_case007_verified_dev/,
    );
    expect(() => assertIsolatedCase007WriteTarget(PRODUCTION_TYPEDB_DATABASE)).toThrow(
      /aci_case007_verified_dev/,
    );
    expect(() => assertNoDisputedG9SecRecords(res.dataset)).not.toThrow();
    expect(() =>
      assertNoDisputedG9SecRecords({
        ...res.dataset,
        sources: [
          ...res.dataset.sources,
          {
            ...res.dataset.sources[0]!,
            sourceDocId: 'bad-disputed-xbrl',
            title: 'Disputed 0001045810-20-000147 Q2 2020 XBRL',
          },
        ],
      }),
    ).toThrow(/0001045810-20-000147/);

    // Completed 13F equity holdings are `confirmed` / `funded` and sum to exact $48,330,717,074
    const f13Edges = res.dataset.relationships.filter(
      (r) => r.category === 'reported_13f_equity_holding',
    );
    expect(f13Edges).toHaveLength(8);
    const f13Sum = f13Edges.reduce((s, r) => s + (r.principalAmount ?? 0), 0);
    expect(f13Sum).toBe(48_330_717_074);
    for (const edge of f13Edges) {
      expect(edge.epistemicStatus).toBe('confirmed');
      expect(edge.contractualStatus).toBe('funded');
    }

    // All 4 invalid/adversarial candidates are quarantined and excluded from outboxItems
    expect(res.quarantinedCandidates).toHaveLength(4);
    const quarantinedIds = res.quarantinedCandidates.map((q) => q.candidateId);
    expect(quarantinedIds).toEqual(
      expect.arrayContaining([
        'rel-case007-quarantined-prompt-injection-r1',
        'rel-case007-quarantined-newspaper-confirmed-r1',
        'rel-case007-quarantined-proposed-marked-funded-r1',
        'obs-case007-quarantined-prerelease-q3fy27-actual',
      ]),
    );
    for (const qId of quarantinedIds) {
      expect(res.outboxItems.some((o) => o.relationshipId === qId)).toBe(false);
    }
  });

  it('2. Enforces Convex dry-run vs idempotent outbox persistence and prevents failed projections from falsely acknowledging success', async () => {
    const modules = {
      './_generated/server.ts': async () => ({}),
      './graph.ts': () => import('../convex/graph'),
    };
    const stageRef = makeFunctionReference<'mutation'>(
      'graph:stageAndEnqueueCase007Internal',
    );
    const claimRef = makeFunctionReference<'mutation'>(
      'graph:claimPendingOutboxBatchInternal',
    );
    const outcomeRef = makeFunctionReference<'mutation'>(
      'graph:recordProjectionOutcomeInternal',
    );
    const stateRef = makeFunctionReference<'query'>('graph:getProjectionStateInternal');

    const OWNER = 'https://clerk.capital.aiguides.co.uk|user_case007_owner';
    const t = convexTest(schema, modules);

    // Dry run computes all 20 projectionKeys without inserting rows
    const dryRunRes = (await t.mutation(stageRef, {
      owner: OWNER,
      dryRun: true,
    })) as {
      dryRun: boolean;
      validatedRelationshipCount: number;
      quarantinedCandidateCount: number;
      enqueuedCount: number;
      beforeOutboxRowCount: number;
      afterOutboxRowCount: number;
    };
    expect(dryRunRes.dryRun).toBe(true);
    expect(dryRunRes.validatedRelationshipCount).toBe(20);
    expect(dryRunRes.quarantinedCandidateCount).toBe(4);
    expect(dryRunRes.beforeOutboxRowCount).toBe(0);
    expect(dryRunRes.afterOutboxRowCount).toBe(0);

    const stateAfterDryRun = (await t.query(stateRef, { owner: OWNER })) as {
      outboxItems: unknown[];
    };
    expect(stateAfterDryRun.outboxItems).toHaveLength(0);

    // Live internal enqueue writes 20 pending outbox rows; duplicate pass writes 0 new rows
    const pass1 = (await t.mutation(stageRef, {
      owner: OWNER,
      dryRun: false,
    })) as {
      enqueuedCount: number;
      deduplicatedCount: number;
      afterOutboxRowCount: number;
    };
    expect(pass1.enqueuedCount).toBe(20);
    expect(pass1.deduplicatedCount).toBe(0);
    expect(pass1.afterOutboxRowCount).toBe(20);

    const pass2 = (await t.mutation(stageRef, {
      owner: OWNER,
      dryRun: false,
    })) as {
      enqueuedCount: number;
      deduplicatedCount: number;
      afterOutboxRowCount: number;
    };
    expect(pass2.enqueuedCount).toBe(0);
    expect(pass2.deduplicatedCount).toBe(20);
    expect(pass2.afterOutboxRowCount).toBe(20);

    // Failed projection does NOT falsely acknowledge `projected`
    const claimed = (await t.mutation(claimRef, {
      owner: OWNER,
      batchSize: 2,
      forceImmediate: true,
    })) as {
      claimed: Array<{ outboxId: string; leaseToken: string }>;
    };
    expect(claimed.claimed).toHaveLength(2);

    const failedOutcome = (await t.mutation(outcomeRef, {
      outboxId: claimed.claimed[0]!.outboxId,
      leaseToken: claimed.claimed[0]!.leaseToken,
      succeeded: false,
      errorMessage: 'Simulated TypeDB transaction failure',
    })) as { status: string };
    expect(failedOutcome.status).toBe('retrying');

    const stateAfterFail = (await t.query(stateRef, { owner: OWNER })) as {
      checkpoint: { projectedCount: number; retryingCount: number; pendingCount: number };
    };
    expect(stateAfterFail.checkpoint.projectedCount).toBe(0);
    expect(stateAfterFail.checkpoint.retryingCount).toBe(1);
    expect(stateAfterFail.checkpoint.pendingCount).toBe(19);

    // Also verify pure projection-engine batch failure accounting
    const pipeline = runCase007PreEarningsPipeline();
    const batchFail = await processProjectionOutboxBatch(
      pipeline.outboxItems.slice(0, 2),
      async (item) => {
        if (item.sequence === 1) {
          throw new Error('TypeDB write aborted');
        }
      },
      CASE_007_PRE_EARNINGS_CAPTURED_AT_MS,
    );
    expect(batchFail.updatedOutbox[0]!.status).toBe('retrying');
    expect(batchFail.updatedOutbox[0]!.projectedAtMs).toBeNull();
    expect(batchFail.updatedOutbox[1]!.status).toBe('projected');
    expect(batchFail.checkpoint.projectedCount).toBe(1);
  });

  it('3. Preserves the 17 Nov pre-earnings snapshot at 20:59 UTC and isolates post-21:20 UTC Q3 results as a versioned batch', async () => {
    const pre = runCase007PreEarningsPipeline();

    // Rejects any post-earnings batch dated before scheduled 21:20 UTC release
    expect(() =>
      appendPostEarningsQ3ResultsBatch(pre.dataset, {
        sourceDocId: 'doc-nvda-q3fy27-early-invalid',
        secAccession: '0001045810-26-000090',
        title: 'Premature Q3 Filing',
        url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000090/q3fy27pr.htm',
        contentSha256: 'a'.repeat(64),
        publishedAtMs: NVDA_Q3_FY27_SCHEDULED_RELEASE_MS - 60_000,
        receivedAtMs: NVDA_Q3_FY27_SCHEDULED_RELEASE_MS,
        ingestedAtMs: NVDA_Q3_FY27_SCHEDULED_RELEASE_MS,
        reportedRevenueUsd: 110_500_000_000,
      }),
    ).toThrow(/cannot precede scheduled/);

    // Valid post-21:20 UTC release appends versioned actual without overwriting pre-earnings guidance
    const postReleaseMs = Date.parse('2026-11-17T21:25:00.000Z');
    const postBatch = appendPostEarningsQ3ResultsBatch(pre.dataset, {
      sourceDocId: 'doc-nvda-q3fy27-8k-20261117',
      secAccession: '0001045810-26-000090',
      title: 'NVIDIA Corp. Form 8-K Exhibit 99.1 (Q3 FY27 Reported Financial Results)',
      url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000090/q3fy27pr.htm',
      contentSha256: 'b'.repeat(64),
      publishedAtMs: postReleaseMs,
      receivedAtMs: postReleaseMs + 10_000,
      ingestedAtMs: postReleaseMs + 20_000,
      reportedRevenueUsd: 110_500_000_000,
    });
    expect(postBatch.batchId).toBe(CASE_007_POST_RESULTS_BUNDLE_ID);

    // Point-in-time query at 20:59 UTC excludes the 21:25 UTC actual observation while preserving Q3 guidance
    const atPreEarnings = await executeAllowlistedGraphQuery(
      {
        queryType: 'organisation_relationship_summary',
        organisationId: 'org-nvda',
        asOfMs: CASE_007_PRE_EARNINGS_CAPTURED_AT_MS,
        temporalBasis: 'receipt',
      },
      { callerId: 'owner_test', datasets: [postBatch.updatedDataset] },
    );
    expect(atPreEarnings.observations.map((o) => o.observationId)).toContain(
      'obs-nvda-q3fy27-guidance-rev',
    );
    expect(atPreEarnings.observations.map((o) => o.observationId)).not.toContain(
      'obs-nvda-q3fy27-actual-rev',
    );

    // Point-in-time query at 21:30 UTC includes both historical guidance and reported Q3 actual
    const atPostEarnings = await executeAllowlistedGraphQuery(
      {
        queryType: 'organisation_relationship_summary',
        organisationId: 'org-nvda',
        asOfMs: Date.parse('2026-11-17T21:30:00.000Z'),
        temporalBasis: 'receipt',
      },
      { callerId: 'owner_test', datasets: [postBatch.updatedDataset] },
    );
    expect(atPostEarnings.observations.map((o) => o.observationId)).toEqual(
      expect.arrayContaining([
        'obs-nvda-q3fy27-guidance-rev',
        'obs-nvda-q3fy27-actual-rev',
      ]),
    );
  });

  it('4. Renders explicit LIVE GRAPH, HISTORICAL MIRROR, and GRAPH UNAVAILABLE source-mode indicators and NVIDIA Case 007 summary card', async () => {
    const case007 = runCase007PreEarningsPipeline();
    const benchmark = await runGraphVsConvexBenchmark(loadInitialAcceptanceDataset());

    const liveHtml = renderToStaticMarkup(
      createElement(MacroDataRoom, {
        dataset: case007.dataset,
        benchmark,
        graphSourceMode: 'LIVE_GRAPH',
        initialFocalId: 'org-nvda',
        initialAsOfMs: CASE_007_PRE_EARNINGS_CAPTURED_AT_MS,
        initialSelectedRelationshipId: 'rel-case007-nvda-kress-interim-ceo-r1',
        liveTypeDbStatus: {
          reachable: true,
          version: '3.14.2',
          databaseName: 'aci_case_007_wp2_disposable',
          tlsEnabled: false,
        },
      }),
    );
    expect(liveHtml).toContain('SOURCE MODE: LIVE GRAPH');
    expect(liveHtml).toContain('data-testid="live-graph-dataset-banner"');
    expect(liveHtml).toContain('VERIFIED IN LIVE GRAPH (20 Case 007 relationships');
    expect(liveHtml).toContain('data-testid="live-graph-observations-panel"');
    expect(liveHtml).not.toContain('data-testid="macro-case-001-workspace"');
    expect(liveHtml).toContain('Colette Kress');
    expect(liveHtml).toContain('contingent-signed capital commitment(s)');
    expect(liveHtml).toContain('data-testid="drawer-source-link-doc-nvda-8k-20261112"');
    expect(liveHtml).toContain(
      'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000082/nvda-20261111.htm',
    );
    expect(liveHtml).toContain('forecast (pre-results guidance)');
    expect(liveHtml).toContain('reported actual');

    // Gate 6 check: when LIVE_GRAPH has pre-existing records only (0 Case 007 edges), explicitly states NOT YET VERIFIED
    const preCase007LiveHtml = renderToStaticMarkup(
      createElement(MacroDataRoom, {
        dataset: loadInitialAcceptanceDataset(),
        benchmark,
        graphSourceMode: 'LIVE_GRAPH',
        liveTypeDbStatus: {
          reachable: true,
          version: '3.14.2',
          databaseName: 'aci_macro_intelligence_staging',
          tlsEnabled: true,
        },
      }),
    );
    expect(preCase007LiveHtml).toContain(
      'NVIDIA Case 007 Live Ingestion: NOT YET VERIFIED IN LIVE GRAPH',
    );
    expect(preCase007LiveHtml).not.toContain('data-testid="macro-case-001-workspace"');

    const liveExplorerHtml = renderToStaticMarkup(
      createElement(MacroDataRoom, {
        dataset: case007.dataset,
        benchmark,
        graphSourceMode: 'LIVE_GRAPH',
        initialView: 'relationship_explorer',
        initialFocalId: 'org-nvda',
        initialAsOfMs: CASE_007_PRE_EARNINGS_CAPTURED_AT_MS,
        initialSelectedRelationshipId: 'rel-case007-nvda-anthropic-pp-r1',
        liveTypeDbStatus: {
          reachable: true,
          version: '3.14.2',
          databaseName: 'aci_case_007_wp2_disposable',
          tlsEnabled: false,
        },
      }),
    );
    expect(liveExplorerHtml).toContain('contingent_signed');

    const mirrorHtml = renderToStaticMarkup(
      createElement(MacroDataRoom, {
        dataset: loadInitialAcceptanceDataset(),
        benchmark,
        graphSourceMode: 'HISTORICAL_MIRROR',
        liveTypeDbStatus: { reachable: false, version: null },
      }),
    );
    expect(mirrorHtml).toContain('SOURCE MODE: HISTORICAL MIRROR');
    expect(mirrorHtml).toContain('data-testid="static-demo-dataset-banner"');

    const unavailHtml = renderToStaticMarkup(
      createElement(MacroDataRoom, {
        dataset: loadInitialAcceptanceDataset(),
        benchmark,
        graphSourceMode: 'GRAPH_UNAVAILABLE',
        sourceModeDetail: 'Unsupported TypeDB database schema version',
        liveTypeDbStatus: { reachable: true, version: '3.14.2' },
      }),
    );
    expect(unavailHtml).toContain('SOURCE MODE: GRAPH UNAVAILABLE');
    expect(unavailHtml).toContain('data-testid="graph-unavailable-banner"');
    expect(unavailHtml).toContain('data-testid="graph-unavailable-workspace"');
    expect(unavailHtml).toContain('Fail-Closed Safeguard Active');
    expect(unavailHtml).not.toContain('rel-loughton-msft-r2');
    expect(unavailHtml).not.toContain('data-testid="active-edge-count"');

    const execOverviewHtml = renderToStaticMarkup(
      createElement(ExecutiveOverviewSections, {
        watchlist: [
          {
            ticker: 'NVDA',
            name: 'NVIDIA Corp.',
            currency: 'USD',
            close: 142.84,
            closeGbp: 109.77,
            usdToGbp: 0.7685,
            closeAt: Date.parse('2026-11-10T21:00:00Z'),
            serverReceivedAt: Date.parse('2026-11-10T22:00:00Z'),
            priceBasis: 'delayed_eod_reference_close',
            corporateActionsReviewed: false,
            source: 'https://api.nasdaq.com/api/quote/NVDA/historical?assetclass=stocks',
            signals: [],
          },
        ],
        ownedTickers: [],
        now: CASE_007_PRE_EARNINGS_CAPTURED_AT_MS,
      }),
    );
    expect(execOverviewHtml).toContain('data-testid="case-007-nvidia-summary-card"');
    expect(execOverviewHtml).toContain('0001045810-26-000082');
    expect(execOverviewHtml).toContain('USD 48.33B across 8 reported Section 13(f) holdings');
    expect(execOverviewHtml).toContain('data-testid="case-007-sec-link-8k"');
    expect(execOverviewHtml).toContain('data-testid="case-007-sec-link-13f"');
    expect(execOverviewHtml).toContain('contingent upon IPO closing');
  });

  it('5. Fails closed with GRAPH_UNAVAILABLE when requireLiveGraph=true and TypeDB is unreachable', async () => {
    const closedPortConfig: TypeDbConnectionConfig = {
      httpAddress: 'http://127.0.0.1:59997',
      username: 'admin',
      password: 'password',
      databaseName: 'aci_unreachable_test',
    };

    const res = await executeAllowlistedGraphQuery(
      {
        queryType: 'organisation_relationship_summary',
        organisationId: 'org-nvda',
        asOfMs: CASE_007_PRE_EARNINGS_CAPTURED_AT_MS,
      },
      {
        callerId: 'owner_1',
        requireLiveGraph: true,
        typeDbConfig: closedPortConfig,
      },
    );
    expect(res.graphSourceMode).toBe('GRAPH_UNAVAILABLE');
    expect(res.nodes).toHaveLength(0);
    expect(res.edges).toHaveLength(0);
  });

  it.skipIf(!LIVE_TYPEDB)(
    '6. End-to-end disposable local TypeDB 3.14.2 proof: schema migration, idempotent projection, live query hydration WITHOUT static JSON, and fail-closed schema rejection',
    async () => {
      const disposableDb = 'aci_case_007_wp2_disposable';
      const v1UpgradeDb = 'aci_case_007_v1_upgrade_disposable';
      const badSchemaDb = 'aci_case_007_bad_schema_disposable';
      const sentinelDb = 'aci_case_007_sentinel_anti_static';

      const baseDriver = new TypeDBHttpDriver({
        username: 'admin',
        password: 'password',
        addresses: ['http://127.0.0.1:8000'],
      });

      const disposableConfig: TypeDbConnectionConfig = {
        httpAddress: 'http://127.0.0.1:8000',
        username: 'admin',
        password: 'password',
        databaseName: disposableDb,
      };

      try {
        // A. Project Case 007 into disposable TypeDB 3.14.2 database (Pass 1)
        const case007 = runCase007PreEarningsPipeline();
        const pass1 = await projectDatasetIntoLiveTypeDb(case007.dataset, {
          config: disposableConfig,
          recreateDatabase: true,
        });
        expect(pass1.report.connected).toBe(true);
        expect(pass1.report.serverVersion).toBe('3.14.2');
        expect(pass1.report.outboxProjectedCount).toBe(20);
        expect(pass1.report.outboxDeadLetterCount).toBe(0);

        const counts1 = await inspectLiveTypeDbGraphCounts(disposableConfig);
        expect(counts1.ok).toBe(true);
        expect(counts1.counts?.organisations).toBe(19);
        expect(counts1.counts?.executivePersons).toBe(3);
        expect(counts1.counts?.macroRelationships).toBe(20);
        expect(counts1.counts?.observations).toBe(4);
        expect(counts1.counts?.supersessionLinks).toBe(1);

        // B. Re-project exact same dataset (Pass 2) -> idempotent, zero duplicate rows
        const pass2 = await projectDatasetIntoLiveTypeDb(case007.dataset, {
          config: disposableConfig,
          recreateDatabase: false,
        });
        expect(pass2.report.outboxDeadLetterCount).toBe(0);
        const counts2 = await inspectLiveTypeDbGraphCounts(disposableConfig);
        expect(counts2.counts).toEqual(counts1.counts);

        // C. Failed write statement rolls back atomically without corrupting counts
        const badWrite = await executeWriteStatementsOnLiveServer(
          ['match $x isa non_existent_concept_type; put $y isa organisation, has org_id "bad";'],
          disposableConfig,
        );
        expect(badWrite.ok).toBe(false);
        const countsAfterRollback = await inspectLiveTypeDbGraphCounts(disposableConfig);
        expect(countsAfterRollback.counts).toEqual(counts1.counts);

        // D. Hydrate nodes, relationships, executives, and observations FROM LIVE TYPEDB ONLY
        //    (`datasets` is intentionally OMITTED so static JSON cannot supply Case 007 data!)
        const liveNvdaSummary = await executeAllowlistedGraphQuery(
          {
            queryType: 'organisation_relationship_summary',
            organisationId: 'org-nvda',
            asOfMs: CASE_007_PRE_EARNINGS_CAPTURED_AT_MS,
            temporalBasis: 'receipt',
            maxDepth: 2,
            maxNodes: 40,
            maxEdges: 50,
          },
          {
            callerId: 'case007_live_verifier',
            preferLiveTypeDb: true,
            requireLiveGraph: true,
            typeDbConfig: disposableConfig,
          },
        );

        expect(liveNvdaSummary.backendMode).toBe('typedb_live');
        expect(liveNvdaSummary.graphSourceMode).toBe('LIVE_GRAPH');
        expect(liveNvdaSummary.typedbServerVersion).toBe('3.14.2');

        // Verify executive nodes hydrated from TypeDB
        const nodeIds = liveNvdaSummary.nodes.map((n) => n.id);
        expect(nodeIds).toEqual(
          expect.arrayContaining([
            'org-nvda',
            'org-anthropic',
            'org-spacex',
            'org-intc',
            'org-crwv',
            'person-jensen-huang',
            'person-colette-kress',
            'person-harvey-jones',
          ]),
        );

        // Verify leadership_appointment, contingent Class N placement, and 13F stakes hydrated from TypeDB
        const kressEdge = liveNvdaSummary.edges.find(
          (e) => e.relationshipId === 'rel-case007-nvda-kress-interim-ceo-r1',
        )!;
        expect(kressEdge).toBeDefined();
        expect(kressEdge.relationType).toBe('leadership_appointment');
        expect(kressEdge.isInterim).toBe(true);
        expect(kressEdge.participants.map((p) => p.label)).toEqual(
          expect.arrayContaining(['NVIDIA', 'Colette Kress', 'Jensen Huang']),
        );

        const nvdaCppEdge = liveNvdaSummary.edges.find(
          (e) => e.relationshipId === 'rel-case007-nvda-anthropic-pp-r1',
        )!;
        expect(nvdaCppEdge.epistemicStatus).toBe('proposed');
        expect(nvdaCppEdge.contractualStatus).toBe('contingent_signed');
        expect(nvdaCppEdge.principalAmount).toBe(10_000_000_000);

        // Superseded Anthropic IPO v1 is hidden by default while v2 is active
        const edgeIds = liveNvdaSummary.edges.map((e) => e.relationshipId);
        expect(edgeIds).toContain('rel-case007-anthropic-ipo-r2');
        expect(edgeIds).not.toContain('rel-case007-anthropic-ipo-r1');

        // Verify financial observations hydrated from TypeDB
        expect(liveNvdaSummary.observations.map((o) => o.observationId)).toEqual(
          expect.arrayContaining([
            'obs-nvda-q2fy27-actual-rev',
            'obs-nvda-q3fy27-guidance-rev',
            'obs-nvda-13f-q3-2026-total-portfolio',
            'obs-anthropic-9m2026-uncommenced-leases',
          ]),
        );

        // E. Prove additive schema upgrade from v1 (without executive_person) -> v1.1 preserving existing edges
        await baseDriver.deleteDatabase(v1UpgradeDb).catch(() => {});
        await baseDriver.createDatabase(v1UpgradeDb);
        const legacySchema = (await import('../lib/graph/typedb-schema'))
          .loadPinnedTypeQlSchema()
          .replace(/attribute person_id[\s\S]*?attribute is_interim, value boolean;\s*/, '')
          .replace(/,\s*plays leadership_appointment:governed_organisation;/, ';')
          .replace(/entity executive_person[\s\S]*?plays leadership_appointment:predecessor_officer;\s*/, '')
          .replace(/relation leadership_appointment[\s\S]*?relates predecessor_officer;\s*/, '');
        const sTx = await baseDriver.openTransaction(v1UpgradeDb, 'schema');
        if (isApiErrorResponse(sTx)) throw new Error(sTx.err.message);
        const sQ = await baseDriver.query(sTx.ok.transactionId, legacySchema);
        if (isApiErrorResponse(sQ)) throw new Error(sQ.err.message);
        await baseDriver.commitTransaction(sTx.ok.transactionId);

        const upgradeConfig: TypeDbConnectionConfig = {
          ...disposableConfig,
          databaseName: v1UpgradeDb,
        };
        const initialDs = loadInitialAcceptanceDataset();
        await projectDatasetIntoLiveTypeDb(initialDs, {
          config: upgradeConfig,
          recreateDatabase: false,
        });
        await projectDatasetIntoLiveTypeDb(case007.dataset, {
          config: upgradeConfig,
          recreateDatabase: false,
        });
        const mergedCounts = await inspectLiveTypeDbGraphCounts(upgradeConfig);
        expect(mergedCounts.counts?.executivePersons).toBe(3);
        expect(mergedCounts.counts?.macroRelationships).toBe(
          initialDs.relationships.length + case007.dataset.relationships.length,
        );

        // F. Fail closed on unsupported foreign schema (no internal host/credential leak, no static fallback)
        await baseDriver.deleteDatabase(badSchemaDb).catch(() => {});
        await baseDriver.createDatabase(badSchemaDb);
        const bTx = await baseDriver.openTransaction(badSchemaDb, 'schema');
        if (isApiErrorResponse(bTx)) throw new Error(bTx.err.message);
        await baseDriver.query(
          bTx.ok.transactionId,
          'define attribute foreign_attr, value string; entity foreign_node, owns foreign_attr;',
        );
        await baseDriver.commitTransaction(bTx.ok.transactionId);

        const badConfig: TypeDbConnectionConfig = {
          ...disposableConfig,
          databaseName: badSchemaDb,
        };
        await expect(hydrateMacroDatasetFromLiveTypeDb(badConfig)).rejects.toThrow(
          TypeDbSchemaOrHydrationError,
        );
        await expect(
          executeAllowlistedGraphQuery(
            { queryType: 'organisation_relationship_summary', organisationId: 'org-nvda' },
            { callerId: 'tester', preferLiveTypeDb: true, typeDbConfig: badConfig },
          ),
        ).rejects.toThrow(/Unsupported TypeDB database schema/);

        // Also verify API route returns 502 with sanitized error and zero credential/host leak
        const prevDbEnv = process.env.TYPEDB_DATABASE;
        process.env.TYPEDB_DATABASE = badSchemaDb;
        try {
          const apiReq = new NextRequest('https://capital.aiguides.co.uk/api/graph/query', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-aci-test-caller': 'owner_api_test',
            },
            body: JSON.stringify({
              queryType: 'organisation_relationship_summary',
              organisationId: 'org-nvda',
            }),
          });
          const apiRes = await graphGatewayPost(apiReq);
          expect(apiRes.status).toBe(502);
          const apiJson = (await apiRes.json()) as {
            error: string;
            graphSourceMode: string;
          };
          expect(apiJson.graphSourceMode).toBe('GRAPH_UNAVAILABLE');
          expect(apiJson.error).not.toContain('127.0.0.1');
          expect(apiJson.error).not.toContain('password');
        } finally {
          if (prevDbEnv === undefined) delete process.env.TYPEDB_DATABASE;
          else process.env.TYPEDB_DATABASE = prevDbEnv;
        }

        // G. Gate 1 & Gate 2 Anti-Static-Leakage Proof:
        //    Project a 1-relationship sentinel dataset into TypeDB, then call executeAllowlistedGraphQuery
        //    WHILE explicitly passing `datasets: [loadInitialAcceptanceDataset()]`. Prove ZERO static
        //    relationships or observations from `initial-acceptance-dataset.json` leak into LIVE_GRAPH.
        const sentinelDataset = {
          ...case007.dataset,
          organisations: case007.dataset.organisations.filter((o) =>
            ['org-nvda', 'org-anthropic'].includes(o.orgId),
          ),
          executives: [],
          instruments: [],
          sources: case007.dataset.sources.filter(
            (s) => s.sourceDocId === 'doc-anthropic-s1a2-20261110',
          ),
          observations: [
            {
              ...case007.dataset.observations[0]!,
              observationId: 'obs-sentinel-live-only-1',
              subjectOrgId: 'org-nvda',
              sourceDocIds: ['doc-anthropic-s1a2-20261110'],
            },
          ],
          relationships: [
            {
              ...case007.dataset.relationships.find(
                (r) => r.relationshipId === 'rel-case007-nvda-anthropic-hw-partnership-r1',
              )!,
              relationshipId: 'rel-sentinel-live-only-r1',
            },
          ],
        };
        const sentinelConfig: TypeDbConnectionConfig = {
          ...disposableConfig,
          databaseName: sentinelDb,
        };
        await projectDatasetIntoLiveTypeDb(sentinelDataset, {
          config: sentinelConfig,
          recreateDatabase: true,
        });

        const sentinelLiveQuery = await executeAllowlistedGraphQuery(
          {
            queryType: 'as_known_at_date_graph',
            asOfMs: CASE_007_PRE_EARNINGS_CAPTURED_AT_MS,
            temporalBasis: 'receipt',
          },
          {
            callerId: 'sentinel_verifier',
            datasets: [loadInitialAcceptanceDataset()],
            preferLiveTypeDb: true,
            requireLiveGraph: true,
            typeDbConfig: sentinelConfig,
          },
        );
        expect(sentinelLiveQuery.graphSourceMode).toBe('LIVE_GRAPH');
        expect(sentinelLiveQuery.edges.map((e) => e.relationshipId)).toEqual([
          'rel-sentinel-live-only-r1',
        ]);
        expect(sentinelLiveQuery.observations.map((o) => o.observationId)).toEqual([
          'obs-sentinel-live-only-1',
        ]);
        expect(
          sentinelLiveQuery.edges.some((e) => e.relationshipId === 'rel-loughton-msft-r2'),
        ).toBe(false);
      } finally {
        await baseDriver.deleteDatabase(disposableDb).catch(() => {});
        await baseDriver.deleteDatabase(v1UpgradeDb).catch(() => {});
        await baseDriver.deleteDatabase(badSchemaDb).catch(() => {});
        await baseDriver.deleteDatabase(sentinelDb).catch(() => {});
      }
    },
    60_000,
  );

  it('6. Validates Case 007-B post-earnings batch (9 new sources, 17 observations, 10 relationships), blocklist retention of 0001045810-26-000078, SHA-256 reconciliation, and 2026-11-17T20:59:30Z temporal isolation in MacroDataRoom', async () => {
    const postRun = runCase007PostEarningsPipeline();

    expect(postRun.bundleId).toBe(CASE_007_POST_RESULTS_BUNDLE_ID);
    expect(postRun.executionAuthority).toBe('none');
    expect(postRun.newPrimarySources).toHaveLength(9);
    expect(postRun.newObservations).toHaveLength(17);
    expect(postRun.newRelationships).toHaveLength(10);
    expect(postRun.dataset.sources).toHaveLength(16);
    expect(postRun.dataset.observations).toHaveLength(21);
    expect(postRun.dataset.relationships).toHaveLength(30);
    expect(postRun.outboxItems).toHaveLength(30);
    expect(postRun.additiveOutboxItems).toHaveLength(10);

    // Isolated write-target & non-destructive protections
    expect(() =>
      assertIsolatedCase007BWriteTarget(CASE_007B_VERIFIED_DEV_DATABASE),
    ).not.toThrow();
    expect(() => assertIsolatedCase007BWriteTarget(CASE_007_VERIFIED_DEV_DATABASE)).toThrow(
      /aci_case007b_verified_dev/,
    );
    expect(() => assertIsolatedCase007BWriteTarget(STAGING_TYPEDB_DATABASE)).toThrow(
      /aci_case007b_verified_dev/,
    );
    expect(() => assertIsolatedCase007BWriteTarget(PRODUCTION_TYPEDB_DATABASE)).toThrow(
      /aci_case007b_verified_dev/,
    );
    expect(() => assertCanRecreateTypeDbDatabase(CASE_007_VERIFIED_DEV_DATABASE)).toThrow(
      /destructive recreateDatabase is forbidden/,
    );
    expect(() => assertCanRecreateTypeDbDatabase(CASE_007B_VERIFIED_DEV_DATABASE)).toThrow(
      /destructive recreateDatabase is forbidden/,
    );

    // Blocklist retains 0001045810-26-000078 and all 7 disputed G9 records
    expect(() => assertNoDisputedG9SecRecordsPostEarnings(postRun.dataset)).not.toThrow();
    expect(() =>
      assertNoDisputedG9SecRecordsPostEarnings({
        ...postRun.dataset,
        sources: [
          ...postRun.dataset.sources,
          {
            ...postRun.dataset.sources[0]!,
            sourceDocId: 'blocked-hf-000078',
            title: 'Blocked accession 0001045810-26-000078',
          },
        ],
      }),
    ).toThrow(/0001045810-26-000078/);

    // Hugging Face pending acquisition represented with principalAmount: null and proposed/contingent_signed
    const hfRel = postRun.dataset.relationships.find(
      (r) => r.relationshipId === 'rel-case007b-nvda-huggingface-pending-acq-r1',
    )!;
    expect(hfRel.principalAmount).toBeNull();
    expect(hfRel.epistemicStatus).toBe('proposed');
    expect(hfRel.contractualStatus).toBe('contingent_signed');
    expect(hfRel.bindingObligation).toBe(false);

    // Historical $108B Q3 forecast preserved alongside $115.844B Q3 actual and $130B Q4 official 14-week forecast
    const q3Forecast = postRun.dataset.observations.find(
      (o) => o.observationId === 'obs-nvda-q3fy27-guidance-rev',
    )!;
    const q3Actual = postRun.dataset.observations.find(
      (o) => o.observationId === 'obs-nvda-q3fy27-actual-rev',
    )!;
    const q4Forecast = postRun.dataset.observations.find(
      (o) => o.observationId === 'obs-nvda-q4fy27-guidance-rev',
    )!;
    expect(q3Forecast.metricValue).toBe(108_000_000_000);
    expect(q3Forecast.observationKind).toBe('forecast');
    expect(q3Actual.metricValue).toBe(115_844_000_000);
    expect(q3Actual.observationKind).toBe('reported');
    expect(q4Forecast.metricValue).toBe(130_000_000_000);
    expect(q4Forecast.observationKind).toBe('forecast');

    // Analytical $668B envelope & 13-week Q4 scenario are NOT stored as official observations
    expect(
      postRun.dataset.observations.some(
        (o) => o.metricValue === 668_000_000_000 || o.observationId.includes('13wk'),
      ),
    ).toBe(false);
    expect(postRun.omittedClaims).toHaveLength(3);
    expect(
      postRun.leadershipSha256Reconciliation.nvda20261111Htm
        .edgarOriginExactByteIdentityVerified,
    ).toBe(true);

    // Quarantine candidates block unverified oral call claims and proposed-as-funded ownership
    const qIds = postRun.quarantinedCandidates.map((q) => q.candidateId);
    expect(qIds).toEqual(
      expect.arrayContaining([
        'rel-case007b-quarantined-prompt-injection-r1',
        'rel-case007b-quarantined-oral-fy28-confirmed',
        'rel-case007b-quarantined-huggingface-marked-funded',
        'rel-case007b-quarantined-sbenergy-105b-marked-funded',
        'staged-e2523ed83a7c0247',
      ]),
    );

    // UI Temporal Isolation Proof in MacroDataRoom at 2026-11-17T20:59:30Z vs 2026-11-18T01:35:00Z
    const benchmark = await runGraphVsConvexBenchmark(postRun.dataset);
    const preHtml = renderToStaticMarkup(
      createElement(MacroDataRoom, {
        dataset: postRun.dataset,
        benchmark,
        graphSourceMode: 'LIVE_GRAPH',
        initialFocalId: 'org-nvda',
        initialAsOfMs: CASE_007_PRE_EARNINGS_CAPTURED_AT_MS,
        initialTemporalBasis: 'receipt',
        liveTypeDbStatus: {
          reachable: true,
          authenticated: true,
          databaseExists: true,
          databaseName: CASE_007B_VERIFIED_DEV_DATABASE,
          distribution: 'TypeDB',
          version: '3.14.2',
          tlsEnabled: true,
        },
      }),
    );
    expect(preHtml).toContain('obs-nvda-q3fy27-guidance-rev');
    expect(preHtml).not.toContain('obs-nvda-q3fy27-actual-rev');
    expect(preHtml).not.toContain('obs-nvda-q4fy27-guidance-rev');
    expect(preHtml).not.toContain('rel-case007b-nvda-sbenergy-openai-ports-guarantee-r1');

    const postHtml = renderToStaticMarkup(
      createElement(MacroDataRoom, {
        dataset: postRun.dataset,
        benchmark,
        graphSourceMode: 'LIVE_GRAPH',
        initialFocalId: 'org-nvda',
        initialAsOfMs: CASE_007B_POST_EARNINGS_INGESTED_AT_MS,
        initialTemporalBasis: 'receipt',
        liveTypeDbStatus: {
          reachable: true,
          authenticated: true,
          databaseExists: true,
          databaseName: CASE_007B_VERIFIED_DEV_DATABASE,
          distribution: 'TypeDB',
          version: '3.14.2',
          tlsEnabled: true,
        },
      }),
    );
    expect(postHtml).toContain('obs-nvda-q3fy27-guidance-rev');
    expect(postHtml).toContain('obs-nvda-q3fy27-actual-rev');
    expect(postHtml).toContain('obs-nvda-q4fy27-guidance-rev');
    expect(postHtml).toContain('rel-case007b-nvda-sbenergy-openai-ports-guarantee-r1');
  });
});
