'use client';
import {useEffect,useState} from 'react';
import {CommandCentre,type PortfolioData} from '../../../components/command-centre/command-centre';
import type {ResearchFeed} from '../../../lib/portfolio/research-feed';
import type {BrokerSyncSnapshot} from '../../../lib/brokers/contracts';

const DAY=86_400_000;
/** SYNTHETIC layout fixtures for visual testing only. Never connected to an account or shown on the real homepage. */
function fixture(kind:'sample'|'empty'|'stale',now:number):PortfolioData{
 const at=kind==='stale'?now-3*3600_000:now-60_000,url='https://live.trading212.com/api/v0';
 const positions=kind==='empty'?[]:[
  {instrument:{ticker:'NVDA_US_EQ',name:'NVIDIA (fixture)',currency:'USD',isin:null},quantity:0.5,currentPrice:200,averagePricePaid:180,quantityAvailableForTrading:0.5,quantityInPies:0,walletImpact:{currency:'GBP',currentValue:75,totalCost:68,unrealizedProfitLoss:7,fxImpact:0.4}},
  {instrument:{ticker:'VUSA_EQ',name:'S&P 500 ETF (fixture)',currency:'GBP',isin:null},quantity:1,currentPrice:90,averagePricePaid:88,quantityAvailableForTrading:1,quantityInPies:0,walletImpact:{currency:'GBP',currentValue:90,totalCost:88,unrealizedProfitLoss:2,fxImpact:null}}];
 const invested=kind==='empty'?0:156,value=kind==='empty'?250:259;
 const snapshot:BrokerSyncSnapshot={scope:'sync',summary:{provider:'trading212',environment:'live',sourceUrl:`${url}/equity/account/summary`,retrievedAt:at,data:{accountId:'fixture',currency:'GBP',totalValue:value,cash:{availableToTrade:value-(kind==='empty'?0:165),reservedForOrders:0,inPies:0},investments:{currentValue:kind==='empty'?0:165,totalCost:invested,realizedProfitLoss:0,unrealizedProfitLoss:kind==='empty'?0:9}}},positions:{provider:'trading212',environment:'live',sourceUrl:`${url}/equity/positions`,retrievedAt:at,data:positions},transactions:null,historyErrorCode:null};
 const v=(d:number,total:number)=>({observedAt:now-d*DAY,currency:'GBP',totalValue:total,cash:null,investedCost:null,investmentsValue:null,realisedProfitLoss:null,unrealisedProfitLoss:null});
 const valuations=kind==='empty'?[v(0.001,250)]:[v(40,250),v(30,252),v(20,248),v(12,300),v(6,303),v(1.2,255),v(0.001,259)];
 const flows=kind==='empty'?[{reference:'f1',type:'DEPOSIT',amount:250,currency:'GBP',occurredAt:now-7*DAY}]:[{reference:'f1',type:'DEPOSIT',amount:250,currency:'GBP',occurredAt:now-41*DAY},{reference:'f2',type:'DEPOSIT',amount:50,currency:'GBP',occurredAt:now-15*DAY},{reference:'f3',type:'WITHDRAW',amount:-50,currency:'GBP',occurredAt:now-3*DAY}];
 const env={connection:{connectionId:'fixture',status:'connected',maskedKey:'••••FIXT',lastSuccessfulSyncAt:at,lastVerifiedAt:at,lastErrorCode:null,nextAllowedAt:0,rateLimits:[{resource:'/equity/positions',limit:1,remaining:1,resetAt:now+1000,periodSeconds:1,used:0,observedAt:at}]},schedule:{enabled:true,intervalMinutes:15,nextRunAt:now+10*60_000,lastRunAt:at,lastOutcome:'synchronised',pausedReason:null},snapshot,valuations,flows};
 return {live:env,demo:{connection:null,snapshot:null,valuations:[],flows:[]}};
}
export default function FixturePreview({fixture:kind,feed}:{fixture:'sample'|'empty'|'stale';feed:ResearchFeed}){
 const[now,setNow]=useState(0);useEffect(()=>{const t=setTimeout(()=>setNow(Date.now()),0);return ()=>clearTimeout(t);},[]);if(!now)return null;
 return <CommandCentre portfolio={fixture(kind,now)} trading={{liveKillSwitchEngaged:true,reviewer:true,orders:kind==='sample'?[{state:'reviewed'}]:[]}} feed={feed} flags={{demo:false,live:false}} now={now} signedIn configured fixtureLabel={`SYNTHETIC LAYOUT FIXTURE (${kind}) · development only · not your account, not market data`}/>;
}
