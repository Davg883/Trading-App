import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  extractNumberMentions,
  type EvaluationCase,
  type EvidenceDocument,
  type GroundTruth,
  type RequiredFact,
} from './evaluation-harness';

/**
 * Loads the `macro-observations-v1` evaluation set (MVP hardening WP6).
 *
 * Evidence documents are generated from the repository's source-backed observation records, one document
 * per source, with that source's own publication and receipt timestamps. Ground truth is loaded from a
 * separate file and validated: every required figure must be stated in the evidence document it names,
 * and that document must be among the case's candidate evidence.
 */
type Observation = {
  observationId: string;
  subjectOrgId: string;
  metricName: string;
  metricValue: number;
  metricUnit: string;
  currencyCode: string | null;
  reportingPeriodLabel: string;
  accountingBasis: string;
  metricDefinition: string;
  sourceDocIds: string[];
};
type Source = {
  sourceDocId: string;
  title: string;
  url: string;
  publishedAtMs: number;
  receivedAtMs: number;
};

const ROOT = process.cwd();

export function formatObservationValue(o: Pick<Observation, 'metricValue' | 'metricUnit' | 'currencyCode'>): string {
  if (o.metricUnit === 'currency' && o.currencyCode === 'USD') {
    const billions = o.metricValue / 1e9;
    const sign = billions < 0 ? '-' : '';
    return `${sign}US$${Math.abs(billions).toFixed(3).replace(/\.?0+$/, '')} billion`;
  }
  if (o.metricUnit === 'ratio') return `${Number((o.metricValue * 100).toFixed(2))}%`;
  return `${o.metricValue} ${o.metricUnit}`;
}

export function buildEvidenceDocuments(dataset: {
  sources: Source[];
  observations: Observation[];
  organisations: Array<{ orgId: string; displayName: string }>;
}): Map<string, EvidenceDocument> {
  const orgName = new Map(dataset.organisations.map((o) => [o.orgId, o.displayName]));
  const docs = new Map<string, EvidenceDocument>();
  for (const s of dataset.sources) {
    const lines = dataset.observations
      .filter((o) => o.sourceDocIds.includes(s.sourceDocId))
      .sort((a, b) => (a.observationId < b.observationId ? -1 : 1))
      .map(
        (o) =>
          `${orgName.get(o.subjectOrgId) ?? o.subjectOrgId}: ${o.metricName.replace(/_/g, ' ')} for ${o.reportingPeriodLabel} was ${formatObservationValue(o)} (basis: ${o.accountingBasis}). ${o.metricDefinition}`,
      );
    if (lines.length === 0) continue;
    docs.set(s.sourceDocId, {
      evidenceId: s.sourceDocId,
      title: s.title,
      sourceUrl: s.url,
      text: lines.join('\n'),
      publishedAtMs: s.publishedAtMs,
      receivedAtMs: s.receivedAtMs,
    });
  }
  return docs;
}

function factStatedInEvidence(fact: RequiredFact, doc: EvidenceDocument): boolean {
  return extractNumberMentions(doc.text).some((m) => {
    if (fact.unit === 'ratio') return m.unit === 'percent' && Math.abs(m.value / 100 - fact.value) <= fact.tolerance;
    const v = fact.signInsensitive ? Math.abs(m.value) : m.value;
    const e = fact.signInsensitive ? Math.abs(fact.value) : fact.value;
    return m.unit === fact.unit && Math.abs(v - e) <= fact.tolerance;
  });
}

export function loadMacroObservationsEvaluation(root = ROOT): {
  datasetId: string;
  cases: EvaluationCase[];
  groundTruth: Map<string, GroundTruth>;
} {
  const graph = JSON.parse(readFileSync(join(root, 'data/graph/initial-acceptance-dataset.json'), 'utf8'));
  const caseFile = JSON.parse(readFileSync(join(root, 'data/evaluation/macro-observations-v1.cases.json'), 'utf8')) as {
    datasetId: string;
    cases: Array<{ caseId: string; question: string; cutoffIso: string; temporalBasis: 'publication' | 'receipt'; candidateSourceIds: string[] }>;
  };
  const truthFile = JSON.parse(readFileSync(join(root, 'data/evaluation/macro-observations-v1.ground-truth.json'), 'utf8')) as {
    datasetId: string;
    provenance: GroundTruth['provenance'];
    cases: Array<Omit<GroundTruth, 'provenance'>>;
  };
  if (caseFile.datasetId !== truthFile.datasetId) throw new Error('Case and ground-truth files describe different datasets');
  const docs = buildEvidenceDocuments(graph);

  const cases: EvaluationCase[] = caseFile.cases.map((c) => {
    const cutoffMs = Date.parse(c.cutoffIso);
    if (!Number.isFinite(cutoffMs)) throw new Error(`Invalid cutoff for ${c.caseId}`);
    return {
      caseId: c.caseId,
      question: c.question,
      cutoffMs,
      temporalBasis: c.temporalBasis,
      candidateEvidence: c.candidateSourceIds.map((id) => {
        const d = docs.get(id);
        if (!d) throw new Error(`Case ${c.caseId} references unknown evidence ${id}`);
        return d;
      }),
    };
  });

  const groundTruth = new Map<string, GroundTruth>();
  for (const t of truthFile.cases) {
    const c = cases.find((x) => x.caseId === t.caseId);
    if (!c) throw new Error(`Ground truth for unknown case ${t.caseId}`);
    for (const f of t.requiredFacts) {
      const doc = c.candidateEvidence.find((d) => d.evidenceId === f.evidenceId);
      if (!doc) throw new Error(`${t.caseId}: fact "${f.label}" names evidence outside the case`);
      if (!factStatedInEvidence(f, doc)) throw new Error(`${t.caseId}: fact "${f.label}" is not stated in ${f.evidenceId}`);
    }
    for (const id of t.requiredCitations) {
      if (!c.candidateEvidence.some((d) => d.evidenceId === id)) throw new Error(`${t.caseId}: required citation ${id} is not candidate evidence`);
    }
    groundTruth.set(t.caseId, { ...t, provenance: truthFile.provenance });
  }
  for (const c of cases) if (!groundTruth.has(c.caseId)) throw new Error(`No ground truth for ${c.caseId}`);
  return { datasetId: caseFile.datasetId, cases, groundTruth };
}
