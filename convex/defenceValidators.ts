import {v} from 'convex/values';

export const defenceVersion=v.literal('defence-001.3-v1');
export const defenceMode=v.union(v.literal('synthetic'),v.literal('historical'),v.literal('forward'));
export const defenceReviewDecision=v.union(v.literal('approve'),v.literal('reject'));
