import {describe,it,expect} from 'vitest';
import {observedConsensusCase,syntheticConsensusCase,latestConsensusReceipt} from '../lib/consensus-demo';
import {buildConsensusStudy,consensusSummary,consensusRevisions,evaluateConsensusWindow,freezeConsensusCase,consensusAblationReport} from '../lib/analyst-consensus';
import {consensusCompanyContextSchema} from '../lib/consensus-context';

describe('Consensus 001 imported source and demonstration boundary',()=>{
  it('preserves three official company contexts without unlicensed consensus or quotes',()=>{
    const data=observedConsensusCase();expect(data.providers).toEqual([]);expect(data.recommendations).toEqual([]);expect(data.prices).toEqual([]);expect(data.fx).toEqual([]);
    const rows=data.contextRecords.map(r=>consensusCompanyContextSchema.parse(JSON.parse(r.recordJson)));expect(new Set(rows.map(r=>r.symbol)).size).toBe(3);expect(rows.every(r=>r.valuation===null)).toBe(true);
    expect(rows.find(r=>r.symbol==='NVDA')?.freeCashFlow.value).toBe(21341);expect(rows.find(r=>r.symbol==='MSFT')?.freeCashFlow.value).toBe(18633);expect(rows.find(r=>r.symbol==='AAPL')?.freeCashFlow.value).toBe(136056);
    expect(consensusSummary(data,'NVDA','',latestConsensusReceipt(data)).targets.mean).toBeNull();
  });
  it('registers two separate £500 plans and actual holiday-aware pending session windows',()=>{
    const data=observedConsensusCase(),cutoff=latestConsensusReceipt(data),study=buildConsensusStudy(data,{name:'Imported case',cutoff,startAt:Date.parse('2026-11-03T21:00:00Z'),registeredAt:cutoff,benchmarkInstrumentId:'VT',priceBasis:'total-return',adjustmentVersion:'provider-v1'});
    expect(study.portfolios).toHaveLength(2);expect(study.portfolios.every(p=>p.initialCapitalGbp===500)).toBe(true);expect(study.windows).toHaveLength(8);
    expect(study.windows.slice(0,4).map(w=>new Date(w.endAt!).toISOString())).toEqual(['2026-11-04T21:00:00.000Z','2026-11-10T21:00:00.000Z','2026-12-02T21:00:00.000Z','2027-02-01T21:00:00.000Z']);
    expect(study.windows.every(w=>evaluateConsensusWindow(data,w,cutoff).status==='pending')).toBe(true);
    expect(study.arms[2].inputIds).toEqual(expect.arrayContaining(study.arms[1].inputIds));
  });
  it('keeps Melius media corroboration outside frozen numerical evidence',()=>{
    const data=observedConsensusCase();expect(data.webClaims[0].description).toContain('USD420 to USD315');expect(freezeConsensusCase(data,latestConsensusReceipt(data)).case.webClaims).toEqual([]);
    expect(freezeConsensusCase(data,Date.parse('2026-11-03T21:00:00Z')).case.contextRecords).toEqual([]);
  });
  it('demonstrates target cuts and a stable headline with clearly synthetic completed GBP paths',()=>{
    const data=syntheticConsensusCase(),cutoff=Date.parse('2026-06-30T20:00:00Z'),r=consensusRevisions(data,'NVDA','synthetic-provider',cutoff,7);
    expect(data.contextRecords).toEqual([]);expect(r.headlineChange.changed).toBe(false);expect(r.reportedEvents.targetLowered).toBe(2);expect(r.matchedCohort.matchedAnalysts).toBe(2);
    const study=buildConsensusStudy(data,{name:'Synthetic case',cutoff,startAt:cutoff,registeredAt:cutoff,benchmarkInstrumentId:'VT',priceBasis:'total-return',adjustmentVersion:'synthetic-total-return-v1'});
    const outcomes=study.windows.map(w=>evaluateConsensusWindow(data,w,latestConsensusReceipt(data)));expect(outcomes.every(r=>r.status==='complete')).toBe(true);expect(outcomes.every(r=>r.result?.initialCapitalGbp===500)).toBe(true);expect(consensusAblationReport(data,latestConsensusReceipt(data)).status).toBe('insufficient_evidence');
  });
});
