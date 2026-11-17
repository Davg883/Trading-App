import {ConvexHttpClient} from 'convex/browser';
import {makeFunctionReference} from 'convex/server';
import {CONVEX_DEPLOYMENT_FINGERPRINT} from '../../../../convex/deploymentFingerprint';
import {evaluateReleaseCompatibility, type BackendFingerprint} from '../../../../lib/release/fingerprint-compatibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fingerprintRef = makeFunctionReference<'query', Record<string, never>, BackendFingerprint>('release:fingerprint');

/**
 * Sprint G9.2: public release fingerprint. Reports the frontend build (Vercel git SHA), the Convex source fingerprint it
 * was compiled against, the fingerprint the running Convex backend reports, and a compatibility verdict. Contains no
 * user data or credentials. Release acceptance fails unless `compatible` is true.
 */
export async function GET() {
  const frontend = {
    gitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_BUILD_GIT_SHA ?? null,
    gitRef: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    deploymentHost: process.env.VERCEL_URL ?? null,
    expectedConvex: CONVEX_DEPLOYMENT_FINGERPRINT,
  };
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? null;
  let backend: BackendFingerprint | null = null;
  let backendError: string | null = null;
  if (!convexUrl) {
    backendError = 'NEXT_PUBLIC_CONVEX_URL not configured';
  } else {
    try {
      const client = new ConvexHttpClient(convexUrl, {
        logger: false,
        fetch: (input, init) => fetch(input, {...init, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000)}),
      });
      backend = await client.query(fingerprintRef, {});
    } catch (error) {
      backendError = error instanceof Error ? error.message.slice(0, 300) : 'query failed';
    }
  }
  const verdict = evaluateReleaseCompatibility(CONVEX_DEPLOYMENT_FINGERPRINT, backend, backendError);
  const convexDeployment = convexUrl ? new URL(convexUrl).hostname.split('.')[0] : null;
  return Response.json(
    {checkedAt: new Date().toISOString(), frontend, backend: backend ? {...backend, convexDeployment} : null, backendError, ...verdict, executionAuthority: 'none'},
    {status: 200, headers: {'Cache-Control': 'no-store'}},
  );
}
