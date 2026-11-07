import 'server-only';
import {auth} from '@clerk/nextjs/server';
import {ConvexHttpClient} from 'convex/browser';
import {makeFunctionReference} from 'convex/server';
import {preparePackage} from './research-packages';

/**
 * Trusted import of an allowlisted, hash-pinned research package.
 * The owner is resolved from the caller's verified Clerk→Convex identity, never from the request body.
 * The admin key is used only server-side to call the internal import mutation. No order, ledger or broker call is made.
 */
const headers={'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Vary':'Cookie'};
class ImportError extends Error{constructor(readonly code:string,readonly status:number,message:string){super(message);}}
const json=(body:unknown,status=200)=>Response.json(body,{status,headers});

function client(){const url=process.env.NEXT_PUBLIC_CONVEX_URL;if(!url)throw new ImportError('not_configured',503,'Convex is not configured');return new ConvexHttpClient(url,{logger:false,fetch:(input,init)=>fetch(input,{...init,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)})});}

export function assertSameOrigin(request:Request,env:Record<string,string|undefined>=process.env){
 const origin=request.headers.get('origin'),url=new URL(request.url);let expected=env.RESEARCH_APP_ORIGIN??env.BROKER_APP_ORIGIN;
 if(!expected&&env.NODE_ENV!=='production'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))expected=url.origin;
 if(!expected)throw new ImportError('not_configured',503,'Application origin is not configured');
 const allowed=new Set<string>();
 for(const raw of expected.split(',').map(s=>s.trim()).filter(Boolean)){
  try{
   const c=new URL(raw);
   if(c.username||c.password||c.pathname!=='/'||c.search||c.hash)throw new Error();
   if(env.NODE_ENV==='production'&&c.protocol!=='https:')throw new Error();
   allowed.add(c.origin);
  }catch{
   throw new ImportError('not_configured',503,'Application origin is invalid');
  }
 }
 if(allowed.size===0)throw new ImportError('not_configured',503,'Application origin is invalid');
 if(!origin||!allowed.has(origin)||request.headers.get('sec-fetch-site')==='cross-site'){
  throw new ImportError('forbidden_origin',403,'This request must come from the application itself');
 }
}

export async function importResearchPackage(request:Request){
 try{
  assertSameOrigin(request);
  if(!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY||!process.env.CLERK_SECRET_KEY||!process.env.NEXT_PUBLIC_CONVEX_URL)throw new ImportError('not_configured',503,'Clerk and Convex must be configured');
  const key=process.env.CONVEX_IMPORT_ADMIN_KEY;if(!key)throw new ImportError('not_configured',503,'Server import key is not configured');
  let body:unknown;try{body=await request.json();}catch{throw new ImportError('invalid_request',400,'JSON body required');}
  if(!body||typeof body!=='object'||Object.keys(body).join()!=='packageId'||typeof (body as {packageId:unknown}).packageId!=='string')throw new ImportError('invalid_request',400,'Only {packageId} is accepted');
  const session=await auth();if(!session.userId)throw new ImportError('sign_in_required',401,'Sign in required');
  const token=(await session.getToken({template:'convex'}).catch(()=>null))??(await session.getToken().catch(()=>null));if(!token)throw new ImportError('sign_in_required',401,'Sign in required');
  const user=client();user.setAuth(token);
  const {owner}=await user.query(makeFunctionReference<'query',Record<string,never>,{owner:string}>('recovery:viewer'),{});
  if(!owner)throw new ImportError('sign_in_required',401,'Sign in required');
  const pkg=preparePackage((body as {packageId:string}).packageId);
  const admin=client();(admin as unknown as {setAdminAuth(token:string):void}).setAdminAuth(key);
  const caseId=await admin.mutation(makeFunctionReference<'mutation',{owner:string;externalId:string;caseJson:string},string>(pkg.fn),{owner,externalId:pkg.externalId,caseJson:pkg.caseJson});
  return json({caseId,externalId:pkg.externalId,fileSha256:pkg.fileSha256,canonicalSha256:pkg.canonicalSha256,bytes:pkg.bytes,limitBytes:pkg.limitBytes,note:pkg.note,executionAuthority:'none'});
 }catch(e){
  if(e instanceof ImportError)return json({error:e.code,message:e.message},e.status);
  const message=e instanceof Error?e.message:'Import failed';
  return json({error:/pinned hash|Unknown research package|import limit/.test(message)?'invalid_package':'import_failed',message},400);
 }
}
