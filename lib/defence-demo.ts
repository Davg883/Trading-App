import {DEFENCE_VERSION,parseDefenceCase,type DefenceCase,type DefenceInstrument} from './portfolio-defence';

/** Entirely invented instruments, fund weights, prices and assumptions. No company market data. */
export function defenceDemonstration():DefenceCase{
  const closes:number[]=[];
  for(let t=Date.parse('2026-07-23T16:30:00Z');closes.length<71;t+=86400000){const day=new Date(t).getUTCDay();if(day!==0&&day!==6)closes.push(t);}
  const last=closes.at(-1)!,sourceId='synthetic-declaration',assumptions='synthetic-scenario-assumptions';
  const rows:[string,string,DefenceInstrument['product'],string,string,string,string,boolean|null][]=[
    ['demo-ai','Illustrative AI infrastructure company','equity','Technology','US','USD','Compute supply',true],
    ['demo-global','Illustrative global equity fund','etf','Mixed','Global','GBP','Mixed',null],
    ['demo-defensive','Illustrative defensive equity basket','equity','Consumer staples','GB','GBP','Other',false],
    ['demo-cash','Illustrative GBP cash reserve','cash','Cash','GB','GBP','Other',false],
    ['demo-bonds','Illustrative short-duration bond basket','bond','Investment-grade bonds','GB','GBP','Other',false],
    ['demo-gold','Illustrative physical gold ETC','gold_etc','Commodity','IE','USD','Other',false],
    ['demo-value','Illustrative diversified value basket','equity','Value equities','Global','USD','Other',false],
    ['demo-benchmark','Illustrative broad equity benchmark','equity','Mixed','Global','USD','Mixed',null],
  ];
  const instruments=rows.map(([id,name,product,sector,country,currency,aiLayer,aiRelated]):DefenceInstrument=>({id,name,symbol:id.toUpperCase(),isin:null,currency,company:name,sector,country,aiLayer,aiRelated,product,paperEligible:product==='cash'||product==='equity',availability:'Synthetic illustration only; no actual listed instrument or broker availability',structure:`Invented fully funded ${product} exposure`,annualFeeBps:null,sourceIds:[sourceId],restrictions:['No executable product mapping','Human research review does not create an allocation'],risks:['Scenario assumptions may not describe actual markets','Prices, weights and classifications are invented'],protectsAgainst:product==='cash'?['Equity drawdown on the amount kept as cash']:['Hypothesised diversification of a concentrated AI portfolio'],cannotProtectAgainst:['All market, currency, inflation or liquidity risks'],lossConditions:[product==='cash'?'Inflation or institution failure; equity recovery opportunity cost':'Adverse market moves or a breakdown in assumed diversification']}));
  const common={initialCapital:10000,currency:'GBP',horizonSessions:20,priceBasis:'total-return' as const,calendarId:'demo-weekday-calendar',session:'regular' as const,mode:'synthetic' as const};
  const shockRows:[string,string,number[]][]=[
    ['ai_correction','AI-sector correction',[-.35,-.20,-.08,0,.01,.05,-.10,-.18]],
    ['equity_downturn','Wider equity downturn',[-.30,-.25,-.18,0,-.02,-.05,-.22,-.25]],
    ['rates_credit','Rates and credit spreads rise',[-.18,-.12,-.08,0,-.04,-.08,-.10,-.12]],
    ['recession','Recession and falling earnings',[-.28,-.22,-.14,0,.015,.04,-.24,-.22]],
    ['ai_recovery','AI recovery and renewed growth',[.40,.25,.10,0,.005,-.06,.18,.25]],
  ];
  const histories=instruments.map((instrument,k)=>{let price=100;return {id:`history-${instrument.id}`,instrumentId:instrument.id,provider:'Invented deterministic demonstration generator',currency:instrument.currency,priceBasis:'total-return' as const,adjustmentVersion:'synthetic-total-return-v1',calendarId:common.calendarId,session:common.session,mode:common.mode,corporateActionsReviewed:true,sessionsPerYear:252,calendarVerified:true,calendarSessions:closes,observations:closes.map((eventAt,j)=>{if(j>0){const r=instrument.product==='cash'?0:(.007*Math.sin(j*.61)+.004*Math.cos(j*.23))*(k===0?1.4:k===7?1:k===4?.09:k===5?-.4:.65)+.0002;price*=1+r;}return {eventAt,publishedAt:eventAt,receivedAt:eventAt+1000,close:price,sourceId};})};});
  return parseDefenceCase({version:DEFENCE_VERSION,id:'synthetic-defence-example-v1',name:'Invented AI-cycle portfolio comparison',mode:'synthetic',sources:[{id:sourceId,title:'Synthetic demonstration declaration — not market data',url:'https://example.com/synthetic-defence',publishedAt:closes[0],receivedAt:closes[0],mode:'synthetic',verified:true,role:'evidence'},{id:assumptions,title:'User-defined synthetic shock assumptions — not historical returns',url:'https://example.com/synthetic-shocks',publishedAt:last+10000,receivedAt:last+11000,mode:'synthetic',verified:true,role:'evidence'}],instruments,funds:[{id:'demo-global-holdings-v1',instrumentId:'demo-global',asOf:last,publishedAt:last+1000,receivedAt:last+2000,verified:true,mode:'synthetic',sourceIds:[sourceId],constituents:[{instrumentId:'demo-ai',weight:.6},{instrumentId:'demo-defensive',weight:.3}]}],portfolios:[{...common,id:'unhedged',name:'Concentrated AI + global fund',allocations:[{instrumentId:'demo-ai',weight:.6},{instrumentId:'demo-global',weight:.4}],costs:{fees:0,slippage:0,financing:0}},{...common,id:'diversified',name:'Diversified research alternative',allocations:[{instrumentId:'demo-ai',weight:.3},{instrumentId:'demo-global',weight:.2},{instrumentId:'demo-cash',weight:.2},{instrumentId:'demo-bonds',weight:.15},{instrumentId:'demo-gold',weight:.1},{instrumentId:'demo-value',weight:.05}],costs:{fees:20,slippage:10,financing:0}}],scenarios:shockRows.map(([category,name,returns])=>({id:category,name,category,kind:'user_defined',mode:'synthetic',publishedAt:last+10000,receivedAt:last+11000,sourceIds:[assumptions],startAt:last,endAt:last+28*86400000,horizonSessions:20,calendarId:common.calendarId,currency:'GBP',priceBasis:common.priceBasis,session:common.session,returns:instruments.map((i,k)=>({instrumentId:i.id,return:returns[k]}))})),histories});
}

export function emptyDefenceCase():DefenceCase{return {version:DEFENCE_VERSION,id:'unconfigured-observed-research',name:'Observed portfolio research — awaiting evidence',mode:'historical',sources:[],instruments:[],funds:[],portfolios:[],scenarios:[],histories:[]};}
export function defenceLatestReceipt(data:DefenceCase){return Math.max(0,...data.sources.map(s=>s.receivedAt),...data.funds.map(f=>f.receivedAt),...data.scenarios.map(s=>s.receivedAt),...data.histories.flatMap(h=>h.observations.map(o=>o.receivedAt)));}
