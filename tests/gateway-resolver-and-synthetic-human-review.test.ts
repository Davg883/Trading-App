import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  consumeAcceptanceNonce,
  gatewayConfigured,
  resolveGatewayBaseUrl,
} from '../lib/graph/evidence-chat-gateway';
import Dashboard from '../components/dashboard';

describe('Priority 1 — Regional Convex gateway resolver (resolveGatewayBaseUrl)', () => {
  const SECRET = 'g'.repeat(48);

  it('resolves standard .convex.cloud hostnames to .convex.site over HTTPS', () => {
    expect(
      resolveGatewayBaseUrl({
        NEXT_PUBLIC_CONVEX_URL: 'https://benevolent-magpie-921.convex.cloud',
      }),
    ).toBe('https://benevolent-magpie-921.convex.site');

    expect(
      resolveGatewayBaseUrl({
        NEXT_PUBLIC_CONVEX_URL: '  https://prestigious-dragon-8.convex.cloud/  ',
      }),
    ).toBe('https://prestigious-dragon-8.convex.site');
  });

  it('resolves regional .eu-west-1.convex.cloud (and other regional) hostnames to regional .convex.site over HTTPS', () => {
    expect(
      resolveGatewayBaseUrl({
        NEXT_PUBLIC_CONVEX_URL: 'https://benevolent-magpie-921.eu-west-1.convex.cloud',
      }),
    ).toBe('https://benevolent-magpie-921.eu-west-1.convex.site');

    expect(
      resolveGatewayBaseUrl({
        NEXT_PUBLIC_CONVEX_URL: 'https://prestigious-dragon-8.eu-west-1.convex.cloud/',
      }),
    ).toBe('https://prestigious-dragon-8.eu-west-1.convex.site');

    expect(
      resolveGatewayBaseUrl({
        NEXT_PUBLIC_CONVEX_URL: 'https://example-deployment-123.us-east-1.convex.cloud',
      }),
    ).toBe('https://example-deployment-123.us-east-1.convex.site');
  });

  it('supports corresponding standard and regional .convex.site URLs and enforces cloud/site alignment', () => {
    expect(
      resolveGatewayBaseUrl({
        NEXT_PUBLIC_CONVEX_URL: 'https://benevolent-magpie-921.convex.site',
      }),
    ).toBe('https://benevolent-magpie-921.convex.site');

    expect(
      resolveGatewayBaseUrl({
        NEXT_PUBLIC_CONVEX_URL: 'https://benevolent-magpie-921.eu-west-1.convex.site/',
      }),
    ).toBe('https://benevolent-magpie-921.eu-west-1.convex.site');

    expect(
      resolveGatewayBaseUrl({
        NEXT_PUBLIC_CONVEX_SITE_URL: 'https://prestigious-dragon-8.eu-west-1.convex.site',
      }),
    ).toBe('https://prestigious-dragon-8.eu-west-1.convex.site');

    expect(
      resolveGatewayBaseUrl({
        NEXT_PUBLIC_CONVEX_URL: 'https://prestigious-dragon-8.eu-west-1.convex.cloud',
        NEXT_PUBLIC_CONVEX_SITE_URL: 'https://prestigious-dragon-8.eu-west-1.convex.site',
      }),
    ).toBe('https://prestigious-dragon-8.eu-west-1.convex.site');

    // Mismatched deployment or region between NEXT_PUBLIC_CONVEX_URL and NEXT_PUBLIC_CONVEX_SITE_URL fails closed
    expect(
      resolveGatewayBaseUrl({
        NEXT_PUBLIC_CONVEX_URL: 'https://benevolent-magpie-921.eu-west-1.convex.cloud',
        NEXT_PUBLIC_CONVEX_SITE_URL: 'https://prestigious-dragon-8.eu-west-1.convex.site',
      }),
    ).toBeNull();

    // NEXT_PUBLIC_CONVEX_SITE_URL must be a .convex.site hostname, not .convex.cloud
    expect(
      resolveGatewayBaseUrl({
        NEXT_PUBLIC_CONVEX_SITE_URL: 'https://prestigious-dragon-8.eu-west-1.convex.cloud',
      }),
    ).toBeNull();
  });

  it('rejects invalid domains, non-HTTPS origins, extra subdomain depths, and malicious lookalikes', () => {
    const invalidUrls = [
      'http://benevolent-magpie-921.convex.cloud',
      'http://benevolent-magpie-921.eu-west-1.convex.cloud',
      'http://benevolent-magpie-921.eu-west-1.convex.site',
      'https://benevolent-magpie-921.convex.cloud.evil.example',
      'https://benevolent-magpie-921.eu-west-1.convex.site.evil.example',
      'https://evil-convex.cloud',
      'https://evil-convex.site',
      'https://notconvex.cloud',
      'https://convex.cloud',
      'https://convex.site',
      'https://.convex.cloud',
      'https://benevolent-magpie-921..convex.cloud',
      'https://-leading-hyphen.convex.cloud',
      'https://trailing-hyphen-.convex.cloud',
      'https://benevolent-magpie-921.-eu-west-1.convex.cloud',
      'https://extra.sub.eu-west-1.convex.cloud',
      'https://benevolent-magpie-921.convex.cloud@evil.example',
      'https://user:pass@benevolent-magpie-921.convex.cloud',
      'https://evil.example/https://benevolent-magpie-921.convex.cloud',
      'https://benevolent-magpie-921.convex.cloud/api/evidence-chat',
      'https://benevolent-magpie-921.convex.cloud?redirect=https://evil.example',
      'https://benevolent-magpie-921.convex.cloud#fragment',
      'https://benevolent-magpie-921.convex.cloud:8443',
      'https://UPPERCASE-DEPLOYMENT.convex.cloud',
      'javascript:alert(1)',
      'https://',
      '',
    ];

    for (const bad of invalidUrls) {
      expect(resolveGatewayBaseUrl({ NEXT_PUBLIC_CONVEX_URL: bad }), `Expected null for ${bad}`).toBeNull();
      expect(
        gatewayConfigured({ NEXT_PUBLIC_CONVEX_URL: bad, EVIDENCE_CHAT_GATEWAY_SECRET: SECRET }),
        `Expected gatewayConfigured=false for ${bad}`,
      ).toBe(false);
    }
  });

  it('honours valid explicit CONVEX_HTTP_ACTIONS_URL overrides and fails closed without fallback when override is invalid', async () => {
    expect(
      resolveGatewayBaseUrl({
        CONVEX_HTTP_ACTIONS_URL: 'https://prestigious-dragon-8.eu-west-1.convex.site/',
        NEXT_PUBLIC_CONVEX_URL: 'https://benevolent-magpie-921.eu-west-1.convex.cloud',
      }),
    ).toBe('https://prestigious-dragon-8.eu-west-1.convex.site');

    expect(
      resolveGatewayBaseUrl({
        CONVEX_HTTP_ACTIONS_URL: 'https://prestigious-dragon-8.convex.site',
      }),
    ).toBe('https://prestigious-dragon-8.convex.site');

    expect(
      resolveGatewayBaseUrl({
        CONVEX_HTTP_ACTIONS_URL: 'http://127.0.0.1:3210/',
        NEXT_PUBLIC_CONVEX_URL: 'https://benevolent-magpie-921.eu-west-1.convex.cloud',
      }),
    ).toBe('http://127.0.0.1:3210');

    expect(
      resolveGatewayBaseUrl({
        CONVEX_HTTP_ACTIONS_URL: 'http://localhost:8787',
      }),
    ).toBe('http://localhost:8787');

    // Invalid explicit override MUST fail closed (null) and never fall back to NEXT_PUBLIC_CONVEX_URL
    for (const invalidOverride of [
      'http://prestigious-dragon-8.eu-west-1.convex.site',
      'https://evil.example',
      'https://prestigious-dragon-8.convex.site.evil.example',
      'https://user:pass@prestigious-dragon-8.convex.site',
      'https://prestigious-dragon-8.convex.site/extra-path',
      'https://prestigious-dragon-8.convex.site?x=1',
      'http://127.0.0.1:99999',
      'http://192.168.1.10:3210',
    ]) {
      expect(
        resolveGatewayBaseUrl({
          CONVEX_HTTP_ACTIONS_URL: invalidOverride,
          NEXT_PUBLIC_CONVEX_URL: 'https://benevolent-magpie-921.eu-west-1.convex.cloud',
        }),
        `Expected null for invalid override ${invalidOverride}`,
      ).toBeNull();
    }

    // Verify end-to-end gateway fetch uses regional .convex.site derived from regional .convex.cloud
    const seenUrls: string[] = [];
    await consumeAcceptanceNonce('acn1.' + 'a'.repeat(32) + '.' + 'b'.repeat(64), 'Test question?', {
      env: {
        NEXT_PUBLIC_CONVEX_URL: 'https://prestigious-dragon-8.eu-west-1.convex.cloud',
        EVIDENCE_CHAT_GATEWAY_SECRET: SECRET,
      },
      fetchImpl: async (url) => {
        seenUrls.push(url);
        return Response.json({ error: { code: 'nonce_rejected', reason: 'unknown_nonce' } }, { status: 409 });
      },
    });
    expect(seenUrls).toEqual([
      'https://prestigious-dragon-8.eu-west-1.convex.site/api/evidence-chat/acceptance/consume',
    ]);
  });
});

describe('Priority 2 — Homepage Human Review synthetic controls (components/dashboard.tsx)', () => {
  const dashboardSrc = readFileSync('components/dashboard.tsx', 'utf8');

  it('marks all pre-populated proposals as synthetic and labels amounts as demonstration allocations', () => {
    expect(dashboardSrc).toContain('data-testid="human-review-synthetic-disclosure"');
    expect(dashboardSrc).toContain('{p.id} · Synthetic fixture');
    expect(dashboardSrc).toContain('demonstration allocation (synthetic fixture, not a live or paper order)');

    // Old misleading labels must not appear in components/dashboard.tsx
    expect(dashboardSrc).not.toContain('proposed allocation');
    expect(dashboardSrc).not.toContain('Approve paper allocation');
    expect(dashboardSrc).not.toContain('Your judgement is the final control.');
    expect(dashboardSrc).not.toContain('Human authorisation required');
  });

  it('renames approval and rejection controls to indicate browser-only localStorage behaviour and separates authenticated research', () => {
    expect(dashboardSrc).toContain('Simulate browser-only demo rejection (localStorage)');
    expect(dashboardSrc).toContain('Simulate browser-only demo approval (localStorage)');
    expect(dashboardSrc).toContain('Synthetic demonstration queue · Browser localStorage only');
    expect(dashboardSrc).toContain('aci-benchmark-demo-v1');
    expect(dashboardSrc).toContain('Not connected to Convex or Trading 212');
    expect(dashboardSrc).toContain('For authenticated, owner-scoped research reviews, use');
    expect(dashboardSrc).toContain('href="/defence"');
    expect(dashboardSrc).toContain('href="/workspace"');
  });

  it('renders without brokerage or API calls and has zero network/mutation dependencies in the Human Review action handler', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const html = renderToStaticMarkup(React.createElement(Dashboard));
      expect(html).toContain('Synthetic demonstration');
      expect(html).toContain('Synthetic demo queue · browser localStorage only');
      expect(html).toContain('Inspect synthetic demo review queue (browser-only)');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }

    // Static verification that Dashboard makes zero fetch(), /api/trading, /api/brokers, or Convex mutation calls
    expect(dashboardSrc).not.toMatch(/\bfetch\s*\(/);
    expect(dashboardSrc).not.toContain('/api/trading');
    expect(dashboardSrc).not.toContain('/api/brokers');
    expect(dashboardSrc).not.toContain('useMutation');
    expect(dashboardSrc).not.toContain('ConvexHttpClient');
  });
});
