import {z} from 'zod';

/**
 * Phase 004 — Market Data Activation: Provider Assessment & Unified Server-Side Adapter.
 *
 * Invariants:
 * 1. Covers the 8 required research instruments: NVDA, MSFT, GOOGL, AMZN, INTC, AMD, CRWV and QQQ.
 * 2. Retains exact exchange timestamps (`eventAt`), authoritative server receipt times (`serverReceivedAt`),
 *    source identifiers (`sourceId`, `sourceUrl`, `provider`), adjustment metadata (`priceBasis`,
 *    `adjustmentVersion`, `corporateActionsReviewed`) and feed delay (`declaredDelayMs`).
 * 3. Pairs USD closes with explicit USD→GBP FX observations (`usdToGbp`, `closeGbp`, `fxCloseAligned`).
 * 4. Explicitly prohibits substituting Trading 212 portfolio-position prices for a market feed.
 * 5. Enforces provider request-rate and per-run request budgets.
 */

export const MARKET_DATA_PHASE_VERSION='market-data-004-v1' as const;

export const MARKET_DATA_SYMBOLS=['NVDA','MSFT','GOOGL','AMZN','INTC','AMD','CRWV','QQQ'] as const;
export type MarketDataSymbol=(typeof MARKET_DATA_SYMBOLS)[number];

export type MarketDataUniverseInstrument={
 symbol:MarketDataSymbol;
 name:string;
 assetClass:'stocks'|'etf';
 exchange:'NASDAQ';
 currency:'USD';
 isBenchmark:boolean;
};

export const MARKET_DATA_UNIVERSE:readonly MarketDataUniverseInstrument[]=[
 {symbol:'NVDA',name:'NVIDIA Corporation',assetClass:'stocks',exchange:'NASDAQ',currency:'USD',isBenchmark:false},
 {symbol:'MSFT',name:'Microsoft Corporation',assetClass:'stocks',exchange:'NASDAQ',currency:'USD',isBenchmark:false},
 {symbol:'GOOGL',name:'Alphabet Inc.',assetClass:'stocks',exchange:'NASDAQ',currency:'USD',isBenchmark:false},
 {symbol:'AMZN',name:'Amazon.com, Inc.',assetClass:'stocks',exchange:'NASDAQ',currency:'USD',isBenchmark:false},
 {symbol:'INTC',name:'Intel Corporation',assetClass:'stocks',exchange:'NASDAQ',currency:'USD',isBenchmark:false},
 {symbol:'AMD',name:'Advanced Micro Devices, Inc.',assetClass:'stocks',exchange:'NASDAQ',currency:'USD',isBenchmark:false},
 {symbol:'CRWV',name:'CoreWeave, Inc.',assetClass:'stocks',exchange:'NASDAQ',currency:'USD',isBenchmark:false},
 {symbol:'QQQ',name:'Invesco QQQ Trust',assetClass:'etf',exchange:'NASDAQ',currency:'USD',isBenchmark:true},
] as const;

export type MarketDataProviderId=
 |'nasdaq_public_historical'
 |'tiingo_iex_eod'
 |'polygon_massive_aggs'
 |'alpaca_market_data'
 |'fmp_starter';

export type ProviderAssessmentEntry={
 providerId:MarketDataProviderId;
 name:string;
 ukAvailable:boolean;
 pricingTierGbpOrUsd:string;
 quoteLatency:'eod_reference'|'delayed_15m'|'iex_realtime'|'sip_realtime';
 declaredDelayMs:number;
 historicalCoverage:string;
 corporateActionsAndAdjustedPrices:string;
 apiRequestLimits:string;
 redistributionAndDisplayRights:string;
 commercialVsPersonalPermissions:string;
 gbpUsdCoverage:string;
 universeAndQqqCoverage:string;
 recommendedRank:number;
 requiresPaidSubscription:boolean;
};

/**
 * Stage 1 — Provider Assessment Comparison Table.
 * Evaluates UK customer availability, latency, historical depth, corporate actions,
 * rate limits, display rights, personal vs. commercial permissions, GBP/USD FX and 8-symbol coverage.
 */
export const PROVIDER_ASSESSMENT_MATRIX:readonly ProviderAssessmentEntry[]=[
 {
  providerId:'nasdaq_public_historical',
  name:'Nasdaq Official Historical Quote API + ECB/BoE Reference FX (Active Zero-Cost Tier)',
  ukAvailable:true,
  pricingTierGbpOrUsd:'£0 / month (public reference endpoint; no paid subscription required)',
  quoteLatency:'eod_reference',
  declaredDelayMs:900_000,
  historicalCoverage:'10+ years daily OHLCV regular-session bars; no intraday bars',
  corporateActionsAndAdjustedPrices:'Unadjusted daily Close/Last (`priceBasis: unadjusted_close`, `corporateActionsReviewed: false`); splits/dividends not retroactively adjusted in feed',
  apiRequestLimits:'Public fair-use rate limit (enforced at ≤10 requests/minute, ≤12 requests/cycle for 8 symbols + FX)',
  redistributionAndDisplayRights:'Personal research reference display only; commercial redistribution and executable-quote display prohibited',
  commercialVsPersonalPermissions:'Personal / internal non-commercial research permitted; not licensed for live brokerage execution',
  gbpUsdCoverage:'Paired with ECB (`api.frankfurter.app`) & Bank of England (`XUDLUSS`) daily USD/GBP reference fixings (16:00 CET/London; not 21:00 UTC close-aligned)',
  universeAndQqqCoverage:'100% coverage of NVDA, MSFT, GOOGL, AMZN, INTC, AMD, CRWV (`assetclass=stocks`) and QQQ (`assetclass=etf`)',
  recommendedRank:1,
  requiresPaidSubscription:false,
 },
 {
  providerId:'tiingo_iex_eod',
  name:'Tiingo EOD + IEX Real-Time & FX API (Recommended Low-Cost Upgrade)',
  ukAvailable:true,
  pricingTierGbpOrUsd:'$0 / month Starter (personal) or $10 / month (~£7.80/mo) Power tier',
  quoteLatency:'iex_realtime',
  declaredDelayMs:0,
  historicalCoverage:'30+ years daily EOD OHLCV + split/dividend factors; 5+ years intraday IEX 1m/5m/15m bars',
  corporateActionsAndAdjustedPrices:'Full split and cash-dividend adjusted series (`adjOpen, adjHigh, adjLow, adjClose, divCash, splitFactor`; `corporateActionsReviewed: true`)',
  apiRequestLimits:'Starter: 50 req/hour, 1,000 req/day, 500 unique symbols/month; Power ($10/mo): 5,000 req/hour, 50,000 req/day',
  redistributionAndDisplayRights:'Single-user personal dashboard display permitted under internal research terms; public redistribution requires commercial license',
  commercialVsPersonalPermissions:'Explicit personal & internal research terms on Starter ($0) and Power ($10/mo)',
  gbpUsdCoverage:'Native `gbpusd` spot & historical daily/intraday FX feed via `/tiingo/fx/gbpusd/prices`',
  universeAndQqqCoverage:'100% coverage of NVDA, MSFT, GOOGL, AMZN, INTC, AMD, CRWV and QQQ',
  recommendedRank:2,
  requiresPaidSubscription:false,
 },
 {
  providerId:'polygon_massive_aggs',
  name:'Polygon.io (Massive) Stocks Basic / Starter',
  ukAvailable:true,
  pricingTierGbpOrUsd:'$0 / month Basic (5 req/min EOD) or $29 / month (~£22.60/mo) Stocks Starter',
  quoteLatency:'delayed_15m',
  declaredDelayMs:900_000,
  historicalCoverage:'2 years (Basic) to 5 years (Starter) daily and 1-minute intraday aggregates',
  corporateActionsAndAdjustedPrices:'Split-adjusted aggregates (`adjusted=true`) plus `/v3/reference/splits` and `/v3/reference/dividends` (`corporateActionsReviewed: true`)',
  apiRequestLimits:'Basic: 5 requests/minute; Stocks Starter ($29/mo): unlimited API calls (fair-use)',
  redistributionAndDisplayRights:'Personal non-professional display only; redistribution prohibited without enterprise agreement',
  commercialVsPersonalPermissions:'Non-professional personal use on Basic/Starter; commercial use requires Business tier ($199+/mo)',
  gbpUsdCoverage:'Requires Currencies tier (`C:GBPUSD`, Basic EOD or $49/mo Currencies Starter) or ECB/BoE FX pairing',
  universeAndQqqCoverage:'100% coverage of NVDA, MSFT, GOOGL, AMZN, INTC, AMD, CRWV and QQQ',
  recommendedRank:3,
  requiresPaidSubscription:true,
 },
 {
  providerId:'alpaca_market_data',
  name:'Alpaca Market Data API (Basic IEX / Algo Trader Plus)',
  ukAvailable:true,
  pricingTierGbpOrUsd:'$0 / month Basic (IEX) or $99 / month (~£77/mo) Algo Trader Plus (SIP)',
  quoteLatency:'iex_realtime',
  declaredDelayMs:0,
  historicalCoverage:'5+ years historical daily and 1-minute intraday bars since 2016',
  corporateActionsAndAdjustedPrices:'Supports `adjustment=raw|split|dividend|all` plus corporate actions announcements endpoint',
  apiRequestLimits:'Basic: 200 requests/minute; Algo Trader Plus: 10,000 requests/minute',
  redistributionAndDisplayRights:'Internal personal dashboard display permitted; redistribution prohibited',
  commercialVsPersonalPermissions:'Personal & proprietary research permitted; SIP tier required for full US consolidated tape',
  gbpUsdCoverage:'No native GBP/USD spot FX feed in US equities API (requires external ECB/BoE FX feed)',
  universeAndQqqCoverage:'100% coverage of NVDA, MSFT, GOOGL, AMZN, INTC, AMD, CRWV and QQQ (IEX venue subset on Basic)',
  recommendedRank:4,
  requiresPaidSubscription:false,
 },
 {
  providerId:'fmp_starter',
  name:'Financial Modeling Prep (FMP) Basic / Starter',
  ukAvailable:true,
  pricingTierGbpOrUsd:'$0 / month Basic (250 req/day) or $29 / month (~£22.60/mo) Starter',
  quoteLatency:'delayed_15m',
  declaredDelayMs:900_000,
  historicalCoverage:'5 years daily EOD on Starter; intraday 1m/5m/15m on Starter+',
  corporateActionsAndAdjustedPrices:'Provides `adjClose` and historical stock-split / dividend endpoints',
  apiRequestLimits:'Basic: 250 requests/day total; Starter: 300 requests/minute',
  redistributionAndDisplayRights:'Personal internal use only; no public redistribution',
  commercialVsPersonalPermissions:'Personal research use only on Starter',
  gbpUsdCoverage:'Includes `GBPUSD` forex pair quotes and historical daily rates',
  universeAndQqqCoverage:'100% coverage of NVDA, MSFT, GOOGL, AMZN, INTC, AMD, CRWV and QQQ',
  recommendedRank:5,
  requiresPaidSubscription:true,
 },
] as const;

const cleanHttpsUrl=z.string().url().startsWith('https://').refine(v=>{
 try{
  const u=new URL(v);
  return !u.username&&!u.password&&![...u.searchParams.keys()].some(k=>
   /^(?:token|key|api[_-]?key|secret|access[_-]?token|password|authorization|auth|client[_-]?secret|x[_-]?api[_-]?key|bearer|signature)$/i.test(k)
  );
 }catch{
  return false;
 }
},'Source URLs cannot contain credentials or secret query parameters');

export const authorisedMarketObservationSchema=z.object({
 observationId:z.string().min(1).max(200),
 symbol:z.enum(MARKET_DATA_SYMBOLS),
 sessionDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 eventAt:z.number().int().positive(),
 publishedAt:z.number().int().positive().nullable(),
 serverReceivedAt:z.number().int().positive(),
 provider:z.enum(['nasdaq_public_historical','tiingo_iex_eod','polygon_massive_aggs']),
 sourceId:z.string().min(1).max(200),
 sourceUrl:cleanHttpsUrl,
 currency:z.literal('USD'),
 open:z.number().finite().positive(),
 high:z.number().finite().positive(),
 low:z.number().finite().positive(),
 close:z.number().finite().positive(),
 volume:z.number().finite().nonnegative(),
 usdToGbp:z.number().finite().positive(),
 closeGbp:z.number().finite().positive(),
 fxSessionDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 fxEventAt:z.number().int().positive(),
 fxSourceUrl:cleanHttpsUrl,
 fxProvider:z.string().min(1).max(160),
 fxCloseAligned:z.boolean(),
 priceBasis:z.enum(['unadjusted_close','split-adjusted','total-return']),
 adjustmentVersion:z.string().min(1).max(120),
 corporateActionsReviewed:z.boolean(),
 declaredDelayMs:z.number().int().nonnegative(),
 usage:z.enum(['public_reference','licensed']),
 licensed:z.boolean(),
 permittedUse:z.string().min(1).max(400),
 isTrading212PositionPrice:z.literal(false),
}).strict().superRefine((obs,ctx)=>{
 if(obs.eventAt>obs.serverReceivedAt){
  ctx.addIssue({code:'custom',message:`Observation eventAt (${obs.eventAt}) cannot be after serverReceivedAt (${obs.serverReceivedAt})`});
 }
 if(obs.low>obs.high||obs.open<obs.low||obs.open>obs.high||obs.close<obs.low||obs.close>obs.high){
  ctx.addIssue({code:'custom',message:`OHLC bar bounds invalid for ${obs.symbol} on ${obs.sessionDate}`});
 }
 if(/trading212/i.test(obs.provider)||/trading212/i.test(obs.sourceUrl)||/trading212/i.test(obs.sourceId)){
  ctx.addIssue({code:'custom',message:'Trading 212 portfolio-position prices cannot be substituted for a complete market feed'});
 }
});

export type AuthorisedMarketObservation=z.infer<typeof authorisedMarketObservationSchema>;

/**
 * Computes exact US regular-session close timestamp (16:00 America/New_York = 21:00 UTC in EST, 20:00 UTC in EDT,
 * or 18:00 UTC on scheduled NYSE/Nasdaq early-close dates).
 */
export function usRegularSessionCloseAt(sessionDate:string):number{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate))throw new Error(`Invalid session date: ${sessionDate}`);
 if(sessionDate==='2026-11-27'||sessionDate==='2026-12-24'){
  return Date.parse(`${sessionDate}T18:00:00Z`);
 }
 // US Daylight Saving Time 2026: 2026-03-08 to 2026-11-01 (EDT = UTC-4 -> 20:00 UTC; EST = UTC-5 -> 21:00 UTC)
 // US Daylight Saving Time 2027: starts 2027-03-14
 const isEdt=(sessionDate>='2026-03-08'&&sessionDate<'2026-11-01')||sessionDate>='2027-03-14';
 const hourUtc=isEdt?20:21;
 return Date.parse(`${sessionDate}T${String(hourUtc).padStart(2,'0')}:00:00Z`);
}

export function parseDollarNumber(raw:string|number):number{
 if(typeof raw==='number'){
  if(!Number.isFinite(raw))throw new Error('Non-finite numeric value');
  return raw;
 }
 const cleaned=raw.replace(/[$,\s]/g,'');
 const val=Number(cleaned);
 if(!Number.isFinite(val))throw new Error(`Invalid numeric value: ${raw}`);
 return val;
}

/**
 * Guard that explicitly rejects any attempt to pass a Trading 212 position snapshot price into the market feed.
 */
export function assertNotTrading212PositionPrice(input:{provider?:string;sourceUrl?:string;isTrading212PositionPrice?:boolean}){
 if(
  input.isTrading212PositionPrice===true||
  (input.provider&&/trading\s*212/i.test(input.provider))||
  (input.sourceUrl&&/trading212\.com/i.test(input.sourceUrl))
 ){
  throw new Error('Trading 212 portfolio-position prices cannot be substituted for a complete market-data feed');
 }
}

/**
 * Enforces provider request budgets and per-run rate limits (Stage 2 & Stage 5).
 */
export class ProviderRequestBudget{
 private count=0;
 constructor(
  readonly maxRequestsPerRun:number=15,
  readonly maxRequestsPerMinute:number=15,
 ){
  if(maxRequestsPerRun<1||maxRequestsPerMinute<1){
   throw new Error('Provider request budget limits must be positive integers');
  }
 }

 consume(cost=1):number{
  if(this.count+cost>this.maxRequestsPerRun){
   throw new Error(`Provider request budget exceeded (${this.count+cost} > ${this.maxRequestsPerRun} max requests per run)`);
  }
  this.count+=cost;
  return this.count;
 }

 get used():number{
  return this.count;
 }

 get remaining():number{
  return Math.max(0,this.maxRequestsPerRun-this.count);
 }
}

export type ActiveMarketProviderConfig={
 providerId:'nasdaq_public_historical'|'tiingo_iex_eod'|'polygon_massive_aggs';
 label:string;
 licensed:boolean;
 usage:'public_reference'|'licensed';
 priceBasis:'unadjusted_close'|'split-adjusted'|'total-return';
 adjustmentVersion:string;
 corporateActionsReviewed:boolean;
 declaredDelayMs:number;
 permittedUse:string;
 apiKeyConfigured:boolean;
};

/**
 * Resolves the active server-side market-data provider configuration from environment variables.
 * Never exposes secret values.
 */
export function resolveMarketProviderConfig(env:Record<string,string|undefined>=process.env):ActiveMarketProviderConfig{
 const tiingoKey=env.TIINGO_API_KEY?.trim();
 const massiveKey=(env.MASSIVE_API_KEY||env.LICENSED_MARKET_DATA_API_KEY)?.trim();

 if(tiingoKey&&tiingoKey.length>=16){
  return {
   providerId:'tiingo_iex_eod',
   label:'Tiingo EOD & IEX Market Feed (Split & Dividend Adjusted)',
   licensed:true,
   usage:'licensed',
   priceBasis:'total-return',
   adjustmentVersion:'tiingo-split-div-adj-v1',
   corporateActionsReviewed:true,
   declaredDelayMs:0,
   permittedUse:'Authorised personal & internal research under Tiingo API license terms; server-side credentials only',
   apiKeyConfigured:true,
  };
 }

 if(massiveKey&&massiveKey.length>=16){
  return {
   providerId:'polygon_massive_aggs',
   label:'Polygon / Massive Stocks Aggregates Feed (Split-Adjusted)',
   licensed:true,
   usage:'licensed',
   priceBasis:'split-adjusted',
   adjustmentVersion:'polygon-split-adj-v1',
   corporateActionsReviewed:true,
   declaredDelayMs:900_000,
   permittedUse:'Authorised personal research under Polygon/Massive API terms; server-side credentials only',
   apiKeyConfigured:true,
  };
 }

 return {
  providerId:'nasdaq_public_historical',
  label:'Nasdaq Official Historical Close Feed + ECB USD/GBP Reference',
  licensed:false,
  usage:'public_reference',
  priceBasis:'unadjusted_close',
  adjustmentVersion:'nasdaq-unadjusted-eod-v1',
  corporateActionsReviewed:false,
  declaredDelayMs:900_000,
  permittedUse:'Public reference display and non-commercial research; delayed EOD close, not a licensed live execution quote feed',
  apiKeyConfigured:false,
 };
}

type NasdaqHistoricalResponse={
 data?:{
  symbol?:string;
  totalRecords?:number;
  tradesTable?:{
   rows?:Array<{
    date?:string;
    close?:string;
    volume?:string;
    open?:string;
    high?:string;
    low?:string;
   }>;
  };
 };
};

type TiingoPriceRow={
 date?:string;
 close?:number;
 high?:number;
 low?:number;
 open?:number;
 volume?:number;
 adjClose?:number;
 adjHigh?:number;
 adjLow?:number;
 adjOpen?:number;
 divCash?:number;
 splitFactor?:number;
};

type FrankfurterResponse={
 amount?:number;
 base?:string;
 start_date?:string;
 end_date?:string;
 date?:string;
 rates?:Record<string,{GBP?:number}|number>;
};

export type MarketCollectionResult={
 providerConfig:ActiveMarketProviderConfig;
 observations:AuthorisedMarketObservation[];
 latestSessionDate:string|null;
 latestEventAt:number|null;
 fxRatesByDate:Record<string,number>;
 latestUsdToGbp:number;
 latestFxDate:string;
 providerRequestsCount:number;
 budgetRemaining:number;
 processingDurationMs:number;
 cursorAfter:string;
 conditionalSkip:boolean;
 errors:Array<{symbol:string;error:string}>;
};

function isoDateFromUtcMs(ms:number):string{
 return new Date(ms).toISOString().slice(0,10);
}

function normalizeNasdaqDate(mmddyyyy:string):string{
 const parts=mmddyyyy.trim().split('/');
 if(parts.length===3){
  const [m,d,y]=parts;
  return `${y}-${m!.padStart(2,'0')}-${d!.padStart(2,'0')}`;
 }
 if(/^\d{4}-\d{2}-\d{2}$/.test(mmddyyyy.trim()))return mmddyyyy.trim();
 throw new Error(`Unrecognised Nasdaq date format: ${mmddyyyy}`);
}

/**
 * Fetches USD→GBP reference FX rates from ECB (`api.frankfurter.app`) over the requested date range.
 */
export async function fetchUsdToGbpRates(params:{
 fromDate:string;
 toDate:string;
 userAgent:string;
 budget:ProviderRequestBudget;
 fetchImpl?:typeof fetch;
}):Promise<{ratesByDate:Record<string,number>;latestRate:number;latestDate:string;sourceUrl:string}>{
 const fetchFn=params.fetchImpl??fetch;
 params.budget.consume(1);
 const rangeUrl=`https://api.frankfurter.app/${params.fromDate}..${params.toDate}?from=USD&to=GBP`;
 const resp=await fetchFn(rangeUrl,{
  headers:{'User-Agent':params.userAgent,'Accept':'application/json'},
 });
 if(!resp.ok){
  throw new Error(`ECB USD/GBP FX HTTP ${resp.status}`);
 }
 const body=(await resp.json()) as FrankfurterResponse;
 const ratesByDate:Record<string,number>={};
 const rawRates=body.rates??{};
 for(const [dateKey,val] of Object.entries(rawRates)){
  const gbp=typeof val==='object'&&val!==null?(val as {GBP?:number}).GBP:undefined;
  if(typeof gbp==='number'&&Number.isFinite(gbp)&&gbp>0){
   ratesByDate[dateKey]=Number(gbp.toFixed(6));
  }
 }
 const dates=Object.keys(ratesByDate).sort();
 if(dates.length===0){
  throw new Error('ECB USD/GBP FX response contained no valid GBP rates');
 }
 const latestDate=dates[dates.length-1]!;
 const latestRate=ratesByDate[latestDate]!;
 return {
  ratesByDate,
  latestRate,
  latestDate,
  sourceUrl:rangeUrl,
 };
}

/**
 * Resolves the most recent USD→GBP rate on or before `sessionDate` so weekend/holiday gaps never invent future FX rates.
 */
export function matchFxRateForSession(
 sessionDate:string,
 ratesByDate:Record<string,number>,
 fallbackRate:number,
 fallbackDate:string,
):{rate:number;fxDate:string}{
 if(ratesByDate[sessionDate]!==undefined){
  return {rate:ratesByDate[sessionDate]!,fxDate:sessionDate};
 }
 const priorDates=Object.keys(ratesByDate).filter(d=>d<=sessionDate).sort();
 if(priorDates.length>0){
  const d=priorDates[priorDates.length-1]!;
  return {rate:ratesByDate[d]!,fxDate:d};
 }
 return {rate:fallbackRate,fxDate:fallbackDate};
}

/**
 * Collects authorised market observations for `NVDA, MSFT, GOOGL, AMZN, INTC, AMD, CRWV, QQQ`
 * and pairs each session close with USD→GBP conversion metadata.
 */
export async function collectUniverseMarketObservations(params:{
 now?:number;
 lookbackDays?:number;
 maxBarsPerSymbol?:number;
 cursorBefore?:string|null;
 symbols?:readonly MarketDataSymbol[];
 env?:Record<string,string|undefined>;
 fetchImpl?:typeof fetch;
 maxRequestsPerRun?:number;
}):Promise<MarketCollectionResult>{
 const startedAt=Date.now();
 const serverNow=params.now??startedAt;
 const env=params.env??process.env;
 const fetchFn=params.fetchImpl??fetch;
 const symbols=params.symbols??MARKET_DATA_SYMBOLS;
 const maxBars=params.maxBarsPerSymbol??5;
 const lookbackDays=params.lookbackDays??14;
 const providerConfig=resolveMarketProviderConfig(env);
 const budget=new ProviderRequestBudget(params.maxRequestsPerRun??15,15);
 const userAgent=env.SEC_USER_AGENT||'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AICapitalIntelligence/0.4';

 const toDate=isoDateFromUtcMs(serverNow);
 const fromDate=isoDateFromUtcMs(serverNow-lookbackDays*86_400_000);

 const fx=await fetchUsdToGbpRates({
  fromDate,
  toDate,
  userAgent,
  budget,
  fetchImpl:fetchFn,
 });

 const observations:AuthorisedMarketObservation[]=[];
 const errors:Array<{symbol:string;error:string}>=[];

 for(const symbol of symbols){
  const instrument=MARKET_DATA_UNIVERSE.find(u=>u.symbol===symbol);
  if(!instrument)continue;
  try{
   if(providerConfig.providerId==='tiingo_iex_eod'){
    budget.consume(1);
    const publicSourceUrl=`https://api.tiingo.com/tiingo/daily/${symbol}/prices?startDate=${fromDate}&endDate=${toDate}`;
    const resp=await fetchFn(publicSourceUrl,{
     headers:{
      'Authorization':`Token ${env.TIINGO_API_KEY!.trim()}`,
      'Content-Type':'application/json',
      'Accept':'application/json',
      'User-Agent':userAgent,
     },
    });
    if(!resp.ok)throw new Error(`Tiingo HTTP ${resp.status} for ${symbol}`);
    const rows=(await resp.json()) as TiingoPriceRow[];
    const sorted=[...rows].reverse().slice(0,maxBars);
    for(const row of sorted){
     const sessionDate=String(row.date??'').slice(0,10);
     if(!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate))continue;
     const eventAt=usRegularSessionCloseAt(sessionDate);
     if(eventAt>serverNow)continue;
     const closeVal=Number((row.adjClose??row.close)??0);
     const openVal=Number((row.adjOpen??row.open)??closeVal);
     const highVal=Number((row.adjHigh??row.high)??Math.max(openVal,closeVal));
     const lowVal=Number((row.adjLow??row.low)??Math.min(openVal,closeVal));
     const volVal=Number(row.volume??0);
     const matchedFx=matchFxRateForSession(sessionDate,fx.ratesByDate,fx.latestRate,fx.latestDate);
     const fxEventAt=Date.parse(`${matchedFx.fxDate}T15:00:00Z`);
     const obs=authorisedMarketObservationSchema.parse({
      observationId:`tiingo-${symbol.toLowerCase()}-${sessionDate}`,
      symbol,
      sessionDate,
      eventAt,
      publishedAt:eventAt,
      serverReceivedAt:serverNow,
      provider:'tiingo_iex_eod',
      sourceId:`tiingo-eod-${symbol.toLowerCase()}-${sessionDate}`,
      sourceUrl:publicSourceUrl,
      currency:'USD',
      open:openVal,
      high:Math.max(highVal,openVal,closeVal),
      low:Math.min(lowVal,openVal,closeVal),
      close:closeVal,
      volume:volVal,
      usdToGbp:matchedFx.rate,
      closeGbp:Number((closeVal*matchedFx.rate).toFixed(4)),
      fxSessionDate:matchedFx.fxDate,
      fxEventAt:Math.min(fxEventAt,serverNow),
      fxSourceUrl:fx.sourceUrl,
      fxProvider:'ECB reference rate via Frankfurter (USD→GBP)',
      fxCloseAligned:false,
      priceBasis:providerConfig.priceBasis,
      adjustmentVersion:providerConfig.adjustmentVersion,
      corporateActionsReviewed:true,
      declaredDelayMs:0,
      usage:'licensed',
      licensed:true,
      permittedUse:providerConfig.permittedUse,
      isTrading212PositionPrice:false,
     });
     observations.push(obs);
    }
   }else{
    // Nasdaq Official Historical Quote API (`api.nasdaq.com`)
    budget.consume(1);
    const assetClass=instrument.assetClass;
    const sourceUrl=`https://api.nasdaq.com/api/quote/${symbol}/historical?assetclass=${assetClass}&fromdate=${fromDate}&todate=${toDate}&limit=30`;
    const resp=await fetchFn(sourceUrl,{
     headers:{
      'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept':'application/json, text/plain, */*',
      'Accept-Language':'en-US,en;q=0.9',
     },
    });
    if(!resp.ok)throw new Error(`Nasdaq historical HTTP ${resp.status} for ${symbol}`);
    const body=(await resp.json()) as NasdaqHistoricalResponse;
    const rows=body.data?.tradesTable?.rows??[];
    if(rows.length===0){
     throw new Error(`Nasdaq historical API returned 0 rows for ${symbol}`);
    }
    for(const row of rows.slice(0,maxBars)){
     if(!row.date||!row.close)continue;
     const sessionDate=normalizeNasdaqDate(row.date);
     const eventAt=usRegularSessionCloseAt(sessionDate);
     if(eventAt>serverNow)continue;
     const closeVal=parseDollarNumber(row.close);
     const openVal=row.open?parseDollarNumber(row.open):closeVal;
     const highVal=row.high?parseDollarNumber(row.high):Math.max(openVal,closeVal);
     const lowVal=row.low?parseDollarNumber(row.low):Math.min(openVal,closeVal);
     const volVal=row.volume&&row.volume!=='N/A'?parseDollarNumber(row.volume):0;
     const matchedFx=matchFxRateForSession(sessionDate,fx.ratesByDate,fx.latestRate,fx.latestDate);
     const fxEventAt=Date.parse(`${matchedFx.fxDate}T15:00:00Z`);
     const obs=authorisedMarketObservationSchema.parse({
      observationId:`nasdaq-${symbol.toLowerCase()}-${sessionDate}`,
      symbol,
      sessionDate,
      eventAt,
      publishedAt:null,
      serverReceivedAt:serverNow,
      provider:'nasdaq_public_historical',
      sourceId:`nasdaq-historical-${symbol.toLowerCase()}-${sessionDate}`,
      sourceUrl,
      currency:'USD',
      open:openVal,
      high:Math.max(highVal,openVal,closeVal),
      low:Math.min(lowVal,openVal,closeVal),
      close:closeVal,
      volume:volVal,
      usdToGbp:matchedFx.rate,
      closeGbp:Number((closeVal*matchedFx.rate).toFixed(4)),
      fxSessionDate:matchedFx.fxDate,
      fxEventAt:Math.min(fxEventAt,serverNow),
      fxSourceUrl:fx.sourceUrl,
      fxProvider:'ECB reference rate via Frankfurter (USD→GBP)',
      fxCloseAligned:false,
      priceBasis:'unadjusted_close',
      adjustmentVersion:'nasdaq-unadjusted-eod-v1',
      corporateActionsReviewed:false,
      declaredDelayMs:900_000,
      usage:'public_reference',
      licensed:false,
      permittedUse:providerConfig.permittedUse,
      isTrading212PositionPrice:false,
     });
     observations.push(obs);
    }
   }
  }catch(err){
   errors.push({
    symbol,
    error:err instanceof Error?err.message:'market_provider_error',
   });
  }
 }

 observations.sort((a,b)=>b.eventAt-a.eventAt||a.symbol.localeCompare(b.symbol));
 const latestEventAt=observations.length>0?Math.max(...observations.map(o=>o.eventAt)):null;
 const latestSessionDate=latestEventAt!==null?isoDateFromUtcMs(latestEventAt):null;

 // Build deterministic cursor across the latest session close per symbol
 const latestBySymbol=new Map<string,string>();
 for(const obs of observations){
  if(!latestBySymbol.has(obs.symbol)){
   latestBySymbol.set(obs.symbol,`${obs.symbol}:${obs.sessionDate}:${obs.close.toFixed(2)}`);
  }
 }
 const cursorParts=[...latestBySymbol.values()].sort();
 const cursorAfter=`mkt:v4:${providerConfig.providerId}:${fx.latestDate}:${cursorParts.join('|')}`;
 const conditionalSkip=params.cursorBefore!== undefined&&params.cursorBefore!==null&&params.cursorBefore===cursorAfter;

 return {
  providerConfig,
  observations,
  latestSessionDate,
  latestEventAt,
  fxRatesByDate:fx.ratesByDate,
  latestUsdToGbp:fx.latestRate,
  latestFxDate:fx.latestDate,
  providerRequestsCount:budget.used,
  budgetRemaining:budget.remaining,
  processingDurationMs:Math.max(1,Date.now()-startedAt),
  cursorAfter,
  conditionalSkip,
  errors,
 };
}
