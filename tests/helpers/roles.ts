import type {TestConvex} from 'convex-test';
import type schema from '../../convex/schema';

/** Test-only stand-in for the deployment-administrator bootstrap: grants explicit reviewer authority to token identifiers. */
export async function grantReviewers(t:TestConvex<typeof schema>,subjects:string[]){
 await t.run(async ctx=>{for(const subject of subjects)await ctx.db.insert('roleGrants',{subject,role:'reviewer',grantedBy:'deployment-admin:test',grantedVia:'deployment_admin',reason:'Test reviewer assignment',grantedAt:0,expiresAt:8.64e15});});
}
