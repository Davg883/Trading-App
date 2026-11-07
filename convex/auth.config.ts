import type { AuthConfig } from 'convex/server';
export default {
  providers:(process.env.CLERK_JWT_ISSUER_DOMAIN ?? '').split(',').map(s=>s.trim()).filter(Boolean).map(domain=>({domain,applicationID:'convex'})),
} satisfies AuthConfig;
