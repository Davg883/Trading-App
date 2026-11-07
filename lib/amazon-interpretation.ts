import {z} from 'zod';
import {amazonCashCaseSchema,amazonObservationSchema,freezeAmazonCase,type AmazonCashCase,type AmazonObservation} from './amazon-cash-conversion';

export const AMAZON_INTERPRETATION_VERSION='amazon-interpretation-2026-v1' as const;
const id=z.string().trim().min(1).max(240),text=z.string().trim().min(1).max(16000),time=z.number().int().nonnegative().max(8.64e15);
const citations=z.array(id).max(200).refine(ids=>new Set(ids).size===ids.length,'Evidence citations must be unique');
export const amazonInterpretationPayloadSchema=z.object({economicInterpretation:text,supportingEvidenceIds:citations.min(1),challengingEvidenceIds:citations,risks:z.array(text).min(1).max(30),invalidation:z.array(text).min(1).max(30),researchAction:z.enum(['no_trade','further_research'])}).strict();
export const amazonInterpretationResultSchema=z.object({version:z.literal(AMAZON_INTERPRETATION_VERSION),caseId:id,quarter:z.string().regex(/^\d{4}-Q[1-4]$/),cutoff:time,slot:z.enum(['model_a','model_b']),provider:z.enum(['openai','anthropic']),modelVersion:id,returnedModelVersion:id.nullable(),evidenceJson:z.string().min(1).max(700000),status:z.enum(['complete','failed']),payload:amazonInterpretationPayloadSchema.nullable(),inputTokens:z.number().int().nonnegative().max(1e9).nullable(),outputTokens:z.number().int().nonnegative().max(1e9).nullable(),actualCost:z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),costCurrency:z.literal('USD').nullable(),latencyMs:z.number().finite().nonnegative().max(3600000),startedAt:time,completedAt:time,errorCode:z.enum(['configuration_missing','provider_http_error','provider_network_failure','invalid_response','model_version_mismatch','deadline_exceeded','adapter_failure']).nullable(),interpretationScore:z.null(),marketForecastScore:z.null(),executionAuthority:z.literal('none')}).strict().superRefine((r,c)=>{
  if(r.completedAt<r.startedAt||r.startedAt<r.cutoff)c.addIssue({code:'custom',message:'Result timestamps must follow the evidence cutoff'});
  if(r.status==='complete'&&(r.payload===null||r.errorCode!==null||r.returnedModelVersion!==r.modelVersion))c.addIssue({code:'custom',message:'Complete results require validated content and the exact registered returned model version'});
  if(r.status==='failed'&&(r.payload!==null||r.errorCode===null))c.addIssue({code:'custom',message:'Failed submissions retain only metadata and a safe error code'});
  if((r.actualCost===null)!==(r.costCurrency===null))c.addIssue({code:'custom',message:'Cost and its currency must be supplied together or remain unavailable'});
});
export type AmazonInterpretationResult=z.infer<typeof amazonInterpretationResultSchema>;
export type AmazonInterpretationPayload=z.infer<typeof amazonInterpretationPayloadSchema>;
export type AmazonInterpretationManifest={caseId:string;quarter:string;cutoff:number;evidence:AmazonCashCase;evidenceHistory?:AmazonObservation[];models:{slot:string;provider:string|null;modelVersion:string|null}[];registeredAt?:number};
/** Exact canonical evidence is retained instead of relying on an unverified caller-supplied hash. */
export function canonicalAmazonEvidence(value:unknown):string{
  if(Array.isArray(value))return `[${value.map(canonicalAmazonEvidence).join(',')}]`;
  if(value!==null&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>`${JSON.stringify(key)}:${canonicalAmazonEvidence(item)}`).join(',')}}`;
  const encoded=JSON.stringify(value);if(encoded===undefined)throw new Error('Evidence must contain JSON values only');return encoded;
}
export function validateAmazonInterpretationManifest(input:unknown):AmazonInterpretationManifest{
  const manifest=z.object({caseId:id,quarter:z.string().regex(/^\d{4}-Q[1-4]$/),cutoff:time,evidence:amazonCashCaseSchema,evidenceHistory:z.array(amazonObservationSchema).max(2000).optional(),models:z.array(z.object({slot:z.enum(['model_a','model_b']),provider:z.enum(['openai','anthropic']),modelVersion:id}).passthrough()).length(2),registeredAt:time.optional()}).passthrough().parse(input);
  if(new Set(manifest.models.map(m=>m.slot)).size!==2||new Set(manifest.models.map(m=>m.provider)).size!==2)throw new Error('Two distinct provider identities and one submission slot per model are required');
  const frozen=freezeAmazonCase({...manifest.evidence,observations:manifest.evidenceHistory??manifest.evidence.observations},manifest.cutoff);
  if(manifest.evidenceHistory&&canonicalAmazonEvidence(frozen.eligibleHistory)!==canonicalAmazonEvidence(manifest.evidenceHistory))throw new Error('Audit history contains observations unavailable at the frozen cutoff');
  if(manifest.evidence.id!==manifest.caseId||manifest.evidence.articleClaim!==null||canonicalAmazonEvidence(frozen.case)!==canonicalAmazonEvidence(manifest.evidence))throw new Error('Manifest must contain exactly the frozen eligible case, without unverified article annotations');
  if(!manifest.evidence.observations.length||!manifest.evidence.sources.length)throw new Error('Eligible financial evidence is required before requesting interpretation');
  if(manifest.registeredAt!==undefined&&manifest.registeredAt<manifest.cutoff)throw new Error('Registration cannot predate its evidence cutoff');
  return manifest;
}
export function validateAmazonInterpretationResult(input:unknown,manifestInput:unknown):AmazonInterpretationResult{
  const manifest=validateAmazonInterpretationManifest(manifestInput),result=amazonInterpretationResultSchema.parse(input);
  const participant=manifest.models.find(m=>m.slot===result.slot);
  if(result.caseId!==manifest.caseId||result.quarter!==manifest.quarter||result.cutoff!==manifest.cutoff||!participant||result.provider!==participant.provider||result.modelVersion!==participant.modelVersion)throw new Error('Result identity does not match the frozen experiment and exact model registration');
  if(result.evidenceJson!==canonicalAmazonEvidence(manifest.evidence))throw new Error('Result must bind to the exact same canonical eligible evidence');
  if(manifest.registeredAt!==undefined&&result.startedAt<manifest.registeredAt)throw new Error('Model call predates its registered experiment');
  const allowed=new Set([...manifest.evidence.sources,...manifest.evidence.observations,...manifest.evidence.bedrock].map(o=>o.id));
  if(result.payload&&[...result.payload.supportingEvidenceIds,...result.payload.challengingEvidenceIds].some(id=>!allowed.has(id)))throw new Error('Interpretation may cite only eligible frozen evidence IDs');
  return result;
}
