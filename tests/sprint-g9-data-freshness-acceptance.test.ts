import { describe, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import schema from '../convex/schema';
import {
  evaluateBrokerConnectionSourceHealth,
  evaluateMarketObservationSourceHealth,
  evaluateStressMonitorSourceHealth,
  resolveUsEquitySessionSchedule,
} from '../lib/remote-ops/source-health-contract';
import { freshness, accountKpis } from '../lib/portfolio/performance';
import {
  buildExecutiveMarketBriefing,
  evaluateUniverseResearchAssessments,
} from '../lib/research-ratings/engine';
import { selectCurrentSecXbrlFact } from '../lib/remote-ops/sec-xbrl-fact-selector';
import { validateStagedItem } from '../lib/remote-ops/staging-validator';
import { executionPermitted, assertExecutionPermitted } from '../lib/trading/execution-boundary';
import { encryptCredentials } from '../lib/brokers/vault';
import { BROKER_BASE_URLS, type BrokerSyncSnapshot } from '../lib/brokers/contracts';

const brokerModules = {
  './_generated/server.ts': async () => ({}),
  './brokers.ts': () => import('../convex/brokers'),
};

const brokerMutation = (name: string) =>
  makeFunctionReference<'mutation'>(`brokers:${name}`);
const brokerQuery = (name: string) =>
  makeFunctionReference<'query'>(`brokers:${name}`);

describe('Sprint G9 — End-to-End Data Freshness, News Ingestion and Broker Connection Acceptance Suite', () => {
  it('1. Broker status when Live is connected and Demo is unconfigured (independent environment contracts)', () => {
    const nowMs = Date.parse('2026-11-15T16:45:00Z');
    const liveSyncAtMs = Date.parse('2026-11-15T16:40:00Z'); // 5m ago

    const liveHealth = evaluateBrokerConnectionSourceHealth({
      environment: 'live',
      nowMs,
      connection: {
        status: 'connected',
        maskedKey: '••••FVft',
        lastAttemptAt: liveSyncAtMs,
        lastVerifiedAt: liveSyncAtMs,
        lastSuccessfulSyncAt: liveSyncAtMs,
        lastErrorCode: null,
      },
      summaryRetrievedAtMs: liveSyncAtMs,
      scheduleEnabled: false,
    });

    const demoHealth = evaluateBrokerConnectionSourceHealth({
      environment: 'demo',
      nowMs,
      connection: null,
      summaryRetrievedAtMs: null,
    });

    expect(liveHealth.environment).toBe('live');
    expect(liveHealth.dataMode).toBe('LIVE_BROKER_READONLY');
    expect(liveHealth.status).toBe('HEALTHY');
    expect(liveHealth.provenance).toContain('••••FVft');

    expect(demoHealth.environment).toBe('demo');
    expect(demoHealth.dataMode).toBe('DEMO_BROKER_READONLY');
    expect(demoHealth.status).toBe('NOT_CONNECTED');
    expect(demoHealth.latestSourceTimestamp).toBeNull();
  });

  it('2. Stale broker snapshot detection when lastSyncAt exceeds 15-minute threshold (e.g. 2026-11-15 03:08 UTC viewed at 16:42 UTC)', () => {
    const nowMs = Date.parse('2026-11-15T16:42:00Z');
    const staleSyncAtMs = Date.parse('2026-11-15T03:08:54.049Z'); // ~13.5 hours ago

    const f = freshness(staleSyncAtMs, nowMs);
    expect(f.state).toBe('stale');
    expect(f.ageMs).toBeGreaterThan(13 * 3600_000);

    const liveStaleHealth = evaluateBrokerConnectionSourceHealth({
      environment: 'live',
      nowMs,
      connection: {
        status: 'connected',
        maskedKey: '••••FVft',
        lastAttemptAt: staleSyncAtMs,
        lastVerifiedAt: staleSyncAtMs,
        lastSuccessfulSyncAt: staleSyncAtMs,
        lastErrorCode: null,
      },
      summaryRetrievedAtMs: staleSyncAtMs,
      scheduleEnabled: false,
    });

    expect(liveStaleHealth.status).toBe('STALE');
    expect(liveStaleHealth.detail).toContain('Automatic background sync is not enabled');
  });

  it('3. Broker refresh updates portfolio summary, valuation history, and freshness timestamp', () => {
    const oldSyncMs = Date.parse('2026-11-15T03:08:54Z');
    const newSyncMs = Date.parse('2026-11-15T16:50:00Z');
    const nowMs = Date.parse('2026-11-15T16:52:00Z');

    const beforeSnap = {
      currency: 'GBP',
      totalValue: 236.15,
      cash: 0,
      investedCost: 249.62,
      investmentsValue: 236.15,
      realised: 0,
      unrealised: -13.47,
      summaryAt: oldSyncMs,
      positions: [],
      positionsAt: oldSyncMs,
      source: BROKER_BASE_URLS.live + '/equity/account/summary',
    };
    const beforeKpis = accountKpis(
      beforeSnap,
      [{ observedAt: oldSyncMs, totalValue: 236.15, cash: 0, investedCost: 249.62, investmentsValue: 236.15, realisedProfitLoss: 0, unrealisedProfitLoss: -13.47, currency: 'GBP' }],
      [],
      nowMs,
      'Trading 212',
    );
    expect(freshness(beforeSnap.summaryAt, nowMs).state).toBe('stale');
    expect(beforeKpis?.totalValue.ok && beforeKpis.totalValue.value).toBe(236.15);

    const afterSnap = {
      ...beforeSnap,
      totalValue: 241.80,
      investmentsValue: 241.80,
      unrealised: -7.82,
      summaryAt: newSyncMs,
      positionsAt: newSyncMs,
    };
    const afterKpis = accountKpis(
      afterSnap,
      [
        { observedAt: oldSyncMs, totalValue: 236.15, cash: 0, investedCost: 249.62, investmentsValue: 236.15, realisedProfitLoss: 0, unrealisedProfitLoss: -13.47, currency: 'GBP' },
        { observedAt: newSyncMs, totalValue: 241.80, cash: 0, investedCost: 249.62, investmentsValue: 241.80, realisedProfitLoss: 0, unrealisedProfitLoss: -7.82, currency: 'GBP' },
      ],
      [],
      nowMs,
      'Trading 212',
    );

    expect(freshness(afterSnap.summaryAt, nowMs).state).toBe('fresh');
    expect(afterKpis?.totalValue.ok && afterKpis.totalValue.value).toBe(241.80);
    expect(afterKpis?.totalValue.ok && afterKpis.totalValue.observedAt).toBe(newSyncMs);
  });

  it('4. Market observation freshness across weekday, weekend (2026-11-13 on Sunday 2026-11-15), and stale (2026-11-04 on 2026-11-15) scenarios', () => {
    const sundayNowMs = Date.parse('2026-11-15T16:45:00Z');
    const fridayCloseMs = Date.parse('2026-11-13T21:00:00Z');
    const staleNov4CloseMs = Date.parse('2026-11-04T21:00:00Z');

    const schedule = resolveUsEquitySessionSchedule(sundayNowMs);
    expect(schedule.latestCompletedSessionDateIso).toBe('2026-11-13');
    expect(schedule.isWeekendOrAfterCloseWait).toBe(true);

    // Scenario A: Weekend with Friday 2026-11-13 close present -> EXPECTED_DELAY (not false STALE)
    const weekendHealth = evaluateMarketObservationSourceHealth({
      nowMs: sundayNowMs,
      latestObservationAtMs: fridayCloseMs,
      latestServerReceivedAtMs: Date.parse('2026-11-15T16:49:03Z'),
      lastAttemptAtMs: Date.parse('2026-11-15T16:49:03Z'),
      lastSuccessAtMs: Date.parse('2026-11-15T16:49:03Z'),
      lastErrorCode: null,
      licensedFeedConfigured: false,
      corporateActionsReviewed: false,
      coveredSymbolsCount: 8,
    });
    expect(weekendHealth.status).toBe('EXPECTED_DELAY');
    expect(weekendHealth.detail).toContain('2026-11-13');

    // Scenario B: Stale 2026-11-04 observation viewed on 2026-11-15 -> STALE
    const staleHealth = evaluateMarketObservationSourceHealth({
      nowMs: sundayNowMs,
      latestObservationAtMs: staleNov4CloseMs,
      latestServerReceivedAtMs: staleNov4CloseMs,
      lastAttemptAtMs: sundayNowMs,
      lastSuccessAtMs: staleNov4CloseMs,
      lastErrorCode: null,
      licensedFeedConfigured: false,
      corporateActionsReviewed: false,
      coveredSymbolsCount: 8,
    });
    expect(staleHealth.status).toBe('STALE');

    // Scenario C: Weekday with licensed & corporate-action-reviewed feed -> HEALTHY
    const weekdayNowMs = Date.parse('2026-11-13T22:00:00Z');
    const weekdayLicensedHealth = evaluateMarketObservationSourceHealth({
      nowMs: weekdayNowMs,
      latestObservationAtMs: fridayCloseMs,
      latestServerReceivedAtMs: weekdayNowMs,
      lastAttemptAtMs: weekdayNowMs,
      lastSuccessAtMs: weekdayNowMs,
      lastErrorCode: null,
      licensedFeedConfigured: true,
      corporateActionsReviewed: true,
      coveredSymbolsCount: 8,
    });
    expect(weekdayLicensedHealth.status).toBe('HEALTHY');
  });

  it('5. Market Stress Monitor handling of connected unadjusted EOD observations vs missing split-adjusted drawdown provider (LICENCE_REQUIRED)', () => {
    const nowMs = Date.parse('2026-11-15T16:45:00Z');
    const fridayCloseMs = Date.parse('2026-11-13T21:00:00Z');

    const unadjustedOnly = evaluateStressMonitorSourceHealth({
      nowMs,
      persistedUnadjustedSymbolsCount: 8,
      latestPersistedObsAtMs: fridayCloseMs,
      importedDatasetVerified: false,
      importedDatasetAsOfMs: null,
      syntheticModeActive: false,
    });
    expect(unadjustedOnly.status).toBe('LICENCE_REQUIRED');
    expect(unadjustedOnly.errorCode).toBe('corporate_actions_unverified_for_drawdown_series');

    const syntheticDemo = evaluateStressMonitorSourceHealth({
      nowMs,
      persistedUnadjustedSymbolsCount: 8,
      latestPersistedObsAtMs: fridayCloseMs,
      importedDatasetVerified: false,
      importedDatasetAsOfMs: null,
      syntheticModeActive: true,
    });
    expect(syntheticDemo.dataMode).toBe('SYNTHETIC_FIXTURE');
    expect(syntheticDemo.licenceState).toBe('SYNTHETIC_DEMO_ONLY');
  });

  it('6. Executive Market Briefing date and freshness alignment with underlying 2026-11-13 QQQ and 8-symbol watchlist evidence', () => {
    const nowMs = Date.parse('2026-11-15T16:50:00Z');
    const fridayCloseMs = Date.parse('2026-11-13T21:00:00Z');
    const liveWatchlist = [
      { ticker: 'MSFT', close: 523.88, closeGbp: 396.08, usdToGbp: 0.75605, closeAt: fridayCloseMs, corporateActionsReviewed: false },
      { ticker: 'GOOGL', close: 295.77, closeGbp: 223.62, usdToGbp: 0.75605, closeAt: fridayCloseMs, corporateActionsReviewed: false },
      { ticker: 'AMZN', close: 266.66, closeGbp: 201.61, usdToGbp: 0.75605, closeAt: fridayCloseMs, corporateActionsReviewed: false },
      { ticker: 'NVDA', close: 162.85, closeGbp: 123.12, usdToGbp: 0.75605, closeAt: fridayCloseMs, corporateActionsReviewed: false },
      { ticker: 'CRWV', close: 53.13, closeGbp: 40.17, usdToGbp: 0.75605, closeAt: fridayCloseMs, corporateActionsReviewed: false },
      { ticker: 'INTC', close: 59.66, closeGbp: 45.11, usdToGbp: 0.75605, closeAt: fridayCloseMs, corporateActionsReviewed: false },
      { ticker: 'AMD', close: 534.06, closeGbp: 403.78, usdToGbp: 0.75605, closeAt: fridayCloseMs, corporateActionsReviewed: false },
      { ticker: 'QQQ', close: 679.89, closeGbp: 514.03, usdToGbp: 0.75605, closeAt: fridayCloseMs, corporateActionsReviewed: false },
    ];

    const assessments = evaluateUniverseResearchAssessments({
      asOfMs: nowMs,
      liveWatchlist,
    });
    const amdRow = assessments.find((a) => a.ticker === 'AMD')!;
    expect(amdRow.latestPrice.close).toBe(534.06);
    expect(amdRow.latestPrice.timestampIso?.slice(0, 10)).toBe('2026-11-13');

    const briefing = buildExecutiveMarketBriefing(assessments, {
      liveWatchlist,
      nowMs,
      reportGeneratedAtMs: Date.parse('2026-11-15T16:49:21Z'),
    });

    expect(briefing.asOfDateIso).toBe('2026-11-13');
    expect(briefing.headingLabel).toBe('Research as of 2026-11-13');
    expect(briefing.isMarketObservationStale).toBe(false);
    expect(briefing.provenanceMode).toBe('live_persisted_observations_deterministic');
    expect(briefing.sentences.marketEnvironment).toContain('2026-11-13');
    expect(briefing.sentences.marketEnvironment).toContain('$679.89 USD');
  });

  it('7. News ingestion deduplication and strict separation of publishedAt vs serverReceivedAt', () => {
    const publishedAt = Date.parse('2026-10-30T14:00:00Z');
    const sourceRetrievedAt = Date.parse('2026-11-15T16:49:00Z');
    const serverReceivedAt = Date.parse('2026-11-15T16:49:03Z');
    const candidate = {
      externalId: 'sec-10q-msft-2026q3',
      sourceUrl: 'https://www.sec.gov/Archives/edgar/data/789019/000119312526436133/msft-20260930.htm',
      title: 'Microsoft FY27 Q1 Form 10-Q Capital Expenditure Disclosure',
      text: 'Microsoft Corporation Form 10-Q for the quarterly period ended September 30, 2026 reports additions to property and equipment of $39,367 million.',
      summary: 'Microsoft reported quarterly property and equipment additions from primary SEC XBRL filing.',
      hypothesis: 'Cloud capacity additions remain primary-source verified.',
      publishedAt,
      receivedAt: sourceRetrievedAt,
      entities: ['MSFT'],
      claims: [
        {
          id: 'claim-msft-capex-2026q3',
          entity: 'MSFT',
          metric: 'additions_to_property_and_equipment',
          value: 39367,
          unit: 'USD_millions',
          period: 'FY27-Q1',
          definition: 'Additions to property and equipment (GAAP cash flow statement)',
          excerpt: 'Additions to property and equipment: $39,367 million.',
          classification: 'reported' as const,
          isPrimarySource: true,
          primarySourceUrl: 'https://www.sec.gov/Archives/edgar/data/789019/000119312526436133/msft-20260930.htm',
        },
      ],
      primarySourceUrl: 'https://www.sec.gov/Archives/edgar/data/789019/000119312526436133/msft-20260930.htm',
    };

    const firstPass = validateStagedItem(candidate, {
      now: serverReceivedAt,
      seenUrls: new Set(),
      seenContentHashes: new Set(),
      seenFactKeys: new Set(),
    });
    expect(firstPass.validationStatus).toBe('promoted');
    expect(firstPass.publishedAt).toBe(publishedAt);
    expect(firstPass.sourceRetrievedAt).toBe(sourceRetrievedAt);
    expect(firstPass.serverReceivedAt).toBe(serverReceivedAt);
    expect(firstPass.publishedAt).toBeLessThan(firstPass.serverReceivedAt);

    const duplicatePass = validateStagedItem(candidate, {
      now: serverReceivedAt + 1000,
      seenUrls: new Set([firstPass.canonicalUrl]),
      seenContentHashes: new Set([firstPass.contentSha256]),
      seenFactKeys: new Set(),
    });
    expect(duplicatePass.validationStatus).toBe('duplicate');
  });

  it('8. SEC filing period/date mapping rejects obsolete 2017/2020 tags and selects current 2026 reporting period facts', () => {
    const asOfMs = Date.parse('2026-11-15T16:49:03Z');
    const nvdaHeader = {
      ticker: 'NVDA',
      cik: '0001045810',
      name: 'NVIDIA Corp.',
      accession: '0001045810-26-000075',
      form: '10-Q',
      filed: '2026-08-26',
      reportDate: '2026-07-26',
      docUrl: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000075/nvda-20260726.htm',
      publishedMs: Date.parse('2026-08-26T20:00:00Z'),
      receivedMs: asOfMs,
    };

    const factsPayload = {
      cik: '0001045810',
      entityName: 'NVIDIA CORP',
      facts: {
        'us-gaap': {
          // Obsolete tag last used by NVDA in Q2 2020:
          PaymentsToAcquirePropertyPlantAndEquipment: {
            units: {
              USD: [
                {
                  val: 367_000_000,
                  fy: 2020,
                  fp: 'Q2',
                  form: '10-Q',
                  filed: '2020-08-19',
                  accn: '0001045810-20-000147',
                  start: '2020-04-27',
                  end: '2020-07-26',
                  frame: 'CY2020Q2',
                },
              ],
            },
          },
          // Current tag used by NVDA in FY27 Q2 (ended 2026-07-26):
          PaymentsToAcquireProductiveAssets: {
            units: {
              USD: [
                {
                  val: 2_677_000_000,
                  fy: 2027,
                  fp: 'Q2',
                  form: '10-Q',
                  filed: '2026-08-26',
                  accn: '0001045810-26-000075',
                  start: '2026-04-27',
                  end: '2026-07-26',
                  frame: 'CY2026Q2',
                },
              ],
            },
          },
        },
      },
    };

    const selected = selectCurrentSecXbrlFact({
      factsPayload,
      header: nvdaHeader,
      asOfMs,
    });

    expect(selected.eligible).toBe(true);
    expect(selected.isCurrentReportingPeriod).toBe(true);
    expect(selected.conceptName).toBe('PaymentsToAcquireProductiveAssets');
    expect(selected.periodEnd).toBe('2026-07-26');
    expect(selected.valueBillions).toBe(2.68);
  });

  it('9. Cross-user isolation of broker connections and snapshots', async () => {
    const t = convexTest(schema, brokerModules);
    const mockVaultEnv = {
      BROKER_VAULT_KEY_B64: Buffer.alloc(32, 0x5a).toString('base64'),
      BROKER_VAULT_KEY_VERSION: 'v1',
    };
    const ownerA = 'https://complete-bunny-8662.clerk.accounts.dev|user_owner_A';
    const ownerB = 'https://complete-bunny-8662.clerk.accounts.dev|user_owner_B';
    const clientA = t.withIdentity({ tokenIdentifier: ownerA, subject: 'user_owner_A' });
    const clientB = t.withIdentity({ tokenIdentifier: ownerB, subject: 'user_owner_B' });

    const encrypted = encryptCredentials(
      { apiKey: 'live-key-owner-a', apiSecret: 'live-secret-owner-a' },
      ownerA,
      'live',
      mockVaultEnv,
      'read',
    );

    const saved = (await t.mutation(brokerMutation('saveInternal'), {
      owner: ownerA,
      environment: 'live',
      maskedKey: '••••FVft',
      encryptedPayload: JSON.stringify(encrypted),
    })) as { connectionId: string };

    const lease = (await t.mutation(brokerMutation('acquireSyncInternal'), {
      owner: ownerA,
      connectionId: saved.connectionId,
      environment: 'live',
      operation: 'sync',
    })) as { ok: boolean; leaseToken: string; revision: number };

    const snap: BrokerSyncSnapshot = {
      scope: 'sync',
      summary: {
        provider: 'trading212',
        environment: 'live',
        sourceUrl: BROKER_BASE_URLS.live + '/equity/account/summary',
        retrievedAt: Date.now(),
        data: {
          accountId: 'live-212-a',
          currency: 'GBP',
          totalValue: 236.15,
          cash: { availableToTrade: 0, reservedForOrders: 0, inPies: 0 },
          investments: { currentValue: 236.15, totalCost: 249.62, realizedProfitLoss: 0, unrealizedProfitLoss: -13.47 },
        },
      },
      positions: {
        provider: 'trading212',
        environment: 'live',
        sourceUrl: BROKER_BASE_URLS.live + '/equity/positions',
        retrievedAt: Date.now(),
        data: [],
      },
      transactions: null,
      historyErrorCode: null,
    };

    await t.mutation(brokerMutation('recordSyncInternal'), {
      owner: ownerA,
      connectionId: saved.connectionId,
      environment: 'live',
      leaseToken: lease.leaseToken,
      revision: lease.revision,
      snapshotJson: JSON.stringify(snap),
    });

    const listA = await clientA.query(brokerQuery('list'), {});
    const listB = await clientB.query(brokerQuery('list'), {});
    expect(listA).toHaveLength(1);
    expect(listB).toHaveLength(0);

    await expect(
      clientB.query(brokerQuery('detail'), { connectionId: saved.connectionId }),
    ).rejects.toThrow('Connection unavailable');
  });

  it('10. Zero live or demo order execution paths enabled (compile-time and runtime hard boundary)', () => {
    expect(executionPermitted()).toBe(false);
    expect(() => assertExecutionPermitted('submit_order')).toThrow(/executionAuthority: none/i);
  });
});
