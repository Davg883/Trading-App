import {httpRouter,httpActionGeneric,makeFunctionReference} from 'convex/server';
import {
 APPROVED_RESEARCH_UNIVERSE,
 MAX_SCHEDULER_PAYLOAD_BYTES,
 MAX_STAGING_PAYLOAD_BYTES,
 stagedSubmissionRequestSchema,
} from '../lib/remote-ops/contracts';

const http=httpRouter();

const headers={
 'Cache-Control':'private, no-store, max-age=0',
 'Pragma':'no-cache',
 'Vary':'Authorization',
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

export default http;
