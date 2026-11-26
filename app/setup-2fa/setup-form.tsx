"use client";

import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useState, type FormEvent } from "react";
import { Alert, Button, Card, Field } from "@/components/ui";
import { authClient } from "@/lib/auth/client";

export function SetupTwoFactor({ email }: { email: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [enrollment, setEnrollment] = useState<{ qr: string; secret: string; backupCodes: string[] } | null>(null);

  async function onPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const password = String(new FormData(e.currentTarget).get("password"));
    const { data, error } = await authClient.twoFactor.enable({ password });
    setPending(false);
    if (error || !data || !("totpURI" in data)) return setError(error?.message ?? "Could not start enrollment.");
    const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
    setEnrollment({ qr: await QRCode.toDataURL(data.totpURI), secret, backupCodes: data.backupCodes });
  }

  async function onVerify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const code = String(new FormData(e.currentTarget).get("code")).trim();
    const { error } = await authClient.twoFactor.verifyTotp({ code });
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
      {!enrollment ? (
        <form onSubmit={onPassword} className="space-y-4">
          <p className="text-sm">Signed in as {email}. Confirm your password to continue.</p>
          <Field label="Password" id="password" type="password" autoComplete="current-password" required />
          <Button type="submit" disabled={pending}>
            {pending ? "Starting…" : "Start setup"}
          </Button>
        </form>
      ) : (
        <div className="space-y-5">
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>Scan this QR code with your authenticator app.</li>
            <li>Store the backup codes somewhere safe and offline. Each works once.</li>
            <li>Enter the 6-digit code from the app to finish.</li>
          </ol>
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL QR code */}
          <img src={enrollment.qr} alt="QR code for your authenticator app" width={200} height={200} />
          <p className="text-sm">
            Can&apos;t scan? Enter this key manually:{" "}
            <code className="break-all rounded bg-slate-100 px-1 font-mono">{enrollment.secret}</code>
          </p>
          <div>
            <h2 className="text-sm font-semibold">Backup codes</h2>
            <ul className="mt-1 grid grid-cols-2 gap-1 font-mono text-sm">
              {enrollment.backupCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
          <form onSubmit={onVerify} className="space-y-4">
            <Field
              label="6-digit code"
              id="code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              required
            />
            <Button type="submit" disabled={pending}>
              {pending ? "Verifying…" : "Turn on two-factor"}
            </Button>
          </form>
        </div>
      )}
    </Card>
  );
}
