import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest, type NextFetchEvent } from 'next/server';
const configured=Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
const auth=configured?clerkMiddleware({frontendApiProxy:{enabled:true}}):null;
export default async function proxy(request:NextRequest,event:NextFetchEvent){if(!auth)return NextResponse.next();try{return await auth(request,event);}catch{return NextResponse.next();}}
export const config={matcher:['/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)','/(api|trpc)(.*)','/__clerk/(.*)']};
