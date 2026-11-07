import { convexTest } from 'convex-test';
import {grantReviewers} from './helpers/roles';
import { makeFunctionReference } from 'convex/server';
import { describe, expect, it } from 'vitest';
import schema from '../convex/schema';
import type { GenericId } from 'convex/values';
const modules = { './_generated/server.ts':async()=>({}), './research.ts':()=>import('../convex/research') };
const query=makeFunctionReference<'query'>('research:dashboard');
const create=makeFunctionReference<'mutation'>('research:createPortfolio');
const propose=makeFunctionReference<'mutation'>('research:propose');
const review=makeFunctionReference<'mutation'>('research:review');
const execute=makeFunctionReference<'mutation'>('research:executePaper');
describe('Convex authorization and atomic ledger',()=>{
  it('rejects unauthenticated reads and writes',async()=>{const t=convexTest(schema,modules);await expect(t.query(query,{})).rejects.toThrow('Sign in required');await expect(t.mutation(create,{name:'Pilot',capitalGbp:10000})).rejects.toThrow('Sign in required');});
  it('isolates owners and rejects cross-owner proposals',async()=>{const t=convexTest(schema,modules);const alice=t.withIdentity({subject:'alice'}),bob=t.withIdentity({subject:'bob'});const id=await alice.mutation(create,{name:'Alice',capitalGbp:10000});expect((await bob.query(query,{})).portfolios).toHaveLength(0);await expect(bob.mutation(propose,{portfolioId:id,symbol:'MSFT',quantity:1,reason:'Test'})).rejects.toThrow('Record unavailable');});
  it('requires approval, post-approval price and fills only once',async()=>{
    const t=convexTest(schema,modules);await grantReviewers(t,['test|alice']);const alice=t.withIdentity({subject:'alice',issuer:'test',tokenIdentifier:'test|alice'});
    const portfolioId=await alice.mutation(create,{name:'Pilot',capitalGbp:10000});
    const proposalId=await alice.mutation(propose,{portfolioId,symbol:'MSFT',quantity:1,reason:'Evidence-backed hypothesis'});
    await expect(alice.mutation(execute,{proposalId})).rejects.toThrow('Human approval required');
    await alice.mutation(review,{proposalId,decision:'approve',note:'Reviewed evidence'});
    await expect(alice.mutation(execute,{proposalId})).rejects.toThrow('post-approval quote');
    await t.run(async ctx=>{await ctx.db.insert('quotes',{owner:'test|alice',symbol:'MSFT',priceUsd:100,usdToGbp:.8,observedAt:Date.now(),receivedAt:Date.now(),source:'synthetic test',synthetic:true});});
    const first=await alice.mutation(execute,{proposalId});const second=await alice.mutation(execute,{proposalId});expect(second).toBe(first);
    await t.run(async ctx=>{const fills=await ctx.db.query('fills').collect();expect(fills).toHaveLength(1);const portfolio=await ctx.db.get(portfolioId as GenericId<'portfolios'>);expect(portfolio?.cashGbp).toBeCloseTo(10000+fills[0].cashDeltaGbp);});
  });
  it('rejects future evidence at snapshot time',async()=>{const t=convexTest(schema,modules);await grantReviewers(t,['test|alice']);const alice=t.withIdentity({subject:'alice',issuer:'test',tokenIdentifier:'test|alice'});const cutoff=Date.now()-1000;const id=await t.run(ctx=>ctx.db.insert('evidence',{owner:'test|alice',source:'test',symbol:'MSFT',metric:'revenue',value:10,unit:'USD',period:'Q1',definition:'reported revenue',status:'reported',publishedAt:cutoff-1,receivedAt:cutoff+1}));await expect(alice.mutation(makeFunctionReference<'mutation'>('research:freezeExperiment'),{name:'Pilot',cutoff,evidenceIds:[id],protocol:'fixed'})).rejects.toThrow('unavailable at cutoff');});
  it('keeps synthetic and observed paper accounts separate',async()=>{
    const t=convexTest(schema,modules),alice=t.withIdentity({subject:'alice',issuer:'test',tokenIdentifier:'test|alice'});await grantReviewers(t,['test|alice']);
    const portfolioId=await alice.mutation(create,{name:'Observed only',capitalGbp:10000,synthetic:false});
    const proposalId=await alice.mutation(propose,{portfolioId,symbol:'MSFT',quantity:1,reason:'Test'});
    await alice.mutation(review,{proposalId,decision:'approve',note:'Review'});
    await t.run(ctx=>ctx.db.insert('quotes',{owner:'test|alice',symbol:'MSFT',priceUsd:100,usdToGbp:.8,observedAt:Date.now(),receivedAt:Date.now(),source:'test',synthetic:true}));
    await expect(alice.mutation(execute,{proposalId})).rejects.toThrow('post-approval quote');
    await t.run(async ctx=>{expect(await ctx.db.query('fills').collect()).toHaveLength(0);});
  });
  it('rejects late forecast submissions',async()=>{
    const t=convexTest(schema,modules);
    const experimentId=await t.run(ctx=>ctx.db.insert('experiments',{owner:'test|alice',name:'Expired',cutoff:Date.now()-10000,evidenceIds:[],protocol:'fixed',protocolVersion:'v1',deadline:Date.now()-1,createdAt:Date.now()-10000}));
    await expect(t.mutation(makeFunctionReference<'mutation'>('research:recordForecast'),{owner:'test|alice',experimentId,participant:'test',modelVersion:'test-1',horizon:'1d',probabilities:[.5,.3,.2],expectedReturn:.01,lower:-.02,upper:.03,evidenceIds:[],explanation:'Test',invalidation:'Test',decision:'no-trade',inputTokens:10,outputTokens:10,cachedTokens:0,costGbp:.01,latencyMs:10,idempotencyKey:'late'})).rejects.toThrow('deadline passed');
  });
});


describe('quote selection and immutable retries',()=>{
  it('selects eligible observed quotes even when a newer synthetic quote exists',async()=>{
    const t=convexTest(schema,modules),alice=t.withIdentity({subject:'alice',issuer:'test',tokenIdentifier:'test|alice'});await grantReviewers(t,['test|alice']);
    const portfolioId=await alice.mutation(create,{name:'Observed',capitalGbp:10000,synthetic:false});
    const proposalId=await alice.mutation(propose,{portfolioId,symbol:'MSFT',quantity:1,reason:'Source checked'});
    await alice.mutation(review,{proposalId,decision:'approve',note:'Approved'});
    await t.run(async ctx=>{
      const proposal=await ctx.db.get(proposalId as GenericId<'proposals'>);
      await ctx.db.insert('quotes',{owner:'test|alice',symbol:'MSFT',priceUsd:100,usdToGbp:.8,observedAt:proposal!.approvedAt!,receivedAt:Date.now(),source:'observed',synthetic:false});
      await ctx.db.insert('quotes',{owner:'test|alice',symbol:'MSFT',priceUsd:150,usdToGbp:.8,observedAt:Date.now(),receivedAt:Date.now(),source:'demo',synthetic:true});
    });
    const fillId=await alice.mutation(execute,{proposalId});
    await t.run(async ctx=>{
      const fill=await ctx.db.get(fillId as GenericId<'fills'>);
      expect(fill?.synthetic).toBe(false);
      expect(fill?.executionPriceUsd).toBeCloseTo(100.1);
    });
  });
  it('accepts exact forecast retries after deadline but rejects changed payloads and experiments',async()=>{
    const t=convexTest(schema,modules);
    const setup=await t.run(async ctx=>{
      const now=Date.now();
      const evidenceId=await ctx.db.insert('evidence',{owner:'test|alice',source:'test',symbol:'MSFT',metric:'revenue',value:1,unit:'USD',period:'Q1',definition:'revenue',status:'reported',publishedAt:now-1000,receivedAt:now-1000});
      const data={owner:'test|alice',name:'A',cutoff:now,evidenceIds:[evidenceId],protocol:'fixed',protocolVersion:'v1',deadline:now+60000,createdAt:now};
      const experimentId=await ctx.db.insert('experiments',data);
      const otherExperimentId=await ctx.db.insert('experiments',{...data,name:'B'});
      return {evidenceId,experimentId,otherExperimentId};
    });
    const record=makeFunctionReference<'mutation'>('research:recordForecast');
    const args={owner:'test|alice',experimentId:setup.experimentId,participant:'model',modelVersion:'version-1',horizon:'1d',probabilities:[.5,.3,.2],expectedReturn:.01,lower:-.02,upper:.03,evidenceIds:[setup.evidenceId],explanation:'Evidence checked',invalidation:'Margin miss',decision:'no-trade',inputTokens:10,outputTokens:10,cachedTokens:0,costGbp:.01,latencyMs:10,idempotencyKey:'run-1'};
    const first=await t.mutation(record,args);
    await t.run(async ctx=>{await ctx.db.patch(setup.experimentId,{deadline:Date.now()-1});});
    expect(await t.mutation(record,args)).toBe(first);
    await expect(t.mutation(record,{...args,expectedReturn:.02})).rejects.toThrow('Idempotency key conflicts');
    await expect(t.mutation(record,{...args,experimentId:setup.otherExperimentId})).rejects.toThrow('Idempotency key conflicts');
    await t.run(async ctx=>{expect(await ctx.db.query('forecasts').collect()).toHaveLength(1);});
  });
});
