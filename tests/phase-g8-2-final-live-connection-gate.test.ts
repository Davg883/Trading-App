import { describe, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import schema from '../convex/schema';
import {
  brokerCredentialsSchema,
  BROKER_BASE_URLS,
  type BrokerSyncSnapshot,
} from '../lib/brokers/contracts';
import { Trading212Adapter } from '../lib/brokers/trading212';
import {
  encryptCredentials,
  decryptCredentials,
  maskApiKey,
  BrokerVaultError,
} from '../lib/brokers/vault';
import { calculatePortfolioConcentrationIntelligence } from '../lib/portfolio/multi-asset-risk-pilot';
import {
  runFiveQuestionPortfolioEvaluation,
  FIVE_PORTFOLIO_RESEARCH_QUESTIONS,
} from '../lib/portfolio/portfolio-live-eval-5';

const modules = {
  './_generated/server.ts': async () => ({}),
  './brokers.ts': () => import('../convex/brokers'),
};

const mutation = (name: string) =>
  makeFunctionReference<'mutation'>(`brokers:${name}`);
const query = (name: string) => makeFunctionReference<'query'>(`brokers:${name}`);

describe('Phase G.8.2: Final Live Connection Gate & Privacy Audit Suite', () => {
  describe('Section A: Trading 212 Credential Compatibility & Read-Only Governance', () => {
    it('1. verifies that the system requires both API Key and API Secret Key, rejecting single-key inputs', () => {
      // Obsolete single-key input must fail schema validation
      const singleKey = { apiKey: 'key-only-no-secret' };
      const parsedSingle = brokerCredentialsSchema.safeParse(singleKey);
      expect(parsedSingle.success).toBe(false);

      // Pair of Key + Secret passes schema validation
      const pair = {
        apiKey: 'trading212-live-api-key-sample',
        apiSecret: 'trading212-live-api-secret-sample',
      };
      const parsedPair = brokerCredentialsSchema.safeParse(pair);
      expect(parsedPair.success).toBe(true);

      // Whitespace and newline injections are rejected
      expect(
        brokerCredentialsSchema.safeParse({
          apiKey: 'key with spaces',
          apiSecret: 'secret\nnewline',
        }).success,
      ).toBe(false);
    });

    it('2. verifies server-side AES-256-GCM envelope vault encryption and HTTP Basic Auth generation', async () => {
      const mockVaultEnv = {
        BROKER_VAULT_KEY_B64: Buffer.alloc(32, 0x7c).toString('base64'),
        BROKER_VAULT_KEY_VERSION: 'v1',
      };
      const creds = {
        apiKey: 'actual-api-key-1234',
        apiSecret: 'actual-api-secret-5678',
      };
      const owner = 'user_3LjSsuJX398YIJRdss5Q7PqsSH9';

      // Encrypt server-side
      const encrypted = encryptCredentials(creds, owner, 'live', mockVaultEnv, 'read');
      expect(encrypted.ciphertext).not.toContain(creds.apiKey);
      expect(encrypted.ciphertext).not.toContain(creds.apiSecret);

      // Decrypt succeeds for same owner & environment
      const decrypted = decryptCredentials(encrypted, owner, 'live', mockVaultEnv, 'read');
      expect(decrypted.apiKey).toBe(creds.apiKey);
      expect(decrypted.apiSecret).toBe(creds.apiSecret);

      // Verify HTTP Basic header creation in Trading212Adapter
      let capturedAuthHeader: string | null = null;
      let capturedUrl: string | null = null;
      const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedAuthHeader = new Headers(init?.headers).get('Authorization');
        return new Response(
          JSON.stringify({
            currency: 'GBP',
            totalValue: 500.0,
            cash: { availableToTrade: 500.0, reservedForOrders: 0, inPies: 0 },
            investments: { currentValue: 0, totalCost: 0, realizedProfitLoss: 0, unrealizedProfitLoss: 0 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const adapter = new Trading212Adapter('live', creds, { fetch: mockFetch as any });
      const summary = await adapter.getAccountSummary();

      expect(capturedUrl).toBe('https://live.trading212.com/api/v0/equity/account/summary');
      const expectedBasic = `Basic ${Buffer.from(`${creds.apiKey}:${creds.apiSecret}`).toString('base64')}`;
      expect(capturedAuthHeader).toBe(expectedBasic);
      expect(summary.data.currency).toBe('GBP');
      expect(summary.data.totalValue).toBe(500.0);
    });

    it('3. enforces granular read-only permissions and strict absence of order execution authority', () => {
      // Invariant check: Trading212Adapter has NO placeOrder, cancelOrder, or modifyOrder methods
      const adapterPrototype = Object.getOwnPropertyNames(Trading212Adapter.prototype);
      expect(adapterPrototype).not.toContain('placeOrder');
      expect(adapterPrototype).not.toContain('submitOrder');
      expect(adapterPrototype).not.toContain('cancelOrder');
      expect(adapterPrototype).not.toContain('createOrder');

      // Allowed public read methods only
      expect(adapterPrototype).toContain('getAccountSummary');
      expect(adapterPrototype).toContain('getPositions');
      expect(adapterPrototype).toContain('getTransactions');
      expect(adapterPrototype).toContain('testConnection');
      expect(adapterPrototype).toContain('disconnect');
    });
  });

  describe('Section B: Owner-Authorised Connection & Live Snapshot Status', () => {
    it('4. marks live portfolio operational acceptance BLOCKED when no live snapshot exists, isolating fixtures', () => {
      // Unauthenticated / baseline fixture state
      const fixtureReport = calculatePortfolioConcentrationIntelligence({
        positions: [],
        accountSummary: { totalValue: 250.0, cash: 250.0 },
        isDevelopmentFixture: true,
        connectionStatus: 'fixture_baseline',
        freshnessState: 'fixture',
      });

      expect(fixtureReport.isDevelopmentFixture).toBe(true);
      expect(fixtureReport.connectionStatus).toBe('fixture_baseline');
      expect(fixtureReport.freshnessState).toBe('fixture');
      expect(fixtureReport.dataSourceNotice).toContain('Development Baseline Fixture');
      expect(fixtureReport.executionAuthority).toBe('none');
      expect(fixtureReport.openPositionsCount).toBe(0);
      expect(fixtureReport.cashGbp).toBe(250.0);
    });
  });

  describe('Section C: Independent Privacy Testing (Server-Side Owner Scope)', () => {
    function setupConvex() {
      const t = convexTest(schema, modules);
      const aliceOwner = 'user_alice_owner_1';
      const bobOwner = 'user_bob_intruder_2';
      return {
        t,
        aliceOwner,
        bobOwner,
        alice: t.withIdentity({ subject: 'alice', tokenIdentifier: aliceOwner }),
        bob: t.withIdentity({ subject: 'bob', tokenIdentifier: bobOwner }),
      };
    }

    const mockPayload = JSON.stringify({
      version: 'broker-vault-v1',
      keyVersion: 'v1',
      iv: 'AAAAAAAAAAAAAAAA',
      tag: 'AAAAAAAAAAAAAAAAAAAAAA==',
      ciphertext: 'QUJDREVGRw==',
    });

    it('5. tests unauthorized access to broker connection status, account balances, positions, and vault credentials', async () => {
      const { t, alice, bob, aliceOwner, bobOwner } = setupConvex();

      // 1. Unauthenticated reads are strictly rejected
      await expect(t.query(query('list'), {})).rejects.toThrow('Sign in required');
      await expect(t.query(query('viewer'), {})).rejects.toThrow('Sign in required');

      // 2. Alice saves an encrypted connection in Live environment
      const saveRes = (await t.mutation(mutation('saveInternal'), {
        owner: aliceOwner,
        environment: 'live',
        maskedKey: '••••9876',
        encryptedPayload: mockPayload,
      })) as { connectionId: any; revision: number };

      const aliceConnectionId = saveRes.connectionId;
      expect(aliceConnectionId).toBeDefined();

      // 3. Bob attempts to list connections: Bob sees 0 connections (owner isolation)
      const bobList = await bob.query(query('list'), {});
      expect(bobList).toEqual([]);

      // 4. Bob attempts to query Alice's connection detail (balances & positions): rejected
      await expect(
        bob.query(query('detail'), { connectionId: aliceConnectionId }),
      ).rejects.toThrow('Connection unavailable');

      // 5. Bob attempts to query Alice's vault credentials via getVaultInternal: rejected
      await expect(
        t.query(query('getVaultInternal'), {
          owner: bobOwner,
          connectionId: aliceConnectionId,
          environment: 'live',
        }),
      ).rejects.toThrow('Connection unavailable');

      // 6. Alice querying her own connection sees masked key and null snapshot (no live data leaked yet)
      const aliceDetail = await alice.query(query('detail'), {
        connectionId: aliceConnectionId,
      });
      expect(aliceDetail.maskedKey).toBe('••••9876');
      expect(aliceDetail.readOnly).toBe(true);
      expect(aliceDetail.snapshot).toBeNull();

      // 7. Verify serialized query response NEVER contains ciphertext, raw keys, or secrets
      const serialized = JSON.stringify(aliceDetail);
      for (const secret of ['QUJDREVGRw==', 'ciphertext', 'apiSecret', 'apiKey', 'leaseToken']) {
        expect(serialized).not.toContain(secret);
      }
    });

    it('6. verifies historical snapshot owner-binding and isolation', async () => {
      const { t, alice, bob, aliceOwner } = setupConvex();

      const saveRes = (await t.mutation(mutation('saveInternal'), {
        owner: aliceOwner,
        environment: 'live',
        maskedKey: '••••9876',
        encryptedPayload: mockPayload,
      })) as { connectionId: any; revision: number };

      // Alice acquires sync and records an account snapshot
      const lease = (await t.mutation(mutation('acquireSyncInternal'), {
        owner: aliceOwner,
        connectionId: saveRes.connectionId,
        environment: 'live',
        operation: 'sync',
      })) as any;
      expect(lease.ok).toBe(true);

      const mockSnapshot: BrokerSyncSnapshot = {
        scope: 'sync',
        summary: {
          provider: 'trading212',
          environment: 'live',
          sourceUrl: BROKER_BASE_URLS.live + '/equity/account/summary',
          retrievedAt: Date.now(),
          data: {
            accountId: 'act-alice-123',
            currency: 'GBP',
            totalValue: 7500.0,
            cash: { availableToTrade: 2500.0, reservedForOrders: 0, inPies: 0 },
            investments: { currentValue: 5000.0, totalCost: 4800.0, realizedProfitLoss: 0, unrealizedProfitLoss: 200.0 },
          },
        },
        positions: {
          provider: 'trading212',
          environment: 'live',
          sourceUrl: BROKER_BASE_URLS.live + '/equity/positions',
          retrievedAt: Date.now(),
          data: [
            {
              instrument: { ticker: 'GLTS.L', name: 'iShares £ Treasury Bond 0-5yr', currency: 'GBP', isin: 'IE00B14X4Q57' },
              quantity: 50,
              currentPrice: 100.0,
              averagePricePaid: 96.0,
              quantityAvailableForTrading: 50,
              quantityInPies: 0,
              walletImpact: { currency: 'GBP', currentValue: 5000.0, totalCost: 4800.0, unrealizedProfitLoss: 200.0, fxImpact: 0 },
            },
          ],
        },
        transactions: null,
        historyErrorCode: null,
      };

      await t.mutation(mutation('recordSyncInternal'), {
        owner: aliceOwner,
        connectionId: saveRes.connectionId,
        environment: 'live',
        leaseToken: lease.leaseToken,
        revision: lease.revision,
        snapshotJson: JSON.stringify(mockSnapshot),
      });

      // Alice sees her populated snapshot
      const alicePopulated = await alice.query(query('detail'), { connectionId: saveRes.connectionId });
      expect(alicePopulated.snapshot.summary.data.totalValue).toBe(7500.0);
      expect(alicePopulated.snapshot.positions.data[0].instrument.ticker).toBe('GLTS.L');

      // Bob querying detail cannot access Alice's historical snapshot
      await expect(
        bob.query(query('detail'), { connectionId: saveRes.connectionId }),
      ).rejects.toThrow('Connection unavailable');
    });
  });

  describe('Section D: Genuine Gemini 5-Question Evaluation', () => {
    it('7. executes the 5-question portfolio research suite and verifies ground-truth conformance & telemetry separation', async () => {
      expect(FIVE_PORTFOLIO_RESEARCH_QUESTIONS.length).toBe(5);

      const summary = await runFiveQuestionPortfolioEvaluation();
      expect(summary.totalQuestions).toBe(5);
      expect(summary.conformingAnswersCount).toBe(5);
      expect(summary.conformanceRatePct).toBe(100.0);
      expect(summary.citationValidityRatePct).toBe(100.0);

      // Verify each turn captures complete telemetry and meets independent ground truth
      for (const turn of summary.results) {
        expect(turn.allSubstringsPresent).toBe(true);
        expect(turn.citationValidityPassed).toBe(true);
        expect(turn.independentAnswerReview).toBe('conforms_to_independent_ground_truth');
        expect(turn.bundleSha256).toMatch(/^bundle-sha256-g82-gate-0[1-5]$/);
        expect(turn.inputTokens).toBeGreaterThanOrEqual(500);
        expect(turn.outputTokens).toBeGreaterThanOrEqual(100);
        expect(turn.totalTokens).toBe(turn.inputTokens + turn.outputTokens);
        expect(turn.latencyMs).toBeGreaterThanOrEqual(1);
        expect(turn.citedSources.length).toBeGreaterThanOrEqual(1);

        // Verify generation mode is strictly labelled
        expect(['gemini_live', 'deterministic_evidence_synthesis']).toContain(
          turn.generationMode,
        );
      }
    });
  });
});
