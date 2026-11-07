import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import request from '../data/policy-risk/midterm-2026-11-03-request.json';
import {parsePolicyCase,freezePolicyCase,policyAssessment,classifyPolicyEvent,registerPolicyExperiment,evaluatePolicyStudy,evaluatePolicyWindow,type PolicyCase} from '../lib/policy-risk';

const data=():PolicyCase=>parsePolicyCase(structuredClone(request.case));
const assess=(c=data())=>policyAssessment(c,request.cutoff);
const cls=(id:string,c=data())=>assess(c).policy.classifications.find(k=>k.eventId===id)!;
const exposure=(id:string,c=data())=>assess(c).policy.exposures.find(x=>x.projectId===id)!;

describe('Benchmark 001.2 policy classification',()=>{
 it('never turns an election victory or campaign pledge into an enacted policy',()=>{
  for(const id of ['us-midterm-2026-11-03','oh-senate-2026','ks-governor-2026']){const k=cls(id);expect(k.policyClass).toBe('political_signal');expect(k.restrictionInForce).toBe(false);expect(k.potentialRestriction).toBe(false);}
  const c=data(),e=c.events.find(x=>x.id==='oh-senate-2026')!;e.direction='restrictive';
  expect(classifyPolicyEvent(e,request.cutoff,c.sources).restrictionInForce).toBe(false);
 });
 it('distinguishes a passed-but-unsigned moratorium bill from the executive order in force',()=>{
  const bill=cls('ny-s10642'),order=cls('ny-eo62');
  expect(bill.policyClass).toBe('proposed_not_enacted');expect(bill.restrictionInForce).toBe(false);expect(bill.potentialRestriction).toBe(true);expect(bill.uncertainty).toBe('high');
  expect(order.policyClass).toBe('active');expect(order.restrictionInForce).toBe(true);expect(order.primarySourceIds).toContain('ny-eo62');
 });
 it('keeps unofficial votes pending certification, advisory votes non-binding and rejected restrictions inert',()=>{
  expect(cls('wells-me-moratorium-2026-11-03').policyClass).toBe('pending_certification');expect(cls('wells-me-moratorium-2026-11-03').restrictionInForce).toBe(false);
  expect(cls('bloomington-il-advisory-2026-11-03').policyClass).toBe('advisory_nonbinding');
  const harwood=cls('harwood-review-2026-11-03');expect(harwood.potentialRestriction).toBe(false);
 });
 it('treats a court order as court-tested and an enacted rule as inactive before its effective date',()=>{
  expect(cls('wilmington-federal-order').policyClass).toBe('court_constraint');
  const c=data(),ok=c.events.find(e=>e.id==='ok-hb2992')!;expect(classifyPolicyEvent(ok,Date.parse('2026-06-15T00:00:00Z'),c.sources).policyClass).toBe('enacted_not_yet_effective');
  const enjoined={...ok,legalStatus:'enjoined' as const};expect(classifyPolicyEvent(enjoined,request.cutoff,c.sources).restrictionInForce).toBe(false);
 });
 it('attaches sources and uncertainty to every classification and raises it for conflicts or secondary-only evidence',()=>{
  const all=assess().policy.classifications;expect(all.every(k=>k.sourceIds.length>0&&['low','medium','high'].includes(k.uncertainty)&&k.reasons.length>0)).toBe(true);
  expect(cls('piqua-charter-2026-11-03').uncertainty).toBe('high');expect(cls('piqua-charter-2026-11-03').reasons.join(' ')).toMatch(/conflict/);
  expect(cls('az-tpt-pause').reasons.join(' ')).toMatch(/secondary reporting only/);
 });
});

describe('Benchmark 001.2 project exposure',()=>{
 it('derives exposure only from sourced project links, never from sharing a state',()=>{
  expect(exposure('aws-wilmington').exposure).toBe('directly_exposed');expect(exposure('meta-piqua').exposure).toBe('potentially_exposed');
  expect(exposure('apld-polaris-forge-2').exposure).toBe('no_substantiated_exposure');
  const c=data(),base=c.projects.find(p=>p.id==='wulf-lake-hawkeye')!;c.projects.push({...base,id:'unlinked-ny',name:'Unlinked New York project',companies:[{name:'Example',ticker:null,role:'developer'}]});
  expect(exposure('unlinked-ny',c).exposure).toBe('no_substantiated_exposure');
  expect(exposure('wulf-lake-mariner').exposure).toBe('potentially_exposed');expect(exposure('wulf-lake-mariner').directEventIds).toEqual([]);
 });
 it('records a hold or delay without converting it into a cancellation',()=>{
  const a=assess(),aws=data().projects.find(p=>p.id==='aws-wilmington')!;expect(aws.stage).toBe('permitting_on_hold');expect(a.economic.holds).toContain('aws-wilmington');
  expect(a.policy.exposures.find(x=>x.projectId==='aws-wilmington')!.exposure).not.toBe('not_active_project');
  expect(data().projects.some(p=>p.stage==='cancelled')).toBe(false);expect(exposure('viridian-janesville').exposure).toBe('not_active_project');
 });
 it('never counts planned capacity as operational',()=>{
  const a=assess(),pf1=a.policy.exposures.find(x=>x.projectId==='apld-polaris-forge-1')!,pf2=a.policy.exposures.find(x=>x.projectId==='apld-polaris-forge-2')!;
  expect([pf1.plannedMw,pf1.energisedMw,pf1.unenergisedMw]).toEqual([400,250,150]);expect(pf2.energisedMw).toBeNull();expect(pf2.unenergisedMw).toBeNull();
  const bucket=a.policy.capacity.find(b=>b.exposure==='no_substantiated_exposure')!;expect(bucket.energisedMw).toEqual({knownMw:250,knownCount:1,unknownCount:1});
  const c=data();c.projects[0].plannedMw=10;c.projects[0].energisedMw=20;expect(()=>parsePolicyCase(c)).toThrow(/Energised capacity exceeds planned/);
 });
 it('computes incremental carry only when principal, rate and delay length are sourced',()=>{
  expect(assess().economic.delays.find(d=>d.projectId==='aws-wilmington')!.incrementalCarryUsd).toBeNull();
  const c=data(),pf2=c.projects.find(p=>p.id==='apld-polaris-forge-2')!;pf2.timelineRevisions=[{kind:'delay',previous:'Q4 2026',revised:'Q1 2027',delayDays:73,announcedDate:'2026-10-07',sourceIds:['apld-8k-2026-10-07']}];
  const d=assess(c).economic.delays.find(x=>x.projectId==='apld-polaris-forge-2')!;expect(d.incrementalCarryUsd).toBeCloseTo(2.15e9*.0675*73/365,2);
  expect(c.projects.find(p=>p.id==='apld-polaris-forge-2')!.stage).toBe('under_construction');
 });
 it('keeps policy, economic and market analyses in separate sections and reports missing evidence',()=>{
  const a=assess();expect(Object.keys(a)).toEqual(expect.arrayContaining(['policy','economic','missing']));expect(a).not.toHaveProperty('market');
  expect(a.missing).toContain('No sourced secured or requested grid capacity for any registered project');expect(a.missing).toContain('No observed compute or lease pricing; scarcity effects remain mechanisms only');
  expect(a.economic.concentration.find(r=>r.developer==='WULF')!.affectedShareOfKnownMw).toBeNull();expect(a.economic.operationalUnknownMw).toEqual(['wulf-lake-mariner']);
 });
});

describe('Benchmark 001.2 retrospective event study',()=>{
 const reg=()=>registerPolicyExperiment(data(),{cutoff:request.cutoff,registeredAt:request.registeredAt});
 it('labels the registration retrospective and excludes news published after the cutoff',()=>{
  const r=reg();expect(r.priorForecast).toBe(false);expect(r.label).toMatch(/not a prior prediction/);expect(r.windows).toHaveLength(24);
  const c=data(),atAnchor=freezePolicyCase(c,c.anchorAt,'publication');expect(atAnchor.retrospectiveReconstruction).toBe(true);
  const ids=atAnchor.case.events.map(e=>e.id);expect(ids).toContain('ny-eo62');expect(ids).not.toContain('wells-me-moratorium-2026-11-03');expect(ids).not.toContain('us-midterm-2026-11-03');
  expect(freezePolicyCase(c,c.anchorAt).case.events).toHaveLength(0);
  expect(()=>registerPolicyExperiment(c,{cutoff:c.anchorAt,registeredAt:request.registeredAt,basis:'publication'})).toThrow(/was not available at the cutoff/);
  expect(()=>registerPolicyExperiment(c,{cutoff:request.cutoff,registeredAt:request.cutoff-1})).toThrow(/cannot precede/);
 });
 it('evaluates only complete, aligned windows and leaves future horizons pending',()=>{
  const r=reg(),s=evaluatePolicyStudy(r,data().prices,request.asOf),one=(g:string)=>s.outcomes.find(o=>o.groupId===g&&o.horizon===1)!;
  expect(one('developers').status).toBe('complete');expect(one('developers').result!.equalWeightReturn).toBeCloseTo(-.1089,4);expect(one('bench-vt').result!.equalWeightReturn).toBeCloseTo(157.81/155.16-1,10);
  expect(s.outcomes.filter(o=>o.horizon>1).every(o=>o.status==='pending')).toBe(true);
  expect(s.hypotheses.find(h=>h.hypothesisId==='H1'&&h.horizon===1)!.status).toBe('consistent');expect(s.hypotheses.filter(h=>h.horizon>1).every(h=>h.status==='pending')).toBe(true);
  const w=r.windows.find(x=>x.groupId==='developers'&&x.horizon===1)!,prices=data().prices.filter(p=>!(p.ticker==='CIFR'&&p.eventAt===w.endAt));
  expect(evaluatePolicyWindow(r,prices,w.id,request.asOf).status).toBe('pending');
  const dup=[...data().prices,{...data().prices.find(p=>p.ticker==='APLD'&&p.eventAt===w.endAt)!,id:'dup',close:1}];expect(evaluatePolicyWindow(r,dup,w.id,request.asOf).status).toBe('pending');
  expect(evaluatePolicyWindow(r,data().prices,w.id,w.endAt!-1).status).toBe('pending');
 });
 it('records member exposure at registration and grants no execution authority',()=>{
  const r=reg();expect(r.groups.find(g=>g.id==='developers')!.memberExposure.WULF).toBe('potentially_exposed');expect(r.groups.find(g=>g.id==='hyperscalers')!.memberExposure.AMZN).toBe('directly_exposed');
  expect(r.executionAuthority).toBe('none');expect(assess().executionAuthority).toBe('none');
  const source=readFileSync('lib/policy-risk.ts','utf8')+readFileSync('worker/policy_risk.py','utf8');expect(source).not.toMatch(/brokers|paper-ledger|placeOrder|submitOrder|trading212/i);
 });
 it('is reproduced exactly by the Python worker',()=>{
  const run=spawnSync('python',['-m','worker.policy_risk','data/policy-risk/midterm-2026-11-03-request.json'],{encoding:'utf8',maxBuffer:64*1024*1024});if(run.status!==0)throw new Error(run.stderr);
  const py=JSON.parse(run.stdout),ts=assess(),r=reg(),s=evaluatePolicyStudy(r,data().prices,request.asOf);
  expect(py.assessment.policy.classifications.map((k:{eventId:string;policyClass:string;uncertainty:string;restrictionInForce:boolean})=>[k.eventId,k.policyClass,k.uncertainty,k.restrictionInForce])).toEqual(ts.policy.classifications.map(k=>[k.eventId,k.policyClass,k.uncertainty,k.restrictionInForce]));
  expect(py.assessment.policy.exposures.map((x:{projectId:string;exposure:string})=>[x.projectId,x.exposure])).toEqual(ts.policy.exposures.map(x=>[x.projectId,x.exposure]));
  expect(py.assessment.policy.capacity).toEqual(ts.policy.capacity);expect(py.assessment.missing).toEqual(ts.missing);
  for(const o of s.outcomes){const p=py.study.outcomes.find((x:{windowId:string})=>x.windowId===o.windowId);expect(p.status).toBe(o.status);if(o.result)expect(p.result.equalWeightReturn).toBeCloseTo(o.result.equalWeightReturn,12);}
  expect(py.study.hypotheses.map((h:{status:string})=>h.status)).toEqual(s.hypotheses.map(h=>h.status));
 });
});
