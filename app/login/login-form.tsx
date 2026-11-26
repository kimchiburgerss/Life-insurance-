"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Card, Field } from "@/components/ui";
import { authClient } from "@/lib/auth/client";

type Step = "password" | "totp" | "backup";

export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("password");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const { data, error } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setPending(false);
    if (error) return setError(error.message ?? "Sign-in failed.");
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) return setStep("totp");
    // No 2FA enrolled yet → the app forces enrollment.
    router.push("/setup-2fa");
    router.refresh();
  }

  async function onCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const code = String(new FormData(e.currentTarget).get("code")).trim();
    const { error } =
      step === "totp"
        ? await authClient.twoFactor.verifyTotp({ code, trustDevice: false })
        : await authClient.twoFactor.verifyBackupCode({ code, trustDevice: false });
    setPending(false);
    if (error) return setError(error.message ?? "That code didn't work. Try again.");
    router.push("/");
    router.refresh();
  }

  return (
    <Card>
      {error ? (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}
      {step === "password" ? (
        <form onSubmit={onPassword} className="space-y-4" aria-label="Sign in">
          <Field label="Email" id="email" type="email" autoComplete="username" required />
          <Field label="Password" id="password" type="password" autoComplete="current-password" required />
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Signing in…" : "Continue"}
          </Button>
        </form>
      ) : (
        <form onSubmit={onCode} className="space-y-4" aria-label="Two-factor verification">
          <Field
            key={step}
            label={step === "totp" ? "6-digit code from your authenticator app" : "Backup code"}
            id="code"
            inputMode={step === "totp" ? "numeric" : "text"}
            autoComplete="one-time-code"
            pattern={step === "totp" ? "[0-9]{6}" : undefined}
            maxLength={step === "totp" ? 6 : 11}
            autoFocus
            required
          />
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Verifying…" : "Verify"}
          </Button>
          <button
            type="button"
            className="text-sm text-slate-700 underline"
            onClick={() => setStep(step === "totp" ? "backup" : "totp")}
          >
            {step === "totp" ? "Use a backup code instead" : "Use authenticator app instead"}
          </button>
        </form>
      )}
    </Card>
  );
}
