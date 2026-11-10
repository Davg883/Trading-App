import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';
import {grantReviewers} from './helpers/roles';
import * as graphModule from '../convex/graph';
import {createTypeDbDriver,defaultTypeDbConfig,describeTypeDbTransport,probeTypeDbServer,TypeDbConfigurationError} from '../lib/graph/typedb-driver-adapter';
import {authenticationUnavailableResponse,isSessionDependentApiPath} from '../lib/auth/proxy-policy';

/** MVP hardening — work package 4: authentication and runtime configuration. No test here contacts a real service. */
const modules={'./_generated/server.ts':async()=>({}),'./graph.ts':()=>import('../convex/graph'),'./roles.ts':()=>import('../convex/roles'),'./operations.ts':()=>import('../convex/operations')};
const ISSUER='https://issuer.test',A=`${ISSUER}|user_a`,BRIDGE='b'.repeat(48);
const act=(n:string)=>makeFunctionReference<'action'>(`graph:${n}`);
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.useRealTimers();});

describe('WP4 — TypeDB configuration fails closed',()=>{
 it('uses local defaults only for an unconfigured, non-hosted, loopback target',()=>{
  expect(defaultTypeDbConfig('db',{NODE_ENV:'test'})).toMatchObject({httpAddress:'http://127.0.0.1:8000',username:'admin',password:'password'});
  expect(defaultTypeDbConfig('db',{NODE_ENV:'development',TYPEDB_HTTP_ADDRESS:'http://localhost:8000'}).blockedReason).toBeUndefined();
 });
 it('never falls back to admin/password in production, preview or the Convex cloud runtime',()=>{
  for(const env of [{NODE_ENV:'production'},{VERCEL_ENV:'production'},{VERCEL_ENV:'preview'},{CONVEX_CLOUD_URL:'https://x.convex.cloud'}]){
   const c=defaultTypeDbConfig('db',env);
   expect(c.blockedReason,JSON.stringify(env)).toMatch(/not configured/);expect(c.password).toBe('');expect(c.username).toBe('');
   expect(()=>createTypeDbDriver(c)).toThrow(TypeDbConfigurationError);
  }
 });
 it('refuses a remote server without credentials and refuses the default password off-loopback',()=>{
  const missing=defaultTypeDbConfig('db',{NODE_ENV:'test',TYPEDB_HTTP_ADDRESS:'https://cluster.example.test:443'});
  expect(missing.blockedReason).toMatch(/required/);expect(missing.password).toBe('');
  const weak=defaultTypeDbConfig('db',{NODE_ENV:'test',TYPEDB_HTTP_ADDRESS:'https://cluster.example.test:443',TYPEDB_USERNAME:'admin',TYPEDB_PASSWORD:'password'});
  expect(weak.blockedReason).toMatch(/default password/);
  const weakHostedLoopback=defaultTypeDbConfig('db',{NODE_ENV:'production',TYPEDB_HTTP_ADDRESS:'http://127.0.0.1:8000',TYPEDB_USERNAME:'admin',TYPEDB_PASSWORD:'password'});
  expect(weakHostedLoopback.blockedReason).toMatch(/default password/);
  const good=defaultTypeDbConfig('db',{NODE_ENV:'production',TYPEDB_HTTP_ADDRESS:'https://cluster.example.test:443',TYPEDB_USERNAME:'svc',TYPEDB_PASSWORD:'a-real-secret-value'});
  expect(good.blockedReason).toBeUndefined();expect(()=>createTypeDbDriver(good)).not.toThrow();
 });
 it('a blocked configuration makes no network request and reports an unreachable, unauthenticated probe',async()=>{
  const fetchSpy=vi.fn(async()=>{throw new Error('network must not be used');});vi.stubGlobal('fetch',fetchSpy);
  vi.stubEnv('NEXT_PUBLIC_CONVEX_URL','');vi.stubEnv('TYPEDB_BRIDGE_SECRET','');
  const probe=await probeTypeDbServer(defaultTypeDbConfig('db',{NODE_ENV:'production'}));
  expect(probe).toMatchObject({reachable:false,authenticated:false});expect(fetchSpy).not.toHaveBeenCalled();
 });
 it('reports TLS from the connection address scheme, never from a flag or a database name',()=>{
  const cfg=(a:string)=>({httpAddress:a,username:'u',password:'p-secret',databaseName:'aci_macro_intelligence_staging'});
  vi.stubEnv('TYPEDB_TLS_ENABLED','true');
  expect(describeTypeDbTransport(cfg('http://cluster.example.test:80'))).toMatchObject({tlsEnabled:false,scheme:'http',basis:'connection_address_scheme',verified:false});
  vi.stubEnv('TYPEDB_TLS_ENABLED','false');
  expect(describeTypeDbTransport(cfg('https://cluster.example.test:443'))).toMatchObject({tlsEnabled:true,scheme:'https'});
  expect(describeTypeDbTransport({...cfg(''),blockedReason:'x'})).toMatchObject({tlsEnabled:false,configured:false,scheme:'unknown'});
  for(const f of ['app/data-room/page.tsx','app/research-chat/page.tsx','app/api/graph/query/route.ts','convex/graph.ts','convex/operations.ts'])expect(readFileSync(f,'utf8'),f).not.toMatch(/TYPEDB_TLS_ENABLED|databaseName === 'aci_macro|TLS enabled ·/);
 });
 it('no hard-coded deployment URL, user identifier or cluster host remains in the server code',()=>{
  for(const f of ['convex/graph.ts','convex/operations.ts','lib/graph/typedb-driver-adapter.ts'])expect(readFileSync(f,'utf8'),f).not.toMatch(/prestigious-dragon|user_3LjSsu|owner_bootstrap|teoxx0|harmless-akita|benevolent-magpie/);
 });
});

describe('WP4 — graph actions are no longer anonymous',()=>{
 function setup(){vi.stubEnv('TYPEDB_BRIDGE_SECRET',BRIDGE);vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN',ISSUER);vi.stubEnv('TYPEDB_HTTP_ADDRESS','');vi.stubEnv('CONVEX_CLOUD_URL','https://x.convex.cloud');return convexTest(schema,modules);}
 it('bridge actions refuse a missing or wrong credential and are closed when the secret is unset or reused',async()=>{
  const t=setup();
  for(const [name,args] of [['executeReadOnlyCloudTypeQl',{typeql:'match $x isa organisation;'}],['probeHostedTypeDbCloud',{}],['verifyHostedTypeDbCloud',{}]] as const){
   await expect(t.action(act(name),args)).rejects.toThrow('TypeDB bridge credential required');
   await expect(t.action(act(name),{...args,bridgeKey:'x'.repeat(48)})).rejects.toThrow('TypeDB bridge credential required');
   await expect(t.withIdentity({subject:'user_a',tokenIdentifier:A,issuer:ISSUER}).action(act(name),args)).rejects.toThrow('TypeDB bridge credential required');
  }
  vi.stubEnv('TYPEDB_BRIDGE_SECRET','');
  await expect(t.action(act('executeReadOnlyCloudTypeQl'),{typeql:'match $x isa organisation;',bridgeKey:BRIDGE})).rejects.toThrow('not configured');
  vi.stubEnv('TYPEDB_BRIDGE_SECRET',BRIDGE);vi.stubEnv('EVIDENCE_CHAT_GATEWAY_SECRET',BRIDGE);
  await expect(t.action(act('executeReadOnlyCloudTypeQl'),{typeql:'match $x isa organisation;',bridgeKey:BRIDGE})).rejects.toThrow('not configured');
 });
 it('with the credential, write TypeQL is still refused and a blocked TypeDB config is never contacted',async()=>{
  const t=setup();const fetchSpy=vi.fn(async()=>{throw new Error('network must not be used');});vi.stubGlobal('fetch',fetchSpy);
  for(const typeql of ['insert $x isa organisation;','match $x isa organisation; delete $x;','match $x isa organisation; update $x has name "y";'])await expect(t.action(act('executeReadOnlyCloudTypeQl'),{typeql,bridgeKey:BRIDGE})).rejects.toThrow('Security violation');
  const res=await t.action(act('executeReadOnlyCloudTypeQl'),{typeql:'match $x isa organisation;',bridgeKey:BRIDGE}) as {ok:boolean};
  expect(res.ok).toBe(false);expect(fetchSpy).not.toHaveBeenCalled();
 });
 it('the allowlisted query action requires a verified human identity and takes no caller-supplied identity',async()=>{
  const t=setup(),req={requestJson:JSON.stringify({queryType:'not_allowlisted'})};
  await expect(t.action(act('executeAllowlistedCloudGraphQuery'),req)).rejects.toThrow('Sign in required');
  await expect(t.withIdentity({subject:'user_a',tokenIdentifier:A,issuer:ISSUER,actorType:'model'}).action(act('executeAllowlistedCloudGraphQuery'),req)).rejects.toThrow('automated actors');
  await expect(t.withIdentity({subject:'x',tokenIdentifier:'https://evil.test|x',issuer:'https://evil.test'}).action(act('executeAllowlistedCloudGraphQuery'),req)).rejects.toThrow('Untrusted token issuer');
  await expect(t.withIdentity({subject:'user_a',tokenIdentifier:A,issuer:ISSUER}).action(act('executeAllowlistedCloudGraphQuery'),{...req,callerId:'someone-else'} as never)).rejects.toThrow();
 });
 it('projection sync requires an explicit reviewer grant, a human actor and a trusted issuer',async()=>{
  const t=setup();
  await expect(t.action(act('projectPendingOutboxNow'),{})).rejects.toThrow('Authentication required');
  const human=t.withIdentity({subject:'user_a',tokenIdentifier:A,issuer:ISSUER});
  await expect(human.action(act('projectPendingOutboxNow'),{})).rejects.toThrow('Reviewer role required');
  await grantReviewers(t,[A]);
  await expect(t.withIdentity({subject:'user_a',tokenIdentifier:A,issuer:ISSUER,actorType:'agent'}).action(act('projectPendingOutboxNow'),{})).rejects.toThrow('automated actors');
  await expect(t.withIdentity({subject:'user_a',tokenIdentifier:'https://evil.test|user_a',issuer:'https://evil.test'}).action(act('projectPendingOutboxNow'),{})).rejects.toThrow('Untrusted token issuer');
  const ok=await human.action(act('projectPendingOutboxNow'),{}) as {ok:boolean;stage?:string};
  expect(ok).toMatchObject({ok:false,stage:'probe_or_auth_failed'});
 });
 it('maintenance actions are internal and never fall back to a hard-coded owner',async()=>{
  const g=graphModule as unknown as Record<string,{isInternal?:boolean;isPublic?:boolean}>;
  for(const name of ['verifyMacroCase001Cloud','syncAndVerifyTypeDbCloud','reconcileAndVerifyProductionIsolationCloud'])expect(g[name]!.isInternal,name).toBe(true);
  const t=setup();vi.stubEnv('RESEARCH_OWNER_ID','');
  await expect(t.action(act('syncAndVerifyTypeDbCloud'),{})).rejects.toThrow('explicit owner');
  await expect(t.action(act('reconcileAndVerifyProductionIsolationCloud'),{})).rejects.toThrow('explicit owner');
 });
 it('model actors cannot record projection outcomes or query audits',async()=>{
  const t=setup(),model=t.withIdentity({subject:'user_a',tokenIdentifier:A,issuer:ISSUER,actorType:'model'});
  await expect(model.mutation(makeFunctionReference<'mutation'>('graph:recordGraphQueryAudit'),{queryType:'q',parametersJson:'{}',asOfMs:0,nodeCount:0,edgeCount:0,backendMode:'deterministic_mirror',latencyMs:1})).rejects.toThrow('Model or automated actors');
 });
});

describe('WP4 — session proxy and test-only bypasses',()=>{
 it('classifies session-dependent API routes and keeps machine-token routes and pages reachable',()=>{
  for(const p of ['/api/graph/chat','/api/graph/query','/api/brokers','/api/brokers/sync','/api/trading','/api/operations/settings','/api/research/import'])expect(isSessionDependentApiPath(p),p).toBe(true);
  for(const p of ['/api/research/staging','/api/operations/scheduled','/api/brokers/scheduled','/','/data-room','/portfolio','/settings/brokers'])expect(isSessionDependentApiPath(p),p).toBe(false);
  expect(isSessionDependentApiPath('/api/research/staging-other')).toBe(true);
 });
 it('answers 503 without caching when the session layer is unavailable',async()=>{
  const res=authenticationUnavailableResponse();
  expect(res.status).toBe(503);expect(res.headers.get('cache-control')).toBe('no-store');
  expect(await res.json()).toMatchObject({error:'authentication_unavailable'});
 });
 it('proxy: an unconfigured session layer fails closed for API routes in production only',async()=>{
  vi.resetModules();vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','');vi.stubEnv('CLERK_SECRET_KEY','');vi.stubEnv('NEXT_PUBLIC_CLERK_PROXY_URL','');
  const {NextRequest}=await import('next/server');const proxy=(await import('../proxy')).default;
  const run=(path:string)=>proxy(new NextRequest(`https://capital.aiguides.co.uk${path}`),{} as never);
  vi.stubEnv('NODE_ENV','production');
  expect((await run('/api/graph/chat'))!.status).toBe(503);expect((await run('/api/brokers'))!.status).toBe(503);
  expect((await run('/api/operations/scheduled'))!.status).toBe(200);expect((await run('/data-room'))!.status).toBe(200);
  vi.stubEnv('NODE_ENV','development');
  expect((await run('/api/graph/chat'))!.status).toBe(200);
 });
 it('the x-aci-test-caller bypass exists only under the test runner, not on localhost hosts or hosted builds',()=>{
  for(const f of ['app/api/graph/chat/route.ts','app/api/graph/query/route.ts']){
   const src=readFileSync(f,'utf8');
   expect(src,f).toMatch(/process\.env\.NODE_ENV === 'test' && !process\.env\.VERCEL_ENV/);
   expect(src,f).not.toMatch(/\['localhost', '127\.0\.0\.1'\]\.includes/);
  }
 });
});

describe('WP4 — status rows do not assert unverified facts',()=>{
 it('owner overview: declarative rows carry no fabricated verification time and TLS reflects the address',async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(Date.parse('2026-11-10T12:00:00Z'));
  vi.stubEnv('TYPEDB_HTTP_ADDRESS','http://cluster.example.test:80');vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN',ISSUER);
  const t=convexTest(schema,modules);
  const o=await t.withIdentity({subject:'user_a',tokenIdentifier:A,issuer:ISSUER}).query(makeFunctionReference<'query'>('operations:overview'),{}) as {health:{environmentAudit:Array<{serviceId:string;lastVerifiedAt:number|null;detail:string;environmentTarget:string}>}};
  const row=(id:string)=>o.health.environmentAudit.find(s=>s.serviceId===id)!;
  for(const id of ['vercel_production','clerk_production','live_demo_execution'])expect(row(id).lastVerifiedAt,id).toBeNull();
  expect(row('typedb_cloud').detail).toContain('no TLS configured');expect(row('typedb_cloud').detail).not.toContain('TLS enabled');
  expect(row('live_demo_execution').environmentTarget).toBe('Research-only build (executionAuthority: none)');
 });
});
