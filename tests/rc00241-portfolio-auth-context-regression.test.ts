import {afterEach,describe,expect,it,vi} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';
import {resolveClerkConvexToken,resetConvexTemplateCacheForTests} from '../lib/clerk-convex-auth';

const modules={
 './_generated/server.ts':async()=>({}),
 './portfolio.ts':()=>import('../convex/portfolio'),
 './trading.ts':()=>import('../convex/trading'),
 './operations.ts':()=>import('../convex/operations'),
 './brokers.ts':()=>import('../convex/brokers'),
};

const portfolioOverviewRef=makeFunctionReference<'query'>('portfolio:overview');
const tradingOverviewRef=makeFunctionReference<'query'>('trading:overview');
const operationsOverviewRef=makeFunctionReference<'query'>('operations:overview');

const ISSUER='https://clerk.capital.aiguides.co.uk';
const OWNER_A=`${ISSUER}|user_prod_owner_a`;
const OWNER_B=`${ISSUER}|user_prod_owner_b`;

function makeJwt(payload:Record<string,unknown>):string{
 const header=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
 const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
 return `${header}.${body}.sig`;
}

afterEach(()=>{
 resetConvexTemplateCacheForTests();
 vi.unstubAllEnvs();
 vi.restoreAllMocks();
});

describe('RC002.4.1 — Production portfolio:overview Missing token application context incident regression',()=>{
 it('reproduces the exact Production failure when Convex OIDC strips aud from an azp-less convex template JWT',async()=>{
  vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN',ISSUER);
  const t=convexTest(schema,modules);

  // Real Convex Cloud OIDC provider verifies aud==="convex" and strips `aud` from UserIdentity.
  // Because Clerk's Production `convex` template omits `azp`, UserIdentity arrives with neither `aud` nor `azp`.
  const strippedOidcIdentity=t.withIdentity({
   issuer:ISSUER,
   subject:'user_prod_owner_a',
   tokenIdentifier:OWNER_A,
  });

  await expect(strippedOidcIdentity.query(portfolioOverviewRef,{})).rejects.toThrow('Missing token application context');
  await expect(strippedOidcIdentity.query(tradingOverviewRef,{})).rejects.toThrow('Missing token application context');
  await expect(strippedOidcIdentity.query(operationsOverviewRef,{})).rejects.toThrow('Missing token application context');
 });

 it('selects the azp-bearing Clerk session token in Production so portfolio:overview succeeds fail-closed without weakening authz',async()=>{
  vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN',ISSUER);
  const templateJwtWithoutAzp=makeJwt({iss:ISSUER,sub:'user_prod_owner_a',aud:'convex'});
  const defaultSessionJwtWithAzp=makeJwt({iss:ISSUER,sub:'user_prod_owner_a',azp:'https://capital.aiguides.co.uk'});

  const getToken=vi.fn(async(opts?:{template?:'convex';skipCache?:boolean})=>
   opts?.template==='convex'?templateJwtWithoutAzp:defaultSessionJwtWithAzp,
  );
  const selected=await resolveClerkConvexToken(
   getToken,
   {template:'convex',skipCache:false},
   'sess_prod_live',
   {expectedIssuers:[ISSUER]},
  );
  expect(selected).toBe(defaultSessionJwtWithAzp);

  // With the azp-bearing session token, Convex customJwt preserves `azp` on UserIdentity and all 3 queries succeed
  const t=convexTest(schema,modules);
  const authedA=t.withIdentity({
   issuer:ISSUER,
   subject:'user_prod_owner_a',
   tokenIdentifier:OWNER_A,
   azp:'https://capital.aiguides.co.uk',
  });

  const portfolio=await authedA.query(portfolioOverviewRef,{}) as {
   live:{connection:unknown;snapshot:unknown;valuations:unknown[];flows:unknown[]};
   demo:{connection:unknown;snapshot:unknown;valuations:unknown[];flows:unknown[]};
  };
  expect(portfolio.live.connection).toBeNull();
  expect(portfolio.live.snapshot).toBeNull();
  expect(portfolio.live.valuations).toEqual([]);
  expect(portfolio.live.flows).toEqual([]);
  expect(portfolio.demo.connection).toBeNull();
 });

 it('returns owner-scoped portfolio holdings & valuations, isolates cross-user data, and handles unavailable snapshots cleanly',async()=>{
  vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN',ISSUER);
  const t=convexTest(schema,modules);
  const now=Date.parse('2026-11-19T18:10:00Z');

  await t.run(async(ctx)=>{
   const liveConnId=await ctx.db.insert('brokerConnections',{
    owner:OWNER_A,
    provider:'trading212',
    environment:'live',
    status:'connected',
    maskedKey:'t212_****1234',
    revision:2,
    lastSuccessfulSyncAt:now-60_000,
    lastVerifiedAt:now-60_000,
    lastAttemptAt:now-60_000,
    lastErrorCode:null,
    nextAllowedAt:now,
    leaseToken:null,
    leaseUntil:0,
    leaseNumber:1,
    operation:null,
    rateLimitJson:'{}',
    createdAt:now-86_400_000,
    updatedAt:now-60_000,
   });
   await ctx.db.insert('brokerSnapshots',{
    owner:OWNER_A,
    connectionId:liveConnId,
    environment:'live',
    revision:2,
    retrievedAt:now-60_000,
    operation:'sync',
    snapshotJson:JSON.stringify({currency:'GBP',totalValue:12500.5,positions:[{ticker:'NVDA',quantity:10}]}),
   });
   await ctx.db.insert('accountValuations',{
    owner:OWNER_A,
    environment:'live',
    connectionId:liveConnId,
    observedAt:now-60_000,
    currency:'GBP',
    totalValue:12500.5,
    cash:2500.5,
    investedCost:9000,
    investmentsValue:10000,
    realisedProfitLoss:150,
    unrealisedProfitLoss:1000,
    source:'broker_snapshot',
   });
   await ctx.db.insert('accountCashFlows',{
    owner:OWNER_A,
    environment:'live',
    reference:'dep-001',
    type:'deposit',
    amount:9000,
    currency:'GBP',
    occurredAt:now-86_400_000,
    observedAt:now-60_000,
   });
   // Demo connection with NO snapshot (unavailable/degraded broker state)
   await ctx.db.insert('brokerConnections',{
    owner:OWNER_A,
    provider:'trading212',
    environment:'demo',
    status:'error',
    maskedKey:'t212_****9999',
    revision:1,
    lastSuccessfulSyncAt:null,
    lastVerifiedAt:null,
    lastAttemptAt:now-30_000,
    lastErrorCode:'rate_limited',
    nextAllowedAt:now+60_000,
    leaseToken:null,
    leaseUntil:0,
    leaseNumber:1,
    operation:null,
    rateLimitJson:'{}',
    createdAt:now-3600_000,
    updatedAt:now-30_000,
   });
  });

  const authedA=t.withIdentity({
   issuer:ISSUER,
   subject:'user_prod_owner_a',
   tokenIdentifier:OWNER_A,
   azp:'https://capital.aiguides.co.uk',
  });
  const authedB=t.withIdentity({
   issuer:ISSUER,
   subject:'user_prod_owner_b',
   tokenIdentifier:OWNER_B,
   azp:'https://capital.aiguides.co.uk',
  });

  const resA=await authedA.query(portfolioOverviewRef,{}) as {
   live:{connection:{maskedKey:string;status:string};snapshot:{totalValue:number};valuations:unknown[];flows:unknown[]};
   demo:{connection:{status:string;lastErrorCode:string};snapshot:unknown};
  };
  expect(resA.live.connection.maskedKey).toBe('t212_****1234');
  expect(resA.live.snapshot.totalValue).toBe(12500.5);
  expect(resA.live.valuations.length).toBe(1);
  expect(resA.live.flows.length).toBe(1);
  expect(resA.demo.connection.status).toBe('error');
  expect(resA.demo.connection.lastErrorCode).toBe('rate_limited');
  expect(resA.demo.snapshot).toBeNull();

  // Cross-user isolation: Owner B sees zero Owner A data
  const resB=await authedB.query(portfolioOverviewRef,{}) as {
   live:{connection:unknown;snapshot:unknown;valuations:unknown[];flows:unknown[]};
   demo:{connection:unknown;snapshot:unknown;valuations:unknown[];flows:unknown[]};
  };
  expect(resB.live.connection).toBeNull();
  expect(resB.live.snapshot).toBeNull();
  expect(resB.live.valuations).toEqual([]);
  expect(resB.live.flows).toEqual([]);
  expect(resB.demo.connection).toBeNull();

  // Anonymous & untrusted azp fail closed
  await expect(t.query(portfolioOverviewRef,{})).rejects.toThrow('Sign in required');
  const untrustedAzp=t.withIdentity({
   issuer:ISSUER,
   subject:'user_prod_owner_a',
   tokenIdentifier:OWNER_A,
   azp:'https://evil.example.com',
  });
  await expect(untrustedAzp.query(portfolioOverviewRef,{})).rejects.toThrow('Untrusted token authorized party');
 });
});
