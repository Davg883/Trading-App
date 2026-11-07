import {v} from 'convex/values';

export const brokerEnvironment=v.union(v.literal('demo'),v.literal('live'));
export const brokerStatus=v.union(v.literal('saved'),v.literal('syncing'),v.literal('connected'),v.literal('partial'),v.literal('error'));
export const brokerOperation=v.union(v.literal('test'),v.literal('sync'));
export const brokerErrorCode=v.union(v.literal('invalid_credentials'),v.literal('missing_permissions'),v.literal('rate_limited'),v.literal('timeout'),v.literal('provider_unavailable'),v.literal('invalid_response'),v.literal('redirect_blocked'),v.literal('disconnected'),v.literal('invalid_configuration'),v.literal('environment_mismatch'),v.literal('credentials_revoked'));
