import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, type NextFetchEvent } from 'next/server';
import type { UserIdentity } from 'convex/server';
import {
  installBoundedSetActiveGuard,
  resolveClerkConvexToken,
  resetConvexTemplateCacheForTests,
  validateClerkConvexJwtClaims,
  type SetActiveGuardWindow,
} from '../lib/clerk-convex-auth';
import { verifyIdentityClaims } from '../convex/authz';

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature_placeholder`;
}

afterEach(() => {
  resetConvexTemplateCacheForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Clerk Production → Convex token resolution & proxy hardening', () => {
  it('uses the convex JWT template when available on the Clerk instance', async () => {
    const oidcJwt = makeJwt({
      iss: 'https://clerk.capital.aiguides.co.uk',
      sub: 'user_prod_owner',
      aud: 'convex',
    });
    const getToken = vi.fn(async (opts?: { template?: 'convex'; skipCache?: boolean }) =>
      opts?.template === 'convex' ? oidcJwt : 'default-session-jwt',
    );
    const token = await resolveClerkConvexToken(
      getToken,
      { template: 'convex', skipCache: false },
      'sess_1',
      { expectedIssuers: ['https://clerk.capital.aiguides.co.uk'] },
    );
    expect(token).toBe(oidcJwt);
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(getToken).toHaveBeenCalledWith({ template: 'convex', skipCache: false });
  });

  it('falls back to the default Clerk RS256 session token when the convex JWT template returns 404 and caches per session', async () => {
    const customSessionJwt = makeJwt({
      iss: 'https://clerk.capital.aiguides.co.uk',
      sub: 'user_prod_owner',
      azp: 'https://capital.aiguides.co.uk',
    });
    const getToken = vi.fn(async (opts?: { template?: 'convex'; skipCache?: boolean }) => {
      if (opts?.template === 'convex') {
        throw new Error('ClerkJS: JWT template "convex" not found (404)');
      }
      return customSessionJwt;
    });

    const first = await resolveClerkConvexToken(
      getToken,
      { template: 'convex', skipCache: false },
      'sess_prod_1',
      { expectedIssuers: ['https://clerk.capital.aiguides.co.uk'] },
    );
    expect(first).toBe(customSessionJwt);
    expect(getToken).toHaveBeenCalledTimes(2);

    // Subsequent calls for the same session skip the 404 template request
    const second = await resolveClerkConvexToken(
      getToken,
      { template: 'convex', skipCache: true },
      'sess_prod_1',
      { expectedIssuers: ['https://clerk.capital.aiguides.co.uk'] },
    );
    expect(second).toBe(customSessionJwt);
    expect(getToken).toHaveBeenCalledTimes(3);
    expect(getToken).toHaveBeenLastCalledWith({ skipCache: true });
  });

  it('validates issuer, audience, and authorized party (azp) application binding on both client and Convex server', () => {
    vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN', 'https://clerk.capital.aiguides.co.uk');

    // 1. Valid OIDC convex template token
    const validOidc = makeJwt({
      iss: 'https://clerk.capital.aiguides.co.uk',
      sub: 'user_prod_1',
      aud: 'convex',
    });
    expect(validateClerkConvexJwtClaims(validOidc)).toBe(true);
    expect(
      verifyIdentityClaims({
        tokenIdentifier: 'https://clerk.capital.aiguides.co.uk|user_prod_1',
        issuer: 'https://clerk.capital.aiguides.co.uk',
        subject: 'user_prod_1',
        aud: 'convex',
      } as unknown as UserIdentity),
    ).toBeTruthy();

    // 2. Valid Clerk default RS256 session token bound to https://capital.aiguides.co.uk via azp
    const validAzp = makeJwt({
      iss: 'https://clerk.capital.aiguides.co.uk',
      sub: 'user_prod_1',
      azp: 'https://capital.aiguides.co.uk',
    });
    expect(validateClerkConvexJwtClaims(validAzp)).toBe(true);
    expect(
      verifyIdentityClaims({
        tokenIdentifier: 'https://clerk.capital.aiguides.co.uk|user_prod_1',
        issuer: 'https://clerk.capital.aiguides.co.uk',
        subject: 'user_prod_1',
        azp: 'https://capital.aiguides.co.uk',
      } as unknown as UserIdentity),
    ).toBeTruthy();

    // 3. Rejects foreign issuer
    const foreignIssuerJwt = makeJwt({
      iss: 'https://harmless-akita-9211.clerk.accounts.dev',
      sub: 'user_dev_1',
      aud: 'convex',
    });
    expect(validateClerkConvexJwtClaims(foreignIssuerJwt)).toBe(false);
    expect(() =>
      verifyIdentityClaims({
        tokenIdentifier: 'https://harmless-akita-9211.clerk.accounts.dev|user_dev_1',
        issuer: 'https://harmless-akita-9211.clerk.accounts.dev',
        subject: 'user_dev_1',
        aud: 'convex',
      } as unknown as UserIdentity),
    ).toThrow('Untrusted token issuer');

    // 4. Rejects foreign audience
    const foreignAudJwt = makeJwt({
      iss: 'https://clerk.capital.aiguides.co.uk',
      sub: 'user_prod_1',
      aud: 'foreign-relying-party',
    });
    expect(validateClerkConvexJwtClaims(foreignAudJwt)).toBe(false);
    expect(() =>
      verifyIdentityClaims({
        tokenIdentifier: 'https://clerk.capital.aiguides.co.uk|user_prod_1',
        issuer: 'https://clerk.capital.aiguides.co.uk',
        subject: 'user_prod_1',
        aud: 'foreign-relying-party',
      } as unknown as UserIdentity),
    ).toThrow('Untrusted token audience');

    // 5. Rejects foreign authorized party (azp)
    const foreignAzpJwt = makeJwt({
      iss: 'https://clerk.capital.aiguides.co.uk',
      sub: 'user_prod_1',
      azp: 'https://attacker.example.com',
    });
    expect(validateClerkConvexJwtClaims(foreignAzpJwt)).toBe(false);
    expect(() =>
      verifyIdentityClaims({
        tokenIdentifier: 'https://clerk.capital.aiguides.co.uk|user_prod_1',
        issuer: 'https://clerk.capital.aiguides.co.uk',
        subject: 'user_prod_1',
        azp: 'https://attacker.example.com',
      } as unknown as UserIdentity),
    ).toThrow('Untrusted token authorized party');
  });

  it('guards __internal_onBeforeSetActive without timer leaks, false success, or unhandled late rejections', async () => {
    const reloads: number[] = [];
    const win: SetActiveGuardWindow = {};
    const diag = installBoundedSetActiveGuard(win, {
      timeoutMs: 30,
      onReload: () => reloads.push(Date.now()),
    });

    // Case 1: Normal fast resolution clears the timer and does not reload
    win.__internal_onBeforeSetActive = async () => 'invalidated';
    win.__internal_onAfterSetActive = () => 'after';
    await win.__internal_onBeforeSetActive('sign-in');
    win.__internal_onAfterSetActive();
    expect(diag.lastOutcome).toBe('ok');
    expect(diag.activeTimers).toBe(0);
    expect(diag.needsHardReloadAfterSetActive).toBe(false);
    expect(reloads).toHaveLength(0);

    // Case 2: Unresolved / slow Server Action times out, avoids false success by reloading in onAfterSetActive,
    // and ignores late rejection without unhandledrejection
    let rejectLate!: (err: Error) => void;
    win.__internal_onBeforeSetActive = () =>
      new Promise((_, reject) => {
        rejectLate = reject;
      });
    await win.__internal_onBeforeSetActive('sign-in');
    expect(diag.lastOutcome).toBe('timeout');
    expect(diag.activeTimers).toBe(0);
    expect(diag.needsHardReloadAfterSetActive).toBe(true);

    // Late failure arriving after the deadline is ignored safely
    rejectLate(new Error('Late Server Action 500'));
    await new Promise((r) => setTimeout(r, 5));
    expect(diag.lateSettlementIgnored).toBe(true);

    // When Clerk finishes writing cookies in onAfterSetActive, hard reload fires to prevent stale RSC false success
    win.__internal_onAfterSetActive();
    expect(reloads).toHaveLength(1);
    expect(diag.reloadCount).toBe(1);
    expect(diag.needsHardReloadAfterSetActive).toBe(false);
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
