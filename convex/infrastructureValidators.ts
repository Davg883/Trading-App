import {v} from 'convex/values';

export const infrastructureMode=v.union(v.literal('synthetic'),v.literal('historical'),v.literal('forward'));
export const infrastructureVersion=v.literal('infrastructure-001.2-v1');

/** Storage envelopes are small and stable; the versioned engine validates their JSON contents. */
export const infrastructureLinks={
  linkedEvidenceIds:v.array(v.id('evidence')),
  linkedEarningsEventIds:v.array(v.id('earningsEvents')),
  linkedProofEvidenceIds:v.array(v.id('proofEvidence')),
};
