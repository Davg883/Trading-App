import { z } from 'zod';
/** Earnings evidence values use declared units. Returns and margins are decimal fractions. */
export type MetricRecord = {
  id: string;
  metric: string;
  value: number;
  currency: string;
  unit: string;
  period: string;
  basis: string;
  sourceUrl: string;
  sourceKind: 'company' | 'sec' | 'news' | 'consensus';
  publishedAt: number | null;
  receivedAt: number;
  verification: 'verified' | 'corroborated' | 'unverified';
  claimType: 'fact' | 'opinion' | 'speculation';
  role: 'actual' | 'consensus' | 'outcome';
  vendor?: string;
  collectedAt?: number;
  supersedes?: string;
};
export type Calculation = { value: number | null; inputs: string[]; reason: string | null };
const metricSchema = z.object({
  id:z.string().min(1),metric:z.string().min(1),value:z.number().finite(),currency:z.string().min(1),unit:z.string().min(1),period:z.string().min(1),basis:z.string().min(1),
  sourceUrl:z.string().url().startsWith('https://'),sourceKind:z.enum(['company','sec','news','consensus']),publishedAt:z.number().finite().nullable(),receivedAt:z.number().finite(),
  verification:z.enum(['verified','corroborated','unverified']),claimType:z.enum(['fact','opinion','speculation']),role:z.enum(['actual','consensus','outcome']),
  vendor:z.string().optional(),collectedAt:z.number().finite().optional(),supersedes:z.string().optional(),
}).strict();
/** Parsing does not promote incomplete claims into verified numerical evidence. */
export function parseMetricRecords(input:unknown):MetricRecord[] {
  const records=z.array(metricSchema).max(1000).parse(input);
  if(new Set(records.map(r=>r.id)).size!==records.length)throw new Error('Evidence IDs must be unique');
  return records;
}
const finite = (n: number) => Number.isFinite(n);
function validateRecord(record: MetricRecord) {
  if (!record.id.trim() || !record.metric.trim() || !record.period.trim() || !record.basis.trim() || !record.currency.trim() || !record.unit.trim()) throw new Error('Metric identity, period, accounting basis and units required');
  if (!finite(record.value) || !finite(record.receivedAt) || (record.publishedAt !== null && !finite(record.publishedAt))) throw new Error('Finite values and timestamps required');
  if (record.publishedAt !== null && record.receivedAt < record.publishedAt) throw new Error('Receipt cannot precede publication');
  if (!/^https:\/\//.test(record.sourceUrl)) throw new Error('HTTPS source reference required');
  if (record.role === 'consensus' && (!record.vendor?.trim() || record.collectedAt === undefined || !finite(record.collectedAt))) throw new Error('Consensus vendor and collection timestamp required');
  if (record.collectedAt !== undefined && record.collectedAt > record.receivedAt) throw new Error('Consensus collection cannot follow system receipt');
}
function numerical(record: MetricRecord) {
  validateRecord(record);
  if (record.claimType !== 'fact' || record.role === 'outcome' || record.verification === 'unverified') throw new Error('A corroborated or verified numerical fact is required');
}
function compatible(a: MetricRecord, b: MetricRecord, sameMetric = false) {
  numerical(a); numerical(b);
  if (a.currency !== b.currency || a.unit !== b.unit || a.period !== b.period || a.basis !== b.basis || (sameMetric && a.metric !== b.metric)) throw new Error('Incompatible metric, period, currency, unit or accounting definition');
}
function result(inputs: MetricRecord[], operation: () => number): Calculation {
  try { const value = operation(); if (!finite(value)) throw new Error('Calculation has no finite result'); return { value, inputs: inputs.map(r => r.id), reason: null }; }
  catch (error) { return { value: null, inputs: inputs.map(r => r.id), reason: error instanceof Error ? error.message : 'Invalid inputs' }; }
}
export function cashFlowBridge(ocf: MetricRecord, capex: MetricRecord): Calculation {
  return result([ocf, capex], () => {
    compatible(ocf, capex);
    if (ocf.metric !== 'operating_cash_flow' || capex.metric !== 'capital_expenditure' || ocf.role !== 'actual' || capex.role !== 'actual' || capex.value < 0) throw new Error('Cash bridge requires actual operating cash flow and nonnegative capex');
    return ocf.value - capex.value;
  });
}
export function compareConsensus(actual: MetricRecord, estimate: MetricRecord, cutoff: number): { absolute: Calculation; relative: Calculation } {
  const absolute = result([actual, estimate], () => {
    compatible(actual, estimate, true);
    if (!finite(cutoff) || actual.role !== 'actual' || estimate.role !== 'consensus') throw new Error('Actual and consensus roles with finite cutoff required');
    if (estimate.publishedAt === null || estimate.publishedAt > cutoff || estimate.receivedAt > cutoff || estimate.collectedAt! > cutoff) throw new Error('Estimate was unavailable before the registered expectation cutoff');
    return actual.value - estimate.value;
  });
  const relative = absolute.value === null ? absolute : result([actual, estimate], () => {
    if (estimate.value === 0) throw new Error('Zero consensus has no meaningful relative surprise');
    return absolute.value! / Math.abs(estimate.value);
  });
  return { absolute, relative };
}
export function economicScorecard(records: MetricRecord[], period = '2026-Q3') {
  const get = (metric: string) => {
    const prior = metric === 'cloud_revenue_prior_year';
    const match = /^(\d{4})-Q([1-4])$/.exec(period);
    const wantedPeriod = prior && match ? `${Number(match[1])-1}-Q${match[2]}` : period;
    return records.filter(r => r.metric === (prior ? 'cloud_revenue' : metric) && r.role === 'actual' && r.period === wantedPeriod);
  };
  function calculate(names: string[], operation: (inputs: MetricRecord[]) => Calculation): Calculation {
    const groups = names.map(get);
    if (groups.some(g => g.length !== 1)) return { value: null, inputs: groups.flat().map(r => r.id), reason: 'Select exactly one version of each required metric' };
    return operation(groups.map(g => g[0]));
  }
  const ratio = (a: MetricRecord, b: MetricRecord): Calculation => result([a,b], () => {
    compatible(a,b); if (b.value <= 0) throw new Error('Positive denominator required'); return a.value / b.value;
  });
  return {
    freeCashFlow: calculate(['operating_cash_flow','capital_expenditure'], ([o,c]) => cashFlowBridge(o,c)),
    capexIntensity: calculate(['capital_expenditure','revenue'], ([c,r]) => ratio(c,r)),
    cashConversion: calculate(['operating_cash_flow','capital_expenditure','revenue'], ([o,c,r]) => result([o,c,r], () => {
      compatible(o,r); const bridge = cashFlowBridge(o,c); if (bridge.value === null) throw new Error(bridge.reason!); if (r.value <= 0) throw new Error('Positive revenue required'); return bridge.value / r.value;
    })),
    cloudOperatingMargin: calculate(['cloud_operating_income','cloud_revenue'], ([o,r]) => ratio(o,r)),
    cloudGrowth: calculate(['cloud_revenue','cloud_revenue_prior_year'], ([current,prior]) => result([current,prior], () => {
      numerical(current); numerical(prior);
      const period = /^(\d{4})-Q([1-4])$/.exec(current.period);
      if (!period || prior.period !== `${Number(period[1])-1}-Q${period[2]}` || current.currency !== prior.currency || current.unit !== prior.unit || current.basis !== prior.basis || prior.value <= 0) throw new Error('Comparable prior-year quarter and positive denominator required');
      return current.value / prior.value - 1;
    })),
  };
}
export type SnapshotOptions = { phase: 'pre' | 'post'; cutoff: number; earningsPublishedAt: number | null };
export function freezeEarningsSnapshot(records: MetricRecord[], options: SnapshotOptions) {
  const { phase, cutoff, earningsPublishedAt } = options;
  if (!finite(cutoff) || earningsPublishedAt === null || !finite(earningsPublishedAt)) throw new Error('Known earnings publication timestamp and finite cutoff required');
  if ((phase === 'pre' && cutoff >= earningsPublishedAt) || (phase === 'post' && cutoff < earningsPublishedAt)) throw new Error('Cutoff is inconsistent with pre/post earnings phase');
  if (new Set(records.map(r=>r.id)).size !== records.length) throw new Error('Evidence IDs must be unique');
  const byId=new Map(records.map(r=>[r.id,r]));
  for(const record of records){
    const visited=new Set([record.id]);let current=record;
    while(current.supersedes){
      const original=byId.get(current.supersedes);
      if(!original||visited.has(original.id)||original.metric!==record.metric||original.period!==record.period)throw new Error('Revision chains must reference the same metric and period without cycles');
      visited.add(original.id);current=original;
    }
  }
  const excluded: { id: string; reason: string }[] = [];
  const eligible: MetricRecord[] = [];
  for (const record of records) {
    let reason: string | null = null;
    try {
      validateRecord(record);
      if (record.role === 'outcome') reason = 'Market outcome excluded from model evidence';
      else if (record.verification !== 'verified') reason = 'Primary verification incomplete';
      else if (record.publishedAt === null) reason = 'Publication timestamp unknown';
      else if (record.publishedAt > cutoff || record.receivedAt > cutoff || (record.role === 'consensus' && record.collectedAt! > cutoff)) reason = 'Unavailable at the frozen cutoff';
    } catch (error) { reason = error instanceof Error ? error.message : 'Invalid evidence'; }
    if (reason) excluded.push({id:record.id,reason}); else eligible.push({...record});
  }
  // A correction replaces an earlier version only if the correction itself was eligible.
  const superseded = new Set(eligible.map(r=>r.supersedes).filter(Boolean));
  const evidence = eligible.filter(r=>!superseded.has(r.id));
  for (const record of eligible.filter(r=>superseded.has(r.id))) excluded.push({id:record.id,reason:'Superseded by a version available at cutoff'});
  return { ...options, evidence, excluded, status: evidence.length ? 'ready' as const : 'blocked' as const };
}
export type SessionPrice = { symbol: string; price: number; currency: string; observedAt: number; receivedAt: number; session: 'regular'|'after-hours'|'pre-market'; delayMs: number; sourceUrl: string; verified: boolean };
export function alignedPriceReaction(start: SessionPrice, end: SessionPrice, benchmarkStart: SessionPrice, benchmarkEnd: SessionPrice, options: { session: SessionPrice['session']; maxDelayMs: number }) {
  const all = [start,end,benchmarkStart,benchmarkEnd];
  if (!finite(options.maxDelayMs) || options.maxDelayMs < 0 || all.some(q=>!q.verified || !finite(q.price) || q.price <= 0 || !finite(q.observedAt) || !finite(q.receivedAt) || q.receivedAt < q.observedAt || q.receivedAt-q.observedAt > options.maxDelayMs || !finite(q.delayMs) || q.delayMs < 0 || q.delayMs > options.maxDelayMs || q.session !== options.session || !/^https:\/\//.test(q.sourceUrl))) throw new Error('Verified, session-aligned prices within the delay policy required');
  if (start.symbol !== end.symbol || benchmarkStart.symbol !== benchmarkEnd.symbol || start.symbol === benchmarkStart.symbol || all.some(q=>q.currency !== start.currency)) throw new Error('Stable company/benchmark identities and matching currency required');
  if (end.observedAt <= start.observedAt || start.observedAt !== benchmarkStart.observedAt || end.observedAt !== benchmarkEnd.observedAt) throw new Error('Company and benchmark observation windows must match exactly');
  const absoluteReturn = end.price/start.price-1;
  const benchmarkReturn = benchmarkEnd.price/benchmarkStart.price-1;
  return { absoluteReturn, benchmarkReturn, excessReturn: absoluteReturn-benchmarkReturn, returnUnit: 'decimal' as const };
}
