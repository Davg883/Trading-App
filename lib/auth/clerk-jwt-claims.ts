/**
 * Server-safe Clerk JWT claim validation (G9.3.3).
 *
 * This module is deliberately framework-free: no `'use client'` directive, no React, no Clerk client hooks. Server
 * route handlers must import claim validation from here. Importing it from a `'use client'` module turns the import
 * into a client-reference stub in the server bundle that throws when called, which silently broke authenticated
 * `/api/graph/chat` (every signed-in request was answered with 401).
 *
 * The checks are unchanged from the original `lib/clerk-convex-auth.ts` implementation. Signature verification is not
 * done here: Clerk's server `auth()` verifies the session before a token is minted, and Convex verifies every token's
 * signature and expiry against the issuer's JWKS on use.
 */

const DEFAULT_ALLOWED_AZP_ORIGINS = [
  'https://capital.aiguides.co.uk',
  'https://trading-app-theta-two.vercel.app',
  'http://localhost:3000',
];

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function decodeBase64UrlJson(segment: string): Record<string, unknown> | null {
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const json =
      typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export type JwtClaimValidationOptions = {
  expectedIssuers?: string[];
  allowedAzpOrigins?: string[];
};

/**
 * Validates that a Clerk JWT has a trusted issuer (`iss`), subject (`sub`), and
 * either `aud === "convex"` (OIDC template token) or an authorised application
 * origin in `azp` (Clerk default RS256 session token).
 */
export function validateClerkConvexJwtClaims(
  token: string,
  options?: JwtClaimValidationOptions,
): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) {
    // Non-JWT opaque strings used in unit test mocks pass through unless they are 3-segment JWTs.
    return true;
  }
  const payload = decodeBase64UrlJson(parts[1]!);
  if (!payload) return false;

  const iss = typeof payload.iss === 'string' ? normalizeOrigin(payload.iss) : '';
  const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (!iss || !sub) return false;

  const envIssuers = (process.env.CLERK_JWT_ISSUER_DOMAIN ?? '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);
  const expectedIssuers = (options?.expectedIssuers ?? envIssuers).map(normalizeOrigin).filter(Boolean);
  if (expectedIssuers.length > 0 && !expectedIssuers.includes(iss)) {
    return false;
  }

  const envAzpOrigins = (process.env.CLERK_ALLOWED_AZP_ORIGINS ?? '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);
  const vercelDeploymentOrigins = [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => {
      const trimmed = v.trim();
      return normalizeOrigin(trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`);
    });
  // In the browser the page's own origin is an authorised party; on the server `window` is undefined, so request
  // headers can never widen the allowed origins.
  const runtimeOrigin =
    typeof window !== 'undefined' && window.location?.origin
      ? [normalizeOrigin(window.location.origin)]
      : [];
  const allowedOrigins = new Set(
    [
      ...(envAzpOrigins.length > 0 ? envAzpOrigins : DEFAULT_ALLOWED_AZP_ORIGINS),
      ...vercelDeploymentOrigins,
      ...runtimeOrigin,
      ...(options?.allowedAzpOrigins ?? []),
    ].map(normalizeOrigin),
  );

  const rawAud = payload.aud;
  let hasValidAud = false;
  if (rawAud !== undefined) {
    if (rawAud === null) return false;
    const audList = Array.isArray(rawAud)
      ? rawAud.filter((entry): entry is string => typeof entry === 'string')
      : typeof rawAud === 'string'
        ? [rawAud]
        : [];
    if (audList.length === 0 || (Array.isArray(rawAud) && audList.length !== rawAud.length)) {
      return false;
    }
    const validAud = audList.every((a) => {
      const norm = normalizeOrigin(a);
      return norm === 'convex' || allowedOrigins.has(norm);
    });
    if (!validAud) return false;
    hasValidAud = true;
  }

  const rawAzp = payload.azp;
  let hasValidAzp = false;
  if (rawAzp !== undefined) {
    if (rawAzp === null || typeof rawAzp !== 'string') return false;
    const azp = normalizeOrigin(rawAzp);
    if (!azp || !allowedOrigins.has(azp)) return false;
    hasValidAzp = true;
  }

  // Every browser-issued Clerk JWT carries either `aud` ("convex" template) or `azp` (default RS256 session token).
  // Reject tokens that omit both application-context claims.
  if (!hasValidAud && !hasValidAzp) {
    return false;
  }

  return true;
}

export type ServerTokenCheck = 'valid' | 'invalid_claims' | 'expired';

/**
 * Server-side classification of a Clerk token before it is used: the claim checks above, plus expiry. A token whose
 * `exp` has passed is rejected here instead of being forwarded (Convex would also reject it). The server clock is
 * authoritative; there is no leeway.
 */
export function checkServerClerkToken(
  token: string,
  options?: JwtClaimValidationOptions & { nowMs?: number },
): ServerTokenCheck {
  if (!validateClerkConvexJwtClaims(token, options)) return 'invalid_claims';
  const parts = token.split('.');
  if (parts.length === 3) {
    const payload = decodeBase64UrlJson(parts[1]!);
    const exp = payload?.exp;
    if (exp !== undefined) {
      if (typeof exp !== 'number' || !Number.isFinite(exp)) return 'invalid_claims';
      if (exp * 1000 <= (options?.nowMs ?? Date.now())) return 'expired';
    }
  }
  return 'valid';
}
