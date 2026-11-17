import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {UserIdentity} from 'convex/server';
import {verifyIdentityClaims} from '../convex/authz';

/**
 * G9.3.4 (B) — pins the CURRENT Convex application-context policy in convex/authz.ts verifyIdentityClaims, including
 * malicious and conflicting `aud`/`azp` combinations. This is a characterisation suite: it documents behaviour so a
 * future policy change is deliberate and reviewed. It does not change the policy.
 *
 * G9.3.5 closed the gap this suite originally pinned: a valid-issuer token carrying neither `aud` nor `azp` is now
 * REJECTED by the default helper used by every module, not only by the chat gateway. The former
 * `requireApplicationContext` option no longer exists. Browser and server-route tokens always carry `azp` (or
 * `aud: "convex"` with the template); a token without either can only be minted with the Clerk secret.
 */
const ISSUER='https://complete-bunny-8662.clerk.accounts.dev';
const ALLOWED='https://trading-app-git-verify-combined-864cea-david-grannums-projects.vercel.app';
const id=(claims:Record<string,unknown>):UserIdentity=>({tokenIdentifier:`${ISSUER}|user_a`,subject:'user_a',issuer:ISSUER,...claims} as UserIdentity);

beforeEach(()=>{vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN',ISSUER);vi.stubEnv('CLERK_ALLOWED_AZP_ORIGINS',`http://localhost:3000,${ALLOWED}`);});
afterEach(()=>vi.unstubAllEnvs());

describe('accepted combinations',()=>{
 it.each([
  ['aud "convex" (OIDC template), no azp',{aud:'convex'}],
  ['allowed azp (default session token), no aud',{azp:ALLOWED}],
  ['allowed azp with trailing slash',{azp:`${ALLOWED}/`}],
  ['aud "convex" and allowed azp',{aud:'convex',azp:ALLOWED}],
  ['aud equal to an allowed origin',{aud:ALLOWED}],
  ['aud array of only trusted values',{aud:['convex',ALLOWED]}],
 ])('%s',(_n,claims)=>{
  expect(verifyIdentityClaims(id(claims)).subject).toBe('user_a');
 });
});

describe('malicious or conflicting combinations are rejected',()=>{
 it.each([
  ['valid aud cannot rescue an untrusted azp',{aud:'convex',azp:'https://attacker.example.com'},'Untrusted token authorized party'],
  ['valid azp cannot rescue a foreign aud',{aud:'foreign-relying-party',azp:ALLOWED},'Untrusted token audience'],
  ['aud array smuggling a foreign audience',{aud:['convex','foreign-relying-party']},'Untrusted token audience'],
  ['aud array with a non-string element',{aud:['convex',5]},'Untrusted token audience'],
  ['empty aud array',{aud:[]},'Untrusted token audience'],
  ['aud null',{aud:null},'Untrusted token audience'],
  ['azp null',{azp:null},'Untrusted token authorized party'],
  ['azp not a string',{azp:42},'Untrusted token authorized party'],
  ['azp empty string',{azp:''},'Untrusted token authorized party'],
  ['azp lookalike host',{azp:`${ALLOWED}.attacker.example.com`},'Untrusted token authorized party'],
  ['azp scheme downgrade',{azp:ALLOWED.replace('https://','http://')},'Untrusted token authorized party'],
 ])('%s',(_n,claims,message)=>{
  expect(()=>verifyIdentityClaims(id(claims))).toThrow(message);
 });

 it('an untrusted issuer is rejected before any application-context check',()=>{
  expect(()=>verifyIdentityClaims({...id({azp:ALLOWED}),issuer:'https://attacker.clerk.accounts.dev',tokenIdentifier:'https://attacker.clerk.accounts.dev|user_a'})).toThrow('Untrusted token issuer');
 });
});

describe('missing application context (neither aud nor azp)',()=>{
 it('is REJECTED by the default helper used by signedIn()/researcher() and the chat gateway alike (G9.3.5)',()=>{
  expect(()=>verifyIdentityClaims(id({}))).toThrow('Missing token application context');
 });
});
