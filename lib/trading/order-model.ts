import {z} from 'zod';

/**
 * Phase 002 order model (`trading-002-v1`). Pure and deterministic, so the same rules run in Convex, the Next.js
 * server and tests. Trading 212 is authoritative for executed orders and holdings; Convex is authoritative for
 * proposals, approvals, risk decisions, submission records and the audit trail.
 *
 * Facts taken from the official Trading 212 Public API documentation (read 6 Nov 2026):
 * - Order placement is NOT idempotent and has no client order id; duplicates are possible on retry.
 * - Sell orders use a negative quantity. Orders are placed by QUANTITY only, in the primary account currency.
 * - Order types: MARKET, LIMIT, STOP, STOP_LIMIT; timeValidity DAY or GOOD_TILL_CANCEL.
 * - There is no quote endpoint. Position `currentPrice` is the only broker price, and only for held instruments.
 */
export const TRADING_VERSION='trading-002-v1' as const;
export const ORDER_STATES=['draft','reviewed','approved','confirmed','submitting','acknowledged','partially_filled','filled','cancelled','rejected','unknown','declined','withdrawn','not_placed'] as const;
export type OrderState=typeof ORDER_STATES[number];
export const TERMINAL_STATES:ReadonlySet<OrderState>=new Set(['filled','cancelled','rejected','declined','withdrawn','not_placed']);

/** Allowed transitions. Anything else is refused. `unknown` is never retried; it can only be reconciled. */
export const TRANSITIONS:Record<OrderState,readonly OrderState[]>={
 draft:['reviewed','withdrawn'],
 reviewed:['approved','declined','withdrawn','draft'],
 approved:['confirmed','withdrawn','draft'],
 confirmed:['submitting','approved','withdrawn'],
 submitting:['acknowledged','rejected','unknown'],
 acknowledged:['partially_filled','filled','cancelled','rejected','unknown','acknowledged'],
 partially_filled:['partially_filled','filled','cancelled','unknown'],
 unknown:['acknowledged','partially_filled','filled','cancelled','rejected','not_placed','unknown'],
 filled:[],cancelled:[],rejected:[],declined:[],withdrawn:[],not_placed:[],
};
export function assertTransition(from:OrderState,to:OrderState){if(!TRANSITIONS[from].includes(to))throw new Error(`Order cannot move from ${from} to ${to}`);}

const ticker=z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/,'Use the official Trading 212 ticker');
const price=z.number().finite().positive().max(1e9);
export const orderTypeSchema=z.enum(['MARKET','LIMIT','STOP','STOP_LIMIT']);
export const orderDraftSchema=z.object({
 environment:z.enum(['demo','live']),ticker,side:z.enum(['BUY','SELL']),quantity:z.number().finite().positive().max(1e9),
 type:orderTypeSchema,limitPrice:price.nullable(),stopPrice:price.nullable(),timeValidity:z.enum(['DAY','GOOD_TILL_CANCEL']).nullable(),extendedHours:z.boolean(),
 thesis:z.string().trim().min(20,'State the investment thesis (at least 20 characters)').max(4000),counterevidence:z.string().trim().min(20,'Record the strongest counterevidence (at least 20 characters)').max(4000),
}).strict().superRefine((o,c)=>{
 const need=(k:'limitPrice'|'stopPrice',on:boolean)=>{if(on&&o[k]===null)c.addIssue({code:'custom',message:`${o.type} requires ${k}`});if(!on&&o[k]!==null)c.addIssue({code:'custom',message:`${o.type} must not set ${k}`});};
 need('limitPrice',o.type==='LIMIT'||o.type==='STOP_LIMIT');need('stopPrice',o.type==='STOP'||o.type==='STOP_LIMIT');
 if(o.type==='MARKET'&&o.timeValidity!==null)c.addIssue({code:'custom',message:'Market orders take no time validity'});
 if(o.type!=='MARKET'&&o.timeValidity===null)c.addIssue({code:'custom',message:'Pending orders require DAY or GOOD_TILL_CANCEL'});
 if(o.type!=='MARKET'&&o.extendedHours)c.addIssue({code:'custom',message:'Extended hours applies to market orders only'});
});
export type OrderDraft=z.infer<typeof orderDraftSchema>;

/** Signed quantity as Trading 212 expects it: positive buys, negative sells. */
export function brokerQuantity(o:Pick<OrderDraft,'side'|'quantity'>){return o.side==='SELL'?-o.quantity:o.quantity;}

export const instrumentSchema=z.object({ticker,name:z.string().max(300),shortName:z.string().max(100).nullable(),isin:z.string().max(20).nullable(),currencyCode:z.string().regex(/^[A-Z]{3}$/),type:z.string().max(40),maxOpenQuantity:z.number().finite().nonnegative().nullable(),extendedHours:z.boolean().nullable(),workingScheduleId:z.number().int().nullable()}).strict();
export type Instrument=z.infer<typeof instrumentSchema>;

/** A price reference is indicative only; it is never a guaranteed execution price. */
export const priceReferenceSchema=z.object({ticker,price,priceCurrency:z.string().regex(/^[A-Z]{3}$/),fxRateToAccount:z.number().finite().positive().nullable(),source:z.enum(['broker_position','licensed_quote']),observedAt:z.number().int().nonnegative(),sourceDetail:z.string().max(300)}).strict();
export type PriceReference=z.infer<typeof priceReferenceSchema>;

export const riskLimitsSchema=z.object({
 maxOrderValue:z.number().finite().positive(),maxPositionExposurePct:z.number().finite().positive().max(100),maxDailyLoss:z.number().finite().positive(),
 maxPriceAgeSeconds:z.number().int().positive().max(3600),fxFeeBps:z.number().finite().min(0).max(500),allowedInstrumentTypes:z.array(z.string().min(1).max(40)).min(1).max(20),
 version:z.string().trim().min(1).max(60),
}).strict();
export type RiskLimits=z.infer<typeof riskLimitsSchema>;
export const DEFAULT_RISK_LIMITS:RiskLimits={maxOrderValue:100,maxPositionExposurePct:25,maxDailyLoss:25,maxPriceAgeSeconds:120,fxFeeBps:15,allowedInstrumentTypes:['STOCK','ETF'],version:'owner-default-v1'};

export type AccountState={currency:string;cashAvailable:number|null;totalValue:number|null;positions:{ticker:string;quantity:number|null;quantityAvailableForTrading:number|null;currentValueAccount:number|null}[];realisedLossToday:number|null;syncedAt:number};

/**
 * Deterministic, independent risk evaluation in the account currency. Fails closed: any unknown input blocks.
 * Reviewer authority, confirmations and feature flags are separate checks and cannot waive a failed result.
 */
export function evaluateOrderRisk(order:OrderDraft,instrument:Instrument|null,reference:PriceReference|null,account:AccountState|null,limits:RiskLimits,now:number){
 const reasons:string[]=[];const block=(r:string)=>reasons.push(r);
 riskLimitsSchema.parse(limits);
 if(!instrument)block('Instrument is not in the broker-supported instrument list');
 else{
  if(instrument.ticker!==order.ticker)block('Instrument metadata does not match the order ticker');
  if(!limits.allowedInstrumentTypes.includes(instrument.type))block(`Instrument type ${instrument.type} is not allowed by the risk limits`);
  if(instrument.maxOpenQuantity!==null&&order.quantity>instrument.maxOpenQuantity)block('Quantity exceeds the broker maximum open quantity');
  if(order.extendedHours&&instrument.extendedHours!==true)block('Extended-hours trading is not available for this instrument');
 }
 if(!account)block('No synchronised broker account state');
 else if(now-account.syncedAt>5*60_000)block('Account state is more than 5 minutes old; refresh before trading');
 if(!reference)block('No fresh price reference: the broker provides prices only for held positions and no licensed quote feed is configured');
 else{
  if(reference.ticker!==order.ticker)block('Price reference is for a different instrument');
  if(now-reference.observedAt>limits.maxPriceAgeSeconds*1000)block(`Price reference is older than ${limits.maxPriceAgeSeconds} seconds`);
  if(reference.observedAt>now+5000)block('Price reference is time-stamped in the future');
 }
 const worstPrice=reference?Math.max(reference.price,order.side==='BUY'?(order.limitPrice??order.stopPrice??0):0):null;
 const fx=reference&&account?(reference.priceCurrency===account.currency?1:reference.fxRateToAccount):null;
 if(reference&&account&&fx===null)block(`No conversion rate from ${reference.priceCurrency} to ${account.currency}`);
 const gross=worstPrice!==null&&fx!==null?order.quantity*worstPrice*fx:null;
 const fxCost=gross!==null&&reference&&account&&reference.priceCurrency!==account.currency?gross*limits.fxFeeBps/10000:0;
 const estimatedValue=gross!==null?gross+(order.side==='BUY'?fxCost:-fxCost):null;
 if(estimatedValue!==null&&gross!==null){
  if(gross>limits.maxOrderValue)block(`Estimated order value ${gross.toFixed(2)} exceeds the per-order limit ${limits.maxOrderValue}`);
  if(account){
   const held=account.positions.find(p=>p.ticker===order.ticker);
   if(order.side==='BUY'){
    if(account.cashAvailable===null)block('Available cash is unknown');
    else if(estimatedValue>account.cashAvailable)block('Estimated cost exceeds available cash');
    if(account.totalValue===null||account.totalValue<=0)block('Account total value is unknown');
    else{const after=(held?.currentValueAccount??0)+gross;if(after/account.totalValue*100>limits.maxPositionExposurePct)block(`Resulting position would be ${(after/account.totalValue*100).toFixed(1)}% of the account, above ${limits.maxPositionExposurePct}%`);}
   }else{
    const available=held?.quantityAvailableForTrading??null;
    if(available===null)block('No sellable quantity is held for this instrument');else if(order.quantity>available)block('Sell quantity exceeds the quantity available for trading');
   }
   if(account.realisedLossToday===null)block('Today\'s realised result is unknown, so the daily-loss limit cannot be checked');
   else if(account.realisedLossToday>=limits.maxDailyLoss)block('Daily realised-loss limit already reached');
  }
 }
 return {version:TRADING_VERSION,passed:reasons.length===0,reasons,estimate:{grossValue:gross,fxCost,estimatedValue,accountCurrency:account?.currency??null,priceIsIndicative:true as const,worstCasePrice:worstPrice},limitsVersion:limits.version,evaluatedAt:now,executionAuthority:'none' as const};
}
export type RiskEvaluation=ReturnType<typeof evaluateOrderRisk>;

export function canonical(value:unknown):string{if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value!==null&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>`${JSON.stringify(k)}:${canonical(x)}`).join(',')}}`;return JSON.stringify(value);}
/** Exact order details the owner confirms. Any change after confirmation invalidates it. */
export function confirmationPayload(orderId:string,connectionId:string,o:OrderDraft,reference:PriceReference,riskEvaluatedAt:number){
 return canonical({version:TRADING_VERSION,orderId,connectionId,environment:o.environment,ticker:o.ticker,side:o.side,quantity:o.quantity,brokerQuantity:brokerQuantity(o),type:o.type,limitPrice:o.limitPrice,stopPrice:o.stopPrice,timeValidity:o.timeValidity,extendedHours:o.extendedHours,referencePrice:reference.price,referenceObservedAt:reference.observedAt,riskEvaluatedAt});
}

export const brokerOrderSchema=z.object({id:z.number().int().safe(),ticker:z.string().max(100),type:orderTypeSchema,status:z.string().max(40),quantity:z.number().finite().nullable(),filledQuantity:z.number().finite().nullable(),filledValue:z.number().finite().nullable(),limitPrice:z.number().finite().nullable(),stopPrice:z.number().finite().nullable(),createdAt:z.string().max(40).nullable(),initiatedFrom:z.string().max(40).nullable()}).strict();
export type BrokerOrder=z.infer<typeof brokerOrderSchema>;

/** Maps a broker status onto the internal state machine. Unknown statuses stay `unknown` for manual review. */
export function stateFromBroker(o:BrokerOrder):OrderState{
 switch(o.status){
  case 'FILLED':return 'filled';
  case 'CANCELLED':return 'cancelled';
  case 'REJECTED':return 'rejected';
  case 'PARTIALLY_FILLED':return 'partially_filled';
  case 'NEW':case 'CONFIRMED':case 'UNCONFIRMED':case 'LOCAL':case 'CANCELLING':case 'REPLACING':case 'REPLACED':return (o.filledQuantity??0)>0?'partially_filled':'acknowledged';
  default:return 'unknown';
 }
}

/**
 * Finds broker orders that could be the result of an ambiguous submission. Only API-initiated orders for the same
 * ticker, signed quantity, type and prices, created inside the submission window and not seen before submission, match.
 * Exactly one match resolves the order; zero or several keep it `unknown`. The caller never re-submits.
 */
export function reconcileCandidates(candidates:BrokerOrder[],intent:{ticker:string;brokerQuantity:number;type:OrderDraft['type'];limitPrice:number|null;stopPrice:number|null},window:{submittedAt:number;knownBrokerIdsBefore:number[]},slackMs=120_000){
 const before=new Set(window.knownBrokerIdsBefore);
 return candidates.filter(o=>!before.has(o.id)&&o.ticker===intent.ticker&&o.type===intent.type&&o.quantity===intent.brokerQuantity&&(o.limitPrice??null)===intent.limitPrice&&(o.stopPrice??null)===intent.stopPrice&&(o.initiatedFrom===null||o.initiatedFrom==='API')&&(o.createdAt===null||Math.abs(Date.parse(o.createdAt)-window.submittedAt)<=slackMs));
}
