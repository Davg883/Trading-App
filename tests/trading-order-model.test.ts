import {describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {ORDER_STATES,TRANSITIONS,assertTransition,orderDraftSchema,evaluateOrderRisk,confirmationPayload,stateFromBroker,reconcileCandidates,brokerQuantity,DEFAULT_RISK_LIMITS,type OrderDraft,type Instrument,type PriceReference,type AccountState,type BrokerOrder} from '../lib/trading/order-model';
import {Trading212OrderClient,parseBrokerOrder} from '../lib/brokers/trading212-orders';
import {encryptCredentials,decryptCredentials} from '../lib/brokers/vault';

const now=Date.parse('2026-11-06T15:00:00Z');
const draft=(o:Partial<OrderDraft>={}):OrderDraft=>orderDraftSchema.parse({environment:'demo',ticker:'AAPL_US_EQ',side:'BUY',quantity:0.1,type:'MARKET',limitPrice:null,stopPrice:null,timeValidity:null,extendedHours:false,thesis:'Services margin expansion supports earnings growth.',counterevidence:'Hardware demand is cyclical and valuation is elevated.',...o});
const instrument:Instrument={ticker:'AAPL_US_EQ',name:'Apple',shortName:'AAPL',isin:'US0378331005',currencyCode:'USD',type:'STOCK',maxOpenQuantity:1000,extendedHours:true,workingScheduleId:1};
const ref=(o:Partial<PriceReference>={}):PriceReference=>({ticker:'AAPL_US_EQ',price:200,priceCurrency:'USD',fxRateToAccount:0.75,source:'broker_position',observedAt:now-30_000,sourceDetail:'test',...o});
const account=(o:Partial<AccountState>={}):AccountState=>({currency:'GBP',cashAvailable:250,totalValue:500,positions:[{ticker:'AAPL_US_EQ',quantity:0.2,quantityAvailableForTrading:0.2,currentValueAccount:30}],realisedLossToday:0,syncedAt:now-60_000,...o});
const order=(o:Partial<BrokerOrder>={}):BrokerOrder=>({id:101,ticker:'AAPL_US_EQ',type:'MARKET',status:'NEW',quantity:0.1,filledQuantity:0,filledValue:null,limitPrice:null,stopPrice:null,createdAt:new Date(now+1000).toISOString(),initiatedFrom:'API',...o});

describe('Order state machine',()=>{
 it('allows only the documented path and never retries an unknown submission',()=>{
  expect(ORDER_STATES).toEqual(expect.arrayContaining(['draft','reviewed','approved','confirmed','submitting','acknowledged','partially_filled','filled','cancelled','rejected','unknown']));
  for(const [from,to] of [['draft','reviewed'],['reviewed','approved'],['approved','confirmed'],['confirmed','submitting'],['submitting','acknowledged'],['submitting','unknown'],['acknowledged','partially_filled'],['partially_filled','filled'],['unknown','filled'],['unknown','not_placed']] as const)expect(()=>assertTransition(from,to)).not.toThrow();
  for(const [from,to] of [['draft','approved'],['reviewed','submitting'],['approved','submitting'],['unknown','submitting'],['unknown','confirmed'],['submitting','submitting'],['filled','cancelled'],['rejected','submitting'],['acknowledged','submitting']] as const)expect(()=>assertTransition(from,to)).toThrow();
  expect(Object.values(TRANSITIONS).some(t=>t.includes('submitting'))).toBe(true);expect(Object.entries(TRANSITIONS).filter(([,t])=>t.includes('submitting')).map(([f])=>f)).toEqual(['confirmed']);
 });
 it('validates order types, prices and the required thesis and counterevidence',()=>{
  expect(()=>draft({type:'LIMIT'})).toThrow(/limitPrice/);expect(()=>draft({type:'LIMIT',limitPrice:190,timeValidity:null})).toThrow(/DAY or GOOD_TILL_CANCEL/);
  expect(()=>draft({type:'STOP_LIMIT',limitPrice:190,stopPrice:null,timeValidity:'DAY'})).toThrow(/stopPrice/);expect(()=>draft({thesis:'short'})).toThrow(/thesis/);
  expect(()=>draft({type:'LIMIT',limitPrice:190,timeValidity:'DAY',extendedHours:true})).toThrow(/Extended hours/);
  expect(brokerQuantity(draft({side:'SELL',quantity:0.5}))).toBe(-0.5);
 });
});

describe('Independent deterministic risk',()=>{
 it('passes a small, fresh, funded order and reports an indicative estimate',()=>{
  const r=evaluateOrderRisk(draft(),instrument,ref(),account(),DEFAULT_RISK_LIMITS,now);
  expect(r.passed).toBe(true);expect(r.estimate.grossValue).toBeCloseTo(15,6);expect(r.estimate.fxCost).toBeCloseTo(15*0.0015,6);expect(r.estimate.priceIsIndicative).toBe(true);
 });
 it('fails closed on missing, stale or foreign price references and unknown FX',()=>{
  expect(evaluateOrderRisk(draft(),instrument,null,account(),DEFAULT_RISK_LIMITS,now).reasons.join()).toMatch(/No fresh price reference/);
  expect(evaluateOrderRisk(draft(),instrument,ref({observedAt:now-121_000}),account(),DEFAULT_RISK_LIMITS,now).reasons.join()).toMatch(/older than 120 seconds/);
  expect(evaluateOrderRisk(draft(),instrument,ref({ticker:'MSFT_US_EQ'}),account(),DEFAULT_RISK_LIMITS,now).passed).toBe(false);
  expect(evaluateOrderRisk(draft(),instrument,ref({fxRateToAccount:null}),account(),DEFAULT_RISK_LIMITS,now).reasons.join()).toMatch(/No conversion rate/);
  expect(evaluateOrderRisk(draft(),instrument,ref(),account({syncedAt:now-6*60_000}),DEFAULT_RISK_LIMITS,now).reasons.join()).toMatch(/more than 5 minutes old/);
 });
 it('enforces order-value, cash, exposure, sellable-quantity and daily-loss limits independently',()=>{
  expect(evaluateOrderRisk(draft({quantity:1}),instrument,ref(),account(),DEFAULT_RISK_LIMITS,now).reasons.join()).toMatch(/per-order limit/);
  expect(evaluateOrderRisk(draft(),instrument,ref(),account({cashAvailable:5}),DEFAULT_RISK_LIMITS,now).reasons.join()).toMatch(/available cash/);
  expect(evaluateOrderRisk(draft({quantity:0.7}),instrument,ref(),account(),{...DEFAULT_RISK_LIMITS,maxOrderValue:1000},now).reasons.join()).toMatch(/of the account/);
  expect(evaluateOrderRisk(draft({side:'SELL',quantity:1}),instrument,ref(),account(),DEFAULT_RISK_LIMITS,now).reasons.join()).toMatch(/exceeds the quantity available/);
  expect(evaluateOrderRisk(draft(),instrument,ref(),account({realisedLossToday:null}),DEFAULT_RISK_LIMITS,now).reasons.join()).toMatch(/daily-loss limit cannot be checked/);
  expect(evaluateOrderRisk(draft(),instrument,ref(),account({realisedLossToday:30}),DEFAULT_RISK_LIMITS,now).reasons.join()).toMatch(/Daily realised-loss limit/);
  expect(evaluateOrderRisk(draft(),null,ref(),account(),DEFAULT_RISK_LIMITS,now).reasons.join()).toMatch(/broker-supported instrument list/);
  expect(evaluateOrderRisk(draft(),{...instrument,type:'CRYPTOCURRENCY'},ref(),account(),DEFAULT_RISK_LIMITS,now).reasons.join()).toMatch(/not allowed/);
 });
 it('binds the confirmation to exact order details',()=>{
  const a=confirmationPayload('o1','k',draft(),ref(),now),b=confirmationPayload('o1','k',draft({quantity:0.11}),ref(),now),c=confirmationPayload('o1','k',draft(),ref({price:201}),now);
  expect(a).not.toBe(b);expect(a).not.toBe(c);expect(confirmationPayload('o1','k',draft(),ref(),now)).toBe(a);
 });
});

describe('Broker status mapping and reconciliation',()=>{
 it('maps broker statuses without inventing fills',()=>{
  expect(stateFromBroker(order({status:'FILLED'}))).toBe('filled');expect(stateFromBroker(order({status:'NEW',filledQuantity:0.05}))).toBe('partially_filled');
  expect(stateFromBroker(order({status:'CANCELLED'}))).toBe('cancelled');expect(stateFromBroker(order({status:'SOMETHING_NEW'}))).toBe('unknown');
 });
 it('resolves an ambiguous submission only to a single new, API-initiated, identical order',()=>{
  const intent={ticker:'AAPL_US_EQ',brokerQuantity:0.1,type:'MARKET' as const,limitPrice:null,stopPrice:null},w={submittedAt:now,knownBrokerIdsBefore:[100]};
  expect(reconcileCandidates([order()],intent,w).map(o=>o.id)).toEqual([101]);
  expect(reconcileCandidates([order({id:100})],intent,w)).toEqual([]);
  expect(reconcileCandidates([order({quantity:-0.1})],intent,w)).toEqual([]);
  expect(reconcileCandidates([order({initiatedFrom:'WEB'})],intent,w)).toEqual([]);
  expect(reconcileCandidates([order({createdAt:new Date(now-10*60_000).toISOString()})],intent,w)).toEqual([]);
  expect(reconcileCandidates([order(),order({id:102})],intent,w)).toHaveLength(2);
 });
});

describe('Trading 212 order client (mocked transport)',()=>{
 const creds={apiKey:'test-key-ABCD',apiSecret:'test-secret'};
 const make=(responses:(()=>Promise<Response>)[],enabled=true)=>{const calls:{url:string;init:RequestInit}[]=[];let i=0;let t=now;const c=new Trading212OrderClient('demo',creds,{executionEnabled:enabled,now:()=>(t+=10_000),fetch:async(url,init)=>{calls.push({url,init});return responses[Math.min(i++,responses.length-1)]();}});return {c,calls};};
 const ok=(b:unknown)=>async()=>new Response(JSON.stringify(b),{status:200});
 it('refuses to submit or cancel unless execution is explicitly enabled',async()=>{const {c,calls}=make([ok(order())],false);await expect(c.submit(draft())).rejects.toThrow();await expect(c.cancel(5)).rejects.toThrow();expect(calls).toHaveLength(0);});
 it('sends exactly one POST with a signed quantity and the documented path',async()=>{
  const {c,calls}=make([ok({...order({quantity:-0.1}),id:7,type:'LIMIT',limitPrice:190})]);const r=await c.submit(draft({side:'SELL',type:'LIMIT',limitPrice:190,timeValidity:'DAY'}));
  expect(r.kind).toBe('acknowledged');expect(calls).toHaveLength(1);expect(calls[0].url).toBe('https://demo.trading212.com/api/v0/equity/orders/limit');expect(calls[0].init.method).toBe('POST');expect(calls[0].init.redirect).toBe('error');
  expect(JSON.parse(calls[0].init.body as string)).toEqual({ticker:'AAPL_US_EQ',quantity:-0.1,timeValidity:'DAY',limitPrice:190});
 });
 it('reports timeouts, transport failures, 5xx and unreadable success as ambiguous without retrying',async()=>{
  for(const failure of [async()=>{throw Object.assign(new Error('aborted'),{name:'AbortError'});},async()=>{throw new Error('socket hang up');},async()=>new Response('x',{status:503}),async()=>new Response('x',{status:408}),async()=>new Response('not json',{status:200})]){
   const {c,calls}=make([failure,ok(order())]);const r=await c.submit(draft());expect(r.kind).toBe('ambiguous');expect(calls).toHaveLength(1);
  }
 });
 it('treats documented 4xx refusals as definitively not placed',async()=>{for(const [status,code] of [[400,'validation'],[401,'credentials'],[403,'permission'],[429,'rate_limited']] as const){const {c}=make([async()=>new Response('{}',{status})]);expect(await c.submit(draft())).toMatchObject({kind:'rejected',code});}});
 it('parses broker orders from the documented shape',()=>{expect(parseBrokerOrder({id:1,instrument:{ticker:'X'},type:'MARKET',status:'FILLED',quantity:1,filledQuantity:1,filledValue:10,initiatedFrom:'API',extra:true})).toMatchObject({id:1,ticker:'X',status:'FILLED'});});
});

describe('Separate read-only and trading keys in the vault',()=>{
 const env={BROKER_VAULT_KEY_B64:Buffer.alloc(32,7).toString('base64'),BROKER_VAULT_KEY_VERSION:'v1'};
 it('cannot decrypt a read-only ciphertext as a trading key or vice versa',()=>{
  const c={apiKey:'test-key-ABCD',apiSecret:'test-secret'},read=encryptCredentials(c,'owner','demo',env),trade=encryptCredentials(c,'owner','demo',env,'orders');
  expect(decryptCredentials(read,'owner','demo',env)).toEqual(c);expect(decryptCredentials(trade,'owner','demo',env,'orders')).toEqual(c);
  expect(()=>decryptCredentials(read,'owner','demo',env,'orders')).toThrow();expect(()=>decryptCredentials(trade,'owner','demo',env)).toThrow();
 });
});
