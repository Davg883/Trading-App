import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import { describe, expect, it } from 'vitest';
import schema from '../convex/schema';
const modules={'./_generated/server.ts':async()=>({}),'./earnings.ts':()=>import('../convex/earnings')};
const ref=(name:string)=>makeFunctionReference<'mutation'>(`earnings:${name}`);
const source={id:'sec',title:'Filing',url:'https://sec.gov/test',publishedAt:100,receivedAt:110,verification:'verified' as const,note:'Test'};
const record={id:'revenue-v1',metric:'revenue',value:10,currency:'USD',unit:'billions',period:'2026-Q3',basis:'GAAP',sourceUrl:source.url,sourceKind:'sec' as const,publishedAt:100,receivedAt:110,verification:'verified' as const,claimType:'fact' as const,role:'actual' as const};
const event={owner:'test|alice',eventKey:'GOOGL_Q3_2026',ticker:'GOOGL',period:'2026-Q3',releaseAt:100,sources:[source]};
describe('earnings persistence',()=>{
  it('requires authentication and isolates another owner',async()=>{
    const t=convexTest(schema,modules);const id=await t.mutation(ref('importEvent'),event);
    await expect(t.query(makeFunctionReference<'query'>('earnings:eventDetail'),{eventId:id})).rejects.toThrow('Sign in');
    await expect(t.withIdentity({tokenIdentifier:'test|bob'}).query(makeFunctionReference<'query'>('earnings:eventDetail'),{eventId:id})).rejects.toThrow('unavailable');
  });
  it('preserves exact retries, rejects conflicting records, and stores revisions separately',async()=>{
    const t=convexTest(schema,modules);const id=await t.mutation(ref('importEvent'),event);
    expect(await t.mutation(ref('importEvent'),event)).toEqual(id);
    const first=await t.mutation(ref('appendMetrics'),{owner:event.owner,eventId:id,records:[record]});
    expect(await t.mutation(ref('appendMetrics'),{owner:event.owner,eventId:id,records:[record]})).toEqual(first);
    await expect(t.mutation(ref('appendMetrics'),{owner:event.owner,eventId:id,records:[{...record,value:20}]})).rejects.toThrow('conflicts');
    await t.mutation(ref('appendMetrics'),{owner:event.owner,eventId:id,records:[{...record,id:'revenue-v2',value:20,supersedes:record.id}]});
    const details=await t.withIdentity({tokenIdentifier:event.owner}).query(makeFunctionReference<'query'>('earnings:eventDetail'),{eventId:id});
    expect(details.metrics).toHaveLength(2);
  });
  it('does not let imported historical receipts backdate workspace snapshots',async()=>{
    const t=convexTest(schema,modules);const id=await t.mutation(ref('importEvent'),event);
    await t.mutation(ref('appendMetrics'),{owner:event.owner,eventId:id,records:[record]});
    const alice=t.withIdentity({tokenIdentifier:event.owner});
    await expect(alice.mutation(ref('freezeSnapshot'),{eventId:id,phase:'post',cutoff:200})).rejects.toThrow('No eligible');
    const snapshot=await alice.mutation(ref('freezeSnapshot'),{eventId:id,phase:'post',cutoff:Date.now()});expect(snapshot).toBeTruthy();
  });
});
