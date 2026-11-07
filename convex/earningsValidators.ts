import { v } from 'convex/values';
export const metricRecord = v.object({
  id:v.string(),metric:v.string(),value:v.number(),currency:v.string(),unit:v.string(),period:v.string(),basis:v.string(),sourceUrl:v.string(),
  sourceKind:v.union(v.literal('company'),v.literal('sec'),v.literal('news'),v.literal('consensus')),
  publishedAt:v.union(v.number(),v.null()),receivedAt:v.number(),verification:v.union(v.literal('verified'),v.literal('corroborated'),v.literal('unverified')),
  claimType:v.union(v.literal('fact'),v.literal('opinion'),v.literal('speculation')),role:v.union(v.literal('actual'),v.literal('consensus'),v.literal('outcome')),
  vendor:v.optional(v.string()),collectedAt:v.optional(v.number()),supersedes:v.optional(v.string()),
});
export const sourceRecord = v.object({id:v.string(),title:v.string(),url:v.string(),publishedAt:v.union(v.number(),v.null()),receivedAt:v.number(),verification:v.union(v.literal('verified'),v.literal('corroborated'),v.literal('unverified')),note:v.string()});
