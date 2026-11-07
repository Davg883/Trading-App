import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "AI Capital Intelligence | Benchmark 001", description: "An evidence-first AI economics and paper-trading research laboratory." };

const CLERK_PRODUCTION_SANITIZER = `(function(){try{var k="__clerk_environment",v=localStorage.getItem(k);if(v&&(v.indexOf('"development"')!==-1||v.indexOf('"show_devmode_warning":true')!==-1)){localStorage.removeItem(k);localStorage.removeItem("clerk-db-jwt");}var hostCookies=["__clerk_db_jwt","__clerk_redirect_count","__client_uat","__session"];for(var i=0;i<hostCookies.length;i++){document.cookie=hostCookies[i]+"=; Max-Age=0; path=/";document.cookie=hostCookies[i]+"=; Max-Age=0; path=/; Secure";}var raw=document.cookie?document.cookie.split(";"):[];for(var j=0;j<raw.length;j++){var name=raw[j].split("=")[0].trim();if(name.indexOf("__clerk_db_jwt")===0||name.indexOf("__client_uat_")===0||name.indexOf("__session_")===0){document.cookie=name+"=; Max-Age=0; path=/";document.cookie=name+"=; Max-Age=0; path=/; Secure";}}var fn=window.__internal_onBeforeSetActive;Object.defineProperty(window,"__internal_onBeforeSetActive",{configurable:true,enumerable:true,get:function(){return fn;},set:function(next){if(typeof next!=="function"){fn=next;return;}fn=function(intent){try{return Promise.race([Promise.resolve(next(intent)).catch(function(){}),new Promise(function(r){setTimeout(r,2500);})]);}catch(_){return Promise.resolve();}};}});}catch(_){}})();`;

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
