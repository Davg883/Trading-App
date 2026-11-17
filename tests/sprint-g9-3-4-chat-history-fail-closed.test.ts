import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

/**
 * G9.3.4 — GET /api/graph/chat history fails closed.
 * Found in G9.3.3 Preview acceptance: on an origin Convex does not authorise, Convex refused the history query but
 * the route answered 200 with an empty history. Empty history is now returned only for a successful, authorised
 * query with zero rows; Convex auth refusals map to 401/403 and dependency failures to 503, without leaking tokens,
 * stack traces or Convex error text.
 */
const h=vi.hoisted(()=>({
 session:null as null|{userId:string;token:string|null},
 query:(async()=>[]) as (ref:unknown,args:unknown)=>Promise<unknown>,
 queries:[] as Array<{args:unknown;auth:string|null}>,
 lastAuth:null as string|null,
}));
vi.mock('@clerk/nextjs/server',()=>({auth:async()=>h.session?{userId:h.session.userId,getToken:async(o?:{template?:string})=>o?.template==='convex'?null:h.session!.token}:{userId:null,getToken:async()=>null}}));
vi.mock('convex/browser',()=>({ConvexHttpClient:class{
 setAuth(t:string){h.lastAuth=t;}
 async query(ref:unknown,args:unknown){h.queries.push({args,auth:h.lastAuth});return h.query(ref,args);}
 async mutation(){throw new Error('no mutations expected');}
 async action(){throw new Error('no actions expected');}
}}));

import {NextRequest} from 'next/server';
import {GET,POST} from '../app/api/graph/chat/route';
import {classifyConvexError} from '../lib/auth/convex-error-classification';

const ISSUER='https://complete-bunny-8662.clerk.accounts.dev';
const ORIGIN='https://trading-app-git-verify-combined-864cea-david-grannums-projects.vercel.app';
const b64u=(o:unknown)=>Buffer.from(JSON.stringify(o),'utf8').toString('base64url');
const TOKEN=`${b64u({alg:'RS256',typ:'JWT'})}.${b64u({iss:ISSUER,sub:'user_a',azp:ORIGIN,exp:Math.floor(Date.now()/1000)+55})}.sig_placeholder`;
let errorLog:string[]=[];

beforeEach(()=>{
 vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','pk_test_unit_only');vi.stubEnv('CLERK_SECRET_KEY','sk_test_unit_only');
 vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN',ISSUER);vi.stubEnv('CLERK_ALLOWED_AZP_ORIGINS',ORIGIN);
 vi.stubEnv('NEXT_PUBLIC_CONVEX_URL','https://example-deployment-123.convex.cloud');
 vi.stubEnv('GEMINI_API_KEY','');vi.stubEnv('EVIDENCE_CHAT_GATEWAY_SECRET','');
 h.session={userId:'user_a',token:TOKEN};h.query=async()=>[];h.queries=[];h.lastAuth=null;errorLog=[];
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({},{status:404})));
 vi.spyOn(console,'error').mockImplementation((...a:unknown[])=>{errorLog.push(a.map(String).join(' '));});
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});

const get=()=>GET(new NextRequest(`${ORIGIN}/api/graph/chat`));
const post=(body:unknown)=>POST(new NextRequest(`${ORIGIN}/api/graph/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
const fnError=(msg:string)=>new Error(`[Request ID: 0123456789abcdef] Server Error\nUncaught Error: ${msg}\n    at researcher (../convex/authz.ts:124:2)`);
const headerError=(code:string,msg:string)=>new Error(JSON.stringify({code,message:msg}));

describe('GET /api/graph/chat history: success',()=>{
 it('authorised query with zero rows → 200 with an empty history, queried with the caller\'s own token',async()=>{
  const res=await get();
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({history:[],executionAuthority:'none'});
  expect(h.queries).toEqual([{args:{limit:15},auth:TOKEN}]);
 });
 it('authorised query with rows → 200 with exactly those rows',async()=>{
  h.query=async()=>[{turnId:'t1'},{turnId:'t2'}];
  const res=await get();
  expect(res.status).toBe(200);
  expect((await res.json() as {history:unknown[]}).history).toEqual([{turnId:'t1'},{turnId:'t2'}]);
 });
});

const DENIALS:Array<[string,()=>Error,number,string]>=[
 ['Convex: Sign in required',()=>fnError('Sign in required'),401,'invalid_token'],
 ['Convex: Untrusted token authorized party (origin not on the allowlist)',()=>fnError('Untrusted token authorized party'),401,'invalid_token'],
 ['Convex: Untrusted token issuer',()=>fnError('Untrusted token issuer'),401,'invalid_token'],
 ['Convex: Untrusted token audience',()=>fnError('Untrusted token audience'),401,'invalid_token'],
 ['Convex HTTP 401: expired token',()=>headerError('InvalidAuthHeader','Could not validate token: Token expired 3 seconds ago'),401,'token_expired'],
 ['Convex HTTP 401: unknown signing key',()=>headerError('InvalidAuthHeader',"Could not decode token. The JWT's 'kid' header is 'x'"),401,'invalid_token'],
 ['Convex HTTP 401: no matching provider',()=>headerError('NoAuthProvider','No auth provider found matching the given token'),401,'invalid_token'],
 ['Convex: automated actor refused (authz helper)',()=>fnError('Model or automated actors cannot act as researchers or reviewers'),403,'forbidden_identity'],
 ['Convex: automated actor refused (chat module)',()=>fnError('Automated actors cannot invoke interactive research chat'),403,'forbidden_identity'],
];

describe('GET /api/graph/chat history: authentication and ownership denials are not reported as empty history',()=>{
 it.each(DENIALS)('%s → %i %s',async(_n,make,status,code)=>{
  h.query=async()=>{throw make();};
  const res=await get();
  expect(res.status).toBe(status);
  const text=await res.text();
  expect(JSON.parse(text)).toMatchObject({code,executionAuthority:'none'});
  expect(JSON.parse(text)).not.toHaveProperty('history');
  expect(text).not.toMatch(/Request ID|researcher \(|authz\.ts|Uncaught/);
  expect(errorLog).toEqual([]);
 });
});

describe('GET /api/graph/chat history: dependency failures → 503, never 200',()=>{
 it.each([
  ['network failure',()=>new TypeError('fetch failed')],
  ['timeout',()=>Object.assign(new Error('The operation was aborted due to timeout'),{name:'TimeoutError'})],
  ['Convex 5xx / unknown function error',()=>fnError('Something unexpected')],
  ['malformed (non-array) result',null],
 ] as const)('%s → 503 history_unavailable with a redacted log line',async(_n,make)=>{
  if(make)h.query=async()=>{throw make();};else h.query=async()=>({not:'an array'});
  const res=await get();
  expect(res.status).toBe(503);
  expect(res.headers.get('Retry-After')).toBe('30');
  expect(await res.json()).toEqual({error:'Research chat history is temporarily unavailable. Please try again shortly.',code:'history_unavailable',executionAuthority:'none'});
  expect(errorLog).toHaveLength(1);
  expect(errorLog[0]).toContain('[graph/chat] GET history internal error:');
 });

 it('a failure message carrying a token is redacted in the log and absent from the response',async()=>{
  h.query=async()=>{throw new Error(`upstream rejected bearer ${TOKEN}`);};
  const res=await get();
  expect(res.status).toBe(503);
  expect(await res.text()).not.toContain(TOKEN);
  expect(errorLog[0]).toContain('[redacted-jwt]');
  expect(errorLog[0]).not.toContain(TOKEN);
 });

 it('Convex URL not configured → 503, no query attempted',async()=>{
  vi.stubEnv('NEXT_PUBLIC_CONVEX_URL','');
  const res=await get();
  expect(res.status).toBe(503);
  expect(await res.json()).toMatchObject({code:'history_unavailable'});
  expect(h.queries).toEqual([]);
 });

 it('signed in but Clerk returned no token → 503, no query attempted',async()=>{
  h.session={userId:'user_a',token:null};
  const res=await get();
  expect(res.status).toBe(503);
  expect(h.queries).toEqual([]);
 });
});

describe('unauthenticated and invalid callers never reach the history query',()=>{
 it('signed out → 401, no Convex query',async()=>{
  h.session=null;
  expect((await get()).status).toBe(401);
  expect(h.queries).toEqual([]);
 });
 it('expired session token → 401 token_expired, no Convex query',async()=>{
  h.session={userId:'user_a',token:`${b64u({alg:'RS256'})}.${b64u({iss:ISSUER,sub:'user_a',azp:ORIGIN,exp:Math.floor(Date.now()/1000)-5})}.sig`};
  const res=await get();
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({code:'token_expired'});
  expect(h.queries).toEqual([]);
 });
});

describe('POST is independent of the history path',()=>{
 it('a failing history backend does not affect POST: invalid payload → 400 and no history query',async()=>{
  h.query=async()=>{throw new TypeError('fetch failed');};
  const res=await post({question:'x'});
  expect(res.status).toBe(400);
  expect(h.queries).toEqual([]);
 });
 it('signed out POST → 401 regardless of backend state',async()=>{
  h.session=null;h.query=async()=>{throw fnError('Sign in required');};
  expect((await post({question:'Which hyperscalers fund it?'})).status).toBe(401);
 });
});

describe('classifyConvexError',()=>{
 it('classifies the real Convex error shapes seen on the Preview',()=>{
  expect(classifyConvexError(fnError('Untrusted token authorized party'))).toBe('unauthenticated');
  expect(classifyConvexError(headerError('InvalidAuthHeader','Could not validate token: Token expired 6 seconds ago'))).toBe('expired');
  expect(classifyConvexError(headerError('NoAuthProvider','No auth provider found'))).toBe('unauthenticated');
  expect(classifyConvexError(fnError('Record unavailable'))).toBe('forbidden');
  expect(classifyConvexError(new TypeError('fetch failed'))).toBe('unavailable');
  expect(classifyConvexError('weird')).toBe('unavailable');
 });
});
