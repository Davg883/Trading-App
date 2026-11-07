export type ReviewContext={thesis:string;supportingEvidence:string[];challengingEvidence:string[];valuationRisks:string[];financialRisks:string[];dataFreshness:string;uncertainty:string;modelDisagreement:string;suggestedNotionalGbp:number|null;plannedLossGbp:number|null;stopPriceUsd:number|null;portfolioExposureGbp:number|null};
export function validateReviewContext(context:ReviewContext){
  if([context.thesis,context.dataFreshness,context.uncertainty,context.modelDisagreement].some(s=>!s.trim()||s.length>4000))throw new Error('Thesis, freshness, uncertainty and disagreement descriptions required');
  for(const values of [context.supportingEvidence,context.challengingEvidence,context.valuationRisks,context.financialRisks])if(!values.length||values.length>30||values.some(s=>!s.trim()||s.length>4000))throw new Error('Supporting and challenging evidence and risk descriptions required');
  for(const n of [context.suggestedNotionalGbp,context.plannedLossGbp,context.stopPriceUsd,context.portfolioExposureGbp])if(n!==null&&(!Number.isFinite(n)||n<0))throw new Error('Review amounts must be finite and nonnegative');
  if((context.stopPriceUsd===null)!==(context.plannedLossGbp===null))throw new Error('A stop requires a defined planned loss; otherwise both must be unavailable');
  if(context.stopPriceUsd===0||context.suggestedNotionalGbp===0)throw new Error('Stop and suggested allocation must be positive when provided');
  return context;
}
