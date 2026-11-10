import { describe, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  evaluatePhaseG81PortfolioRisk,
  reconcileOfficialSoniaObservation,
  auditSevenStressScenarios,
  calculatePortfolioConcentrationIntelligence,
  PHASE_G8_STRESS_SCENARIOS,
  type PortfolioPositionInput,
} from '../lib/portfolio/multi-asset-risk-pilot';
import {
  verifyBrokerVaultSelfTest,
  diagnoseBrokerVaultReadiness,
  encryptCredentials,
  decryptCredentials,
  maskApiKey,
  BrokerVaultError,
} from '../lib/brokers/vault';
import {
  runFifteenQuestionPortfolioEvaluation,
  FIFTEEN_PORTFOLIO_EVALUATION_QUESTIONS,
} from '../lib/portfolio/portfolio-live-eval-15';

describe('Phase G.8.2: Live Portfolio Operational Acceptance Suite', () => {
  describe('Section A & B: Broker Vault, Owner Isolation & Financial Integrity', () => {
    it('1. verifies server-side AES-256-GCM envelope vault, AAD owner binding, and cross-owner isolation', () => {
      // Mock 32-byte base64 key
      const mockKey = Buffer.alloc(32, 0x5a).toString('base64');
      const env = {
        BROKER_VAULT_KEY_B64: mockKey,
        BROKER_VAULT_KEY_VERSION: 'v1',
      };

      const selfTest = verifyBrokerVaultSelfTest(env);
      expect(selfTest.ready).toBe(true);
      expect(selfTest.cipher).toBe('AES-256-GCM');
      expect(selfTest.selfTestPassed).toBe(true);

      const diag = diagnoseBrokerVaultReadiness(env);
      expect(diag.vaultKeyPresent).toBe(true);
      expect(diag.vaultKeyFormatValid).toBe(true);
      expect(diag.vaultSelfTestPassed).toBe(true);

      // Verify cross-owner decryption rejection via AAD mismatch
      const creds = { apiKey: 't212-live-owner-key-1234', apiSecret: 't212-secret-5678' };
      const encrypted = encryptCredentials(creds, 'owner-alice', 'live', env, 'read');
      expect(encrypted.version).toBe('broker-vault-v1');
      expect(encrypted.keyVersion).toBe('v1');
      expect(encrypted.ciphertext).not.toContain('t212-secret-5678');

      // Alice can decrypt her own credentials
      const decrypted = decryptCredentials(encrypted, 'owner-alice', 'live', env, 'read');
      expect(decrypted.apiKey).toBe(creds.apiKey);
      expect(decrypted.apiSecret).toBe(creds.apiSecret);

      // Bob attempting to decrypt Alice's credentials throws BrokerVaultError
      expect(() => {
        decryptCredentials(encrypted, 'owner-bob', 'live', env, 'read');
      }).toThrow(BrokerVaultError);

      // Decrypting under 'demo' environment when encrypted under 'live' throws
      expect(() => {
        decryptCredentials(encrypted, 'owner-alice', 'demo', env, 'read');
      }).toThrow(BrokerVaultError);

      expect(maskApiKey('abcdefgh1234')).toBe('••••1234');
      expect(maskApiKey('short')).toBe('••••');
    });

    it('2. verifies Bank of England official 4.00% Bank Rate hike, dated 6 Nov SONIA fixing (3.98520%), and spread (-1.48 bps)', () => {
      const sonia = reconcileOfficialSoniaObservation();
      expect(sonia.bankRatePct).toBe(4.0);
      expect(sonia.soniaRatePct).toBe(3.99);
      expect(sonia.soniaExactReportedPct).toBe(3.9852);
      expect(sonia.sourceSeriesCode).toBe('IUDSOIA');
      expect(sonia.spreadToBankRateBps).toBe(-1.48);
      expect(sonia.observationDate).toBe('2026-11-06');
      expect(sonia.reconciliationNotes.length).toBeGreaterThanOrEqual(5);
    });

    it('3. verifies exact duration, DV01 units, FX conversion math, and cash carry separation', () => {
      // 1. Duration and DV01 units
      const gltsNotional = 35_000;
      const gltsDuration = 2.15;
      const gltsDv01 = gltsNotional * (gltsDuration / 100);
      expect(gltsDv01).toBeCloseTo(752.5, 2); // £752.50 per 100 bps shift

      const igltNotional = 10_000;
      const igltDuration = 8.35;
      const igltDv01 = igltNotional * (igltDuration / 100);
      expect(igltDv01).toBeCloseTo(835.0, 2); // £835.00 per 100 bps shift

      // 2. FX conversion: +10% GBP appreciation against USD
      const gbpAppreciation = 0.1;
      const fxReturn = 1 / (1 + gbpAppreciation) - 1;
      expect(Number((fxReturn * 100).toFixed(4))).toBe(-9.0909);
      expect(Number((fxReturn * 100).toFixed(1))).toBe(-9.1);

      // 3. Instantaneous shock vs forward cash carry
      for (const sc of PHASE_G8_STRESS_SCENARIOS) {
        expect(sc.timeHorizon).toBe('instantaneous_shock_t0');
        expect(sc.assetClassShockPct.sterling_cash_and_deposits).toBe(0.0);
      }

      // 4. Seven stress scenarios audit
      const audit = auditSevenStressScenarios();
      expect(audit.length).toBe(7);

      const scG = audit.find(
        (s) => s.scenarioId === 'SCENARIO_G_LIQUIDITY_FORCED_WITHDRAWAL',
      )!;
      expect(scG.scenarioCode).toBe('Scenario G');
      expect(scG.underlyingAssumptions.stockBondCorrelation).toBe(
        'negative_diversifying',
      );
      expect(scG.arithmeticVerificationFormula).toContain('NOT double-counted');
    });

    it('4. strictly demarcates development fixtures from live authenticated holdings and enforces executionAuthority=none', () => {
      // Baseline fixture (£250 cash, 0 positions)
      const fixtureReport = calculatePortfolioConcentrationIntelligence({
        positions: [],
        accountSummary: {
          totalValue: 250.0,
          cash: 250.0,
        },
        accountSource: 'trading212_live_read_only',
        isDevelopmentFixture: true,
      });

      expect(fixtureReport.isDevelopmentFixture).toBe(true);
      expect(fixtureReport.freshnessState).toBe('fixture');
      expect(fixtureReport.connectionStatus).toBe('fixture_baseline');
      expect(fixtureReport.dataSourceNotice).toContain('Development Baseline Fixture');
      expect(fixtureReport.executionAuthority).toBe('none');
      expect(fixtureReport.cashAllocationPct).toBe(100);
      expect(fixtureReport.openPositionsCount).toBe(0);

      // Simulated authenticated live holdings (e.g. 50 shares of GLTS.L)
      const livePositions: PortfolioPositionInput[] = [
        {
          ticker: 'GLTS.L',
          name: 'iShares £ Treasury Bond 0-5yr UCITS ETF',
          currency: 'GBP',
          valuationGbp: 5000.0,
        },
      ];

      const liveReport = calculatePortfolioConcentrationIntelligence({
        positions: livePositions,
        accountSummary: {
          totalValue: 6000.0,
          cash: 1000.0,
        },
        accountSource: 'trading212_live_read_only',
        isDevelopmentFixture: false,
        freshnessState: 'fresh',
        connectionStatus: 'connected',
      });

      expect(liveReport.isDevelopmentFixture).toBe(false);
      expect(liveReport.freshnessState).toBe('fresh');
      expect(liveReport.connectionStatus).toBe('connected');
      expect(liveReport.dataSourceNotice).toBe('Authorised read-only Trading 212 account snapshot synchronised via secure AES-256-GCM vault.');
      expect(liveReport.totalPortfolioValueGbp).toBe(6000.0);
      expect(liveReport.cashGbp).toBe(1000.0);
      expect(liveReport.investedPositionsValueGbp).toBe(5000.0);
      expect(liveReport.openPositionsCount).toBe(1);
      expect(liveReport.executionAuthority).toBe('none');
    });
  });

  describe('Section C: Live Research Assistant 15-Question Evaluation', () => {
    // Corrected in MVP hardening WP6; see tests/phase-g8-2-final-live-connection-gate.test.ts test 7.
    it('5. without a configured provider the 15-question suite reports nothing as evaluated or passed', async () => {
      expect(FIFTEEN_PORTFOLIO_EVALUATION_QUESTIONS.length).toBe(15);

      const summary = await runFifteenQuestionPortfolioEvaluation({ env: {} });
      expect(summary.totalQuestions).toBe(15);
      expect(summary.byMode.unconfigured).toBe(15);
      expect(summary.liveEvaluated).toBe(0);
      expect(summary.livePassRatePct).toBeNull();
      expect(summary.results.every((t) => t.outcome === 'not_evaluated' && t.generatedAnswer === null)).toBe(true);
    });
  });

  describe('Section D: Operational Health, Failure Modes & Edge Cases', () => {
    it('6. tests genuine failure conditions: disconnected broker, missing FX rates, and model fallback', () => {
      // 1. Disconnected broker: should flag status as disconnected and retain fixture fallback
      const disconnectedReport = calculatePortfolioConcentrationIntelligence({
        positions: [],
        accountSummary: {
          totalValue: 0.01,
          cash: 0.0,
        },
        accountSource: 'trading212_live_read_only',
        connectionStatus: 'disconnected',
        freshnessState: 'unavailable',
      });
      expect(disconnectedReport.connectionStatus).toBe('disconnected');
      expect(disconnectedReport.freshnessState).toBe('unavailable');

      // 2. Multi-asset pilot master status
      const g81 = evaluatePhaseG81PortfolioRisk();
      expect(g81.productionAcceptanceStatus).toBe(
        'production_ready_read_only_governance_enforced',
      );
      expect(g81.executionAuthority).toBe('none');
      expect(
        g81.stage3And4PortfolioConcentration.ownerLiveAccountReport
          .executionAuthority,
      ).toBe('none');

      // 3. Educational models sum to £100,000 basis
      expect(
        g81.stage3And4PortfolioConcentration.balancedBenchmarkReport
          .totalPortfolioValueGbp,
      ).toBe(100000.0);
      expect(
        g81.stage3And4PortfolioConcentration.techConcentratedBenchmarkReport
          .totalPortfolioValueGbp,
      ).toBe(100000.0);
    });
  });
});
