import type { ReviewContext } from '../lib/review-context';
const amount=(n:number|null|undefined)=>n==null?'Unavailable':new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(n);
export default function ProposalReview({context,quantity}:{context?:ReviewContext;quantity?:number}){
  return <section aria-label="Investment review context" style={{background:'#f2f5ed',padding:16,borderRadius:8,margin:'12px 0'}}>
    <p><strong>Investment thesis:</strong> {context?.thesis??'Legacy proposal: detailed thesis not supplied.'}</p>
    {(['supportingEvidence','challengingEvidence','valuationRisks','financialRisks'] as const).map((key,i)=><div key={key}><strong>{['Supporting evidence','Challenging evidence','Valuation risks','Financial risks'][i]}</strong><ul>{(context?.[key]??['Not supplied — investigate before approval.']).map((value,index)=><li key={index}>{value}</li>)}</ul></div>)}
    <p>Suggested position: {quantity??'Unavailable'} shares · declared notional {amount(context?.suggestedNotionalGbp)}</p>
    <p>Declared portfolio exposure: {amount(context?.portfolioExposureGbp)} · recalculated independently at execution.</p>
    <p>Defined planned loss: {amount(context?.plannedLossGbp)} · stop {context?.stopPriceUsd==null?'not specified':`$${context.stopPriceUsd.toFixed(2)}`}.</p>
    <p>A planned stop is a scenario assumption, not a guaranteed maximum loss or an automatically placed order.</p>
    <p><strong>Data freshness:</strong> {context?.dataFreshness??'Not supplied'}</p>
    <p><strong>Uncertainty:</strong> {context?.uncertainty??'Not supplied'}</p>
    <p><strong>Model disagreement:</strong> {context?.modelDisagreement??'No model comparison attached'}</p>
  </section>;
}
