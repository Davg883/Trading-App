import { describe, expect, it } from 'vitest';
import { DEFENCE_VERSION, compareDefencePortfolios, dailyInverseResearch, defenceHistoryAnalytics, freezeDefenceCase, optionResearchPayoff, parseDefenceCase, portfolioExposure, type DefenceCase, type DefenceInstrument } from '../lib/portfolio-defence';

const t=Date.UTC(2026,8,1),day=86400000,cutoff=t+100*day;
function instrument(id:string,extra:Partial<DefenceInstrument>={}):DefenceInstrument{return {id,name:id,symbol:id,isin:null,currency:'GBP',company:id,sector:'Technology',country:'US',aiLayer:'Compute',aiRelated:true,product:'equity',paperEligible:true,availability:'Unverified market availability; research only',structure:'Ordinary share',annualFeeBps:0,sourceIds:['source'],restrictions:['No execution'],risks:['Capital loss'],protectsAgainst:['No stated protection'],cannotProtectAgainst:['Market falls'],lossConditions:['Price falls'],...extra};}
function fixture():DefenceCase {
  const common={initialCapital:10000,currency:'GBP',horizonSessions:20,priceBasis:'total-return' as const,calendarId:'TEST',session:'regular' as const,mode:'synthetic' as const,costs:{fees:10,slippage:5,financing:0}};
  return {version:DEFENCE_VERSION,id:'case',name:'Synthetic defence research',mode:'synthetic',sources:[{id:'source',title:'Synthetic provenance only',url:'https://example.com/synthetic',publishedAt:t,receivedAt:t,mode:'synthetic',verified:true,role:'evidence'}],instruments:[instrument('AI'),instrument('CASH',{product:'cash',company:'Cash',sector:'Cash',country:'GB',aiLayer:'None',aiRelated:false}),instrument('FUND',{product:'etf',aiRelated:null,company:'Fund'})],funds:[{id:'fund-1',instrumentId:'FUND',asOf:t,publishedAt:t,receivedAt:t,verified:true,mode:'synthetic',sourceIds:['source'],constituents:[{instrumentId:'AI',weight:.6},{instrumentId:'CASH',weight:.4}]}],portfolios:[{...common,id:'base',name:'AI portfolio',allocations:[{instrumentId:'AI',weight:1}]},{...common,id:'defence',name:'Diversified alternative',allocations:[{instrumentId:'FUND',weight:.5},{instrumentId:'CASH',weight:.5}]}],scenarios:[{id:'fall',name:'Hypothetical AI correction',category:'ai_correction',kind:'user_defined',mode:'synthetic',publishedAt:t,receivedAt:t,sourceIds:['source'],startAt:t,endAt:t+20*day,horizonSessions:20,calendarId:'TEST',currency:'GBP',priceBasis:'total-return',session:'regular',returns:[{instrumentId:'AI',return:-.4},{instrumentId:'FUND',return:-.2},{instrumentId:'CASH',return:0}]}],histories:[]};
}
function addHistories(data:DefenceCase,n=65){
  const dates=Array.from({length:n+1},(_,i)=>t+i*day),returns=Array.from({length:n},(_,i)=>(i%5-2)*.003+.0003);
  for(const [id,multiplier] of [['AI',2],['CASH',1]] as const){let price=100;const observations=dates.map((eventAt,i)=>{if(i)price*=1+returns[i-1]*multiplier;return {eventAt,publishedAt:eventAt,receivedAt:eventAt,close:price,sourceId:'source'};});data.histories.push({id:`${id}-history`,instrumentId:id,provider:'Synthetic provider',currency:'GBP',priceBasis:'total-return',adjustmentVersion:'demo-v1',calendarId:'TEST',session:'regular',mode:'synthetic',corporateActionsReviewed:true,sessionsPerYear:252,calendarVerified:true,calendarSessions:dates,observations});}return data;
}

describe('Portfolio defence exposure and evidence',()=>{
  it('counts ETF constituents once and combines direct company exposure',()=>{
    const data=fixture();data.portfolios[0].allocations=[{instrumentId:'AI',weight:.5},{instrumentId:'FUND',weight:.5}];const r=portfolioExposure(data,'base',t);
    expect(r.leaves.reduce((n,l)=>n+l.weight,0)).toBeCloseTo(1);expect(r.dimensions.company.AI).toBeCloseTo(.8);expect(r.aiWeight).toBeCloseTo(.8);expect(r.leaves.some(l=>l.instrumentId==='FUND')).toBe(false);
  });
  it('leaves incomplete and stale global fund exposure unresolved',()=>{
    const data=fixture();data.funds[0].constituents=[{instrumentId:'AI',weight:.6}];const r=portfolioExposure(data,'defence',t);expect(r.unknownAiWeight).toBeCloseTo(.2);expect(r.hhiComplete).toBe(false);
    const stale=portfolioExposure(data,'defence',cutoff);expect(stale.unknownAiWeight).toBe(.5);expect(stale.leaves.find(l=>l.instrumentId===null)?.unknownReason).toContain('not assumed independent');
  });
  it('handles nested funds without counting wrappers and rejects cycles',()=>{
    const data=fixture();data.instruments.push(instrument('NESTED',{product:'etf'}));data.funds.push({...data.funds[0],id:'nested',instrumentId:'NESTED',constituents:[{instrumentId:'FUND',weight:1}]});data.portfolios[0].allocations=[{instrumentId:'NESTED',weight:1}];expect(portfolioExposure(data,'base',t).aiWeight).toBeCloseTo(.6);
    data.funds[0].constituents=[{instrumentId:'NESTED',weight:1}];expect(()=>parseDefenceCase(data)).toThrow(/Cyclic/);
  });
  it('rejects leverage, duplicate direct positions and overallocated fund holdings',()=>{
    const data=fixture();data.portfolios[0].allocations[0].weight=1.1;expect(()=>parseDefenceCase(data)).toThrow();const d=fixture();d.funds[0].constituents.push({instrumentId:'FUND',weight:.1});expect(()=>parseDefenceCase(d)).toThrow();
  });
  it('separates modes, late revisions, outcomes and missing authoritative specifications',()=>{
    const mixed=fixture();mixed.sources[0].mode='historical';expect(()=>parseDefenceCase(mixed)).toThrow(/cannot be combined/);
    for(const change of ['late','unverified','outcome']){const data=fixture();if(change==='late')data.sources[0].receivedAt=t+day;if(change==='unverified')data.sources[0].verified=false;if(change==='outcome')data.sources[0].role='outcome';const f=freezeDefenceCase(data,t);expect(f.case.portfolios).toHaveLength(0);expect(f.excluded.length).toBeGreaterThan(0);}
  });
  it('rejects out-of-range and fractional timestamps before display or freezing',()=>{
    for(const stamp of [8.64e15+1,Number.MAX_SAFE_INTEGER,t+.5,-1]){const d=fixture();d.sources[0].receivedAt=stamp;expect(()=>parseDefenceCase(d)).toThrow();}
    expect(()=>freezeDefenceCase(fixture(),8.64e15+1)).toThrow();
  });
});

describe('Matched scenario comparisons',()=>{
  it('uses identical starting capital, fully funds costs, and distinguishes gross/net protection',()=>{
    const data=fixture();data.portfolios[1].costs={fees:100,slippage:20,financing:5};const r=compareDefencePortfolios(data,'base','defence','fall',t);
    expect(r.baseline.initialCapital).toBe(10000);expect(r.alternative.initialCapital).toBe(10000);expect(r.alternative.deployedCapital).toBe(9875);expect(r.baseline.netPnl).toBeCloseTo(-4009);expect(r.alternative.netPnl).toBeCloseTo(-1112.5);expect(r.netProtection).toBeCloseTo(r.grossProtection-110);expect(r.reboundParticipation).toBeNull();expect(r.executionAuthority).toBe('none');
  });
  it('rejects mismatched capital, currencies, calendar, horizon and price basis',()=>{
    for(const [key,value] of [['initialCapital',12000],['currency','USD'],['calendarId','OTHER'],['horizonSessions',60],['priceBasis','split-adjusted']] as const){const data=fixture();Object.assign(data.portfolios[1],{[key]:value});expect(()=>compareDefencePortfolios(data,'base','defence','fall',t)).toThrow(/identical/);}
  });
  it('does not manufacture missing scenarios or cash interest',()=>{
    const data=fixture();data.scenarios[0].returns=data.scenarios[0].returns.filter(r=>r.instrumentId!=='CASH');expect(()=>compareDefencePortfolios(data,'base','defence','fall',t)).toThrow(/Missing scenario return/);
  });
  it('reports rebound participation only when baseline has a positive net outcome',()=>{
    const data=fixture();data.scenarios[0].returns.forEach(r=>r.return=r.instrumentId==='CASH'?0:.4);const r=compareDefencePortfolios(data,'base','defence','fall',t);expect(r.reboundParticipation).toBeGreaterThan(0);expect(r.reboundParticipation).toBeLessThan(1);
  });
  it('reproduces exactly and refuses static derivative or inverse shocks',()=>{
    const data=fixture();expect(compareDefencePortfolios(data,'base','defence','fall',t)).toEqual(compareDefencePortfolios(structuredClone(data),'base','defence','fall',t));data.instruments[0].product='inverse';data.instruments[0].paperEligible=false;expect(()=>compareDefencePortfolios(data,'base','defence','fall',t)).toThrow(/separate contract or daily-path/);
  });
  it('uses fully sourced aligned observations for historical scenarios, not article forecasts',()=>{
    const data=addHistories(fixture(),20);data.mode='historical';data.sources[0].mode='historical';data.funds.forEach(f=>f.mode='historical');data.portfolios.forEach(p=>{p.mode='historical';p.allocations=[{instrumentId:'AI',weight:1}];});data.histories.forEach(h=>h.mode='historical');const s=data.scenarios[0];s.kind='historical';s.mode='historical';s.publishedAt=t+20*day;s.receivedAt=s.publishedAt;s.returns=[{instrumentId:'AI',return:data.histories[0].observations.at(-1)!.close/100-1}];expect(compareDefencePortfolios(data,'base','defence','fall',cutoff).netProtection).toBe(0);s.returns[0].return+=.01;expect(()=>compareDefencePortfolios(data,'base','defence','fall',cutoff)).toThrow(/differs from/);
  });
});

describe('Aligned historical statistics',()=>{
  it('uses sample statistics and matched trading sessions with descriptive limitations',()=>{
    const data=addHistories(fixture());const result=defenceHistoryAnalytics(data,'AI','CASH',cutoff);expect(result.samples).toBe(65);expect(result.correlation).toBeCloseTo(1);expect(result.beta).toBeCloseTo(2);expect(result.annualVolatility).toBeGreaterThan(0);expect(result.maxDrawdown).toBeLessThan(0);expect(result.rolling).toHaveLength(6);expect(result.reliable).toBe(false);
  });
  it('floors a between-session cutoff to the latest common close',()=>{
    const data=addHistories(fixture());expect(defenceHistoryAnalytics(data,'AI','CASH',t+64.5*day).samples).toBe(64);expect(defenceHistoryAnalytics(data,'AI','CASH',cutoff,{endAt:t+64.5*day}).correlation).toBeNull();
  });
  it('does not estimate correlations or covariance from insufficient histories',()=>{
    const data=addHistories(fixture(),20);const r=defenceHistoryAnalytics(data,'AI','CASH',cutoff);expect(r.correlation).toBeNull();expect(r.beta).toBeNull();expect(r.reason).toContain('60 required');expect(()=>defenceHistoryAnalytics(data,'AI','CASH',cutoff,{minimumReturns:2})).toThrow(/At least 30/);
  });
  it('rejects gaps, FX mixing, adjustment differences and unreviewed corporate actions',()=>{
    for(const mutate of [(d:DefenceCase)=>{d.histories[1].observations.splice(20,1);},(d:DefenceCase)=>{d.histories[1].currency='USD';d.instruments[1].currency='USD';},(d:DefenceCase)=>{d.histories[1].adjustmentVersion='other';},(d:DefenceCase)=>{d.histories[1].corporateActionsReviewed=false;}]){const data=addHistories(fixture());mutate(data);expect(defenceHistoryAnalytics(data,'AI','CASH',cutoff).correlation).toBeNull();}
  });
  it('never leaks late received prices into an earlier forecast',()=>{
    const data=addHistories(fixture());data.histories[0].observations[30].receivedAt=cutoff+day;expect(defenceHistoryAnalytics(data,'AI','CASH',cutoff).correlation).toBeNull();expect(freezeDefenceCase(data,cutoff).excluded.some(e=>e.id.includes(String(t+30*day)))).toBe(true);
  });
  it('returns null correlation and beta for constant benchmark returns',()=>{
    const data=addHistories(fixture());data.histories[1].observations.forEach(o=>o.close=100);const r=defenceHistoryAnalytics(data,'AI','CASH',cutoff);expect(r.correlation).toBeNull();expect(r.beta).toBeNull();expect(r.reason).toContain('Constant');
  });
});

const put={kind:'protective_put',underlyingStart:100,underlyingEnd:70,shares:100,contracts:1,multiplier:100,putStrike:95,putPremium:3,callStrike:null,callPremium:0,expiryAt:t+20*day,settlementAt:t+20*day,asOf:t+20*day,currency:'GBP',premiumCurrency:'GBP',fees:5};
describe('Research-only derivative specifications',()=>{
  it('includes expiry, premium, contract multiplier and fees in put protection',()=>{const p=optionResearchPayoff(put);expect(p.status).toBe('complete');expect(p.grossPnl).toBe(-500);expect(p.netPnl).toBe(-805);expect(p.executionAuthority).toBe('none');});
  it('caps covered collar upside and includes premium credits',()=>{const p=optionResearchPayoff({...put,kind:'collar',underlyingEnd:130,callStrike:110,callPremium:2});expect(p.grossPnl).toBe(1000);expect(p.netPnl).toBe(895);});
  it('keeps preexpiry and missing or misdated settlement results pending',()=>{for(const amendment of [{asOf:t},{settlementAt:null},{settlementAt:t+21*day},{underlyingEnd:null}])expect(optionResearchPayoff({...put,...amendment}).netPnl).toBeNull();});
  it('rejects naked or overhedged contracts, FX mismatch and paper-eligible complex products',()=>{expect(()=>optionResearchPayoff({...put,contracts:2})).toThrow(/coverage/);expect(()=>optionResearchPayoff({...put,premiumCurrency:'USD'})).toThrow(/currency/);const d=fixture();d.instruments[0].product='protective_put';expect(()=>parseDefenceCase(d)).toThrow(/research only/);});
  it('compounds daily-reset inverse returns and fees rather than negating a multi-month index return',()=>{const r=dailyInverseResearch([.1,-.1],100);expect(r.indexReturn).toBeCloseTo(-.01);expect(r.grossReturn).toBeCloseTo(-.01);expect(r.grossReturn).not.toBeCloseTo(-r.indexReturn);expect(r.netReturn).toBeLessThan(r.grossReturn);expect(r.executionAuthority).toBe('none');});
  it('rejects numeric overflow and retains unverified input labels',()=>{const data=fixture();data.scenarios[0].returns[0].return=1e300;expect(()=>compareDefencePortfolios(data,'base','defence','fall',t)).toThrow(/precision/);expect(()=>dailyInverseResearch(Array(1000).fill(.9),0)).toThrow(/precision/);expect(optionResearchPayoff(put).evidenceStatus).toBe('unverified_user_input');});
});
