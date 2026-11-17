import type {GenericQueryCtx,GenericMutationCtx,UserIdentity} from 'convex/server';
import type {DataModel} from './server';

/**
 * Server-validated research roles.
 *
 * - researcher: every authenticated, non-model identity. It may create and register research on records it owns.
 * - reviewer: an explicit, unexpired, unrevoked grant stored server-side. Required for every consequential
 *   research approval or rejection. Signing in never confers it.
 * - administrator: an explicit grant that may assign or revoke reviewer roles for other identities. It does not
 *   imply reviewer authority. Bootstrap grants come only from the deployment administrator (internal mutation).
 *
 * Roles never bypass ownership checks or independent risk enforcement: reviewers can act only on records they own,
 * and paper execution still recomputes the deterministic risk gate after approval.
 */
export const ROLES=['reviewer','administrator'] as const;
export type Role=typeof ROLES[number];
type Ctx=GenericQueryCtx<DataModel>|GenericMutationCtx<DataModel>;

const DEFAULT_ALLOWED_AZP_ORIGINS=[
 'https://capital.aiguides.co.uk',
 'https://trading-app-theta-two.vercel.app',
 'http://localhost:3000',
];

function normalizeOriginOrIssuer(value:string):string{
 return value.trim().replace(/\/+$/,'');
}

function configuredIssuers():string[]{
 const raw=process.env.CLERK_JWT_ISSUER_DOMAIN??'';
 return raw.split(',').map(normalizeOriginOrIssuer).filter(Boolean);
}

function allowedAzpOrigins():Set<string>{
 const raw=process.env.CLERK_ALLOWED_AZP_ORIGINS??'';
 const configured=raw.split(',').map(normalizeOriginOrIssuer).filter(Boolean);
 return new Set(configured.length>0?configured:DEFAULT_ALLOWED_AZP_ORIGINS);
}

/**
 * Verifies issuer, audience (`aud`), and authorized party (`azp`) application binding
 * across both OIDC (`template: "convex"`, `aud: "convex"`) and `customJwt` (Clerk default
 * RS256 session token with `azp: "<origin>"`) verification paths.
 *
 * Application context is mandatory (G9.3.5). Every identity must carry an approved `azp` (a Clerk session token
 * issued to an allowed browser origin) or an approved `aud` (`convex`, or an allowed origin). A token with neither
 * can only be minted outside the application (for example with the Clerk secret through the Backend API) and is
 * refused. A present-but-untrusted `azp` or `aud` is refused even when the other claim is valid.
 *
 * There is deliberately no opt-out: the G9.3.5 compatibility audit found no legitimate caller that sends a token
 * without both claims (browser and server routes forward Clerk session tokens; machine paths use admin keys against
 * internal functions or shared secrets on HTTP actions, never a Clerk identity). Adding an exception requires review.
 */
export function verifyIdentityClaims(user:UserIdentity):UserIdentity{
 const issuers=configuredIssuers();
 if(issuers.length>0){
  const tokenPrefix=typeof user.tokenIdentifier==='string'&&user.tokenIdentifier.includes('|')
   ? normalizeOriginOrIssuer(user.tokenIdentifier.split('|')[0]!)
   : '';
  const userIssuer=typeof user.issuer==='string'?normalizeOriginOrIssuer(user.issuer):tokenPrefix;
  if(userIssuer.startsWith('http://')||userIssuer.startsWith('https://')){
   if(!issuers.includes(userIssuer)){
    throw new Error('Untrusted token issuer');
   }
  }
 }

 const allowedOrigins=allowedAzpOrigins();
 const rawAud=(user as Record<string,unknown>).aud;
 let hasValidAud=false;
 if(rawAud!==undefined){
  if(rawAud===null){
   throw new Error('Untrusted token audience');
  }
  const audList=Array.isArray(rawAud)
   ? rawAud.filter((entry):entry is string=>typeof entry==='string')
   : typeof rawAud==='string'
     ? [rawAud]
     : [];
  const validAud=audList.length>0
   &&(!Array.isArray(rawAud)||audList.length===rawAud.length)
   &&audList.every(a=>{
    const norm=normalizeOriginOrIssuer(a);
    return norm==='convex'||allowedOrigins.has(norm);
   });
  if(!validAud){
   throw new Error('Untrusted token audience');
  }
  hasValidAud=true;
 }

 const rawAzp=(user as Record<string,unknown>).azp;
 let hasValidAzp=false;
 if(rawAzp!==undefined){
  if(rawAzp===null||typeof rawAzp!=='string'){
   throw new Error('Untrusted token authorized party');
  }
  const azp=normalizeOriginOrIssuer(rawAzp);
  if(!azp||!allowedOrigins.has(azp)){
   throw new Error('Untrusted token authorized party');
  }
  hasValidAzp=true;
 }

 if(!hasValidAud&&!hasValidAzp){
  throw new Error('Missing token application context');
 }

 return user;
}

export async function signedIn(ctx:Ctx):Promise<UserIdentity>{
 let user:UserIdentity|null=null;
 try{
  user=await ctx.auth.getUserIdentity();
 }catch{
  throw new Error('Sign in required');
 }
 if(!user)throw new Error('Sign in required');
 return verifyIdentityClaims(user);
}

/** Researcher capability: a signed-in identity that is not a declared model or automation actor. */
export async function researcher(ctx:Ctx):Promise<UserIdentity>{
 const user=await signedIn(ctx);
 if(user.actorType!==undefined&&user.actorType!=='human')throw new Error('Model or automated actors cannot act as researchers or reviewers');
 return user;
}

export async function activeGrant(ctx:Ctx,subject:string,role:Role,now:number){
 const grants=await ctx.db.query('roleGrants').withIndex('by_subject_role',q=>q.eq('subject',subject).eq('role',role)).collect();
 return grants.find(g=>g.revokedAt===undefined&&g.grantedAt<=now&&(g.expiresAt===undefined||g.expiresAt>now))??null;
}

export async function hasRole(ctx:Ctx,subject:string,role:Role,now=Date.now()){return (await activeGrant(ctx,subject,role,now))!==null;}

/** Consequential approval or rejection: requires an explicit reviewer grant for the caller's verified identity. */
export async function reviewer(ctx:Ctx):Promise<UserIdentity>{
 const user=await researcher(ctx);
 if(!(await hasRole(ctx,user.tokenIdentifier,'reviewer')))throw new Error('Reviewer role required: an administrator must assign reviewer authority explicitly');
 return user;
}

export async function administrator(ctx:Ctx):Promise<UserIdentity>{
 const user=await researcher(ctx);
 if(!(await hasRole(ctx,user.tokenIdentifier,'administrator')))throw new Error('Administrator role required');
 return user;
}
