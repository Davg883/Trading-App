import {describe,it,expect} from 'vitest';
import {defenceDemonstration,emptyDefenceCase,defenceLatestReceipt} from '../lib/defence-demo';
import {portfolioExposure,compareDefencePortfolios,defenceHistoryAnalytics,freezeDefenceCase} from '../lib/portfolio-defence';

describe('portfolio defence demonstration boundary',()=>{
  it('starts observed research empty, with no invented instruments or prices',()=>{
    const data=emptyDefenceCase();expect(data.mode).toBe('historical');expect(data.instruments).toEqual([]);expect(data.histories).toEqual([]);expect(data.portfolios).toEqual([]);
  });
  it('reconciles overlapping direct and ETF synthetic exposure and the undisclosed residual',()=>{
    const data=defenceDemonstration(),r=portfolioExposure(data,'unhedged',defenceLatestReceipt(data));
    expect(data.instruments.every(i=>i.id.startsWith('demo-')&&i.isin===null)).toBe(true);
    expect(r.aiWeight).toBeCloseTo(.84);expect(r.unknownAiWeight).toBeCloseTo(.04);
    expect(r.leaves.reduce((n,r)=>n+r.weight,0)).toBeCloseTo(1);expect(r.dimensions.company['Illustrative AI infrastructure company']).toBeCloseTo(.84);expect(r.hhiComplete).toBe(false);
  });
  it('has all five matched scenarios with explicit costs and different recovery participation',()=>{
    const data=defenceDemonstration(),cutoff=defenceLatestReceipt(data);
    expect(data.scenarios).toHaveLength(5);
    for(const s of data.scenarios){const c=compareDefencePortfolios(data,'unhedged','diversified',s.id,cutoff);expect(c.baseline.initialCapital).toBe(c.alternative.initialCapital);expect(c.alternative.deployedCapital).toBe(9970);expect(c.alternative.costs).toBe(30);expect(c.netProtection).toBeCloseTo(c.grossProtection-30);}
    expect(compareDefencePortfolios(data,'unhedged','diversified','ai_recovery',cutoff).reboundParticipation).toBeGreaterThan(0);
    expect(compareDefencePortfolios(data,'unhedged','diversified','ai_recovery',cutoff).reboundParticipation).toBeLessThan(1);
  });
  it('uses same-currency synthetic analytics and rejects other-currency pairings',()=>{
    const data=defenceDemonstration(),cutoff=defenceLatestReceipt(data),r=defenceHistoryAnalytics(data,'demo-ai','demo-benchmark',cutoff);
    expect(r.samples).toBe(70);expect(r.correlation).toBeCloseTo(1);expect(r.rolling).toHaveLength(11);expect(r.reliable).toBe(false);
    expect(defenceHistoryAnalytics(data,'demo-ai','demo-global',cutoff).correlation).toBeNull();
  });
  it('excludes synthetic source declarations and their dependent prices at an earlier cutoff',()=>{
    const data=defenceDemonstration(),snapshot=freezeDefenceCase(data,0);expect(snapshot.case.sources).toEqual([]);expect(snapshot.case.portfolios).toEqual([]);expect(snapshot.executionAuthority).toBe('none');
  });
});
