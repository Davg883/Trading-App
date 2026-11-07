import type {AuthorisedMarketObservation} from './provider-adapter';
import {usRegularSessionCloseAt} from './provider-adapter';

/**
 * Phase 004 Stage 3 — Missing Evidence Resolver.
 *
 * Connects the Market Data Provider Adapter to the existing missing-evidence workflow:
 * 1. For completed research windows (`endAt <= asOf`), identifies absent prices, FX observations,
 *    corporate-action adjustments or transaction costs.
 * 2. Automatically recalculates USD and GBP outcomes once all required observations exist.
 * 3. Strictly refuses to score incomplete or unelapsed windows (`scored: false`, `outcome: null`).
 */

export type TransactionCostSchedule={
 entryFeePerLegGbp:number|null;
 exitFeePerLegGbp:number|null;
 spreadBps:number|null;
 slippageBps:number|null;
 fxFeeBps:number|null;
 annualAdditionalFeeBps:number|null;
 cashAnnualRate:number|null;
};

export type ResearchWindowSpec={
 windowId:string;
 studyId:string;
 studyName:string;
 domain:'recovery_006'|'policy_risk_001_2'|'forward_research_004';
 horizonSessions:number;
 anchorAt:number;
 endAt:number|null;
 requiredSessions:number[];
 requiredSymbols:string[];
 benchmarkSymbol:string|null;
 requiredPriceBasis:'unadjusted_close'|'split-adjusted'|'total-return';
 requiresCorporateActionsReviewed:boolean;
 requiresCloseAlignedLicensedFx:boolean;
 transactionCostSchedule:TransactionCostSchedule|null;
};

export type AbsentPriceGap={
 symbol:string;
 sessionCloseAt:number;
 sessionDate:string;
 reason:string;
};

export type AbsentFxGap={
 sessionDate:string;
 sessionCloseAt:number;
 reason:string;
};

export type AbsentCorporateActionGap={
 symbol:string;
 sessionDate:string;
 currentBasis:string;
 requiredBasis:string;
 corporateActionsReviewed:boolean;
 reason:string;
};

export type AbsentTransactionCostGap={
 parameter:keyof TransactionCostSchedule;
 reason:string;
};

export type RecalculatedWindowOutcome={
 computedAt:number;
 anchorSessionDate:string;
 endSessionDate:string;
 memberReturnsUsd:Record<string,number>;
 memberReturnsGbp:Record<string,number>;
 equalWeightReturnUsd:number;
 equalWeightReturnGbp:number;
 netEqualWeightReturnGbp:number|null;
 benchmarkReturnUsd:number|null;
 benchmarkReturnGbp:number|null;
 excessReturnUsd:number|null;
 excessReturnGbp:number|null;
 maxDrawdownUsd:number;
 maxDrawdownGbp:number;
 observationIds:string[];
};

export type WindowResolutionReport={
 windowId:string;
 studyId:string;
 studyName:string;
 domain:ResearchWindowSpec['domain'];
 horizonSessions:number;
 anchorAt:number;
 endAt:number|null;
 windowCompleted:boolean;
 status:'complete_scored'|'incomplete_blocked'|'horizon_not_elapsed';
 scored:boolean;
 recalculated:boolean;
 absentPrices:AbsentPriceGap[];
 absentFxObservations:AbsentFxGap[];
 absentCorporateActions:AbsentCorporateActionGap[];
 absentTransactionCosts:AbsentTransactionCostGap[];
 blockingReasons:string[];
 outcome:RecalculatedWindowOutcome|null;
};

export type MissingEvidenceResolutionSummary={
 evaluatedAt:number;
 totalWindows:number;
 completedWindows:number;
 scoredWindows:number;
 blockedIncompleteWindows:number;
 pendingFutureWindows:number;
 windows:WindowResolutionReport[];
 executionAuthority:'none';
};
export type MissingEvidenceResolverReport=MissingEvidenceResolutionSummary;

function isoDate(ms:number):string{
 return new Date(ms).toISOString().slice(0,10);
}

/**
 * Evaluates a single research window against available market observations, identifying any absent
 * prices, FX observations, corporate actions or transaction costs, and recalculating outcomes
 * only when the window is complete and 100% of required evidence is present.
 */
export function resolveWindowMissingEvidence(params:{
 window:ResearchWindowSpec;
 observations:AuthorisedMarketObservation[];
 asOf:number;
}):WindowResolutionReport{
 const {window:w,observations,asOf}=params;
 const absentPrices:AbsentPriceGap[]=[];
 const absentFxObservations:AbsentFxGap[]=[];
 const absentCorporateActions:AbsentCorporateActionGap[]=[];
 const absentTransactionCosts:AbsentTransactionCostGap[]=[];
 const blockingReasons:string[]=[];

 // 1. Never score a window whose end timestamp is null or in the future.
 if(w.endAt===null||w.endAt>asOf){
  return {
   windowId:w.windowId,
   studyId:w.studyId,
   studyName:w.studyName,
   domain:w.domain,
   horizonSessions:w.horizonSessions,
   anchorAt:w.anchorAt,
   endAt:w.endAt,
   windowCompleted:false,
   status:'horizon_not_elapsed',
   scored:false,
   recalculated:false,
   absentPrices,
   absentFxObservations,
   absentCorporateActions,
   absentTransactionCosts,
   blockingReasons:[
    w.endAt===null
     ?'Calendar does not yet extend to this horizon.'
     :`Horizon window completes at ${new Date(w.endAt).toISOString()} (after evaluation time ${new Date(asOf).toISOString()}).`,
   ],
   outcome:null,
  };
 }

 // 2. Check transaction cost schedule if required by the window
 if(w.transactionCostSchedule!==null){
  const costKeys:Array<keyof TransactionCostSchedule>=[
   'entryFeePerLegGbp',
   'exitFeePerLegGbp',
   'spreadBps',
   'slippageBps',
   'fxFeeBps',
   'annualAdditionalFeeBps',
   'cashAnnualRate',
  ];
  for(const k of costKeys){
   if(w.transactionCostSchedule[k]===null||!Number.isFinite(w.transactionCostSchedule[k])){
    absentTransactionCosts.push({
     parameter:k,
     reason:`${k} is undisclosed (null); unknown dealing or FX costs cannot be assumed to be zero.`,
    });
   }
  }
 }

 const allSymbols=[...new Set([...w.requiredSymbols,...(w.benchmarkSymbol?[w.benchmarkSymbol]:[])])];
 const eligibleObs=observations.filter(o=>o.serverReceivedAt<=asOf&&o.eventAt<=asOf);

 // Map (symbol, eventAt) -> matching observations
 const bySymbolSession=new Map<string,AuthorisedMarketObservation[]>();
 for(const obs of eligibleObs){
  const key=`${obs.symbol}|${obs.eventAt}`;
  const list=bySymbolSession.get(key)??[];
  list.push(obs);
  bySymbolSession.set(key,list);
 }

 const verifiedMatrix=new Map<string,AuthorisedMarketObservation[]>();

 // 3. Check prices, FX observations, and corporate actions across all required sessions & symbols
 for(const symbol of allSymbols){
  const symbolBars:AuthorisedMarketObservation[]=[];
  for(const sessionAt of w.requiredSessions){
   const sDate=isoDate(sessionAt);
   const matches=bySymbolSession.get(`${symbol}|${sessionAt}`)??[];
   if(matches.length===0){
    absentPrices.push({
     symbol,
     sessionCloseAt:sessionAt,
     sessionDate:sDate,
     reason:`Missing closing price observation for ${symbol} at session ${sDate} (${new Date(sessionAt).toISOString()}).`,
    });
    continue;
   }
   const bar=matches[0]!;
   symbolBars.push(bar);

   // Check FX observation alignment & licensing
   if(!Number.isFinite(bar.usdToGbp)||bar.usdToGbp<=0||!Number.isFinite(bar.closeGbp)){
    absentFxObservations.push({
     sessionDate:sDate,
     sessionCloseAt:sessionAt,
     reason:`Missing USD→GBP FX conversion rate for session ${sDate}.`,
    });
   }else if(w.requiresCloseAlignedLicensedFx&&(!bar.fxCloseAligned||!bar.licensed)){
    const fxReason=`USD→GBP rate (${bar.fxProvider}) on ${sDate} is an indicative reference fixing rather than a licensed 21:00 UTC close-aligned rate.`;
    if(!absentFxObservations.some(g=>g.sessionCloseAt===sessionAt)){
     absentFxObservations.push({
      sessionDate:sDate,
      sessionCloseAt:sessionAt,
      reason:fxReason,
     });
    }
   }

   // Check corporate-action review and price-basis compatibility
   const basisMismatch=
    w.requiredPriceBasis!=='unadjusted_close'&&bar.priceBasis!==w.requiredPriceBasis;
   const corpActionMissing=w.requiresCorporateActionsReviewed&&!bar.corporateActionsReviewed;
   if(basisMismatch||corpActionMissing){
    absentCorporateActions.push({
     symbol,
     sessionDate:sDate,
     currentBasis:bar.priceBasis,
     requiredBasis:w.requiredPriceBasis,
     corporateActionsReviewed:bar.corporateActionsReviewed,
     reason:`${symbol} (${sDate}) has priceBasis=${bar.priceBasis}, corporateActionsReviewed=${bar.corporateActionsReviewed}; window requires ${w.requiredPriceBasis} with corporateActionsReviewed=${w.requiresCorporateActionsReviewed}.`,
    });
   }
  }
  verifiedMatrix.set(symbol,symbolBars);
 }

 if(absentPrices.length>0){
  blockingReasons.push(`${absentPrices.length} absent price observation(s): ${absentPrices.slice(0,4).map(p=>`${p.symbol}@${p.sessionDate}`).join(', ')}`);
 }
 if(absentFxObservations.length>0){
  blockingReasons.push(`${absentFxObservations.length} FX gap(s): ${absentFxObservations[0]!.reason}`);
 }
 if(absentCorporateActions.length>0){
  const uniqueSyms=[...new Set(absentCorporateActions.map(c=>c.symbol))];
  blockingReasons.push(`Corporate-action / adjustment-basis gap across ${uniqueSyms.join(', ')} (requires ${w.requiredPriceBasis}, corporateActionsReviewed=${w.requiresCorporateActionsReviewed}).`);
 }
 if(absentTransactionCosts.length>0){
  blockingReasons.push(`${absentTransactionCosts.length} undisclosed transaction-cost parameter(s): ${absentTransactionCosts.map(c=>c.parameter).join(', ')}.`);
 }

 // Never score an incomplete window!
 if(
  absentPrices.length>0||
  absentFxObservations.length>0||
  absentCorporateActions.length>0||
  absentTransactionCosts.length>0
 ){
  return {
   windowId:w.windowId,
   studyId:w.studyId,
   studyName:w.studyName,
   domain:w.domain,
   horizonSessions:w.horizonSessions,
   anchorAt:w.anchorAt,
   endAt:w.endAt,
   windowCompleted:true,
   status:'incomplete_blocked',
   scored:false,
   recalculated:false,
   absentPrices,
   absentFxObservations,
   absentCorporateActions,
   absentTransactionCosts,
   blockingReasons,
   outcome:null,
  };
 }

 // 4. All required observations, FX rates, corporate actions, and costs exist: automatically recalculate outcomes!
 const memberReturnsUsd:Record<string,number>={};
 const memberReturnsGbp:Record<string,number>={};
 const observationIds=new Set<string>();

 const sessionCount=w.requiredSessions.length;
 const portfolioPathUsd=new Array<number>(sessionCount).fill(0);
 const portfolioPathGbp=new Array<number>(sessionCount).fill(0);

 for(const symbol of w.requiredSymbols){
  const bars=verifiedMatrix.get(symbol)!;
  const startUsd=bars[0]!.close;
  const endUsd=bars[bars.length-1]!.close;
  const startGbp=bars[0]!.closeGbp;
  const endGbp=bars[bars.length-1]!.closeGbp;
  memberReturnsUsd[symbol]=Number(((endUsd/startUsd)-1).toFixed(6));
  memberReturnsGbp[symbol]=Number(((endGbp/startGbp)-1).toFixed(6));
  bars.forEach((b,idx)=>{
   observationIds.add(b.observationId);
   portfolioPathUsd[idx]=(portfolioPathUsd[idx]??0)+(b.close/startUsd)/w.requiredSymbols.length;
   portfolioPathGbp[idx]=(portfolioPathGbp[idx]??0)+(b.closeGbp/startGbp)/w.requiredSymbols.length;
  });
 }

 const equalWeightReturnUsd=Number(((portfolioPathUsd[portfolioPathUsd.length-1]??1)-1).toFixed(6));
 const equalWeightReturnGbp=Number(((portfolioPathGbp[portfolioPathGbp.length-1]??1)-1).toFixed(6));

 let peakUsd=portfolioPathUsd[0]??1;
 let maxDrawdownUsd=0;
 for(const v of portfolioPathUsd){
  peakUsd=Math.max(peakUsd,v);
  maxDrawdownUsd=Math.min(maxDrawdownUsd,(v/peakUsd)-1);
 }

 let peakGbp=portfolioPathGbp[0]??1;
 let maxDrawdownGbp=0;
 for(const v of portfolioPathGbp){
  peakGbp=Math.max(peakGbp,v);
  maxDrawdownGbp=Math.min(maxDrawdownGbp,(v/peakGbp)-1);
 }

 let benchmarkReturnUsd:number|null=null;
 let benchmarkReturnGbp:number|null=null;
 if(w.benchmarkSymbol){
  const bBars=verifiedMatrix.get(w.benchmarkSymbol)!;
  bBars.forEach(b=>observationIds.add(b.observationId));
  benchmarkReturnUsd=Number(((bBars[bBars.length-1]!.close/bBars[0]!.close)-1).toFixed(6));
  benchmarkReturnGbp=Number(((bBars[bBars.length-1]!.closeGbp/bBars[0]!.closeGbp)-1).toFixed(6));
 }

 let netEqualWeightReturnGbp:number|null=null;
 if(w.transactionCostSchedule){
  const c=w.transactionCostSchedule;
  const roundTripBps=((c.spreadBps??0)+(c.slippageBps??0)+(c.fxFeeBps??0))*2;
  const fixedLegCosts=((c.entryFeePerLegGbp??0)+(c.exitFeePerLegGbp??0))*w.requiredSymbols.length;
  const fixedCostFraction=fixedLegCosts/500;
  netEqualWeightReturnGbp=Number((equalWeightReturnGbp-(roundTripBps/10_000)-fixedCostFraction).toFixed(6));
 }

 return {
  windowId:w.windowId,
  studyId:w.studyId,
  studyName:w.studyName,
  domain:w.domain,
  horizonSessions:w.horizonSessions,
  anchorAt:w.anchorAt,
  endAt:w.endAt,
  windowCompleted:true,
  status:'complete_scored',
  scored:true,
  recalculated:true,
  absentPrices,
  absentFxObservations,
  absentCorporateActions,
  absentTransactionCosts,
  blockingReasons:[],
  outcome:{
   computedAt:asOf,
   anchorSessionDate:isoDate(w.anchorAt),
   endSessionDate:isoDate(w.endAt),
   memberReturnsUsd,
   memberReturnsGbp,
   equalWeightReturnUsd,
   equalWeightReturnGbp,
   netEqualWeightReturnGbp,
   benchmarkReturnUsd,
   benchmarkReturnGbp,
   excessReturnUsd:benchmarkReturnUsd!==null?Number((equalWeightReturnUsd-benchmarkReturnUsd).toFixed(6)):null,
   excessReturnGbp:benchmarkReturnGbp!==null?Number((equalWeightReturnGbp-benchmarkReturnGbp).toFixed(6)):null,
   maxDrawdownUsd:Number(maxDrawdownUsd.toFixed(6)),
   maxDrawdownGbp:Number(maxDrawdownGbp.toFixed(6)),
   observationIds:[...observationIds],
  },
 };
}

/**
 * Builds the canonical set of research windows across our covered universe so that
 * every market-data collection cycle resolves missing evidence and recalculates eligible windows.
 */
export function buildDefaultResearchWindowsForResolution():ResearchWindowSpec[]{
 const nov3=usRegularSessionCloseAt('2026-11-03');
 const nov4=usRegularSessionCloseAt('2026-11-04');
 const nov5=usRegularSessionCloseAt('2026-11-05');
 const nov10=usRegularSessionCloseAt('2026-11-10');

 return [
  {
   windowId:'policy-001.2:ai-hyperscalers-chips:1d',
   studyId:'policy-risk-001.2-midterm-2026-11-03',
   studyName:'Benchmark 001.2 · AI Hyperscalers & Chips 1-Session Post-Anchor Window (3–4 Nov 2026)',
   domain:'policy_risk_001_2',
   horizonSessions:1,
   anchorAt:nov3,
   endAt:nov4,
   requiredSessions:[nov3,nov4],
   requiredSymbols:['NVDA','MSFT','GOOGL','AMZN','INTC','AMD','CRWV'],
   benchmarkSymbol:'QQQ',
   requiredPriceBasis:'unadjusted_close',
   requiresCorporateActionsReviewed:false,
   requiresCloseAlignedLicensedFx:false,
   transactionCostSchedule:null,
  },
  {
   windowId:'policy-001.2:ai-hyperscalers-chips:2d',
   studyId:'policy-risk-001.2-midterm-2026-11-03',
   studyName:'Benchmark 001.2 · AI Universe 2-Session Window (3–5 Nov 2026, Resolved via Live Adapter)',
   domain:'policy_risk_001_2',
   horizonSessions:2,
   anchorAt:nov3,
   endAt:nov5,
   requiredSessions:[nov3,nov4,nov5],
   requiredSymbols:['NVDA','MSFT','GOOGL','AMZN','INTC','AMD','CRWV'],
   benchmarkSymbol:'QQQ',
   requiredPriceBasis:'unadjusted_close',
   requiresCorporateActionsReviewed:false,
   requiresCloseAlignedLicensedFx:false,
   transactionCostSchedule:null,
  },
  {
   windowId:'recovery-006:immediate-plan:1d',
   studyId:'recovery-006-2026-11-03-v2',
   studyName:'Case 006 · Immediate £500 Paper Plan 1-Session Window (Blocked on Corporate Actions & Costs)',
   domain:'recovery_006',
   horizonSessions:1,
   anchorAt:nov3,
   endAt:nov4,
   requiredSessions:[nov3,nov4],
   requiredSymbols:['NVDA','MSFT'],
   benchmarkSymbol:'QQQ',
   requiredPriceBasis:'total-return',
   requiresCorporateActionsReviewed:true,
   requiresCloseAlignedLicensedFx:true,
   transactionCostSchedule:{
    entryFeePerLegGbp:null,
    exitFeePerLegGbp:null,
    spreadBps:null,
    slippageBps:null,
    fxFeeBps:null,
    annualAdditionalFeeBps:null,
    cashAnnualRate:null,
   },
  },
  {
   windowId:'policy-001.2:ai-hyperscalers-chips:5d',
   studyId:'policy-risk-001.2-midterm-2026-11-03',
   studyName:'Benchmark 001.2 · AI Universe 5-Session Window (3–10 Nov 2026, Horizon Pending)',
   domain:'policy_risk_001_2',
   horizonSessions:5,
   anchorAt:nov3,
   endAt:nov10,
   requiredSessions:[nov3,nov4,nov5,nov10],
   requiredSymbols:['NVDA','MSFT','GOOGL','AMZN','INTC','AMD','CRWV'],
   benchmarkSymbol:'QQQ',
   requiredPriceBasis:'unadjusted_close',
   requiresCorporateActionsReviewed:false,
   requiresCloseAlignedLicensedFx:false,
   transactionCostSchedule:null,
  },
 ];
}

/**
 * Resolves all supplied research windows against the current market observation store.
 */
export function resolveMissingEvidenceAndOutcomes(params:{
 windows?:ResearchWindowSpec[];
 observations:AuthorisedMarketObservation[];
 asOf:number;
}):MissingEvidenceResolutionSummary{
 const specs=params.windows??buildDefaultResearchWindowsForResolution();
 const reports=specs.map(window=>
  resolveWindowMissingEvidence({
   window,
   observations:params.observations,
   asOf:params.asOf,
  })
 );

 return {
  evaluatedAt:params.asOf,
  totalWindows:reports.length,
  completedWindows:reports.filter(r=>r.windowCompleted).length,
  scoredWindows:reports.filter(r=>r.scored).length,
  blockedIncompleteWindows:reports.filter(r=>r.status==='incomplete_blocked').length,
  pendingFutureWindows:reports.filter(r=>r.status==='horizon_not_elapsed').length,
  windows:reports,
  executionAuthority:'none',
 };
}
