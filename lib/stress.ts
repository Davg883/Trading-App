import { z } from 'zod';
import { alignedReturns, calendarSchema, marketBarSchema, sourceUrlSchema, STRESS_SYMBOLS, STRESS_VERSION, type ExchangeCalendar, type MarketBar } from './market-data';

const metrics=['forward_eps','revenue','operating_income','operating_cash_flow','capex','debt','cash','market_cap','preferred_equity','minority_interest','debt_due_12m'] as const;
export const financialObservationSchema=z.object({
  id:z.string().min(1),symbol:z.enum(STRESS_SYMBOLS),metric:z.enum(metrics),value:z.number().finite(),unit:z.enum(['currency','currency-per-share']),currency:z.string().regex(/^[A-Z]{3}$/),
  period:z.object({start:z.number().finite().nonnegative(),end:z.number().finite().nonnegative(),label:z.string().min(1),scope:z.enum(['quarter','annual','ttm','forward12m','instant'])}).strict(),
  basis:z.enum(['gaap','non-gaap']),kind:z.enum(['reported','estimated','derived']),publishedAt:z.number().finite().nonnegative(),receivedAt:z.number().finite().nonnegative(),sourceUrl:sourceUrlSchema,verified:z.boolean(),synthetic:z.boolean(),adjustmentVersion:z.string().min(1),consensusVendor:z.string().min(1).optional(),collectedAt:z.number().finite().nonnegative().optional(),
}).strict().superRefine((r,ctx)=>{
  if(r.period.start>r.period.end||r.receivedAt<r.publishedAt)ctx.addIssue({code:'custom',message:'Invalid reporting period or receipt time'});
  if(r.unit!==(r.metric==='forward_eps'?'currency-per-share':'currency'))ctx.addIssue({code:'custom',message:'Metric unit mismatch'});
  if(['capex','debt','cash','market_cap','preferred_equity','minority_interest','debt_due_12m'].includes(r.metric)&&r.value<0)ctx.addIssue({code:'custom',message:'Balance and capex outflow must be nonnegative'});
});
export type FinancialObservation=z.infer<typeof financialObservationSchema>;
export type ValuationValue={value:number|null;reason:string|null;sourceIds:string[]};
export type ValuationSnapshot={price:MarketBar|null;financials:FinancialObservation[];asOf:number};
const missing=(reason:string):ValuationValue=>({value:null,reason,sourceIds:[]});

export function valuationReset(input:ValuationSnapshot&{prior?:ValuationSnapshot}){
  const build=(snapshot:ValuationSnapshot)=>{
    if(!Number.isFinite(snapshot.asOf))throw new Error('Finite cutoff required');
    snapshot.financials.forEach(r=>financialObservationSchema.parse(r));
    if(new Set(snapshot.financials.map(r=>r.id)).size!==snapshot.financials.length)throw new Error('Financial observation IDs must be unique');
    if(snapshot.price)marketBarSchema.parse(snapshot.price);
    const eligible=snapshot.financials.filter(r=>r.publishedAt<=snapshot.asOf&&r.receivedAt<=snapshot.asOf&&r.verified&&(r.kind==='estimated'||r.period.end<=r.publishedAt));
    if(new Set(eligible.map(r=>r.synthetic)).size>1||new Set(eligible.map(r=>r.symbol)).size>1)throw new Error('Synthetic and observed records or issuers cannot be mixed');
    const records=Object.fromEntries(metrics.map(m=>{const rows=eligible.filter(r=>r.metric===m).sort((a,b)=>b.publishedAt-a.publishedAt||b.receivedAt-a.receivedAt);if(rows.length>1&&rows[0].publishedAt===rows[1].publishedAt&&rows[0].receivedAt===rows[1].receivedAt)throw new Error(`Ambiguous latest ${m} observations; select an explicit reporting period or revision`);return [m,rows[0]];})) as Record<typeof metrics[number],FinancialObservation|undefined>;
    const calc=(names:typeof metrics[number][],fn:(...values:number[])=>number,scope:'flow'|'instant'|'eps'='flow'):ValuationValue=>{
      const rows=names.map(m=>records[m]);
      if(rows.some(r=>!r))return missing(`Missing ${names.filter((_,i)=>!rows[i]).join(', ')}`);
      const data=rows as FinancialObservation[];const first=data[0];
      if(data.some(r=>r.currency!==first.currency||r.synthetic!==first.synthetic||r.basis!==first.basis||r.adjustmentVersion!==first.adjustmentVersion||r.period.start!==first.period.start||r.period.end!==first.period.end||r.period.scope!==first.period.scope))return missing('Incompatible accounting periods, currency or definitions');
      if(scope==='flow'&&(data.some(r=>r.kind!=='reported')||!['quarter','annual','ttm'].includes(first.period.scope)))return missing('Compatible reported cash flow or earnings periods required');
      if(scope==='instant'&&(data.some(r=>r.kind==='estimated')||first.period.scope!=='instant'))return missing('Compatible reported balance sheet dates required');
      if(scope==='eps'&&(first.kind!=='estimated'||first.period.scope!=='forward12m'||!first.consensusVendor||first.collectedAt===undefined||first.collectedAt>snapshot.asOf||first.collectedAt>first.receivedAt||first.value<=0))return missing('Positive authoritative forward consensus with known collection cutoff required');
      const value=fn(...data.map(r=>r.value));
      return Number.isFinite(value)?{value,reason:null,sourceIds:data.map(r=>r.id)}:missing('Undefined denominator');
    };
    const forwardEPS=calc(['forward_eps'],v=>v,'eps');
    let forwardPE=missing('Eligible compatible sourced price and consensus required');const price=snapshot.price,eps=records.forward_eps;
    if(price&&eps&&forwardEPS.value!==null&&price.eventAt<=snapshot.asOf&&price.receivedAt<=snapshot.asOf&&price.symbol===eps.symbol&&price.currency===eps.currency&&price.synthetic===eps.synthetic&&price.adjustmentVersion===eps.adjustmentVersion&&price.corporateActionsReviewed&&price.priceBasis!=='total-return')forwardPE={value:price.close/forwardEPS.value,reason:null,sourceIds:[price.id,eps.id]};
    const enterpriseValue=calc(['market_cap','debt','cash','preferred_equity','minority_interest'],(mc,d,c,p,m)=>mc+d-c+p+m,'instant');
    const revenue=calc(['revenue'],v=>v);
    const evRevenue=enterpriseValue.value!==null&&revenue.value!==null&&revenue.value>0&&records.market_cap?.currency===records.revenue?.currency&&records.market_cap?.basis===records.revenue?.basis&&records.market_cap?.adjustmentVersion===records.revenue?.adjustmentVersion&&records.revenue!.period.end<=records.market_cap!.period.end&&['annual','ttm'].includes(records.revenue!.period.scope)?{value:enterpriseValue.value/revenue.value,reason:null,sourceIds:[...enterpriseValue.sourceIds,...revenue.sourceIds]}:missing('Compatible annual or trailing revenue ending on or before enterprise-value reference date required');
    return {records,eligible,kpis:{forwardPE,forwardEPS,enterpriseValue,evRevenue,operatingCashFlow:calc(['operating_cash_flow'],v=>v),capex:calc(['capex'],v=>v),freeCashFlow:calc(['operating_cash_flow','capex'],(c,k)=>c-k),freeCashFlowMargin:calc(['operating_cash_flow','capex','revenue'],(c,k,r)=>r>0?(c-k)/r:NaN),capexRevenue:calc(['capex','revenue'],(c,r)=>r>0?c/r:NaN),netDebt:calc(['debt','cash'],(d,c)=>d-c,'instant'),debtDue12m:calc(['debt_due_12m'],v=>v,'instant'),operatingMargin:calc(['operating_income','revenue'],(o,r)=>r>0?o/r:NaN),revenue}};
  };
  const current=build(input),prior=input.prior?build(input.prior):null;
  const change=(key:'forwardPE'|'forwardEPS'|'operatingMargin'|'revenue',relative:boolean):ValuationValue=>{
    if(!prior||input.prior!.asOf>=input.asOf)return missing('Earlier compatible observation required');
    const a=current.kpis[key],b=prior.kpis[key];const metric=key==='forwardPE'||key==='forwardEPS'?'forward_eps':key==='operatingMargin'?'operating_income':'revenue';
    const x=current.records[metric],y=prior.records[metric];
    if(!x||!y||x.currency!==y.currency||x.symbol!==y.symbol||x.synthetic!==y.synthetic||x.basis!==y.basis||x.period.scope!==y.period.scope||x.adjustmentVersion!==y.adjustmentVersion||x.consensusVendor!==y.consensusVendor)return missing('Prior observation definitions differ');
    if((key==='forwardPE'||key==='forwardEPS')&&(x.period.start!==y.period.start||x.period.end!==y.period.end))return missing('Consensus forecast horizons differ');
    if((key==='operatingMargin'||key==='revenue')&&x.period.start<=y.period.end)return missing('Comparable nonoverlapping reporting periods of the same scope required');
    if(a.value===null||b.value===null||(relative&&b.value<=0))return missing('Both valid current and prior values required');
    return {value:relative?a.value/b.value-1:a.value-b.value,reason:null,sourceIds:[...a.sourceIds,...b.sourceIds]};
  };
  return {version:STRESS_VERSION,inputs:{reported:current.eligible.filter(r=>r.kind==='reported'),estimated:current.eligible.filter(r=>r.kind==='estimated'),derived:current.eligible.filter(r=>r.kind==='derived')},kpis:{...current.kpis,forwardPEChange:change('forwardPE',false),forwardEPSChange:change('forwardEPS',true),revenueGrowth:change('revenue',true),operatingMarginChange:change('operatingMargin',false)}};
}

export type ReviewInput={positiveEvidence:string[];negativeEvidence:string[];uncertainties:string[];fundamentals:'stable'|'deteriorating'|'unknown';valuation:'reset'|'not-reset'|'unknown';evidenceVerified:boolean};
export function classifyReview(input:ReviewInput){
  const result=(classification:'Potential valuation opportunity'|'Fundamental deterioration'|'Insufficient evidence',reason:string)=>({version:STRESS_VERSION,classification,reasons:[reason],researchOnly:true as const});
  if(!input.evidenceVerified)return result('Insufficient evidence','Eligible source evidence has not been verified');
  if(input.fundamentals==='deteriorating'&&input.negativeEvidence.some(s=>s.trim()))return result('Fundamental deterioration','Verified evidence supports deterioration in the business outlook');
  if(input.fundamentals==='stable'&&input.valuation==='reset'&&input.positiveEvidence.some(s=>s.trim())&&input.uncertainties.length===0&&input.negativeEvidence.length===0)return result('Potential valuation opportunity','Stable fundamentals and a valuation reset warrant further research; this is not a trade instruction');
  return result('Insufficient evidence','A price decline alone, unreviewed fundamentals or unresolved conflicting evidence cannot establish an opportunity');
}

export const outcomeRegistrationSchema=z.object({version:z.literal(STRESS_VERSION),symbol:z.enum(STRESS_SYMBOLS),benchmark:z.literal('QQQ'),horizon:z.union([z.literal(1),z.literal(5),z.literal(20),z.literal(60)]),startAt:z.number().finite().nonnegative(),endAt:z.number().finite().nonnegative(),registeredAt:z.number().finite().nonnegative(),evidenceCutoff:z.number().finite().nonnegative(),mode:z.enum(['retrospective','historical-model-replay','forward']),calendar:calendarSchema,session:z.literal('regular'),priceBasis:z.enum(['unadjusted','split-adjusted','total-return']),adjustmentVersion:z.string().min(1),provider:z.string().min(1),currency:z.string().regex(/^[A-Z]{3}$/),synthetic:z.boolean(),spreadBps:z.number().finite().nonnegative().nullable(),slippageBps:z.number().finite().nonnegative().nullable(),tradingCostBps:z.number().finite().nonnegative().nullable()}).strict();
export type OutcomeRegistration=z.infer<typeof outcomeRegistrationSchema>;
export function registerOutcome(input:Omit<OutcomeRegistration,'endAt'|'version'>):OutcomeRegistration{
  const calendar:ExchangeCalendar=calendarSchema.parse(input.calendar),index=calendar.sessionCloses.indexOf(input.startAt),endAt=calendar.sessionCloses[index+input.horizon];
  if(!calendar.verified||index<0||endAt===undefined)throw new Error('A verified exchange calendar covering the full window is required');
  if(input.evidenceCutoff>input.startAt||input.evidenceCutoff>input.registeredAt||(input.mode==='forward'&&input.registeredAt>input.startAt))throw new Error('Forecast cutoff or registration introduces look-ahead');
  return outcomeRegistrationSchema.parse({...input,version:STRESS_VERSION,endAt});
}
export function evaluateOutcome(registration:OutcomeRegistration,bars:MarketBar[],asOf:number){
  const r=registerOutcome(registration);if(r.endAt!==registration.endAt)throw new Error('Outcome end does not match registered calendar');
  const pending=(reason:string)=>({status:'pending' as const,reason,result:null});
  if(!Number.isFinite(asOf)||asOf<r.endAt)return pending('Defined trading-session window is incomplete');
  const select=(symbol:string,t:number)=>bars.filter(b=>b.symbol===symbol&&b.eventAt===t&&b.receivedAt<=asOf&&b.kind==='daily-bar'&&b.session===r.session&&b.provider===r.provider&&b.currency===r.currency&&b.priceBasis===r.priceBasis&&b.adjustmentVersion===r.adjustmentVersion&&b.synthetic===r.synthetic);
  const selections=[select(r.symbol,r.startAt),select(r.symbol,r.endAt),select('QQQ',r.startAt),select('QQQ',r.endAt)];
  if(selections.some(s=>s.length!==1))return pending('Unique compatible instrument and benchmark observations are unavailable');
  try{return {status:'completed' as const,reason:null,result:alignedReturns(selections[0][0],selections[1][0],selections[2][0],selections[3][0])};}catch(e){return pending(e instanceof Error?e.message:'Incompatible price data');}
}
