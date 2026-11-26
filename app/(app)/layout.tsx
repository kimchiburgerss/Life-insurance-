import Link from "next/link";
import { requireOperator } from "@/lib/auth/session";
import { Badge } from "@/components/ui";
import { SignOutButton } from "./sign-out-button";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const operator = await requireOperator("case:read");
  const mock = (process.env.MOCK_MODE ?? "true") === "true";
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:bg-white focus:p-2">
        Skip to content
      </a>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="text-lg font-semibold">
            Heir Finder
          </Link>
          <nav aria-label="Main" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link href="/" className="hover:underline">
              Today
            </Link>
            <Link href="/pipeline" className="hover:underline">
              Pipeline
            </Link>
            <Link href="/screening" className="hover:underline">
              Screening
            </Link>
            <Link href="/review" className="hover:underline">
              Review queue
            </Link>
            <Link href="/imports" className="hover:underline">
              Imports
            </Link>
            <Link href="/rules" className="hover:underline">
              Jurisdiction rules
            </Link>
            {operator.role === "OWNER" ? (
              <Link href="/audit" className="hover:underline">
                Audit log
              </Link>
            ) : null}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {mock ? <Badge tone="warn">Mock mode</Badge> : null}
            <span>
              {operator.name} <span className="text-slate-500">({operator.role.toLowerCase()})</span>
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-8">
        {children}
      </main>
    </div>
  );
}
