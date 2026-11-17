import type {JobHealthSummary,OperationalLayerStatus} from './health-monitor';

/**
 * Sprint G9.3.1 — configured job state vs effective scheduler execution state.
 *
 * A job row has two independent facts:
 *   - configured: the owner's toggle (Enabled / Disabled / Paused). It says what *would* run.
 *   - effective: whether the scheduler will actually execute it. It says what *will* run.
 * A globally disabled scheduler makes every job "Not scheduled" regardless of its toggle, and a stored next-run time
 * is then historical. The decision fails safe: when the per-job `scheduled` flag is missing (for example a response
 * from an older backend or a projection that dropped it), the job is never presented as scheduled.
 */
export type JobEffectiveState='scheduled'|'overdue'|'failed'|'not_scheduled'|'unknown';

export type JobScheduleDisplay={
 configured:string;
 effective:JobEffectiveState;
 effectiveLabel:string;
 nextRunLabel:string;
 nextRunDetail:string|null;
 /** True only when the scheduler is expected to run this job on time. */
 active:boolean;
};

type JobInput=Pick<JobHealthSummary,'enabled'|'pausedReason'|'lastErrorCode'|'nextRunAt'|'lastRunAt'>&{
 scheduled?:boolean;
 nextRunOverdue?:boolean;
};
type SchedulerInput=Pick<OperationalLayerStatus['scheduler'],'status'>&{schedulerEnv?:OperationalLayerStatus['scheduler']['schedulerEnv']};

export function describeJobSchedule(job:JobInput,scheduler:SchedulerInput,now:number,fmt:(ms:number)=>string):JobScheduleDisplay{
 const configured=job.pausedReason?`Paused (${job.pausedReason})`:job.enabled?'Enabled':'Disabled';
 const stored=fmt(job.nextRunAt);
 const notScheduled=(reason:string,whileClause:string):JobScheduleDisplay=>({
  configured,
  effective:'not_scheduled',
  effectiveLabel:`Not scheduled — ${reason}`,
  nextRunLabel:'Not scheduled',
  nextRunDetail:`Last stored next-run time ${stored} is historical; no run will occur while ${whileClause}.`,
  active:false,
 });

 const schedulerDisabled=scheduler.schedulerEnv==='disabled';
 if(schedulerDisabled||scheduler.status==='paused'){
  return schedulerDisabled
   ?notScheduled('scheduler disabled','the scheduler is disabled')
   :notScheduled('operations disabled','operations are disabled');
 }
 if(job.pausedReason)return notScheduled(`job paused (${job.pausedReason})`,'the job is paused');
 if(!job.enabled)return notScheduled('job disabled','the job is disabled');
 if(job.scheduled!==true){
  return {
   configured,
   effective:'unknown',
   effectiveLabel:'Schedule state not reported',
   nextRunLabel:'Not reported',
   nextRunDetail:`Stored next-run time ${stored} is unverified; the backend did not report whether this job is scheduled.`,
   active:false,
  };
 }

 const overdue=job.nextRunOverdue??(job.nextRunAt<now&&(job.lastRunAt===null||job.lastRunAt<job.nextRunAt));
 const schedulerStalled=scheduler.status==='degraded';
 const nextRun=overdue
  ?{nextRunLabel:'Overdue',nextRunDetail:`Was due ${stored}; no run has been recorded since, and a run is not guaranteed.`}
  :schedulerStalled
   ?{nextRunLabel:`Due ${stored}`,nextRunDetail:'The scheduler has not ticked recently; this run is not guaranteed.'}
   :{nextRunLabel:stored,nextRunDetail:null};

 if(job.lastErrorCode){
  return {configured,effective:'failed',effectiveLabel:`Failed (${job.lastErrorCode}) · still scheduled`,...nextRun,active:false};
 }
 if(overdue||schedulerStalled){
  return {configured,effective:'overdue',effectiveLabel:schedulerStalled?'Scheduled · scheduler overdue':'Scheduled · run overdue',...nextRun,active:false};
 }
 return {configured,effective:'scheduled',effectiveLabel:'Scheduled',...nextRun,active:true};
}

/** True when the scheduler layer reports that no unattended run will happen. */
export function schedulerIdle(scheduler:SchedulerInput):boolean{
 return scheduler.schedulerEnv==='disabled'||scheduler.status==='paused';
}
