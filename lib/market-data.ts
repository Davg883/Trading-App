import { z } from 'zod';

export const STRESS_VERSION = 'stress-001.1-v1' as const;
export const STRESS_SYMBOLS = ['GOOGL','AMZN','MSFT','NVDA','INTC','CRWV'] as const;
const timestamp=z.number().finite().nonnegative();
export const sourceUrlSchema=z.string().url().startsWith('https://').refine(value=>{try{const url=new URL(value);return !url.username&&!url.password;}catch{return false;}},'Source URLs must not contain credentials');
export const marketBarSchema=z.object({
  id:z.string().min(1),symbol:z.enum([...STRESS_SYMBOLS,'QQQ']),provider:z.string().min(1),sourceUrl:sourceUrlSchema,
  eventAt:timestamp,receivedAt:timestamp,currency:z.string().regex(/^[A-Z]{3}$/),session:z.enum(['regular','after-hours','pre-market']),
  priceBasis:z.enum(['unadjusted','split-adjusted','total-return']),adjustmentVersion:z.string().min(1),synthetic:z.boolean(),declaredDelayMs:timestamp,
  kind:z.enum(['daily-bar','quote']),close:z.number().finite().positive(),high:z.number().finite().positive(),corporateActionsReviewed:z.boolean(),
}).strict().refine(b=>b.receivedAt>=b.eventAt&&b.high>=b.close,'Receipt must follow event; high must cover close');
export const calendarSchema=z.object({id:z.string().min(1),sourceUrl:sourceUrlSchema,verified:z.boolean(),sessionCloses:z.array(timestamp).min(2).max(10000)}).strict().refine(c=>c.sessionCloses.every((n,i)=>!i||n>c.sessionCloses[i-1]),'Session closes must be strictly increasing');
export const marketDatasetSchema=z.object({version:z.literal(STRESS_VERSION),provider:z.string().min(1),license:z.string().min(1),synthetic:z.boolean(),coverageStart:timestamp,coverageEnd:timestamp,calendar:calendarSchema,bars:z.array(marketBarSchema).max(10000)}).strict().superRefine((d,ctx)=>{
  if(d.coverageStart>d.coverageEnd)ctx.addIssue({code:'custom',message:'Invalid coverage range'});
  const keys=new Set<string>(),ids=new Set<string>();
  for(const b of d.bars){
    const key=`${b.symbol}|${b.kind}|${b.session}|${b.eventAt}`;
    if(b.provider!==d.provider||b.synthetic!==d.synthetic||b.eventAt<d.coverageStart||b.eventAt>d.coverageEnd||keys.has(key)||ids.has(b.id))ctx.addIssue({code:'custom',message:'Mixed provenance, duplicate or out-of-coverage observation'});
    keys.add(key);ids.add(b.id);
  }
});
export type MarketBar=z.infer<typeof marketBarSchema>;
export type MarketDataset=z.infer<typeof marketDatasetSchema>;
export type ExchangeCalendar=z.infer<typeof calendarSchema>;
export function importMarketData(input:unknown):MarketDataset{return marketDatasetSchema.parse(input);}
export const fxObservationSchema=z.object({id:z.string().min(1),provider:z.string().min(1),sourceUrl:sourceUrlSchema,from:z.string().regex(/^[A-Z]{3}$/),to:z.string().regex(/^[A-Z]{3}$/),rate:z.number().finite().positive(),eventAt:timestamp,receivedAt:timestamp,synthetic:z.boolean(),conversionVersion:z.string().min(1)}).strict().refine(f=>f.receivedAt>=f.eventAt&&f.from!==f.to,'Invalid FX observation');
export type FxObservation=z.infer<typeof fxObservationSchema>;
/** Explicit close-time conversion; retain both sources. This is not an intraday converted high or a replacement market bar. */
export function convertCloseCurrency(bar:MarketBar,fx:FxObservation,asOf:number){
  marketBarSchema.parse(bar);fxObservationSchema.parse(fx);
  if(!Number.isFinite(asOf)||bar.currency!==fx.from||bar.eventAt!==fx.eventAt||bar.synthetic!==fx.synthetic||bar.receivedAt>asOf||fx.receivedAt>asOf)throw new Error('Currency conversion requires aligned, eligible FX provenance');
  return {value:bar.close*fx.rate,currency:fx.to,sourceIds:[bar.id,fx.id],eventAt:bar.eventAt,receivedAt:Math.max(bar.receivedAt,fx.receivedAt),conversionVersion:fx.conversionVersion,synthetic:bar.synthetic,priceSource:bar,fxSource:fx};
}
export type MarketValue={value:number|null;reason:string|null;startAt:number|null;endAt:number|null};
const unavailable=(reason:string):MarketValue=>({value:null,reason,startAt:null,endAt:null});
export function alignedReturns(start:MarketBar,end:MarketBar,benchmarkStart:MarketBar,benchmarkEnd:MarketBar){
  const all=[start,end,benchmarkStart,benchmarkEnd];all.forEach(b=>marketBarSchema.parse(b));
  const same=(key:keyof MarketBar)=>all.every(b=>b[key]===start[key]);
  if(start.symbol!==end.symbol||benchmarkStart.symbol!=='QQQ'||benchmarkEnd.symbol!=='QQQ'||start.symbol==='QQQ'||start.eventAt!==benchmarkStart.eventAt||end.eventAt!==benchmarkEnd.eventAt||start.eventAt>=end.eventAt)throw new Error('Instrument and QQQ windows must align exactly');
  if(!['currency','session','priceBasis','adjustmentVersion','synthetic','provider','kind'].every(k=>same(k as keyof MarketBar))||all.some(b=>!b.corporateActionsReviewed))throw new Error('Currency, corporate-action basis and provenance must be consistent; explicit FX conversion is required before mixing currencies');
  const absoluteReturn=end.close/start.close-1,benchmarkReturn=benchmarkEnd.close/benchmarkStart.close-1;
  return {absoluteReturn,benchmarkReturn,relativeReturn:absoluteReturn-benchmarkReturn,startAt:start.eventAt,endAt:end.eventAt};
}
export function marketSummary(dataset:MarketDataset,symbol:string,asOf:number){
  marketDatasetSchema.parse(dataset);
  if(!Number.isFinite(asOf))throw new Error('Finite as-of required');
  const bars=dataset.bars.filter(b=>b.eventAt<=asOf&&b.receivedAt<=asOf);
  const latest=bars.filter(b=>b.symbol===symbol).sort((a,b)=>b.eventAt-a.eventAt||b.receivedAt-a.receivedAt||Number(b.kind==='quote')-Number(a.kind==='quote')||a.id.localeCompare(b.id))[0]??null;
  const closes=dataset.calendar.sessionCloses.filter(t=>t<=asOf&&t>=dataset.coverageStart&&t<=dataset.coverageEnd);
  const end=closes.at(-1);
  function window(days:number|null):{absolute:MarketValue;relative:MarketValue;drawdown:MarketValue}{
    try{
      if(!dataset.calendar.verified||end===undefined)throw new Error('Verified exchange calendar required');
      const start=days===null?closes.at(-2):[...dataset.calendar.sessionCloses].reverse().find(t=>t<=end-days*86400000);
      if(start===undefined||start<dataset.coverageStart)throw new Error('Insufficient complete lookback coverage');
      const required=dataset.calendar.sessionCloses.filter(t=>t>=start&&t<=end);
      const select=(ticker:string)=>required.map(t=>{const matches=bars.filter(b=>b.symbol===ticker&&b.eventAt===t&&b.kind==='daily-bar'&&b.session==='regular');if(matches.length!==1)throw new Error('Missing aligned daily bars');return matches[0];});
      const company=select(symbol),qqq=select('QQQ');
      for(let i=1;i<company.length;i++)alignedReturns(company[0],company[i],qqq[0],qqq[i]);
      const returns=alignedReturns(company[0],company.at(-1)!,qqq[0],qqq.at(-1)!);
      const value=(n:number):MarketValue=>({value:n,reason:null,startAt:start,endAt:end});
      const highs=days===null?company:company.filter(b=>b.eventAt>=end-days*86400000);
      return {absolute:value(returns.absoluteReturn),relative:value(returns.relativeReturn),drawdown:value(company.at(-1)!.close/Math.max(...highs.map(b=>b.high))-1)};
    }catch(e){const v=unavailable(e instanceof Error?e.message:'Invalid data');return {absolute:v,relative:v,drawdown:v};}
  }
  return {version:STRESS_VERSION,latest,oneSession:window(null),days30:window(30),days90:window(90),weeks52:window(364),status:latest?'Imported observations; not a live connection':'No eligible sourced observations'};
}
