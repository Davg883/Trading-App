import { describe, expect, it } from 'vitest';
import { alignedPriceReaction, cashFlowBridge, compareConsensus, economicScorecard, freezeEarningsSnapshot } from '../lib/earnings';
import type { MetricRecord, SessionPrice } from '../lib/earnings';
const fact = (metric:string,value:number,extra:Partial<MetricRecord>={}):MetricRecord => ({id:metric,metric,value,currency:'USD',unit:'billions',period:'2026-Q3',basis:'GAAP',sourceUrl:'https://www.sec.gov/example',sourceKind:'sec',publishedAt:100,receivedAt:110,verification:'verified',claimType:'fact',role:'actual',...extra});
const records = [fact('revenue',127.577),fact('operating_cash_flow',42.290),fact('capital_expenditure',51.355),fact('cloud_revenue',30.709),fact('cloud_operating_income',11.121),fact('cloud_revenue',15.157,{id:'prior-cloud',period:'2025-Q3'})];
describe('earnings accounting',()=>{
  it('derives cash flow and distinct company/segment metrics from matching quarterly records',()=>{
    const result=economicScorecard(records);
    expect(result.freeCashFlow.value).toBeCloseTo(-9.065);
    expect(result.capexIntensity.value).toBeCloseTo(.402541213);
    expect(result.cashConversion.value).toBeCloseTo(-.07105513);
    expect(result.cloudOperatingMargin.value).toBeCloseTo(.36214139);
    expect(result.cloudGrowth.value).toBeCloseTo(1.026060565);
  });
  it('does not confuse a nine-month cash statement with a quarter',()=>{
    expect(cashFlowBridge(records[1],fact('capital_expenditure',131.953,{period:'2026-YTD-Q3'})).value).toBeNull();
  });
  it('blocks calculations on unverified commentary and ambiguous revisions',()=>{
    expect(cashFlowBridge({...records[1],claimType:'opinion'},records[2]).value).toBeNull();
    expect(economicScorecard([...records,{...records[0],id:'revised-revenue'}]).capexIntensity.reason).toContain('exactly one');
  });
});
describe('consensus compatibility',()=>{
  const estimate=fact('revenue',128.2,{id:'consensus',role:'consensus',sourceKind:'consensus',vendor:'vendor-A',collectedAt:90,publishedAt:90,receivedAt:95});
  it('calculates comparable revenue surprise using absolute consensus',()=>{
    expect(compareConsensus(records[0],estimate,99).relative.value).toBeCloseTo((127.577-128.2)/128.2);
  });
  it('blocks GAAP versus adjusted EPS, wrong currencies and late estimates',()=>{
    const eps=fact('eps',2.12,{unit:'per-share'});
    expect(compareConsensus(eps,{...estimate,metric:'eps',unit:'per-share',basis:'adjusted'},99).absolute.value).toBeNull();
    expect(compareConsensus(records[0],{...estimate,currency:'GBP'},99).absolute.value).toBeNull();
    expect(compareConsensus(records[0],{...estimate,collectedAt:105},99).absolute.value).toBeNull();
  });
  it('reports absolute negative FCF surprise without denominator sign inversion',()=>{
    const actual=fact('free_cash_flow',-9.065,{basis:'OCF minus capex'});
    const expected={...estimate,metric:'free_cash_flow',value:-2.7,basis:'OCF minus capex'};
    expect(compareConsensus(actual,expected,99).absolute.value).toBeCloseTo(-6.365);
    expect(compareConsensus(actual,{...expected,value:0},99).relative.value).toBeNull();
  });
});
describe('earnings snapshots',()=>{
  it('excludes retrospectively received earnings and later market outcomes from both phases',()=>{
    const later=fact('reaction',-.12,{id:'outcome',role:'outcome'});
    const pre=freezeEarningsSnapshot([...records,later],{phase:'pre',cutoff:99,earningsPublishedAt:100});
    expect(pre.status).toBe('blocked');expect(pre.evidence).toHaveLength(0);
    expect(freezeEarningsSnapshot(records,{phase:'post',cutoff:105,earningsPublishedAt:100}).evidence).toHaveLength(0);
    const post=freezeEarningsSnapshot([...records,later],{phase:'post',cutoff:120,earningsPublishedAt:100});
    expect(post.evidence).toHaveLength(records.length);expect(post.excluded[0].reason).toContain('outcome');
  });
  it('blocks unknown release times, invalid phases and unverified facts',()=>{
    expect(()=>freezeEarningsSnapshot(records,{phase:'post',cutoff:120,earningsPublishedAt:null})).toThrow();
    expect(()=>freezeEarningsSnapshot(records,{phase:'pre',cutoff:120,earningsPublishedAt:100})).toThrow();
    expect(freezeEarningsSnapshot([fact('revenue',1,{verification:'corroborated'})],{phase:'post',cutoff:120,earningsPublishedAt:100}).status).toBe('blocked');
  });
  it('selects only corrections known at cutoff without mutating old snapshots',()=>{
    const old=fact('revenue',1), correction=fact('revenue',2,{id:'revision',supersedes:'revenue',publishedAt:130,receivedAt:140});
    const before=freezeEarningsSnapshot([old,correction],{phase:'post',cutoff:120,earningsPublishedAt:100});
    const after=freezeEarningsSnapshot([old,correction],{phase:'post',cutoff:150,earningsPublishedAt:100});
    expect(before.evidence.map(r=>r.value)).toEqual([1]);expect(after.evidence.map(r=>r.value)).toEqual([2]);
  });
  it('rejects revision chains that would remove unrelated metrics',()=>{
    expect(()=>freezeEarningsSnapshot([fact('revenue',1),fact('capital_expenditure',2,{supersedes:'revenue'})],{phase:'post',cutoff:150,earningsPublishedAt:100})).toThrow('Revision chains');
  });
});
describe('market alignment',()=>{
  const quote=(symbol:string,price:number,observedAt:number):SessionPrice=>({symbol,price,observedAt,receivedAt:observedAt+1,delayMs:1,session:'regular',currency:'USD',verified:true,sourceUrl:'https://licensed.example/quote'});
  const prices=[quote('GOOGL',100,100),quote('GOOGL',88,200),quote('QQQ',100,100),quote('QQQ',98,200)] as const;
  it('separates absolute return from aligned benchmark excess',()=>{
    const value=alignedPriceReaction(...prices,{session:'regular',maxDelayMs:100});
    expect(value.absoluteReturn).toBeCloseTo(-.12);expect(value.excessReturn).toBeCloseTo(-.10);
  });
  it('rejects mismatched sessions, delayed quotes and different observation windows',()=>{
    expect(()=>alignedPriceReaction({...prices[0],session:'after-hours'},prices[1],prices[2],prices[3],{session:'regular',maxDelayMs:100})).toThrow();
    expect(()=>alignedPriceReaction({...prices[0],delayMs:1000},prices[1],prices[2],prices[3],{session:'regular',maxDelayMs:100})).toThrow();
    expect(()=>alignedPriceReaction({...prices[0],delayMs:1,receivedAt:1000},prices[1],prices[2],prices[3],{session:'regular',maxDelayMs:100})).toThrow();
    expect(()=>alignedPriceReaction(prices[0],prices[1],prices[2],{...prices[3],observedAt:201},{session:'regular',maxDelayMs:100})).toThrow();
  });
});
