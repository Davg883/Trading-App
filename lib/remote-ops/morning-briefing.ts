import {
 REMOTE_OPS_VERSION,
 type ConfirmedFactItem,
 type IncompleteEvidenceItem,
 type MorningBriefingRecord,
 type ResearchInterpretationItem,
 type RiskChangeItem,
} from './contracts';

/**
 * Daily Morning Intelligence Brief generator (Deliverable 6, Sections 4, 6, 7).
 *
 * Scheduled for 07:30 Europe/London on weekdays.
 * Strictly separates:
 * 1. Confirmed Facts (primary-source-backed facts, official disclosures, synchronised read-only broker snapshot, dated closes).
 * 2. Research Interpretation (agent summaries, AI infrastructure developments, proposed hypotheses; zero execution authority).
 * 3. Risk Changes (concentration, AI-sector exposure, drawdown, policy-risk restrictions, broker sync freshness, trading gates).
 * 4. Incomplete Evidence (missing licensed feeds, unconfirmed recovery/policy gaps, staged items awaiting primary-source verification).
 */

export type LondonTimeParts={
 dateKey:string;
 localTimeDisplay:string;
 year:number;
 month:number;
 day:number;
 hour:number;
 minute:number;
 second:number;
 weekday:'Mon'|'Tue'|'Wed'|'Thu'|'Fri'|'Sat'|'Sun';
 isWeekday:boolean;
 offsetMinutes:0|60;
 regime:'GMT'|'BST';
 minutesSinceMidnight:number;
};

export function getLondonTimeParts(timestampMs:number):LondonTimeParts{
 const parts=new Intl.DateTimeFormat('en-GB',{
  timeZone:'Europe/London',
  year:'numeric',
  month:'2-digit',
  day:'2-digit',
  hour:'2-digit',
  minute:'2-digit',
  second:'2-digit',
  weekday:'short',
  hourCycle:'h23',
 }).formatToParts(new Date(timestampMs));
 const get=(t:string)=>parts.find(p=>p.type===t)?.value??'00';
 const yearStr=get('year');
 const monthStr=get('month');
 const dayStr=get('day');
 const hourStr=get('hour')==='24'?'00':get('hour');
 const minuteStr=get('minute');
 const secondStr=get('second');
 const weekdayRaw=get('weekday').slice(0,3) as LondonTimeParts['weekday'];

 const year=Number(yearStr);
 const month=Number(monthStr);
 const day=Number(dayStr);
 const hour=Number(hourStr);
 const minute=Number(minuteStr);
 const second=Number(secondStr);

 const asUtcMs=Date.UTC(year,month-1,day,hour,minute,second);
 const floorSecMs=Math.floor(timestampMs/1000)*1000;
 const rawOffsetMin=Math.round((asUtcMs-floorSecMs)/60_000);
 const offsetMinutes:(0|60)=rawOffsetMin===60?60:0;
 const regime=offsetMinutes===60?'BST':'GMT';
 const isWeekday=weekdayRaw!=='Sat'&&weekdayRaw!=='Sun';

 return {
  dateKey:`${yearStr}-${monthStr}-${dayStr}`,
  localTimeDisplay:`${hourStr}:${minuteStr}`,
  year,
  month,
  day,
  hour,
  minute,
  second,
  weekday:weekdayRaw,
  isWeekday,
  offsetMinutes,
  regime,
  minutesSinceMidnight:hour*60+minute,
 };
}

export function londonBriefingDate(timestampMs:number):string{
 return getLondonTimeParts(timestampMs).dateKey;
}

export type LondonMorningBriefWindowEvaluation={
 dateKey:string;
 localTimeDisplay:string;
 regime:'GMT'|'BST';
 offsetMinutes:0|60;
 isWeekday:boolean;
 alreadyGeneratedForDate:boolean;
 inTargetWindow:boolean;
 shouldRun:boolean;
 reason:
  |'already_generated_for_uk_date'
  |'forced_on_demand_first_for_date'
  |'due_at_0730_europe_london'
  |'before_0730_europe_london'
  |'weekend_europe_london';
 nextScheduledAt:number;
};

function resolveLondon0730UtcMs(year:number,month:number,day:number):number{
 const probeGmt=Date.UTC(year,month-1,day,7,30,0,0);
 const probeParts=getLondonTimeParts(probeGmt);
 if(probeParts.offsetMinutes===60){
  return Date.UTC(year,month-1,day,6,30,0,0);
 }
 return probeGmt;
}

export function nextLondonMorningBriefAt(nowMs:number):number{
 const startParts=getLondonTimeParts(nowMs);
 for(let dayOffset=0;dayOffset<=7;dayOffset++){
  const baseUtc=Date.UTC(startParts.year,startParts.month-1,startParts.day+dayOffset,12,0,0,0);
  const dayParts=getLondonTimeParts(baseUtc);
  if(!dayParts.isWeekday)continue;
  const candidateUtc=resolveLondon0730UtcMs(dayParts.year,dayParts.month,dayParts.day);
  if(candidateUtc>nowMs)return candidateUtc;
 }
 return nowMs+86_400_000;
}

export function evaluateLondonMorningBriefWindow(params:{
 nowMs:number;
 existingBriefingDates:Iterable<string>;
 forceOnDemand?:boolean;
}):LondonMorningBriefWindowEvaluation{
 const parts=getLondonTimeParts(params.nowMs);
 const existingSet=new Set(params.existingBriefingDates);
 const alreadyGeneratedForDate=existingSet.has(parts.dateKey);
 const inTargetWindow=parts.isWeekday&&parts.minutesSinceMidnight>=7*60+30;
 const nextScheduledAt=nextLondonMorningBriefAt(params.nowMs);

 if(alreadyGeneratedForDate){
  return {
   dateKey:parts.dateKey,
   localTimeDisplay:parts.localTimeDisplay,
   regime:parts.regime,
   offsetMinutes:parts.offsetMinutes,
   isWeekday:parts.isWeekday,
   alreadyGeneratedForDate:true,
   inTargetWindow,
   shouldRun:false,
   reason:'already_generated_for_uk_date',
   nextScheduledAt,
  };
 }

 if(params.forceOnDemand){
  return {
   dateKey:parts.dateKey,
   localTimeDisplay:parts.localTimeDisplay,
   regime:parts.regime,
   offsetMinutes:parts.offsetMinutes,
   isWeekday:parts.isWeekday,
   alreadyGeneratedForDate:false,
   inTargetWindow,
   shouldRun:true,
   reason:'forced_on_demand_first_for_date',
   nextScheduledAt,
  };
 }

 if(!parts.isWeekday){
  return {
   dateKey:parts.dateKey,
   localTimeDisplay:parts.localTimeDisplay,
   regime:parts.regime,
   offsetMinutes:parts.offsetMinutes,
   isWeekday:false,
   alreadyGeneratedForDate:false,
   inTargetWindow:false,
   shouldRun:false,
   reason:'weekend_europe_london',
   nextScheduledAt,
  };
 }

 if(!inTargetWindow){
  return {
   dateKey:parts.dateKey,
   localTimeDisplay:parts.localTimeDisplay,
   regime:parts.regime,
   offsetMinutes:parts.offsetMinutes,
   isWeekday:true,
   alreadyGeneratedForDate:false,
   inTargetWindow:false,
   shouldRun:false,
   reason:'before_0730_europe_london',
   nextScheduledAt,
  };
 }

 return {
  dateKey:parts.dateKey,
  localTimeDisplay:parts.localTimeDisplay,
  regime:parts.regime,
  offsetMinutes:parts.offsetMinutes,
  isWeekday:true,
  alreadyGeneratedForDate:false,
  inTargetWindow:true,
  shouldRun:true,
  reason:'due_at_0730_europe_london',
  nextScheduledAt,
 };
}

export function generateMorningBriefing(input:{
 now:number;
 confirmedFacts:ConfirmedFactItem[];
 researchInterpretation:ResearchInterpretationItem[];
 riskChanges:RiskChangeItem[];
 incompleteEvidence:IncompleteEvidenceItem[];
 modelVersion?:string|null;
}):MorningBriefingRecord{
 // Guardrail: Confirmed Facts must never include unverified, estimated or proposed items, or future receipt times.
 const validatedFacts=input.confirmedFacts.filter(f=>{
  if(f.receivedAt>input.now)throw new Error(`Confirmed fact ${f.id} has a future receipt timestamp`);
  if(f.publishedAt!==null&&f.publishedAt>f.receivedAt)throw new Error(`Confirmed fact ${f.id} receipt precedes publication`);
  if(f.classification!=='observed'&&f.classification!=='reported'){
   throw new Error(`Confirmed facts cannot contain ${f.classification} claims`);
  }
  return true;
 });

 const validatedInterpretations=input.researchInterpretation.map(r=>{
  if(r.receivedAt>input.now)throw new Error(`Interpretation ${r.id} has a future receipt timestamp`);
  return {
   ...r,
   executionAuthority:'none' as const,
  };
 });

 return {
  briefingDate:londonBriefingDate(input.now),
  generatedAt:input.now,
  timezone:'Europe/London',
  confirmedFacts:validatedFacts,
  researchInterpretation:validatedInterpretations,
  riskChanges:input.riskChanges,
  incompleteEvidence:input.incompleteEvidence,
  modelVersion:input.modelVersion??null,
  executionAuthority:'none',
  version:REMOTE_OPS_VERSION,
 };
}
