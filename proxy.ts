import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest, type NextFetchEvent } from 'next/server';

const configured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
const proxyUrlConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PROXY_URL?.trim());
const auth = configured
  ? clerkMiddleware(proxyUrlConfigured ? { frontendApiProxy: { enabled: true } } : undefined)
  : null;

export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!proxyUrlConfigured && request.nextUrl.pathname.startsWith('/__clerk/')) {
    const issuer = (process.env.CLERK_JWT_ISSUER_DOMAIN ?? '').split(',')[0]?.trim().replace(/\/+$/, '');
    if (issuer && issuer.startsWith('https://clerk.')) {
      const target = `${issuer}${request.nextUrl.pathname.slice('/__clerk'.length)}${request.nextUrl.search}`;
      return NextResponse.redirect(target, 307);
    }
  }
  if (!auth) return NextResponse.next();
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
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/(.*)',
  ],
};
