import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "AI Capital Intelligence | Benchmark 001", description: "An evidence-first AI economics and paper-trading research laboratory." };

const CLERK_PRODUCTION_SANITIZER = `(function(){try{var k="__clerk_environment",v=localStorage.getItem(k);if(v&&(v.indexOf('"development"')!==-1||v.indexOf('"show_devmode_warning":true')!==-1)){localStorage.removeItem(k);localStorage.removeItem("clerk-db-jwt");}var hostCookies=["__clerk_db_jwt","__clerk_redirect_count","__client_uat","__session"];for(var i=0;i<hostCookies.length;i++){document.cookie=hostCookies[i]+"=; Max-Age=0; path=/";document.cookie=hostCookies[i]+"=; Max-Age=0; path=/; Secure";}var raw=document.cookie?document.cookie.split(";"):[];for(var j=0;j<raw.length;j++){var name=raw[j].split("=")[0].trim();if(name.indexOf("__clerk_db_jwt")===0||name.indexOf("__client_uat_")===0||name.indexOf("__session_")===0){document.cookie=name+"=; Max-Age=0; path=/";document.cookie=name+"=; Max-Age=0; path=/; Secure";}}var diag={lastOutcome:"idle",activeTimers:0,lateSettlementIgnored:false,needsHardReloadAfterSetActive:false,reloadCount:0};window.__clerk_set_active_diagnostics=diag;var beforeFn=window.__internal_onBeforeSetActive,afterFn=window.__internal_onAfterSetActive;function wrapBefore(next){if(typeof next!=="function")return next;return function(intent){return new Promise(function(resolve){var settled=false;diag.activeTimers+=1;var timerId=setTimeout(function(){if(settled)return;settled=true;diag.activeTimers=Math.max(0,diag.activeTimers-1);diag.lastOutcome="timeout";diag.needsHardReloadAfterSetActive=true;resolve();},2500);var p;try{p=Promise.resolve(next(intent));}catch(_){clearTimeout(timerId);settled=true;diag.activeTimers=Math.max(0,diag.activeTimers-1);diag.lastOutcome="error";diag.needsHardReloadAfterSetActive=true;resolve();return;}p.then(function(){if(settled){diag.lateSettlementIgnored=true;return;}settled=true;clearTimeout(timerId);diag.activeTimers=Math.max(0,diag.activeTimers-1);diag.lastOutcome="ok";resolve();},function(){if(settled){diag.lateSettlementIgnored=true;return;}settled=true;clearTimeout(timerId);diag.activeTimers=Math.max(0,diag.activeTimers-1);diag.lastOutcome="error";diag.needsHardReloadAfterSetActive=true;resolve();});});};}function wrapAfter(next){return function(){try{return typeof next==="function"?next.apply(this,arguments):undefined;}finally{if(diag.needsHardReloadAfterSetActive){diag.needsHardReloadAfterSetActive=false;diag.reloadCount+=1;window.location.reload();}}};}beforeFn=wrapBefore(beforeFn);afterFn=wrapAfter(afterFn);Object.defineProperty(window,"__internal_onBeforeSetActive",{configurable:true,enumerable:true,get:function(){return beforeFn;},set:function(next){beforeFn=wrapBefore(next);}});Object.defineProperty(window,"__internal_onAfterSetActive",{configurable:true,enumerable:true,get:function(){return afterFn;},set:function(next){afterFn=wrapAfter(next);}});}catch(_){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const isLiveClerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_live_"));
  return (
    <html lang="en">
      <head>
        {isLiveClerk && <script dangerouslySetInnerHTML={{ __html: CLERK_PRODUCTION_SANITIZER }} />}
      </head>
      <body>{children}</body>
    </html>
  );
}
