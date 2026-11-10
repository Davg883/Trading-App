import { GoogleGenAI } from '@google/genai';

/**
 * Corrected runner for the Phase G.8.2 5- and 15-question portfolio suites (MVP hardening WP6).
 *
 * What changed, and why
 * - The previous runners answered with `independentBenchmarkAnswer` whenever no API key was configured or
 *   the provider failed, then graded that answer against itself, so every run reported 100 % conformance.
 *   The expected answer is now never used as an answer.
 * - Token counts defaulted to fixed numbers, request ids were synthesised with `Date.now()` and the bundle
 *   hash was a placeholder string. Telemetry is now recorded only when the provider returns it.
 * - The citation check only tested that the expected-source list was non-empty. It now inspects the answer.
 * - These suites contain no evidence documents, so they cannot be evidence-locked. They are retained for
 *   history; `lib/evaluation/evaluation-harness.ts` with `macro-observations-v1` is the supported harness.
 */
export type LegacyMode = 'live_provider' | 'provider_failed' | 'unconfigured';

export type LegacyQuestion = {
  questionId: string;
  category: string;
  question: string;
  expectedKeySubstrings: string[];
  expectedMustCiteDocOrSourceIds: string[];
  expectsAbstention?: boolean;
};

export type LegacyTurnResult = {
  questionId: string;
  category: string;
  question: string;
  mode: LegacyMode;
  requestedModelId: string | null;
  providerModelVersion: string | null;
  /** Provider-supplied response id only; never synthesised. */
  providerResponseId: string | null;
  /** These legacy suites have no evidence bundle, so there is no bundle hash. */
  bundleSha256: null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  costGbp: number | null;
  generatedAnswer: string | null;
  allSubstringsPresent: boolean | null;
  citationValidityPassed: boolean | null;
  correctAbstentionPassed: boolean | null;
  outcome: 'pass' | 'fail' | 'not_evaluated';
  failure: string | null;
};

export type LegacySuiteSummary = {
  suiteVersion: string;
  evaluatedAtIso: string;
  totalQuestions: number;
  byMode: Record<LegacyMode, number>;
  /** Pass rate over live provider answers only; null when nothing was evaluated live. */
  livePassRatePct: number | null;
  livePassed: number;
  liveEvaluated: number;
  providerFailures: number;
  totalReportedCostGbp: number;
  supersededBy: 'lib/evaluation/evaluation-harness.ts (macro-observations-v1)';
  results: LegacyTurnResult[];
};

type GenerateFn = (args: { model: string; contents: string }) => Promise<{
  text?: string;
  responseId?: string;
  modelVersion?: string;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}>;

export async function runLegacyQuestionSuite(input: {
  suiteVersion: string;
  questions: readonly LegacyQuestion[];
  env: Record<string, string | undefined>;
  apiKey: string | null;
  promptPrefix: string;
  generate?: GenerateFn;
}): Promise<LegacySuiteSummary> {
  const { env } = input;
  const live = Boolean(input.apiKey && env.EVIDENCE_CHAT_GEMINI_ENABLED !== 'false') || Boolean(input.generate);
  const modelId = env.GEMINI_MODEL_ID?.trim() || null;
  const results: LegacyTurnResult[] = [];
  const generate: GenerateFn | null =
    input.generate ??
    (live && input.apiKey && modelId
      ? (args) => new GoogleGenAI({ apiKey: input.apiKey!, httpOptions: { timeout: 15_000 } }).models.generateContent(args)
      : null);

  for (const q of input.questions) {
    const base = {
      questionId: q.questionId,
      category: q.category,
      question: q.question,
      requestedModelId: modelId,
      bundleSha256: null,
    };
    if (!generate || !modelId) {
      results.push({ ...base, mode: 'unconfigured', providerModelVersion: null, providerResponseId: null, inputTokens: null, outputTokens: null, latencyMs: null, costGbp: null, generatedAnswer: null, allSubstringsPresent: null, citationValidityPassed: null, correctAbstentionPassed: null, outcome: 'not_evaluated', failure: null });
      continue;
    }
    const started = Date.now();
    try {
      const res = await generate({
        model: modelId,
        contents: `${input.promptPrefix}\nQuestion: ${q.question}\nCite source identifiers in square brackets.`,
      });
      const answer = res.text ?? '';
      const lower = answer.toLowerCase();
      const allSubstringsPresent = q.expectedKeySubstrings.every((s) => lower.includes(s.toLowerCase()));
      const citationValidityPassed = q.expectedMustCiteDocOrSourceIds.every((id) => answer.includes(id));
      const abstained = /\b(abstain|cannot|unable|not permitted|prohibited|refuse)/i.test(answer);
      const correctAbstentionPassed = q.expectsAbstention === undefined ? null : abstained === q.expectsAbstention;
      const pass = Boolean(answer) && allSubstringsPresent && citationValidityPassed && correctAbstentionPassed !== false;
      const inT = res.usageMetadata?.promptTokenCount ?? null;
      const outT = res.usageMetadata?.candidatesTokenCount ?? null;
      results.push({
        ...base,
        mode: 'live_provider',
        providerModelVersion: res.modelVersion ?? null,
        providerResponseId: res.responseId ?? null,
        inputTokens: inT,
        outputTokens: outT,
        latencyMs: Date.now() - started,
        costGbp: inT !== null && outT !== null ? Number(((inT * 0.117 + outT * 0.468) / 1_000_000).toFixed(6)) : null,
        generatedAnswer: answer,
        allSubstringsPresent,
        citationValidityPassed,
        correctAbstentionPassed,
        outcome: pass ? 'pass' : 'fail',
        failure: null,
      });
    } catch (err) {
      results.push({ ...base, mode: 'provider_failed', providerModelVersion: null, providerResponseId: null, inputTokens: null, outputTokens: null, latencyMs: Date.now() - started, costGbp: null, generatedAnswer: null, allSubstringsPresent: null, citationValidityPassed: null, correctAbstentionPassed: null, outcome: 'fail', failure: (err instanceof Error ? err.message : String(err)).replace(/key=[^&\s]+/gi, 'key=[REDACTED]').slice(0, 300) });
    }
  }
  const byMode: Record<LegacyMode, number> = { live_provider: 0, provider_failed: 0, unconfigured: 0 };
  for (const r of results) byMode[r.mode] += 1;
  const liveRows = results.filter((r) => r.mode === 'live_provider');
  const livePassed = liveRows.filter((r) => r.outcome === 'pass').length;
  return {
    suiteVersion: input.suiteVersion,
    evaluatedAtIso: new Date().toISOString(),
    totalQuestions: results.length,
    byMode,
    livePassRatePct: liveRows.length ? Number(((livePassed / liveRows.length) * 100).toFixed(2)) : null,
    livePassed,
    liveEvaluated: liveRows.length,
    providerFailures: byMode.provider_failed,
    totalReportedCostGbp: Number(liveRows.reduce((s, r) => s + (r.costGbp ?? 0), 0).toFixed(6)),
    supersededBy: 'lib/evaluation/evaluation-harness.ts (macro-observations-v1)',
    results,
  };
}
