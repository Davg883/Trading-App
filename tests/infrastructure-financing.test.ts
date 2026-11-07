import {describe,it,expect} from 'vitest';
import {INFRASTRUCTURE_VERSION,parseInfrastructureCase,freezeInfrastructureCase,validateTransition,infrastructureKpis,economicExposure,riskReview,type InfrastructureCase,type InfrastructureSource,type FinancingEvent,type InfrastructureMetric,type InfrastructureRelationship} from '../lib/infrastructure-financing';

const day=86400000,now=Date.parse('2026-10-31T12:00:00Z');
function source(patch:Partial<InfrastructureSource>={}):InfrastructureSource{return {id:'filing',title:'Reviewed contract filing',url:'https://example.test/filing',kind:'filing',publishedAt:now-day,receivedAt:now-day,verification:'verified',mode:'historical',role:'evidence',supports:[{eventId:'loan',status:'signed',binding:true}],...patch};}
function event(patch:Partial<FinancingEvent>={}):FinancingEvent{return {id:'loan-r1',eventId:'loan',revision:1,supersedes:null,issuer:'Bank',borrower:'Operator',guarantor:null,customer:null,projectId:'campus',type:'borrowing',principal:100,currency:'USD',maturityAt:null,status:'signed',claimType:'fact',publishedAt:now-day,receivedAt:now-day,sourceIds:['filing'],mode:'historical',economicGroupId:'facility-one',...patch};}
function data(patch:Partial<InfrastructureCase>={}):InfrastructureCase{return {version:INFRASTRUCTURE_VERSION,id:'case',name:'Infrastructure dependency',mode:'historical',sources:[source()],events:[event()],relationships:[],metrics:[],...patch};}
function metric(name:InfrastructureMetric['metric'],value:number,patch:Partial<InfrastructureMetric>={}):InfrastructureMetric{return {id:name,entity:'Operator',projectId:'campus',metric:name,value,unit:'currency',currency:'USD',period:{start:now-367*day,end:now-2*day,label:'comparable annual period'},basis:'GAAP',definition:'Recognised revenue',kind:'reported',sourceIds:['filing'],eventIds:[],counterparty:null,mode:'historical',...patch};}
function relation(patch:Partial<InfrastructureRelationship>={}):InfrastructureRelationship{return {id:'loan-link',from:'Bank',to:'Operator',type:'borrowing',projectId:'campus',eventIds:['loan'],sourceIds:['filing'],certainty:'verified_contract',economicGroupId:'facility-one',...patch};}

describe('Infrastructure financing evidence and status',()=>{
  it('does not promote a reported proposed guarantee into a signed obligation',()=>{
    const proposed=event({type:'guarantee',issuer:'NVIDIA',borrower:'Operator',guarantor:'NVIDIA',eventId:'proposal',id:'proposal-r1',status:'reported_discussion',claimType:'discussion',principal:null,currency:null});
    const news=source({kind:'news',verification:'corroborated',supports:[{eventId:'proposal',status:'reported_discussion',binding:false},{eventId:'proposal',status:'signed',binding:true}]});
    expect(parseInfrastructureCase(data({events:[proposed],sources:[news]})).events[0].status).toBe('reported_discussion');
    expect(()=>parseInfrastructureCase(data({events:[{...proposed,status:'signed'}],sources:[news]}))).toThrow('Discussions');
    expect(()=>parseInfrastructureCase(data({events:[{...proposed,status:'signed',claimType:'contingent'}],sources:[news]}))).toThrow('verified primary');
    expect(infrastructureKpis(data({events:[proposed],sources:[news]}),'NVIDIA','campus',now).guaranteeExposure.value).toBeNull();
  });
  it('requires status evidence scoped to the exact agreement and preserves ordered revisions',()=>{
    expect(()=>parseInfrastructureCase(data({sources:[source({supports:[{eventId:'unrelated',status:'signed',binding:true}]})]}))).toThrow('scoped');
    const next=event({id:'loan-r2',revision:2,supersedes:'loan-r1',status:'funded',publishedAt:now,receivedAt:now,sourceIds:['later']});
    const later=source({id:'later',publishedAt:now,receivedAt:now,supports:[{eventId:'loan',status:'funded',binding:true}]});
    const input=data({sources:[source(),later],events:[event(),next]});expect(parseInfrastructureCase(input).events).toHaveLength(2);
    for(const patch of [{borrower:'Other borrower'},{financier:'Different financier'},{economicGroupId:'other'},{publishedAt:now-2*day}])expect(()=>validateTransition(event(),{...next,...patch},input.sources,now)).toThrow('identity');
  });
  it('keeps a source-backed cancellation project-specific without cancelling other contracts',()=>{
    const cancelled=event({id:'loan-r2',revision:2,supersedes:'loan-r1',status:'cancelled',publishedAt:now,receivedAt:now,sourceIds:['cancel']});
    const cancel=source({id:'cancel',kind:'news',verification:'corroborated',publishedAt:now,receivedAt:now,supports:[{eventId:'loan',status:'cancelled',binding:false}]});
    const other=event({id:'other-r1',eventId:'other',projectId:'different-campus',sourceIds:['other'],economicGroupId:'different'});
    const otherSource=source({id:'other',supports:[{eventId:'other',status:'signed',binding:true}]});
    const result=freezeInfrastructureCase(data({events:[event(),cancelled,other],sources:[source(),cancel,otherSource]}),now);
    expect(result.activeEvents.find(e=>e.eventId==='loan')?.status).toBe('cancelled');expect(result.activeEvents.find(e=>e.eventId==='other')?.status).toBe('signed');expect(riskReview(data({events:[event(),cancelled],sources:[source(),cancel]}),now).alerts.join(' ')).toContain('unrelated projects');
  });
  it('cannot verify inferred links or reuse a previous revision source as current contractual proof',()=>{
    expect(()=>parseInfrastructureCase(data({relationships:[relation({from:'GPU vendor'})]}))).toThrow('inferred or reported');
    const next=event({id:'loan-r2',revision:2,supersedes:'loan-r1',status:'funded',publishedAt:now,receivedAt:now,sourceIds:['funding']});
    const funded=source({id:'funding',publishedAt:now,receivedAt:now,supports:[{eventId:'loan',status:'funded',binding:true}]});
    const snapshot=freezeInfrastructureCase(data({sources:[source(),funded],events:[event(),next],relationships:[relation()]}),now);expect(snapshot.case.relationships).toHaveLength(0);
    expect(parseInfrastructureCase(data({relationships:[relation({certainty:'inferred',from:'Possible vendor'})]})).relationships[0].certainty).toBe('inferred');
  });
  it('excludes late receipt, later revisions and market outcomes from earlier evidence',()=>{
    const next=event({id:'loan-r2',revision:2,supersedes:'loan-r1',status:'funded',publishedAt:now,receivedAt:now,sourceIds:['later']});
    const later=source({id:'later',publishedAt:now,receivedAt:now,supports:[{eventId:'loan',status:'funded',binding:true}]});
    const outcome=source({id:'future-price',role:'outcome'});const input=data({sources:[source(),later,outcome],events:[event(),next]});
    const historical=freezeInfrastructureCase(input,now-1000);expect(historical.activeEvents.map(e=>e.status)).toEqual(['signed']);expect(historical.case.sources.map(s=>s.id)).toEqual(['filing']);
    const current=freezeInfrastructureCase(input,now);expect(current.case.events).toHaveLength(2);expect(current.activeEvents[0].status).toBe('funded');expect(parseInfrastructureCase(current.case).events).toHaveLength(2);
    expect(freezeInfrastructureCase(data({sources:[source({receivedAt:now})],events:[event({receivedAt:now})]}),now-1000).case.events).toHaveLength(0);
  });
  it('cannot revive a cancelled agreement or fabricate an unsupported status',()=>{
    const cancelled=event({status:'cancelled'}),proof=source({supports:[{eventId:'loan',status:'cancelled',binding:false},{eventId:'loan',status:'signed',binding:true}]});
    expect(()=>validateTransition(cancelled,event({id:'loan-r2',revision:2,supersedes:'loan-r1'}),[proof],now)).toThrow('revived');
    expect(()=>parseInfrastructureCase(data({events:[event({revision:2,supersedes:null})]}))).toThrow('first');
  });
});

describe('Infrastructure financing KPIs and distinct measures',()=>{
  it('keeps backlog, revenue, collections and capacity separate with no fabricated substitutes',()=>{
    const input=data({metrics:[metric('contracted_backlog',1000),metric('cash_collections',40)]});const kpi=infrastructureKpis(input,'Operator','campus',now);
    expect(kpi.distinctMetrics.contractedBacklog.value).toBe(1000);expect(kpi.distinctMetrics.recognisedRevenue.value).toBeNull();expect(kpi.distinctMetrics.cashCollections.value).toBe(40);expect(kpi.capitalIntensity.value).toBeNull();expect(kpi.distinctMetrics.commerciallyAvailableCapacity.value).toBeNull();
  });
  it('does not treat planned or energised power as installed or commercially available GPUs',()=>{
    const input=data({metrics:[metric('planned_power_mw',100,{unit:'MW',currency:null}),metric('energised_power_mw',20,{unit:'MW',currency:null})]});const kpi=infrastructureKpis(input,'Operator','campus',now);
    expect(kpi.powerReadiness.value).toBe(.2);expect(kpi.powerReadiness.unit).toBe('power-only ratio');expect(kpi.distinctMetrics.installedCapacity.value).toBeNull();expect(()=>parseInfrastructureCase(data({metrics:[metric('installed_gpu_capacity',100,{unit:'MW',currency:null})]}))).toThrow('cannot be substituted');
  });
  it('calculates customer concentration only on compatible recognized revenue',()=>{
    const revenue=metric('recognised_revenue',100),customer=metric('customer_revenue',70,{counterparty:'Customer'});
    expect(infrastructureKpis(data({metrics:[revenue,customer]}),'Operator','campus',now).customerConcentration[0].value).toBe(.7);
    for(const patch of [{definition:'Contracted backlog'},{basis:'Adjusted'},{period:{...customer.period,end:customer.period.end-day}},{currency:'GBP'}])expect(infrastructureKpis(data({metrics:[revenue,{...customer,...patch}]}),'Operator','campus',now).customerConcentration[0].value).toBeNull();
  });
  it('excludes future periods, forecasts and reports published before a claimed measurement period ended',()=>{
    const future=metric('recognised_revenue',100,{period:{start:now-day,end:now+day,label:'future'}}),forecast=metric('capital_expenditure',50,{kind:'forecast'});
    const snapshot=freezeInfrastructureCase(data({metrics:[future,forecast]}),now);expect(snapshot.case.metrics.map(m=>m.id)).toEqual(['capital_expenditure']);expect(infrastructureKpis(data({metrics:[future,forecast]}),'Operator','campus',now).capitalIntensity.value).toBeNull();
    const premature=metric('recognised_revenue',100,{period:{start:now-100*day,end:now-day/2,label:'not yet known at publication'}});expect(freezeInfrastructureCase(data({metrics:[premature]}),now).case.metrics).toHaveLength(0);
  });
  it('calculates declared compatible funding, construction, debt service, capex and annual payback',()=>{
    const input=data({metrics:[metric('funding_committed',80,{eventIds:['loan']}),metric('project_cost',100),metric('construction_committed',90),metric('construction_paid',40),metric('cash_available_for_debt_service',30),metric('debt_service_due',20),metric('capital_expenditure',50),metric('recognised_revenue',200),metric('project_operating_cash_flow',25)]});const result=infrastructureKpis(input,'Operator','campus',now);
    expect(result.fundingCoverage.value).toBe(.8);expect(result.constructionExposure.value).toBe(50);expect(result.debtServiceCapacity.value).toBe(1.5);expect(result.capitalIntensity.value).toBe(.25);expect(result.projectCashPayback.value).toBe(4);expect(result).toEqual(infrastructureKpis(structuredClone(input),'Operator','campus',now));
  });
  it('does not count a proposed guarantee as available funding or supported guarantee exposure',()=>{
    const proposed=event({type:'guarantee',guarantor:'Supplier',status:'reported_discussion',claimType:'discussion'}),news=source({kind:'news',verification:'corroborated',supports:[{eventId:'loan',status:'reported_discussion',binding:false}]});
    const input=data({sources:[news],events:[proposed],metrics:[metric('funding_committed',100,{eventIds:['loan']}),metric('project_cost',100)]});expect(infrastructureKpis(input,'Supplier','campus',now).guaranteeExposure.value).toBeNull();expect(infrastructureKpis(input,'Operator','campus',now).fundingCoverage.value).toBeNull();
  });
});

describe('Independent infrastructure exposure review',()=>{
  it('counts an underlying loan only once when a supplier guarantee covers the same obligation',()=>{
    const guarantee=event({id:'guarantee-r1',eventId:'guarantee',type:'guarantee',issuer:'Supplier',guarantor:'Supplier',sourceIds:['guarantee']});const guaranteeSource=source({id:'guarantee',supports:[{eventId:'guarantee',status:'signed',binding:true}]});
    const result=economicExposure(data({sources:[source(),guaranteeSource],events:[event(),guarantee]}),now);expect(result.totalPrincipal).toBe(100);expect(result.groups).toHaveLength(1);expect(result.potentialDoubleCounting).toBe(true);
    expect(economicExposure(data({sources:[source(),guaranteeSource],events:[event(),{...guarantee,economicGroupId:'unreconciled'}]}),now).totalPrincipal).toBeNull();
  });
  it('does not add supplier financing, future customer contract values or equity into one exposure total',()=>{
    const commercial=event({id:'sale-r1',eventId:'sale',type:'commercial_contract',customer:'Customer',sourceIds:['sale'],principal:1000,economicGroupId:'services'}),sale=source({id:'sale',supports:[{eventId:'sale',status:'signed',binding:true}]});
    const result=economicExposure(data({sources:[source(),sale],events:[event(),commercial]}),now);expect(result.totalPrincipal).toBeNull();expect(result.potentialDoubleCounting).toBe(true);expect(result.reason).toContain('not comparable');
    expect(economicExposure(data({events:[event({economicGroupId:null})]}),now).totalPrincipal).toBeNull();
  });
  it('returns research-only alerts with no broker order authority or execution operation',()=>{
    const result=riskReview(data(),now);expect(result.executionAuthority).toBe('none');expect(result.researchOnly).toBe(true);expect(result).not.toHaveProperty('order');expect(result.alerts.join(' ').toLowerCase()).toContain('commercially available');
  });
});


it('does not let forecast or news-reported capacity suppress the independent unproven-capacity alert',()=>{
  const forecast=data({metrics:[metric('available_gpu_capacity',500,{unit:'GPU',currency:null,kind:'forecast'})]});
  expect(riskReview(forecast,now).alerts.some(a=>a.includes('capacity is unproven'))).toBe(true);
  const reported=data({metrics:[metric('available_gpu_capacity',500,{unit:'GPU',currency:null})]});
  expect(riskReview(reported,now).alerts.some(a=>a.includes('capacity is unproven'))).toBe(false);
});
it('does not infer supplier-funded purchases across distinct projects',()=>{
  const guarantee=event({type:'guarantee',guarantor:'Supplier',issuer:'Supplier'});
  const input=data({events:[guarantee],relationships:[relation({id:'gpu-context',from:'Supplier',to:'Operator',type:'gpu_supply',projectId:'other-campus',eventIds:[],certainty:'inferred'})]});
  expect(riskReview(input,now).supplierFundedPurchases).toBe(false);
});


it('does not count contracted customer backlog as a source of committed project funding',()=>{
  const commercial=event({type:'commercial_contract',customer:'Customer'});
  const input=data({events:[commercial],metrics:[metric('funding_committed',100,{eventIds:['loan']}),metric('project_cost',100)]});
  expect(infrastructureKpis(input,'Operator','campus',now).fundingCoverage.value).toBeNull();
  expect(infrastructureKpis(input,'Operator','campus',now).fundingCoverage.reason).toContain('customer backlog');
});


it('requires new scoped primary evidence before changing signed principal or maturity',()=>{
  const previous=event(),amendment=event({id:'loan-r2',revision:2,supersedes:'loan-r1',principal:120,publishedAt:now,receivedAt:now});
  expect(()=>validateTransition(previous,amendment,[source()],now)).toThrow('new suitable source');
  const amended=source({id:'amendment',publishedAt:now,receivedAt:now,supports:[{eventId:'loan',status:'signed',binding:true}]});
  expect(validateTransition(previous,{...amendment,sourceIds:['amendment']},[source(),amended],now).principal).toBe(120);
  const news={...amended,kind:'news' as const,verification:'corroborated' as const};
  expect(()=>validateTransition(previous,{...amendment,sourceIds:['filing','amendment']},[source(),news],now)).toThrow('new suitable source');
});
