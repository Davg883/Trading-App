import 'server-only';
import { z } from 'zod';

/** Provider inputs stay server-side. Missing configuration is an explicit failure. */
export async function fetchSecCompanyFacts(cik: string) {
  if (!/^\d{1,10}$/.test(cik)) throw new Error('Invalid SEC CIK');
  const userAgent=process.env.SEC_USER_AGENT;
  if(!userAgent)throw new Error('Set SEC_USER_AGENT with an application name and contact email');
  const response=await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10,'0')}.json`,{headers:{'User-Agent':userAgent,Accept:'application/json'},signal:AbortSignal.timeout(15000),cache:'no-store'});
  if(!response.ok)throw new Error(`SEC unavailable (${response.status})`);
  const payload=z.object({cik:z.number(),entityName:z.string(),facts:z.record(z.string(),z.unknown())}).parse(await response.json());
  return {payload,receivedAt:Date.now(),source:`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10,'0')}.json`};
}
export async function fetchFredSeries(seriesId:string){
  if(!/^[A-Z0-9_]{1,40}$/.test(seriesId))throw new Error('Invalid FRED series');
  const key=process.env.FRED_API_KEY;if(!key)throw new Error('FRED_API_KEY is not configured');
  const url=new URL('https://api.stlouisfed.org/fred/series/observations');
  url.search=new URLSearchParams({series_id:seriesId,api_key:key,file_type:'json',sort_order:'desc',limit:'100'}).toString();
  const response=await fetch(url,{signal:AbortSignal.timeout(15000),cache:'no-store'});
  if(!response.ok)throw new Error(`FRED unavailable (${response.status})`);
  const payload=z.object({observations:z.array(z.object({date:z.string(),value:z.string(),realtime_start:z.string(),realtime_end:z.string()}))}).parse(await response.json());
  return {payload,receivedAt:Date.now(),source:`https://fred.stlouisfed.org/series/${seriesId}`,pointInTime:false as const};
}
export const forecastContract=z.object({probabilities:z.tuple([z.number().min(0).max(1),z.number().min(0).max(1),z.number().min(0).max(1)]).refine(p=>Math.abs(p.reduce((a,b)=>a+b,0)-1)<1e-8,'Probabilities must sum to one'),expectedReturn:z.number().finite(),lower:z.number().finite(),upper:z.number().finite(),evidenceIds:z.array(z.string()).min(1),explanation:z.string().min(1),invalidation:z.string().min(1),decision:z.enum(['long','short','no-trade'])}).refine(f=>f.lower<=f.expectedReturn&&f.upper>=f.expectedReturn,'Interval must contain expected return');
export function validateForecast(payload:unknown,allowedEvidenceIds:string[]){const result=forecastContract.parse(payload);if(result.evidenceIds.some(id=>!allowedEvidenceIds.includes(id)))throw new Error('Forecast cites evidence outside its frozen bundle');return result;}
