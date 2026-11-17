import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

/**
 * G9.3.3 — authenticated /api/graph/chat repair.
 * Root cause: the route imported claim validation from a 'use client' module; in the Next.js server bundle the call
 * threw, and the route's catch returned 401 to every signed-in user. These tests pin the corrected contract for GET
 * and POST independently: valid → proceeds; missing/invalid/wrong-issuer/wrong-azp/expired → 401; unexpected internal
 * failure → generic 500 (never 401), with no token or stack in the body or the log.
 * (The bundle-level stub itself is caught by tests/server-client-import-boundary.test.ts and npm run check:server-bundle.)
 */
const h=vi.hoisted(()=>({
 auth:(async()=>({userId:null as string|null,getToken:async()=>null as string|null})) as ()=>Promise<{userId:string|null;getToken:(o?:{template?:string})=>Promise<string|null>}>,
 convexAuthTokens:[] as string[],
 convexQueries:0,
}));
vi.mock('@clerk/nextjs/server',()=>({auth:()=>h.auth()}));
vi.mock('convex/browser',()=>({ConvexHttpClient:class{
 setAuth(t:string){h.convexAuthTokens.push(t);}
 async query(){h.convexQueries++;return [];}
 async mutation(){throw new Error('no mutations expected in auth tests');}
 async action(){throw new Error('no actions expected in auth tests');}
}}));

import {NextRequest} from 'next/server';
import {GET,POST} from '../app/api/graph/chat/route';
import {checkServerClerkToken,validateClerkConvexJwtClaims as serverValidate} from '../lib/auth/clerk-jwt-claims';
import {validateClerkConvexJwtClaims as clientReexport} from '../lib/clerk-convex-auth';

const ISSUER='https://complete-bunny-8662.clerk.accounts.dev';
const ORIGIN='https://trading-app-git-verify-combined-864cea-david-grannums-projects.vercel.app';
const nowS=()=>Math.floor(Date.now()/1000);
const b64u=(o:unknown)=>Buffer.from(JSON.stringify(o),'utf8').toString('base64url');
const jwt=(claims:Record<string,unknown>)=>`${b64u({alg:'RS256',typ:'JWT',kid:'ins_test'})}.${b64u(claims)}.sig_placeholder`;
const valid=(over:Record<string,unknown>={})=>jwt({iss:ISSUER,sub:'user_a',azp:ORIGIN,iat:nowS()-5,exp:nowS()+55,...over});

let fetchCalls:string[]=[];
let errorLog:string[]=[];
function session(token:string|null,templated:string|null=null){
 h.auth=async()=>({userId:'user_a',getToken:async(o?:{template?:string})=>o?.template==='convex'?templated:token});
}

beforeEach(()=>{
 vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','pk_test_unit_only');vi.stubEnv('CLERK_SECRET_KEY','sk_test_unit_only'); // G9.3.3: the route reads a Clerk session only when Clerk is configured
 vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN',ISSUER);
 vi.stubEnv('CLERK_ALLOWED_AZP_ORIGINS',ORIGIN);
 vi.stubEnv('NEXT_PUBLIC_CONVEX_URL','https://example-deployment-123.convex.cloud');
 vi.stubEnv('GEMINI_API_KEY','');
 vi.stubEnv('EVIDENCE_CHAT_GATEWAY_SECRET','');
 h.convexAuthTokens=[];h.convexQueries=0;fetchCalls=[];errorLog=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{fetchCalls.push(String(url));return Response.json({},{status:404});}));
 vi.spyOn(console,'error').mockImplementation((...a:unknown[])=>{errorLog.push(a.map(String).join(' '));});
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});

const getReq=()=>GET(new NextRequest(`${ORIGIN}/api/graph/chat`,{method:'GET'}));
// A deliberately invalid payload: a request that passes authentication is answered 400 by payload validation, which
// proves auth succeeded without reaching budget reservation, the gateway or the model.
const postReq=(body:unknown={question:'x'})=>POST(new NextRequest(`${ORIGIN}/api/graph/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));

const INVALID:Array<[string,()=>string,string]>=[
 ['malformed token (payload not JSON)',()=>`${b64u({alg:'RS256'})}.not-json.sig`,'invalid_token'],
 ['wrong issuer',()=>valid({iss:'https://attacker.clerk.accounts.dev'}),'invalid_token'],
 ['wrong authorised party',()=>valid({azp:'https://attacker.example.com'}),'invalid_token'],
 ['missing application context (no aud, no azp)',()=>jwt({iss:ISSUER,sub:'user_a',exp:nowS()+55}),'invalid_token'],
 ['expired token',()=>valid({iat:nowS()-120,exp:nowS()-60}),'token_expired'],
];

describe('GET /api/graph/chat authentication',()=>{
 it('valid session token → 200, and only the validated token is forwarded to Convex',async()=>{
  const t=valid();session(t);
  const res=await getReq();
  expect(res.status).toBe(200);
  const body=await res.json() as Record<string,unknown>;
  expect(body).toMatchObject({history:[],executionAuthority:'none'});
  expect(h.convexAuthTokens).toEqual([t]);
  expect(h.convexQueries).toBe(1);
 });

 it('valid convex-template token (aud=convex) → 200',async()=>{
  const t=jwt({iss:ISSUER,sub:'user_a',aud:'convex',exp:nowS()+55});session(null,t);
  expect((await getReq()).status).toBe(200);
  expect(h.convexAuthTokens).toEqual([t]);
 });

 it('no session → 401 sign_in_required',async()=>{
  h.auth=async()=>({userId:null,getToken:async()=>null});
  const res=await getReq();
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({code:'sign_in_required',executionAuthority:'none'});
  expect(h.convexQueries).toBe(0);
 });

 it.each(INVALID)('%s → 401 and the token is never forwarded',async(_n,make,code)=>{
  session(make());
  const res=await getReq();
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({code,executionAuthority:'none'});
  expect(h.convexAuthTokens).toEqual([]);
  expect(h.convexQueries).toBe(0);
 });

 it('an invalid convex-template token is rejected even when the default token would be valid',async()=>{
  session(valid(),valid({azp:'https://attacker.example.com',aud:'convex'}));
  const res=await getReq();
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({code:'invalid_token'});
 });

 it('unexpected internal failure → generic 500 (not 401) with a redacted log line and no token or stack in the body',async()=>{
  const leaked=valid();
  h.auth=async()=>{throw new Error(`Clerk: auth() was called but clerkMiddleware() was not detected (token ${leaked})`);};
  const res=await getReq();
  expect(res.status).toBe(500);
  const text=await res.text();
  expect(JSON.parse(text)).toEqual({error:'Evidence-locked research assistant request failed',code:'internal_error',executionAuthority:'none'});
  expect(text).not.toContain(leaked);
  expect(text).not.toMatch(/at\s+\S+\s+\(|stack/i);
  expect(errorLog).toHaveLength(1);
  expect(errorLog[0]).toContain('[graph/chat] GET internal error: Error:');
  expect(errorLog[0]).toContain('[redacted-jwt]');
  expect(errorLog[0]).not.toContain(leaked);
 });
});

describe('POST /api/graph/chat authentication',()=>{
 it('valid session token → passes authentication (reaches payload validation: 400), no gateway or model call',async()=>{
  session(valid());
  const res=await postReq();
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({error:'Invalid research chat request payload',executionAuthority:'none'});
  expect(fetchCalls).toEqual([]);
 });

 it('no session → 401 sign_in_required, payload validity not revealed',async()=>{
  h.auth=async()=>({userId:null,getToken:async()=>null});
  const res=await postReq();
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({code:'sign_in_required',executionAuthority:'none'});
  expect(fetchCalls).toEqual([]);
 });

 it.each(INVALID)('%s → 401 before payload validation, gateway or model',async(_n,make,code)=>{
  session(make());
  const res=await postReq();
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({code,executionAuthority:'none'});
  expect(fetchCalls).toEqual([]);
 });

 it('a session plus an acceptance nonce is still refused as ambiguous (400) before either is used',async()=>{
  session(valid());
  const res=await POST(new NextRequest(`${ORIGIN}/api/graph/chat`,{method:'POST',headers:{'content-type':'application/json','x-aci-acceptance-nonce':'acn1.valid'},body:JSON.stringify({question:'abc'})}));
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({code:'ambiguous_credentials'});
  expect(fetchCalls).toEqual([]);
 });

 it('unexpected internal failure → generic 500 (not 401), redacted log, nothing consumed',async()=>{
  h.auth=async()=>{throw new TypeError('Cannot read properties of undefined (reading "userId")');};
  const res=await postReq({question:'Which hyperscalers fund the build-out?'});
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({error:'Evidence-locked research assistant request failed',code:'internal_error',executionAuthority:'none'});
  expect(errorLog).toHaveLength(1);
  expect(errorLog[0]).toContain('[graph/chat] POST auth internal error: TypeError:');
  expect(fetchCalls).toEqual([]);
 });
});

describe('Clerk not configured on the server',()=>{
 it('means no session can exist: 401 sign_in_required for GET and POST, and auth() is never called (not a 500)',async()=>{
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','');vi.stubEnv('CLERK_SECRET_KEY','');
  let called=0;
  h.auth=async()=>{called++;throw new Error('auth() must not be called when Clerk is not configured');};
  const g=await getReq();
  expect(g.status).toBe(401);
  expect(await g.json()).toMatchObject({code:'sign_in_required'});
  const p=await postReq();
  expect(p.status).toBe(401);
  expect(await p.json()).toMatchObject({code:'sign_in_required'});
  expect(called).toBe(0);
  expect(errorLog).toEqual([]);
 });
});

describe('server-safe claim module',()=>{
 it('the client module re-exports the same function (one implementation, no drift)',()=>{
  expect(clientReexport).toBe(serverValidate);
 });

 it('checkServerClerkToken classifies valid, invalid and expired tokens; expiry has no leeway',()=>{
  const now=1_800_000_000_000;
  expect(checkServerClerkToken(jwt({iss:ISSUER,sub:'u',azp:ORIGIN,exp:now/1000+1}),{nowMs:now})).toBe('valid');
  expect(checkServerClerkToken(jwt({iss:ISSUER,sub:'u',azp:ORIGIN,exp:now/1000}),{nowMs:now})).toBe('expired');
  expect(checkServerClerkToken(jwt({iss:ISSUER,sub:'u',azp:ORIGIN,exp:'tomorrow'}),{nowMs:now})).toBe('invalid_claims');
  expect(checkServerClerkToken(jwt({iss:ISSUER,sub:'u',azp:'https://evil.example'}),{nowMs:now})).toBe('invalid_claims');
  expect(checkServerClerkToken(jwt({iss:ISSUER,sub:'u',azp:ORIGIN}),{nowMs:now})).toBe('valid');
 });

 it('on the server, request headers can never widen the allowed authorised parties',()=>{
  expect(typeof window).toBe('undefined');
  expect(serverValidate(jwt({iss:ISSUER,sub:'u',azp:'https://attacker.example.com'}))).toBe(false);
 });
});
