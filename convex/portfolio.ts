import {query} from './server';
import {researcher} from './authz';
import {parseRateLimits} from '../lib/brokers/rate-limits';

/**
 * Owner-scoped portfolio reporting data for the command centre. Read-only: broker snapshots (latest), the append-only
 * valuation history and external cash flows. No credentials, ciphertext or lease data are returned.
 */
export const overview=query({args:{},handler:async ctx=>{
 const user=await researcher(ctx),owner=user.tokenIdentifier,out:Record<string,unknown>={};
 for(const environment of ['live','demo'] as const){
  const connection=await ctx.db.query('brokerConnections').withIndex('by_environment',q=>q.eq('owner',owner).eq('environment',environment)).first();
  const snapshot=connection?await ctx.db.query('brokerSnapshots').withIndex('by_connection',q=>q.eq('owner',owner).eq('connectionId',connection._id)).order('desc').first():null;
  const valuations=await ctx.db.query('accountValuations').withIndex('by_owner_env',q=>q.eq('owner',owner).eq('environment',environment)).order('asc').take(5000);
  const flows=await ctx.db.query('accountCashFlows').withIndex('by_owner_env',q=>q.eq('owner',owner).eq('environment',environment)).order('asc').take(5000);
  const schedule=await ctx.db.query('brokerSyncSchedules').withIndex('by_owner_env',q=>q.eq('owner',owner).eq('environment',environment)).first();
  out[environment]={connection:connection?{connectionId:connection._id,status:connection.status,maskedKey:connection.maskedKey,lastSuccessfulSyncAt:connection.lastSuccessfulSyncAt,lastVerifiedAt:connection.lastVerifiedAt,lastErrorCode:connection.lastErrorCode,nextAllowedAt:connection.nextAllowedAt,rateLimits:parseRateLimits(connection.rateLimitJson)}:null,
   schedule:schedule?{enabled:schedule.enabled,intervalMinutes:schedule.intervalMinutes,nextRunAt:schedule.nextRunAt,lastRunAt:schedule.lastRunAt,lastOutcome:schedule.lastOutcome,pausedReason:schedule.pausedReason}:null,
   snapshot:snapshot&&connection&&snapshot.revision===connection.revision?JSON.parse(snapshot.snapshotJson):null,
   valuations:valuations.map(v=>({observedAt:v.observedAt,currency:v.currency,totalValue:v.totalValue,cash:v.cash,investedCost:v.investedCost,investmentsValue:v.investmentsValue,realisedProfitLoss:v.realisedProfitLoss,unrealisedProfitLoss:v.unrealisedProfitLoss})),
   flows:flows.map(f=>({reference:f.reference,type:f.type,amount:f.amount,currency:f.currency,occurredAt:f.occurredAt}))};
 }
 return out as {live:EnvironmentData;demo:EnvironmentData};
}});
type EnvironmentData={connection:unknown;schedule:unknown;snapshot:unknown;valuations:unknown[];flows:unknown[]};
