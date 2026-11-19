'use client';
import { useAuth } from '@clerk/nextjs';
import { useCallback } from 'react';
import {
  jwtHasAuthorizedPartyClaim,
  validateClerkConvexJwtClaims,
  type JwtClaimValidationOptions,
} from './auth/clerk-jwt-claims';

// Browser-only module. Server code (route handlers, server components, `server-only` libraries) must import claim
// validation from `lib/auth/clerk-jwt-claims` instead: a server import of this `'use client'` module resolves to a
// client-reference stub that throws when called. tests/server-client-import-boundary.test.ts enforces this.
export { validateClerkConvexJwtClaims, type JwtClaimValidationOptions };

type GetTokenOptions = {
  template?: 'convex';
  skipCache?: boolean;
};

type RawGetToken = (options?: GetTokenOptions) => Promise<string | null>;

let convexTemplateUnavailableForSession: string | null = null;

/**
 * Resolves a Clerk JWT accepted by Convex (`auth.config.ts`) and `convex/authz.ts` (`verifyIdentityClaims`).
 *
 * RC002.4.1 hotfix: Prefer Clerk's default RS256 session token (`getToken()` without `template`) whenever it is
 * available, valid, and carries an origin-bound `azp` claim. Convex's OIDC verifier (`applicationID: "convex"`)
 * strips standard RFC 7519 `aud` from `ctx.auth.getUserIdentity()`, which caused `convex/authz.ts` to throw
 * `Missing token application context` on Production Clerk `convex` template JWTs that omit `azp`.
 * Falls back to `getToken({ template: "convex" })` only if the default session token is unavailable or invalid.
 */
export async function resolveClerkConvexToken(
  getToken: RawGetToken,
  options?: GetTokenOptions,
  sessionId?: string | null,
  claimOptions?: JwtClaimValidationOptions,
): Promise<string | null> {
  const skipCache = options?.skipCache;
  try {
    const defaultToken = await getToken(skipCache !== undefined ? { skipCache } : undefined);
    if (
      defaultToken &&
      validateClerkConvexJwtClaims(defaultToken, claimOptions) &&
      jwtHasAuthorizedPartyClaim(defaultToken)
    ) {
      return defaultToken;
    }
  } catch {
    // Fall through to templated token lookup if default session token retrieval fails.
  }
  if (!options?.template || (sessionId && convexTemplateUnavailableForSession === sessionId)) {
    return null;
  }
  try {
    const templated = await getToken({ template: options.template, skipCache });
    if (templated && validateClerkConvexJwtClaims(templated, claimOptions)) return templated;
  } catch {
    if (sessionId) {
      convexTemplateUnavailableForSession = sessionId;
    }
  }
  return null;
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
