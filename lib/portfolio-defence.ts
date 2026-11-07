import { z } from 'zod';

export const DEFENCE_VERSION = 'defence-001.3-v1' as const;
export const DEFENCE_CATEGORIES = ['ai_correction','equity_downturn','rates_credit','recession','ai_recovery'] as const;
const id = z.string().trim().min(1).max(200), text = z.string().trim().min(1).max(10000);
const time = z.number().int().nonnegative().max(8.64e15), money = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const mode = z.enum(['synthetic','historical','forward']);
const currency = z.string().regex(/^[A-Z]{3}$/);
const basis = z.enum(['total-return','split-adjusted']);
const refs = z.array(id).min(1).max(100);
const url = z.string().url().startsWith('https://').refine(s => { const u = new URL(s); return !u.username && !u.password; }, 'Source credentials are forbidden');
export const defenceSourceSchema = z.object({id,title:text,url,publishedAt:time,receivedAt:time,mode,verified:z.boolean(),role:z.enum(['evidence','outcome'])}).strict().refine(s => s.receivedAt >= s.publishedAt, 'Receipt precedes publication');
export const defenceInstrumentSchema = z.object({
  id,name:text,symbol:id,isin:id.nullable(),currency,company:text,sector:text,country:text,aiLayer:text,aiRelated:z.boolean().nullable(),
  product:z.enum(['equity','etf','cash','bond','gold_etc','protective_put','collar','inverse']),paperEligible:z.boolean(),
  availability:text,structure:text,annualFeeBps:money.nullable(),sourceIds:refs,restrictions:z.array(text).min(1).max(50),risks:z.array(text).min(1).max(50),
  protectsAgainst:z.array(text).min(1).max(50),cannotProtectAgainst:z.array(text).min(1).max(50),lossConditions:z.array(text).min(1).max(50),
}).strict().refine(i => !['protective_put','collar','inverse'].includes(i.product) || !i.paperEligible, 'Derivatives and inverse products are research only');
export const defenceFundSchema = z.object({id,instrumentId:id,asOf:time,publishedAt:time,receivedAt:time,verified:z.boolean(),mode,sourceIds:refs,constituents:z.array(z.object({instrumentId:id,weight:z.number().finite().positive().max(1)}).strict()).max(5000)}).strict().superRefine((f,c) => {
  if(f.asOf > f.publishedAt || f.publishedAt > f.receivedAt)c.addIssue({code:'custom',message:'Fund holdings timestamps are reversed'});
  if(f.constituents.reduce((n,r) => n+r.weight,0) > 1+1e-10 || new Set(f.constituents.map(r => r.instrumentId)).size !== f.constituents.length)c.addIssue({code:'custom',message:'Fund weights exceed 100% or duplicate constituents'});
});
export const defencePortfolioSchema = z.object({id,name:text,initialCapital:z.number().finite().positive().max(Number.MAX_SAFE_INTEGER),currency,horizonSessions:z.number().int().positive().max(10000),priceBasis:basis,calendarId:id,session:z.literal('regular'),mode,allocations:z.array(z.object({instrumentId:id,weight:z.number().finite().positive().max(1)}).strict()).min(1).max(500),costs:z.object({fees:money,slippage:money,financing:money}).strict()}).strict().superRefine((p,c) => {
  if(Math.abs(p.allocations.reduce((n,a) => n+a.weight,0)-1)>1e-10 || new Set(p.allocations.map(a => a.instrumentId)).size !== p.allocations.length)c.addIssue({code:'custom',message:'Fully funded long-only weights must total 100% with unique instruments'});
  if(p.costs.fees+p.costs.slippage+p.costs.financing>p.initialCapital)c.addIssue({code:'custom',message:'Costs cannot exceed initial capital'});
});
export const defenceHistorySchema = z.object({id,instrumentId:id,provider:text,currency,priceBasis:basis,adjustmentVersion:id,calendarId:id,session:z.literal('regular'),mode,corporateActionsReviewed:z.boolean(),sessionsPerYear:z.number().int().positive().max(366),calendarVerified:z.boolean(),calendarSessions:z.array(time).min(2).max(10000),observations:z.array(z.object({eventAt:time,publishedAt:time,receivedAt:time,close:z.number().finite().positive(),sourceId:id}).strict()).max(10000)}).strict().superRefine((h,c) => {
  if(h.calendarSessions.some((t,i) => i>0&&t<=h.calendarSessions[i-1]))c.addIssue({code:'custom',message:'Calendar sessions must increase strictly'});
  if(new Set(h.observations.map(o => o.eventAt)).size !== h.observations.length)c.addIssue({code:'custom',message:'Duplicate history sessions'});
  if(h.observations.some(o => o.eventAt>o.publishedAt||o.publishedAt>o.receivedAt||!h.calendarSessions.includes(o.eventAt)))c.addIssue({code:'custom',message:'History event/publication/receipt ordering or calendar is invalid'});
});
export const defenceScenarioSchema = z.object({id,name:text,category:z.enum(DEFENCE_CATEGORIES),kind:z.enum(['user_defined','historical']),mode,publishedAt:time,receivedAt:time,sourceIds:refs,startAt:time,endAt:time,horizonSessions:z.number().int().positive().max(10000),calendarId:id,currency,priceBasis:basis,session:z.literal('regular'),returns:z.array(z.object({instrumentId:id,return:z.number().finite().min(-1)}).strict()).min(1).max(500)}).strict().superRefine((s,c) => {
  if(s.endAt<=s.startAt||s.receivedAt<s.publishedAt)c.addIssue({code:'custom',message:'Scenario dates are invalid'});
  if(s.kind==='historical'&&(s.endAt>s.publishedAt||s.mode==='synthetic'))c.addIssue({code:'custom',message:'Historical scenarios require completed observed windows'});
  if(new Set(s.returns.map(r=>r.instrumentId)).size!==s.returns.length)c.addIssue({code:'custom',message:'Duplicate scenario instrument'});
});
export const defenceCaseSchema = z.object({version:z.literal(DEFENCE_VERSION),id,name:text,mode,sources:z.array(defenceSourceSchema).max(1000),instruments:z.array(defenceInstrumentSchema).max(1000),funds:z.array(defenceFundSchema).max(1000),portfolios:z.array(defencePortfolioSchema).max(100),scenarios:z.array(defenceScenarioSchema).max(100),histories:z.array(defenceHistorySchema).max(100)}).strict();
export type DefenceCase = z.infer<typeof defenceCaseSchema>;
export type DefenceInstrument = z.infer<typeof defenceInstrumentSchema>;
export type DefencePortfolio = z.infer<typeof defencePortfolioSchema>;
export type DefenceHistory = z.infer<typeof defenceHistorySchema>;
export type DefenceScenario = z.infer<typeof defenceScenarioSchema>;
export type DefenceSource = z.infer<typeof defenceSourceSchema>;
export type DefenceFund = z.infer<typeof defenceFundSchema>;
function errorMessage(e:unknown){return e instanceof Error?e.message:'Invalid evidence';}
function validNumbers(...values:number[]){if(values.some(v=>!Number.isFinite(v)||Math.abs(v)>Number.MAX_SAFE_INTEGER))throw new Error('Calculation exceeds supported finite numeric precision');}
const eligibleSource = (s:DefenceSource,cutoff:number) => s.verified&&s.role==='evidence'&&s.publishedAt<=cutoff&&s.receivedAt<=cutoff;
export function parseDefenceCase(input:unknown):DefenceCase {
  const data=defenceCaseSchema.parse(input);
  for(const rows of [data.sources,data.instruments,data.funds,data.portfolios,data.scenarios,data.histories])if(new Set(rows.map(r=>r.id)).size!==rows.length)throw new Error('Register IDs must be unique');
  if([...data.sources,...data.funds,...data.portfolios,...data.scenarios,...data.histories].some(r=>r.mode!==data.mode))throw new Error('Synthetic, historical and forward evidence cannot be combined');
  const sources=new Set(data.sources.map(s=>s.id)),instruments=new Map(data.instruments.map(i=>[i.id,i]));
  for(const row of [...data.instruments,...data.funds,...data.scenarios])if(row.sourceIds.some(s=>!sources.has(s)))throw new Error('Missing source reference');
  for(const f of data.funds)if(instruments.get(f.instrumentId)?.product!=='etf'||f.constituents.some(r=>!instruments.has(r.instrumentId)))throw new Error('Fund or constituent instrument is missing');
  for(const p of data.portfolios)if(p.allocations.some(a=>!instruments.has(a.instrumentId)))throw new Error('Portfolio instrument is missing');
  for(const s of data.scenarios)if(s.returns.some(r=>!instruments.has(r.instrumentId)))throw new Error('Scenario instrument is missing');
  for(const h of data.histories){if(!instruments.has(h.instrumentId)||h.observations.some(o=>!sources.has(o.sourceId)))throw new Error('History instrument or source is missing');if(h.currency!==instruments.get(h.instrumentId)!.currency)throw new Error('History and instrument currencies must match; FX-normalised instruments require separate sourced records');}
  const fundVersions=new Set<string>();for(const f of data.funds){const key=`${f.instrumentId}|${f.asOf}|${f.receivedAt}`;if(fundVersions.has(key))throw new Error('Ambiguous fund holdings revisions require distinct receipt timestamps');fundVersions.add(key);}
  // Linear graph validation also avoids repeated expansion of shared nested holdings.
  const complete=new Set<string>(),active=new Set<string>();
  function visit(instrumentId:string){if(active.has(instrumentId))throw new Error('Cyclic ETF look-through is unsupported');if(complete.has(instrumentId))return;active.add(instrumentId);for(const f of data.funds.filter(f=>f.instrumentId===instrumentId))for(const c of f.constituents)if(instruments.get(c.instrumentId)?.product==='etf')visit(c.instrumentId);active.delete(instrumentId);complete.add(instrumentId);}
  for(const f of data.funds)visit(f.instrumentId);
  return data;
}
export function freezeDefenceCase(input:unknown,cutoff:number) {
  const data=parseDefenceCase(input);time.parse(cutoff);
  const excluded:{id:string;reason:string}[]=[],sources=data.sources.filter(s=>{const ok=eligibleSource(s,cutoff);if(!ok)excluded.push({id:s.id,reason:s.role==='outcome'?'Outcomes cannot enter forecast evidence':!s.verified?'Unverified source':'Publication or receipt follows cutoff'});return ok;});
  const sourceIds=new Set(sources.map(s=>s.id));
  const instruments=data.instruments.filter(i=>{const ok=i.sourceIds.every(id=>sourceIds.has(id));if(!ok)excluded.push({id:i.id,reason:'Instrument specification lacks eligible evidence'});return ok;});
  const ids=new Set(instruments.map(i=>i.id));
  const funds=data.funds.filter(f=>{const ok=f.asOf<=cutoff&&f.publishedAt<=cutoff&&f.receivedAt<=cutoff&&f.verified&&f.sourceIds.every(id=>sourceIds.has(id))&&ids.has(f.instrumentId)&&f.constituents.every(c=>ids.has(c.instrumentId));if(!ok)excluded.push({id:f.id,reason:'Fund holdings are unverified, late or lack eligible constituent evidence'});return ok;});
  const portfolios=data.portfolios.filter(p=>{const ok=p.allocations.every(a=>ids.has(a.instrumentId));if(!ok)excluded.push({id:p.id,reason:'Portfolio has instruments without eligible evidence'});return ok;});
  const scenarios=data.scenarios.filter(s=>{const ok=s.publishedAt<=cutoff&&s.receivedAt<=cutoff&&s.sourceIds.every(id=>sourceIds.has(id))&&s.returns.every(r=>ids.has(r.instrumentId));if(!ok)excluded.push({id:s.id,reason:'Scenario evidence is unavailable at cutoff'});return ok;});
  const histories=data.histories.filter(h=>ids.has(h.instrumentId)).map(h=>({...h,observations:h.observations.filter(o=>{const ok=o.eventAt<=cutoff&&o.publishedAt<=cutoff&&o.receivedAt<=cutoff&&sourceIds.has(o.sourceId);if(!ok)excluded.push({id:`${h.id}:${o.eventAt}`,reason:'History observation or revision unavailable at cutoff'});return ok;})}));
  return {version:DEFENCE_VERSION,cutoff,case:{...data,sources,instruments,funds,portfolios,scenarios,histories},excluded,executionAuthority:'none' as const};
}

export type ExposureLeaf={instrumentId:string|null;name:string;weight:number;via:string[];company:string;sector:string;country:string;currency:string;aiLayer:string;aiRelated:boolean|null;unknownReason:string|null};
export function portfolioExposure(input:unknown,portfolioId:string,cutoff:number,maxFundAgeDays=90) {
  if(!Number.isFinite(maxFundAgeDays)||maxFundAgeDays<=0)throw new Error('Positive holdings age limit required');
  const frozen=freezeDefenceCase(input,cutoff),data=frozen.case,p=data.portfolios.find(p=>p.id===portfolioId);if(!p)throw new Error('Portfolio is unavailable at cutoff');
  const leaves:ExposureLeaf[]=[],instruments=new Map(data.instruments.map(i=>[i.id,i]));
  function unknown(weight:number,via:string[],reason:string){leaves.push({instrumentId:null,name:'Unresolved fund exposure',weight,via,company:'Unknown',sector:'Unknown',country:'Unknown',currency:'Unknown',aiLayer:'Unknown',aiRelated:null,unknownReason:reason});}
  function expand(instrumentId:string,weight:number,via:string[]){
    if(via.length>20||leaves.length>=100000)throw new Error('Nested holdings exceed supported research expansion limits');
    const i=instruments.get(instrumentId)!;
    if(i.product!=='etf'){leaves.push({instrumentId,name:i.name,weight,via,company:i.company,sector:i.sector,country:i.country,currency:i.currency,aiLayer:i.aiLayer,aiRelated:i.aiRelated,unknownReason:i.aiRelated===null?'AI classification is unverified':null});return;}
    const fund=data.funds.filter(f=>f.instrumentId===i.id&&cutoff-f.asOf<=maxFundAgeDays*86400000).sort((a,b)=>b.asOf-a.asOf||b.receivedAt-a.receivedAt)[0];
    if(!fund){unknown(weight,[...via,i.id],'No current verified fund holdings; global index exposure is not assumed independent of AI');return;}
    for(const c of fund.constituents)expand(c.instrumentId,weight*c.weight,[...via,i.id]);
    const residual=1-fund.constituents.reduce((n,c)=>n+c.weight,0);if(residual>1e-10)unknown(weight*residual,[...via,i.id],'Undisclosed fund holdings remain unresolved');
  }
  for(const a of p.allocations)expand(a.instrumentId,a.weight,[]);
  const dimensions=Object.fromEntries((['company','sector','country','currency','aiLayer'] as const).map(key=>{const values:Record<string,number>={};for(const l of leaves)values[l[key]]=(values[l[key]]??0)+l.weight;return [key,values];})) as Record<'company'|'sector'|'country'|'currency'|'aiLayer',Record<string,number>>;
  const aiWeight=leaves.filter(l=>l.aiRelated===true).reduce((n,l)=>n+l.weight,0),unknownAiWeight=leaves.filter(l=>l.aiRelated===null).reduce((n,l)=>n+l.weight,0);
  const companyWeights=dimensions.company;
  return {version:DEFENCE_VERSION,portfolioId,mode:data.mode,initialCapital:p.initialCapital,currency:p.currency,leaves,dimensions,aiWeight,unknownAiWeight,knownNonAiWeight:1-aiWeight-unknownAiWeight,companyHhi:Object.entries(companyWeights).filter(([name])=>name!=='Unknown').reduce((n,[,w])=>n+w*w,0),hhiComplete:!leaves.some(l=>l.company==='Unknown'),excluded:frozen.excluded,executionAuthority:'none' as const};
}

function matchedPortfolios(a:DefencePortfolio,b:DefencePortfolio){if((['initialCapital','currency','horizonSessions','priceBasis','calendarId','session','mode'] as const).some(k=>a[k]!==b[k]))throw new Error('Comparisons require identical initial capital, horizon, currency, calendar, session, price basis and evidence mode');}
function historyWindow(data:DefenceCase,instrumentId:string,startAt:number,endAt:number,cutoff:number){
  const candidates=data.histories.filter(h=>h.instrumentId===instrumentId);if(candidates.length!==1)throw new Error('Exactly one explicit price history is required per instrument');const h=candidates[0];
  if(!h.calendarVerified||!h.corporateActionsReviewed)throw new Error('Verified calendar and corporate-action treatment required');
  const sessions=h.calendarSessions.filter(t=>t>=startAt&&t<=endAt);if(sessions[0]!==startAt||sessions.at(-1)!==endAt)throw new Error('Price windows require exact registered sessions');
  const rows=sessions.map(t=>{const o=h.observations.find(o=>o.eventAt===t);if(!o||o.receivedAt>cutoff||o.publishedAt>cutoff)throw new Error('Missing aligned eligible price observation');return o;});return {history:h,sessions,rows};
}
function scenarioPortfolio(data:DefenceCase,p:DefencePortfolio,s:DefenceScenario,cutoff:number){
  if((['currency','horizonSessions','priceBasis','calendarId','session','mode'] as const).some(k=>p[k]!==s[k]))throw new Error('Scenario and portfolio conventions must match');
  let grossReturn=0;
  for(const a of p.allocations){const i=data.instruments.find(i=>i.id===a.instrumentId)!;if(['protective_put','collar','inverse'].includes(i.product))throw new Error('Complex products require separate contract or daily-path research; static shocks are unsupported');const r=s.returns.find(r=>r.instrumentId===a.instrumentId);if(!r)throw new Error('Missing scenario return; missing prices cannot be fabricated');
    if(s.kind==='historical'){const {history:h,sessions,rows}=historyWindow(data,a.instrumentId,s.startAt,s.endAt,cutoff);if(h.currency!==p.currency||h.priceBasis!==p.priceBasis||h.calendarId!==p.calendarId||h.session!==p.session||h.mode!==p.mode||sessions.length-1!==p.horizonSessions)throw new Error('Historical scenario has incompatible observation conventions');const observed=rows.at(-1)!.close/rows[0].close-1;if(Math.abs(observed-r.return)>1e-10)throw new Error('Historical scenario return differs from eligible sourced prices');}
    grossReturn+=a.weight*r.return;
  }
  const costs=p.costs.fees+p.costs.slippage+p.costs.financing;
  // Reserve all declared costs from starting capital before deploying the remaining notional.
  const deployedCapital=p.initialCapital-costs,grossPnl=deployedCapital*grossReturn,netPnl=grossPnl-costs;validNumbers(grossReturn,deployedCapital,grossPnl,netPnl,p.initialCapital+netPnl);
  return {portfolioId:p.id,initialCapital:p.initialCapital,deployedCapital,currency:p.currency,grossReturn,grossPnl,costs,netPnl,netReturn:netPnl/p.initialCapital,endingCapital:p.initialCapital+netPnl,stressLoss:Math.max(0,-netPnl)};
}
export function compareDefencePortfolios(input:unknown,baselineId:string,alternativeId:string,scenarioId:string,cutoff:number){
  const data=freezeDefenceCase(input,cutoff).case,a=data.portfolios.find(p=>p.id===baselineId),b=data.portfolios.find(p=>p.id===alternativeId),s=data.scenarios.find(s=>s.id===scenarioId);if(!a||!b||!s)throw new Error('Portfolio or scenario evidence unavailable at cutoff');matchedPortfolios(a,b);
  const baseline=scenarioPortfolio(data,a,s,cutoff),alternative=scenarioPortfolio(data,b,s,cutoff);
  const grossProtection=alternative.grossPnl-baseline.grossPnl,netProtection=alternative.netPnl-baseline.netPnl,reboundParticipation=baseline.netReturn>0?alternative.netReturn/baseline.netReturn:null;validNumbers(grossProtection,netProtection,...(reboundParticipation===null?[]:[reboundParticipation]));
  return {version:DEFENCE_VERSION,scenarioId,scenarioKind:s.kind,mode:data.mode,startAt:s.startAt,endAt:s.endAt,horizonSessions:s.horizonSessions,priceBasis:s.priceBasis,baseline,alternative,grossProtection,netProtection,reboundParticipation,executionAuthority:'none' as const};
}

export function defenceHistoryAnalytics(input:unknown,instrumentId:string,benchmarkId:string,cutoff:number,options:{minimumReturns?:number;rollingWindow?:number;startAt?:number;endAt?:number}={}){
  const minimumReturns=options.minimumReturns??60,rollingWindow=options.rollingWindow??60;
  if(!Number.isInteger(minimumReturns)||minimumReturns<30||!Number.isInteger(rollingWindow)||rollingWindow<30)throw new Error('At least 30 daily returns are required; default research minimum is 60');
  let observedSamples=0;
  const absent=(reason:string)=>({version:DEFENCE_VERSION,mode:parseDefenceCase(input).mode,samples:observedSamples,correlation:null,beta:null,annualVolatility:null,maxDrawdown:null,rolling:[] as {endAt:number;correlation:number|null;beta:number|null}[],reason,reliable:false,executionAuthority:'none' as const});
  try{const data=freezeDefenceCase(input,cutoff).case,rawA=data.histories.filter(h=>h.instrumentId===instrumentId),rawB=data.histories.filter(h=>h.instrumentId===benchmarkId);if(rawA.length!==1||rawB.length!==1)throw new Error('Exactly one sourced instrument and benchmark history required');const ah=rawA[0],bh=rawB[0];
    if((['currency','priceBasis','adjustmentVersion','calendarId','session','mode','sessionsPerYear'] as const).some(k=>ah[k]!==bh[k]))throw new Error('Histories require aligned currency, adjustment, calendar, session and mode');
    const startAt=options.startAt??Math.max(ah.calendarSessions[0],bh.calendarSessions[0]),lastCommonSession=[...ah.calendarSessions].reverse().find(t=>t<=cutoff&&bh.calendarSessions.includes(t)),endAt=options.endAt??lastCommonSession;if(endAt===undefined)throw new Error('No completed common trading session at cutoff');
    const a=historyWindow(data,instrumentId,startAt,endAt,cutoff),b=historyWindow(data,benchmarkId,startAt,endAt,cutoff);if(a.sessions.length!==b.sessions.length||a.sessions.some((t,i)=>t!==b.sessions[i]))throw new Error('Trading sessions are not aligned');
    const returns=(rows:typeof a.rows)=>rows.slice(1).map((r,i)=>{const value=r.close/rows[i].close-1;validNumbers(value);return value;}),x=returns(a.rows),y=returns(b.rows);observedSamples=x.length;if(x.length<minimumReturns)throw new Error(`Insufficient aligned history: ${x.length} returns; ${minimumReturns} required`);
    const stats=(xs:number[],ys:number[])=>{const xm=xs.reduce((n,v)=>n+v,0)/xs.length,ym=ys.reduce((n,v)=>n+v,0)/ys.length,xx=xs.reduce((n,v)=>n+(v-xm)**2,0),yy=ys.reduce((n,v)=>n+(v-ym)**2,0),xy=xs.reduce((n,v,i)=>n+(v-xm)*(ys[i]-ym),0);return {correlation:xx>0&&yy>0?xy/Math.sqrt(xx*yy):null,beta:yy>0?xy/yy:null,annualVolatility:Math.sqrt(xx/(xs.length-1))*Math.sqrt(ah.sessionsPerYear)};};
    let peak=a.rows[0].close,maxDrawdown=0;for(const r of a.rows){peak=Math.max(peak,r.close);maxDrawdown=Math.min(maxDrawdown,r.close/peak-1);}const result=stats(x,y),rolling:{endAt:number;correlation:number|null;beta:number|null}[]=[];
    for(let end=rollingWindow;end<=x.length;end++){const r=stats(x.slice(end-rollingWindow,end),y.slice(end-rollingWindow,end));rolling.push({endAt:a.rows[end].eventAt,correlation:r.correlation,beta:r.beta});}
    validNumbers(result.annualVolatility,maxDrawdown,...[result.correlation,result.beta].filter((v):v is number=>v!==null),...rolling.flatMap(r=>[r.correlation,r.beta].filter((v):v is number=>v!==null)));
    return {version:DEFENCE_VERSION,mode:data.mode,samples:x.length,...result,maxDrawdown,rolling,reason:result.correlation===null||result.beta===null?'Constant return history prevents correlation or beta estimation':null,reliable:false,limitation:'Descriptive historical statistics, not a reliable forecast or validated covariance estimate',executionAuthority:'none' as const};
  }catch(e){return absent(errorMessage(e));}
}

export const optionResearchSchema=z.object({kind:z.enum(['protective_put','collar']),underlyingStart:z.number().finite().positive(),underlyingEnd:z.number().finite().nonnegative().nullable(),shares:z.number().int().positive(),contracts:z.number().int().positive(),multiplier:z.number().int().positive(),putStrike:z.number().finite().positive(),putPremium:money,callStrike:z.number().finite().positive().nullable(),callPremium:money,expiryAt:time,settlementAt:time.nullable(),asOf:time,currency,premiumCurrency:currency,fees:money}).strict().superRefine((o,c)=>{if(o.contracts*o.multiplier>o.shares)c.addIssue({code:'custom',message:'Contracts cannot exceed fully funded underlying coverage'});if(o.currency!==o.premiumCurrency)c.addIssue({code:'custom',message:'Option premium currency requires explicit conversion'});if(o.kind==='protective_put'&&(o.callStrike!==null||o.callPremium!==0)||o.kind==='collar'&&(o.callStrike===null||o.callStrike<=o.putStrike))c.addIssue({code:'custom',message:'Invalid put or covered collar specification'});});
export function optionResearchPayoff(input:unknown){
  const o=optionResearchSchema.parse(input),coveredShares=o.contracts*o.multiplier,premium=(o.putPremium-o.callPremium)*coveredShares;validNumbers(coveredShares,premium);
  if(o.asOf<o.expiryAt||o.settlementAt!==o.expiryAt||o.underlyingEnd===null)return {version:DEFENCE_VERSION,evidenceStatus:'unverified_user_input' as const,status:'pending' as const,grossPnl:null,netPnl:null,premium,fees:o.fees,reason:'Expiry settlement observation required; intrinsic value is not a pre-expiry option mark',executionAuthority:'none' as const};
  const underlyingPnl=(o.underlyingEnd-o.underlyingStart)*o.shares,putPayoff=Math.max(o.putStrike-o.underlyingEnd,0)*coveredShares,callLiability=o.kind==='collar'?Math.max(o.underlyingEnd-o.callStrike!,0)*coveredShares:0,grossPnl=underlyingPnl+putPayoff-callLiability;
  validNumbers(underlyingPnl,putPayoff,callLiability,grossPnl,grossPnl-premium-o.fees);return {version:DEFENCE_VERSION,evidenceStatus:'unverified_user_input' as const,status:'complete' as const,underlyingPnl,putPayoff,callLiability,grossPnl,netPnl:grossPnl-premium-o.fees,premium,fees:o.fees,reason:null,executionAuthority:'none' as const};
}
export function dailyInverseResearch(dailyReturns:number[],annualFeeBps:number,sessionsPerYear=252){
  z.array(z.number().finite().min(-1).max(1)).min(1).max(10000).parse(dailyReturns);money.parse(annualFeeBps);z.number().int().positive().max(366).parse(sessionsPerYear);
  const dailyFee=annualFeeBps/10000/sessionsPerYear;if(dailyFee>=1)throw new Error('Invalid fee assumption');
  const indexReturn=dailyReturns.reduce((v,r)=>v*(1+r),1)-1,grossReturn=dailyReturns.reduce((v,r)=>v*(1-r),1)-1,netReturn=dailyReturns.reduce((v,r)=>v*(1-r)*(1-dailyFee),1)-1;
  validNumbers(indexReturn,grossReturn,netReturn,grossReturn-netReturn);return {version:DEFENCE_VERSION,evidenceStatus:'unverified_user_input' as const,indexReturn,grossReturn,netReturn,feeDrag:grossReturn-netReturn,reset:'daily' as const,executionAuthority:'none' as const,limitation:'Illustrative unlevered inverse daily target; tracking, financing, spread and tax differences require observed product data'};
}
