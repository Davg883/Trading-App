import {describe,it,expect} from 'vitest';
import raw from '../data/earnings/amazon-q3-2026-cash.json';
import legacy from '../data/earnings/amazon-q3-2026.json';
import {parseAmazonCashCase,amazonCashKpis,buildAmazonInterpretation} from '../lib/amazon-cash-conversion';
import {parseMetricRecords,freezeEarningsSnapshot} from '../lib/earnings';

const data=parseAmazonCashCase(raw),cutoff=Math.max(...data.sources.map(s=>s.receivedAt));
describe('official Amazon case reconciliation',()=>{
  it('reconciles the Q3 gross-to-net cash statement without changing reporting scope',()=>{
    const k=amazonCashKpis(data,'2026-Q3',cutoff);
    expect(k.quarterly.companyRevenue.value).toBe(201944);expect(k.quarterly.companyOperatingIncome.value).toBe(28076);expect(k.quarterly.companyNetIncome.value).toBe(20685);
    expect(k.quarterly.awsRevenue.value).toBe(45984);expect(k.quarterly.awsOperatingIncome.value).toBe(17773);
    expect(k.quarterly.grossCapex.value).toBe(77259);expect(k.quarterly.capexProceeds.value).toBe(1381);expect(k.quarterly.netCapex.value).toBe(75878);expect(k.quarterly.freeCashFlow.value).toBe(-33456);expect(k.quarterly.cashBridgeResidual.value).toBe(0);
    expect(data.observations.find(o=>o.id===k.quarterly.netCapex.inputs[0])?.kind).toBe('derived');
    expect(k.articleDiscrepancy.articleVerified).toBe(false);
  });
  it('reconciles TTM inputs, compatible revenue, margins and cash deterioration',()=>{
    const k=amazonCashKpis(data,'2026-Q3',cutoff);
    expect(k.ttm.operatingCashFlow.value).toBe(168300);expect(k.ttm.netCapex.value).toBe(210657);expect(k.ttm.freeCashFlow.value).toBe(-42357);expect(k.ttm.revenue.value).toBe(797455);expect(k.ttm.cashBridgeResidual.value).toBe(0);
    expect(k.ttm.capexCoverage.value).toBeCloseTo(168300/210657,12);expect(k.ttm.freeCashFlowMargin.value).toBeCloseTo(-42357/797455,12);
    expect(k.quarterly.awsOperatingMargin.value).toBeCloseTo(17773/45984,12);expect(k.quarterly.companyOperatingMargin.value).toBeCloseTo(28076/201944,12);
    expect(k.changes.freeCashFlowDeltaYoy.value).toBe(-57145);expect(k.changes.netCapexGrowthYoy.value).toBeCloseTo(210657/115903-1,12);
    expect(k.changes.awsOperatingMarginQoq.value).toBeCloseTo((17773/45984-16621/42232)*100,12);
  });
  it('keeps management years, approximate Bedrock populations and undisclosed AI return separate',()=>{
    const k=amazonCashKpis(data,'2026-Q3',cutoff);expect(k.aiSpecificRoi.value).toBeNull();expect(k.management).toHaveLength(3);
    expect(k.management.find(o=>o.metric==='cash_capex_guidance')).toMatchObject({kind:'guidance',value:220000,qualifier:'approximately',period:{label:'2026',scope:'calendar_year'}});
    expect(k.management.filter(o=>o.metric==='aws_growth_forecast').map(o=>[o.period.label,o.qualifier,o.value])).toEqual([['2027','greater_than',.4],['2028','greater_than',.4]]);
    expect(k.bedrockComparison.comparable).toBe(false);expect(k.bedrock.map(b=>b.multiple)).toEqual([17,7]);expect(k.bedrock[0].population).not.toBe(k.bedrock[1].population);
  });
  it('retains retrospective receipts across prior quarters and the legacy earnings contract',()=>{
    expect(data.observations.every(o=>o.receivedAt===cutoff)).toBe(true);
    expect(new Set(data.observations.filter(o=>o.period.scope==='quarter').map(o=>o.period.label)).size).toBe(6);
    const metrics=parseMetricRecords(legacy.metrics);expect(metrics.every(m=>m.role==='actual'&&m.sourceKind==='sec')).toBe(true);
    expect(metrics.some(m=>/guidance|forecast/.test(m.metric))).toBe(false);expect(metrics.some(m=>data.observations.find(o=>o.id===m.id)?.kind==='derived')).toBe(false);
    expect(freezeEarningsSnapshot(metrics,{phase:'post',cutoff:legacy.releaseAt+60000,earningsPublishedAt:legacy.releaseAt}).status).toBe('blocked');
    const early=amazonCashKpis(data,'2026-Q3',legacy.releaseAt+60000);expect(early.ttm.freeCashFlow.value).toBeNull();expect(early.management).toEqual([]);
  });
  it('creates only a retrospective interpretation draft with common eligible evidence and pending models',()=>{
    const e=buildAmazonInterpretation(data,'2026-Q3',cutoff);expect(e.mode).toBe('retrospective');expect(e.models).toHaveLength(2);expect(e.models.every(m=>m.result===null&&m.status==='pending')).toBe(true);
    expect(e.baseline.positiveEvidence.length).toBeGreaterThan(0);expect(e.baseline.negativeEvidence.length).toBeGreaterThan(0);expect(e.baseline.marketForecast).toBeNull();expect(e.forwardExperiment.status).toBe('not_registered');expect(e.executionAuthority).toBe('none');
  });
});
