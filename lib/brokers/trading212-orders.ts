import 'server-only';
import {z} from 'zod';
import {BROKER_BASE_URLS,BrokerError,brokerCredentialsSchema,brokerEnvironmentSchema,type BrokerCredentials,type BrokerEnvironment} from './contracts';
import {assertExecutionPermitted} from '../trading/execution-boundary';
import {brokerOrderSchema,brokerQuantity,instrumentSchema,type BrokerOrder,type Instrument,type OrderDraft} from '../trading/order-model';

/**
 * Trading 212 order client (Phase 002). Separate from the read-only adapter and used only with a separately saved,
 * explicitly opted-in trading key. Paths and limits follow the official Public API documentation (6 Nov 2026).
 *
 * Submission rules: exactly one POST per call, no automatic retries, no redirects. Timeouts, transport failures,
 * 408 and 5xx responses, and unreadable success bodies are reported as `ambiguous`, never as "not placed",
 * because the endpoint is documented as non-idempotent.
 */
const READ_PATHS={instruments:'/equity/metadata/instruments',pending:'/equity/orders',history:'/equity/history/orders',dividends:'/equity/history/dividends'} as const;
const SPACING_MS={instruments:50_000,pending:5_000,order:1_000,history:3_000,dividends:3_000,cancel:1_200,submit:2_000} as const;
const ORDER_PATH={MARKET:'/equity/orders/market',LIMIT:'/equity/orders/limit',STOP:'/equity/orders/stop',STOP_LIMIT:'/equity/orders/stop_limit'} as const;
type Transport=(url:string,init:RequestInit)=>Promise<Response>;
export type OrderClientOptions={fetch?:Transport;timeoutMs?:number;now?:()=>number;executionEnabled:boolean};
export type SubmitResult=
 {kind:'acknowledged';order:BrokerOrder;submittedAt:number;respondedAt:number}|
 {kind:'rejected';httpStatus:number;code:'validation'|'credentials'|'permission'|'rate_limited';submittedAt:number;respondedAt:number}|
 {kind:'ambiguous';reason:'timeout'|'transport'|'server_error'|'unreadable_response';httpStatus:number|null;submittedAt:number;respondedAt:number};

const num=z.number().finite().nullable().optional().transform(v=>v??null);
const rawOrder=z.object({id:z.number().int().safe(),ticker:z.string().max(100).optional(),instrument:z.object({ticker:z.string().max(100)}).partial().optional(),type:z.string(),status:z.string().max(40),quantity:num,filledQuantity:num,filledValue:num,limitPrice:num,stopPrice:num,createdAt:z.string().max(40).nullable().optional(),initiatedFrom:z.string().max(40).nullable().optional()}).passthrough();
export function parseBrokerOrder(value:unknown):BrokerOrder{
 const o=rawOrder.parse(value);
 return brokerOrderSchema.parse({id:o.id,ticker:o.ticker??o.instrument?.ticker??'',type:o.type,status:o.status,quantity:o.quantity,filledQuantity:o.filledQuantity,filledValue:o.filledValue,limitPrice:o.limitPrice,stopPrice:o.stopPrice,createdAt:o.createdAt??null,initiatedFrom:o.initiatedFrom??null});
}
const rawInstrument=z.object({ticker:z.string(),name:z.string().optional(),shortName:z.string().nullable().optional(),isin:z.string().nullable().optional(),currencyCode:z.string(),type:z.string(),maxOpenQuantity:num,extendedHours:z.boolean().nullable().optional(),workingScheduleId:z.number().int().nullable().optional()}).passthrough();
export function parseInstrument(value:unknown):Instrument{const i=rawInstrument.parse(value);return instrumentSchema.parse({ticker:i.ticker,name:i.name??i.ticker,shortName:i.shortName??null,isin:i.isin??null,currencyCode:i.currencyCode,type:i.type,maxOpenQuantity:i.maxOpenQuantity,extendedHours:i.extendedHours??null,workingScheduleId:i.workingScheduleId??null});}
const historyItem=z.object({order:z.unknown(),fill:z.object({id:z.number().int().safe().optional(),filledAt:z.string().max(40).optional(),price:num,quantity:num,walletImpact:z.object({realisedProfitLoss:num,currency:z.string().optional(),fxRate:num,netValue:num}).partial().nullable().optional()}).passthrough().nullable().optional()}).passthrough();
export type HistoryFill={order:BrokerOrder;fillId:number|null;filledAt:string|null;price:number|null;quantity:number|null;realisedProfitLoss:number|null;netValue:number|null};
function nextPath(value:unknown,expected:string){if(value===null||value===undefined)return null;if(typeof value!=='string'||!value.startsWith(`/api/v0${expected}?`)||value.length>600||/[\r\n\0]/.test(value))throw new BrokerError('invalid_response');return value;}

export class Trading212OrderClient{
 readonly environment:BrokerEnvironment;
 #credentials:BrokerCredentials;#fetch:Transport;#timeout:number;#now:()=>number;#enabled:boolean;#next=new Map<string,number>();
 constructor(environment:BrokerEnvironment,credentials:BrokerCredentials,options:OrderClientOptions){
  try{this.environment=brokerEnvironmentSchema.parse(environment);this.#credentials=brokerCredentialsSchema.parse(credentials);this.#fetch=options.fetch??fetch;this.#timeout=options.timeoutMs??10_000;this.#now=options.now??Date.now;this.#enabled=options.executionEnabled===true;if(!(this.#timeout>=1&&this.#timeout<=30_000))throw new Error();}catch{throw new BrokerError('invalid_configuration');}
 }
 #auth(){return 'Basic '+Buffer.from(`${this.#credentials.apiKey}:${this.#credentials.apiSecret}`,'utf8').toString('base64');}
 #pace(op:keyof typeof SPACING_MS){const now=this.#now(),next=this.#next.get(op)??0;if(next>now)throw new BrokerError('rate_limited',next-now);this.#next.set(op,now+SPACING_MS[op]);}
 async #request(method:'GET'|'POST'|'DELETE',path:string,body?:unknown){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.#timeout);
  try{return await this.#fetch(BROKER_BASE_URLS[this.environment]+path,{method,redirect:'error',cache:'no-store',signal:controller.signal,headers:{Authorization:this.#auth(),Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});}
  finally{clearTimeout(timer);}
 }
 async #getJson(op:keyof typeof SPACING_MS,path:string){
  this.#pace(op);let response:Response;
  try{response=await this.#request('GET',path);}catch(e){throw new BrokerError((e as Error)?.name==='AbortError'?'timeout':'provider_unavailable');}
  if(response.status===401)throw new BrokerError('invalid_credentials');if(response.status===403)throw new BrokerError('missing_permissions');
  if(response.status===429){const reset=Number(response.headers.get('x-ratelimit-reset'));throw new BrokerError('rate_limited',Number.isFinite(reset)?Math.max(0,reset*1000-this.#now()):null);}
  if(!response.ok)throw new BrokerError('provider_unavailable');
  try{return await response.json() as unknown;}catch{throw new BrokerError('invalid_response');}
 }
 async instruments(){const raw=await this.#getJson('instruments',READ_PATHS.instruments);if(!Array.isArray(raw))throw new BrokerError('invalid_response');return raw.slice(0,50_000).flatMap(r=>{try{return [parseInstrument(r)];}catch{return [];}});}
 async pendingOrders(){const raw=await this.#getJson('pending',READ_PATHS.pending);if(!Array.isArray(raw))throw new BrokerError('invalid_response');return raw.map(parseBrokerOrder);}
 async order(id:number){if(!Number.isSafeInteger(id)||id<=0)throw new BrokerError('invalid_configuration');return parseBrokerOrder(await this.#getJson('order',`/equity/orders/${id}`));}
 async historyOrders(cursorPath?:string|null,ticker?:string){
  const path=cursorPath?nextPath(cursorPath,READ_PATHS.history)!.slice('/api/v0'.length):`${READ_PATHS.history}?limit=50${ticker?`&ticker=${encodeURIComponent(ticker)}`:''}`;
  const raw=z.object({items:z.array(historyItem).max(50),nextPagePath:z.string().nullable().optional()}).passthrough().parse(await this.#getJson('history',path));
  return {items:raw.items.map(i=>({order:parseBrokerOrder(i.order),fillId:i.fill?.id??null,filledAt:i.fill?.filledAt??null,price:i.fill?.price??null,quantity:i.fill?.quantity??null,realisedProfitLoss:i.fill?.walletImpact?.realisedProfitLoss??null,netValue:i.fill?.walletImpact?.netValue??null})) as HistoryFill[],nextPagePath:nextPath(raw.nextPagePath,READ_PATHS.history)};
 }
 async dividends(cursorPath?:string|null){
  const path=cursorPath?nextPath(cursorPath,READ_PATHS.dividends)!.slice('/api/v0'.length):`${READ_PATHS.dividends}?limit=50`;
  const raw=z.object({items:z.array(z.object({reference:z.string().max(200),ticker:z.string().max(100),amount:z.number().finite(),currency:z.string().optional(),paidOn:z.string().max(40),quantity:num}).passthrough()).max(50),nextPagePath:z.string().nullable().optional()}).passthrough().parse(await this.#getJson('dividends',path));
  return {items:raw.items.map(d=>({reference:d.reference,ticker:d.ticker,amount:d.amount,currency:d.currency??null,paidOn:d.paidOn,quantity:d.quantity})),nextPagePath:nextPath(raw.nextPagePath,READ_PATHS.dividends)};
 }
 /** Exactly one attempt. The caller must already hold an atomic `submitting` claim for this order. */
 async submit(order:OrderDraft):Promise<SubmitResult>{
  assertExecutionPermitted('broker order submission');
  if(!this.#enabled)throw new BrokerError('invalid_configuration');
  if(order.environment!==this.environment)throw new BrokerError('invalid_configuration');
  this.#pace('submit');
  const body:Record<string,unknown>={ticker:order.ticker,quantity:brokerQuantity(order)};
  if(order.type==='MARKET')body.extendedHours=order.extendedHours;else body.timeValidity=order.timeValidity;
  if(order.limitPrice!==null)body.limitPrice=order.limitPrice;if(order.stopPrice!==null)body.stopPrice=order.stopPrice;
  const submittedAt=this.#now();let response:Response;
  try{response=await this.#request('POST',ORDER_PATH[order.type],body);}
  catch(e){return {kind:'ambiguous',reason:(e as Error)?.name==='AbortError'?'timeout':'transport',httpStatus:null,submittedAt,respondedAt:this.#now()};}
  const respondedAt=this.#now();
  if(response.status===408||response.status>=500)return {kind:'ambiguous',reason:response.status===408?'timeout':'server_error',httpStatus:response.status,submittedAt,respondedAt};
  if(response.status===400)return {kind:'rejected',httpStatus:400,code:'validation',submittedAt,respondedAt};
  if(response.status===401)return {kind:'rejected',httpStatus:401,code:'credentials',submittedAt,respondedAt};
  if(response.status===403)return {kind:'rejected',httpStatus:403,code:'permission',submittedAt,respondedAt};
  if(response.status===429)return {kind:'rejected',httpStatus:429,code:'rate_limited',submittedAt,respondedAt};
  if(!response.ok)return {kind:'ambiguous',reason:'server_error',httpStatus:response.status,submittedAt,respondedAt};
  try{return {kind:'acknowledged',order:parseBrokerOrder(await response.json()),submittedAt,respondedAt};}catch{return {kind:'ambiguous',reason:'unreadable_response',httpStatus:response.status,submittedAt,respondedAt};}
 }
 /** Cancellation is not guaranteed if the order is already filling (documented); status must be re-read afterwards. */
 async cancel(id:number){
  assertExecutionPermitted('broker order cancellation');
  if(!this.#enabled)throw new BrokerError('invalid_configuration');if(!Number.isSafeInteger(id)||id<=0)throw new BrokerError('invalid_configuration');
  this.#pace('cancel');let response:Response;
  try{response=await this.#request('DELETE',`/equity/orders/${id}`);}catch(e){throw new BrokerError((e as Error)?.name==='AbortError'?'timeout':'provider_unavailable');}
  if(response.status===401)throw new BrokerError('invalid_credentials');if(response.status===403)throw new BrokerError('missing_permissions');if(response.status===429)throw new BrokerError('rate_limited');
  if(!response.ok)throw new BrokerError('provider_unavailable');return {requestedAt:this.#now()};
 }
}
