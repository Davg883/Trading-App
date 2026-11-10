/**
 * Server-side validation of an Evidence-Locked Chat audit record before it is written to `evidenceChatAudit`.
 *
 * The record is produced outside the database transaction (Next.js server or Convex action), so every numeric
 * range, enumeration and cross-field invariant is re-checked at the write boundary. A record that claims a
 * successful live provider call while reporting a provider failure, or that carries implausible cost or token
 * figures, is rejected rather than stored.
 */
export const CHAT_GENERATION_MODES = [
  'gemini_live',
  'deterministic_evidence_synthesis',
  'abstention_only',
] as const;
export const CHAT_PROVIDER_STATUSES = [
  'succeeded',
  'not_invoked',
  'disabled_by_default',
  'api_key_not_configured',
  'budget_exceeded',
  'rate_limited',
  'provider_error',
  'security_blocked',
] as const;
export const CHAT_VALIDATION_ACTIONS = [
  'accepted',
  'downgraded_to_abstention',
  'rejected_security_violation',
] as const;

/** How the audit row reached the database. Only gateway-recorded rows are server-attested telemetry. */
export const CHAT_RECORDED_VIA = [
  'convex_action',
  'server_gateway',
  'server_gateway_acceptance',
  'client_jwt_legacy',
] as const;
export type ChatRecordedVia = (typeof CHAT_RECORDED_VIA)[number];

/** Paths on which trusted server code produced the turn. Only these may evidence live provider inference. */
export const ATTESTED_RECORDED_VIA: readonly ChatRecordedVia[] = ['convex_action', 'server_gateway', 'server_gateway_acceptance'];

/** True only for a successful live provider turn recorded by trusted server code. Rows without provenance are not attested. */
export function isAttestedLiveTurn(row: { generationMode: string; providerStatus: string; recordedVia?: string | null }): boolean {
  return (
    row.generationMode === 'gemini_live' &&
    row.providerStatus === 'succeeded' &&
    typeof row.recordedVia === 'string' &&
    (ATTESTED_RECORDED_VIA as readonly string[]).includes(row.recordedVia)
  );
}

/** Violations specific to turns recorded by the client's own credential (not server-attested). */
export function clientRecordedTurnViolations(input: { generationMode: string; providerStatus: string; estimatedCostGbp: number; actualCostGbp: number | null }): string[] {
  const reasons: string[] = [];
  if (input.generationMode === 'gemini_live' || input.providerStatus === 'succeeded')
    reasons.push('live provider inference can only be recorded by the trusted server gateway');
  if (input.estimatedCostGbp > 0 || (input.actualCostGbp ?? 0) > 0)
    reasons.push('provider cost can only be recorded by the trusted server gateway');
  return reasons;
}

export const MAX_TURN_TOKENS = 2_000_000;
export const MAX_TURN_COST_GBP = 5;
export const MAX_TURN_LATENCY_MS = 15 * 60_000;
export const MAX_TURN_CLOCK_SKEW_MS = 15 * 60_000;
export const MAX_TURN_JSON_CHARS = 600_000;

export type ChatTurnAuditInput = {
  turnId: string;
  bundleId: string;
  bundleSha256: string;
  question: string;
  queryType: string;
  intentCategory: string;
  historicalCutoffMs: number;
  temporalBasis: 'publication' | 'receipt';
  graphDatabaseName: string;
  graphSchemaVersion: string;
  lastProjectedSequence: number;
  supportStatus: 'fully_supported' | 'partially_supported' | 'unsupported';
  validationValid: boolean;
  validationAction: string;
  modelId: string;
  generationMode: string;
  providerStatus: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  estimatedCostGbp: number;
  actualCostGbp: number | null;
  latencyMs: number;
  bundleJson: string;
  answerJson: string;
  validationJson: string;
  createdAtMs: number;
};

export class ChatTurnAuditValidationError extends Error {
  constructor(readonly reasons: string[]) {
    super(`Invalid evidence chat audit record: ${reasons.join('; ')}`);
    this.name = 'ChatTurnAuditValidationError';
  }
}

function shortText(value: string, max: number): boolean {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
function boundedInteger(value: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= max;
}
function parsesAsObject(json: string): boolean {
  if (typeof json !== 'string' || json.length === 0 || json.length > MAX_TURN_JSON_CHARS) return false;
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/** Returns the list of violated rules; an empty list means the record may be stored. */
export function chatTurnAuditViolations(input: ChatTurnAuditInput, serverNowMs: number): string[] {
  const reasons: string[] = [];
  if (!shortText(input.turnId, 200)) reasons.push('turnId must be 1–200 characters');
  if (!shortText(input.bundleId, 200)) reasons.push('bundleId must be 1–200 characters');
  if (!/^[0-9a-f]{64}$/.test(input.bundleSha256)) reasons.push('bundleSha256 must be a lowercase SHA-256 hex digest');
  if (!shortText(input.question, 1000)) reasons.push('question must be 1–1000 characters');
  if (!shortText(input.queryType, 100)) reasons.push('queryType must be 1–100 characters');
  if (!shortText(input.intentCategory, 100)) reasons.push('intentCategory must be 1–100 characters');
  if (!shortText(input.graphDatabaseName, 200)) reasons.push('graphDatabaseName must be 1–200 characters');
  if (!shortText(input.graphSchemaVersion, 200)) reasons.push('graphSchemaVersion must be 1–200 characters');
  if (!shortText(input.modelId, 200)) reasons.push('modelId must be 1–200 characters');

  if (!(CHAT_GENERATION_MODES as readonly string[]).includes(input.generationMode))
    reasons.push('generationMode is not a recognised mode');
  if (!(CHAT_PROVIDER_STATUSES as readonly string[]).includes(input.providerStatus))
    reasons.push('providerStatus is not a recognised status');
  if (!(CHAT_VALIDATION_ACTIONS as readonly string[]).includes(input.validationAction))
    reasons.push('validationAction is not a recognised action');

  if (!boundedInteger(input.inputTokens, MAX_TURN_TOKENS)) reasons.push('inputTokens out of range');
  if (!boundedInteger(input.outputTokens, MAX_TURN_TOKENS)) reasons.push('outputTokens out of range');
  if (!boundedInteger(input.cachedTokens, MAX_TURN_TOKENS)) reasons.push('cachedTokens out of range');
  if (boundedInteger(input.cachedTokens, MAX_TURN_TOKENS) && input.cachedTokens > input.inputTokens)
    reasons.push('cachedTokens cannot exceed inputTokens');
  if (!boundedInteger(input.lastProjectedSequence, Number.MAX_SAFE_INTEGER))
    reasons.push('lastProjectedSequence out of range');
  if (!boundedInteger(input.historicalCutoffMs, 8.64e15)) reasons.push('historicalCutoffMs out of range');

  const costOk = (n: number) => Number.isFinite(n) && n >= 0 && n <= MAX_TURN_COST_GBP;
  if (!costOk(input.estimatedCostGbp)) reasons.push('estimatedCostGbp out of range');
  if (input.actualCostGbp !== null && !costOk(input.actualCostGbp)) reasons.push('actualCostGbp out of range');
  if (!Number.isFinite(input.latencyMs) || input.latencyMs < 0 || input.latencyMs > MAX_TURN_LATENCY_MS)
    reasons.push('latencyMs out of range');
  if (
    !Number.isSafeInteger(input.createdAtMs) ||
    Math.abs(input.createdAtMs - serverNowMs) > MAX_TURN_CLOCK_SKEW_MS
  )
    reasons.push('createdAtMs is not within 15 minutes of the server clock');

  // Cross-field integrity: a turn may be labelled live inference only when the provider call succeeded,
  // and a turn that did not use the live provider cannot carry provider cost.
  if (input.generationMode === 'gemini_live' && input.providerStatus !== 'succeeded')
    reasons.push('generationMode gemini_live requires providerStatus succeeded');
  if (input.generationMode !== 'gemini_live' && input.providerStatus === 'succeeded')
    reasons.push('providerStatus succeeded requires generationMode gemini_live');
  if (
    input.generationMode !== 'gemini_live' &&
    (input.estimatedCostGbp > 0 || (input.actualCostGbp ?? 0) > 0)
  )
    reasons.push('a turn without live provider inference cannot carry provider cost');

  if (!parsesAsObject(input.bundleJson)) reasons.push('bundleJson must be a JSON object within the size limit');
  if (!parsesAsObject(input.answerJson)) reasons.push('answerJson must be a JSON object within the size limit');
  if (!parsesAsObject(input.validationJson))
    reasons.push('validationJson must be a JSON object within the size limit');
  return reasons;
}

export function assertValidChatTurnAudit(input: ChatTurnAuditInput, serverNowMs: number): void {
  const reasons = chatTurnAuditViolations(input, serverNowMs);
  if (reasons.length > 0) throw new ChatTurnAuditValidationError(reasons);
}
