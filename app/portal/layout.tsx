import type { Metadata } from "next";
import { TextSizeToggle } from "./text-size";

export const metadata: Metadata = { title: { absolute: "Your unclaimed property" }, robots: { index: false, follow: false } };

/** Heir-facing pages: no operator navigation, calm and mobile-first (spec 5.10). */
export default function PortalLayout({ children }: LayoutProps<"/portal">) {
  return (
    <div id="portal-root" className="min-h-screen bg-stone-50 text-slate-900">
      <a href="#portal-main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:bg-white focus:p-2">
        Skip to content
      </a>
      <div className="mx-auto flex max-w-2xl justify-end px-4 pt-3">
        <TextSizeToggle />
      </div>
      <main id="portal-main" className="mx-auto max-w-2xl px-4 pb-16 pt-2 [overflow-wrap:anywhere]">
        {children}
      </main>
    </div>
  );
}
