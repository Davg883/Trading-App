import {v} from 'convex/values';
import type {GenericMutationCtx} from 'convex/server';
import {query,mutation,internalMutation,type DataModel} from './server';
import {ROLES,activeGrant,administrator,signedIn,type Role} from './authz';

/**
 * Role assignment. Every grant and revocation is an immutable audit event; grant rows are only ever revoked,
 * never deleted or edited. Administrators cannot change their own roles.
 */
const role=v.union(v.literal('reviewer'),v.literal('administrator'));
const MAX_DAYS=366,DAY=86_400_000;
function reason(text:string){if(!text.trim()||text.length>1000)throw new Error('A reason (1–1000 characters) is required for every role change');}
function subjectId(text:string){if(!text.trim()||text.length>500)throw new Error('Subject token identifier required');}
function expiry(expiresAt:number|undefined,now:number){
 if(expiresAt===undefined)throw new Error('Role grants must expire; set an expiry within one year');
 if(!Number.isSafeInteger(expiresAt)||expiresAt<=now||expiresAt>now+MAX_DAYS*DAY)throw new Error('Expiry must be in the future and within one year');
}

async function grant(ctx:GenericMutationCtx<DataModel>,args:{subject:string;role:Role;reason:string;expiresAt?:number},grantedBy:string,via:'deployment_admin'|'administrator'){
 const now=Date.now();subjectId(args.subject);reason(args.reason);expiry(args.expiresAt,now);
 const existing=await activeGrant(ctx,args.subject,args.role,now);
 if(existing)throw new Error(`${args.subject} already holds an active ${args.role} grant; revoke it before replacing it`);
 const id=await ctx.db.insert('roleGrants',{subject:args.subject,role:args.role,grantedBy,grantedVia:via,reason:args.reason,grantedAt:now,expiresAt:args.expiresAt});
 await ctx.db.insert('audit',{owner:args.subject,action:`role.${args.role}.granted`,recordId:id,detail:`via ${via} by ${grantedBy}; expires ${new Date(args.expiresAt!).toISOString()}; ${args.reason}`,at:now});
 return id;
}
async function revoke(ctx:GenericMutationCtx<DataModel>,args:{subject:string;role:Role;reason:string},revokedBy:string,via:'deployment_admin'|'administrator'){
 const now=Date.now();subjectId(args.subject);reason(args.reason);
 const existing=await activeGrant(ctx,args.subject,args.role,now);if(!existing)throw new Error('No active grant to revoke');
 await ctx.db.patch(existing._id,{revokedAt:now,revokedBy,revokeReason:args.reason});
 await ctx.db.insert('audit',{owner:args.subject,action:`role.${args.role}.revoked`,recordId:existing._id,detail:`via ${via} by ${revokedBy}; ${args.reason}`,at:now});
 return existing._id;
}

/** Deployment-administrator bootstrap (deploy key / CLI only). Used to assign the project owner's first reviewer or administrator role. */
export const grantRoleInternal=internalMutation({args:{subject:v.string(),role,reason:v.string(),expiresAt:v.number(),operator:v.string()},handler:async(ctx,args)=>{
 if(!args.operator.trim()||args.operator.length>200)throw new Error('Operator name required');
 return await grant(ctx,args,`deployment-admin:${args.operator}`,'deployment_admin');
}});
export const revokeRoleInternal=internalMutation({args:{subject:v.string(),role,reason:v.string(),operator:v.string()},handler:async(ctx,args)=>{
 if(!args.operator.trim()||args.operator.length>200)throw new Error('Operator name required');
 return await revoke(ctx,args,`deployment-admin:${args.operator}`,'deployment_admin');
}});

/** An administrator may assign or revoke reviewer authority for another identity. Administrator roles are bootstrap-only. */
export const assignReviewer=mutation({args:{subject:v.string(),reason:v.string(),expiresAt:v.number()},handler:async(ctx,args)=>{
 const admin=await administrator(ctx);
 if(args.subject===admin.tokenIdentifier)throw new Error('Administrators cannot assign roles to themselves');
 return await grant(ctx,{...args,role:'reviewer'},admin.tokenIdentifier,'administrator');
}});
export const revokeReviewer=mutation({args:{subject:v.string(),reason:v.string()},handler:async(ctx,args)=>{
 const admin=await administrator(ctx);
 if(args.subject===admin.tokenIdentifier)throw new Error('Administrators cannot change their own roles');
 return await revoke(ctx,{...args,role:'reviewer'},admin.tokenIdentifier,'administrator');
}});

/** The caller's own active roles and grant history. Researcher is implicit for any signed-in human identity. */
export const myRoles=query({args:{},handler:async ctx=>{
 const user=await signedIn(ctx),now=Date.now(),rows=await ctx.db.query('roleGrants').withIndex('by_subject',q=>q.eq('subject',user.tokenIdentifier)).collect();
 const active=ROLES.filter(r=>rows.some(g=>g.role===r&&g.revokedAt===undefined&&g.grantedAt<=now&&(g.expiresAt===undefined||g.expiresAt>now)));
 return {subject:user.tokenIdentifier,researcher:user.actorType===undefined||user.actorType==='human',roles:active,grants:rows.map(g=>({grantId:g._id,role:g.role,grantedAt:g.grantedAt,expiresAt:g.expiresAt??null,grantedVia:g.grantedVia,revokedAt:g.revokedAt??null}))};
}});
