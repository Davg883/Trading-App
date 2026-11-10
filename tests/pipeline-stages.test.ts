import {describe,expect,it} from 'vitest';
import {assessPipelineStages} from '../lib/remote-ops/pipeline-stages';

/** MVP hardening — work package 7: each pipeline stage needs its own evidence. */
const NOW=Date.parse('2026-11-10T12:00:00Z'),H=3600_000;
const job=(o:Partial<{enabled:boolean;intervalMinutes:number;lastRunAt:number|null;lastSuccessAt:number|null;lastErrorCode:string|null}>={})=>({enabled:true,intervalMinutes:15,lastRunAt:NOW-H,lastSuccessAt:NOW-H,lastErrorCode:null,...o});

describe('WP7 — pipeline evidence ladder',()=>{
 it('a defined schedule with no job record proves nothing beyond definition',()=>{
  expect(assessPipelineStages({jobKey:'market_data_collect',nowMs:NOW,cronDefinedInSource:true,job:null,newestStoredRecordAt:null,reconciliation:{checked:false,passed:null}}))
   .toMatchObject({cronDefined:'yes',cronInvoked:'not_measured',collectorCompleted:'not_measured',freshDataStored:'not_measured',reconciled:'not_measured',displayedInInterface:'not_measured'});
 });
 it('a run that succeeds but stores nothing new is not reported as fresh data',()=>{
  const r=assessPipelineStages({jobKey:'market_data_collect',nowMs:NOW,cronDefinedInSource:true,job:job(),newestStoredRecordAt:NOW-10*86_400_000,reconciliation:{checked:false,passed:null}});
  expect(r).toMatchObject({cronInvoked:'yes',collectorCompleted:'yes',freshDataStored:'no'});
 });
 it('an invoked run that failed is invoked but not completed',()=>{
  expect(assessPipelineStages({jobKey:'sec_filings_collect',nowMs:NOW,cronDefinedInSource:true,job:job({lastSuccessAt:NOW-5*86_400_000,lastErrorCode:'provider_unavailable'}),newestStoredRecordAt:null,reconciliation:{checked:false,passed:null}}))
   .toMatchObject({cronInvoked:'yes',collectorCompleted:'no',freshDataStored:'no'});
 });
 it('reconciliation and display are only "yes" with their own evidence',()=>{
  const r=assessPipelineStages({jobKey:'graph_projection',nowMs:NOW,cronDefinedInSource:false,job:job(),newestStoredRecordAt:NOW-H,reconciliation:{checked:true,passed:false}});
  expect(r).toMatchObject({cronDefined:'no',freshDataStored:'yes',reconciled:'no',displayedInInterface:'not_measured'});
 });
});
