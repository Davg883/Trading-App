import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {evaluateCollectionHealth} from '../lib/remote-ops/health-monitor';

/**
 * Minor correction: public-facing status descriptions must not expose internal deployment identifiers
 * (Convex deployment names, Clerk instance slugs, TypeDB cluster hosts, cloud regions). Server-side
 * configuration comparisons are not covered here and were not changed.
 */
const INTERNAL=/benevolent-magpie|prestigious-dragon|harmless-akita|teoxx0|cluster\.typedb\.com|eu-west-1/;
describe('public status text carries no internal deployment identifiers',()=>{
 it('health-monitor execution-path labels and details',()=>{
  const r=evaluateCollectionHealth({now:Date.parse('2026-11-10T12:00:00Z'),systemEnabled:true,activeEnvironment:'remote',dailyCostCeilingGbp:2,monthlyCostCeilingGbp:25,dailyEstimatedCostGbp:0,dailyActualCostGbp:0,monthlyEstimatedCostGbp:0,monthlyActualCostGbp:0,pendingVerificationCount:0,jobs:[]});
  expect(JSON.stringify(r)).not.toMatch(INTERNAL);
 });
 it('source of the public status modules',()=>{
  for(const f of ['lib/remote-ops/health-monitor.ts','lib/portfolio/research-feed.ts'])expect(readFileSync(f,'utf8'),f).not.toMatch(INTERNAL);
 });
 it('the static fallback status does not claim live verification, TLS or projection figures it cannot know',()=>{
  const src=readFileSync('lib/portfolio/research-feed.ts','utf8');
  expect(src).not.toMatch(/TLS enabled · 23 relationships projected|0ms lag/);
 });
});
