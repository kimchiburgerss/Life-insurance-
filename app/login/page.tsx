import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <h1 className="mb-1 text-2xl font-semibold">Heir Finder</h1>
      <p className="mb-6 text-sm text-slate-600">Operator sign-in. Two-factor authentication is required.</p>
      <LoginForm />
    </main>
  );
}
