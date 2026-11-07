import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {parseRecoveryCase} from './market-recovery';
import {parsePolicyCase} from './policy-risk';

/**
 * Allowlisted, versioned research packages that trusted server code may import.
 * Each package is pinned to the SHA-256 of its file bytes, so a changed file can never be imported under an
 * existing source identifier. A correction needs a new file, a new identifier and a new pin.
 */
export const RESEARCH_PACKAGES={
 'recovery-006-2026-11-03-source-v1':{file:'data/recovery/november-3-2026.json',fn:'recovery:importCase',kind:'recovery',sha256:'1dee78dd69b1e4da500d93d09bc090d49d0c807cdb3bdc48eae4def07a76bd87',note:'Captured 3 Nov 2026 before the anchor close was published; anchor recorded as missing'},
 'recovery-006-2026-11-03-source-v2':{file:'data/recovery/november-3-2026-v2.json',fn:'recovery:importCase',kind:'recovery',sha256:'a9c720d139341e253ad39d1557ec9ce4fa625d129e1f0df976163333c93b7440',note:'Retrospective reconstruction captured 5 Nov 2026; not an authentic 3 Nov forecast'},
 'policy-risk-001.2-midterm-2026-11-03-source-v1':{file:'data/policy-risk/midterm-2026-11-03.json',fn:'policyRisk:importCase',kind:'policy',sha256:'77c1edceafc55a1a8aad701222b2b52af0e9f7bc943672d24bf23a45a3eb689f',note:'Retrospective policy event package captured 5 Nov 2026'},
} as const;
export type ResearchPackageId=keyof typeof RESEARCH_PACKAGES;
export const MAX_IMPORT_BYTES=800_000;

export function canonicalJson(value:unknown):string{if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;if(value!==null&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>`${JSON.stringify(k)}:${canonicalJson(x)}`).join(',')}}`;return JSON.stringify(value);}
const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');

/** Reads, verifies and validates a package. Returns the exact JSON sent to Convex and its reproducible hashes. */
export function preparePackage(id:string,root=process.cwd()){
 if(!Object.hasOwn(RESEARCH_PACKAGES,id))throw new Error('Unknown research package');
 const spec=RESEARCH_PACKAGES[id as ResearchPackageId],raw=readFileSync(path.join(root,spec.file));
 const fileSha256=sha(raw);if(fileSha256!==spec.sha256)throw new Error('Package bytes do not match the pinned hash; register a new source version');
 const record=spec.kind==='recovery'?parseRecoveryCase(JSON.parse(raw.toString('utf8'))):parsePolicyCase(JSON.parse(raw.toString('utf8')));
 const caseJson=JSON.stringify(record),canonical=canonicalJson(record);
 if(Buffer.byteLength(caseJson,'utf8')>MAX_IMPORT_BYTES)throw new Error('Package exceeds the Convex import limit');
 return {externalId:id,fn:spec.fn,caseJson,fileSha256,canonicalSha256:sha(canonical),bytes:Buffer.byteLength(caseJson,'utf8'),limitBytes:MAX_IMPORT_BYTES,note:spec.note};
}
