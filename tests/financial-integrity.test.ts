import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {ILLUSTRATIVE_GBP_CASH_CARRY,MULTI_ASSET_INPUT_PROVENANCE,cashScenario,classifyInputFreshness,concentration,durationPriceReturn,dv01Gbp,gbpReturnOfUsdAsset,marketPnlExcludingFlows,usdChangeVsGbpFromCable} from '../lib/portfolio/financial-arithmetic';
import {PHASE_G8_MULTI_ASSET_UNIVERSE,calculatePortfolioConcentrationIntelligence,evaluatePhaseG8MultiAssetPilot} from '../lib/portfolio/multi-asset-risk-pilot';
import {todayInvestmentPnl} from '../lib/portfolio/performance';

/** MVP hardening — work package 8: deterministic financial arithmetic and data-status integrity. */
const close=(a:number,b:number,eps=1e-9)=>expect(Math.abs(a-b)).toBeLessThan(eps);

describe('WP8 — duration and DV01',()=>{
 it('price return for +150 bp on 2.15y and 8.35y duration, with and without convexity',()=>{
  close(durationPriceReturn(2.15,0.015),-0.03225);
  close(durationPriceReturn(8.35,0.015),-0.12525);
  close(durationPriceReturn(8.35,-0.015),0.12525);
  close(durationPriceReturn(8.35,0.015,80),-0.12525+0.5*80*0.000225);
  expect(()=>durationPriceReturn(-1,0.01)).toThrow();
 });
 it('DV01 is the value change for one basis point and agrees with the duration approximation',()=>{
  close(dv01Gbp(35_000,2.15),7.525);
  close(dv01Gbp(10_000,8.35),8.35);
  close(dv01Gbp(10_000,8.35)*150,-durationPriceReturn(8.35,0.015)*10_000,1e-6);
 });
 it('the pilot report DV01 field is the 100 bp sensitivity of its stated duration',()=>{
  const r=calculatePortfolioConcentrationIntelligence({accountSummary:{totalValue:100_000,cash:45_000},positions:[{ticker:'GLTS.L',name:'iShares UK Gilts 0-5yr',currency:'GBP',valuationGbp:35_000},{ticker:'IGLT.L',name:'iShares Core UK Gilts',currency:'GBP',valuationGbp:10_000}],accountSource:'educational_benchmark_model'});
  expect(r.dv01Per100BpsParallelShiftGbp).toBe(Math.round(100_000*r.portfolioEffectiveDurationYears/100));
 });
});

describe('WP8 — currency',()=>{
 it('a GBP investor gains when the dollar appreciates and loses when sterling appreciates; returns compound',()=>{
  const usdUp=usdChangeVsGbpFromCable(1.30,1.20);
  expect(usdUp).toBeGreaterThan(0);close(usdUp,1.30/1.20-1);
  const usdDown=usdChangeVsGbpFromCable(1.20,1.30);expect(usdDown).toBeLessThan(0);
  close(gbpReturnOfUsdAsset(0.10,0.10),0.21);
  close(gbpReturnOfUsdAsset(0,-0.10),-0.10);
  close(gbpReturnOfUsdAsset(-0.20,0.10),-0.12);
  expect(()=>usdChangeVsGbpFromCable(0,1.2)).toThrow();
 });
});

describe('WP8 — cash carry versus instantaneous shock',()=>{
 it('reports zero instantaneous shock and separate forward carry; an unavailable rate gives no carry figure',()=>{
  expect(cashScenario(10_000,4,1)).toEqual({instantaneousShockGbp:0,forwardCarryGbp:400});
  close(cashScenario(10_000,4,0.25).forwardCarryGbp!,100);
  expect(cashScenario(10_000,null,1).forwardCarryGbp).toBeNull();
 });
 it('the pilot cash carry figure is tied to a labelled illustrative input, not a live rate',()=>{
  const r=calculatePortfolioConcentrationIntelligence({accountSummary:{totalValue:10_000,cash:10_000},positions:[],accountSource:'educational_benchmark_model'});
  expect(r.cashCarryInput).toEqual(ILLUSTRATIVE_GBP_CASH_CARRY);
  expect(r.cashCarryInput.status).toBe('illustrative');expect(r.cashCarryInput.observedAt).toBe('2026-11-06');
  expect(r.annualCashCarryPnlGbp).toBe(Math.round(10_000*ILLUSTRATIVE_GBP_CASH_CARRY.value!/100));
  for(const sc of r.scenarioSensitivities)expect(sc.estimatedPnlGbp).toBe(0);
 });
});

describe('WP8 — withdrawals are not market losses',()=>{
 it('separates an external withdrawal from market movement',()=>{
  expect(marketPnlExcludingFlows(100_000,70_000,-30_000)).toBe(0);
  expect(marketPnlExcludingFlows(100_000,65_000,-30_000)).toBe(-5_000);
  expect(marketPnlExcludingFlows(100_000,110_000,5_000)).toBe(5_000);
 });
 it('the stored-valuation P/L excludes a same-day withdrawal',()=>{
  const day=Date.parse('2026-11-10T00:00:00Z');
  const v=(observedAt:number,totalValue:number)=>({observedAt,currency:'GBP',totalValue,cash:null,investedCost:null,investmentsValue:null,realisedProfitLoss:null,unrealisedProfitLoss:null});
  const pnl=todayInvestmentPnl([v(day-3600_000,10_000),v(day+7200_000,7_000)],[{reference:'w1',occurredAt:day+3600_000,amount:-3_000,currency:'GBP',type:'WITHDRAW'}],'GBP',day+7200_000);
  expect(pnl).toMatchObject({ok:true,value:0});
 });
});

describe('WP8 — concentration and missing prices',()=>{
 it('computes HHI and top-3 over priced positions and reports unpriced ones instead of dropping them silently',()=>{
  const c=concentration([{id:'A',valueGbp:50},{id:'B',valueGbp:30},{id:'C',valueGbp:20},{id:'D',valueGbp:null}]);
  expect(c).toMatchObject({totalPricedGbp:100,hhi:3800,top3Pct:100,unpricedPositionIds:['D'],complete:false});
  expect(concentration([{id:'X',valueGbp:null}])).toMatchObject({hhi:null,top3Pct:null,complete:false});
  expect(concentration([{id:'A',valueGbp:1},{id:'B',valueGbp:1},{id:'C',valueGbp:1},{id:'D',valueGbp:1}])).toMatchObject({hhi:2500,top3Pct:75});
 });
});

describe('WP8 — stale data and fixture labelling',()=>{
 const NOW=Date.parse('2026-11-10T12:00:00Z');
 it('missing or future timestamps are never fresh',()=>{
  expect(classifyInputFreshness(null,NOW,1000)).toBe('unavailable');
  expect(classifyInputFreshness(NOW+1,NOW,1000)).toBe('unavailable');
  expect(classifyInputFreshness(NOW-500,NOW,1000)).toBe('fresh');
  expect(classifyInputFreshness(NOW-5000,NOW,1000)).toBe('stale');
 });
 it('a real account holding exactly £250 cash is not mislabelled as a fixture',()=>{
  const r=calculatePortfolioConcentrationIntelligence({accountSummary:{totalValue:250,cash:250},positions:[],accountSource:'trading212_live_read_only',snapshotRetrievedAtMs:NOW-60_000,nowMs:NOW});
  expect(r).toMatchObject({isDevelopmentFixture:false,freshnessState:'fresh',connectionStatus:'connected'});
 });
 it('a live snapshot without a retrieval time, or an old one, is not called fresh or connected',()=>{
  const none=calculatePortfolioConcentrationIntelligence({accountSummary:{totalValue:1000,cash:100},positions:[],accountSource:'trading212_live_read_only',nowMs:NOW});
  expect(none).toMatchObject({isDevelopmentFixture:false,freshnessState:'unavailable',connectionStatus:'disconnected'});
  const old=calculatePortfolioConcentrationIntelligence({accountSummary:{totalValue:1000,cash:100},positions:[],accountSource:'trading212_live_read_only',snapshotRetrievedAtMs:NOW-3*86_400_000,nowMs:NOW});
  expect(old.freshnessState).toBe('stale');expect(old.dataSourceNotice).toMatch(/stale/);
 });
 it('unlabelled input is never treated as a live account',()=>{
  const r=calculatePortfolioConcentrationIntelligence({accountSummary:{totalValue:5000,cash:5000},positions:[]});
  expect(r.isDevelopmentFixture).toBe(true);expect(r.connectionStatus).toBe('fixture_baseline');
 });
 it('the G.8 pilot fixture is no longer labelled as a live Trading 212 account',()=>{
  const p=evaluatePhaseG8MultiAssetPilot();
  expect(p.ownerLiveAccountRiskSummary.accountSource).toBe('development_fixture_not_live');
  expect(p.ownerLiveAccountRiskSummary.dataSourceNotice).toMatch(/not read from any broker account/);
 });
 it('hand-entered universe inputs are not described as verified',()=>{
  expect(MULTI_ASSET_INPUT_PROVENANCE.status).toBe('illustrative');
  for(const i of PHASE_G8_MULTI_ASSET_UNIVERSE)expect(i.dataCoverageStatus).not.toBe('verified_primary_or_reference' as never);
 });
 it('the dashboard does not present fixed text as a live, evidence-locked answer about the user account',()=>{
  const src=readFileSync('components/portfolio-risk-dashboard.tsx','utf8');
  expect(src).not.toMatch(/Your Trading 212 live account currently holds|trading212-live-snapshot|Fresh \(<15m\)|Owner Live Account \(/);
  expect(src).toMatch(/fixed text written in advance/);
 });
});
