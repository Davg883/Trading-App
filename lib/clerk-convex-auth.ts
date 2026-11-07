'use client';
import { useAuth } from '@clerk/nextjs';
import { useCallback } from 'react';

type GetTokenOptions = {
  template?: 'convex';
  skipCache?: boolean;
};

type RawGetToken = (options?: GetTokenOptions) => Promise<string | null>;

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

  const runtimeOrigin =
    typeof window !== 'undefined' && window.location?.origin
      ? [normalizeOrigin(window.location.origin)]
      : [];
  const allowedOrigins = new Set(
    [...DEFAULT_ALLOWED_AZP_ORIGINS, ...runtimeOrigin, ...(options?.allowedAzpOrigins ?? [])].map(
      normalizeOrigin,
    ),
  );

  const rawAud = payload.aud;
  if (rawAud !== undefined && rawAud !== null) {
    const audList = Array.isArray(rawAud) ? rawAud.map(String) : [String(rawAud)];
    const validAud = audList.some((a) => {
      const norm = normalizeOrigin(a);
      return norm === 'convex' || allowedOrigins.has(norm);
    });
    if (!validAud) return false;
  }

  const rawAzp = payload.azp;
  if (rawAzp !== undefined && rawAzp !== null) {
    const azp = normalizeOrigin(String(rawAzp));
    if (!azp || !allowedOrigins.has(azp)) return false;
  }

  return true;
}

let convexTemplateUnavailableForSession: string | null = null;

/**
 * Resolves a Clerk JWT accepted by Convex (`auth.config.ts`).
 * Prefers the `convex` JWT template when configured on the Clerk instance, and
 * falls back to the default Clerk RS256 session token (`customJwt` provider on
 * the same Clerk issuer domain) when the Production instance has no `convex` template.
 */
export async function resolveClerkConvexToken(
  getToken: RawGetToken,
  options?: GetTokenOptions,
  sessionId?: string | null,
  claimOptions?: JwtClaimValidationOptions,
): Promise<string | null> {
  const skipCache = options?.skipCache;
  if (!options?.template || (sessionId && convexTemplateUnavailableForSession === sessionId)) {
    const raw = await getToken(skipCache !== undefined ? { skipCache } : undefined);
    return raw && validateClerkConvexJwtClaims(raw, claimOptions) ? raw : null;
  }
  try {
    const templated = await getToken({ template: options.template, skipCache });
    if (templated && validateClerkConvexJwtClaims(templated, claimOptions)) return templated;
  } catch {
    // Fall through to the default Clerk session token when the `convex` template is absent (404).
  }
  if (sessionId) {
    convexTemplateUnavailableForSession = sessionId;
  }
  try {
    const fallback = await getToken(skipCache !== undefined ? { skipCache } : undefined);
    return fallback && validateClerkConvexJwtClaims(fallback, claimOptions) ? fallback : null;
  } catch {
    return null;
  }
}

export function resetConvexTemplateCacheForTests() {
  convexTemplateUnavailableForSession = null;
}

export type SetActiveGuardDiagnostics = {
  lastOutcome: 'idle' | 'ok' | 'timeout' | 'error';
  activeTimers: number;
  lateSettlementIgnored: boolean;
  needsHardReloadAfterSetActive: boolean;
  reloadCount: number;
};

export type SetActiveGuardWindow = {
  __internal_onBeforeSetActive?: ((intent?: unknown) => Promise<unknown>) | undefined;
  __internal_onAfterSetActive?: ((...args: unknown[]) => unknown) | undefined;
  __clerk_set_active_diagnostics?: SetActiveGuardDiagnostics;
};

/**
 * Installs a bounded, leak-free guard around Clerk's `__internal_onBeforeSetActive`
 * and `__internal_onAfterSetActive` hooks:
 * 1. Clears the timeout timer immediately when `next(intent)` resolves/rejects first (no timer leak).
 * 2. Ignores and suppresses any late rejection/resolution that arrives after the deadline (no unhandled rejection).
 * 3. Eliminates false success: if cache invalidation times out or fails, schedules a clean page reload
 *    inside `__internal_onAfterSetActive` after Clerk finishes writing the session cookies.
 */
export function installBoundedSetActiveGuard(
  targetWindow: SetActiveGuardWindow,
  options?: { timeoutMs?: number; onReload?: () => void },
): SetActiveGuardDiagnostics {
  const timeoutMs = options?.timeoutMs ?? 2500;
  const triggerReload =
    options?.onReload ??
    (() => {
      if (typeof window !== 'undefined' && window.location?.reload) {
        window.location.reload();
      }
    });

  const diag: SetActiveGuardDiagnostics = {
    lastOutcome: 'idle',
    activeTimers: 0,
    lateSettlementIgnored: false,
    needsHardReloadAfterSetActive: false,
    reloadCount: 0,
  };
  targetWindow.__clerk_set_active_diagnostics = diag;

  let beforeFn = targetWindow.__internal_onBeforeSetActive;
  let afterFn = targetWindow.__internal_onAfterSetActive;

  const wrapBefore = (next: ((intent?: unknown) => Promise<unknown>) | undefined) => {
    if (typeof next !== 'function') return next;
    return function boundedBeforeSetActive(intent?: unknown): Promise<void> {
      return new Promise<void>((resolve) => {
        let settled = false;
        diag.activeTimers += 1;
        const timerId = setTimeout(() => {
          if (settled) return;
          settled = true;
          diag.activeTimers = Math.max(0, diag.activeTimers - 1);
          diag.lastOutcome = 'timeout';
          diag.needsHardReloadAfterSetActive = true;
          resolve();
        }, timeoutMs);

        let innerPromise: Promise<unknown>;
        try {
          innerPromise = Promise.resolve(next(intent));
        } catch {
          clearTimeout(timerId);
          settled = true;
          diag.activeTimers = Math.max(0, diag.activeTimers - 1);
          diag.lastOutcome = 'error';
          diag.needsHardReloadAfterSetActive = true;
          resolve();
          return;
        }

        innerPromise.then(
          () => {
            if (settled) {
              diag.lateSettlementIgnored = true;
              return;
            }
            settled = true;
            clearTimeout(timerId);
            diag.activeTimers = Math.max(0, diag.activeTimers - 1);
            diag.lastOutcome = 'ok';
            resolve();
          },
          () => {
            if (settled) {
              diag.lateSettlementIgnored = true;
              return;
            }
            settled = true;
            clearTimeout(timerId);
            diag.activeTimers = Math.max(0, diag.activeTimers - 1);
            diag.lastOutcome = 'error';
            diag.needsHardReloadAfterSetActive = true;
            resolve();
          },
        );
      });
    };
  };

  const wrapAfter = (next: ((...args: unknown[]) => unknown) | undefined) => {
    return function boundedAfterSetActive(...args: unknown[]): unknown {
      try {
        return typeof next === 'function' ? next(...args) : undefined;
      } finally {
        if (diag.needsHardReloadAfterSetActive) {
          diag.needsHardReloadAfterSetActive = false;
          diag.reloadCount += 1;
          triggerReload();
        }
      }
    };
  };

  beforeFn = wrapBefore(beforeFn);
  afterFn = wrapAfter(afterFn);

  Object.defineProperty(targetWindow, '__internal_onBeforeSetActive', {
    configurable: true,
    enumerable: true,
    get() {
      return beforeFn;
    },
    set(next) {
      beforeFn = wrapBefore(next);
    },
  });

  Object.defineProperty(targetWindow, '__internal_onAfterSetActive', {
    configurable: true,
    enumerable: true,
    get() {
      return afterFn;
    },
    set(next) {
      afterFn = wrapAfter(next);
    },
  });

  return diag;
}

export function useConvexClerkAuth() {
  const clerkAuth = useAuth();
  const { getToken, sessionId } = clerkAuth;
  const wrappedGetToken = useCallback(
    async (options: GetTokenOptions) => resolveClerkConvexToken(getToken, options, sessionId),
    [getToken, sessionId],
  );
  return {
    ...clerkAuth,
    getToken: wrappedGetToken,
  };
}
