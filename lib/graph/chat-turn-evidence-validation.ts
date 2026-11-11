import {
  answerValidationReportSchema,
  evidenceBundleSchema,
  evidenceLockedAnswerSchema,
} from './evidence-chat-contracts';
import { computeCanonicalSha256 } from './evidence-retrieval-gateway';

/**
 * Strict inner evidence validation for new audit records (Correction 4).
 *
 * Previously `bundleJson`, `answerJson` and `validationJson` only had to be JSON objects. Each is now parsed
 * against its strict schema, the bundle digest is recomputed from the bundle's canonical content, and every
 * identity field of the audit row must agree with the evidence it carries. Historical rows are not
 * re-validated or modified; they are reported as `legacy_unvalidated` when read.
 */
export const EVIDENCE_INTEGRITY_VERSION = 'strict_v1' as const;

/** Fields excluded from the canonical digest by `retrieveClosedEvidenceBundle`. */
const DIGEST_EXCLUDED_FIELDS = ['bundleId', 'estimatedBundleTokens', 'bundleSha256', 'executionAuthority'] as const;

type EvidenceFields = {
  bundleId: string;
  bundleSha256: string;
  question: string;
  queryType: string;
  intentCategory: string;
  historicalCutoffMs: number;
  temporalBasis: string;
  graphDatabaseName: string;
  graphSchemaVersion: string;
  lastProjectedSequence: number;
  supportStatus: string;
  validationValid: boolean;
  validationAction: string;
  bundleJson: string;
  answerJson: string;
  validationJson: string;
};

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function firstIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues
    .slice(0, 3)
    .map((i) => `${i.path.map(String).join('.') || '<root>'}: ${i.message}`)
    .join(', ');
}

/** True when `owner` (a Convex token identifier `<issuer>|<subject>`) is the identity the bundle was built for. */
function requesterMatchesOwner(requesterId: string, owner: string): boolean {
  return requesterId === owner || owner.endsWith(`|${requesterId}`);
}

export function evidenceConsistencyViolations(input: EvidenceFields, owner?: string): string[] {
  const reasons: string[] = [];
  const bundleParsed = evidenceBundleSchema.safeParse(parseJson(input.bundleJson));
  const answerParsed = evidenceLockedAnswerSchema.safeParse(parseJson(input.answerJson));
  const validationParsed = answerValidationReportSchema.safeParse(parseJson(input.validationJson));
  if (!bundleParsed.success) reasons.push(`bundleJson is not a valid evidence bundle (${firstIssues(bundleParsed.error)})`);
  if (!answerParsed.success) reasons.push(`answerJson is not a valid evidence-locked answer (${firstIssues(answerParsed.error)})`);
  if (!validationParsed.success) reasons.push(`validationJson is not a valid validation report (${firstIssues(validationParsed.error)})`);
  if (!bundleParsed.success || !answerParsed.success || !validationParsed.success) return reasons;

  const bundle = bundleParsed.data;
  const answer = answerParsed.data;
  const report = validationParsed.data;

  // Canonical digest of the bundle content, recomputed exactly as at retrieval time.
  const content: Record<string, unknown> = { ...bundle };
  for (const k of DIGEST_EXCLUDED_FIELDS) delete content[k];
  const digest = computeCanonicalSha256(content);
  if (digest !== bundle.bundleSha256) reasons.push('bundle content does not match its canonical SHA-256 digest');
  if (bundle.bundleId !== `bundle-${bundle.bundleSha256.slice(0, 16)}`) reasons.push('bundle bundleId is not derived from its digest');

  const mismatch = (field: string, row: unknown, evidence: unknown) => {
    if (row !== evidence) reasons.push(`${field} does not match the evidence (${String(row).slice(0, 60)} ≠ ${String(evidence).slice(0, 60)})`);
  };
  mismatch('bundleId', input.bundleId, bundle.bundleId);
  mismatch('bundleSha256', input.bundleSha256, bundle.bundleSha256);
  mismatch('question', input.question, bundle.question);
  mismatch('queryType', input.queryType, bundle.selectedQuery.queryType);
  mismatch('intentCategory', input.intentCategory, bundle.selectedQuery.intentCategory);
  mismatch('historicalCutoffMs', input.historicalCutoffMs, bundle.historicalCutoffMs);
  mismatch('temporalBasis', input.temporalBasis, bundle.temporalBasis);
  mismatch('graphDatabaseName', input.graphDatabaseName, bundle.graphDatabaseName);
  mismatch('graphSchemaVersion', input.graphSchemaVersion, bundle.graphSchemaVersion);
  mismatch('lastProjectedSequence', input.lastProjectedSequence, bundle.projectionCheckpoint.lastProjectedSequence);

  if (answer.bundleId !== bundle.bundleId || answer.bundleSha256 !== bundle.bundleSha256)
    reasons.push('answer is bound to a different bundle');
  if (answer.historicalCutoffUsed.asOfMs !== bundle.historicalCutoffMs || answer.historicalCutoffUsed.temporalBasis !== bundle.temporalBasis)
    reasons.push('answer historical cutoff does not match the bundle');
  mismatch('supportStatus', input.supportStatus, answer.supportStatus);
  mismatch('validationValid', input.validationValid, report.valid);
  mismatch('validationAction', input.validationAction, report.actionTaken);

  // A record validated as valid may cite only evidence and relationships present in its own bundle.
  if (report.valid) {
    const evidenceIds = new Set<string>([
      ...bundle.sources.map((s) => s.docId),
      ...bundle.quantitativeClaims.map((c) => c.claimId),
      ...bundle.scenarios.map((s) => s.scenarioId),
    ]);
    const relationshipIds = new Set(bundle.relationships.map((r) => r.relationshipId));
    const cited = [...answer.supportingClaims.flatMap((c) => c.evidenceIds), ...answer.contradictoryEvidence.flatMap((c) => c.evidenceIds)];
    const citedRels = [
      ...answer.relevantRelationshipIds,
      ...answer.supportingClaims.flatMap((c) => c.relationshipIds),
      ...answer.contradictoryEvidence.flatMap((c) => c.relationshipIds),
    ];
    const outside = [...new Set(cited.filter((id) => !evidenceIds.has(id)))];
    const outsideRels = [...new Set(citedRels.filter((id) => !relationshipIds.has(id)))];
    if (outside.length) reasons.push(`answer cites evidence outside its bundle: ${outside.slice(0, 5).join(', ')}`);
    if (outsideRels.length) reasons.push(`answer cites relationships outside its bundle: ${outsideRels.slice(0, 5).join(', ')}`);
  }

  if (owner !== undefined && !requesterMatchesOwner(bundle.requesterId, owner))
    reasons.push('bundle requesterId is not the recording owner');
  return reasons;
}
