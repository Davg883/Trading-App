import {z} from 'zod';

export const INFRASTRUCTURE_VERSION='infrastructure-001.2-v1' as const;
export const FINANCING_STATUSES=['reported_discussion','announced','signed','funded','cancelled','expired'] as const;
export const RELATIONSHIP_TYPES=['equity_investment','gpu_supply','commercial_contract','borrowing','guarantee','other_commitment'] as const;
export const INFRASTRUCTURE_METRICS=['funding_committed','project_cost','contracted_backlog','recognised_revenue','cash_collections','installed_gpu_capacity','available_gpu_capacity','planned_power_mw','energised_power_mw','construction_committed','construction_paid','cash_available_for_debt_service','debt_service_due','capital_expenditure','customer_revenue','project_operating_cash_flow'] as const;
const id=z.string().trim().min(1).max(300),text=z.string().trim().min(1).max(10000),time=z.number().finite().nonnegative();
const mode=z.enum(['synthetic','historical','forward']);
const ids=z.array(id).max(100);
const url=z.string().url().startsWith('https://').refine(s=>{const u=new URL(s);return !u.username&&!u.password;},'Source credentials are forbidden');
export const infrastructureSourceSchema=z.object({id,title:text,url,kind:z.enum(['company','filing','news','regulator']),publishedAt:time.nullable(),receivedAt:time,verification:z.enum(['verified','corroborated','unverified']),mode,role:z.enum(['evidence','outcome']),supports:z.array(z.object({eventId:id,status:z.enum(FINANCING_STATUSES),binding:z.boolean()}).strict()).max(100)}).strict().refine(s=>s.publishedAt===null||s.receivedAt>=s.publishedAt,'Source receipt precedes publication');
export type InfrastructureSource=z.infer<typeof infrastructureSourceSchema>;
export const financingEventSchema=z.object({id,eventId:id,revision:z.number().int().positive(),supersedes:id.nullable(),issuer:id.nullable(),financier:id.nullable().optional(),borrower:id.nullable(),guarantor:id.nullable(),customer:id.nullable(),projectId:id,type:z.enum(RELATIONSHIP_TYPES),principal:z.number().finite().nonnegative().nullable(),currency:z.string().regex(/^[A-Z]{3}$/).nullable(),maturityAt:time.nullable(),status:z.enum(FINANCING_STATUSES),claimType:z.enum(['fact','discussion','forecast','contingent','speculation']),publishedAt:time,receivedAt:time,sourceIds:ids.min(1),mode,economicGroupId:id.nullable()}).strict().superRefine((e,c)=>{if(e.receivedAt<e.publishedAt)c.addIssue({code:'custom',message:'Event receipt precedes publication'});if((e.principal===null)!==(e.currency===null))c.addIssue({code:'custom',message:'A principal requires its currency; missing amounts stay null'});if([e.issuer,e.borrower,e.guarantor,e.customer].every(v=>v===null))c.addIssue({code:'custom',message:'At least one identified counterparty is required'});if(e.type==='guarantee'&&(!e.borrower||!e.guarantor))c.addIssue({code:'custom',message:'Guarantees identify both borrower and guarantor'});});
export type FinancingEvent=z.infer<typeof financingEventSchema>;
export const infrastructureRelationshipSchema=z.object({id,from:id,to:id,type:z.enum(RELATIONSHIP_TYPES),projectId:id,eventIds:ids,sourceIds:ids,certainty:z.enum(['verified_contract','reported','inferred']),economicGroupId:id.nullable()}).strict().refine(r=>r.from!==r.to,'A relationship needs distinct counterparties');
export type InfrastructureRelationship=z.infer<typeof infrastructureRelationshipSchema>;
export const infrastructureMetricSchema=z.object({id,entity:id,projectId:id.nullable(),metric:z.enum(INFRASTRUCTURE_METRICS),value:z.number().finite(),unit:z.enum(['currency','MW','GPU']),currency:z.string().regex(/^[A-Z]{3}$/).nullable(),period:z.object({start:time,end:time,label:text}).strict(),basis:text,definition:text,kind:z.enum(['reported','forecast']),sourceIds:ids.min(1),eventIds:ids,counterparty:id.nullable(),mode}).strict().superRefine((m,c)=>{if(m.period.end<m.period.start)c.addIssue({code:'custom',message:'Reporting period is reversed'});if((m.unit==='currency')!==(m.currency!==null))c.addIssue({code:'custom',message:'Currency must accompany monetary metrics only'});if(m.metric!=='project_operating_cash_flow'&&m.metric!=='cash_available_for_debt_service'&&m.value<0)c.addIssue({code:'custom',message:'This measurement cannot be negative'});const expected=m.metric.endsWith('_power_mw')?'MW':['installed_gpu_capacity','available_gpu_capacity'].includes(m.metric)?'GPU':'currency';if(m.unit!==expected)c.addIssue({code:'custom',message:'Power, GPU capacity and monetary units cannot be substituted'});});
export type InfrastructureMetric=z.infer<typeof infrastructureMetricSchema>;
export const infrastructureCaseSchema=z.object({version:z.literal(INFRASTRUCTURE_VERSION),id,name:text,mode,sources:z.array(infrastructureSourceSchema).max(500),events:z.array(financingEventSchema).max(1000),relationships:z.array(infrastructureRelationshipSchema).max(1000),metrics:z.array(infrastructureMetricSchema).max(2000)}).strict();
export type InfrastructureCase=z.infer<typeof infrastructureCaseSchema>;
export type InfrastructureCalculation={value:number|null;reason:string|null;sourceIds:string[];unit:string};
const unavailable=(reason:string,unit='ratio'):InfrastructureCalculation=>({value:null,reason,sourceIds:[],unit});
const primary=(s:InfrastructureSource)=>s.verification==='verified'&&s.kind!=='news';
const sourceEligible=(s:InfrastructureSource,cutoff:number)=>s.role==='evidence'&&s.publishedAt!==null&&s.publishedAt<=cutoff&&s.receivedAt<=cutoff&&s.verification!=='unverified';
function evidenceFor(event:FinancingEvent,sources:InfrastructureSource[],cutoff:number){return sources.filter(s=>event.sourceIds.includes(s.id)&&s.mode===event.mode&&sourceEligible(s,cutoff));}
/** Checks source evidence for this exact logical event and new status. It never infers signing from a report. */
export function validateTransition(previous:FinancingEvent|null,next:FinancingEvent,sources:InfrastructureSource[],cutoff:number){
  financingEventSchema.parse(next);time.parse(cutoff);
  if(next.publishedAt>cutoff||next.receivedAt>cutoff)throw new Error('Event was unavailable at cutoff');
  if(previous){if(next.eventId!==previous.eventId||next.revision!==previous.revision+1||next.supersedes!==previous.id||next.projectId!==previous.projectId||next.type!==previous.type||next.mode!==previous.mode||next.receivedAt<previous.receivedAt||next.publishedAt<previous.publishedAt||(['issuer','borrower','guarantor','customer','financier','economicGroupId'] as const).some(k=>(next[k]??null)!==(previous[k]??null)))throw new Error('Status revision must preserve identity and ordered history');if(['cancelled','expired'].includes(previous.status)&&next.status!==previous.status)throw new Error('A terminal event cannot be silently revived; register a new agreement');}
  else if(next.revision!==1||next.supersedes!==null)throw new Error('The first event revision must start a complete history');
  const matching=evidenceFor(next,sources,cutoff).filter(s=>s.supports.some(p=>p.eventId===next.eventId&&p.status===next.status));
  if(!matching.length)throw new Error('Status requires eligible source evidence scoped to this event');
  if(previous&&previous.status===next.status&&(['principal','currency','maturityAt'] as const).some(k=>previous[k]!==next[k])){const amended=matching.filter(s=>!previous.sourceIds.includes(s.id));if(!amended.some(s=>!['signed','funded'].includes(next.status)||primary(s)&&s.supports.some(p=>p.eventId===next.eventId&&p.status===next.status&&p.binding)))throw new Error('Changed contractual terms require a new suitable source revision, not reused original evidence');}
  if(['signed','funded'].includes(next.status)){
    if(!['fact','contingent'].includes(next.claimType)||next.claimType==='contingent'&&next.type!=='guarantee')throw new Error('Discussions, forecasts and speculation cannot be signed obligations');
    if(!matching.some(s=>primary(s)&&s.supports.some(p=>p.eventId===next.eventId&&p.status===next.status&&p.binding)))throw new Error('Signed or funded status requires verified primary binding evidence');
  }
  if(['announced','cancelled','expired'].includes(next.status)&&['forecast','speculation'].includes(next.claimType))throw new Error('Forecasts and speculation cannot establish a contractual status change');
  if(previous&&next.status!==previous.status){const allowed:Record<FinancingEvent['status'],FinancingEvent['status'][]>= {reported_discussion:['announced','signed','funded','cancelled','expired'],announced:['signed','funded','cancelled','expired'],signed:['funded','cancelled','expired'],funded:['cancelled','expired'],cancelled:[],expired:[]};if(!allowed[previous.status].includes(next.status))throw new Error('Unsupported contractual status transition');}
  return next;
}
export function parseInfrastructureCase(input:unknown):InfrastructureCase{
  const data=infrastructureCaseSchema.parse(input);
  for(const records of [data.sources,data.events,data.relationships,data.metrics])if(new Set(records.map(r=>r.id)).size!==records.length)throw new Error('Record IDs must be unique within each register');
  if([...data.sources,...data.events,...data.metrics].some(r=>r.mode!==data.mode))throw new Error('Synthetic, historical and forward evidence cannot be mixed');
  const sourceIds=new Set(data.sources.map(s=>s.id)),events=new Map<string,FinancingEvent[]>();
  for(const event of data.events){if(event.sourceIds.some(id=>!sourceIds.has(id)))throw new Error('Event source is missing');const history=events.get(event.eventId)??[];history.push(event);events.set(event.eventId,history);}
  for(const history of events.values()){history.sort((a,b)=>a.revision-b.revision);for(let i=0;i<history.length;i++)validateTransition(history[i-1]??null,history[i],data.sources,history[i].receivedAt);}
  for(const r of [...data.relationships,...data.metrics])if(r.sourceIds.some(id=>!sourceIds.has(id))||r.eventIds.some(id=>!events.has(id)))throw new Error('Relationship or metric references missing evidence');
  for(const relation of data.relationships){
    if(relation.certainty==='verified_contract'){
      if(!relation.eventIds.length||!relation.sourceIds.length)throw new Error('Verified contractual links require explicit events and sources');
      const matching=relation.eventIds.flatMap(id=>events.get(id)??[]).filter(e=>e.projectId===relation.projectId&&e.type===relation.type&&['signed','funded'].includes(e.status));
      if(!matching.some(e=>relationPartiesMatch(relation,e)&&e.sourceIds.some(id=>relation.sourceIds.includes(id)&&data.sources.some(s=>s.id===id&&primary(s)&&s.supports.some(p=>p.eventId===e.eventId&&p.status===e.status&&p.binding)))))throw new Error('An inferred or reported relationship cannot be promoted to a verified contract');
    }
  }
  return data;
}
function relationPartiesMatch(r:InfrastructureRelationship,e:FinancingEvent){const parties=[e.issuer,e.financier,e.borrower,e.guarantor,e.customer];return parties.includes(r.from)&&parties.includes(r.to)&&(r.type!=='guarantee'||r.from===e.guarantor&&r.to===e.borrower);}
/** Freezes immutable eligible evidence only; later revisions and market outcomes are excluded. */
export function freezeInfrastructureCase(input:InfrastructureCase,cutoff:number){
  const data=parseInfrastructureCase(input);time.parse(cutoff);const excluded:{id:string;reason:string}[]=[];
  const sources=data.sources.filter(s=>{const eligible=sourceEligible(s,cutoff);if(!eligible)excluded.push({id:s.id,reason:s.role==='outcome'?'Market outcome cannot enter earlier research evidence':s.publishedAt===null?'Publication time is unknown':s.verification==='unverified'?'Source remains unverified':'Publication or receipt follows cutoff'});return eligible;});
  const active=new Map<string,FinancingEvent>();const eligibleEvents:FinancingEvent[]=[];
  for(const e of [...data.events].sort((a,b)=>a.revision-b.revision)){try{validateTransition(nullForFirst(e,data.events),e,sources,cutoff);active.set(e.eventId,e);eligibleEvents.push(e);}catch(error){excluded.push({id:e.id,reason:error instanceof Error?error.message:'Unavailable event'});}}
  const events=[...active.values()],sourceSet=new Set(sources.map(s=>s.id));
  const relationships=data.relationships.filter(r=>{const matching=r.eventIds.map(id=>active.get(id)).filter((e):e is FinancingEvent=>Boolean(e));const eligible=r.sourceIds.length>0&&r.sourceIds.every(id=>sourceSet.has(id))&&r.eventIds.every(id=>active.has(id))&&(r.certainty!=='verified_contract'||matching.some(e=>['signed','funded'].includes(e.status)&&relationPartiesMatch(r,e)&&e.type===r.type&&e.sourceIds.some(id=>r.sourceIds.includes(id)&&sources.some(s=>s.id===id&&primary(s)&&s.supports.some(p=>p.eventId===e.eventId&&p.status===e.status&&p.binding)))));if(!eligible)excluded.push({id:r.id,reason:'Relationship evidence is unavailable, cancelled or not a verified contract at this cutoff'});return eligible;});
  const metrics=data.metrics.filter(m=>{const eligible=m.sourceIds.every(id=>sourceSet.has(id))&&m.eventIds.every(id=>active.has(id))&&(m.kind!=='reported'||m.period.end<=cutoff&&m.sourceIds.every(id=>sources.some(s=>s.id===id&&s.publishedAt!==null&&s.publishedAt>=m.period.end)));if(!eligible)excluded.push({id:m.id,reason:'Metric source or event is unavailable at cutoff'});return eligible;});
  return {version:INFRASTRUCTURE_VERSION,cutoff,case:{...data,sources,events:eligibleEvents,relationships,metrics},activeEvents:events,excluded,executionAuthority:'none' as const};
}
function nullForFirst(e:FinancingEvent,all:FinancingEvent[]){return e.revision===1?null:all.find(p=>p.id===e.supersedes)??null;}
function currentCase(data:InfrastructureCase,cutoff:number){const frozen=freezeInfrastructureCase(data,cutoff);return {...frozen.case,events:frozen.activeEvents};}
function calculation(rows:InfrastructureMetric[],unit:string,operation:()=>number):InfrastructureCalculation{try{const value=operation();if(!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER)throw new Error('Undefined or unsupported result');return {value,reason:null,sourceIds:[...new Set(rows.flatMap(r=>r.sourceIds))],unit};}catch(e){return unavailable(e instanceof Error?e.message:'Incompatible inputs',unit);}}
export function infrastructureKpis(input:InfrastructureCase,entity:string,projectId:string|null,cutoff:number){
  const data=currentCase(input,cutoff);
  const observed=data.metrics.filter(m=>m.entity===entity&&m.projectId===projectId&&m.kind==='reported'&&m.sourceIds.every(id=>data.sources.some(s=>s.id===id&&primary(s))));
  const get=(metric:InfrastructureMetric['metric'],counterparty:string|null=null)=>{const rows=observed.filter(m=>m.metric===metric&&(metric!=='customer_revenue'||m.counterparty===counterparty));return rows.length===1?rows[0]:null;};
  const compatible=(a:InfrastructureMetric,b:InfrastructureMetric)=>{if(a.unit!==b.unit||a.currency!==b.currency||a.basis!==b.basis||a.period.start!==b.period.start||a.period.end!==b.period.end)throw new Error('Compatible reporting periods, currency, units and definitions required');};
  const ratio=(a:InfrastructureMetric['metric'],b:InfrastructureMetric['metric'],unit='ratio')=>{const x=get(a),y=get(b);if(!x||!y)return unavailable(`One compatible reported ${a} and ${b} required`,unit);return calculation([x,y],unit,()=>{compatible(x,y);if(y.value<=0)throw new Error('Positive denominator required');return x.value/y.value;});};
  const direct=(name:InfrastructureMetric['metric'],unit:string)=>{const m=get(name);return m?{value:m.value,reason:null,sourceIds:m.sourceIds,unit}:unavailable(`No unique compatible reported ${name}`,unit);};
  let fundingCoverage=ratio('funding_committed','project_cost');const committed=get('funding_committed');if(committed&&(!committed.eventIds.length||committed.eventIds.some(id=>!data.events.some(e=>e.eventId===id&&['signed','funded'].includes(e.status)&&['borrowing','equity_investment','other_commitment'].includes(e.type)))))fundingCoverage=unavailable('Funding coverage requires borrowing, equity or explicit cash-funding commitments; customer backlog, commercial contracts and contingent guarantees are not cash funding');
  const customerConcentration=[...new Set(observed.filter(m=>m.metric==='customer_revenue'&&m.counterparty!==null).map(m=>m.counterparty!))].map(counterparty=>{const a=get('customer_revenue',counterparty),b=get('recognised_revenue');const result=!a||!b?unavailable('Unique compatible customer and total recognised revenue required'):calculation([a,b],'ratio',()=>{compatible(a,b);if(a.definition!==b.definition||b.value<=0||a.value>b.value)throw new Error('Customer concentration requires compatible recognised-revenue definitions and totals');return a.value/b.value;});return {counterparty,...result};});
  const committedConstruction=get('construction_committed'),paidConstruction=get('construction_paid');const constructionExposure=!committedConstruction||!paidConstruction?unavailable('Reported construction commitments and cash paid required','currency'):calculation([committedConstruction,paidConstruction],'currency',()=>{compatible(committedConstruction,paidConstruction);const value=committedConstruction.value-paidConstruction.value;if(value<0)throw new Error('Construction payments exceed compatible commitments');return value;});
  let projectCashPayback=ratio('project_cost','project_operating_cash_flow','years');const cash=get('project_operating_cash_flow');if(cash&&(cash.period.end-cash.period.start<364*86400000||cash.period.end-cash.period.start>366*86400000))projectCashPayback=unavailable('Project cash payback requires a reported annual operating-cash-flow period','years');
  const guarantees=data.events.filter(e=>e.type==='guarantee'&&['signed','funded'].includes(e.status)&&e.guarantor===entity&&(projectId===null||e.projectId===projectId));const guaranteeCase={...data,events:guarantees};const guaranteeTotal=economicExposureFromActive(guaranteeCase);
  const guaranteeExposure=guaranteeTotal.totalPrincipal===null?unavailable(guaranteeTotal.reason??'Verified guarantee principal unavailable','currency'):{value:guaranteeTotal.totalPrincipal,reason:null,sourceIds:[...new Set(guarantees.flatMap(e=>e.sourceIds))],unit:guaranteeTotal.currency??'currency'};
  return {version:INFRASTRUCTURE_VERSION,fundingCoverage,customerConcentration,powerReadiness:ratio('energised_power_mw','planned_power_mw','power-only ratio'),constructionExposure,debtServiceCapacity:ratio('cash_available_for_debt_service','debt_service_due'),guaranteeExposure,capitalIntensity:ratio('capital_expenditure','recognised_revenue'),projectCashPayback,distinctMetrics:{contractedBacklog:direct('contracted_backlog','currency'),recognisedRevenue:direct('recognised_revenue','currency'),cashCollections:direct('cash_collections','currency'),installedCapacity:direct('installed_gpu_capacity','GPU'),commerciallyAvailableCapacity:direct('available_gpu_capacity','GPU')}};
}
function economicExposureFromActive(data:InfrastructureCase){
  const events=data.events.filter(e=>['signed','funded'].includes(e.status));const map=new Map<string,FinancingEvent[]>();let reason:string|null=null,potentialDoubleCounting=false;
  for(const e of events){if(!e.economicGroupId){reason='Explicit underlying economic group IDs are required before aggregation';continue;}const rows=map.get(e.economicGroupId)??[];rows.push(e);map.set(e.economicGroupId,rows);}
  const groups=[...map.entries()].map(([economicGroupId,rows])=>{
    const currencies=new Set(rows.map(e=>e.currency)),types=new Set(rows.map(e=>e.type));let principal:number|null=null;
    const financing=[...types].every(t=>t==='borrowing'||t==='guarantee'),measurementType=financing?'financing_principal':types.size===1?[...types][0]:'incompatible_commitments';
    if(rows.some(e=>e.principal===null)||currencies.size!==1)reason='Missing principal or incompatible currency prevents aggregation';
    else if(!financing&&types.size>1)reason='Contract value, equity and financing principal are different measurements and cannot be added';
    else {
      const amounts=new Set(rows.map(e=>e.principal));
      if(rows.length>1)potentialDoubleCounting=true;
      const loans=rows.filter(e=>e.type==='borrowing'),guarantees=rows.filter(e=>e.type==='guarantee');
      if(financing&&loans.length===1&&guarantees.every(g=>g.principal!<=loans[0].principal!))principal=loans[0].principal;
      else if(amounts.size===1)principal=rows[0].principal;
      else reason='Unequal overlapping commitments require reconciliation before aggregation';
    }
    return {economicGroupId,principal,currency:currencies.size===1?rows[0].currency:null,eventIds:rows.map(e=>e.eventId),measurementType};
  });
  for(let i=0;i<events.length;i++)for(let j=i+1;j<events.length;j++){
    const a=events[i],b=events[j];
    if(a.projectId===b.projectId&&a.economicGroupId!==b.economicGroupId&&a.type!==b.type){potentialDoubleCounting=true;reason='Supplier, customer or financing commitments may share one project exposure; cross-type totals require reconciliation';}
  }
  const currencies=new Set(groups.map(g=>g.currency)),types=new Set(groups.map(g=>g.measurementType));
  if(currencies.size>1)reason='Multiple currencies require explicit sourced normalization before aggregation';
  if(types.size>1)reason='Commercial contract values, equity and debt principal are not comparable aggregate exposure measures';
  if(!events.length)reason='No verified active contractual principal is available';
  const total=reason?null:groups.reduce((n,g)=>n+g.principal!,0);if(total!==null&&(!Number.isFinite(total)||total>Number.MAX_SAFE_INTEGER))reason='Aggregate exceeds supported finite precision';
  return {version:INFRASTRUCTURE_VERSION,totalPrincipal:reason?null:total,currency:currencies.size===1?[...currencies][0]:null,groups,potentialDoubleCounting,reason,measurement:'Underlying comparable contractual principal only; not net balance-sheet loss exposure. A guarantee is not added again to the loan it covers.',executionAuthority:'none' as const};
}
export function economicExposure(input:InfrastructureCase,cutoff:number){return economicExposureFromActive(currentCase(input,cutoff));}
export function riskReview(input:InfrastructureCase,cutoff:number){
  const data=currentCase(input,cutoff),exposure=economicExposureFromActive(data),alerts:string[]=[];
  const discussions=data.events.filter(e=>e.status==='reported_discussion');if(discussions.length)alerts.push('Reported financing discussions remain uncommitted and cannot fund a signed-obligation total.');
  if(data.events.some(e=>e.status==='cancelled'))alerts.push('A cancelled commitment requires project-specific funding and customer-replacement review; it does not cancel unrelated projects.');
  if(exposure.potentialDoubleCounting||exposure.reason)alerts.push('Potential overlap or incomplete principal prevents an unqualified aggregate exposure claim.');
  const supplierFunding=data.events.some(e=>e.type==='guarantee'&&e.guarantor&&data.relationships.some(r=>r.type==='gpu_supply'&&r.projectId===e.projectId&&r.from===e.guarantor&&r.to===e.borrower));
  if(supplierFunding)alerts.push('A reported supplier-financing and purchase dependency warrants independent review; it does not prove a direct supplier sales contract or recognized revenue.');
  if(!data.metrics.some(m=>m.metric==='available_gpu_capacity'&&m.kind==='reported'&&m.value>0&&m.sourceIds.every(id=>data.sources.some(s=>s.id===id&&primary(s)))))alerts.push('Commercially available GPU capacity is unproven; planned power or installed equipment is not available service capacity.');
  return {version:INFRASTRUCTURE_VERSION,alerts,unresolvedFinancing:discussions.length>0,supplierFundedPurchases:supplierFunding,potentialDoubleCounting:exposure.potentialDoubleCounting,researchOnly:true as const,executionAuthority:'none' as const};
}
