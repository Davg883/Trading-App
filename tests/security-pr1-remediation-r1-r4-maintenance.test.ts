import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  generate: vi.fn(),
  get: vi.fn(),
  userId: 'user_rem_1' as string | null,
  token: 'jwt-token' as string | null,
  convexMutations: [] as string[],
  legacyMutationShouldThrow: false,
}));

vi.mock('@google/genai', async (orig) => ({
  ...(await orig<typeof import('@google/genai')>()),
  GoogleGenAI: class {
    models = {
      generateContent: h.generate,
      get: h.get,
      list: vi.fn(async () => ({ page: [] })),
    };
  },
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () =>
    h.userId ? { userId: h.userId, getToken: async () => h.token } : { userId: null, getToken: async () => null },
}));

vi.mock('convex/browser', () => ({
  ConvexHttpClient: class {
    setAuth() {}
    async query() {
      throw new Error('Convex unavailable');
    }
    async action() {
      throw new Error('Convex unavailable');
    }
    async mutation(ref: unknown) {
      if (h.legacyMutationShouldThrow) {
        throw new Error('Legacy mutation unavailable');
      }
      h.convexMutations.push(String((ref as { _name?: string })?._name ?? ref));
      return { auditId: 'legacy-audit-id' };
    }
  },
}));

import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { convexTest, type TestConvex } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import schema from '../convex/schema';
import { GET as chatGet, POST as chatPost } from '../app/api/graph/chat/route';
import {
  ACCOUNTING_UNIT_GBP,
  ACCOUNTING_UNITS_PER_GBP,
  ceilingToAccountingUnits,
  costToAccountingUnits,
  fromAccountingUnits,
} from '../lib/graph/evidence-chat-contracts';
import { retrieveClosedEvidenceBundle } from '../lib/graph/evidence-retrieval-gateway';
import {
  computeGeminiCostGbp,
  generateAndValidateEvidenceLockedAnswer,
  resetGeminiChatRateLimitsForTests,
} from '../lib/graph/gemini-provider-adapter';
import {
  chatTurnAuditViolations,
  isAttestedLiveTurn,
} from '../lib/graph/chat-turn-audit-validation';
import { evidenceTurnFields } from './helpers/turn-fixture';

const modules = {
  './_generated/server.ts': async () => ({}),
  './acceptanceNonces.ts': () => import('../convex/acceptanceNonces'),
  './chatBudget.ts': () => import('../convex/chatBudget'),
  './evidenceChat.ts': () => import('../convex/evidenceChat'),
  './operations.ts': () => import('../convex/operations'),
  './remoteOpsCloud.ts': () => import('../convex/remoteOpsCloud'),
  './http.ts': () => import('../convex/http'),
};

const ISS = 'https://issuer.test';
const OWNER_A = `${ISS}|user_a`;
const GATEWAY_SECRET = 'g'.repeat(48);
const QUESTION = 'Which hyperscalers fund the Irish data-centre build-out?';
const NOW = Date.parse('2026-11-12T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const GATEWAY_HEADERS = {
  'content-type': 'application/json',
  'x-aci-gateway-authorization': `Bearer ${GATEWAY_SECRET}`,
};
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

type T = TestConvex<typeof schema>;
type Caller = { fetch: T['fetch'] };

let EV_A: Awaited<ReturnType<typeof evidenceTurnFields>>;
let turnSeq = 0;

beforeAll(async () => {
  EV_A = await evidenceTurnFields(QUESTION, OWNER_A);
});

beforeEach(() => {
  resetGeminiChatRateLimitsForTests();
  h.generate.mockReset();
  h.get.mockReset();
  h.get.mockResolvedValue({ name: 'models/gemini-2.5-flash' });
  h.userId = 'user_rem_1';
  h.token = 'jwt-token';
  h.convexMutations = [];
  h.legacyMutationShouldThrow = false;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function setupConvex() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubEnv('EVIDENCE_CHAT_GATEWAY_SECRET', GATEWAY_SECRET);
  vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN', ISS);
  const t = convexTest(schema, modules);
  return {
    t,
    asA: t.withIdentity({ subject: 'user_a', tokenIdentifier: OWNER_A, issuer: ISS }),
  };
}

function makeTurnPayload(overrides: Record<string, unknown> = {}) {
  return {
    turnId: `chat-rem-${++turnSeq}`,
    modelId: 'gemini-2.5-flash',
    generationMode: 'abstention_only',
    providerStatus: 'budget_exceeded',
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    estimatedCostGbp: 0,
    actualCostGbp: null,
    latencyMs: 5,
    createdAtMs: Date.now(),
    ...EV_A,
    ...overrides,
  };
}

const postGateway = (c: Caller, path: string, body: unknown) =>
  c.fetch(path, { method: 'POST', headers: GATEWAY_HEADERS, body: JSON.stringify(body) });
const reserveGateway = (c: Caller) => postGateway(c, '/api/evidence-chat/budget/reserve', {});
const startGateway = (c: Caller, r: string) =>
  postGateway(c, '/api/evidence-chat/budget/start', { budgetReservation: r });
const turnGateway = (c: Caller, body: unknown) =>
  postGateway(c, '/api/evidence-chat/turn', body);

async function reserveAndStart(c: Caller): Promise<string> {
  const res = await reserveGateway(c);
  expect(res.status).toBe(200);
  const { reservation } = (await res.json()) as { reservation: string };
  expect((await startGateway(c, reservation)).status).toBe(200);
  return reservation;
}

const setCeiling = (t: T, owner: string, ceiling: number) =>
  t.run((ctx) =>
    ctx.db.insert('operationsSettings', {
      owner,
      systemEnabled: true,
      disabledReason: null,
      activeEnvironment: 'remote',
      dailyCostCeilingGbp: ceiling,
      monthlyCostCeilingGbp: Math.max(ceiling, 1),
      updatedAt: Date.now(),
    }),
  );

const reconcileRef = makeFunctionReference<'mutation'>('chatBudget:reconcileReservationInternal');
const unresolvedRef = makeFunctionReference<'query'>('chatBudget:listUnresolvedReservationsInternal');

describe('Work Package A — R1: Provider retry, fallback, and token usage accounting', () => {
  it('R1.1: Default execution makes at most 1 provider attempt per reservation (no 7-model unreserved fan-out on timeout, 503, or 429)', async () => {
    const bundle = await retrieveClosedEvidenceBundle({
      question: QUESTION,
      requesterId: OWNER_A,
      preferLiveTypeDb: false,
    });
    h.generate.mockRejectedValue(new Error('HTTP 503 UNAVAILABLE: upstream model overloaded'));

    const turn = await generateAndValidateEvidenceLockedAnswer({
      bundle,
      callerId: OWNER_A,
      mode: 'gemini_live_required',
      env: {
        GEMINI_API_KEY: 'AIzaSyTestKey12345678901234567890',
        EVIDENCE_CHAT_GEMINI_ENABLED: 'true',
      },
      nowMs: NOW,
    });

    expect(h.generate).toHaveBeenCalledTimes(1);
    expect(turn.telemetry.providerStatus).toBe('provider_error');
    expect(turn.telemetry.providerFailureKind).toBe('error_response');
  });

  it('R1.2: Never retries after a response that returned billed token usage (JSON parse failure), and preserves the billed token usage and cost on the provider_error audit record', async () => {
    const { t, asA } = setupConvex();
    await setCeiling(t, OWNER_A, 0.06);
    const reservation = await reserveAndStart(asA);

    const bundle = await retrieveClosedEvidenceBundle({
      question: QUESTION,
      requesterId: OWNER_A,
      historicalCutoffMs: EV_A.historicalCutoffMs,
      temporalBasis: EV_A.temporalBasis as 'receipt' | 'publication',
      preferLiveTypeDb: false,
    });

    // Provider returns a response that billed 2,000 input tokens and 1,500 output tokens, but text is unparseable JSON
    h.generate.mockResolvedValueOnce({
      text: 'NOT_VALID_JSON_AT_ALL',
      responseId: 'resp-parse-fail-1',
      usageMetadata: {
        promptTokenCount: 2000,
        candidatesTokenCount: 1500,
        totalTokenCount: 3500,
        cachedContentTokenCount: 0,
      },
    });

    const authorizedRetries: number[] = [];
    const turnResult = await generateAndValidateEvidenceLockedAnswer({
      bundle,
      callerId: OWNER_A,
      mode: 'gemini_live_required',
      maxProviderAttempts: 3,
      authorizeRetryAttempt: ({ attemptNumber }) => {
        authorizedRetries.push(attemptNumber);
        return true;
      },
      env: {
        GEMINI_API_KEY: 'AIzaSyTestKey12345678901234567890',
        EVIDENCE_CHAT_GEMINI_ENABLED: 'true',
      },
      nowMs: NOW,
    });

    // Must NOT retry after receiving a response that consumed tokens
    expect(h.generate).toHaveBeenCalledTimes(1);
    expect(authorizedRetries).toEqual([]);

    const expectedCost = computeGeminiCostGbp(2000, 1500);
    expect(expectedCost).toBeGreaterThan(0);
    expect(turnResult.telemetry.providerStatus).toBe('provider_error');
    expect(turnResult.telemetry.providerFailureKind).toBe('unknown');
    expect(turnResult.telemetry.inputTokens).toBe(2000);
    expect(turnResult.telemetry.outputTokens).toBe(1500);
    expect(turnResult.telemetry.estimatedCostGbp).toBe(expectedCost);
    expect(turnResult.telemetry.actualCostGbp).toBeNull();

    // Verify audit validator and Convex settlement accept the failed turn's observed token usage and hold reservation as `unknown`
    const payload = {
      turnId: turnResult.turnId,
      bundleId: turnResult.bundle.bundleId,
      bundleSha256: turnResult.bundle.bundleSha256,
      question: turnResult.bundle.question,
      queryType: turnResult.bundle.selectedQuery.queryType,
      intentCategory: turnResult.bundle.selectedQuery.intentCategory,
      historicalCutoffMs: turnResult.bundle.historicalCutoffMs,
      temporalBasis: turnResult.bundle.temporalBasis,
      graphDatabaseName: turnResult.bundle.graphDatabaseName,
      graphSchemaVersion: turnResult.bundle.graphSchemaVersion,
      lastProjectedSequence: turnResult.bundle.projectionCheckpoint.lastProjectedSequence,
      supportStatus: turnResult.answer.supportStatus,
      validationValid: turnResult.validation.valid,
      validationAction: turnResult.validation.actionTaken,
      modelId: turnResult.telemetry.modelId,
      generationMode: turnResult.telemetry.generationMode,
      providerStatus: turnResult.telemetry.providerStatus,
      providerFailureKind: turnResult.telemetry.providerFailureKind,
      inputTokens: turnResult.telemetry.inputTokens,
      outputTokens: turnResult.telemetry.outputTokens,
      cachedTokens: turnResult.telemetry.cachedTokens,
      estimatedCostGbp: turnResult.telemetry.estimatedCostGbp,
      actualCostGbp: turnResult.telemetry.actualCostGbp,
      latencyMs: turnResult.telemetry.latencyMs,
      bundleJson: JSON.stringify(turnResult.bundle),
      answerJson: JSON.stringify(turnResult.answer),
      validationJson: JSON.stringify(turnResult.validation),
      createdAtMs: NOW,
    };

    expect(chatTurnAuditViolations(payload, NOW, { owner: OWNER_A })).toEqual([]);
    const recRes = await turnGateway(asA, { turn: payload, budgetReservation: reservation });
    expect(recRes.status).toBe(200);

    const storedRes = await t.run((ctx) => ctx.db.query('chatBudgetReservations').collect());
    expect(storedRes[0]).toMatchObject({
      status: 'unknown',
      chargeGbp: expectedCost,
      chargeBasis: 'estimated',
    });

    // Total exposure remains capped at £0.05 without double-counting expectedCost:
    // recordedSpend (£0.000936) + remaining reservation liability (£0.049064) = £0.05
    const unresolvedList = await t.query(unresolvedRef, { owner: OWNER_A });
    expect(unresolvedList).toHaveLength(1);
    expect(Number((unresolvedList[0]!.liabilityGbp + expectedCost).toFixed(6))).toBe(0.05);
  });

  it('R1.3: Multi-attempt retry requires explicit per-attempt reservation via authorizeRetryAttempt and enforces aggregate ceiling across attempts', async () => {
    const { asA } = setupConvex();
    const bundle = await retrieveClosedEvidenceBundle({
      question: QUESTION,
      requesterId: OWNER_A,
      preferLiveTypeDb: false,
    });

    // Attempt 1 fails with HTTP 503 (no response tokens), Attempt 2 succeeds
    h.generate
      .mockRejectedValueOnce(new Error('HTTP 503 UNAVAILABLE'))
      .mockResolvedValueOnce({
        text: JSON.stringify({
          shortAnswer: 'Not covered by approved evidence.',
          supportStatus: 'unsupported',
          executiveTldr: [],
          supportingClaims: [],
          missingInformation: ['None'],
          abstentionReason: 'Insufficient approved evidence.',
          suggestedFollowUpQuestions: [],
        }),
        responseId: 'resp-retry-ok',
        usageMetadata: {
          promptTokenCount: 1200,
          candidatesTokenCount: 300,
          totalTokenCount: 1500,
        },
      });

    const reservationsTaken: string[] = [];
    const r1 = await reserveAndStart(asA);
    reservationsTaken.push(r1);

    const turn = await generateAndValidateEvidenceLockedAnswer({
      bundle,
      callerId: OWNER_A,
      mode: 'gemini_live_required',
      maxProviderAttempts: 2,
      authorizeRetryAttempt: async () => {
        const rNext = await reserveAndStart(asA);
        reservationsTaken.push(rNext);
        return true;
      },
      env: {
        GEMINI_API_KEY: 'AIzaSyTestKey12345678901234567890',
        EVIDENCE_CHAT_GEMINI_ENABLED: 'true',
      },
      nowMs: NOW,
    });

    expect(h.generate).toHaveBeenCalledTimes(2);
    expect(reservationsTaken).toHaveLength(2);
    expect(turn.telemetry.providerStatus).toBe('succeeded');
    expect(turn.telemetry.inputTokens).toBe(1200);
    expect(turn.telemetry.outputTokens).toBe(300);
  });

  it('R1.4 (Task A): Multi-attempt provider boundary uses integer accounting units — exact ceiling equality permits retry while 1 accounting unit (£0.000001) above blocks retry and sub-unit positive cost rounds up fail-closed', async () => {
    expect(ACCOUNTING_UNITS_PER_GBP).toBe(1_000_000);
    expect(ACCOUNTING_UNIT_GBP).toBe(0.000001);
    expect(costToAccountingUnits(0.05) + costToAccountingUnits(0.1)).toBe(
      ceilingToAccountingUnits(0.15),
    );
    // Fail-closed sub-unit rounding: positive sub-micro-GBP cost rounds UP to 1 unit; sub-micro-GBP ceiling fraction rounds DOWN
    expect(costToAccountingUnits(0.0000001)).toBe(1);
    expect(ceilingToAccountingUnits(0.1500009)).toBe(150_000);
    expect(fromAccountingUnits(150_000)).toBe(0.15);

    const bundle = await retrieveClosedEvidenceBundle({
      question: QUESTION,
      requesterId: OWNER_A,
      preferLiveTypeDb: false,
    });
    const estCost = computeGeminiCostGbp(bundle.estimatedBundleTokens + 600, 750);
    const estUnits = costToAccountingUnits(estCost);
    const priorSpentUnits = 150_000 - estUnits;
    const priorSpentGbp = fromAccountingUnits(priorSpentUnits);

    // 1. Exact ceiling equality (`priorSpentUnits + estUnits === 150_000 === ceilingToAccountingUnits(0.15)`):
    // Attempt 1 fails with transient 503 (0 tokens billed), so `accumulatedCostUnits = 0`, and `priorSpentUnits + 0 + estUnits === 150_000 <= 150_000` -> retry is allowed!
    h.generate
      .mockRejectedValueOnce(new Error('HTTP 503 UNAVAILABLE'))
      .mockResolvedValueOnce({
        text: JSON.stringify({
          shortAnswer: 'Not covered by approved evidence.',
          supportStatus: 'unsupported',
          executiveTldr: [],
          supportingClaims: [],
          missingInformation: ['None'],
          abstentionReason: 'Insufficient approved evidence.',
          suggestedFollowUpQuestions: [],
        }),
        responseId: 'resp-exact-boundary-ok',
        usageMetadata: {
          promptTokenCount: 1000,
          candidatesTokenCount: 200,
          totalTokenCount: 1200,
        },
      });

    let retryCallsExact = 0;
    const exactTurn = await generateAndValidateEvidenceLockedAnswer({
      bundle,
      callerId: OWNER_A,
      mode: 'gemini_live_required',
      dailyCostCeilingGbp: 0.15,
      dailySpentGbpSoFar: priorSpentGbp,
      maxProviderAttempts: 2,
      authorizeRetryAttempt: () => {
        retryCallsExact += 1;
        return true;
      },
      env: {
        GEMINI_API_KEY: 'AIzaSyTestKey12345678901234567890',
        EVIDENCE_CHAT_GEMINI_ENABLED: 'true',
      },
      nowMs: NOW,
    });
    expect(retryCallsExact).toBe(1);
    expect(h.generate).toHaveBeenCalledTimes(2);
    expect(exactTurn.telemetry.providerStatus).toBe('succeeded');

    // 2. One accounting unit (£0.000001) above the £0.15 ceiling (`priorSpentUnits + 1 + estUnits === 150_001 > 150_000`):
    // Refused before any provider attempt (`budget_exceeded`).
    h.generate.mockReset();
    const oneUnitOverTurn = await generateAndValidateEvidenceLockedAnswer({
      bundle,
      callerId: OWNER_A,
      mode: 'gemini_live_required',
      dailyCostCeilingGbp: 0.15,
      dailySpentGbpSoFar: fromAccountingUnits(priorSpentUnits + 1),
      maxProviderAttempts: 2,
      env: {
        GEMINI_API_KEY: 'AIzaSyTestKey12345678901234567890',
        EVIDENCE_CHAT_GEMINI_ENABLED: 'true',
      },
      nowMs: NOW,
    });
    expect(h.generate).not.toHaveBeenCalled();
    expect(oneUnitOverTurn.telemetry.providerStatus).toBe('budget_exceeded');
  });
});

describe('Work Package A — R2: Reconciling provider charges when an audit record already exists', () => {
  it('R2.1: Reconciling a timed-out turn with an existing audit row (auditId !== null, estimatedCostGbp = 0) to settled (£0.04) counts the £0.04 charge against the ceiling (no lost charge)', async () => {
    const { t, asA } = setupConvex();
    await setCeiling(t, OWNER_A, 0.06);

    const r1 = await reserveAndStart(asA);
    const timedOutTurn = makeTurnPayload({
      generationMode: 'abstention_only',
      providerStatus: 'provider_error',
      providerFailureKind: 'timeout_or_transport',
      estimatedCostGbp: 0,
      actualCostGbp: null,
    });
    expect((await turnGateway(asA, { turn: timedOutTurn, budgetReservation: r1 })).status).toBe(200);

    // Before reconciliation, reservation is `unknown` with auditId !== null, holding £0.05
    const beforeRows = await t.run((ctx) => ctx.db.query('chatBudgetReservations').collect());
    expect(beforeRows[0]!.status).toBe('unknown');
    expect(beforeRows[0]!.auditId).not.toBeNull();

    // Operator reconciles r1 to settled with actual_billing chargeGbp = £0.04
    await t.mutation(reconcileRef, {
      reservationSha256: sha256(r1),
      resolution: 'settled',
      chargeGbp: 0.04,
      chargeBasis: 'actual_billing',
      operator: 'ops-admin',
      note: 'Billed £0.04 on upstream invoice after timeout',
    });

    // Audit row is updated with actualCostGbp = 0.04, and reservation is settled
    const updatedAudit = await t.run((ctx) => ctx.db.query('evidenceChatAudit').first());
    expect(updatedAudit?.actualCostGbp).toBe(0.04);

    // Because £0.04 is now spent against the £0.06 ceiling, a new £0.05 reservation (0.04 + 0.05 = 0.09 > 0.06) MUST be rejected!
    const nextRes = await reserveGateway(asA);
    expect(nextRes.status).toBe(409);
    expect(await nextRes.json()).toMatchObject({
      error: { code: 'budget_exceeded', spentGbp: 0.04, ceilingGbp: 0.06 },
    });
  });

  it('R2.2: Reconciling a failed turn whose audit row already carried estimatedCostGbp = £0.015 to settled (£0.04) neither double-charges nor loses the charge (exact £0.04 total)', async () => {
    const { t, asA } = setupConvex();
    await setCeiling(t, OWNER_A, 0.095);

    const r1 = await reserveAndStart(asA);
    const parseFailedTurn = makeTurnPayload({
      generationMode: 'abstention_only',
      providerStatus: 'provider_error',
      providerFailureKind: 'unknown',
      inputTokens: 1000,
      outputTokens: 1000,
      estimatedCostGbp: 0.015,
      actualCostGbp: null,
    });
    expect((await turnGateway(asA, { turn: parseFailedTurn, budgetReservation: r1 })).status).toBe(200);

    // Operator reconciles r1 to settled with chargeGbp = £0.04
    await t.mutation(reconcileRef, {
      reservationSha256: sha256(r1),
      resolution: 'settled',
      chargeGbp: 0.04,
      chargeBasis: 'actual_billing',
      operator: 'ops-admin',
      note: 'Final invoice charge £0.04',
    });

    // Total spend must be exactly £0.04 (not £0.015 + £0.04 = £0.055, and not £0.015).
    // With ceiling £0.095, a new £0.05 reservation fits (0.04 + 0.05 = 0.09 <= 0.095), whereas if double-charged (0.055 + 0.05 = 0.105 > 0.095) it would have failed!
    const secondRes = await reserveGateway(asA);
    expect(secondRes.status).toBe(200);
    const body = (await secondRes.json()) as { spentGbp: number; ceilingGbp: number };
    expect(body.spentGbp).toBe(0.04);
  });
});

describe('Work Package A — R3: Cross-midnight and 24-hour boundary invariants for unresolved vs settled reservations', () => {
  it('R3.1: In-flight and unknown reservations remain active financial liabilities and visible in listUnresolvedReservationsInternal across midnight, 24h, and 48h boundaries', async () => {
    const { t, asA } = setupConvex();
    await setCeiling(t, OWNER_A, 0.06);

    const r1 = await reserveAndStart(asA);

    // Cross midnight (+13h)
    vi.setSystemTime(NOW + 13 * HOUR);
    expect((await reserveGateway(asA)).status).toBe(409);
    expect(await t.query(unresolvedRef, { owner: OWNER_A })).toHaveLength(1);

    // Cross 24-hour boundary (+24h + 1ms)
    vi.setSystemTime(NOW + 24 * HOUR + 1);
    expect((await reserveGateway(asA)).status).toBe(409);
    expect(await t.query(unresolvedRef, { owner: OWNER_A })).toMatchObject([
      {
        reservationSha256: sha256(r1),
        effectiveStatus: 'unknown',
        liabilityGbp: 0.05,
      },
    ]);

    // Cross 48-hour boundary (+48h)
    vi.setSystemTime(NOW + 48 * HOUR);
    expect((await reserveGateway(asA)).status).toBe(409);
    expect(await t.query(unresolvedRef, { owner: OWNER_A })).toHaveLength(1);
  });

  it('R3.2: Settled turns roll off the 24-hour daily spend window after 24 hours as expected', async () => {
    const { t, asA } = setupConvex();
    await setCeiling(t, OWNER_A, 0.06);

    const r1 = await reserveAndStart(asA);
    const liveTurn = makeTurnPayload({
      generationMode: 'gemini_live',
      providerStatus: 'succeeded',
      inputTokens: 10000,
      outputTokens: 5000,
      estimatedCostGbp: 0.03,
      actualCostGbp: 0.03,
    });
    expect((await turnGateway(asA, { turn: liveTurn, budgetReservation: r1 })).status).toBe(200);

    // Immediately after £0.03 settled spend, another £0.05 reservation exceeds £0.06 ceiling (0.03 + 0.05 = 0.08 > 0.06)
    expect((await reserveGateway(asA)).status).toBe(409);

    // After 24h + 1ms, the settled £0.03 spend ages out of the rolling 24h window
    vi.setSystemTime(NOW + 24 * HOUR + 1);
    const afterWindow = await reserveGateway(asA);
    expect(afterWindow.status).toBe(200);
    expect((await afterWindow.json()) as { spentGbp: number }).toMatchObject({ spentGbp: 0 });
  });
});

describe('Work Package A — R4: Provenance distinction between legacy client-asserted, pre-hardening, and server-attested records', () => {
  it('R4.1: Client-recorded legacy turns (client_jwt_legacy) are stamped client_asserted_v1, gateway/action turns are stamped strict_v1, and pre-hardening rows return legacy_unvalidated', async () => {
    const { t, asA } = setupConvex();

    // 1. Legacy client-JWT mutation
    const legacyMut = makeFunctionReference<'mutation'>('evidenceChat:recordEvidenceChatTurn');
    const legacyTurn = makeTurnPayload({
      turnId: 'turn-client-legacy-1',
      generationMode: 'deterministic_evidence_synthesis',
      providerStatus: 'not_invoked',
      estimatedCostGbp: 0,
      actualCostGbp: 0,
    });
    await asA.mutation(legacyMut, legacyTurn);

    // 2. Server-gateway attested turn
    const r = await reserveAndStart(asA);
    const gatewayTurn = makeTurnPayload({
      turnId: 'turn-server-gateway-1',
      generationMode: 'gemini_live',
      providerStatus: 'succeeded',
      inputTokens: 1000,
      outputTokens: 200,
      estimatedCostGbp: 0.002,
      actualCostGbp: 0.002,
    });
    expect((await turnGateway(asA, { turn: gatewayTurn, budgetReservation: r })).status).toBe(200);

    // 3. Pre-hardening historical row without evidenceIntegrity
    await t.run((ctx) =>
      ctx.db.insert('evidenceChatAudit', {
        owner: OWNER_A,
        ...makeTurnPayload({
          turnId: 'turn-pre-hardening-1',
          createdAtMs: NOW - 1000,
        }),
        executionAuthority: 'none',
      } as never),
    );

    const history = (await asA.query(
      makeFunctionReference<'query'>('evidenceChat:listChatHistory'),
      {},
    )) as Array<{ turnId: string; evidenceIntegrity: string }>;

    const byTurnId = new Map(history.map((row) => [row.turnId, row.evidenceIntegrity]));
    expect(byTurnId.get('turn-client-legacy-1')).toBe('client_asserted_v1');
    expect(byTurnId.get('turn-server-gateway-1')).toBe('strict_v1');
    expect(byTurnId.get('turn-pre-hardening-1')).toBe('legacy_unvalidated');

    expect(
      isAttestedLiveTurn({
        generationMode: 'gemini_live',
        providerStatus: 'succeeded',
        recordedVia: 'server_gateway',
        evidenceIntegrity: 'client_asserted_v1',
      }),
    ).toBe(false);
    expect(
      isAttestedLiveTurn({
        generationMode: 'gemini_live',
        providerStatus: 'succeeded',
        recordedVia: 'server_gateway',
        evidenceIntegrity: 'strict_v1',
      }),
    ).toBe(true);
  });
});

describe('Work Package B — Server-Enforced Safe Maintenance Gate (RESEARCH_CHAT_MAINTENANCE)', () => {
  it('WP-B.1: Blocks new signed-in and acceptance-nonce requests on Next.js with 503 (maintenance_active) before any paid provider call, while rejecting invalid credentials with 401/400', async () => {
    vi.stubEnv('RESEARCH_CHAT_MAINTENANCE', 'on');
    vi.stubEnv('GEMINI_API_KEY', 'AIzaSyTestKey12345678901234567890');
    vi.stubEnv('EVIDENCE_CHAT_GEMINI_ENABLED', 'true');
    vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', 'https://example-deployment-123.convex.cloud');
    vi.stubEnv('EVIDENCE_CHAT_GATEWAY_SECRET', GATEWAY_SECRET);

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    // 1. Valid signed-in user -> 503 maintenance_active, zero fetch/provider calls
    const resSignedIn = await chatPost(
      new NextRequest('https://capital.aiguides.co.uk/api/graph/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: QUESTION }),
      }),
    );
    expect(resSignedIn.status).toBe(503);
    expect(await resSignedIn.json()).toMatchObject({ code: 'maintenance_active' });
    expect(h.generate).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    // 2. Valid acceptance nonce format -> 503 maintenance_active, nonce is NOT consumed and provider is NOT called
    h.userId = null;
    const validNonceToken = `acn1.${'a'.repeat(32)}.${'b'.repeat(64)}`;
    const resNonce = await chatPost(
      new NextRequest('https://capital.aiguides.co.uk/api/graph/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-aci-acceptance-nonce': validNonceToken,
        },
        body: JSON.stringify({ question: QUESTION }),
      }),
    );
    expect(resNonce.status).toBe(503);
    expect(await resNonce.json()).toMatchObject({ code: 'maintenance_active' });
    expect(h.generate).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    // 3. Invalid credentials (anonymous) -> 401
    const resAnon = await chatPost(
      new NextRequest('https://capital.aiguides.co.uk/api/graph/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: QUESTION }),
      }),
    );
    expect(resAnon.status).toBe(401);

    // 4. Invalid credentials (malformed nonce) -> 401
    const resBadNonce = await chatPost(
      new NextRequest('https://capital.aiguides.co.uk/api/graph/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-aci-acceptance-nonce': 'malformed-nonce',
        },
        body: JSON.stringify({ question: QUESTION }),
      }),
    );
    expect(resBadNonce.status).toBe(401);

    // 5. Ambiguous credentials (both session and nonce) -> 400
    h.userId = 'user_rem_1';
    const resAmbiguous = await chatPost(
      new NextRequest('https://capital.aiguides.co.uk/api/graph/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-aci-acceptance-nonce': validNonceToken,
        },
        body: JSON.stringify({ question: QUESTION }),
      }),
    );
    expect(resAmbiguous.status).toBe(400);
    expect(await resAmbiguous.json()).toMatchObject({ code: 'ambiguous_credentials' });
  });

  it('WP-B.2: Distinguishes in-flight operations from new requests on Convex during maintenance and protects against mixed-version deployments', async () => {
    const { t, asA } = setupConvex();

    // Before maintenance is enabled:
    // - rInFlight is reserved AND started (`in_flight`)
    // - rUnstarted is reserved but NOT yet started (`reserved`)
    // - nonceInFlight is minted, consumed, and started
    // - nonceUnconsumed is minted but NOT yet consumed
    const rInFlight = await reserveAndStart(asA);
    const unstartedRes = await reserveGateway(asA);
    const { reservation: rUnstarted } = (await unstartedRes.json()) as { reservation: string };

    const mintRef = makeFunctionReference<'action'>('acceptanceNonces:mintAcceptanceNonce');
    const { token: nonceInFlight } = (await t.action(mintRef, {
      owner: OWNER_A,
      question: QUESTION,
      operator: 'ops',
    })) as { token: string };
    const consumedInFlight = (await (
      await postGateway(t, '/api/evidence-chat/acceptance/consume', {
        token: nonceInFlight,
        question: QUESTION,
      })
    ).json()) as { reservation: string };
    expect(
      (
        await postGateway(t, '/api/evidence-chat/acceptance/start', {
          token: nonceInFlight,
          reservation: consumedInFlight.reservation,
        })
      ).status,
    ).toBe(200);

    const { token: nonceUnconsumed } = (await t.action(mintRef, {
      owner: OWNER_A,
      question: QUESTION,
      operator: 'ops',
    })) as { token: string };

    // Activate maintenance gate on Convex
    vi.stubEnv('RESEARCH_CHAT_MAINTENANCE', 'on');

    // 1. New budget reservation is blocked with 503 maintenance_active
    const newReserve = await reserveGateway(asA);
    expect(newReserve.status).toBe(503);
    expect(await newReserve.json()).toMatchObject({ error: { code: 'maintenance_active' } });

    // 2. Starting an unstarted reservation (`reserved` -> `in_flight`) is blocked with 503 and abandons the unstarted reservation to `expired_unused`
    const startUnstarted = await startGateway(asA, rUnstarted);
    expect(startUnstarted.status).toBe(503);
    expect(await startUnstarted.json()).toMatchObject({ error: { code: 'maintenance_active' } });

    // 3. Consuming an unconsumed nonce is blocked with 503 WITHOUT consuming the nonce; invalid nonce secret still gets 409
    const badNonceSecret = `${nonceUnconsumed.slice(0, -4)}ffff`;
    expect(
      (
        await postGateway(t, '/api/evidence-chat/acceptance/consume', {
          token: badNonceSecret,
          question: QUESTION,
        })
      ).status,
    ).toBe(409);
    const consumeDuringMaint = await postGateway(t, '/api/evidence-chat/acceptance/consume', {
      token: nonceUnconsumed,
      question: QUESTION,
    });
    expect(consumeDuringMaint.status).toBe(503);
    expect(await consumeDuringMaint.json()).toMatchObject({
      error: { code: 'maintenance_active', reason: 'maintenance_active' },
    });

    // 4. Mixed-version protection: an unreserved turn write or legacy client-JWT write from an older Next.js node is blocked with 503 / error
    const unreservedTurn = makeTurnPayload({
      generationMode: 'deterministic_evidence_synthesis',
      providerStatus: 'not_invoked',
    });
    const unreservedWrite = await turnGateway(asA, { turn: unreservedTurn });
    expect(unreservedWrite.status).toBe(503);
    await expect(
      asA.mutation(
        makeFunctionReference<'mutation'>('evidenceChat:recordEvidenceChatTurn'),
        unreservedTurn,
      ),
    ).rejects.toThrow(/maintenance_active/);

    // 5. Already in-flight signed-in reservation CAN settle and record its audit row during maintenance!
    const liveInFlightTurn = makeTurnPayload({
      generationMode: 'gemini_live',
      providerStatus: 'succeeded',
      inputTokens: 1000,
      outputTokens: 200,
      estimatedCostGbp: 0.002,
      actualCostGbp: 0.002,
    });
    const settleSignedIn = await turnGateway(asA, {
      turn: liveInFlightTurn,
      budgetReservation: rInFlight,
    });
    expect(settleSignedIn.status).toBe(200);

    // 6. Already consumed/in-flight acceptance nonce CAN record its turn during maintenance!
    const liveNonceTurn = makeTurnPayload({
      generationMode: 'gemini_live',
      providerStatus: 'succeeded',
      inputTokens: 1000,
      outputTokens: 200,
      estimatedCostGbp: 0.002,
      actualCostGbp: 0.002,
    });
    const settleNonce = await postGateway(t, '/api/evidence-chat/acceptance/record', {
      token: nonceInFlight,
      reservation: consumedInFlight.reservation,
      turn: liveNonceTurn,
    });
    expect(settleNonce.status).toBe(200);

    // 7. Once maintenance is turned off, `nonceUnconsumed` is still intact (`issued`) and can be consumed normally!
    vi.stubEnv('RESEARCH_CHAT_MAINTENANCE', 'off');
    const consumeAfterMaint = await postGateway(t, '/api/evidence-chat/acceptance/consume', {
      token: nonceUnconsumed,
      question: QUESTION,
    });
    expect(consumeAfterMaint.status).toBe(200);
  });

  it('WP-B.3: EVIDENCE_CHAT_GEMINI_ENABLED=false blocks live Gemini calls in auto mode as well as gemini_live_required mode', async () => {
    const bundle = await retrieveClosedEvidenceBundle({
      question: QUESTION,
      requesterId: OWNER_A,
      preferLiveTypeDb: false,
    });

    const turn = await generateAndValidateEvidenceLockedAnswer({
      bundle,
      callerId: OWNER_A,
      mode: 'auto',
      env: {
        GEMINI_API_KEY: 'AIzaSyTestKey12345678901234567890',
        EVIDENCE_CHAT_GEMINI_ENABLED: 'false',
      },
      nowMs: NOW,
    });

    expect(h.generate).not.toHaveBeenCalled();
    expect(turn.telemetry.generationMode).toBe('deterministic_evidence_synthesis');
    expect(turn.telemetry.providerStatus).toBe('disabled_by_default');
    expect(turn.telemetry.estimatedCostGbp).toBe(0);
  });

  it('WP-B.4: GET /api/graph/chat?statusOnly=1 requires authentication (401 when anonymous) and signed-in turns fail closed (503) if neither gateway nor legacy audit write succeeds', async () => {
    // 1. Anonymous GET ?statusOnly=1 -> 401
    h.userId = null;
    const anonStatusRes = await chatGet(
      new NextRequest('https://capital.aiguides.co.uk/api/graph/chat?statusOnly=1'),
    );
    expect(anonStatusRes.status).toBe(401);
    expect(h.get).not.toHaveBeenCalled();

    // 2. Signed-in deterministic turn where both gateway and legacy mutation fail -> 503 audit_record_unconfirmed
    h.userId = 'user_rem_1';
    h.token = 'jwt-token';
    h.legacyMutationShouldThrow = true;
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', 'https://example-deployment-123.convex.cloud');
    vi.stubEnv('EVIDENCE_CHAT_GATEWAY_SECRET', GATEWAY_SECRET);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: { code: 'unavailable' } }, { status: 503 })),
    );

    const postRes = await chatPost(
      new NextRequest('https://capital.aiguides.co.uk/api/graph/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question: QUESTION,
          mode: 'deterministic_evidence_synthesis',
        }),
      }),
    );
    expect(postRes.status).toBe(503);
    expect(await postRes.json()).toMatchObject({ code: 'audit_record_unconfirmed' });
  });

  it('Task B & Task C Complete Gateway & Maintenance Lifecycle: positive/negative gateway secret, Clerk identity, cross-owner rejection, nonce replay, reconciliation, and maintenance entry -> in-flight settlement -> normal resumption', async () => {
    const { t, asA } = setupConvex();
    const OWNER_B = `${ISS}|user_b`;
    const asB = t.withIdentity({ subject: 'user_b', tokenIdentifier: OWNER_B, issuer: ISS });
    await setCeiling(t, OWNER_A, 0.15);

    const all7GatewayPaths = [
      '/api/evidence-chat/acceptance/consume',
      '/api/evidence-chat/acceptance/start',
      '/api/evidence-chat/acceptance/record',
      '/api/evidence-chat/acceptance/fail',
      '/api/evidence-chat/budget/reserve',
      '/api/evidence-chat/budget/start',
      '/api/evidence-chat/turn',
    ];

    // 1. Missing or invalid gateway secret rejected with 401 across all 7 routes when EVIDENCE_CHAT_GATEWAY_SECRET is configured
    for (const p of all7GatewayPaths) {
      const missingRes = await asA.fetch(p, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(missingRes.status).toBe(401);

      const invalidRes = await asA.fetch(p, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-aci-gateway-authorization': 'Bearer wrong-gateway-secret-0000000000000000',
        },
        body: '{}',
      });
      expect(invalidRes.status).toBe(401);
    }

    // 2. Correct gateway secret + valid Clerk identity accepted for authorised routes (/budget/reserve & /budget/start)
    const r1 = await reserveAndStart(asA);
    const r2 = await reserveAndStart(asA);

    // 3. Cross-owner request rejected (Owner B cannot start or settle Owner A's reservation)
    const crossStart = await startGateway(asB, r1);
    expect(crossStart.status).toBe(409);
    expect(await crossStart.json()).toMatchObject({
      error: { code: 'invalid_budget_reservation' },
    });
    const crossTurn = await turnGateway(asB, {
      turn: makeTurnPayload({
        generationMode: 'deterministic_evidence_synthesis',
        providerStatus: 'not_invoked',
      }),
      budgetReservation: r1,
    });
    expect(crossTurn.status).toBe(400);

    // 4. Single-use acceptance nonce accepted once and rejected on replay
    const mintRef = makeFunctionReference<'action'>('acceptanceNonces:mintAcceptanceNonce');
    const { token: nonce1 } = (await t.action(mintRef, {
      owner: OWNER_A,
      question: QUESTION,
      operator: 'ops-task-b',
    })) as { token: string };
    const consume1 = await postGateway(t, '/api/evidence-chat/acceptance/consume', {
      token: nonce1,
      question: QUESTION,
    });
    expect(consume1.status).toBe(200);
    const consumedBody = (await consume1.json()) as {
      reservation: string;
      budget: { reserved: boolean };
    };
    expect(consumedBody.budget.reserved).toBe(true);

    const replayConsume = await postGateway(t, '/api/evidence-chat/acceptance/consume', {
      token: nonce1,
      question: QUESTION,
    });
    expect(replayConsume.status).toBe(409);
    expect(await replayConsume.json()).toMatchObject({
      error: { reason: 'already_consumed' },
    });

    expect(
      (
        await postGateway(t, '/api/evidence-chat/acceptance/start', {
          token: nonce1,
          reservation: consumedBody.reservation,
        })
      ).status,
    ).toBe(200);

    const { token: nonce2 } = (await t.action(mintRef, {
      owner: OWNER_A,
      question: QUESTION,
      operator: 'ops-task-c',
      ttlSeconds: 600,
    })) as { token: string };

    // 5. Task C — Maintenance mode entry: new inference entry points return 503 while in-flight r1 & nonce1 settle with 200
    vi.stubEnv('RESEARCH_CHAT_MAINTENANCE', 'on');
    expect((await reserveGateway(asA)).status).toBe(503);
    expect(
      (
        await postGateway(t, '/api/evidence-chat/acceptance/consume', {
          token: nonce2,
          question: QUESTION,
        })
      ).status,
    ).toBe(503);

    // Previously authorised in-flight reservation r1 settles during maintenance
    const settleR1 = await turnGateway(asA, {
      turn: makeTurnPayload({
        turnId: 'turn-maint-settle-r1',
        generationMode: 'deterministic_evidence_synthesis',
        providerStatus: 'not_invoked',
      }),
      budgetReservation: r1,
    });
    expect(settleR1.status).toBe(200);

    // Previously authorised in-flight nonce1 settles during maintenance
    const settleNonce1 = await postGateway(t, '/api/evidence-chat/acceptance/record', {
      token: nonce1,
      reservation: consumedBody.reservation,
      turn: makeTurnPayload({
        turnId: 'turn-maint-settle-nonce1',
        generationMode: 'deterministic_evidence_synthesis',
        providerStatus: 'not_invoked',
      }),
    });
    expect(settleNonce1.status).toBe(200);

    // 6. Task C — Normal operation resumes after maintenance is disabled (`off`)
    vi.stubEnv('RESEARCH_CHAT_MAINTENANCE', 'off');
    // r2 was started at t=NOW; advance +6m so r2 becomes `unknown` and reconcile r2 to £0.01
    vi.setSystemTime(NOW + 6 * MIN);
    const recResult = await t.mutation(reconcileRef, {
      reservationSha256: sha256(r2),
      resolution: 'settled',
      chargeGbp: 0.01,
      chargeBasis: 'actual_billing',
      operator: 'ops-task-b',
      note: 'Reconciled after maintenance test',
    });
    expect(recResult).toEqual({ ok: true, duplicate: false });

    // Resumed normal reservation and unconsumed nonce2 consumption succeed after maintenance is disabled
    const postMaintReserve = await reserveGateway(asA);
    expect(postMaintReserve.status).toBe(200);
    expect(await postMaintReserve.json()).toMatchObject({
      spentGbp: 0.01,
      ceilingGbp: 0.15,
    });
    expect(
      (
        await postGateway(t, '/api/evidence-chat/acceptance/consume', {
          token: nonce2,
          question: QUESTION,
        })
      ).status,
    ).toBe(200);
  });
});
