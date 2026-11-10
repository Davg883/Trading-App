import { NextResponse } from 'next/server';

/**
 * API routes that authenticate with their own machine credential (constant-time bearer token) and do not
 * depend on a Clerk session. They stay reachable when the session layer is unavailable.
 */
const MACHINE_AUTHENTICATED_API_PREFIXES = [
  '/api/research/staging',
  '/api/operations/scheduled',
  '/api/brokers/scheduled',
];

export function isSessionDependentApiPath(pathname: string): boolean {
  if (!pathname.startsWith('/api/') && !pathname.startsWith('/trpc/')) return false;
  return !MACHINE_AUTHENTICATED_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Fail-closed response for session-dependent API routes when the session layer cannot run.
 *
 * Previously an unconfigured or throwing Clerk middleware fell through to `NextResponse.next()` for every
 * request. Route handlers still called `auth()` themselves, so this was defence-in-depth rather than an open
 * door, but a production deployment with broken authentication looked healthy. Session-dependent API routes
 * now answer 503 in production. Pages are still rendered: they are public shells that load private data only
 * through Convex, which verifies the user's token independently.
 */
export function authenticationUnavailableResponse(): NextResponse {
  return NextResponse.json(
    {
      error: 'authentication_unavailable',
      message: 'Authentication is temporarily unavailable. No request was processed.',
      executionAuthority: 'none',
    },
    { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } },
  );
}
