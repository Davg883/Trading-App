import {expect,it} from 'vitest';
import raw from '../data/infrastructure/nscale-october-2026.json';
import {parseInfrastructureCase,freezeInfrastructureCase,economicExposure,infrastructureKpis} from '../lib/infrastructure-financing';
const data=parseInfrastructureCase(raw),cutoff=Math.max(...data.sources.map(s=>s.receivedAt));
it('registers unsigned Monarch support separately from the disclosed Texas guarantee',()=>{
  const events=freezeInfrastructureCase(data,cutoff).activeEvents;
  const proposed=events.find(e=>e.eventId==='monarch-credit-talks')!,signed=events.find(e=>e.eventId==='texas-lease-guarantee')!;
  expect(proposed.status).toBe('reported_discussion');expect(proposed.principal).toBeNull();expect(signed.status).toBe('signed');expect(signed.claimType).toBe('contingent');expect(signed.projectId).not.toBe(proposed.projectId);
  expect(economicExposure(data,cutoff).totalPrincipal).toBeNull();
});
it('preserves Loughton announcement and customer-termination history without reviving a contract',()=>{
  const frozen=freezeInfrastructureCase(data,cutoff),history=frozen.case.events.filter(e=>e.eventId==='microsoft-loughton-customer');
  expect(history.map(e=>e.status)).toEqual(['announced','cancelled']);expect(frozen.activeEvents.find(e=>e.eventId==='microsoft-loughton-customer')?.status).toBe('cancelled');
  expect(frozen.case.relationships.find(r=>r.id==='loughton-terminated-link')?.certainty).toBe('reported');
});
it('excludes retrospective receipts from earlier forecasts and keeps TCV distinct from earned revenue',()=>{
  expect(freezeInfrastructureCase(data,Date.parse('2026-10-30T23:59:59Z')).activeEvents).toHaveLength(0);
  const kpis=infrastructureKpis(data,'Nscale',null,cutoff);expect(kpis.distinctMetrics.contractedBacklog.value).toBe(103400000000);expect(kpis.distinctMetrics.recognisedRevenue.value).toBe(140600000);expect(kpis.distinctMetrics.cashCollections.value).toBeNull();
  expect(infrastructureKpis(data,'Nscale','loughton-essex',cutoff).powerReadiness.value).toBeNull();
});
