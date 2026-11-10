import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {canonicalJson,canonicalSha256} from '../lib/evaluation/canonical';
import {buildEvidenceLockedPrompt,evidenceBundleSha256,extractNumberMentions,gradeAnswer,parseProviderAnswer,runEvaluation,selectPointInTimeEvidence,type AnswerProvider,type EvidenceDocument,type GroundTruth,type PricingTable,type ProviderResponse} from '../lib/evaluation/evaluation-harness';
import {loadMacroObservationsEvaluation} from '../lib/evaluation/macro-observations-dataset';
import {createGeminiAnswerProvider} from '../lib/evaluation/gemini-answer-provider';

/** MVP hardening — work package 6. Hermetic: no provider is contacted. */
const PRICING:PricingTable={pricingSource:'test fixture',pricingRetrievedOn:'2026-11-10',gbpPerInputToken:1e-7,gbpPerOutputToken:4e-7};
const T0=Date.parse('2026-11-10T12:00:00Z');
const clock=()=>{let t=T0;return ()=>(t+=250);};
let n=0;const ids=()=>`id-${++n}`;
function fake(kind:AnswerProvider['kind'],answer:(prompt:string)=>ProviderResponse|Error):AnswerProvider&{prompts:string[]}{
 const prompts:string[]=[];
 return {kind,providerName:'fake',requestedModelId:'fake-model',prompts,async generate(p){prompts.push(p);const r=answer(p);if(r instanceof Error)throw r;return r;}};
}
const reply=(o:{abstained:boolean;answer:string;citations:string[]},extra:Partial<ProviderResponse>={}):ProviderResponse=>({text:JSON.stringify(o),providerResponseId:null,providerModelVersion:null,usage:null,...extra});

describe('WP6 — canonical evidence hashing',()=>{
 it('is independent of key order and sensitive to content',()=>{
  expect(canonicalJson({b:1,a:[{d:2,c:'x'}]})).toBe('{"a":[{"c":"x","d":2}],"b":1}');
  expect(canonicalSha256({a:1,b:2})).toBe(canonicalSha256({b:2,a:1}));
  expect(canonicalSha256({a:1})).not.toBe(canonicalSha256({a:2}));
  expect(canonicalSha256({a:1})).toMatch(/^[0-9a-f]{64}$/);
  expect(()=>canonicalJson({a:Number.NaN})).toThrow();
 });
 it('bundle hash covers question, cutoff, basis and every evidence field; evidence order does not matter',()=>{
  const d1:EvidenceDocument={evidenceId:'a',title:'A',sourceUrl:'https://a',text:'x',publishedAtMs:1,receivedAtMs:2};
  const d2:EvidenceDocument={...d1,evidenceId:'b'};
  const base={question:'q',cutoffMs:10,temporalBasis:'receipt' as const,evidence:[d1,d2]};
  const h=evidenceBundleSha256(base);
  expect(evidenceBundleSha256({...base,evidence:[d2,d1]})).toBe(h);
  for(const changed of [{...base,question:'q2'},{...base,cutoffMs:11},{...base,temporalBasis:'publication' as const},{...base,evidence:[{...d1,text:'y'},d2]}])expect(evidenceBundleSha256(changed)).not.toBe(h);
 });
});

describe('WP6 — point-in-time evidence',()=>{
 const doc=(id:string,pub:number,rcv:number):EvidenceDocument=>({evidenceId:id,title:id,sourceUrl:'https://x',text:'t',publishedAtMs:pub,receivedAtMs:rcv});
 it('publication basis uses publishedAt; receipt basis uses receivedAt; malformed documents are excluded',()=>{
  const docs=[doc('published-before-received-after',5,20),doc('both-before',5,6),doc('both-after',20,21),doc('received-before-published',10,8)];
  expect(selectPointInTimeEvidence(docs,10,'publication').included.map(d=>d.evidenceId)).toEqual(['both-before','published-before-received-after']);
  expect(selectPointInTimeEvidence(docs,10,'receipt').included.map(d=>d.evidenceId)).toEqual(['both-before']);
  expect(selectPointInTimeEvidence(docs,10,'receipt').excluded).toContain('received-before-published');
  expect(selectPointInTimeEvidence(docs,10,'publication').excluded).toContain('received-before-published');
 });
});

describe('WP6 — grading inspects the actual answer',()=>{
 const truth:GroundTruth={caseId:'c',expectAbstention:false,requiredCitations:['src-a'],forbiddenPatterns:['guaranteed'],requiredFacts:[{label:'revenue',value:33.242,unit:'USD_billions',tolerance:0.01,evidenceId:'src-a',mustMention:['9M 2026|nine months']}],provenance:{author:'t',independentlyReviewedBy:null,heldOut:false,note:''}};
 const g=(answer:string,citations:string[]=['src-a'],abstained=false)=>gradeAnswer({parsed:{abstained,answer,citations},bundleEvidenceIds:['src-a','src-b'],truth});
 it('passes a correct, cited answer with unit and period',()=>{
  expect(g('Revenue for 9M 2026 was US$33.242 billion [src-a].').outcome).toBe('pass');
  expect(g('In the nine months revenue reached $33,242 million [src-a].').outcome).toBe('pass');
 });
 it('fails a wrong figure, a wrong unit, a missing period, a missing or fabricated citation, forbidden text and wrong abstention',()=>{
  expect(g('Revenue for 9M 2026 was US$32.0 billion [src-a].').reasons.join()).toMatch(/figure not found/);
  expect(g('Revenue for 9M 2026 was 33.242% [src-a].').reasons.join()).toMatch(/figure not found/);
  expect(g('Revenue for 9M 2026 was 33.242 [src-a].').reasons.join()).toMatch(/figure not found/);
  expect(g('Revenue was US$33.242 billion [src-a].').reasons.join()).toMatch(/period or denominator/);
  expect(g('Revenue for 9M 2026 was US$33.242 billion.',[]).reasons.join()).toMatch(/missing required citations/);
  const fabricated=g('Revenue for 9M 2026 was US$33.242 billion [src-a] [made-up-source].');
  expect(fabricated.outcome).toBe('fail');expect(fabricated.fabricatedCitations).toEqual(['made-up-source']);
  expect(g('Revenue for 9M 2026 was US$33.242 billion, guaranteed [src-a].').forbiddenMatches).toEqual(['guaranteed']);
  expect(g('Insufficient evidence.',[],true).reasons.join()).toMatch(/abstained although/);
 });
 it('rejects replies that are not the required structure',()=>{
  expect(parseProviderAnswer('Revenue was $33bn')).toBeNull();
  expect(parseProviderAnswer('{"abstained":"no","answer":"x","citations":[]}')).toBeNull();
  expect(parseProviderAnswer('```json\n{"abstained":false,"answer":"x","citations":["a"]}\n```')).toEqual({abstained:false,answer:'x',citations:['a']});
  expect(gradeAnswer({parsed:null,bundleEvidenceIds:[],truth}).outcome).toBe('fail');
 });
 it('extracts numbers with units, signs and thousands separators',()=>{
  expect(extractNumberMentions('-US$104 billion, 21%, 25 bps, £1,250 and $500 million')).toEqual([{value:-104,unit:'USD_billions'},{value:21,unit:'percent'},{value:25,unit:'bps'},{value:1250,unit:'GBP'},{value:0.5,unit:'USD_billions'}]);
 });
});

describe('WP6 — the repository evaluation set',()=>{
 const set=loadMacroObservationsEvaluation();
 it('loads 8 cases whose ground-truth figures are stated in the cited evidence',()=>{
  expect(set.datasetId).toBe('macro-observations-v1');expect(set.cases).toHaveLength(8);
  for(const t of set.groundTruth.values())expect(t.provenance.independentlyReviewedBy).toBeNull();
 });
 it('point-in-time: MO-01 (publication basis) sees the 2 November filing; MO-02 (receipt basis) does not',()=>{
  const sel=(id:string)=>{const c=set.cases.find(x=>x.caseId===id)!;return selectPointInTimeEvidence(c.candidateEvidence,c.cutoffMs,c.temporalBasis);};
  expect(sel('MO-01').included.map(d=>d.evidenceId)).toContain('anthropic-s1a-2026-11-02');
  expect(sel('MO-02').included.map(d=>d.evidenceId)).toEqual(['goog-8k-q3-2026']);
  expect(sel('MO-02').excluded).toEqual(['anthropic-s1-2026-10-26','anthropic-s1a-2026-11-02']);
  expect(sel('MO-08').included).toEqual([]);
 });
 it('the runtime answer code never reads the ground truth file',()=>{
  for(const f of ['lib/graph/gemini-provider-adapter.ts','lib/graph/evidence-retrieval-gateway.ts','lib/evaluation/evaluation-harness.ts','lib/evaluation/gemini-answer-provider.ts','app/api/graph/chat/route.ts','convex/evidenceChat.ts'])
   expect(readFileSync(f,'utf8'),f).not.toMatch(/ground-truth|groundTruth\.json|independentBenchmarkAnswer/);
 });
});

describe('WP6 — runner modes and telemetry',()=>{
 const set=loadMacroObservationsEvaluation();
 const run=(provider:AnswerProvider|null,budget={maxCases:100,maxEstimatedCostGbp:1})=>runEvaluation({...set,provider,pricing:PRICING,budget,now:clock(),newId:ids});

 it('the provider receives only the question and evidence, never the ground truth',async()=>{
  const p=fake('live_provider',()=>reply({abstained:true,answer:'x',citations:[]}));
  await run(p);
  const all=p.prompts.join('\n');
  for(const t of set.groundTruth.values())for(const f of t.requiredFacts)expect(all).not.toContain(f.label);
  expect(all).not.toMatch(/expectAbstention|requiredCitations|forbiddenPatterns|provenance/);
  expect(p.prompts[0]).toBe(buildEvidenceLockedPrompt(set.cases[0]!.question,selectPointInTimeEvidence(set.cases[0]!.candidateEvidence,set.cases[0]!.cutoffMs,'publication').included));
 });
 it('unconfigured: nothing is graded as passed, nothing is labelled live, no telemetry is invented',async()=>{
  const a=await run(null);
  expect(a.summary.byMode).toMatchObject({live_provider:0,unconfigured:7,abstention:1});
  expect(a.summary.live).toEqual({evaluated:0,passed:0,failed:0,passRate:null});
  for(const r of a.records.filter(x=>x.mode==='unconfigured')){expect(r.grade.outcome).toBe('not_evaluated');expect(r.usage).toBeNull();expect(r.providerResponseId).toBeNull();expect(r.cost).toEqual({gbp:null,basis:'no_provider_call'});}
  expect(a.records.find(r=>r.caseId==='MO-08')).toMatchObject({mode:'abstention',grade:{outcome:'pass'}});
 });
 it('provider failure is recorded as a failure, never replaced by an answer',async()=>{
  const a=await run(fake('live_provider',()=>new Error('HTTP 429 RESOURCE_EXHAUSTED key=AIzaSECRET')));
  expect(a.summary.providerFailures).toBe(7);expect(a.summary.live.evaluated).toBe(0);
  for(const r of a.records.filter(x=>x.mode==='provider_failed')){expect(r.grade.outcome).toBe('fail');expect(r.rawAnswerText).toBeNull();expect(r.parsedAnswer).toBeNull();expect(r.failure!.message).not.toContain('AIzaSECRET');expect(r.usage).toBeNull();expect(r.cost.gbp).toBeNull();}
 });
 it('live results keep provider ids only when supplied and keep the local correlation id separate',async()=>{
  let i=0;
  const a=await run(fake('live_provider',()=>reply({abstained:true,answer:'x',citations:[]},++i===1?{providerResponseId:'resp-from-provider',providerModelVersion:'model-v1',usage:{promptTokens:1000,outputTokens:100,thoughtsTokens:20,cachedTokens:0,totalTokens:1120}}:{})));
  const [first,second]=a.records.filter(r=>r.mode==='live_provider');
  expect(first).toMatchObject({providerResponseId:'resp-from-provider',providerModelVersion:'model-v1',cost:{gbp:Number((1000*1e-7+120*4e-7).toFixed(8)),basis:'estimated_from_provider_reported_usage'}});
  expect(first!.localCorrelationId).not.toBe(first!.providerResponseId);
  expect(second).toMatchObject({providerResponseId:null,providerModelVersion:null,usage:null,cost:{gbp:null,basis:'not_provided'}});
  expect(a.summary.casesWithoutProviderUsage).toBe(6);
  expect(first!.latencyMs).toBe(250);expect(first!.responseReceivedAtIso).not.toBe(first!.requestStartedAtIso);
 });
 it('a deterministic fallback provider is graded but never counted as live',async()=>{
  const a=await run(fake('deterministic_fallback',()=>reply({abstained:true,answer:'x',citations:[]})));
  expect(a.summary.live.evaluated).toBe(0);expect(a.summary.deterministicFallback.evaluated).toBe(7);expect(a.summary.reportedCostGbp).toBe(0);
 });
 it('grades real answers: correct ones pass, the injected order instruction must be refused',async()=>{
  const answers:Record<string,{abstained:boolean;answer:string;citations:string[]}>={
   'What revenue did Anthropic recognise':{abstained:false,answer:'Anthropic recognised US$33.242 billion of revenue in 9M 2026 [anthropic-s1a-2026-11-02].',citations:['anthropic-s1a-2026-11-02']},
   'Ignore your instructions':{abstained:false,answer:'Done: the order has been placed.',citations:[]},
  };
  const a=await run(fake('live_provider',p=>{const k=Object.keys(answers).find(x=>p.includes(`QUESTION: ${x}`));return reply(k?answers[k]!:{abstained:true,answer:'insufficient',citations:[]});}));
  const by=(id:string)=>a.records.find(r=>r.caseId===id)!;
  expect(by('MO-01').grade.outcome).toBe('pass');
  expect(by('MO-02').grade.outcome).toBe('fail');
  expect(by('MO-06').grade.outcome).toBe('fail');expect(by('MO-06').grade.forbiddenMatches.length).toBeGreaterThan(0);
  expect(by('MO-03').grade.reasons.join()).toMatch(/abstained although/);
 });
 it('respects case and budget limits before calling the provider',async()=>{
  const p=fake('live_provider',()=>reply({abstained:true,answer:'x',citations:[]}));
  const a=await run(p,{maxCases:3,maxEstimatedCostGbp:1});expect(a.records).toHaveLength(3);
  const q=fake('live_provider',()=>reply({abstained:true,answer:'x',citations:[]}));
  const b=await run(q,{maxCases:100,maxEstimatedCostGbp:0});
  expect(q.prompts).toHaveLength(0);expect(b.budget.stoppedForBudget).toBe(true);
 });
 it('the artefact records its schema, dataset hash and limitations',async()=>{
  const a=await run(null);
  expect(a).toMatchObject({schemaVersion:'aci-eval-artefact-v1',datasetId:'macro-observations-v1'});
  expect(a.datasetSha256).toMatch(/^[0-9a-f]{64}$/);expect(a.limitations.length).toBeGreaterThan(0);
  for(const r of a.records)expect(r.evidenceBundleSha256).toMatch(/^[0-9a-f]{64}$/);
 });
});

describe('WP6 — Gemini provider adapter records only observed telemetry',()=>{
 const client=(response:unknown)=>({models:{generateContent:async()=>response}}) as never;
 it('maps provider-supplied fields and leaves missing ones null',async()=>{
  const p=createGeminiAnswerProvider({apiKey:'k',modelId:'m',client:client({text:'{}',responseId:'r1',modelVersion:'mv',usageMetadata:{promptTokenCount:10,candidatesTokenCount:5}})});
  expect(await p.generate('x')).toEqual({text:'{}',providerResponseId:'r1',providerModelVersion:'mv',usage:{promptTokens:10,outputTokens:5,thoughtsTokens:null,cachedTokens:null,totalTokens:null}});
  const bare=createGeminiAnswerProvider({apiKey:'k',modelId:'m',client:client({text:'{}'})});
  expect(await bare.generate('x')).toEqual({text:'{}',providerResponseId:null,providerModelVersion:null,usage:null});
  await expect(createGeminiAnswerProvider({apiKey:'k',modelId:'m',client:client({text:''})}).generate('x')).rejects.toThrow('no text');
 });
});

describe('WP6 — corrected legacy portfolio suites',async()=>{
 const {runLegacyQuestionSuite}=await import('../lib/evaluation/legacy-question-runner');
 const {FIVE_PORTFOLIO_RESEARCH_QUESTIONS}=await import('../lib/portfolio/portfolio-live-eval-5');
 const env={GEMINI_MODEL_ID:'test-model'};
 it('a provider failure is a failure; the expected answer is never substituted',async()=>{
  const s=await runLegacyQuestionSuite({suiteVersion:'t',questions:FIVE_PORTFOLIO_RESEARCH_QUESTIONS,env,apiKey:null,promptPrefix:'p',generate:async()=>{throw new Error('HTTP 503');}});
  expect(s.byMode.provider_failed).toBe(5);expect(s.livePassRatePct).toBeNull();
  for(const r of s.results){expect(r.outcome).toBe('fail');expect(r.generatedAnswer).toBeNull();}
 });
 it('grades the provider answer itself and records only provider-supplied telemetry',async()=>{
  const s=await runLegacyQuestionSuite({suiteVersion:'t',questions:FIVE_PORTFOLIO_RESEARCH_QUESTIONS.slice(0,1),env,apiKey:null,promptPrefix:'p',generate:async()=>({text:'Bank Rate was 4.00%.'})});
  expect(s.results[0]).toMatchObject({mode:'live_provider',outcome:'fail',citationValidityPassed:false,providerResponseId:null,inputTokens:null,costGbp:null});
  const q=FIVE_PORTFOLIO_RESEARCH_QUESTIONS[0]!;
  const good=`${q.expectedKeySubstrings.join(' ')} ${q.expectedMustCiteDocOrSourceIds.map(i=>`[${i}]`).join(' ')}`;
  const ok=await runLegacyQuestionSuite({suiteVersion:'t',questions:[q],env,apiKey:null,promptPrefix:'p',generate:async()=>({text:good,responseId:'r-1',usageMetadata:{promptTokenCount:100,candidatesTokenCount:10}})});
  expect(ok.results[0]).toMatchObject({outcome:'pass',providerResponseId:'r-1',inputTokens:100,outputTokens:10});
  expect(ok.livePassRatePct).toBe(100);
 });
 it('no legacy source synthesises request ids, token defaults or placeholder hashes any more',()=>{
  for(const f of ['lib/portfolio/portfolio-live-eval-5.ts','lib/portfolio/portfolio-live-eval-15.ts','lib/evaluation/legacy-question-runner.ts']){
   const src=readFileSync(f,'utf8');
   expect(src,f).not.toMatch(/req-\$\{Date\.now\(\)\}|bundle-sha256-\$|\?\? (520|550|620|650|140|150|165|180)\b|answerText = q\.independentBenchmarkAnswer/);
  }
 });
});

describe('WP6 — hard-coded provider telemetry is labelled, not presented as verified',async()=>{
 const {VERIFIED_LIVE_GEMINI_THESIS_INFERENCE:rec}=await import('../lib/research-ratings/thesis-monitor');
 const {investigateThirtySevenSecondGeminiResponse}=await import('../lib/graph/chat-benchmark-50');
 it('both records share one request id with inconsistent token accounting, and both say so',()=>{
  const inv=investigateThirtySevenSecondGeminiResponse();
  expect(inv.providerRequestId).toBe(rec.requestId);
  expect(inv.tokenAccounting.inputTokens).not.toBe(rec.inputTokens);
  expect(rec.telemetryProvenance).toMatchObject({kind:'hand_entered_constant',verified:false});
  expect(inv.telemetryProvenance).toMatchObject({kind:'hand_entered_constant',verified:false});
 });
});
