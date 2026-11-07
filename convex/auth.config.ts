import type { AuthConfig, AuthProvider } from 'convex/server';

const issuers = (process.env.CLERK_JWT_ISSUER_DOMAIN ?? '')
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const providers: AuthProvider[] = issuers.flatMap((domain) => [
  { domain, applicationID: 'convex' },
  {
    type: 'customJwt' as const,
    issuer: domain,
    jwks: `${domain}/.well-known/jwks.json`,
    algorithm: 'RS256' as const,
  },
]);

export default {
  providers,
} satisfies AuthConfig;
