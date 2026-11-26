import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { SetupTwoFactor } from "./setup-form";

export const metadata: Metadata = { title: "Set up two-factor authentication" };

export default async function SetupTwoFactorPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.user.twoFactorEnabled) redirect("/");
  return (
    <main className="mx-auto max-w-lg px-4 py-12">
      <h1 className="mb-1 text-2xl font-semibold">Set up two-factor authentication</h1>
      <p className="mb-6 text-sm text-slate-600">
        Two-factor authentication is required for every operator account. You will need an
        authenticator app such as 1Password, Google Authenticator or Authy.
      </p>
      <SetupTwoFactor email={session.user.email} />
    </main>
  );
}
