import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "AI Capital Intelligence | Benchmark 001", description: "An evidence-first AI economics and paper-trading research laboratory." };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
