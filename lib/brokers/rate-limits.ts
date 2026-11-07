/** Stored Trading 212 rate-limit observations (from x-ratelimit-* headers). Contains resource paths and counts only. */
export type RateLimit={resource:string;limit:number|null;remaining:number|null;resetAt:number|null;periodSeconds:number|null;used:number|null;observedAt:number};
export function parseRateLimits(json:string|undefined|null):RateLimit[]{
 if(!json)return [];
 try{const rows=JSON.parse(json) as unknown;if(!Array.isArray(rows))return [];const num=(x:unknown)=>typeof x==='number'&&Number.isFinite(x)?x:null;
  return rows.slice(0,10).flatMap(r=>{if(!r||typeof r!=='object')return [];const o=r as Record<string,unknown>;if(typeof o.resource!=='string'||!/^\/equity\/[a-z/]+$/.test(o.resource))return [];return [{resource:o.resource,limit:num(o.limit),remaining:num(o.remaining),resetAt:num(o.resetAt),periodSeconds:num(o.periodSeconds),used:num(o.used),observedAt:num(o.observedAt)??0}];});
 }catch{return [];}
}
/** Human summary: the tightest bucket observed, and whether requests are suppressed until a reset. */
export function rateLimitStatus(limits:RateLimit[],nextAllowedAt:number,now:number){
 const exhausted=limits.filter(l=>l.remaining===0&&l.resetAt!==null&&l.resetAt>now);
 if(nextAllowedAt>now)return {state:exhausted.length?'exhausted' as const:'cooldown' as const,until:nextAllowedAt,detail:exhausted.length?`Provider limit reached for ${exhausted.map(l=>l.resource).join(', ')}`:'Application cooldown between requests'};
 if(!limits.length)return {state:'unknown' as const,until:null,detail:'No rate-limit headers observed yet'};
 const tight=[...limits].sort((a,b)=>(a.remaining??Infinity)-(b.remaining??Infinity))[0];
 return {state:'ok' as const,until:null,detail:`${tight.resource}: ${tight.remaining??'?'} of ${tight.limit??'?'} remaining per ${tight.periodSeconds??'?'}s`};
}
