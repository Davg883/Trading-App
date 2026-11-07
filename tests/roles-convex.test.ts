import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';

const modules={'./_generated/server.ts':async()=>({}),'./roles.ts':()=>import('../convex/roles'),'./research.ts':()=>import('../convex/research')};
const roles=(n:string)=>makeFunctionReference<'mutation'>(`roles:${n}`),research=(n:string)=>makeFunctionReference<'mutation'>(`research:${n}`);
const myRoles=makeFunctionReference<'query'>('roles:myRoles');
const now=Date.parse('2026-11-06T12:00:00Z'),day=86_400_000;
const ALICE='https://issuer.test|user_alice',BOB='https://issuer.test|user_bob',ADMIN='https://issuer.test|user_admin';
afterEach(()=>vi.useRealTimers());

function setup(){
 vi.useFakeTimers();vi.setSystemTime(now);const t=convexTest(schema,modules);
 return {t,alice:t.withIdentity({subject:'user_alice',tokenIdentifier:ALICE}),bob:t.withIdentity({subject:'user_bob',tokenIdentifier:BOB}),admin:t.withIdentity({subject:'user_admin',tokenIdentifier:ADMIN})};
}
const bootstrap=(t:ReturnType<typeof setup>['t'],subject:string,role:'reviewer'|'administrator',days=30)=>t.mutation(roles('grantRoleInternal'),{subject,role,reason:`Explicit ${role} assignment for test`,expiresAt:Date.now()+days*day,operator:'deployment-owner'});
async function pendingProposal(user:ReturnType<typeof setup>['alice']){
 const portfolioId=await user.mutation(research('createPortfolio'),{name:'Role test',capitalGbp:10000});
 return await user.mutation(research('propose'),{portfolioId,symbol:'MSFT',quantity:1,reason:'Evidence-backed hypothesis'});
}
const approve=(proposalId:unknown,note='Reviewed evidence')=>({proposalId,decision:'approve' as const,note});

describe('Server-validated research roles',()=>{
 it('gives a signed-in user researcher capability only, never review or approval authority',async()=>{
  const {alice}=setup(),proposalId=await pendingProposal(alice);
  expect(await alice.query(myRoles,{})).toMatchObject({subject:ALICE,researcher:true,roles:[]});
  await expect(alice.mutation(research('review'),approve(proposalId))).rejects.toThrow('Reviewer role required');
  await expect(alice.mutation(research('review'),{...approve(proposalId),decision:'reject'})).rejects.toThrow('Reviewer role required');
 });
 it('rejects unauthenticated or expired sessions everywhere',async()=>{
  const {t,alice}=setup(),proposalId=await pendingProposal(alice);
  // Convex validates token expiry before a function runs; an expired session reaches the handler with no identity.
  await expect(t.query(myRoles,{})).rejects.toThrow('Sign in required');
  await expect(t.mutation(research('review'),approve(proposalId))).rejects.toThrow('Sign in required');
  await expect(t.mutation(roles('assignReviewer'),{subject:ALICE,reason:'x',expiresAt:now+day})).rejects.toThrow('Sign in required');
 });
 it('lets the deployment administrator explicitly assign the project owner as reviewer, with an audit event',async()=>{
  const {t,alice}=setup(),proposalId=await pendingProposal(alice);const grantId=await bootstrap(t,ALICE,'reviewer');
  expect((await alice.query(myRoles,{})).roles).toEqual(['reviewer']);
  await alice.mutation(research('review'),approve(proposalId));
  await t.run(async ctx=>{const audit=await ctx.db.query('audit').collect();expect(audit.find(a=>a.action==='role.reviewer.granted')).toMatchObject({owner:ALICE,recordId:grantId});expect(audit.find(a=>a.action==='role.reviewer.granted')!.detail).toMatch(/deployment_admin by deployment-admin:deployment-owner/);expect(audit.some(a=>a.action==='proposal.approve')).toBe(true);});
  await expect(bootstrap(t,ALICE,'reviewer')).rejects.toThrow('already holds an active reviewer grant');
 });
 it('requires every grant to expire within a year and stops honouring it after expiry',async()=>{
  const {t,alice}=setup();
  await expect(t.mutation(roles('grantRoleInternal'),{subject:ALICE,role:'reviewer',reason:'past',expiresAt:now-1,operator:'owner'})).rejects.toThrow('within one year');
  await expect(t.mutation(roles('grantRoleInternal'),{subject:ALICE,role:'reviewer',reason:'too long',expiresAt:now+400*day,operator:'owner'})).rejects.toThrow('within one year');
  await expect(t.mutation(roles('grantRoleInternal'),{subject:ALICE,role:'reviewer',reason:'  ',expiresAt:now+day,operator:'owner'})).rejects.toThrow('reason');
  await bootstrap(t,ALICE,'reviewer',1);const proposalId=await pendingProposal(alice);
  vi.setSystemTime(now+2*day);
  expect((await alice.query(myRoles,{})).roles).toEqual([]);
  await expect(alice.mutation(research('review'),approve(proposalId))).rejects.toThrow('Reviewer role required');
 });
 it('revokes authority without deleting history',async()=>{
  const {t,alice}=setup();const grantId=await bootstrap(t,ALICE,'reviewer');const proposalId=await pendingProposal(alice);
  await t.mutation(roles('revokeRoleInternal'),{subject:ALICE,role:'reviewer',reason:'Assignment ended',operator:'deployment-owner'});
  await expect(alice.mutation(research('review'),approve(proposalId))).rejects.toThrow('Reviewer role required');
  await t.run(async ctx=>{const g=await ctx.db.get(grantId);expect(g).toMatchObject({revokedBy:'deployment-admin:deployment-owner',revokeReason:'Assignment ended'});expect((await ctx.db.query('audit').collect()).map(a=>a.action)).toEqual(expect.arrayContaining(['role.reviewer.granted','role.reviewer.revoked']));});
  expect((await alice.query(myRoles,{})).grants).toHaveLength(1);
 });
 it('lets an administrator assign reviewers to others, but not to itself, and gives administrators no approval power',async()=>{
  const {t,alice,bob,admin}=setup();await bootstrap(t,ADMIN,'administrator');
  await expect(bob.mutation(roles('assignReviewer'),{subject:ALICE,reason:'Not an admin',expiresAt:now+day})).rejects.toThrow('Administrator role required');
  await expect(admin.mutation(roles('assignReviewer'),{subject:ADMIN,reason:'Self',expiresAt:now+day})).rejects.toThrow('cannot assign roles to themselves');
  await admin.mutation(roles('assignReviewer'),{subject:ALICE,reason:'Owner reviews own research',expiresAt:now+30*day});
  expect((await alice.query(myRoles,{})).grants[0]).toMatchObject({role:'reviewer',grantedVia:'administrator'});
  const adminProposal=await pendingProposal(admin);await expect(admin.mutation(research('review'),approve(adminProposal))).rejects.toThrow('Reviewer role required');
  await admin.mutation(roles('revokeReviewer'),{subject:ALICE,reason:'Rotation'});expect((await alice.query(myRoles,{})).roles).toEqual([]);
 });
 it('never lets a reviewer act on another owner\'s records',async()=>{
  const {t,alice,bob}=setup();await bootstrap(t,BOB,'reviewer');const proposalId=await pendingProposal(alice);
  await expect(bob.mutation(research('review'),approve(proposalId))).rejects.toThrow('Record unavailable');
 });
 it('refuses model actors even when their token identifier holds a grant',async()=>{
  const {t,alice}=setup();await bootstrap(t,ALICE,'reviewer');const proposalId=await pendingProposal(alice);
  const model=t.withIdentity({subject:'user_alice',tokenIdentifier:ALICE,actorType:'model'});
  await expect(model.mutation(research('review'),approve(proposalId))).rejects.toThrow('Model or automated actors');
 });
 it('keeps rejected approvals terminal and leaves independent risk enforcement in force after approval',async()=>{
  const {t,alice}=setup();await bootstrap(t,ALICE,'reviewer');
  const rejected=await pendingProposal(alice);await alice.mutation(research('review'),{proposalId:rejected,decision:'reject',note:'Insufficient evidence'});
  await expect(alice.mutation(research('review'),approve(rejected))).rejects.toThrow('Proposal already reviewed');
  await expect(alice.mutation(research('executePaper'),{proposalId:rejected})).rejects.toThrow('Human approval required');
  const approved=await pendingProposal(alice);await alice.mutation(research('review'),approve(approved));
  await expect(alice.mutation(research('executePaper'),{proposalId:approved})).rejects.toThrow('post-approval quote');
  await t.run(async ctx=>{expect(await ctx.db.query('fills').collect()).toEqual([]);});
 });
 it('exposes bootstrap only as internal functions and keeps role code free of broker or order paths',()=>{
  const src=readFileSync('convex/roles.ts','utf8');
  expect(src).toMatch(/export const grantRoleInternal=internalMutation/);expect(src).toMatch(/export const revokeRoleInternal=internalMutation/);
  expect(src+readFileSync('convex/authz.ts','utf8')).not.toMatch(/broker|executePaper|fills|placeOrder/i);
 });
});
