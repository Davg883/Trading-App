import { canonicalSha256 } from './canonical';

/**
 * Evidence-locked evaluation harness (MVP hardening, work package 6).
 *
 * Design rules
 * 1. The ground truth never reaches the answer generator. `runEvaluation` passes a provider only the question
 *    and the point-in-time evidence bundle; the grader reads the ground truth afterwards.
 * 2. Every result carries exactly one mode. Only `live_provider` results count as live inference, and the
 *    summary reports each mode separately. A provider failure is a failed case, never a substituted answer.
 * 3. Telemetry is recorded only as observed. Absent provider values are `null`; the local correlation id is
 *    never presented as a provider request id; cost is computed only from provider-reported usage.
 * 4. The evidence-bundle hash is SHA-256 over canonical JSON of exactly what the generator received.
 */
export const HARNESS_VERSION = 'aci-eval-harness-1.0.0';
export const ARTEFACT_SCHEMA_VERSION = 'aci-eval-artefact-v1';

export type EvaluationMode =
  | 'live_provider'
  | 'deterministic_fallback'
  | 'provider_failed'
  | 'abstention'
  | 'unconfigured';

export type TemporalBasis = 'publication' | 'receipt';

export type EvidenceDocument = {
  evidenceId: string;
  title: string;
  sourceUrl: string;
  /** Plain-text statement of the evidence presented to the model. */
  text: string;
  publishedAtMs: number;
  receivedAtMs: number;
};

export type RequiredFact = {
  label: string;
  value: number;
  /** How the value must be expressed in an answer. */
  unit: 'USD_billions' | 'percent' | 'ratio' | 'bps' | 'GBP';
  /** Absolute tolerance in the stated unit. */
  tolerance: number;
  /** Evidence that states this fact; the dataset loader checks it is present in the case's evidence. */
  evidenceId: string;
  /** Terms the answer must state (period, denominator). Each entry may list alternatives separated by `|`. */
  mustMention?: string[];
  /** Accept the magnitude with either sign, e.g. a loss written as "net loss of $104 billion". */
  signInsensitive?: boolean;
};

export type GroundTruth = {
  caseId: string;
  expectAbstention: boolean;
  requiredFacts: RequiredFact[];
  requiredCitations: string[];
  forbiddenPatterns: string[];
  provenance: {
    author: string;
    independentlyReviewedBy: string | null;
    heldOut: boolean;
    note: string;
  };
};

export type EvaluationCase = {
  caseId: string;
  question: string;
  cutoffMs: number;
  temporalBasis: TemporalBasis;
  /** Candidate evidence before point-in-time filtering. */
  candidateEvidence: EvidenceDocument[];
};

export type ProviderUsage = {
  promptTokens: number | null;
  outputTokens: number | null;
  thoughtsTokens: number | null;
  cachedTokens: number | null;
  totalTokens: number | null;
};

export type ProviderResponse = {
  text: string;
  /** Identifier returned by the provider (e.g. Gemini `responseId`), or null when not supplied. */
  providerResponseId: string | null;
  /** Model version reported by the provider, or null when not supplied. */
  providerModelVersion: string | null;
  usage: ProviderUsage | null;
};

export interface AnswerProvider {
  readonly kind: 'live_provider' | 'deterministic_fallback';
  readonly providerName: string;
  readonly requestedModelId: string;
  /** Receives only the prompt. Must throw on any failure; it must never return a substitute answer. */
  generate(prompt: string): Promise<ProviderResponse>;
}

export type PricingTable = {
  pricingSource: string;
  pricingRetrievedOn: string;
  gbpPerInputToken: number;
  gbpPerOutputToken: number;
};

export type ParsedAnswer = {
  abstained: boolean;
  answer: string;
  citations: string[];
};

export type CaseGrade = {
  outcome: 'pass' | 'fail' | 'not_evaluated';
  formatValid: boolean;
  abstentionCorrect: boolean | null;
  citationsAllInBundle: boolean | null;
  fabricatedCitations: string[];
  missingRequiredCitations: string[];
  factResults: Array<{ label: string; expected: number; unit: string; matched: boolean; periodMentioned: boolean }>;
  forbiddenMatches: string[];
  reasons: string[];
};

export type CaseRecord = {
  caseId: string;
  question: string;
  mode: EvaluationMode;
  localCorrelationId: string;
  provider: string | null;
  requestedModelId: string | null;
  providerModelVersion: string | null;
  providerResponseId: string | null;
  requestStartedAtIso: string | null;
  responseReceivedAtIso: string | null;
  latencyMs: number | null;
  usage: ProviderUsage | null;
  cost: { gbp: number | null; basis: 'estimated_from_provider_reported_usage' | 'not_provided' | 'no_provider_call' };
  temporalBasis: TemporalBasis;
  cutoffIso: string;
  evidenceBundleSha256: string;
  evidenceIds: string[];
  excludedByPointInTime: string[];
  rawAnswerText: string | null;
  parsedAnswer: ParsedAnswer | null;
  failure: { code: string; message: string } | null;
  grade: CaseGrade;
};

export type EvaluationArtefact = {
  schemaVersion: typeof ARTEFACT_SCHEMA_VERSION;
  harnessVersion: string;
  runId: string;
  datasetId: string;
  datasetSha256: string;
  startedAtIso: string;
  finishedAtIso: string;
  budget: { maxCases: number; maxEstimatedCostGbp: number; stoppedForBudget: boolean };
  pricing: PricingTable | null;
  records: CaseRecord[];
  summary: EvaluationSummary;
  limitations: string[];
};

export type EvaluationSummary = {
  totalCases: number;
  byMode: Record<EvaluationMode, number>;
  live: { evaluated: number; passed: number; failed: number; passRate: number | null };
  deterministicFallback: { evaluated: number; passed: number };
  providerFailures: number;
  notEvaluated: number;
  reportedCostGbp: number;
  casesWithoutProviderUsage: number;
};

// ---------------------------------------------------------------------------------------------------------
// Point-in-time evidence selection
// ---------------------------------------------------------------------------------------------------------

/**
 * Selects evidence available at the cutoff.
 * - `publication`: published at or before the cutoff.
 * - `receipt`: received by the system at or before the cutoff (and therefore also published by then).
 * A document received before it was published is malformed and always excluded.
 */
export function selectPointInTimeEvidence(
  docs: EvidenceDocument[],
  cutoffMs: number,
  basis: TemporalBasis,
): { included: EvidenceDocument[]; excluded: string[] } {
  const included: EvidenceDocument[] = [];
  const excluded: string[] = [];
  for (const d of docs) {
    const wellFormed = d.receivedAtMs >= d.publishedAtMs;
    const available =
      basis === 'publication'
        ? d.publishedAtMs <= cutoffMs
        : d.receivedAtMs <= cutoffMs && d.publishedAtMs <= cutoffMs;
    if (wellFormed && available) included.push(d);
    else excluded.push(d.evidenceId);
  }
  included.sort((a, b) => (a.evidenceId < b.evidenceId ? -1 : 1));
  return { included, excluded: excluded.sort() };
}

export function evidenceBundleSha256(input: {
  question: string;
  cutoffMs: number;
  temporalBasis: TemporalBasis;
  evidence: EvidenceDocument[];
}): string {
  return canonicalSha256({
    question: input.question.trim(),
    cutoffMs: input.cutoffMs,
    temporalBasis: input.temporalBasis,
    evidence: [...input.evidence].sort((a, b) => (a.evidenceId < b.evidenceId ? -1 : 1)),
  });
}

// ---------------------------------------------------------------------------------------------------------
// Prompt, parsing and grading
// ---------------------------------------------------------------------------------------------------------

export function buildEvidenceLockedPrompt(question: string, evidence: EvidenceDocument[]): string {
  const block = evidence
    .map((d) => `[${d.evidenceId}] ${d.title} (published ${new Date(d.publishedAtMs).toISOString()})\n${d.text}`)
    .join('\n\n');
  return [
    'You are a financial research assistant. Answer ONLY from the evidence below.',
    'Cite every factual statement with the evidence identifier in square brackets, e.g. [evidence-id].',
    'State figures with their unit and reporting period. Do not compute figures that are not in the evidence.',
    'If the evidence does not answer the question, abstain.',
    'Respond with a single JSON object and nothing else:',
    '{"abstained": boolean, "answer": string, "citations": string[]}',
    '',
    'EVIDENCE:',
    block || '(no evidence available at this cutoff)',
    '',
    `QUESTION: ${question}`,
  ].join('\n');
}

/** Parses the model's JSON reply. Returns null when the reply is not the required structure. */
export function parseProviderAnswer(text: string): ParsedAnswer | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const raw: unknown = JSON.parse(trimmed);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.abstained !== 'boolean' || typeof r.answer !== 'string' || !Array.isArray(r.citations)) return null;
    if (!r.citations.every((c) => typeof c === 'string')) return null;
    return { abstained: r.abstained, answer: r.answer, citations: r.citations as string[] };
  } catch {
    return null;
  }
}

/** Identifiers cited inline in the answer text, e.g. "[anthropic-s1a-2026-11-02]". */
export function extractInlineCitations(answer: string): string[] {
  return [...new Set([...answer.matchAll(/\[([A-Za-z0-9][A-Za-z0-9._:-]{1,120})\]/g)].map((m) => m[1]!))];
}

type NumberMention = { value: number; unit: RequiredFact['unit'] | 'none' };

/** Extracts numbers together with the unit expressed next to them. Thousands separators are accepted. */
export function extractNumberMentions(text: string): NumberMention[] {
  const out: NumberMention[] = [];
  const re = /(-|−)?\s?(US\$|\$|£)?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s?(%|percent|bps|basis points|billion|bn|b\b|million|m\b)?/gi;
  for (const m of text.matchAll(re)) {
    const negative = Boolean(m[1]);
    const currency = m[2];
    const num = Number(`${m[3]!.replace(/,/g, '')}${m[4] ? `.${m[4]}` : ''}`);
    if (!Number.isFinite(num)) continue;
    const suffix = (m[5] ?? '').toLowerCase();
    const signed = negative ? -num : num;
    if (suffix === '%' || suffix === 'percent') out.push({ value: signed, unit: 'percent' });
    else if (suffix === 'bps' || suffix === 'basis points') out.push({ value: signed, unit: 'bps' });
    else if ((currency === '$' || currency === 'US$') && (suffix === 'billion' || suffix === 'bn' || suffix === 'b'))
      out.push({ value: signed, unit: 'USD_billions' });
    else if ((currency === '$' || currency === 'US$') && (suffix === 'million' || suffix === 'm'))
      out.push({ value: signed / 1000, unit: 'USD_billions' });
    else if (currency === '£') out.push({ value: signed, unit: 'GBP' });
    else out.push({ value: signed, unit: 'none' });
  }
  return out;
}

function factMatched(fact: RequiredFact, mentions: NumberMention[]): boolean {
  return mentions.some((m) => {
    if (fact.unit === 'ratio') {
      // A ratio may be written as a decimal or as a percentage; both are checked against the stated value.
      if (m.unit === 'percent') return Math.abs(m.value / 100 - fact.value) <= fact.tolerance;
      return m.unit === 'none' && Math.abs(m.value - fact.value) <= fact.tolerance;
    }
    const value = fact.signInsensitive ? Math.abs(m.value) : m.value;
    const expected = fact.signInsensitive ? Math.abs(fact.value) : fact.value;
    return m.unit === fact.unit && Math.abs(value - expected) <= fact.tolerance;
  });
}

export function gradeAnswer(input: {
  parsed: ParsedAnswer | null;
  bundleEvidenceIds: string[];
  truth: GroundTruth;
}): CaseGrade {
  const { parsed, truth } = input;
  const reasons: string[] = [];
  if (!parsed) {
    return {
      outcome: 'fail',
      formatValid: false,
      abstentionCorrect: null,
      citationsAllInBundle: null,
      fabricatedCitations: [],
      missingRequiredCitations: truth.requiredCitations,
      factResults: [],
      forbiddenMatches: [],
      reasons: ['answer is not the required JSON structure'],
    };
  }
  const bundle = new Set(input.bundleEvidenceIds);
  const cited = [...new Set([...parsed.citations, ...extractInlineCitations(parsed.answer)])];
  const fabricatedCitations = cited.filter((c) => !bundle.has(c));
  if (fabricatedCitations.length) reasons.push(`cites evidence outside the bundle: ${fabricatedCitations.join(', ')}`);
  const abstentionCorrect = parsed.abstained === truth.expectAbstention;
  if (!abstentionCorrect)
    reasons.push(truth.expectAbstention ? 'answered although the evidence does not support an answer' : 'abstained although the evidence supports an answer');

  const forbiddenMatches = truth.forbiddenPatterns.filter((p) => new RegExp(p, 'i').test(parsed.answer));
  if (forbiddenMatches.length) reasons.push(`contains forbidden content: ${forbiddenMatches.join(', ')}`);

  let missingRequiredCitations: string[] = [];
  let factResults: CaseGrade['factResults'] = [];
  if (!truth.expectAbstention) {
    missingRequiredCitations = truth.requiredCitations.filter((c) => !cited.includes(c));
    if (missingRequiredCitations.length) reasons.push(`missing required citations: ${missingRequiredCitations.join(', ')}`);
    const mentions = extractNumberMentions(parsed.answer);
    factResults = truth.requiredFacts.map((f) => {
      const matched = factMatched(f, mentions);
      const lower = parsed.answer.toLowerCase();
      const periodMentioned = (f.mustMention ?? []).every((t) => t.split('|').some((alt) => lower.includes(alt.toLowerCase())));
      if (!matched) reasons.push(`figure not found with the correct unit: ${f.label} (${f.value} ${f.unit})`);
      if (!periodMentioned) reasons.push(`period or denominator not stated for ${f.label}: ${(f.mustMention ?? []).join(', ')}`);
      return { label: f.label, expected: f.value, unit: f.unit, matched, periodMentioned };
    });
  }
  const outcome = reasons.length === 0 ? 'pass' : 'fail';
  return {
    outcome,
    formatValid: true,
    abstentionCorrect,
    citationsAllInBundle: fabricatedCitations.length === 0,
    fabricatedCitations,
    missingRequiredCitations,
    factResults,
    forbiddenMatches,
    reasons,
  };
}

const NOT_EVALUATED = (reason: string): CaseGrade => ({
  outcome: 'not_evaluated',
  formatValid: false,
  abstentionCorrect: null,
  citationsAllInBundle: null,
  fabricatedCitations: [],
  missingRequiredCitations: [],
  factResults: [],
  forbiddenMatches: [],
  reasons: [reason],
});

// ---------------------------------------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------------------------------------

export function estimateCostGbp(usage: ProviderUsage | null, pricing: PricingTable | null): number | null {
  if (!usage || !pricing || usage.promptTokens === null || usage.outputTokens === null) return null;
  const output = usage.outputTokens + (usage.thoughtsTokens ?? 0);
  return Number((usage.promptTokens * pricing.gbpPerInputToken + output * pricing.gbpPerOutputToken).toFixed(8));
}

/** Conservative pre-call upper bound used only for budget control (4 characters per token, plus output cap). */
export function upperBoundCostGbp(prompt: string, pricing: PricingTable | null, maxOutputTokens = 2048): number {
  if (!pricing) return 0;
  return Math.ceil(prompt.length / 3) * pricing.gbpPerInputToken + maxOutputTokens * 2 * pricing.gbpPerOutputToken;
}

export async function runEvaluation(input: {
  datasetId: string;
  cases: EvaluationCase[];
  /** Looked up by caseId only after generation. */
  groundTruth: Map<string, GroundTruth>;
  provider: AnswerProvider | null;
  pricing: PricingTable | null;
  budget: { maxCases: number; maxEstimatedCostGbp: number };
  now?: () => number;
  newId?: () => string;
}): Promise<EvaluationArtefact> {
  const now = input.now ?? Date.now;
  const newId = input.newId ?? (() => crypto.randomUUID());
  const startedAtMs = now();
  const records: CaseRecord[] = [];
  let committedUpperBoundGbp = 0;
  let stoppedForBudget = false;

  for (const c of input.cases.slice(0, input.budget.maxCases)) {
    const truth = input.groundTruth.get(c.caseId);
    if (!truth) throw new Error(`No ground truth for case ${c.caseId}`);
    const { included, excluded } = selectPointInTimeEvidence(c.candidateEvidence, c.cutoffMs, c.temporalBasis);
    const bundleSha = evidenceBundleSha256({ question: c.question, cutoffMs: c.cutoffMs, temporalBasis: c.temporalBasis, evidence: included });
    const base = {
      caseId: c.caseId,
      question: c.question,
      localCorrelationId: newId(),
      temporalBasis: c.temporalBasis,
      cutoffIso: new Date(c.cutoffMs).toISOString(),
      evidenceBundleSha256: bundleSha,
      evidenceIds: included.map((d) => d.evidenceId),
      excludedByPointInTime: excluded,
    };
    const noCall = {
      provider: input.provider?.providerName ?? null,
      requestedModelId: input.provider?.requestedModelId ?? null,
      providerModelVersion: null,
      providerResponseId: null,
      requestStartedAtIso: null,
      responseReceivedAtIso: null,
      latencyMs: null,
      usage: null,
      cost: { gbp: null, basis: 'no_provider_call' as const },
      rawAnswerText: null,
    };

    if (included.length === 0) {
      // Nothing is available at the cutoff: the harness abstains without calling a provider.
      const parsed: ParsedAnswer = { abstained: true, answer: 'No evidence was available at the cutoff.', citations: [] };
      records.push({ ...base, ...noCall, mode: 'abstention', parsedAnswer: parsed, failure: null, grade: gradeAnswer({ parsed, bundleEvidenceIds: [], truth }) });
      continue;
    }
    if (!input.provider) {
      records.push({ ...base, ...noCall, mode: 'unconfigured', parsedAnswer: null, failure: null, grade: NOT_EVALUATED('no answer provider configured') });
      continue;
    }
    const prompt = buildEvidenceLockedPrompt(c.question, included);
    const bound = upperBoundCostGbp(prompt, input.pricing);
    if (input.provider.kind === 'live_provider' && committedUpperBoundGbp + bound > input.budget.maxEstimatedCostGbp) {
      stoppedForBudget = true;
      break;
    }
    committedUpperBoundGbp += input.provider.kind === 'live_provider' ? bound : 0;

    const requestStartedAtMs = now();
    try {
      const res = await input.provider.generate(prompt);
      const responseReceivedAtMs = now();
      const parsed = parseProviderAnswer(res.text);
      const live = input.provider.kind === 'live_provider';
      const gbp = live ? estimateCostGbp(res.usage, input.pricing) : null;
      records.push({
        ...base,
        mode: input.provider.kind,
        provider: input.provider.providerName,
        requestedModelId: input.provider.requestedModelId,
        providerModelVersion: res.providerModelVersion,
        providerResponseId: res.providerResponseId,
        requestStartedAtIso: new Date(requestStartedAtMs).toISOString(),
        responseReceivedAtIso: new Date(responseReceivedAtMs).toISOString(),
        latencyMs: responseReceivedAtMs - requestStartedAtMs,
        usage: res.usage,
        cost: live
          ? { gbp, basis: gbp === null ? 'not_provided' : 'estimated_from_provider_reported_usage' }
          : { gbp: null, basis: 'no_provider_call' },
        rawAnswerText: res.text,
        parsedAnswer: parsed,
        failure: null,
        grade: gradeAnswer({ parsed, bundleEvidenceIds: base.evidenceIds, truth }),
      });
    } catch (err) {
      const responseReceivedAtMs = now();
      records.push({
        ...base,
        ...noCall,
        mode: 'provider_failed',
        requestStartedAtIso: new Date(requestStartedAtMs).toISOString(),
        responseReceivedAtIso: new Date(responseReceivedAtMs).toISOString(),
        latencyMs: responseReceivedAtMs - requestStartedAtMs,
        // Billing for a failed request is unknown; nothing is assumed.
        cost: { gbp: null, basis: 'not_provided' },
        parsedAnswer: null,
        failure: {
          code: err instanceof Error && err.name ? err.name : 'provider_error',
          message: (err instanceof Error ? err.message : String(err)).replace(/key=[^&\s]+/gi, 'key=[REDACTED]').slice(0, 300),
        },
        grade: { ...NOT_EVALUATED('provider request failed'), outcome: 'fail' },
      });
    }
  }

  return {
    schemaVersion: ARTEFACT_SCHEMA_VERSION,
    harnessVersion: HARNESS_VERSION,
    runId: newId(),
    datasetId: input.datasetId,
    datasetSha256: canonicalSha256({ cases: input.cases, groundTruth: [...input.groundTruth.values()] }),
    startedAtIso: new Date(startedAtMs).toISOString(),
    finishedAtIso: new Date(now()).toISOString(),
    budget: { ...input.budget, stoppedForBudget },
    pricing: input.pricing,
    records,
    summary: summarise(records),
    limitations: [
      'Grading is automated and rule-based (structure, citations, figures with units and periods, abstention). It does not judge reasoning quality or completeness beyond the listed facts.',
      'Costs are estimates from provider-reported token usage multiplied by the stated price table; they are not invoice amounts.',
      'Ground truth provenance is recorded per case; cases without an independent reviewer are not independently verified.',
    ],
  };
}

export function summarise(records: CaseRecord[]): EvaluationSummary {
  const byMode: Record<EvaluationMode, number> = {
    live_provider: 0,
    deterministic_fallback: 0,
    provider_failed: 0,
    abstention: 0,
    unconfigured: 0,
  };
  for (const r of records) byMode[r.mode] += 1;
  const live = records.filter((r) => r.mode === 'live_provider');
  const livePassed = live.filter((r) => r.grade.outcome === 'pass').length;
  const det = records.filter((r) => r.mode === 'deterministic_fallback');
  return {
    totalCases: records.length,
    byMode,
    live: {
      evaluated: live.length,
      passed: livePassed,
      failed: live.length - livePassed,
      passRate: live.length ? Number((livePassed / live.length).toFixed(4)) : null,
    },
    deterministicFallback: { evaluated: det.length, passed: det.filter((r) => r.grade.outcome === 'pass').length },
    providerFailures: byMode.provider_failed,
    notEvaluated: records.filter((r) => r.grade.outcome === 'not_evaluated').length,
    reportedCostGbp: Number(live.reduce((s, r) => s + (r.cost.gbp ?? 0), 0).toFixed(8)),
    casesWithoutProviderUsage: live.filter((r) => r.cost.gbp === null).length,
  };
}
