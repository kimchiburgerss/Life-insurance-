import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Heir Finder", template: "%s · Heir Finder" },
  description: "Operator console for unclaimed life-insurance recovery (Nevada).",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
