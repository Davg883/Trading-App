import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const authMock=vi.hoisted(()=>vi.fn());
vi.mock('@clerk/nextjs/server',()=>({auth:authMock}));
import {saveBrokerConnection,synchroniseBrokerConnection,deleteBrokerConnection} from '../lib/brokers/server';
import {encryptCredentials,decryptCredentials} from '../lib/brokers/vault';

const owner='https://mock.clerk.test|user-a',credentials={apiKey:'mock-api-key-no-real-access',apiSecret:'mock-api-secret-no-real-access'};
const vaultEnvironment={BROKER_VAULT_KEY_B64:Buffer.alloc(32,17).toString('base64'),BROKER_VAULT_KEY_VERSION:'mock-v1'};
type Call={url:string;auth:string|null;method:string|undefined;body:string;redirect:RequestRedirect|undefined;cache:RequestCache|undefined};
function request(path:string,body:unknown,origin='http://localhost:3000'){return new Request(`http://localhost:3000${path}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});}
function installTransport(options:{failStorage?:boolean;historyRateLimit?:boolean}={}){
  const calls:Call[]=[];
  const encryptedPayload=JSON.stringify(encryptCredentials(credentials,owner,'demo',vaultEnvironment));
  const transport=vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.toString():input.url;
    const body=typeof init?.body==='string'?init.body:'';
    calls.push({url,auth:new Headers(init?.headers).get('authorization'),method:init?.method,body,redirect:init?.redirect,cache:init?.cache});
    const json=(value:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}});
    if(url.startsWith('https://mock.convex.cloud/api/')){
      const payload=JSON.parse(body) as {path:string};
      if(payload.path==='brokers:viewer')return json({status:'success',value:{owner}});
      if(options.failStorage)throw new Error(`sensitive backend detail ${credentials.apiSecret}`);
      if(payload.path==='brokers:deleteInternal')return json({status:'success',value:{deleted:true,providerRevocationRequired:true}});
      if(payload.path==='brokers:saveInternal')return json({status:'success',value:{connectionId:'mock-connection',revision:1}});
      if(payload.path==='brokers:acquireSyncInternal')return json({status:'success',value:{ok:true,connectionId:'mock-connection',environment:'demo',revision:1,leaseToken:'mock-lease',encryptedPayload,operation:'sync'}});
      if(payload.path==='brokers:recordSyncInternal')return json({status:'success',value:{stored:true}});
      throw new Error('Unexpected internal resource');
    }
    if(url==='https://demo.trading212.com/api/v0/equity/account/summary')return json({id:123,currency:'GBP',totalValue:1100,cash:{availableToTrade:100,reservedForOrders:0,inPies:0},investments:{currentValue:1000,totalCost:900,realizedProfitLoss:0,unrealizedProfitLoss:100},unexpectedSecret:credentials.apiSecret});
    if(url==='https://demo.trading212.com/api/v0/equity/positions')return json([{instrument:{ticker:'MOCK_US_EQ',name:'Mock holding',currency:'USD',isin:'MOCK-ISIN'},quantity:2,currentPrice:50,averagePricePaid:40}]);
    if(url==='https://demo.trading212.com/api/v0/equity/history/transactions?limit=50')return options.historyRateLimit?json({sensitiveError:credentials.apiSecret},429,{'retry-after':'120'}):json({items:[{reference:'mock-tx',type:'DEPOSIT',dateTime:'2026-10-29T12:00:00Z',amount:100,currency:'GBP'}],nextPagePath:null});
    throw new Error('Unexpected external destination');
  });
  vi.stubGlobal('fetch',transport);
  return calls;
}
beforeEach(()=>{
  for(const [key,value] of Object.entries({...vaultEnvironment,NEXT_PUBLIC_CONVEX_URL:'https://mock.convex.cloud',NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:'mock-public-key',CLERK_SECRET_KEY:'mock-clerk-secret',CONVEX_BROKER_ADMIN_KEY:'mock-admin-key',BROKER_APP_ORIGIN:'http://localhost:3000'}))vi.stubEnv(key,value);
  authMock.mockResolvedValue({userId:'user-a',getToken:async()=> 'mock-user-jwt'});
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();authMock.mockReset();});

describe('server-only broker route boundary',()=>{
  it('uses the pinned admin runtime only after authenticated owner lookup and sends only ciphertext to storage',async()=>{
    const calls=installTransport();
    const response=await saveBrokerConnection(request('/api/brokers',{provider:'trading212',environment:'demo',...credentials}));
    expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(calls).toHaveLength(2);expect(calls[0].auth).toBe('Bearer mock-user-jwt');expect(calls[1].auth).toBe('Convex mock-admin-key');
    expect(calls.every(c=>c.redirect==='error'&&c.cache==='no-store')).toBe(true);
    const stored=JSON.parse(calls[1].body) as {path:string;args:[{owner:string;encryptedPayload:string;maskedKey:string}]};
    expect(stored.path).toBe('brokers:saveInternal');expect(stored.args[0].owner).toBe(owner);
    expect(decryptCredentials(JSON.parse(stored.args[0].encryptedPayload),owner,'demo',vaultEnvironment)).toEqual(credentials);
    const output=await response.text();for(const secret of [credentials.apiKey,credentials.apiSecret,vaultEnvironment.BROKER_VAULT_KEY_B64,'mock-admin-key']){expect(output).not.toContain(secret);expect(calls.map(c=>c.body).join('')).not.toContain(secret);}
  });
  it('rejects cross-origin credential writes before authentication or storage',async()=>{
    const calls=installTransport();const response=await saveBrokerConnection(request('/api/brokers',{provider:'trading212',environment:'demo',...credentials},'https://attacker.test'));
    expect(response.status).toBe(403);expect(authMock).not.toHaveBeenCalled();expect(calls).toHaveLength(0);
  });
  it('requires authentication and refuses caller-supplied ownership',async()=>{
    const calls=installTransport();authMock.mockResolvedValueOnce({userId:null});
    expect((await saveBrokerConnection(request('/api/brokers',{provider:'trading212',environment:'demo',...credentials}))).status).toBe(401);
    expect(calls).toHaveLength(0);
    expect((await saveBrokerConnection(request('/api/brokers',{provider:'trading212',environment:'demo',owner:'victim',...credentials}))).status).toBe(400);
    expect(calls).toHaveLength(1);expect(calls[0].body).toContain('brokers:viewer');
  });
  it('does not return or log sensitive internal error details',async()=>{
    const calls=installTransport({failStorage:true}),log=vi.spyOn(console,'log').mockImplementation(()=>{}),warn=vi.spyOn(console,'warn').mockImplementation(()=>{}),error=vi.spyOn(console,'error').mockImplementation(()=>{});
    const response=await saveBrokerConnection(request('/api/brokers',{provider:'trading212',environment:'demo',...credentials}));
    expect(response.status).toBe(503);const output=await response.text();expect(output).toContain('storage_unavailable');expect(output).not.toContain(credentials.apiSecret);expect(output).not.toContain('sensitive backend detail');
    expect(calls).toHaveLength(2);expect(log).not.toHaveBeenCalled();expect(warn).not.toHaveBeenCalled();expect(error).not.toHaveBeenCalled();
  });
  it('decrypts only on the server and limits a complete synchronization to the three approved demo GET resources',async()=>{
    const calls=installTransport(),response=await synchroniseBrokerConnection(request('/api/brokers/sync',{connectionId:'mock-connection',environment:'demo',operation:'sync'}));
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({synchronised:true,partial:false,readOnly:true});
    const provider=calls.filter(c=>c.url.startsWith('https://demo.trading212.com/'));expect(provider).toHaveLength(3);expect(provider.every(c=>c.method==='GET'&&c.redirect==='error'&&c.cache==='no-store')).toBe(true);
    expect(provider.every(c=>c.auth===`Basic ${Buffer.from(`${credentials.apiKey}:${credentials.apiSecret}`).toString('base64')}`)).toBe(true);
    const stored=calls.find(c=>c.body.includes('brokers:recordSyncInternal'));expect(stored).toBeDefined();expect(stored!.body).not.toContain(credentials.apiSecret);expect(stored!.body).not.toContain('unexpectedSecret');
    expect(calls.some(c=>c.url.includes('/orders')||c.url.includes('live.trading212'))).toBe(false);
  });
  it('preserves a rate-limit retry time when transaction history is an optional partial failure',async()=>{
    const calls=installTransport({historyRateLimit:true}),before=Date.now();
    const response=await synchroniseBrokerConnection(request('/api/brokers/sync',{connectionId:'mock-connection',environment:'demo',operation:'sync'}));
    expect(response.status).toBe(200);const output=await response.text();expect(JSON.parse(output)).toMatchObject({partial:true,historyErrorCode:'rate_limited'});expect(output).not.toContain(credentials.apiSecret);
    const call=calls.find(c=>c.body.includes('brokers:recordSyncInternal'))!;
    const stored=JSON.parse(call.body) as {args:[{errorCode:string;retryAfterAt:number;snapshotJson:string}]};
    expect(stored.args[0].errorCode).toBe('rate_limited');expect(stored.args[0].retryAfterAt).toBeGreaterThanOrEqual(before+119000);expect(stored.args[0].snapshotJson).not.toContain(credentials.apiSecret);
  });
});


it('deletes an authenticated owner connection without needing the lost encryption key or calling the provider',async()=>{
  const calls=installTransport();vi.stubEnv('BROKER_VAULT_KEY_B64','');
  const response=await deleteBrokerConnection(new Request('http://localhost:3000/api/brokers',{method:'DELETE',headers:{'Content-Type':'application/json',Origin:'http://localhost:3000'},body:JSON.stringify({connectionId:'mock-connection',environment:'demo'})}));
  expect(response.status).toBe(200);expect(await response.json()).toMatchObject({deleted:true,providerRevocationRequired:true});
  expect(calls).toHaveLength(2);const deletion=JSON.parse(calls[1].body);expect(deletion.path).toBe('brokers:deleteInternal');expect(deletion.args[0]).toEqual({owner,connectionId:'mock-connection',environment:'demo'});expect(calls.every(c=>c.url.startsWith('https://mock.convex.cloud/'))).toBe(true);
});
