import {describe,expect,it} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {runEvaluation} from '../../lib/evaluation/evaluation-harness';
import {loadMacroObservationsEvaluation} from '../../lib/evaluation/macro-observations-dataset';
import {createGeminiAnswerProvider,pricingFromEnv} from '../../lib/evaluation/gemini-answer-provider';

/**
 * BILLABLE live evaluation (MVP hardening WP6). Never runs in CI or in the default test run.
 * Requires ALL of:
 *   ACI_LIVE_EVAL_APPROVED=yes           explicit owner approval for a billable run
 *   ACI_LIVE_EVAL_BUDGET_GBP=<number>    hard upper bound on estimated spend (max 5)
 *   ACI_EVAL_GBP_PER_MILLION_INPUT_TOKENS / _OUTPUT_TOKENS, ACI_EVAL_PRICING_SOURCE, ACI_EVAL_PRICING_RETRIEVED_ON
 *   GEMINI_API_KEY and ACI_EVAL_MODEL_ID
 * Writes the raw artefact to evaluation-artefacts/<runId>.json (not committed automatically).
 */
const env=process.env;
const approved=env.ACI_LIVE_EVAL_APPROVED==='yes';

describe.skipIf(!approved)('Live provider evaluation (billable, owner-approved)',()=>{
 it('runs the evidence-locked evaluation within the approved budget and writes the raw artefact',async()=>{
  const budget=Number(env.ACI_LIVE_EVAL_BUDGET_GBP);
  if(!(budget>0&&budget<=5))throw new Error('ACI_LIVE_EVAL_BUDGET_GBP must be between 0 and 5');
  const pricing=pricingFromEnv(env);if(!pricing)throw new Error('A dated price table is required for a billable run');
  const apiKey=env.GEMINI_API_KEY,modelId=env.ACI_EVAL_MODEL_ID;if(!apiKey||!modelId)throw new Error('GEMINI_API_KEY and ACI_EVAL_MODEL_ID are required');
  const set=loadMacroObservationsEvaluation();
  const artefact=await runEvaluation({...set,provider:createGeminiAnswerProvider({apiKey,modelId}),pricing,budget:{maxCases:set.cases.length,maxEstimatedCostGbp:budget}});
  mkdirSync('evaluation-artefacts',{recursive:true});
  writeFileSync(`evaluation-artefacts/${artefact.runId}.json`,JSON.stringify(artefact,null,2)+'\n');
  console.log(JSON.stringify(artefact.summary,null,2));
  // The run itself is the evidence; it is not asserted to pass. Only its integrity is checked here.
  expect(artefact.summary.totalCases).toBeGreaterThan(0);
  expect(artefact.summary.reportedCostGbp).toBeLessThanOrEqual(budget);
 },600_000);
});
