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

export async function signedIn(ctx:Ctx):Promise<UserIdentity>{
 const user=await ctx.auth.getUserIdentity();
 if(!user)throw new Error('Sign in required');
 return user;
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
