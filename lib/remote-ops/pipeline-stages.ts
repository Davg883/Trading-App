/**
 * Pipeline evidence ladder (MVP hardening, work package 7).
 *
 * A healthy schedule does not prove that data is fresh, and fresh data does not prove the interface shows it.
 * This function reports each stage separately from stored evidence, and says `not_measured` where the system
 * holds no evidence for a stage instead of inferring it from an earlier one.
 */
export type StageState = 'yes' | 'no' | 'not_measured';

export type PipelineStageReport = {
  jobKey: string;
  cronDefined: StageState;
  cronInvoked: StageState;
  collectorCompleted: StageState;
  freshDataStored: StageState;
  reconciled: StageState;
  displayedInInterface: StageState;
  evidence: string[];
};

export function assessPipelineStages(input: {
  jobKey: string;
  nowMs: number;
  cronDefinedInSource: boolean;
  job: {
    enabled: boolean;
    intervalMinutes: number;
    lastRunAt: number | null;
    lastSuccessAt: number | null;
    lastErrorCode: string | null;
  } | null;
  /** Newest stored record produced by this collector (event or receipt time), if the collector stores any. */
  newestStoredRecordAt: number | null;
  /** Whether a reconciliation check exists for this collector and its latest result, if any. */
  reconciliation: { checked: boolean; passed: boolean | null };
}): PipelineStageReport {
  const evidence: string[] = [];
  const window = (input.job?.intervalMinutes ?? 0) * 3 * 60_000;
  const recent = (t: number | null) => t !== null && input.nowMs - t <= Math.max(window, 36 * 3600_000);

  const cronDefined: StageState = input.cronDefinedInSource ? 'yes' : 'no';
  evidence.push(input.cronDefinedInSource ? 'Schedule defined in convex/crons.ts' : 'No schedule defined in source');

  let cronInvoked: StageState = 'not_measured';
  let collectorCompleted: StageState = 'not_measured';
  if (input.job) {
    cronInvoked = recent(input.job.lastRunAt) ? 'yes' : 'no';
    evidence.push(input.job.lastRunAt === null ? 'No recorded run' : `Last run ${new Date(input.job.lastRunAt).toISOString()}`);
    collectorCompleted = recent(input.job.lastSuccessAt) && !input.job.lastErrorCode ? 'yes' : 'no';
    if (input.job.lastErrorCode) evidence.push(`Last error: ${input.job.lastErrorCode}`);
  } else {
    evidence.push('No job record for this owner');
  }

  let freshDataStored: StageState = 'not_measured';
  if (input.newestStoredRecordAt !== null) {
    freshDataStored = recent(input.newestStoredRecordAt) ? 'yes' : 'no';
    evidence.push(`Newest stored record ${new Date(input.newestStoredRecordAt).toISOString()}`);
  } else if (input.job) {
    freshDataStored = 'no';
    evidence.push('No stored records found for this collector');
  }

  const reconciled: StageState = !input.reconciliation.checked
    ? 'not_measured'
    : input.reconciliation.passed === true
      ? 'yes'
      : 'no';

  return {
    jobKey: input.jobKey,
    cronDefined,
    cronInvoked,
    collectorCompleted,
    freshDataStored,
    reconciled,
    // The server cannot observe what a browser rendered; this requires a browser check against production.
    displayedInInterface: 'not_measured',
    evidence,
  };
}
