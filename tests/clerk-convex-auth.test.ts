import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, type NextFetchEvent } from 'next/server';
import {
  resolveClerkConvexToken,
  resetConvexTemplateCacheForTests,
} from '../lib/clerk-convex-auth';

afterEach(() => {
  resetConvexTemplateCacheForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Clerk Production → Convex token resolution & proxy hardening', () => {
  it('uses the convex JWT template when available on the Clerk instance', async () => {
    const getToken = vi.fn(async (opts?: { template?: 'convex'; skipCache?: boolean }) =>
      opts?.template === 'convex' ? 'convex-template-jwt' : 'default-session-jwt',
    );
    const token = await resolveClerkConvexToken(getToken, { template: 'convex', skipCache: false }, 'sess_1');
    expect(token).toBe('convex-template-jwt');
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(getToken).toHaveBeenCalledWith({ template: 'convex', skipCache: false });
  });

  it('falls back to the default Clerk RS256 session token when the convex JWT template returns 404 and caches per session', async () => {
    const getToken = vi.fn(async (opts?: { template?: 'convex'; skipCache?: boolean }) => {
      if (opts?.template === 'convex') {
        throw new Error('ClerkJS: JWT template "convex" not found (404)');
      }
      return 'default-production-rs256-jwt';
    });

    const first = await resolveClerkConvexToken(getToken, { template: 'convex', skipCache: false }, 'sess_prod_1');
    expect(first).toBe('default-production-rs256-jwt');
    expect(getToken).toHaveBeenCalledTimes(2);

    // Subsequent calls for the same session skip the 404 template request
    const second = await resolveClerkConvexToken(getToken, { template: 'convex', skipCache: true }, 'sess_prod_1');
    expect(second).toBe('default-production-rs256-jwt');
    expect(getToken).toHaveBeenCalledTimes(3);
    expect(getToken).toHaveBeenLastCalledWith({ skipCache: true });
  });

  it('redirects legacy /__clerk/* requests to the custom Clerk Frontend API domain when proxy mode is disabled', async () => {
    vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN', 'https://clerk.capital.aiguides.co.uk');
    vi.stubEnv('NEXT_PUBLIC_CLERK_PROXY_URL', '');
    const { default: proxy } = await import('../proxy');
    const req = new NextRequest(
      'https://capital.aiguides.co.uk/__clerk/v1/environment?__clerk_api_version=2025-11-10',
    );
    const res = await proxy(req, {} as NextFetchEvent);
    expect(res?.status).toBe(307);
    expect(res?.headers.get('location')).toBe(
      'https://clerk.capital.aiguides.co.uk/v1/environment?__clerk_api_version=2025-11-10',
    );
  });
});
