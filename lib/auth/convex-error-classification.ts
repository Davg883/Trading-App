/**
 * Server-safe classification of errors thrown by `ConvexHttpClient` calls (G9.3.4).
 *
 * Before this, GET /api/graph/chat caught every history-query failure and answered 200 with an empty history, so a
 * token Convex refused (untrusted authorised party, expired, unknown issuer) or an unreachable backend looked exactly
 * like a user with no history. Callers map the class to an HTTP status; the raw message is never returned to clients.
 *
 * Shapes handled:
 * - Function errors: "[Request ID: …] Server Error\nUncaught Error: Sign in required\n    at …"
 * - Auth-header rejections (HTTP 401 from Convex): '{"code":"InvalidAuthHeader","message":"Could not validate token: Token expired …"}'
 *   or code NoAuthProvider.
 * - Transport failures: TypeError("fetch failed"), AbortError/TimeoutError, 5xx bodies.
 */
export type ConvexErrorClass = 'expired' | 'unauthenticated' | 'forbidden' | 'unavailable';

const EXPIRED = /Token expired/i;
const UNAUTHENTICATED =
  /InvalidAuthHeader|NoAuthProvider|Could not validate token|Sign in required|Untrusted token (issuer|audience|authorized party)|Missing token application context|Unauthenticated|Not authenticated/i;
const FORBIDDEN =
  /Model or automated actors cannot|Automated actors cannot|Reviewer role required|forbidden_identity|Record unavailable|Connection unavailable/i;

export function classifyConvexError(err: unknown): ConvexErrorClass {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  if (EXPIRED.test(message)) return 'expired';
  if (UNAUTHENTICATED.test(message)) return 'unauthenticated';
  if (FORBIDDEN.test(message)) return 'forbidden';
  return 'unavailable';
}
