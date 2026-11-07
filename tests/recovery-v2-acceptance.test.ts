import {afterEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
vi.mock('@clerk/nextjs/server',()=>({auth:vi.fn()}));
import {mkdtempSync,mkdirSync,copyFileSync,appendFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';
import {preparePackage,RESEARCH_PACKAGES} from '../lib/research-packages';
import {assertSameOrigin} from '../lib/research-import-server';
import request from '../data/recovery/november-3-2026-v2-request.json';
import {parseRecoveryCase,classifyRecoveryCase,buildRecoveryRegistration,evaluateRecoveryWindow} from '../lib/market-recovery';

const modules={'./_generated/server.ts':async()=>({}),'./recovery.ts':()=>import('../convex/recovery')};
const m=(n:string)=>makeFunctionReference<'mutation'>(`recovery:${n}`),q=(n:string)=>makeFunctionReference<'query'>(`recovery:${n}`);
afterEach(()=>vi.useRealTimers());

describe('Case 006 v2 acceptance: pinned packages',()=>{
 it('pins reproducible hashes and keeps every package below the Convex import limit',()=>{
  for(const id of Object.keys(RESEARCH_PACKAGES)){const p=preparePackage(id);expect(p.fileSha256).toMatch(/^[0-9a-f]{64}$/);expect(p.canonicalSha256).toMatch(/^[0-9a-f]{64}$/);expect(p.bytes).toBeLessThan(p.limitBytes);expect(preparePackage(id)).toEqual(p);}
  const v1=preparePackage('recovery-006-2026-11-03-source-v1'),v2=preparePackage('recovery-006-2026-11-03-source-v2');
  expect(v2.externalId).not.toBe(v1.externalId);expect(v2.canonicalSha256).not.toBe(v1.canonicalSha256);expect(v2.note).toMatch(/not an authentic 3 Nov forecast/);
 });
 it('refuses unknown identifiers and any changed package bytes',()=>{
  expect(()=>preparePackage('recovery-006-2026-11-03-source-v3')).toThrow('Unknown research package');
  expect(()=>preparePackage('__proto__')).toThrow('Unknown research package');
  const root=mkdtempSync(path.join(tmpdir(),'pkg-'));mkdirSync(path.join(root,'data/recovery'),{recursive:true});const target=path.join(root,'data/recovery/november-3-2026-v2.json');
  copyFileSync('data/recovery/november-3-2026-v2.json',target);expect(preparePackage('recovery-006-2026-11-03-source-v2',root).fileSha256).toBe(RESEARCH_PACKAGES['recovery-006-2026-11-03-source-v2'].sha256);
  appendFileSync(target,' ');expect(()=>preparePackage('recovery-006-2026-11-03-source-v2',root)).toThrow('pinned hash');
 });
 it('accepts only same-origin import requests',()=>{
  const req=(origin:string|null,site='same-origin')=>new Request('https://app.example/api/research/import',{method:'POST',headers:{...(origin?{origin}:{}),'sec-fetch-site':site}});
  const env={NODE_ENV:'production',RESEARCH_APP_ORIGIN:'https://app.example'};
  expect(()=>assertSameOrigin(req('https://app.example'),env)).not.toThrow();
  expect(()=>assertSameOrigin(req('https://evil.example'),env)).toThrow('must come from the application');
  expect(()=>assertSameOrigin(req('https://app.example','cross-site'),env)).toThrow('must come from the application');
  expect(()=>assertSameOrigin(req('https://app.example'),{NODE_ENV:'production',RESEARCH_APP_ORIGIN:'http://app.example'})).toThrow('invalid');
 });
});

describe('Case 006 v2 acceptance: Convex import',()=>{
 it('imports v2 under a new source identifier beside an unchanged v1, preserving later receipt times',async()=>{
  vi.useFakeTimers();vi.setSystemTime(Date.parse('2026-11-05T16:00:00Z'));const t=convexTest(schema,modules),owner='test|alice',alice=t.withIdentity({tokenIdentifier:owner,subject:'alice',actorType:'human'});
  expect(await alice.query(q('viewer'),{})).toEqual({owner});await expect(t.query(q('viewer'),{})).rejects.toThrow('Sign in required');
  const v1=preparePackage('recovery-006-2026-11-03-source-v1'),v2=preparePackage('recovery-006-2026-11-03-source-v2');
  const id1=await t.mutation(m('importCase'),{owner,externalId:v1.externalId,caseJson:v1.caseJson}),id2=await t.mutation(m('importCase'),{owner,externalId:v2.externalId,caseJson:v2.caseJson});
  expect(id2).not.toBe(id1);expect(await t.mutation(m('importCase'),{owner,externalId:v2.externalId,caseJson:v2.caseJson})).toBe(id2);
  await expect(t.mutation(m('importCase'),{owner,externalId:v1.externalId,caseJson:v2.caseJson})).rejects.toThrow('append a new source version');
  const list=await alice.query(q('list'),{}) as {externalId:string}[];expect(list.map(r=>r.externalId).sort()).toEqual([v1.externalId,v2.externalId]);
  const d1=await alice.query(q('detail'),{caseId:id1}) as {case:{prices:{eventAt:number}[]}},d2=await alice.query(q('detail'),{caseId:id2}) as {case:{prices:{eventAt:number;receivedAt:number}[]}};
  const anchor=Date.parse('2026-11-03T21:00:00Z');expect(d1.case.prices.some(p=>p.eventAt===anchor)).toBe(false);
  expect(d2.case.prices.filter(p=>p.eventAt===anchor).every(p=>p.receivedAt>=Date.parse('2026-11-05T14:25:00Z'))).toBe(true);
  expect(Math.min(...d2.case.prices.map(p=>p.receivedAt))).toBeGreaterThan(anchor);
 });
});

describe('Case 006 v2 acceptance: TypeScript–Python parity',()=>{
 it('produces identical classification, momentum, indicators and outcome statuses from the same package',()=>{
  const run=spawnSync('python',['-m','worker.market_recovery','data/recovery/november-3-2026-v2-request.json'],{encoding:'utf8',maxBuffer:64*1024*1024});if(run.status!==0)throw new Error(run.stderr);
  const py=JSON.parse(run.stdout),data=parseRecoveryCase(request.case),ts=classifyRecoveryCase(data,request.cutoff,request.anchorAt);
  expect(py.assessment.classification).toBe(ts.classification);expect(py.assessment.missingCritical).toEqual(ts.missingCritical);
  for(const mo of ts.momentum){const p=py.assessment.momentum.find((x:{instrumentId:string})=>x.instrumentId===mo.instrumentId);expect(p.latest.eventAt).toBe(mo.latest!.eventAt);expect(p.latest.eventAt).toBe(request.anchorAt);
   mo.windows.forEach((w,i)=>{for(const k of ['return','maximumDrawdown','drawdownFromHigh'] as const)expect(p.windows[i][k]).toBeCloseTo(w[k]!,12);expect(p.windows[i].positiveSessions).toBe(w.positiveSessions);});}
  for(const ind of ts.indicators){const p=py.assessment.indicators.find((x:{metric:string})=>x.metric===ind.metric);expect(p.currentValue).toBeCloseTo(ind.currentValue!,12);expect(p.fiveSessionChange).toBeCloseTo(ind.fiveSessionChange!,12);}
  const reg=buildRecoveryRegistration(data,{name:data.name,...request,priceBasis:'total-return'});
  expect(py.outcomes.map((o:{windowId:string;status:string})=>[o.windowId,o.status])).toEqual(reg.windows.map(w=>{const o=evaluateRecoveryWindow(data,w,request.asOf);return [o.windowId,o.status];}));
  expect(readFileSync('data/recovery/november-3-2026.json','utf8')).toContain('"id": "recovery-006-2026-11-03"');
 },60_000);
});
