import {z} from 'zod';

export const brokerEnvironmentSchema=z.enum(['demo','live']);
export type BrokerEnvironment=z.infer<typeof brokerEnvironmentSchema>;
export const BROKER_BASE_URLS={demo:'https://demo.trading212.com/api/v0',live:'https://live.trading212.com/api/v0'} as const;
export const brokerCredentialsSchema=z.object({apiKey:z.string().min(1).max(2048).refine(s=>s===s.trim()&&!/[:\r\n\0]/.test(s),'Invalid API key format'),apiSecret:z.string().min(1).max(4096).refine(s=>s===s.trim()&&!/[\r\n\0]/.test(s),'Invalid API secret format')}).strict();
export type BrokerCredentials=z.infer<typeof brokerCredentialsSchema>;
const amount=z.number().finite().nullable();
const currency=z.string().regex(/^[A-Z]{3}$/);
export const accountSummarySchema=z.object({accountId:z.string().nullable(),currency,totalValue:amount,cash:z.object({availableToTrade:amount,reservedForOrders:amount,inPies:amount}).strict(),investments:z.object({currentValue:amount,totalCost:amount,realizedProfitLoss:amount,unrealizedProfitLoss:amount}).strict()}).strict();
export type AccountSummary=z.infer<typeof accountSummarySchema>;
export const positionSchema=z.object({instrument:z.object({ticker:z.string().min(1).max(100),name:z.string().max(300),currency,isin:z.string().max(100).nullable()}).strict(),quantity:amount,currentPrice:amount,averagePricePaid:amount,quantityAvailableForTrading:amount,quantityInPies:amount,walletImpact:z.object({currency:currency.nullable(),currentValue:amount,totalCost:amount,unrealizedProfitLoss:amount,fxImpact:amount}).strict()}).strict();
export const positionsSchema=z.array(positionSchema).max(5000);
export type BrokerPosition=z.infer<typeof positionSchema>;
export const transactionSchema=z.object({reference:z.string().max(200),type:z.string().min(1).max(100),dateTime:z.string().datetime({offset:true}),amount:z.number().finite(),currency}).strict();
export const transactionsSchema=z.object({items:z.array(transactionSchema).max(50),nextCursor:z.string().max(256).nullable(),truncated:z.boolean()}).strict();
export type BrokerTransactions=z.infer<typeof transactionsSchema>;
export const brokerErrorCodeSchema=z.enum(['invalid_credentials','missing_permissions','rate_limited','timeout','provider_unavailable','invalid_response','redirect_blocked','disconnected','invalid_configuration','environment_mismatch','credentials_revoked']);
export type BrokerErrorCode=z.infer<typeof brokerErrorCodeSchema>;
export const BROKER_ERROR_MESSAGES:Record<BrokerErrorCode,string>={environment_mismatch:'Trading 212 rejected this key in this environment, and the same key works in the other environment. It is probably a Live key saved under Demo (or the reverse). Create a key in the matching Trading 212 account; credentials are never tried against the other environment.',credentials_revoked:'This key worked before and is now rejected. It has probably expired or been revoked in Trading 212. Create a new read-only key and save it; automatic synchronisation is paused until then.',invalid_credentials:'Trading 212 rejected the credentials. Check the key and secret, the selected environment, and whether the key was revoked or expired.',missing_permissions:'The Trading 212 key is missing permission for this read-only resource. Review its Account, Portfolio or History permissions.',rate_limited:'Trading 212 request limit reached. Wait until the displayed retry time before trying again.',timeout:'Trading 212 did not respond within the request timeout. Try again later.',provider_unavailable:'Trading 212 is temporarily unavailable. Try again later.',invalid_response:'Trading 212 returned an unsupported account response. No unvalidated data was saved.',redirect_blocked:'A provider redirect was blocked to protect the credentials.',disconnected:'This broker adapter is disconnected.',invalid_configuration:'The broker connection configuration is invalid.'};
export class BrokerError extends Error{
  constructor(public readonly code:BrokerErrorCode,public readonly retryAfterMs:number|null=null){super(BROKER_ERROR_MESSAGES[code]);this.name='BrokerError';}
}
export type BrokerObservation<T>={provider:'trading212';environment:BrokerEnvironment;sourceUrl:string;retrievedAt:number;data:T};
const observationBase={provider:z.literal('trading212'),environment:brokerEnvironmentSchema,sourceUrl:z.string().url(),retrievedAt:z.number().finite().nonnegative()};
export const accountSummaryObservationSchema=z.object({...observationBase,data:accountSummarySchema}).strict();
export const positionsObservationSchema=z.object({...observationBase,data:positionsSchema}).strict();
export const transactionsObservationSchema=z.object({...observationBase,data:transactionsSchema}).strict();
export const syncSnapshotSchema=z.object({scope:z.enum(['test','sync']),summary:accountSummaryObservationSchema,positions:positionsObservationSchema.nullable(),transactions:transactionsObservationSchema.nullable(),historyErrorCode:brokerErrorCodeSchema.nullable()}).strict().superRefine((r,ctx)=>{
  for(const [observation,path] of [[r.summary,'/equity/account/summary'],[r.positions,'/equity/positions'],[r.transactions,'/equity/history/transactions']] as const){if(!observation)continue;if(observation.environment!==r.summary.environment||observation.sourceUrl!==BROKER_BASE_URLS[observation.environment]+path)ctx.addIssue({code:'custom',message:'Snapshot environment and approved API provenance must match'});}
  if(r.scope==='sync'&&!r.positions)ctx.addIssue({code:'custom',message:'A portfolio sync requires positions'});
});
export type BrokerSyncSnapshot=z.infer<typeof syncSnapshotSchema>;
export type BrokerConnectionMetadata={connectionId:string;provider:'trading212';environment:BrokerEnvironment;maskedKey:string;status:'saved'|'syncing'|'connected'|'partial'|'error';readOnly:true;createdAt:number;updatedAt:number;lastSuccessfulSyncAt:number|null;lastVerifiedAt:number|null;lastAttemptAt:number|null;lastErrorCode:BrokerErrorCode|null;nextAllowedAt:number};
export type BrokerConnectionDetail=BrokerConnectionMetadata&{snapshot:BrokerSyncSnapshot|null};
export interface BrokerAdapter{
  readonly environment:BrokerEnvironment;
  testConnection():Promise<BrokerObservation<AccountSummary>>;
  getAccountSummary():Promise<BrokerObservation<AccountSummary>>;
  getPositions():Promise<BrokerObservation<BrokerPosition[]>>;
  getTransactions(cursor?:string):Promise<BrokerObservation<BrokerTransactions>>;
  disconnect():{providerRevocationRequired:true;guidance:string};
}
