import {afterEach,describe,expect,it,vi} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';
import request from '../data/policy-risk/midterm-2026-11-03-request.json';
import {readFileSync} from 'node:fs';
import type {PolicyObservationSet} from '../lib/policy-risk';

const modules={'./_generated/server.ts':async()=>({}),'./policyRisk.ts':()=>import('../convex/policyRisk')};
const mutation=(name:string)=>makeFunctionReference<'mutation'>(`policyRisk:${name}`),query=(name:string)=>makeFunctionReference<'query'>(`policyRisk:${name}`);
const owner='test|alice',hour=3_600_000,ingest=Date.parse('2026-11-05T16:00:00Z');
const caseJson=JSON.stringify(request.case);
const close=(day:string)=>Date.parse(`${day}T21:00:00Z`);
const tickers=['APLD','WULF','CRWV','IREN','CIFR','AMZN','MSFT','GOOGL','META','ORCL','NVDA','AMD','AVGO','VT','SPY','QQQ'];

/** Clearly labelled test fixture closes (not market observations) for the four sessions after 4 November. */
function observationSet(capturedAt:number,extra:Partial<PolicyObservationSet>={},provider='Nasdaq public historical table'):PolicyObservationSet{
 const source={id:'test-fixture-closes',title:'Unit-test fixture closes (not market data)',url:'https://example.test/fixture',kind:'market_data' as const,authority:'secondary' as const,publishedAt:null,publicationDate:null,publicationBasis:'retrieval_upper_bound' as const,receivedAt:capturedAt,role:'evidence' as const,usage:'unknown' as const,mode:'retrospective' as const};
 const prices=tickers.flatMap(ticker=>['2026-11-05','2026-11-06','2026-11-09','2026-11-10'].map((day,i)=>({id:`fixture-${ticker}-${day}`,ticker,eventAt:close(day),close:100+i,currency:'USD' as const,priceBasis:'unadjusted_close' as const,provider,sourceIds:['test-fixture-closes'],publishedAt:null,receivedAt:capturedAt,mode:'retrospective' as const})));
 return {id:'fixture-set',capturedAt,sources:[source],prices,...extra};
}
function setup(){vi.useFakeTimers();vi.setSystemTime(ingest);const t=convexTest(schema,modules);return {t,alice:t.withIdentity({tokenIdentifier:owner,subject:'alice',actorType:'human'}),bob:t.withIdentity({tokenIdentifier:'test|bob',subject:'bob',actorType:'human'})};}
afterEach(()=>vi.useRealTimers());

describe('Benchmark 001.2 Convex persistence',()=>{
 it('keeps import internal, owner-scoped and immutable per source version',async()=>{
  const {t,alice,bob}=setup();await expect(t.query(query('list'),{})).rejects.toThrow('Sign in required');
  const id=await t.mutation(mutation('importCase'),{owner,externalId:'policy-risk-v1',caseJson});
  expect(await t.mutation(mutation('importCase'),{owner,externalId:'policy-risk-v1',caseJson})).toBe(id);
  const changed=JSON.parse(caseJson);changed.name='Edited';await expect(t.mutation(mutation('importCase'),{owner,externalId:'policy-risk-v1',caseJson:JSON.stringify(changed)})).rejects.toThrow('append a new source version');
  expect(await alice.query(query('list'),{})).toHaveLength(1);expect(await bob.query(query('list'),{})).toHaveLength(0);
  await expect(bob.query(query('detail'),{caseId:id})).rejects.toThrow('Record unavailable');
 });
 it('rejects receipts or publication later than actual ingestion',async()=>{
  const {t}=setup();vi.setSystemTime(Date.parse('2026-11-05T12:00:00Z'));
  await expect(t.mutation(mutation('importCase'),{owner,externalId:'early',caseJson})).rejects.toThrow('Future receipt or publication');
 });
 it('registers a frozen retrospective study only from evidence available at its cutoff',async()=>{
  const {t,alice}=setup();const caseId=await t.mutation(mutation('importCase'),{owner,externalId:'policy-risk-v1',caseJson});
  await expect(alice.mutation(mutation('register'),{caseId,name:'too early',cutoff:ingest-hour,basis:'receipt'})).rejects.toThrow('imported into this workspace after the cutoff');
  await expect(alice.mutation(mutation('register'),{caseId,name:'anchor',cutoff:request.case.anchorAt,basis:'publication'})).rejects.toThrow('was not available at the cutoff');
  await expect(alice.mutation(mutation('register'),{caseId,name:'future',cutoff:ingest+hour,basis:'receipt'})).rejects.toThrow('cannot be in the future');
  const registrationId=await alice.mutation(mutation('register'),{caseId,name:'Study',cutoff:ingest,basis:'receipt'});
  const detail=await alice.query(query('detail'),{caseId}) as {registrations:{registrationId:string;experimentMode:string;registration:{priorForecast:boolean;windows:unknown[];executionAuthority:string}}[]};
  const r=detail.registrations.find(x=>x.registrationId===registrationId)!;expect(r.experimentMode).toBe('retrospective_research');expect(r.registration.priorForecast).toBe(false);expect(r.registration.windows).toHaveLength(24);expect(r.registration.executionAuthority).toBe('none');
 });
 it('appends independently versioned observations and recomputes outcomes without caller-supplied scores',async()=>{
  const {t,alice}=setup();const caseId=await t.mutation(mutation('importCase'),{owner,externalId:'policy-risk-v1',caseJson});const registrationId=await alice.mutation(mutation('register'),{caseId,name:'Study',cutoff:ingest,basis:'receipt'});
  vi.setSystemTime(Date.parse('2026-11-11T12:00:00Z'));const capturedAt=Date.parse('2026-11-11T11:00:00Z');
  const bad=observationSet(capturedAt);bad.prices[0]={...bad.prices[0],ticker:'TSLA',id:'x-TSLA'};
  await expect(t.mutation(mutation('importObservations'),{owner,registrationId,externalId:'bad',observationJson:JSON.stringify(bad)})).rejects.toThrow('frozen comparison groups');
  const before=await t.mutation(mutation('evaluateOutcomes'),{owner,registrationId,asOf:Date.parse('2026-11-11T11:30:00Z')});
  const obsId=await t.mutation(mutation('importObservations'),{owner,registrationId,externalId:'closes-2026-11-10',observationJson:JSON.stringify(observationSet(capturedAt))});
  expect(await t.mutation(mutation('importObservations'),{owner,registrationId,externalId:'closes-2026-11-10',observationJson:JSON.stringify(observationSet(capturedAt))})).toBe(obsId);
  const changed=observationSet(capturedAt);changed.prices[0]={...changed.prices[0],close:999};await expect(t.mutation(mutation('importObservations'),{owner,registrationId,externalId:'closes-2026-11-10',observationJson:JSON.stringify(changed)})).rejects.toThrow('Immutable observation set');
  const asOf=Date.now();const after=await t.mutation(mutation('evaluateOutcomes'),{owner,registrationId,asOf});expect(await t.mutation(mutation('evaluateOutcomes'),{owner,registrationId,asOf})).toBe(after);
  await expect(t.mutation(mutation('evaluateOutcomes'),{owner,registrationId,asOf:Date.now()+hour})).rejects.toThrow('cannot be in the future');
  const detail=await alice.query(query('detail'),{caseId}) as {registrations:{outcomes:{outcomeId:string;report:{outcomes:{horizon:number;status:string}[];hypotheses:{horizon:number;status:string}[]}}[]}[]};
  const reports=Object.fromEntries(detail.registrations[0].outcomes.map(o=>[o.outcomeId,o.report]));
  expect(reports[before].outcomes.filter(o=>o.horizon===5).every(o=>o.status==='pending')).toBe(true);
  expect(reports[after].outcomes.filter(o=>o.horizon===5).every(o=>o.status==='complete')).toBe(true);expect(reports[after].outcomes.filter(o=>o.horizon===20).every(o=>o.status==='pending')).toBe(true);
  expect(reports[after].hypotheses.filter(h=>h.horizon===5).every(h=>h.status!=='pending')).toBe(true);
 });
 it('keeps windows pending when a later observation set switches provider',async()=>{
  const {t,alice}=setup();const caseId=await t.mutation(mutation('importCase'),{owner,externalId:'policy-risk-v1',caseJson});const registrationId=await alice.mutation(mutation('register'),{caseId,name:'Study',cutoff:ingest,basis:'receipt'});
  vi.setSystemTime(Date.parse('2026-11-11T12:00:00Z'));await t.mutation(mutation('importObservations'),{owner,registrationId,externalId:'other-provider',observationJson:JSON.stringify(observationSet(Date.parse('2026-11-11T11:00:00Z'),{},'Different test provider'))});
  const id=await t.mutation(mutation('evaluateOutcomes'),{owner,registrationId,asOf:Date.now()});
  const detail=await alice.query(query('detail'),{caseId}) as {registrations:{outcomes:{outcomeId:string;report:{outcomes:{horizon:number;status:string;reason:string|null}[]}}[]}[]};
  const report=detail.registrations[0].outcomes.find(o=>o.outcomeId===id)!.report;expect(report.outcomes.filter(o=>o.horizon===5).every(o=>o.status==='pending'&&/provider/.test(o.reason??''))).toBe(true);
 });
 it('keeps a conflicting re-capture of a registered close pending rather than choosing a value',async()=>{
  const {t,alice}=setup();const caseId=await t.mutation(mutation('importCase'),{owner,externalId:'policy-risk-v1',caseJson});const registrationId=await alice.mutation(mutation('register'),{caseId,name:'Study',cutoff:ingest,basis:'receipt'});
  vi.setSystemTime(Date.parse('2026-11-11T12:00:00Z'));const capturedAt=Date.parse('2026-11-11T11:00:00Z'),set=observationSet(capturedAt);
  set.prices.push({...set.prices[0],id:'conflict-APLD-2026-11-04',eventAt:Date.parse('2026-11-04T21:00:00Z'),close:1});
  await t.mutation(mutation('importObservations'),{owner,registrationId,externalId:'conflict',observationJson:JSON.stringify(set)});
  const id=await t.mutation(mutation('evaluateOutcomes'),{owner,registrationId,asOf:Date.now()});
  const detail=await alice.query(query('detail'),{caseId}) as {registrations:{outcomes:{outcomeId:string;report:{outcomes:{groupId:string;horizon:number;status:string}[]}}[]}[]};
  const report=detail.registrations[0].outcomes.find(o=>o.outcomeId===id)!.report;
  expect(report.outcomes.find(o=>o.groupId==='developers'&&o.horizon===1)!.status).toBe('pending');expect(report.outcomes.find(o=>o.groupId==='hyperscalers'&&o.horizon===1)!.status).toBe('complete');
 });
 it('creates no ledger, order or brokerage records',async()=>{
  const {t,alice}=setup();const caseId=await t.mutation(mutation('importCase'),{owner,externalId:'policy-risk-v1',caseJson});await alice.mutation(mutation('register'),{caseId,name:'Study',cutoff:ingest,basis:'receipt'});
  await t.run(async ctx=>{for(const table of ['portfolios','proposals','fills','quotes','forecasts','brokerConnections'] as const)expect(await ctx.db.query(table).collect()).toEqual([]);});
  expect(readFileSync('convex/policyRisk.ts','utf8')).not.toMatch(/['"](?:fills|proposals|portfolios|quotes|brokerConnections)['"]/);
 });
});
