import {
 APPROVED_RESEARCH_UNIVERSE,
 type ClaimClassification,
 type StagedCandidateItem,
 type StagedClaim,
 type StagedSubmissionRequest,
} from './contracts';
import {
 canonicalizeSourceUrl,
 contentSha256,
 isAuthoritativePrimaryDomain,
 sha256Hex,
 validateStagedItem,
 type ValidatedStagedItemResult,
} from './staging-validator';

/**
 * News & Disclosure Research Agent workflow (Deliverable 4, Section 4).
 *
 * Implements the 10-step research-agent pipeline:
 * 1. Read approved research universe and latest processed event cursor.
 * 2. Discover new candidate sources.
 * 3. De-duplicate previously processed articles and events.
 * 4. Extract entities, dates, claims and financial amounts.
 * 5. Classify claims as observed, reported, estimated, proposed or unverified.
 * 6. Identify authoritative primary sources.
 * 7. Submit proposed evidence to the restricted staging endpoint.
 * 8. Run independent validation before promotion into the research database.
 * 9. Record the run, sources, timestamps, model version, usage, errors and costs.
 * 10. Publish a concise result to the Agent Activity and Morning Intelligence panels.
 */

export type CandidateSourceDocument={
 externalId?:string;
 url:string;
 title:string;
 text:string;
 publishedAt:number|null;
 receivedAt:number;
 primarySourceUrl?:string|null;
 proposedHypothesis?:string;
};

const ENTITY_ALIASES:readonly {ticker:string;patterns:RegExp[]}[]=[
 {ticker:'MSFT',patterns:[/\bMSFT\b/i,/\bMicrosoft\b/i,/\bAzure\b/i]},
 {ticker:'GOOGL',patterns:[/\bGOOGL?\b/i,/\bAlphabet\b/i,/\bGoogle\s+Cloud\b/i]},
 {ticker:'AMZN',patterns:[/\bAMZN\b/i,/\bAmazon\b/i,/\bAWS\b/i]},
 {ticker:'NVDA',patterns:[/\bNVDA\b/i,/\bNVIDIA\b/i,/\bBlackwell\b/i]},
 {ticker:'CRWV',patterns:[/\bCRWV\b/i,/\bCoreWeave\b/i]},
 {ticker:'INTC',patterns:[/\bINTC\b/i,/\bIntel\b/i]},
 {ticker:'AMD',patterns:[/\bAMD\b/i,/\bAdvanced\s+Micro\s+Devices\b/i]},
 {ticker:'AVGO',patterns:[/\bAVGO\b/i,/\bBroadcom\b/i]},
 {ticker:'META',patterns:[/\bMETA\b/i,/\bMeta\s+Platforms\b/i]},
 {ticker:'ORCL',patterns:[/\bORCL\b/i,/\bOracle\b/i]},
 {ticker:'QQQ',patterns:[/\bQQQ\b/i,/\bNasdaq-100\b/i]},
];

export function extractUniverseEntities(title:string,text:string):string[]{
 const combined=`${title}\n${text}`;
 const found:string[]=[];
 for(const entry of ENTITY_ALIASES){
  if(entry.patterns.some(p=>p.test(combined)))found.push(entry.ticker);
 }
 return found;
}

export function classifyClaimExcerpt(excerpt:string,isPrimarySource:boolean):ClaimClassification{
 const lower=excerpt.toLowerCase();
 if(/\b(propose[ds]?|bill|draft\s+order|would\s+require|campaign\s+pledge|planned\s+expansion|seeking\s+approval)\b/.test(lower)){
  return 'proposed';
 }
 if(/\b(estimate[ds]?|forecast[s]?|consensus|projected|guidance|analyst[s]?\s+expect|approximate(?:ly)?)\b/.test(lower)){
  return 'estimated';
 }
 if(/\b(unverified|rumou?r|unconfirmed|anonymous\s+sources|reportedly)\b/.test(lower)){
  return 'unverified';
 }
 if(isPrimarySource&&/\b(form\s+10-[kq]|form\s+8-k|xbrl|audited|recorded|actual|balance\s+sheet|cash\s+flows|capital\s+expenditure|capex|revenue|operating\s+income)\b/.test(lower)){
  return 'observed';
 }
 if(isPrimarySource||/\b(reported|disclosed|announced|filed|stated)\b/.test(lower)){
  return 'reported';
 }
 return 'unverified';
}

function inferMetricName(excerpt:string):{metric:string;definition:string;period:string}{
 const lower=excerpt.toLowerCase();
 const periodMatch=/\b(Q[1-4]\s*202\d|FY\s*202\d|202[5-8])\b/i.exec(excerpt);
 const period=periodMatch?periodMatch[1].replace(/\s+/g,'').toUpperCase():'2026';
 if(/\b(capex|capital\s+expenditure[s]?|property\s+and\s+equipment)\b/.test(lower)){
  return {metric:'capital_expenditures',definition:'Capital expenditures / property and equipment additions',period};
 }
 if(/\b(free\s+cash\s+flow|fcf)\b/.test(lower)){
  return {metric:'free_cash_flow',definition:'Operating cash flow less capital expenditures',period};
 }
 if(/\b(operating\s+cash\s+flow)\b/.test(lower)){
  return {metric:'operating_cash_flow',definition:'Cash generated from operating activities',period};
 }
 if(/\b(backlog|remaining\s+performance\s+obligation[s]?|rpo)\b/.test(lower)){
  return {metric:'contracted_backlog',definition:'Remaining performance obligations / contracted backlog',period};
 }
 if(/\b(megawatt[s]?|mw|gigawatt[s]?|gw|power\s+capacity)\b/.test(lower)){
  return {metric:'datacentre_power_capacity',definition:'Disclosed AI datacentre power capacity',period};
 }
 if(/\b(revenue|sales)\b/.test(lower)){
  return {metric:'revenue',definition:'Reported total or segment revenue',period};
 }
 return {metric:'financial_commitment',definition:'Disclosed financial amount or infrastructure commitment',period};
}

export function extractStructuredClaims(
 doc:CandidateSourceDocument,
 entities:string[],
 isPrimary:boolean,
 primaryUrl:string|null,
):StagedClaim[]{
 const primaryEntity=entities[0]??'MSFT';
 const pattern=/(?:\$\s*|£\s*)?([−-]?\d+(?:,\d{3})*(?:\.\d+)?)\s*(billion|million|bn|mw|gw|%)/gi;
 const claims:StagedClaim[]=[];
 for(const match of doc.text.matchAll(pattern)){
  if(claims.length>=25)break;
  const rawNumber=Number(match[1].replaceAll(',','').replace('−','-'));
  if(!Number.isFinite(rawNumber))continue;
  const start=match.index??0;
  const excerpt=doc.text.slice(Math.max(0,start-80),Math.min(doc.text.length,start+match[0].length+80)).trim();
  const unitToken=match[2].toLowerCase();
  const unit=
   unitToken==='%'?'percent':
   unitToken==='million'?'millions_usd':
   unitToken==='mw'?'megawatts':
   unitToken==='gw'?'gigawatts':'billions_usd';
  const {metric,definition,period}=inferMetricName(excerpt);
  const classification=classifyClaimExcerpt(excerpt,isPrimary);
  claims.push({
   id:`claim-${start}`,
   entity:primaryEntity,
   metric,
   value:rawNumber,
   unit,
   period,
   definition,
   excerpt,
   classification,
   isPrimarySource:isPrimary,
   primarySourceUrl:primaryUrl,
  });
 }
 return claims;
}

export type ResearchAgentRunResult={
 submission:StagedSubmissionRequest;
 validationResults:ValidatedStagedItemResult[];
 summary:{
  runId:string;
  agentId:string;
  universeCount:number;
  cursorBefore:string|null;
  cursorAfter:string;
  candidatesDiscovered:number;
  duplicatesSkipped:number;
  quarantinedCount:number;
  stagedCount:number;
  promotedEvidenceCount:number;
  pendingVerificationCount:number;
  modelVersion:string;
  estimatedCostGbp:number;
  actualCostGbp:number|null;
  conciseActivitySummary:string;
 };
};

export function runNewsResearchAgentWorkflow(input:{
 runId:string;
 agentId?:string;
 environment?:'remote'|'local';
 cursorBefore:string|null;
 now:number;
 candidates:CandidateSourceDocument[];
 existingUrls?:Iterable<string>;
 existingContentHashes?:Iterable<string>;
 existingFactKeys?:Iterable<string>;
 modelVersion?:string;
 inputTokens?:number;
 outputTokens?:number;
 estimatedCostGbp?:number;
 actualCostGbp?:number|null;
}):ResearchAgentRunResult{
 const agentId=input.agentId??'antigravity-news-research-agent';
 const modelVersion=input.modelVersion??'gemini-2.5-flash-preview';
 const seenUrls=new Set<string>(input.existingUrls??[]);
 const seenHashes=new Set<string>(input.existingContentHashes??[]);
 const seenFactKeys=new Set<string>(input.existingFactKeys??[]);

 const cursorTimestamp=input.cursorBefore&&/^cursor:(\d+):/.test(input.cursorBefore)
  ?Number(/^cursor:(\d+):/.exec(input.cursorBefore)![1])
  :0;

 const stagedItems:StagedCandidateItem[]=[];
 const validationResults:ValidatedStagedItemResult[]=[];
 let duplicatesSkipped=0;
 let quarantinedCount=0;
 let promotedEvidenceCount=0;
 let pendingVerificationCount=0;
 let latestReceipt=cursorTimestamp;

 for(let idx=0;idx<input.candidates.length;idx++){
  const doc=input.candidates[idx];
  const {canonicalUrl,domain}=canonicalizeSourceUrl(doc.url);
  const hash=contentSha256(canonicalUrl,doc.title,doc.text);

  // Pre-deduplication against cursor / known URLs / content hashes.
  if(seenUrls.has(canonicalUrl)||seenHashes.has(hash)){
   duplicatesSkipped+=1;
   continue;
  }

  const entities=extractUniverseEntities(doc.title,doc.text);
  const effectiveEntities=entities.length>0?entities:['MSFT'];
  const isPrimary=isAuthoritativePrimaryDomain(domain);
  let primaryUrl:string|null=isPrimary?canonicalUrl:null;
  if(!primaryUrl&&doc.primarySourceUrl){
   const parsedPrimary=canonicalizeSourceUrl(doc.primarySourceUrl);
   if(isAuthoritativePrimaryDomain(parsedPrimary.domain))primaryUrl=parsedPrimary.canonicalUrl;
  }

  const claims=extractStructuredClaims(doc,effectiveEntities,isPrimary||Boolean(primaryUrl),primaryUrl);
  const candidateItem:StagedCandidateItem={
   externalId:doc.externalId??`staged-${hash.slice(0,16)}`,
   sourceUrl:canonicalUrl,
   title:doc.title.trim(),
   text:doc.text,
   summary:`${doc.title.trim()} (${effectiveEntities.join(', ')}; ${claims.length} structured claim(s) extracted; primary source: ${primaryUrl?'yes':'pending'}).`,
   ...(doc.proposedHypothesis?{hypothesis:doc.proposedHypothesis.trim()}:{}),
   publishedAt:doc.publishedAt,
   receivedAt:doc.receivedAt,
   entities:effectiveEntities,
   claims,
   primarySourceUrl:primaryUrl,
  };
  stagedItems.push(candidateItem);

  const validated=validateStagedItem(candidateItem,{
   now:input.now,
   seenUrls,
   seenContentHashes:seenHashes,
   seenFactKeys,
  });
  validationResults.push(validated);

  if(validated.validationStatus==='duplicate'){
   duplicatesSkipped+=1;
  }else if(validated.validationStatus==='quarantined_injection'){
   quarantinedCount+=1;
  }else if(validated.validationStatus==='promoted'){
   promotedEvidenceCount+=validated.promotableFacts.length;
  }else if(validated.validationStatus==='pending_verification'){
   pendingVerificationCount+=1;
  }
  if(doc.receivedAt>latestReceipt)latestReceipt=doc.receivedAt;
 }

 const cursorDigest=sha256Hex(`${input.cursorBefore??'init'}|${stagedItems.map(i=>i.externalId).join(',')}`).slice(0,12);
 const cursorAfter=`cursor:${Math.max(latestReceipt,input.now)}:${cursorDigest}`;
 const noNewItems=stagedItems.length===0;
 const inputTokens=input.inputTokens??(noNewItems?0:stagedItems.reduce((a,b)=>a+Math.ceil(b.text.length/4),120));
 const outputTokens=input.outputTokens??(noNewItems?0:stagedItems.length*95+60);
 const estimatedCostGbp=input.estimatedCostGbp??(noNewItems?0:Number(((inputTokens*0.00000015+outputTokens*0.0000006)*0.79).toFixed(6)));

 const submission:StagedSubmissionRequest={
  runId:input.runId,
  agentId,
  environment:input.environment??'remote',
  cursorBefore:input.cursorBefore,
  cursorAfter,
  modelVersion,
  inputTokens,
  outputTokens,
  estimatedCostGbp,
  actualCostGbp:input.actualCostGbp??null,
  items:stagedItems,
 };

 const conciseActivitySummary=
  `Processed ${input.candidates.length} candidate source(s) across ${APPROVED_RESEARCH_UNIVERSE.length} universe tickers: ` +
  `${promotedEvidenceCount} primary-source fact(s) promoted, ${pendingVerificationCount} staged for verification, ` +
  `${duplicatesSkipped} duplicate(s) skipped${quarantinedCount?`, ${quarantinedCount} prompt-injection payload(s) quarantined`:''}.`;

 return {
  submission,
  validationResults,
  summary:{
   runId:input.runId,
   agentId,
   universeCount:APPROVED_RESEARCH_UNIVERSE.length,
   cursorBefore:input.cursorBefore,
   cursorAfter,
   candidatesDiscovered:input.candidates.length,
   duplicatesSkipped,
   quarantinedCount,
   stagedCount:stagedItems.length,
   promotedEvidenceCount,
   pendingVerificationCount,
   modelVersion,
   estimatedCostGbp,
   actualCostGbp:input.actualCostGbp??null,
   conciseActivitySummary,
  },
 };
}
