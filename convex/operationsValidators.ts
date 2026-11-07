import {v} from 'convex/values';

export const remoteOpsVersion=v.literal('remote-ops-003-v1');
export const jobCategory=v.union(v.literal('deterministic_collector'),v.literal('remote_agent'),v.literal('risk_evaluation'),v.literal('briefing_generator'));
export const jobEnvironment=v.union(v.literal('remote'),v.literal('local'));
export const activeEnvironment=v.union(v.literal('remote'),v.literal('local'),v.literal('disabled'));
export const jobRunStatus=v.union(v.literal('running'),v.literal('succeeded'),v.literal('failed'),v.literal('skipped'),v.literal('timed_out'),v.literal('budget_exceeded'));
export const stagingValidationStatus=v.union(v.literal('pending_verification'),v.literal('promoted'),v.literal('rejected'),v.literal('quarantined_injection'),v.literal('duplicate'));
export const claimClassification=v.union(v.literal('observed'),v.literal('reported'),v.literal('estimated'),v.literal('proposed'),v.literal('unverified'));
