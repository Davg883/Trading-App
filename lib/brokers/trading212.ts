import 'server-only';
import {z} from 'zod';
import {BROKER_BASE_URLS,BrokerError,brokerEnvironmentSchema,brokerCredentialsSchema,accountSummarySchema,positionsSchema,transactionsSchema,type AccountSummary,type BrokerAdapter,type BrokerCredentials,type BrokerEnvironment,type BrokerObservation,type BrokerPosition,type BrokerTransactions} from './contracts';

const PATHS={summary:'/equity/account/summary',positions:'/equity/positions',transactions:'/equity/history/transactions'} as const;
type ReadOperation=keyof typeof PATHS;
const requestSpacing={summary:5000,positions:1000,transactions:3000};
/** Fixed GET resources only. No generic URL, method or order operation is accepted. */
export function trading212ReadUrl(environment:BrokerEnvironment,operation:ReadOperation,cursor?:string){
  if(!brokerEnvironmentSchema.safeParse(environment).success||!Object.hasOwn(PATHS,operation)||cursor!==undefined&&(operation!=='transactions'||!cursor||cursor.length>256||/[\r\n\0]/.test(cursor)))throw new BrokerError('invalid_configuration');
  const url=new URL(BROKER_BASE_URLS[environment]+PATHS[operation]);if(operation==='transactions'){url.searchParams.set('limit','50');if(cursor)url.searchParams.set('cursor',cursor);}return url.toString();
}
function nextCursor(value:unknown){if(value===null||value===undefined)return null;if(typeof value!=='string'||!value.startsWith('/api/v0/equity/history/transactions?'))throw new BrokerError('invalid_response');const url=new URL(value,'https://demo.trading212.com');if(url.origin!=='https://demo.trading212.com'||url.pathname!=='/api/v0/equity/history/transactions'||url.hash||[...url.searchParams.keys()].some(k=>!['cursor','limit'].includes(k))||url.searchParams.getAll('cursor').length!==1||url.searchParams.getAll('limit').length>1)throw new BrokerError('invalid_response');const cursor=url.searchParams.get('cursor');if(!cursor||cursor.length>256||/[\r\n\0]/.test(cursor))throw new BrokerError('invalid_response');return cursor;}
const optionalAmount=z.number().finite().nullable().optional().transform(n=>n??null);
const currency=z.string().regex(/^[A-Z]{3}$/);
const summaryResponse=z.object({id:z.union([z.number().int().safe(),z.string().max(100)]).optional(),currency,totalValue:optionalAmount,cash:z.object({availableToTrade:optionalAmount,reservedForOrders:optionalAmount,inPies:optionalAmount}),investments:z.object({currentValue:optionalAmount,totalCost:optionalAmount,realizedProfitLoss:optionalAmount,unrealizedProfitLoss:optionalAmount}).optional()});
const positionResponse=z.object({instrument:z.object({ticker:z.string().min(1).max(100),name:z.string().max(300).optional(),currency,isin:z.string().max(100).nullable().optional()}),quantity:optionalAmount,currentPrice:optionalAmount,averagePricePaid:optionalAmount,quantityAvailableForTrading:optionalAmount,quantityInPies:optionalAmount,walletImpact:z.object({currency:currency.optional(),currentValue:optionalAmount,totalCost:optionalAmount,unrealizedProfitLoss:optionalAmount,fxImpact:optionalAmount}).optional()});
export type RateLimitObservation={resource:string;limit:number|null;remaining:number|null;resetAt:number|null;periodSeconds:number|null;used:number|null;observedAt:number};
type Transport=(url:string,init:RequestInit)=>Promise<Response>;
type AdapterOptions={fetch?:Transport;timeoutMs?:number;now?:()=>number};
export class Trading212Adapter implements BrokerAdapter{
  #environment:BrokerEnvironment;
  get environment(){return this.#environment;}
  #credentials:BrokerCredentials|null;
  #fetch:Transport;
  #timeout:number;
  #now:()=>number;
  #next=new Map<ReadOperation,number>();
  #blockedUntil=0;
  constructor(environment:BrokerEnvironment,credentials:BrokerCredentials,options:AdapterOptions={}){try{this.#environment=brokerEnvironmentSchema.parse(environment);this.#credentials=brokerCredentialsSchema.parse(credentials);this.#fetch=options.fetch??fetch;this.#timeout=options.timeoutMs??10000;this.#now=options.now??Date.now;if(!Number.isFinite(this.#timeout)||this.#timeout<1||this.#timeout>30000)throw new Error();Object.freeze(this);}catch{throw new BrokerError('invalid_configuration');}}
  async #read(operation:ReadOperation,cursor?:string){
    if(!this.#credentials)throw new BrokerError('disconnected');const url=trading212ReadUrl(this.environment,operation,cursor),now=this.#now(),next=Math.max(this.#blockedUntil,this.#next.get(operation)??0);if(next>now)throw new BrokerError('rate_limited',next-now);this.#next.set(operation,now+requestSpacing[operation]);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.#timeout);
    try{
      const authorization=`Basic ${Buffer.from(`${this.#credentials.apiKey}:${this.#credentials.apiSecret}`,'utf8').toString('base64')}`;
      const response=await this.#fetch(url,{method:'GET',headers:{Authorization:authorization,Accept:'application/json'},redirect:'error',cache:'no-store',signal:controller.signal});
      if(response.redirected||response.status>=300&&response.status<400)throw new BrokerError('redirect_blocked');
      const reset=Number(response.headers.get('x-ratelimit-reset'))*1000;this.#recordLimit(operation,response.headers,now);
      if(response.headers.get('x-ratelimit-remaining')==='0'&&Number.isFinite(reset)&&reset>now)this.#next.set(operation,reset);
      if(response.status===401)throw new BrokerError('invalid_credentials');
      if(response.status===403)throw new BrokerError('missing_permissions');
      if(response.status===429){const header=response.headers.get('retry-after'),seconds=header===null?NaN:Number(header),at=header===null?NaN:Date.parse(header);const wait=Math.max(1000,Number.isFinite(seconds)?seconds*1000:Number.isFinite(at)?at-now:Number.isFinite(reset)&&reset>now?reset-now:requestSpacing[operation]);this.#blockedUntil=now+Math.min(wait,86400000);throw new BrokerError('rate_limited',this.#blockedUntil-now);}
      if(response.status===408||response.status===504)throw new BrokerError('timeout');if(!response.ok)throw new BrokerError('provider_unavailable');
      if(Number(response.headers.get('content-length'))>2_000_000)throw new BrokerError('invalid_response');
      const reader=response.body?.getReader();if(!reader)throw new BrokerError('invalid_response');const chunks:Uint8Array[]=[];let bytes=0;while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2_000_000){await reader.cancel();throw new BrokerError('invalid_response');}chunks.push(value);}const text=Buffer.concat(chunks).toString('utf8');
      try{return JSON.parse(text) as unknown;}catch{throw new BrokerError('invalid_response');}
    }catch(error){if(error instanceof BrokerError)throw error;if(controller.signal.aborted)throw new BrokerError('timeout');throw new BrokerError('provider_unavailable');}finally{clearTimeout(timer);}
  }
  #observation<T>(operation:ReadOperation,data:T):BrokerObservation<T>{return {provider:'trading212',environment:this.environment,sourceUrl:BROKER_BASE_URLS[this.environment]+PATHS[operation],retrievedAt:this.#now(),data};}
  #limits=new Map<ReadOperation,RateLimitObservation>();
  /** Documented Trading 212 headers: x-ratelimit-limit, -remaining, -reset (Unix seconds), -period (seconds), -used. */
  #recordLimit(operation:ReadOperation,h:Headers,now:number){const n=(k:string)=>{const v=h.get(k);if(v===null||v.trim()==='')return null;const x=Number(v);return Number.isFinite(x)?x:null;};const limit=n('x-ratelimit-limit'),remaining=n('x-ratelimit-remaining'),reset=n('x-ratelimit-reset'),period=n('x-ratelimit-period'),used=n('x-ratelimit-used');if([limit,remaining,reset,period,used].every(x=>x===null))return;this.#limits.set(operation,{resource:PATHS[operation],limit,remaining,resetAt:reset===null?null:reset*1000,periodSeconds:period,used,observedAt:now});}
  /** Rate-limit observations from this adapter's requests; contains no credentials. */
  rateLimits():RateLimitObservation[]{return [...this.#limits.values()];}
  async testConnection(){return this.getAccountSummary();}
  async getAccountSummary():Promise<BrokerObservation<AccountSummary>>{const raw=await this.#read('summary');try{const {id,...r}=summaryResponse.parse(raw);return this.#observation('summary',accountSummarySchema.parse({...r,accountId:id===undefined?null:String(id),investments:r.investments??{currentValue:null,totalCost:null,realizedProfitLoss:null,unrealizedProfitLoss:null}}));}catch{throw new BrokerError('invalid_response');}}
  async getPositions():Promise<BrokerObservation<BrokerPosition[]>>{const raw=await this.#read('positions');try{const rows=z.array(positionResponse).max(5000).parse(raw);return this.#observation('positions',positionsSchema.parse(rows.map(r=>({...r,instrument:{...r.instrument,name:r.instrument.name??r.instrument.ticker,isin:r.instrument.isin??null},walletImpact:{currency:r.walletImpact?.currency??null,currentValue:r.walletImpact?.currentValue??null,totalCost:r.walletImpact?.totalCost??null,unrealizedProfitLoss:r.walletImpact?.unrealizedProfitLoss??null,fxImpact:r.walletImpact?.fxImpact??null}}))));}catch{throw new BrokerError('invalid_response');}}
  async getTransactions(cursor?:string):Promise<BrokerObservation<BrokerTransactions>>{const raw=await this.#read('transactions',cursor);try{const r=z.object({items:z.array(z.object({reference:z.union([z.string().max(200),z.number().int().safe()]),type:z.string().min(1).max(100),dateTime:z.string().datetime({offset:true}),amount:z.number().finite(),currency})).max(50),nextPagePath:z.unknown().optional()}).parse(raw);const next=nextCursor(r.nextPagePath);return this.#observation('transactions',transactionsSchema.parse({items:r.items.map(i=>({...i,reference:String(i.reference)})),nextCursor:next,truncated:next!==null}));}catch{throw new BrokerError('invalid_response');}}
  disconnect(){this.#credentials=null;return {providerRevocationRequired:true as const,guidance:'Delete this API key in Trading 212 Settings → API (Beta) to revoke it at the provider. Local deletion alone does not revoke the key.'};}
}
