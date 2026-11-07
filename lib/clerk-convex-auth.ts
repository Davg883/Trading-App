'use client';
import { useAuth } from '@clerk/nextjs';
import { useCallback } from 'react';

type GetTokenOptions = {
  template?: 'convex';
  skipCache?: boolean;
};

type RawGetToken = (options?: GetTokenOptions) => Promise<string | null>;

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
): Promise<string | null> {
  const skipCache = options?.skipCache;
  if (!options?.template || (sessionId && convexTemplateUnavailableForSession === sessionId)) {
    return await getToken(skipCache !== undefined ? { skipCache } : undefined);
  }
  try {
    const templated = await getToken({ template: options.template, skipCache });
    if (templated) return templated;
  } catch {
    // Fall through to the default Clerk session token when the `convex` template is absent (404).
  }
  if (sessionId) {
    convexTemplateUnavailableForSession = sessionId;
  }
  try {
    return await getToken(skipCache !== undefined ? { skipCache } : undefined);
  } catch {
    return null;
  }
}

export function resetConvexTemplateCacheForTests() {
  convexTemplateUnavailableForSession = null;
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
