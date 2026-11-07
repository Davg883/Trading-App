import { v } from 'convex/values';

export const proofMode=v.union(v.literal('synthetic'),v.literal('historical'),v.literal('forward'));
export const proofDomain=v.union(v.literal('investment'),v.literal('vectis'));
export const proofStage=v.union(v.literal('idea'),v.literal('limited_pilot'),v.literal('expanded_pilot'),v.literal('production'));
export const proofGateType=v.union(v.literal('business_value'),v.literal('data_integrity'),v.literal('execution_safety'),v.literal('operational_readiness'));
export const proofMeasurement=v.object({metric:v.string(),value:v.number(),unit:v.string(),evidenceIds:v.array(v.string()),kind:v.union(v.literal('measured'),v.literal('forecast')),observedAt:v.number(),receivedAt:v.number()});
export const proofRun=v.object({id:v.string(),mode:proofMode,provider:v.string(),modelVersion:v.string(),inputTokens:v.number(),outputTokens:v.number(),inferenceCostGbp:v.union(v.number(),v.null()),latencyMs:v.union(v.number(),v.null()),quality:v.union(v.literal('passed'),v.literal('failed'),v.literal('not_evaluated')),fallbackCalls:v.number(),hardware:v.object({energyKwh:v.union(v.number(),v.null()),depreciationGbp:v.union(v.number(),v.null()),utilisation:v.union(v.number(),v.null()),throughputPerSecond:v.union(v.number(),v.null())})});
