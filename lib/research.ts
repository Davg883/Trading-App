/** Deterministic research calculations. Returns are decimal fractions; money is GBP. */
export type Evidence = { id: string; publishedAt: number; receivedAt: number; value: number; source: string };
export function evidenceAt<T extends Evidence>(facts: T[], cutoff: number): T[] {
  return facts.filter(f => f.publishedAt <= cutoff && f.receivedAt <= cutoff && Number.isFinite(f.value));
}
export function brier(probabilities: number[], outcome: number): number {
  if (probabilities.length !== 3 || probabilities.some(p => !Number.isFinite(p) || p < 0 || p > 1) || Math.abs(probabilities.reduce((a,b)=>a+b,0)-1)>1e-8 || !Number.isInteger(outcome) || outcome < 0 || outcome > 2) throw new Error('Invalid three-class forecast');
  return probabilities.reduce((s,p,i)=>s+(p-(i===outcome?1:0))**2,0);
}
export function meanAbsoluteError(predicted: number[], actual: number[]): number {
  if (!predicted.length || predicted.length !== actual.length || [...predicted,...actual].some(x=>!Number.isFinite(x))) throw new Error('Aligned finite observations required');
  return predicted.reduce((s,p,i)=>s+Math.abs(p-actual[i]),0)/predicted.length;
}
export function maxDrawdown(equity: number[]): number {
  if (!equity.length || equity.some(v=>!Number.isFinite(v)||v<=0)) throw new Error('Positive equity observations required');
  let peak=equity[0], drawdown=0;
  for(const v of equity){ peak=Math.max(peak,v); drawdown=Math.max(drawdown,(peak-v)/peak); }
  return drawdown;
}
export function ratio(numerator:number, denominator:number):number|null { return Number.isFinite(numerator)&&Number.isFinite(denominator)&&denominator>0?numerator/denominator:null; }
export type FillInput = { quantity:number; priceUsd:number; usdToGbp:number; spreadBps:number; slippageBps:number; fxBps:number; feeGbp:number; side:'buy'|'sell' };
export function paperFill(input:FillInput){
  const {quantity,priceUsd,usdToGbp,spreadBps,slippageBps,fxBps,feeGbp,side}=input;
  if ([quantity,priceUsd,usdToGbp].some(x=>!Number.isFinite(x)||x<=0)||[spreadBps,slippageBps,fxBps,feeGbp].some(x=>!Number.isFinite(x)||x<0)||spreadBps/2+slippageBps>=10000||fxBps>=10000) throw new Error('Invalid fill inputs');
  const executionPriceUsd=priceUsd*(1+(side==='buy'?1:-1)*(spreadBps/2+slippageBps)/10000);
  const grossGbp=quantity*executionPriceUsd*usdToGbp;
  const costsGbp=grossGbp*fxBps/10000+feeGbp;
  const cashDeltaGbp=side==='buy'?-(grossGbp+costsGbp):grossGbp-costsGbp;
  return {executionPriceUsd,grossGbp,costsGbp,cashDeltaGbp};
}
export const RISK_POLICY = Object.freeze({ maxPositionFraction:0.25, maxQuoteAgeMs:60_000, approvalTtlMs:300_000, version:'benchmark-001-v1' });
export function checkRisk(input:{cashGbp:number;equityGbp:number;existingExposureGbp:number;orderCostGbp:number;quoteAt:number;now:number;approvedAt?:number}){
  const reasons:string[]=[];
  if(Object.values(input).some(v=>!Number.isFinite(v))) reasons.push('Non-finite risk input');
  if(input.equityGbp<=0||input.orderCostGbp<=0||input.existingExposureGbp<0||input.cashGbp<0) reasons.push('Invalid account or order value');
  if(input.now<input.quoteAt||input.now-input.quoteAt>RISK_POLICY.maxQuoteAgeMs) reasons.push('Quote is stale or from the future');
  if(input.orderCostGbp>input.cashGbp) reasons.push('Insufficient cash');
  if(input.orderCostGbp+input.existingExposureGbp>input.equityGbp*RISK_POLICY.maxPositionFraction) reasons.push('Position limit exceeded');
  if(input.approvedAt!==undefined&&(input.approvedAt>input.now||input.now-input.approvedAt>RISK_POLICY.approvalTtlMs)) reasons.push('Approval expired or invalid');
  return {passed:reasons.length===0,reasons,policyVersion:RISK_POLICY.version};
}
export function applyOnce<T>(records:Map<string,T>,key:string,create:()=>T):T { if(records.has(key))return records.get(key)!;const result=create(); records.set(key,result);return result; }
