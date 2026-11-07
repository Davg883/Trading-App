import { v } from 'convex/values';
export const reviewContext=v.object({
  thesis:v.string(), supportingEvidence:v.array(v.string()), challengingEvidence:v.array(v.string()),
  valuationRisks:v.array(v.string()), financialRisks:v.array(v.string()), dataFreshness:v.string(),
  uncertainty:v.string(),modelDisagreement:v.string(), suggestedNotionalGbp:v.union(v.number(),v.null()),
  plannedLossGbp:v.union(v.number(),v.null()),stopPriceUsd:v.union(v.number(),v.null()),portfolioExposureGbp:v.union(v.number(),v.null()),
});
