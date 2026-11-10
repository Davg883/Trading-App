import {httpRouter,httpActionGeneric,makeFunctionReference} from 'convex/server';
import {
 APPROVED_RESEARCH_UNIVERSE,
 MAX_SCHEDULER_PAYLOAD_BYTES,
 MAX_STAGING_PAYLOAD_BYTES,
 stagedSubmissionRequestSchema,
} from '../lib/remote-ops/contracts';
import {parseAcceptanceToken,questionDigest,randomHex,sha256Hex} from './acceptanceNonces';
import {verifyIdentityClaims} from './authz';

const http=httpRouter();

const headers={
 'Cache-Control':'private, no-store, max-age=0',
 'Pragma':'no-cache',
 'Vary':'Authorization, X-ACI-Gateway-Authorization',
 'X-Content-Type-Options':'nosniff',
};

const FORBIDDEN_PAYLOAD_KEYS=new Set([
 'owner','apiKey','apiSecret','encryptedPayload','vaultKey','brokerOrderId','orderId',
 'liveTradingEnabled','demoTradingEnabled','liveKillSwitchEngaged','role','grantRole','assignReviewer',
]);

function hasForbiddenKeys(value:unknown,depth=0):boolean{
 if(depth>8||!value||typeof value!=='object')return false;
 if(Array.isArray(value))return value.some(v=>hasForbiddenKeys(v,depth+1));
 for(const [k,v] of Object.entries(value as Record<string,unknown>)){
  if(FORBIDDEN_PAYLOAD_KEYS.has(k))return true;
  if(hasForbiddenKeys(v,depth+1))return true;
 }
 return false;
}

function constantTimeBearerMatch(headerValue:string|null,secret:string|undefined):boolean{
 if(!secret||secret.length<32||!headerValue)return false;
 const enc=new TextEncoder();
 const a=enc.encode(headerValue);
 const b=enc.encode(`Bearer ${secret}`);
 if(a.length!==b.length)return false;
 let diff=0;
 for(let i=0;i<a.length;i++)diff|=a[i]!^b[i]!;
 return diff===0;
}

const qRef=(name:string)=>makeFunctionReference<'query'>(`operations:${name}`);
const mRef=(name:string)=>makeFunctionReference<'mutation'>(`operations:${name}`);
const aRef=(name:string)=>makeFunctionReference<'action'>(`remoteOpsCloud:${name}`);

http.route({
 path:'/api/research/staging',
 method:'GET',
 handler:httpActionGeneric(async(ctx,request)=>{
  const token=process.env.RESEARCH_STAGING_TOKEN;
  const owner=process.env.RESEARCH_OWNER_ID;
  if(!token||token.length<32||!owner){
   return Response.json({error:{code:'not_configured',message:'Cloud staging is not configured.'}},{status:503,headers});
  }
  if(!constantTimeBearerMatch(request.headers.get('authorization'),token)){
   return Response.json({error:{code:'unauthorized_staging',message:'Valid research-staging machine token required.'}},{status:401,headers});
  }
  const state=await ctx.runQuery(qRef('getStagingStateInternal'),{owner}) as {
   cursor:string|null;
   systemEnabled:boolean;
   activeEnvironment:string;
   dailyCostCeilingGbp:number;
   monthlyCostCeilingGbp:number;
   spend:{dailyEstimated:number;dailyActual:number;monthlyEstimated:number;monthlyActual:number};
   rateWindow?:unknown;
   seenUrls:string[];
   seenContentHashes:string[];
  };
  return Response.json({
   service:'convex-cloud-staging',
   universe:APPROVED_RESEARCH_UNIVERSE.map(u=>({ticker:u.ticker,name:u.name,cik:u.cik,sector:u.sector})),
   cursor:state.cursor,
   systemEnabled:state.systemEnabled,
   activeEnvironment:state.activeEnvironment,
   budgetRemainingGbp:{
    daily:Math.max(0,Number((state.dailyCostCeilingGbp-Math.max(state.spend.dailyEstimated,state.spend.dailyActual)).toFixed(4))),
    monthly:Math.max(0,Number((state.monthlyCostCeilingGbp-Math.max(state.spend.monthlyEstimated,state.spend.monthlyActual)).toFixed(4))),
   },
   rateLimits:state.rateWindow??null,
   payloadLimits:{maxBytes:MAX_STAGING_PAYLOAD_BYTES},
   dedupeState:{
    seenUrlCount:state.seenUrls.length,
    seenHashCount:state.seenContentHashes.length,
   },
   executionAuthority:'none',
  },{status:200,headers});
 }),
});

http.route({
 path:'/api/research/staging',
 method:'POST',
 handler:httpActionGeneric(async(ctx,request)=>{
  const token=process.env.RESEARCH_STAGING_TOKEN;
  const owner=process.env.RESEARCH_OWNER_ID;
  if(!token||token.length<32||!owner){
   return Response.json({error:{code:'not_configured',message:'Cloud staging is not configured.'}},{status:503,headers});
  }
  if(!constantTimeBearerMatch(request.headers.get('authorization'),token)){
   return Response.json({error:{code:'unauthorized_staging',message:'Valid research-staging machine token required.'}},{status:401,headers});
  }
  const rawText=await request.text();
  if(new TextEncoder().encode(rawText).length>MAX_STAGING_PAYLOAD_BYTES){
   return Response.json({error:{code:'invalid_request',message:'Payload exceeds 64 KB limit.'}},{status:400,headers});
  }
  let parsedJson:unknown;
  try{
   parsedJson=JSON.parse(rawText);
  }catch{
   return Response.json({error:{code:'invalid_request',message:'Invalid JSON payload.'}},{status:400,headers});
  }
  if(hasForbiddenKeys(parsedJson)){
   return Response.json({error:{code:'forbidden_capability',message:'Research agents cannot access broker credentials, roles or trading controls.'}},{status:403,headers});
  }
  const parsed=stagedSubmissionRequestSchema.safeParse(parsedJson);
  if(!parsed.success){
   return Response.json({error:{code:'invalid_request',message:'Request payload failed schema validation.'}},{status:400,headers});
  }
  try{
   const result=await ctx.runMutation(mRef('submitStagedResearchInternal'),{
    owner,
    submissionJson:JSON.stringify(parsed.data),
   });
   return Response.json(result,{status:200,headers});
  }catch(err){
   const msg=err instanceof Error?err.message:'storage_error';
   if(/rate limit exceeded/i.test(msg)){
    return Response.json({error:{code:'rate_limited',message:msg}},{status:429,headers:{...headers,'Retry-After':'60'}});
   }
   if(/cost budget ceiling exceeded/i.test(msg)){
    return Response.json({error:{code:'budget_exceeded',message:msg}},{status:429,headers});
   }
   return Response.json({error:{code:'invalid_request',message:msg}},{status:400,headers});
  }
 }),
});

http.route({
 path:'/api/operations/scheduled',
 method:'POST',
 handler:httpActionGeneric(async(ctx,request)=>{
  const secret=process.env.OPERATIONS_SCHEDULER_SECRET;
  const owner=process.env.RESEARCH_OWNER_ID;
  if(!secret||secret.length<32||!owner){
   return Response.json({error:{code:'not_configured',message:'Cloud scheduler is not configured.'}},{status:503,headers});
  }
  if(!constantTimeBearerMatch(request.headers.get('authorization'),secret)){
   return Response.json({error:{code:'unauthorized_scheduler',message:'Valid operations scheduler token required.'}},{status:401,headers});
  }
  const rawText=await request.text();
  if(new TextEncoder().encode(rawText).length>MAX_SCHEDULER_PAYLOAD_BYTES){
   return Response.json({error:{code:'invalid_request',message:'Payload exceeds 16 KB limit.'}},{status:400,headers});
  }
  let body:{environment?:'remote'|'local';forceOnDemand?:boolean;jobs?:string[]}={};
  if(rawText.trim()){
   try{
    body=JSON.parse(rawText);
   }catch{
    return Response.json({error:{code:'invalid_request',message:'Invalid JSON payload.'}},{status:400,headers});
   }
  }
  if(hasForbiddenKeys(body)){
   return Response.json({error:{code:'forbidden_capability',message:'Forbidden operational key in payload.'}},{status:403,headers});
  }
  const res=await ctx.runAction(aRef('runScheduledCloudCycle'),{
   environment:body.environment??'remote',
   forceOnDemand:body.forceOnDemand??false,
   ...(body.jobs?{jobs:body.jobs}:{}),
  });
  return Response.json(res,{status:200,headers});
 }),
});

// ---------------------------------------------------------------------------------------------------------
// Evidence-Locked Chat gateway (MVP hardening, work package 2)
//
// Server-to-Convex routes for the Next.js chat route. They are the only way to reach the internal nonce and
// attested audit mutations. Authentication is a dedicated machine secret sent in `X-ACI-Gateway-Authorization`;
// it proves only that the request comes from the trusted application server. It never establishes who the end
// user is: the owner comes from the nonce row (acceptance) or from the Convex-verified user JWT (`/turn`).
// ---------------------------------------------------------------------------------------------------------
const GATEWAY_HEADER='x-aci-gateway-authorization';
const MAX_GATEWAY_PAYLOAD_BYTES=1_900_000;
const nonceM=(name:string)=>makeFunctionReference<'mutation'>(`acceptanceNonces:${name}`);
const chatM=(name:string)=>makeFunctionReference<'mutation'>(`evidenceChat:${name}`);

/** Current and (during rotation) previous gateway secrets. A secret shared with another machine credential is refused. */
function gatewaySecrets():string[]|null{
 const others=[process.env.OPERATIONS_SCHEDULER_SECRET,process.env.RESEARCH_STAGING_TOKEN].filter(Boolean);
 const candidates=[process.env.EVIDENCE_CHAT_GATEWAY_SECRET,process.env.EVIDENCE_CHAT_GATEWAY_SECRET_PREVIOUS]
  .filter((s):s is string=>typeof s==='string'&&s.length>=32);
 if(!process.env.EVIDENCE_CHAT_GATEWAY_SECRET||process.env.EVIDENCE_CHAT_GATEWAY_SECRET.length<32)return null;
 if(candidates.some(c=>others.includes(c)))return null;
 return candidates;
}
function gatewayGuard(request:Request):Response|null{
 const secrets=gatewaySecrets();
 if(!secrets)return Response.json({error:{code:'not_configured',message:'Evidence chat gateway is not configured.'}},{status:503,headers});
 const presented=request.headers.get(GATEWAY_HEADER);
 let ok=false;
 for(const s of secrets)ok=constantTimeBearerMatch(presented,s)||ok;
 if(!ok)return Response.json({error:{code:'unauthorized_gateway',message:'Valid evidence chat gateway credential required.'}},{status:401,headers});
 return null;
}
async function gatewayJson(request:Request):Promise<{ok:true;body:Record<string,unknown>}|{ok:false;response:Response}>{
 const raw=await request.text();
 if(new TextEncoder().encode(raw).length>MAX_GATEWAY_PAYLOAD_BYTES)return {ok:false,response:Response.json({error:{code:'invalid_request',message:'Payload too large.'}},{status:413,headers})};
 try{
  const parsed:unknown=JSON.parse(raw);
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('not an object');
  // Identity is never accepted from the payload.
  if('owner' in parsed||'callerId' in parsed)return {ok:false,response:Response.json({error:{code:'forbidden_field',message:'Owner identity cannot be supplied by the caller.'}},{status:400,headers})};
  return {ok:true,body:parsed as Record<string,unknown>};
 }catch{
  return {ok:false,response:Response.json({error:{code:'invalid_request',message:'Invalid JSON payload.'}},{status:400,headers})};
 }
}
const str=(value:unknown,max:number)=>typeof value==='string'&&value.length>0&&value.length<=max?value:null;
const nonceRejected=(reason:string,violations?:string[])=>Response.json({error:{code:'nonce_rejected',reason,...(violations?{violations}:{})}},{status:reason==='invalid_audit_record'?400:409,headers});

http.route({
 path:'/api/evidence-chat/acceptance/consume',
 method:'POST',
 handler:httpActionGeneric(async(ctx,request)=>{
  const denied=gatewayGuard(request);if(denied)return denied;
  const parsed=await gatewayJson(request);if(!parsed.ok)return parsed.response;
  const token=str(parsed.body.token,200),question=str(parsed.body.question,1000);
  const tokenParts=token?parseAcceptanceToken(token):null;
  if(!tokenParts||!question)return Response.json({error:{code:'invalid_request',message:'token and question are required.'}},{status:400,headers});
  const reservation=randomHex(32);
  const result=await ctx.runMutation(nonceM('consumeNonceInternal'),{
   nonceId:tokenParts.nonceId,
   secretSha256:await sha256Hex(tokenParts.secret),
   questionSha256:await questionDigest(question),
   reservationSha256:await sha256Hex(reservation),
  }) as {ok:false;reason:string}|{ok:true;owner:string;recordDeadlineMs:number;context:unknown};
  if(!result.ok)return nonceRejected(result.reason);
  return Response.json({owner:result.owner,reservation,recordDeadlineMs:result.recordDeadlineMs,context:result.context,executionAuthority:'none'},{status:200,headers});
 }),
});

http.route({
 path:'/api/evidence-chat/acceptance/record',
 method:'POST',
 handler:httpActionGeneric(async(ctx,request)=>{
  const denied=gatewayGuard(request);if(denied)return denied;
  const parsed=await gatewayJson(request);if(!parsed.ok)return parsed.response;
  const token=str(parsed.body.token,200),reservation=str(parsed.body.reservation,64);
  const tokenParts=token?parseAcceptanceToken(token):null;
  const turn=parsed.body.turn as Record<string,unknown>|undefined;
  if(!tokenParts||!reservation||!/^[0-9a-f]{64}$/.test(reservation)||!turn||typeof turn!=='object'||typeof turn.question!=='string'){
   return Response.json({error:{code:'invalid_request',message:'token, reservation and turn are required.'}},{status:400,headers});
  }
  try{
   const result=await ctx.runMutation(nonceM('recordNonceTurnInternal'),{
    nonceId:tokenParts.nonceId,
    secretSha256:await sha256Hex(tokenParts.secret),
    reservationSha256:await sha256Hex(reservation),
    turnQuestionSha256:await questionDigest(turn.question),
    ...turn,
   }) as {ok:false;reason:string;violations?:string[]}|{ok:true;auditId:string;duplicate:boolean};
   if(!result.ok)return nonceRejected(result.reason,result.violations);
   return Response.json({auditId:result.auditId,duplicate:result.duplicate,executionAuthority:'none'},{status:200,headers});
  }catch{
   // Argument-validator failures (unknown or mistyped turn fields) are reported without echoing the payload.
   return Response.json({error:{code:'invalid_request',message:'Turn record failed schema validation.'}},{status:400,headers});
  }
 }),
});

http.route({
 path:'/api/evidence-chat/acceptance/fail',
 method:'POST',
 handler:httpActionGeneric(async(ctx,request)=>{
  const denied=gatewayGuard(request);if(denied)return denied;
  const parsed=await gatewayJson(request);if(!parsed.ok)return parsed.response;
  const token=str(parsed.body.token,200),reservation=str(parsed.body.reservation,64),failureCode=str(parsed.body.failureCode,60);
  const tokenParts=token?parseAcceptanceToken(token):null;
  if(!tokenParts||!reservation||!failureCode)return Response.json({error:{code:'invalid_request',message:'token, reservation and failureCode are required.'}},{status:400,headers});
  const result=await ctx.runMutation(nonceM('failNonceInternal'),{
   nonceId:tokenParts.nonceId,
   secretSha256:await sha256Hex(tokenParts.secret),
   reservationSha256:await sha256Hex(reservation),
   failureCode,
  }) as {ok:boolean;reason?:string};
  if(!result.ok)return nonceRejected(result.reason??'not_consumed');
  return Response.json({failed:true,executionAuthority:'none'},{status:200,headers});
 }),
});

/**
 * Attested audit record for an ordinary signed-in chat turn. Requires BOTH the gateway credential (the request
 * comes from the application server, not a browser) and the end user's Convex-verified JWT in `Authorization`
 * (who the turn belongs to). Either one alone is refused.
 */
http.route({
 path:'/api/evidence-chat/turn',
 method:'POST',
 handler:httpActionGeneric(async(ctx,request)=>{
  const denied=gatewayGuard(request);if(denied)return denied;
  const rawIdentity=await ctx.auth.getUserIdentity();
  if(!rawIdentity)return Response.json({error:{code:'sign_in_required',message:'A verified user session is required.'}},{status:401,headers});
  let owner:string;
  try{
   const identity=verifyIdentityClaims(rawIdentity);
   if(identity.actorType!==undefined&&identity.actorType!=='human')throw new Error('automated actor');
   owner=identity.tokenIdentifier;
  }catch{
   return Response.json({error:{code:'forbidden_identity',message:'This identity cannot record research chat turns.'}},{status:403,headers});
  }
  const parsed=await gatewayJson(request);if(!parsed.ok)return parsed.response;
  const turn=parsed.body.turn as Record<string,unknown>|undefined;
  if(!turn||typeof turn!=='object')return Response.json({error:{code:'invalid_request',message:'turn is required.'}},{status:400,headers});
  try{
   const result=await ctx.runMutation(chatM('recordEvidenceChatTurnInternal'),{owner,recordedVia:'server_gateway',...turn}) as {auditId:string};
   return Response.json({auditId:result.auditId,executionAuthority:'none'},{status:200,headers});
  }catch{
   return Response.json({error:{code:'invalid_request',message:'Turn record failed validation.'}},{status:400,headers});
  }
 }),
});

export default http;
