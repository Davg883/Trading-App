import {describe,it,expect} from 'vitest';
import capture from '../data/recovery/sourced-observations-v2.json';
import request from '../data/recovery/november-3-2026-v2-request.json';
import v1Request from '../data/recovery/november-3-2026-request.json';
import {RECOVERY_CRITERIA,parseRecoveryCase,buildRecoveryRegistration,classifyRecoveryCase,recoveryMomentum,evaluateRecoveryWindow,recoveryRiskGate,freezeRecoveryCase} from '../lib/market-recovery';

const data=()=>parseRecoveryCase(structuredClone(request.case));
const anchor=Date.parse('2026-11-03T21:00:00Z');
const close=(id:string,iso:string)=>data().prices.find(p=>p.instrumentId===id&&p.eventAt===Date.parse(iso))?.close;
const pct=(v:number|null|undefined)=>v==null?null:Math.round(v*1e4)/100;

describe('Case 006 source v2: 5 November re-capture of the 3 November anchor',()=>{
 it('is a separate source version and leaves the v1 capture and its missing anchor intact',()=>{
  const c=data();expect(c.id).toBe('recovery-006-2026-11-03-v2');expect(c.anchorAt).toBe(anchor);expect(c.mode).toBe('retrospective');
  expect(v1Request.case.id).toBe('recovery-006-2026-11-03');expect(v1Request.case.prices.some(p=>p.eventAt===anchor)).toBe(false);
  expect(capture.v1Revisions).toEqual([]);
  expect(c.prices.every(p=>p.receivedAt>=Date.parse('2026-11-05T14:24:00Z')&&!p.licensed&&p.usage==='public_reference')).toBe(true);
 });
 it('keeps Composite, Nasdaq-100, QQQ and SOX as separate observed anchor closes',()=>{
  expect(close('COMP','2026-11-03T21:00:00Z')).toBe(25372.01);expect(close('NDX','2026-11-03T21:00:00Z')).toBe(28180.26);
  expect(close('QQQ','2026-11-03T21:00:00Z')).toBe(685.28);expect(close('SOX','2026-11-03T21:00:00Z')).toBe(10600.4);
  const c=data();expect(c.instruments.find(i=>i.id==='QQQ')?.product).toBe('etf');expect(['COMP','NDX','SOX'].every(id=>c.instruments.find(i=>i.id===id)?.product==='index')).toBe(true);
  for(const symbol of ['COMP','NDX','SOX','QQQ','NVDA','MSFT','AAPL','VT'])expect(c.prices.filter(p=>p.instrumentId===symbol)).toHaveLength(46);
 });
 it('ends anchor momentum at 3 November even when the cutoff includes the later 4 November close',()=>{
  const c=data(),bounded=recoveryMomentum(c,'COMP',request.cutoff,anchor),open=recoveryMomentum(c,'COMP',request.cutoff);
  expect(bounded.latest?.eventAt).toBe(anchor);expect(open.latest?.close).toBe(25736.51);
  expect(bounded.windows.map(w=>[w.sessions,pct(w.return),w.positiveSessions])).toEqual([[1,.83,1],[5,-4.18,2],[20,-8.07,8]]);
  expect(pct(bounded.windows[1].maximumDrawdown)).toBe(-5.22);
 });
 it('classifies the observed one-day rebound as unconfirmed and names only the genuinely missing evidence',()=>{
  const result=classifyRecoveryCase(data(),request.cutoff);expect(result.classification).toBe('unconfirmed');
  expect(result.missingCritical).toEqual(['Licensed complete Nasdaq Composite breadth with an explicit population is required','Licensed complete sector participation with an explicit population is required']);
  const by=Object.fromEntries(result.indicators.map(i=>[i.metric,i]));
  expect(by.vix.currentValue).toBe(20.83);expect(by.vix.fiveSessionChange).toBeCloseTo(3.31,6);
  expect(by.credit_spread.currentValue).toBeCloseTo(340,6);expect(by.credit_spread.fiveSessionChange).toBeCloseTo(22,6);
  expect(by.treasury_10y.fiveSessionChange).toBeCloseTo(-.04,6);
  // Independent of breadth: one positive session inside a negative five-session window fails persistence and two macro guards.
  expect(result.momentum.every(m=>m.windows[1].positiveSessions!<RECOVERY_CRITERIA.minimumPositiveSessions&&m.windows[1].return!<0)).toBe(true);
  expect(by.vix.fiveSessionChange!).toBeGreaterThan(RECOVERY_CRITERIA.maximumVixFiveSessionIncrease);
  expect(by.credit_spread.fiveSessionChange!).toBeGreaterThan(RECOVERY_CRITERIA.maximumCreditFiveSessionIncreaseBps);
 });
 it('cannot confirm even if a favourable licensed breadth and sector population were later supplied',()=>{
  const c=data(),src=c.sources[0].id;
  c.breadth=[{id:'what-if-breadth',populationInstrumentId:'COMP',populationDefinition:'Hypothetical test population',eventAt:anchor,publishedAt:anchor,receivedAt:anchor+1,advancing:2500,declining:400,unchanged:100,eligiblePopulation:3000,coverageComplete:true,licensed:true,sourceIds:[src],mode:'retrospective'}] as typeof c.breadth;
  c.sectorParticipation=[{id:'what-if-sectors',populationDefinition:'Hypothetical eleven sectors',eventAt:anchor,publishedAt:anchor,receivedAt:anchor+1,positiveSectors:11,totalSectors:11,coverageComplete:true,licensed:true,sourceIds:[src],mode:'retrospective'}] as typeof c.sectorParticipation;
  const result=classifyRecoveryCase(c,request.cutoff);expect(result.missingCritical).toEqual([]);expect(result.classification).toBe('unconfirmed');
 });
 it('keeps all twelve £500 windows pending: unlicensed prices, undisclosed costs and non-close-aligned FX',()=>{
  const c=data(),r=buildRecoveryRegistration(c,{name:'Case 006 v2',...request,priceBasis:'total-return'});
  expect(r.plans.map(p=>p.initialCapitalGbp)).toEqual([500,500,500]);expect(r.windows).toHaveLength(12);
  expect(r.windows.every(w=>evaluateRecoveryWindow(c,w,request.asOf).status==='pending')).toBe(true);
  expect(c.fx.every(f=>!f.licensed&&f.eventAt!==anchor)).toBe(true);
  for(const p of r.plans){const g=recoveryRiskGate(r,p.id,c,request.asOf);expect(g.passed).toBe(false);expect(g.executionAuthority).toBe('none');}
  expect(r.executionAuthority).toBe('none');
 });
 it('does not leak 5 November receipts into an assessment frozen at the anchor',()=>{
  const c=data(),frozen=freezeRecoveryCase(c,anchor);expect(frozen.case.prices).toHaveLength(0);expect(frozen.case.indicators).toHaveLength(0);
  expect(classifyRecoveryCase(c,anchor).classification).toBe('unconfirmed');
 });
});
