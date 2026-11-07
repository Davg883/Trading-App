import {
 APPROVED_RESEARCH_UNIVERSE,
 PRIMARY_AUTHORITATIVE_DOMAINS,
 stagedCandidateItemSchema,
 type StagedCandidateItem,
 type StagedClaim,
 type StagingValidationStatus,
} from './contracts';

const SHA256_K=new Uint32Array([
 0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
 0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
 0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
 0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
 0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
 0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
 0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
 0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);

function rotr(n:number,x:number):number{
 return (x>>>n)|(x<<(32-n));
}

/** Pure FIPS 180-4 SHA-256 (runs identically in Convex V8 isolate and Node.js without `node:crypto`). */
export function sha256Hex(input:string):string{
 const bytes=new TextEncoder().encode(input);
 const bitLen=bytes.length*8;
 const padLen=(((bytes.length+8)>>6)+1)<<6;
 const buf=new Uint8Array(padLen);
 buf.set(bytes);
 buf[bytes.length]=0x80;
 const view=new DataView(buf.buffer);
 view.setUint32(padLen-8,Math.floor(bitLen/0x100000000),false);
 view.setUint32(padLen-4,bitLen>>>0,false);

 let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a;
 let h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
 const w=new Uint32Array(64);

 for(let i=0;i<padLen;i+=64){
  for(let t=0;t<16;t++)w[t]=view.getUint32(i+t*4,false);
  for(let t=16;t<64;t++){
   const s0=rotr(7,w[t-15])^rotr(18,w[t-15])^(w[t-15]>>>3);
   const s1=rotr(17,w[t-2])^rotr(19,w[t-2])^(w[t-2]>>>10);
   w[t]=(w[t-16]+s0+w[t-7]+s1)>>>0;
  }
  let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
  for(let t=0;t<64;t++){
   const S1=rotr(6,e)^rotr(11,e)^rotr(25,e);
   const ch=(e&f)^(~e&g);
   const temp1=(h+S1+ch+SHA256_K[t]+w[t])>>>0;
   const S0=rotr(2,a)^rotr(13,a)^rotr(22,a);
   const maj=(a&b)^(a&c)^(b&c);
   const temp2=(S0+maj)>>>0;
   h=g;g=f;f=e;e=(d+temp1)>>>0;d=c;c=b;b=a;a=(temp1+temp2)>>>0;
  }
  h0=(h0+a)>>>0;h1=(h1+b)>>>0;h2=(h2+c)>>>0;h3=(h3+d)>>>0;
  h4=(h4+e)>>>0;h5=(h5+f)>>>0;h6=(h6+g)>>>0;h7=(h7+h)>>>0;
 }
 return [h0,h1,h2,h3,h4,h5,h6,h7].map(v=>v.toString(16).padStart(8,'0')).join('');
}

/**
 * Security & independent evidence validator (Sections 3, 4, 5, 9 & Phase 003.1).
 *
 * Rules enforced before any staged item can enter the research store or promote to `evidence`:
 * 1. Untrusted webpages and retrieved articles are treated strictly as data, never instructions.
 *    Prompt-injection, privilege-escalation, credential-probe or trade-execution directives quarantine the item.
 * 2. AI agents must never generate authoritative market prices or replace source-backed financial calculations.
 * 3. Trusted timestamp enforcement (Phase 003.1 Section 2):
 *    - The staging server assigns the authoritative receipt timestamp (`serverReceivedAt = context.now`) and `importedAt = context.now`.
 *    - Any agent-supplied `receivedAt` is retained strictly as `untrustedAgentMetadata.agentReportedReceivedAt` (`sourceRetrievedAt`)
 *      and can never backdate `receivedAt` on promoted evidence or establish forward experiment eligibility.
 *    - Publication time (`publishedAt`) must be `<= agentReportedReceivedAt <= serverReceivedAt`.
 * 4. Duplicate articles (by canonical URL or content SHA-256) and duplicate financial facts are de-duplicated idempotently.
 * 5. Only `observed` or `reported` claims backed by an authoritative primary source promote to `evidence`;
 *    `estimated`, `proposed`, `unverified` or secondary-media claims remain `pending_verification`.
 * 6. All agent-staged records have `marketOutcomeEligible: false` and `executionAuthority: 'none'`.
 */

const INJECTION_PATTERNS:readonly {code:string;pattern:RegExp}[]=[
 {code:'instruction_override',pattern:/\b(ignore|disregard|override|bypass|forget)\s+(all\s+|prior\s+|previous\s+|system\s+|safety\s+)*(instructions|rules|constraints|guardrails|prompts|permissions|controls)\b/i},
 {code:'system_prompt_spoof',pattern:/(\bsystem\s*prompt\b|\byou\s+are\s+now\b|\bact\s+as\s+(an?\s+)?(admin|reviewer|operator|broker|trader)\b|<\|im_start\|>|\[SYSTEM\]|###\s*Instruction)/i},
 {code:'privilege_escalation',pattern:/\b(grantRoleInternal|assignReviewer|grant\s+reviewer|grant\s+administrator|actorType\s*[:=]\s*['"]?human)\b/i},
 {code:'trading_control_tamper',pattern:/\b(LIVE_TRADING_ENABLED|DEMO_TRADING_ENABLED|liveKillSwitchEngaged|release\s+(the\s+)?(emergency|kill)\s+switch|submit\s+live\s+order|place_order|equity\/orders)\b/i},
 {code:'credential_exfiltration',pattern:/\b(BROKER_VAULT_KEY|CONVEX_BROKER_ADMIN_KEY|CLERK_SECRET_KEY|TRADING212_API|decryptCredentials|getVaultInternal)\b/i},
 {code:'script_injection',pattern:/(<\s*script\b|javascript\s*:|data\s*:\s*text\/html|on(?:error|load|click)\s*=)/i},
];

const FORBIDDEN_AI_PRICE_METRICS=new Set([
 'price','stock_price','share_price','close','close_price','last_price','quote','live_quote','intraday_price','vwap','nav','index_level',
]);

const COVERED_SET=new Set<string>(APPROVED_RESEARCH_UNIVERSE.map(u=>u.ticker));

export function canonicalizeSourceUrl(rawUrl:string):{canonicalUrl:string;domain:string}{
 const parsed=new URL(rawUrl);
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hash){
  throw new Error('An HTTPS URL without credentials or fragments is required');
 }
 const domain=parsed.hostname.toLowerCase();
 const dropParams=['utm_source','utm_medium','utm_campaign','utm_term','utm_content','fbclid','gclid'];
 for(const p of dropParams)parsed.searchParams.delete(p);
 parsed.searchParams.sort();
 const cleanPath=parsed.pathname.replace(/\/+$/,'')||'/';
 return {canonicalUrl:`https://${domain}${cleanPath}${parsed.search}`,domain};
}

export function isAuthoritativePrimaryDomain(domain:string):boolean{
 const clean=domain.toLowerCase();
 if(PRIMARY_AUTHORITATIVE_DOMAINS.has(clean))return true;
 for(const d of PRIMARY_AUTHORITATIVE_DOMAINS){
  if(clean.endsWith(`.${d}`))return true;
 }
 return false;
}

export function contentSha256(canonicalUrl:string,title:string,text:string):string{
 return sha256Hex(`${canonicalUrl}\n${title.trim()}\n${text.trim()}`);
}

export function factDedupeKey(claim:{entity:string;metric:string;period:string;value:number;unit:string}):string{
 const normMetric=claim.metric.trim().toLowerCase().replace(/[\s-]+/g,'_');
 const normPeriod=claim.period.trim().toUpperCase();
 const normUnit=claim.unit.trim().toUpperCase();
 return `${claim.entity.toUpperCase()}|${normMetric}|${normPeriod}|${claim.value}|${normUnit}`;
}

export function detectPromptInjection(texts:readonly (string|undefined|null)[]):{detected:boolean;codes:string[]}{
 const codes=new Set<string>();
 for(const raw of texts){
  if(!raw)continue;
  for(const rule of INJECTION_PATTERNS){
   if(rule.pattern.test(raw))codes.add(rule.code);
  }
 }
 return {detected:codes.size>0,codes:[...codes]};
}

export type UntrustedAgentTimestampMetadata={
 agentReportedReceivedAt:number;
 agentReportedPublishedAt:number|null;
 agentClockSkewMs:number;
 forwardEligibilityTrusted:false;
};

export type PromotableEvidenceFact={
 source:string;
 symbol:string;
 metric:string;
 value:number;
 unit:string;
 period:string;
 definition:string;
 status:'reported'|'measured';
 publishedAt:number;
 receivedAt:number;
 serverReceivedAt:number;
 sourceRetrievedAt:number;
 importedAt:number;
 factKey:string;
};

export type ValidatedStagedItemResult={
 externalId:string;
 canonicalUrl:string;
 sourceDomain:string;
 title:string;
 contentSha256:string;
 publishedAt:number|null;
 receivedAt:number;
 serverReceivedAt:number;
 sourceRetrievedAt:number;
 importedAt:number;
 untrustedAgentMetadata:UntrustedAgentTimestampMetadata;
 entities:string[];
 summary:string;
 hypothesis?:string;
 isPrimarySource:boolean;
 primarySourceUrl:string|null;
 validationStatus:StagingValidationStatus;
 validationReasons:string[];
 researchEligible:boolean;
 marketOutcomeEligible:false;
 executionAuthority:'none';
 acceptedClaims:StagedClaim[];
 promotableFacts:PromotableEvidenceFact[];
 duplicateFactCount:number;
};

export function validateStagedItem(
 rawItem:unknown,
 context:{
  now:number;
  seenUrls:Set<string>;
  seenContentHashes:Set<string>;
  seenFactKeys:Set<string>;
 },
):ValidatedStagedItemResult{
 const item:StagedCandidateItem=stagedCandidateItemSchema.parse(rawItem);
 const {canonicalUrl,domain}=canonicalizeSourceUrl(item.sourceUrl);
 const hash=contentSha256(canonicalUrl,item.title,item.text);
 const reasons:string[]=[];
 const serverReceivedAt=context.now;
 const sourceRetrievedAt=item.receivedAt;
 const importedAt=context.now;
 const untrustedAgentMetadata:UntrustedAgentTimestampMetadata={
  agentReportedReceivedAt:sourceRetrievedAt,
  agentReportedPublishedAt:item.publishedAt,
  agentClockSkewMs:serverReceivedAt-sourceRetrievedAt,
  forwardEligibilityTrusted:false,
 };

 // 1. Timestamp integrity: agent retrieval timestamp cannot be in the future of server receipt, and cannot precede publication.
 if(item.receivedAt>serverReceivedAt){
  throw new Error(`Future receipt timestamp rejected (${item.receivedAt} > ${serverReceivedAt})`);
 }
 if(item.publishedAt!==null&&item.publishedAt>item.receivedAt){
  throw new Error(`Receipt precedes publication (${item.receivedAt} < ${item.publishedAt})`);
 }
 if(item.publishedAt!==null&&item.publishedAt>serverReceivedAt){
  throw new Error(`Publication timestamp in the future of server receipt (${item.publishedAt} > ${serverReceivedAt})`);
 }

 // 2. Prompt injection guard across all text fields.
 const injection=detectPromptInjection([
  item.title,
  item.text,
  item.summary,
  item.hypothesis,
  ...item.claims.flatMap(c=>[c.metric,c.definition,c.excerpt]),
 ]);
 if(injection.detected){
  return {
   externalId:item.externalId,
   canonicalUrl,
   sourceDomain:domain,
   title:item.title.trim(),
   contentSha256:hash,
   publishedAt:item.publishedAt,
   receivedAt:serverReceivedAt,
   serverReceivedAt,
   sourceRetrievedAt,
   importedAt,
   untrustedAgentMetadata,
   entities:item.entities.filter(e=>COVERED_SET.has(e)),
   summary:'[Quarantined: untrusted source content contained instruction-override or restricted patterns]',
   hypothesis:undefined,
   isPrimarySource:false,
   primarySourceUrl:null,
   validationStatus:'quarantined_injection',
   validationReasons:injection.codes.map(c=>`prompt_injection:${c}`),
   researchEligible:false,
   marketOutcomeEligible:false,
   executionAuthority:'none',
   acceptedClaims:[],
   promotableFacts:[],
   duplicateFactCount:0,
  };
 }

 // 3. De-duplication by canonical URL or content SHA-256.
 if(context.seenUrls.has(canonicalUrl)||context.seenContentHashes.has(hash)){
  return {
   externalId:item.externalId,
   canonicalUrl,
   sourceDomain:domain,
   title:item.title.trim(),
   contentSha256:hash,
   publishedAt:item.publishedAt,
   receivedAt:serverReceivedAt,
   serverReceivedAt,
   sourceRetrievedAt,
   importedAt,
   untrustedAgentMetadata,
   entities:item.entities.filter(e=>COVERED_SET.has(e)),
   summary:item.summary.trim(),
   hypothesis:item.hypothesis?.trim(),
   isPrimarySource:isAuthoritativePrimaryDomain(domain),
   primarySourceUrl:item.primarySourceUrl??null,
   validationStatus:'duplicate',
   validationReasons:['duplicate_article_or_content_hash'],
   researchEligible:false,
   marketOutcomeEligible:false,
   executionAuthority:'none',
   acceptedClaims:[],
   promotableFacts:[],
   duplicateFactCount:0,
  };
 }

 // 4. Universe check.
 const coveredEntities=[...new Set(item.entities.map(e=>e.toUpperCase()).filter(e=>COVERED_SET.has(e)))];
 if(coveredEntities.length===0){
  return {
   externalId:item.externalId,
   canonicalUrl,
   sourceDomain:domain,
   title:item.title.trim(),
   contentSha256:hash,
   publishedAt:item.publishedAt,
   receivedAt:serverReceivedAt,
   serverReceivedAt,
   sourceRetrievedAt,
   importedAt,
   untrustedAgentMetadata,
   entities:[],
   summary:item.summary.trim(),
   hypothesis:item.hypothesis?.trim(),
   isPrimarySource:false,
   primarySourceUrl:null,
   validationStatus:'rejected',
   validationReasons:['outside_approved_universe'],
   researchEligible:false,
   marketOutcomeEligible:false,
   executionAuthority:'none',
   acceptedClaims:[],
   promotableFacts:[],
   duplicateFactCount:0,
  };
 }

 const sourceIsPrimary=isAuthoritativePrimaryDomain(domain);
 let primaryUrl:string|null=sourceIsPrimary?canonicalUrl:null;
 if(!primaryUrl&&item.primarySourceUrl){
  const parsedPrimary=canonicalizeSourceUrl(item.primarySourceUrl);
  if(isAuthoritativePrimaryDomain(parsedPrimary.domain))primaryUrl=parsedPrimary.canonicalUrl;
 }

 const acceptedClaims:StagedClaim[]=[];
 const promotableFacts:PromotableEvidenceFact[]=[];
 let duplicateFactCount=0;

 for(const claim of item.claims){
  const normMetric=claim.metric.trim().toLowerCase().replace(/[\s-]+/g,'_');
  if(FORBIDDEN_AI_PRICE_METRICS.has(normMetric)){
   reasons.push(`rejected_ai_price_claim:${claim.id}`);
   continue;
  }
  const ticker=claim.entity.toUpperCase();
  if(!COVERED_SET.has(ticker)){
   reasons.push(`unapproved_entity:${ticker}`);
   continue;
  }
  let claimPrimaryUrl:string|null=sourceIsPrimary?canonicalUrl:null;
  if(!claimPrimaryUrl&&claim.primarySourceUrl){
   const parsedClaimPrimary=canonicalizeSourceUrl(claim.primarySourceUrl);
   if(isAuthoritativePrimaryDomain(parsedClaimPrimary.domain)){
    claimPrimaryUrl=parsedClaimPrimary.canonicalUrl;
   }
  }
  const verifiedPrimary=Boolean(claimPrimaryUrl)&&claim.isPrimarySource;
  const normalizedClaim:StagedClaim={
   ...claim,
   entity:ticker,
   isPrimarySource:verifiedPrimary,
   primarySourceUrl:claimPrimaryUrl,
  };
  acceptedClaims.push(normalizedClaim);

  // Promotion rule: only `observed` or `reported` claims backed by an authoritative primary source and a known publication time can promote to `evidence`.
  // Authoritative `receivedAt` on promoted evidence is ALWAYS `serverReceivedAt`, never the agent-reported timestamp.
  if((claim.classification==='observed'||claim.classification==='reported')&&verifiedPrimary&&item.publishedAt!==null){
   const fKey=factDedupeKey(normalizedClaim);
   if(context.seenFactKeys.has(fKey)){
    duplicateFactCount+=1;
    reasons.push(`duplicate_fact_skipped:${claim.id}`);
   }else{
    context.seenFactKeys.add(fKey);
    promotableFacts.push({
     source:claimPrimaryUrl!,
     symbol:ticker,
     metric:claim.metric.trim(),
     value:claim.value,
     unit:claim.unit.trim(),
     period:claim.period.trim(),
     definition:claim.definition.trim(),
     status:claim.classification==='observed'?'measured':'reported',
     publishedAt:item.publishedAt,
     receivedAt:serverReceivedAt,
     serverReceivedAt,
     sourceRetrievedAt,
     importedAt,
     factKey:fKey,
    });
   }
  }else{
   reasons.push(`pending_primary_verification:${claim.id}:${claim.classification}`);
  }
 }

 context.seenUrls.add(canonicalUrl);
 context.seenContentHashes.add(hash);

 if(item.claims.length>0&&acceptedClaims.length===0){
  return {
   externalId:item.externalId,
   canonicalUrl,
   sourceDomain:domain,
   title:item.title.trim(),
   contentSha256:hash,
   publishedAt:item.publishedAt,
   receivedAt:serverReceivedAt,
   serverReceivedAt,
   sourceRetrievedAt,
   importedAt,
   untrustedAgentMetadata,
   entities:coveredEntities,
   summary:item.summary.trim(),
   hypothesis:item.hypothesis?.trim(),
   isPrimarySource:sourceIsPrimary,
   primarySourceUrl:primaryUrl,
   validationStatus:'rejected',
   validationReasons:reasons.length?reasons:['no_valid_claims'],
   researchEligible:false,
   marketOutcomeEligible:false,
   executionAuthority:'none',
   acceptedClaims:[],
   promotableFacts:[],
   duplicateFactCount,
  };
 }

 const validationStatus:StagingValidationStatus=promotableFacts.length>0?'promoted':'pending_verification';
 const researchEligible=item.publishedAt!==null&&item.publishedAt<=serverReceivedAt;

 return {
  externalId:item.externalId,
  canonicalUrl,
  sourceDomain:domain,
  title:item.title.trim(),
  contentSha256:hash,
  publishedAt:item.publishedAt,
  receivedAt:serverReceivedAt,
  serverReceivedAt,
  sourceRetrievedAt,
  importedAt,
  untrustedAgentMetadata,
  entities:coveredEntities,
  summary:item.summary.trim(),
  hypothesis:item.hypothesis?.trim(),
  isPrimarySource:sourceIsPrimary||Boolean(primaryUrl),
  primarySourceUrl:primaryUrl,
  validationStatus,
  validationReasons:reasons.length?reasons:[validationStatus==='promoted'?'primary_source_verified':'awaiting_primary_source_verification'],
  researchEligible,
  marketOutcomeEligible:false,
  executionAuthority:'none',
  acceptedClaims,
  promotableFacts,
  duplicateFactCount,
 };
}

/**
 * Phase 003.1 Section 2 & Section 6:
 * Prohibits backdated forward experiment registration and prevents agent-submitted historical
 * receipt timestamps (`agentReportedReceivedAt` / `sourceRetrievedAt`) from establishing forward eligibility.
 */
export function validateForwardExperimentRegistration(input:{
 registrationCutoffAt:number;
 serverNow:number;
 evidenceItems:readonly {
  externalId:string;
  publishedAt:number|null;
  serverReceivedAt:number;
  untrustedAgentMetadata?:{agentReportedReceivedAt:number};
 }[];
}):{eligible:true;registeredAt:number;cutoffAt:number}{
 if(!Number.isFinite(input.registrationCutoffAt)||!Number.isFinite(input.serverNow)){
  throw new Error('Valid numeric timestamps are required for forward experiment registration');
 }
 if(input.registrationCutoffAt<input.serverNow){
  throw new Error(
   `Backdated forward experiment registration prohibited: registrationCutoffAt (${input.registrationCutoffAt}) precedes authoritative server time (${input.serverNow})`,
  );
 }
 for(const ev of input.evidenceItems){
  if(ev.publishedAt===null||ev.publishedAt>input.registrationCutoffAt){
   throw new Error(`Evidence ${ev.externalId} lacks a publication time at or before the forward cutoff`);
  }
  if(ev.serverReceivedAt>input.registrationCutoffAt){
   const agentClaim=ev.untrustedAgentMetadata?.agentReportedReceivedAt;
   throw new Error(
    `Agent-submitted historical receipt times cannot establish forward eligibility for ${ev.externalId}: authoritative serverReceivedAt (${ev.serverReceivedAt}) is after cutoff (${input.registrationCutoffAt})${agentClaim!==undefined?` despite untrusted agent claim (${agentClaim})`:''}`,
   );
  }
 }
 return {
  eligible:true,
  registeredAt:input.serverNow,
  cutoffAt:input.registrationCutoffAt,
 };
}
