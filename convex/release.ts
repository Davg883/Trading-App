import {query} from './server';
import {CONVEX_DEPLOYMENT_FINGERPRINT} from './deploymentFingerprint';

/**
 * Sprint G9.2: public, PII-free deployment fingerprint of the running Convex functions.
 * `sourceSha256` is compiled in from convex/deploymentFingerprint.ts; `deployedGitSha` and `deployedAt` are set as
 * deployment environment variables by the release step (`npx convex env set CONVEX_DEPLOYED_GIT_SHA ...`).
 * The frontend's /api/health/release compares this with the fingerprint it was built with.
 */
export const fingerprint=query({
 args:{},
 handler:async()=>({
  ...CONVEX_DEPLOYMENT_FINGERPRINT,
  deployedGitSha:process.env.CONVEX_DEPLOYED_GIT_SHA??null,
  deployedAt:process.env.CONVEX_DEPLOYED_AT??null,
  executionAuthority:'none' as const,
 }),
});
