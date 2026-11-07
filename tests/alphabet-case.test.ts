import { describe, expect, it } from 'vitest';
import caseStudy from '../data/earnings/alphabet-q3-2026.json';
import { economicScorecard, freezeEarningsSnapshot, compareConsensus, type MetricRecord } from '../lib/earnings';
const records=caseStudy.metrics as MetricRecord[];
describe('imported Alphabet case',()=>{
  it('reconciles SEC quarterly cash flow and segment calculations',()=>{const score=economicScorecard(records,caseStudy.period);expect(score.freeCashFlow.value).toBeCloseTo(-9.065);expect(score.capexIntensity.value).toBeCloseTo(51.355/127.577);expect(score.cashConversion.value).toBeCloseTo(-9.065/127.577);expect(score.cloudOperatingMargin.value).toBeCloseTo(11.121/30.709);expect(score.cloudGrowth.value).toBeCloseTo(30.709/15.157-1);});
  it('cannot backdate this import into a pre-release or immediate post-release forecast',()=>{for(const phase of ['pre','post'] as const){const snapshot=freezeEarningsSnapshot(records,{phase,cutoff:caseStudy.releaseAt+(phase==='pre'?-1:60000),earningsPublishedAt:caseStudy.releaseAt});expect(snapshot.evidence).toHaveLength(0);expect(snapshot.status).toBe('blocked');}});
  it('keeps media consensus ineligible despite plausible figures',()=>{const actual=records.find(r=>r.metric==='revenue'&&r.period===caseStudy.period&&r.role==='actual')!;for(const estimate of records.filter(r=>r.metric==='revenue'&&r.role==='consensus'))expect(compareConsensus(actual,estimate,caseStudy.releaseAt-1).absolute.value).toBeNull();});
});
