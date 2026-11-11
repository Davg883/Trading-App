import { retrieveClosedEvidenceBundle } from '../../lib/graph/evidence-retrieval-gateway';
import { generateAndValidateEvidenceLockedAnswer } from '../../lib/graph/gemini-provider-adapter';

/**
 * Builds the evidence fields of an audit record from the real, deterministic retrieval and answer path, so
 * tests exercise records that pass the strict inner evidence validation (Correction 4). Telemetry fields
 * (generation mode, provider status, tokens, cost) are left to each test.
 */
export async function evidenceTurnFields(question: string, owner: string) {
  const bundle = await retrieveClosedEvidenceBundle({
    question,
    requesterId: owner,
    temporalBasis: 'receipt',
    graphDatabaseName: 'aci_macro_intelligence_prod',
    preferLiveTypeDb: false,
  });
  const turn = await generateAndValidateEvidenceLockedAnswer({
    bundle,
    callerId: owner,
    mode: 'deterministic_evidence_synthesis',
    env: {},
  });
  return {
    bundleId: bundle.bundleId,
    bundleSha256: bundle.bundleSha256,
    question: bundle.question,
    queryType: bundle.selectedQuery.queryType,
    intentCategory: bundle.selectedQuery.intentCategory,
    historicalCutoffMs: bundle.historicalCutoffMs,
    temporalBasis: bundle.temporalBasis,
    graphDatabaseName: bundle.graphDatabaseName,
    graphSchemaVersion: bundle.graphSchemaVersion,
    lastProjectedSequence: bundle.projectionCheckpoint.lastProjectedSequence,
    supportStatus: turn.answer.supportStatus,
    validationValid: turn.validation.valid,
    validationAction: turn.validation.actionTaken,
    bundleJson: JSON.stringify(bundle),
    answerJson: JSON.stringify(turn.answer),
    validationJson: JSON.stringify(turn.validation),
  };
}
