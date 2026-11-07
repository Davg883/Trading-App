import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest, type NextFetchEvent } from 'next/server';
const configured=Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
const auth=configured?clerkMiddleware():null;
export default function proxy(request:NextRequest,event:NextFetchEvent){return auth?auth(request,event):NextResponse.next();}
export const config={matcher:['/workspace(.*)','/proof-scale(.*)','/infrastructure(.*)','/defence(.*)','/consensus(.*)','/earnings/amazon(.*)','/settings(.*)','/api/brokers(.*)','/recovery(.*)','/policy-risk(.*)','/api/research(.*)','/trading(.*)','/api/trading(.*)']};
