import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Heir Finder", template: "%s · Heir Finder" },
  description: "Operator console for unclaimed life-insurance recovery (Nevada).",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every page renders per request so it gets the CSP nonce (proxy.ts);
  // a prerendered page would carry no nonce and its scripts would be blocked.
  await connection();
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
