import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest, type NextFetchEvent } from 'next/server';
import { authenticationUnavailableResponse, isSessionDependentApiPath } from './lib/auth/proxy-policy';

const configured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
const proxyUrlConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PROXY_URL?.trim());
const auth = configured
  ? clerkMiddleware(proxyUrlConfigured ? { frontendApiProxy: { enabled: true } } : undefined)
  : null;

/** Session layer unavailable: refuse session-dependent API routes in production, keep public shells rendering. */
function failClosed(request: NextRequest): NextResponse {
  if (process.env.NODE_ENV === 'production' && isSessionDependentApiPath(request.nextUrl.pathname)) {
    return authenticationUnavailableResponse();
  }
  return NextResponse.next();
}

export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!proxyUrlConfigured && request.nextUrl.pathname.startsWith('/__clerk/')) {
    const issuer = (process.env.CLERK_JWT_ISSUER_DOMAIN ?? '').split(',')[0]?.trim().replace(/\/+$/, '');
    if (issuer && issuer.startsWith('https://clerk.')) {
      const target = `${issuer}${request.nextUrl.pathname.slice('/__clerk'.length)}${request.nextUrl.search}`;
      return NextResponse.redirect(target, 307);
    }
  }
  if (!auth) return failClosed(request);
  try {
    const response = await auth(request, event);
    if (
      request.headers.has('next-action') &&
      response &&
      response.status >= 300 &&
      response.status < 400 &&
      (response.headers.get('location') ?? '').includes('/v1/client/handshake')
    ) {
      return NextResponse.next();
    }
    return response;
  } catch {
    return failClosed(request);
  }
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/(.*)',
  ],
};
