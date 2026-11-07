import {describe,it,expect} from 'vitest';
import capture from '../data/recovery/sourced-observations.json';
import request from '../data/recovery/november-3-2026-request.json';
import {parseRecoveryCase,buildRecoveryRegistration,classifyRecoveryCase,recoveryMomentum,evaluateRecoveryWindow,freezeRecoveryCase} from '../lib/market-recovery';

const data=()=>parseRecoveryCase(structuredClone(request.case));
const registration=()=>buildRecoveryRegistration(data(),{name:'Case 006 · three retrospective £500 entry experiments',...request,priceBasis:'total-return'});
describe('Case 006 independently sourced retrospective capture',()=>{
 it('preserves distinct primary index, ETF and equity histories without inventing the anchor session',()=>{
  const c=data();expect(c.mode).toBe('retrospective');expect(c.prices).toHaveLength(184);expect(c.prices.every(p=>!p.licensed&&p.usage==='public_reference'&&p.eventAt<c.anchorAt)).toBe(true);
  expect(c.instruments.filter(i=>['COMP','NDX','SOX'].includes(i.id)).every(i=>i.product==='index')).toBe(true);expect(c.instruments.find(i=>i.id==='QQQ')?.product).toBe('etf');
  expect(capture.closes.filter(p=>p.seriesKey==='ap-COMP')).toHaveLength(2);expect(c.prices.some(p=>p.provider.includes('AP'))).toBe(false);
  for(const symbol of ['COMP','NDX','SOX','QQQ','NVDA','MSFT','AAPL','VT'])expect(c.prices.filter(p=>p.instrumentId===symbol)).toHaveLength(23);
 });
 it('computes reproducible source-aligned index momentum but does not substitute November 2 into November 3 confirmation',()=>{
  const c=data(),m=recoveryMomentum(c,'COMP',request.cutoff);expect(m.latest?.close).toBe(25164.36);expect(m.windows.every(w=>w.status==='available')).toBe(true);expect(m).toEqual(recoveryMomentum(c,'COMP',request.cutoff));
  const result=classifyRecoveryCase(c,request.cutoff);expect(result.classification).toBe('unconfirmed');expect(result.missingCritical.join(';')).toMatch(/anchor close/);expect(result.breadthShare).toBeNull();expect(result.sectorShare).toBeNull();
 });
 it('keeps unknown corporate actions, cost assumptions, FX and macro baseline measurements missing',()=>{
  const c=data();expect(c.prices.filter(p=>['NVDA','MSFT','AAPL','VT','QQQ'].includes(p.instrumentId)).every(p=>p.priceBasis==='unadjusted_close'&&!p.corporateActionsReviewed)).toBe(true);
  expect(c.fx).toEqual([]);expect(c.breadth).toEqual([]);expect(c.sectorParticipation).toEqual([]);expect(c.plans.every(p=>p.fxFeeBps===null&&p.cashAnnualRate===null)).toBe(true);
  expect(classifyRecoveryCase(c,request.cutoff).indicators.every(i=>i.fiveSessionChange===null)).toBe(true);
 });
 it('registers three independent equal-capital research experiments and twelve identical-calendar pending windows',()=>{
  const c=data(),r=registration();expect(r.plans).toHaveLength(3);expect(r.plans.map(p=>p.initialCapitalGbp)).toEqual([500,500,500]);expect(r.windows).toHaveLength(12);
  expect(r.plans.find(p=>p.kind==='staged')?.schedule.map(s=>s.offsetSessions)).toEqual([0,5,20]);
  for(const horizon of [1,5,20,60]){const windows=r.windows.filter(w=>w.horizon===horizon);expect(new Set(windows.map(w=>w.endAt)).size).toBe(1);expect(windows.every(w=>evaluateRecoveryWindow(c,w,request.asOf).status==='pending')).toBe(true);}
  expect(new Date(r.windows.find(w=>w.horizon===60)!.endAt!).toISOString()).toBe('2027-02-01T21:00:00.000Z');expect(r.executionAuthority).toBe('none');
 });
 it('cannot leak a retrospective capture or updated election article into the earlier entry anchor',()=>{
  const c=data(),historical=freezeRecoveryCase(c,c.anchorAt);expect(historical.case.prices).toHaveLength(0);expect(historical.case.electionHeadlines).toHaveLength(0);expect(historical.case.indicators).toHaveLength(0);
  expect(classifyRecoveryCase(c,c.anchorAt).classification).toBe('unconfirmed');
 });
});
