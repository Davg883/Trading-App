import {z} from 'zod';

/**
 * Benchmark 001.2 — US Midterm Infrastructure Risk (`policy-risk-001.2-v1`).
 *
 * Policy, economic and market analyses are computed separately. Political developments are
 * research inputs only: no function here produces an order, position size or execution permission.
 */
export const POLICY_RISK_VERSION='policy-risk-001.2-v1' as const;
export const POLICY_HORIZONS=[1,5,20,60] as const;

export const POLICY_INSTRUMENTS=['election','campaign_statement','ballot_initiative','referendum','advisory_question','bill','executive_order','ordinance','court_order','utility_rule','tax_measure','company_disclosure'] as const;
export const LEGAL_STATUSES=['campaign_proposal','candidate_elected','candidate_leading','introduced','passed_one_chamber','passed_legislature','enacted','in_force','approved_unofficial','approved_certified','rejected_unofficial','rejected_certified','enacted_challenged','court_order','enjoined','struck_down','expired','repealed','not_proceeding'] as const;
export const POLICY_MECHANISMS=['election','moratorium','permitting','zoning','electricity','water','grid_connection','power_cost_allocation','tax_incentive','community_consultation','construction','litigation'] as const;
export const EXPOSURE_RELATIONS=['direct','adjacent','jurisdiction_only','unclear_per_authority','company_states_unaffected','not_applicable'] as const;
export const PROJECT_STAGES=['proposed','site_control','permitting','permitting_on_hold','approved','site_preparation','under_construction','partially_energised','operational','delayed','not_proceeding','cancelled'] as const;

const id=z.string().trim().min(1).max(200),text=z.string().trim().min(1).max(4000),time=z.number().int().nonnegative().max(8.64e15);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const mode=z.enum(['retrospective','synthetic','forward']);
const url=z.string().url().startsWith('https://').refine(v=>{const u=new URL(v);return !u.username&&!u.password&&![...u.searchParams.keys()].some(k=>/^(?:token|key|api[_-]?key|secret|password|auth|signature)$/i.test(k));},'Source URLs cannot carry credentials');
const refs=z.array(id).min(1).max(50);
const mw=z.number().finite().nonnegative().max(1e6).nullable();
const uncertainty=z.enum(['low','medium','high']);

export const policySourceSchema=z.object({id,title:text,url,kind:z.enum(['official_government','legislature','court','election_authority','company_filing','company_statement','news','tracker','law_firm','market_data','calendar']),authority:z.enum(['primary','secondary']),publishedAt:time.nullable(),publicationDate:date.nullable(),publicationBasis:z.enum(['exact','date_upper_bound','retrieval_upper_bound']),receivedAt:time,role:z.enum(['evidence','outcome','headline']),usage:z.enum(['public_reference','licensed','unknown']),mode}).strict().refine(s=>s.publishedAt===null||s.publishedAt<=s.receivedAt,'Source publication follows receipt');
export type PolicySource=z.infer<typeof policySourceSchema>;

export const policyEventSchema=z.object({
 id,revision:z.number().int().min(1).max(1000),supersedes:id.nullable(),title:text,
 jurisdiction:z.object({level:z.enum(['federal','state','county','municipal','township']),state:z.string().regex(/^[A-Z]{2}$/),locality:z.string().trim().min(1).max(200).nullable(),name:text}).strict(),
 instrument:z.enum(POLICY_INSTRUMENTS),legalStatus:z.enum(LEGAL_STATUSES),binding:z.boolean().nullable(),
 /** Effect of the recorded outcome (for votes: of the reported result), not of the question as worded. */
 direction:z.enum(['restrictive','permissive','cost_allocation','neutral','unknown']),
 mechanisms:z.array(z.enum(POLICY_MECHANISMS)).min(1).max(12),
 eventDate:date,effectiveDate:date.nullable(),expiresDate:date.nullable(),expiryCondition:text.nullable(),
 scope:z.object({thresholdMw:mw,appliesTo:text,exemptions:text.nullable()}).strict(),
 outcome:text.nullable(),uncertainty,uncertaintyNotes:z.array(text).max(20),conflictingSources:z.boolean(),
 sourceIds:refs,receivedAt:time,mode
}).strict().refine(e=>e.effectiveDate===null||e.expiresDate===null||e.effectiveDate<=e.expiresDate,'Effective date follows expiry');
export type PolicyEvent=z.infer<typeof policyEventSchema>;

const sourced=<T extends z.ZodRawShape>(shape:T)=>z.object({...shape,sourceIds:refs}).strict();
export const projectSchema=z.object({
 id,name:text,companies:z.array(z.object({name:text,ticker:z.string().regex(/^[A-Z.]{1,8}$/).nullable(),role:z.enum(['owner','developer','operator','tenant','investor'])}).strict()).min(1).max(10),
 state:z.string().regex(/^[A-Z]{2}$/),locality:text,site:text.nullable(),
 plannedMw:mw,energisedMw:mw,mwBasis:z.enum(['critical_it','gross_power_demand','unknown']),securedGridMw:mw,requestedGridMw:mw,
 stage:z.enum(PROJECT_STAGES),equipmentCommitments:z.array(sourced({supplier:text,item:text})).max(20),
 financing:z.array(sourced({instrument:text,principalUsd:z.number().finite().positive().nullable(),annualRate:z.number().finite().min(0).max(1).nullable(),maturity:z.string().max(40).nullable()})).max(20),
 customers:z.array(sourced({name:text,status:z.enum(['contracted','reported','owner_operated','undisclosed'])})).max(20),
 expectedOpening:text.nullable(),
 timelineRevisions:z.array(sourced({kind:z.enum(['delay','acceleration','hold']),previous:text.nullable(),revised:text.nullable(),delayDays:z.number().int().nonnegative().nullable(),announcedDate:date})).max(20),
 notes:z.array(text).max(20),sourceIds:refs,receivedAt:time,mode
}).strict().refine(p=>p.plannedMw===null||p.energisedMw===null||p.energisedMw<=p.plannedMw,'Energised capacity exceeds planned capacity').refine(p=>p.stage!=='cancelled'||p.sourceIds.length>0,'Cancellation must be sourced');
export type PolicyProject=z.infer<typeof projectSchema>;

export const exposureLinkSchema=z.object({id,projectId:id,eventId:id,relation:z.enum(EXPOSURE_RELATIONS),substantiation:z.enum(['primary_document','official_statement','company_statement','news_report','tracker','none']),note:text,sourceIds:refs,receivedAt:time,mode}).strict();
export type ExposureLink=z.infer<typeof exposureLinkSchema>;

export const economicObservationSchema=z.object({id,ticker:z.string().regex(/^[A-Z.]{1,8}$/),metric:z.enum(['capex','free_cash_flow','operating_cash_flow','debt','cash','compute_price','lease_revenue_contracted']),value:z.number().finite(),unit:z.enum(['USD','USD_per_gpu_hour','USD_per_kw_month']),period:text,periodEnd:date,sourceIds:refs,receivedAt:time,mode}).strict();

export const groupSchema=z.object({id,name:text,role:z.enum(['ai_infrastructure_developers','hyperscalers','chip_suppliers','diversified_benchmarks']),members:z.array(z.string().regex(/^[A-Z.]{1,8}$/)).min(1).max(30),membershipRule:text}).strict();

export const pricePointSchema=z.object({id,ticker:z.string().regex(/^[A-Z.]{1,8}$/),eventAt:time,close:z.number().finite().positive(),currency:z.literal('USD'),priceBasis:z.enum(['unadjusted_close','split-adjusted','total-return']),provider:text,sourceIds:refs,publishedAt:time.nullable(),receivedAt:time,mode}).strict().refine(p=>p.eventAt<=p.receivedAt,'Price received before its session closed');
export type PolicyPrice=z.infer<typeof pricePointSchema>;

export const hypothesisSchema=z.object({id,statement:text,kind:z.enum(['relative_below','spread_above']),subjectGroupId:id,comparisonGroupId:id,threshold:z.number().finite(),horizons:z.array(z.union([z.literal(1),z.literal(5),z.literal(20),z.literal(60)])).min(1),evidenceIds:z.array(id).max(50)}).strict();

export const policyCaseSchema=z.object({
 version:z.literal(POLICY_RISK_VERSION),id,name:text,mode,anchorAt:time,anchorEventId:id,
 sources:z.array(policySourceSchema).max(2000),events:z.array(policyEventSchema).max(2000),projects:z.array(projectSchema).max(1000),links:z.array(exposureLinkSchema).max(5000),
 economicObservations:z.array(economicObservationSchema).max(2000),groups:z.array(groupSchema).min(1).max(20),benchmarkTicker:z.string().regex(/^[A-Z.]{1,8}$/),
 calendar:z.object({id,sourceIds:refs,sessionCloses:z.array(time).min(2).max(5000),receivedAt:time}).strict(),
 prices:z.array(pricePointSchema).max(100_000),hypotheses:z.array(hypothesisSchema).max(50),
 aggregateContext:z.array(z.object({id,statement:text,sourceIds:refs}).strict()).max(50)
}).strict().superRefine((c,ctx)=>{
 const sources=new Set(c.sources.map(s=>s.id)),events=new Set(c.events.map(e=>e.id)),projects=new Set(c.projects.map(p=>p.id)),groups=new Set(c.groups.map(g=>g.id));
 const check=(ids:string[],where:string)=>ids.forEach(i=>{if(!sources.has(i))ctx.addIssue({code:'custom',message:`${where}: unknown source ${i}`});});
 const unique=(rows:{id:string}[],where:string)=>{const seen=new Set<string>();rows.forEach(r=>{if(seen.has(r.id))ctx.addIssue({code:'custom',message:`${where}: duplicate ${r.id}`});seen.add(r.id);});};
 unique(c.sources,'sources');unique(c.events,'events');unique(c.projects,'projects');unique(c.links,'links');unique(c.prices,'prices');
 c.events.forEach(e=>{check(e.sourceIds,e.id);if(e.supersedes&&!events.has(e.supersedes))ctx.addIssue({code:'custom',message:`${e.id}: superseded event missing`});});
 c.projects.forEach(p=>{check(p.sourceIds,p.id);[...p.financing,...p.customers,...p.timelineRevisions,...p.equipmentCommitments].forEach(r=>check(r.sourceIds,p.id));});
 c.links.forEach(l=>{check(l.sourceIds,l.id);if(!projects.has(l.projectId)||!events.has(l.eventId))ctx.addIssue({code:'custom',message:`${l.id}: link endpoints missing`});});
 c.prices.forEach(p=>check(p.sourceIds,p.id));c.economicObservations.forEach(o=>check(o.sourceIds,o.id));check(c.calendar.sourceIds,'calendar');
 if(!events.has(c.anchorEventId))ctx.addIssue({code:'custom',message:'Anchor event missing'});
 c.hypotheses.forEach(h=>{if(!groups.has(h.subjectGroupId)||!groups.has(h.comparisonGroupId))ctx.addIssue({code:'custom',message:`${h.id}: unknown group`});});
 const sessions=c.calendar.sessionCloses;if(sessions.some((t,i)=>i>0&&t<=sessions[i-1]))ctx.addIssue({code:'custom',message:'Calendar sessions must increase'});
 if(!sessions.includes(c.anchorAt))ctx.addIssue({code:'custom',message:'Anchor must be a calendar session close'});
});
export type PolicyCase=z.infer<typeof policyCaseSchema>;
export function parsePolicyCase(input:unknown):PolicyCase{return policyCaseSchema.parse(input);}

/** Knowledge time of a source: exact publication, otherwise the end of its publication date, never earlier than receipt. */
export function sourceKnownAt(s:PolicySource){const published=s.publishedAt??(s.publicationDate?Date.parse(`${s.publicationDate}T23:59:59.999Z`):null);return Math.max(s.receivedAt,published??s.receivedAt);}
/** Publication time used for a retrospective publication-basis reconstruction. Unknown publication stays ineligible. */
export function sourcePublishedBound(s:PolicySource){return s.publishedAt??(s.publicationDate?Date.parse(`${s.publicationDate}T23:59:59.999Z`):null);}

export type FreezeBasis='receipt'|'publication';
/**
 * Freezes the case at a cutoff. `receipt` (default) uses what the workspace had actually received.
 * `publication` is a labelled retrospective reconstruction of what had been published by the cutoff;
 * sources with unknown publication time are excluded rather than assumed early.
 */
export function freezePolicyCase(input:unknown,cutoff:number,basis:FreezeBasis='receipt'){
 const c=parsePolicyCase(input);time.parse(cutoff);
 const eligible=new Set(c.sources.filter(s=>s.role!=='outcome'&&(basis==='receipt'?sourceKnownAt(s)<=cutoff:(sourcePublishedBound(s)??Infinity)<=cutoff)).map(s=>s.id));
 const ok=(ids:string[])=>ids.every(i=>eligible.has(i));const excluded:{id:string;reason:string}[]=[];
 const keep=<T extends {id:string;sourceIds:string[];receivedAt:number}>(rows:T[])=>rows.filter(r=>{const pass=ok(r.sourceIds)&&(basis==='publication'||r.receivedAt<=cutoff);if(!pass)excluded.push({id:r.id,reason:'A supporting source was not published/received by the cutoff'});return pass;});
 const events=keep(c.events),superseded=new Set(events.map(e=>e.supersedes).filter(Boolean));
 const activeEvents=events.filter(e=>!superseded.has(e.id));const eventIds=new Set(activeEvents.map(e=>e.id));
 const projects=keep(c.projects).map(p=>({...p,financing:p.financing.filter(r=>ok(r.sourceIds)),customers:p.customers.filter(r=>ok(r.sourceIds)),timelineRevisions:p.timelineRevisions.filter(r=>ok(r.sourceIds)),equipmentCommitments:p.equipmentCommitments.filter(r=>ok(r.sourceIds))}));
 const projectIds=new Set(projects.map(p=>p.id));
 const links=keep(c.links).filter(l=>eventIds.has(l.eventId)&&projectIds.has(l.projectId));
 return {version:POLICY_RISK_VERSION,cutoff,basis,retrospectiveReconstruction:basis==='publication',case:{...c,sources:c.sources.filter(s=>eligible.has(s.id)),events:activeEvents,projects,links,economicObservations:keep(c.economicObservations),prices:c.prices.filter(p=>p.eventAt<=cutoff&&ok(p.sourceIds)&&(basis==='publication'||p.receivedAt<=cutoff))},excluded,executionAuthority:'none' as const};
}

export type PolicyClass='political_signal'|'proposed_not_enacted'|'pending_certification'|'advisory_nonbinding'|'enacted_not_yet_effective'|'active'|'court_constraint'|'blocked_by_court'|'not_adopted'|'lapsed'|'project_not_proceeding';
const rank={low:0,medium:1,high:2} as const;
export function classifyPolicyEvent(event:PolicyEvent,asOf:number,sources:PolicySource[]){
 const reasons:string[]=[];let policyClass:PolicyClass;const day=new Date(asOf).toISOString().slice(0,10);
 const s=event.legalStatus;
 if(event.instrument==='election'||event.instrument==='campaign_statement'||s==='campaign_proposal'||s==='candidate_elected'||s==='candidate_leading'){policyClass='political_signal';reasons.push('An election result or campaign pledge is not an enacted rule; it creates no restriction by itself');}
 else if(s==='introduced'||s==='passed_one_chamber'||s==='passed_legislature'){policyClass='proposed_not_enacted';reasons.push('Legislation without signature or enactment is a proposal, not an active restriction');}
 else if(s==='approved_unofficial'&&event.binding===false||event.instrument==='advisory_question'){policyClass='advisory_nonbinding';reasons.push('Advisory questions express voter preference and impose no binding rule');}
 else if(s==='approved_unofficial'||s==='rejected_unofficial'){policyClass='pending_certification';reasons.push('Unofficial vote results are not certified; the legal effect is pending');}
 else if(s==='enjoined'||s==='struck_down'){policyClass='blocked_by_court';reasons.push('A court has blocked or struck down the measure');}
 else if(s==='court_order'){policyClass='court_constraint';reasons.push('A court order constrains the decision process while it remains in force');}
 else if(s==='expired'||s==='repealed'){policyClass='lapsed';reasons.push('The measure is no longer in force');}
 else if(s==='rejected_certified'){policyClass='not_adopted';reasons.push('Voters or legislators did not adopt the measure');}
 else if(s==='not_proceeding'){policyClass='project_not_proceeding';reasons.push('A proposal that did not proceed is neither a delay nor an active rule');}
 else{const effective=event.effectiveDate,expires=event.expiresDate;
  if(effective===null){policyClass='enacted_not_yet_effective';reasons.push('Enacted, but no sourced effective date');}
  else if(effective>day){policyClass='enacted_not_yet_effective';reasons.push(`Effective ${effective}, after the assessment date`);}
  else if(expires!==null&&expires<day){policyClass='lapsed';reasons.push(`Expired ${expires}`);}
  else{policyClass='active';reasons.push(s==='enacted_challenged'?'In force but subject to pending litigation':'In force on the assessment date');}
 }
 const used=sources.filter(x=>event.sourceIds.includes(x.id));let level:keyof typeof rank=event.uncertainty;const raise=(to:keyof typeof rank,why:string)=>{if(rank[to]>rank[level])level=to;reasons.push(why);};
 if(!used.some(x=>x.authority==='primary'))raise('medium','No primary legal or official source; secondary reporting only');
 if(event.conflictingSources)raise('high','Sources conflict on status, scope or ballot placement');
 if(policyClass==='pending_certification')raise('medium','Results are unofficial until certification');
 if(s==='enacted_challenged')raise('medium','Pending litigation may alter the measure');
 const inForce=policyClass==='active'||policyClass==='court_constraint';
 return {eventId:event.id,policyClass,inForce,restrictionInForce:inForce&&(event.direction==='restrictive'||event.direction==='cost_allocation'),potentialRestriction:!inForce&&(event.direction==='restrictive'||event.direction==='cost_allocation')&&['proposed_not_enacted','pending_certification','enacted_not_yet_effective'].includes(policyClass),direction:event.direction,uncertainty:level,reasons,sourceIds:event.sourceIds,primarySourceIds:used.filter(x=>x.authority==='primary').map(x=>x.id)};
}
export type PolicyClassification=ReturnType<typeof classifyPolicyEvent>;

export type ExposureClass='directly_exposed'|'potentially_exposed'|'no_substantiated_exposure'|'not_active_project';
/** Project exposure is derived only from explicit, sourced links. Sharing a state never implies exposure. */
export function projectExposure(project:PolicyProject,links:ExposureLink[],classes:Map<string,PolicyClassification>){
 const rows=links.filter(l=>l.projectId===project.id).map(l=>({link:l,cls:classes.get(l.eventId)!})).filter(r=>r.cls);
 const direct=rows.filter(r=>r.link.relation==='direct'&&r.cls.restrictionInForce);
 const potential=rows.filter(r=>!direct.includes(r)&&r.link.relation!=='not_applicable'&&(r.cls.restrictionInForce||r.cls.potentialRestriction));
 const inactive=project.stage==='not_proceeding'||project.stage==='cancelled';
 const exposure:ExposureClass=inactive?'not_active_project':direct.length?'directly_exposed':potential.length?'potentially_exposed':'no_substantiated_exposure';
 const unenergisedMw=project.plannedMw===null?null:project.energisedMw===null?null:project.plannedMw-project.energisedMw;
 return {projectId:project.id,exposure,directEventIds:direct.map(r=>r.link.eventId),potentialEventIds:potential.map(r=>r.link.eventId),relations:rows.map(r=>({eventId:r.link.eventId,relation:r.link.relation,policyClass:r.cls.policyClass,substantiation:r.link.substantiation,note:r.link.note,sourceIds:r.link.sourceIds})),
  plannedMw:project.plannedMw,energisedMw:project.energisedMw,unenergisedMw,mwBasis:project.mwBasis,stage:project.stage,
  uncertainty:rows.reduce<keyof typeof rank>((a,r)=>rank[r.cls.uncertainty]>rank[a]?r.cls.uncertainty:a,'low')};
}

const sum=(xs:(number|null)[])=>{const known=xs.filter((x):x is number=>x!==null);return {knownMw:known.reduce((a,b)=>a+b,0),knownCount:known.length,unknownCount:xs.length-known.length};};

export function policyAssessment(input:unknown,cutoff:number,basis:FreezeBasis='receipt'){
 const frozen=freezePolicyCase(input,cutoff,basis),c=frozen.case;
 const classifications=c.events.map(e=>classifyPolicyEvent(e,cutoff,c.sources)),byId=new Map(classifications.map(k=>[k.eventId,k]));
 const exposures=c.projects.map(p=>projectExposure(p,c.links,byId));const projectById=new Map(c.projects.map(p=>[p.id,p]));
 // 1. Planned (not yet energised) capacity potentially subject to regulatory change. Planned MW never counts as operational.
 const bucket=(e:ExposureClass)=>{const xs=exposures.filter(x=>x.exposure===e);return {exposure:e,projects:xs.map(x=>x.projectId),plannedMw:sum(xs.map(x=>x.plannedMw)),energisedMw:sum(xs.map(x=>x.energisedMw)),unenergisedMw:sum(xs.map(x=>x.unenergisedMw))};};
 const capacity=(['directly_exposed','potentially_exposed','no_substantiated_exposure','not_active_project'] as const).map(bucket);
 // 2. Verified delays and incremental carry: only when principal, rate and delay length are all sourced.
 const delays=c.projects.flatMap(p=>p.timelineRevisions.filter(t=>t.kind!=='acceleration').map(t=>{const debt=p.financing.filter(f=>f.principalUsd!==null&&f.annualRate!==null);const carry=t.delayDays!==null&&debt.length?debt.reduce((a,f)=>a+f.principalUsd!*f.annualRate!*t.delayDays!/365,0):null;return {projectId:p.id,kind:t.kind,previous:t.previous,revised:t.revised,delayDays:t.delayDays,announcedDate:t.announcedDate,incrementalCarryUsd:carry,carryBasis:carry===null?'Unavailable: sourced principal, rate and delay length are all required':'Simple interest on sourced debt over the sourced delay; excludes fees, penalties and lost revenue',sourceIds:t.sourceIds};}));
 const holds=c.projects.filter(p=>p.stage==='permitting_on_hold'||p.stage==='delayed').map(p=>p.id);
 // 3. Developer concentration in affected jurisdictions (within this package's coverage only).
 const companies=[...new Set(c.projects.flatMap(p=>p.companies.filter(x=>x.role==='owner'||x.role==='developer').map(x=>x.ticker??x.name)))];
 const concentration=companies.map(name=>{const ps=c.projects.filter(p=>p.companies.some(x=>(x.ticker??x.name)===name&&(x.role==='owner'||x.role==='developer')));const affected=ps.filter(p=>['directly_exposed','potentially_exposed'].includes(exposures.find(x=>x.projectId===p.id)!.exposure));const all=sum(ps.map(p=>p.plannedMw)),hit=sum(affected.map(p=>p.plannedMw));
  return {developer:name,projects:ps.length,affectedProjects:affected.length,affectedPlannedMw:hit,totalPlannedMw:all,affectedShareOfKnownMw:all.knownMw>0&&hit.unknownCount===0&&all.unknownCount===0?hit.knownMw/all.knownMw:null,coverage:'Registered projects only; not a company-wide portfolio share'};});
 // 4. Supplier exposure to deferred deployments: only sourced equipment commitments on exposed or delayed projects.
 const exposedIds=new Set(exposures.filter(x=>x.exposure==='directly_exposed'||x.exposure==='potentially_exposed').map(x=>x.projectId).concat(holds));
 const suppliers=c.projects.filter(p=>exposedIds.has(p.id)).flatMap(p=>p.equipmentCommitments.map(e=>({projectId:p.id,supplier:e.supplier,item:e.item,sourceIds:e.sourceIds})));
 // 5. Scarcity effects on already-operational capacity in jurisdictions with restrictions in force.
 const restrictedStates=new Set(c.events.filter(e=>byId.get(e.id)!.restrictionInForce&&e.jurisdiction.level==='state').map(e=>e.jurisdiction.state));
 const operational=c.projects.filter(p=>p.energisedMw!==null&&p.energisedMw>0&&restrictedStates.has(p.state)).map(p=>({projectId:p.id,state:p.state,energisedMw:p.energisedMw}));
 const operationalUnknownMw=c.projects.filter(p=>p.stage==='operational'&&p.energisedMw===null&&restrictedStates.has(p.state)).map(p=>p.id);
 // 6. Capex, free cash flow and compute pricing: sourced observations only; mechanisms are not forecasts.
 const economics={observations:c.economicObservations,computePriceObservations:c.economicObservations.filter(o=>o.metric==='compute_price').length,
  mechanisms:[{id:'permitting_delay_to_capex_timing',chain:'Permit pause or rezoning reversal → construction start deferred → capex shifts to later periods; total cost may rise with carry and escalation',requiredInputs:['sourced revised timeline','sourced project budget','sourced financing terms']},
   {id:'delay_to_fcf',chain:'Deferred energisation → lease revenue start deferred while interest accrues → lower near-term free cash flow for the developer',requiredInputs:['contracted lease start dates','debt service schedule','sourced delay length']},
   {id:'supply_restriction_to_compute_pricing',chain:'Restricted new capacity in constrained jurisdictions → scarcer available power-ready capacity → potential pricing support for operational facilities',requiredInputs:['observed lease or GPU-hour pricing before and after','operational capacity data']},
   {id:'cost_allocation_to_opex',chain:'Large-load cost allocation rules → interconnection/infrastructure costs borne by the data centre → higher capex or tariffs',requiredInputs:['tariff filings','project load size']}],
  status:c.economicObservations.length?'Observations listed; no projection is derived from policy events':'No sourced capex, free-cash-flow or compute-pricing observations'};
 const missing:string[]=[];
 if(!c.projects.some(p=>p.securedGridMw!==null||p.requestedGridMw!==null))missing.push('No sourced secured or requested grid capacity for any registered project');
 if(!suppliers.length)missing.push('No sourced equipment or supplier commitments linked to exposed or delayed projects');
 if(!delays.length)missing.push('No verified construction delay with a revised timeline; holds are listed separately');
 if(!economics.computePriceObservations)missing.push('No observed compute or lease pricing; scarcity effects remain mechanisms only');
 exposures.filter(x=>x.plannedMw===null).forEach(x=>missing.push(`${x.projectId}: planned MW not sourced`));
 return {version:POLICY_RISK_VERSION,cutoff,basis,retrospectiveReconstruction:frozen.retrospectiveReconstruction,
  policy:{classifications,exposures,capacity,restrictedStates:[...restrictedStates],aggregateContext:c.aggregateContext},
  economic:{delays,holds,concentration,suppliers,operational,operationalUnknownMw,...economics},
  missing,excluded:frozen.excluded,projectNames:Object.fromEntries([...projectById].map(([k,v])=>[k,v.name])),
  limitation:'Research classification under fixed rules. Policy exposure is not a price forecast; share-price outcomes are evaluated separately.',executionAuthority:'none' as const};
}

export type PolicyRegistrationOptions={cutoff:number;registeredAt:number;basis?:FreezeBasis};
/** Registers the retrospective event study. Group membership, hypotheses and windows are frozen. */
export function registerPolicyExperiment(input:unknown,options:PolicyRegistrationOptions){
 const c=parsePolicyCase(input),basis=options.basis??'receipt';time.parse(options.cutoff);time.parse(options.registeredAt);
 if(options.registeredAt<options.cutoff)throw new Error('Registration cannot precede its evidence cutoff');
 const latestReceipt=Math.max(...c.sources.map(s=>s.receivedAt));if(basis==='receipt'&&options.cutoff<c.anchorAt)throw new Error('A receipt-basis registration needs a cutoff at or after the anchor');
 const assessment=policyAssessment(c,options.cutoff,basis),eligible=new Set(freezePolicyCase(c,options.cutoff,basis).case.sources.map(s=>s.id));
 for(const h of c.hypotheses)for(const e of h.evidenceIds)if(!eligible.has(e))throw new Error(`${h.id}: evidence ${e} was not available at the cutoff`);
 const sessions=c.calendar.sessionCloses,index=sessions.indexOf(c.anchorAt);
 const exposureByTicker:Record<string,ExposureClass>={};for(const x of assessment.policy.exposures){const p=c.projects.find(q=>q.id===x.projectId)!;for(const co of p.companies)if(co.ticker&&(co.role==='owner'||co.role==='developer')){const order=['not_active_project','no_substantiated_exposure','potentially_exposed','directly_exposed'],prev=exposureByTicker[co.ticker];if(!prev||order.indexOf(x.exposure)>order.indexOf(prev))exposureByTicker[co.ticker]=x.exposure;}}
 const groups=c.groups.map(g=>({...g,memberExposure:Object.fromEntries(g.members.map(m=>[m,exposureByTicker[m]??'no_substantiated_exposure']))}));
 const windows=c.groups.flatMap(g=>POLICY_HORIZONS.map(h=>({id:`${c.id}:${g.id}:${h}`,groupId:g.id,horizon:h,anchorAt:c.anchorAt,endAt:sessions[index+h]??null})));
 return {version:POLICY_RISK_VERSION,caseId:c.id,mode:c.mode,priorForecast:false as const,label:c.mode==='retrospective'?'Retrospective event study registered after the event; not a prior prediction':'Registered study',
  anchorAt:c.anchorAt,anchorEventId:c.anchorEventId,cutoff:options.cutoff,basis,registeredAt:options.registeredAt,latestSourceReceipt:latestReceipt,benchmarkTicker:c.benchmarkTicker,
  groups,hypotheses:c.hypotheses,windows,calendar:c.calendar,assessmentSummary:{exposures:assessment.policy.exposures.map(x=>({projectId:x.projectId,exposure:x.exposure}))},executionAuthority:'none' as const};
}
export type PolicyRegistration=ReturnType<typeof registerPolicyExperiment>;

/** Evaluates a frozen window from an independently registered observation set. Missing or unaligned closes keep it pending. */
export function evaluatePolicyWindow(registration:PolicyRegistration,observations:PolicyPrice[],windowId:string,asOf:number){
 const w=registration.windows.find(x=>x.id===windowId);if(!w)throw new Error('Unknown window');
 const g=registration.groups.find(x=>x.id===w.groupId)!,base={windowId,groupId:g.id,horizon:w.horizon,anchorAt:w.anchorAt,endAt:w.endAt,executionAuthority:'none' as const};
 if(w.endAt===null)return {...base,status:'pending' as const,reason:'Calendar does not extend to this horizon',result:null};
 if(w.endAt>asOf)return {...base,status:'pending' as const,reason:'Window end is after the evaluation time',result:null};
 const sessions=registration.calendar.sessionCloses.filter(t=>t>=w.anchorAt&&t<=w.endAt!);
 const usable=observations.filter(p=>p.receivedAt<=asOf);const paths:Record<string,number[]>={};
 for(const m of g.members){const rows=sessions.map(t=>usable.filter(p=>p.ticker===m&&p.eventAt===t));
  if(rows.some(r=>r.length!==1))return {...base,status:'pending' as const,reason:`${m}: an aligned, unambiguous close is required for every session`,result:null};
  const flat=rows.map(r=>r[0]);if(new Set(flat.map(p=>`${p.provider}|${p.priceBasis}`)).size!==1)return {...base,status:'pending' as const,reason:`${m}: provider or price basis changes within the window`,result:null};
  paths[m]=flat.map(p=>p.close/flat[0].close);}
 const value=sessions.map((_,i)=>g.members.reduce((a,m)=>a+paths[m][i],0)/g.members.length);let peak=value[0],maxDrawdown=0;for(const v of value){peak=Math.max(peak,v);maxDrawdown=Math.min(maxDrawdown,v/peak-1);}
 const memberReturns=Object.fromEntries(g.members.map(m=>[m,paths[m][paths[m].length-1]-1]));
 return {...base,status:'complete' as const,reason:null,result:{equalWeightReturn:value[value.length-1]-1,maxDrawdown,memberReturns,sessions:sessions.length-1,priceBasis:'Unadjusted public reference closes; corporate actions unreviewed; USD price return, no costs or FX'}};
}

export function evaluatePolicyStudy(registration:PolicyRegistration,observations:PolicyPrice[],asOf:number){
 const outcomes=registration.windows.map(w=>evaluatePolicyWindow(registration,observations,w.id,asOf));
 const bench=registration.groups.find(g=>g.members.length===1&&g.members[0]===registration.benchmarkTicker)?.id??null;
 const at=(group:string,h:number)=>outcomes.find(o=>o.groupId===group&&o.horizon===h);
 const relative=outcomes.map(o=>{const b=bench?at(bench,o.horizon):undefined;return {windowId:o.windowId,groupId:o.groupId,horizon:o.horizon,relativeToBenchmark:o.result&&b?.result?o.result.equalWeightReturn-b.result.equalWeightReturn:null};});
 const rel=(group:string,h:number)=>relative.find(r=>r.groupId===group&&r.horizon===h)?.relativeToBenchmark??null;
 const hypotheses=registration.hypotheses.flatMap(h=>h.horizons.map(n=>{const subject=rel(h.subjectGroupId,n),comparison=h.comparisonGroupId===bench?0:rel(h.comparisonGroupId,n);
  if(subject===null||comparison===null)return {hypothesisId:h.id,horizon:n,status:'pending' as const,value:null};
  const v=subject-comparison,consistent=h.kind==='relative_below'?v<h.threshold:v>h.threshold;return {hypothesisId:h.id,horizon:n,status:consistent?'consistent' as const:'inconsistent' as const,value:v};}));
 return {version:POLICY_RISK_VERSION,asOf,benchmarkGroupId:bench,outcomes,relative,hypotheses,caveat:'Descriptive event-study comparison of a single event; small groups, no significance test and no causal attribution to the election.',executionAuthority:'none' as const};
}

/** An independently captured set of later closes. Only sources and prices may be appended; nothing in the registered case changes. */
export const policyObservationSetSchema=z.object({id,capturedAt:time,sources:z.array(policySourceSchema).min(1).max(200),prices:z.array(pricePointSchema).min(1).max(50_000)}).strict().superRefine((s,ctx)=>{
 const ids=new Set(s.sources.map(x=>x.id));s.prices.forEach(p=>p.sourceIds.forEach(i=>{if(!ids.has(i))ctx.addIssue({code:'custom',message:`${p.id}: unknown source ${i}`});}));
 if(new Set(s.prices.map(p=>p.id)).size!==s.prices.length)ctx.addIssue({code:'custom',message:'Duplicate price IDs'});
 if(s.sources.some(x=>x.receivedAt>s.capturedAt)||s.prices.some(p=>p.receivedAt>s.capturedAt))ctx.addIssue({code:'custom',message:'Observations cannot be received after the capture time'});
});
export type PolicyObservationSet=z.infer<typeof policyObservationSetSchema>;

/**
 * Combines registered closes with later observation sets. An identical re-capture of the same session collapses to one row;
 * a conflicting close is kept, so the affected window stays pending instead of silently choosing a value.
 */
export function mergePolicyObservations(base:PolicyPrice[],...sets:PolicyObservationSet[]):PolicyPrice[]{
 const out=[...base];
 for(const set of sets)for(const p of set.prices){const same=out.find(q=>q.ticker===p.ticker&&q.eventAt===p.eventAt);if(same&&same.close===p.close&&same.provider===p.provider&&same.priceBasis===p.priceBasis)continue;out.push(p);}
 return out;
}
