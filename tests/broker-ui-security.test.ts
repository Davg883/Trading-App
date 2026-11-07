import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({values:[] as unknown[],index:0}));
vi.mock('react',async importOriginal=>{
  const actual=await importOriginal<typeof import('react')>();
  return {...actual,useState:()=>[state.values[state.index++],()=>{}],useEffect:()=>{},useCallback:(fn:unknown)=>fn};
});
vi.mock('@clerk/nextjs',()=>({ClerkProvider:()=>null,SignInButton:()=>null,UserButton:()=>null,useAuth:()=>({isLoaded:true,isSignedIn:false,userId:null})}));
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {BrokerPanel} from '../components/broker-settings';
import {syncSnapshotSchema,type BrokerConnectionDetail,type BrokerConnectionMetadata} from '../lib/brokers/contracts';

const timestamp=Date.parse('2026-10-30T12:00:00Z');
const metadata:BrokerConnectionMetadata={connectionId:'connection-a',provider:'trading212',environment:'demo',maskedKey:'••••ABCD',status:'connected',readOnly:true,createdAt:timestamp,updatedAt:timestamp,lastSuccessfulSyncAt:timestamp,lastVerifiedAt:timestamp,lastAttemptAt:timestamp,lastErrorCode:null,nextAllowedAt:0};
const detail:BrokerConnectionDetail={...metadata,snapshot:syncSnapshotSchema.parse({scope:'sync',summary:{provider:'trading212',environment:'demo',sourceUrl:'https://demo.trading212.com/api/v0/equity/account/summary',retrievedAt:timestamp,data:{accountId:'private-account-a',currency:'GBP',totalValue:4321.55,cash:{availableToTrade:321.55,reservedForOrders:0,inPies:0},investments:{currentValue:4000,totalCost:3500,realizedProfitLoss:0,unrealizedProfitLoss:500}}},positions:{provider:'trading212',environment:'demo',sourceUrl:'https://demo.trading212.com/api/v0/equity/positions',retrievedAt:timestamp,data:[{instrument:{ticker:'PRIVATE_A',name:'Private holding A',currency:'GBP',isin:null},quantity:1,currentPrice:4000,averagePricePaid:3500,quantityAvailableForTrading:1,quantityInPies:0,walletImpact:{currency:'GBP',currentValue:4000,totalCost:3500,unrealizedProfitLoss:500,fxImpact:0}}]},transactions:{provider:'trading212',environment:'demo',sourceUrl:'https://demo.trading212.com/api/v0/equity/history/transactions',retrievedAt:timestamp,data:{items:[{reference:'private-transaction-a',type:'DEPOSIT',dateTime:'2026-10-30T10:00:00Z',amount:321.55,currency:'GBP'}],nextCursor:null,truncated:false}},historyErrorCode:null})};

beforeEach(()=>{
  // Seed retained component state as if owner A had just signed out. This tests
  // the rendered privacy boundary independently of the identity-key remount.
  state.values=['demo','','',[metadata],detail,'',false,timestamp];state.index=0;
});
describe('broker account visibility on authentication changes',()=>{
  it('hides retained account, holdings, history and saved key metadata immediately when signed out',()=>{
    const html=renderToStaticMarkup(createElement(BrokerPanel,{authenticated:false,storageConfigured:true}));
    for(const privateValue of ['private-account-a','Private holding A','PRIVATE_A','private-transaction-a','••••ABCD','4,321.55'])expect(html).not.toContain(privateValue);
    expect(html).toContain('No account summary retrieved');expect(html).toContain('Positions have not been synchronised');
  });
  it('renders the same retained private fixture only while authenticated',()=>{
    const html=renderToStaticMarkup(createElement(BrokerPanel,{authenticated:true,storageConfigured:true}));
    for(const privateValue of ['private-account-a','Private holding A','PRIVATE_A','private-transaction-a','••••ABCD','4,321.55'])expect(html).toContain(privateValue);
  });
});
