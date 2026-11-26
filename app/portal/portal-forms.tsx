"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { callAction, demoPayAction, demoSignAction, emailAction, messageAction, stopContactAction, type PortalActionState } from "./actions";

const field = "mt-1 block w-full rounded-lg border border-slate-400 bg-white px-3 py-2.5 text-base text-slate-900";
const button = "inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-800 px-5 py-2.5 text-base font-semibold text-white hover:bg-emerald-900 disabled:bg-slate-400";
const quiet = "inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-400 bg-white px-5 py-2.5 text-base font-medium text-slate-900 hover:bg-slate-100";

function Result({ state }: { state: PortalActionState }) {
  if (state.error) return <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-900">{state.error}</p>;
  if (state.ok) return <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-900">{state.ok}</p>;
  return null;
}

export function MessageForm() {
  const [state, action, pending] = useActionState<PortalActionState, FormData>(messageAction, {});
  return (
    <form action={action} className="space-y-3">
      <label htmlFor="message" className="block font-medium">
        Your message
      </label>
      <textarea id="message" name="message" rows={4} required maxLength={3000} className={field} placeholder="Ask a question or tell us what you would like to do." />
      <p className="text-sm text-slate-600">Please don&apos;t include your Social Security number or bank details.</p>
      <button type="submit" className={button} disabled={pending}>
        {pending ? "Sending…" : "Send message"}
      </button>
      <Result state={state} />
    </form>
  );
}

export function CallForm() {
  const [state, action, pending] = useActionState<PortalActionState, FormData>(callAction, {});
  return (
    <form action={action} className="space-y-3">
      <div>
        <label htmlFor="phone" className="block font-medium">
          Phone number
        </label>
        <input id="phone" name="phone" type="tel" autoComplete="tel" required className={field} />
      </div>
      <div>
        <label htmlFor="times" className="block font-medium">
          Good times to call (optional)
        </label>
        <input id="times" name="times" className={field} placeholder="For example: weekday mornings" />
      </div>
      <button type="submit" className={quiet} disabled={pending}>
        Ask for a call back
      </button>
      <Result state={state} />
    </form>
  );
}

export function EmailForm() {
  const [state, action, pending] = useActionState<PortalActionState, FormData>(emailAction, {});
  return (
    <form action={action} className="space-y-3">
      <label htmlFor="email" className="block font-medium">
        Email address
      </label>
      <input id="email" name="email" type="email" autoComplete="email" required className={field} />
      <button type="submit" className={quiet} disabled={pending}>
        Save email
      </button>
      <Result state={state} />
    </form>
  );
}

export function UploadForm({ items }: { items: { key: string; label: string }[] }) {
  const router = useRouter();
  const [key, setKey] = useState(items[0]?.key ?? "other");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<PortalActionState>({});
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setStatus({ error: "Choose a file first." });
    setBusy(true);
    setStatus({});
    const fd = new FormData();
    fd.set("checklistKey", key);
    fd.set("file", file);
    try {
      const res = await fetch("/api/portal/documents", { method: "POST", body: fd });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) setStatus({ error: body.error ?? "The upload did not work. Please try again." });
      else {
        setStatus({ ok: "Thank you. We received your document." });
        setFile(null);
        (e.target as HTMLFormElement).reset();
        router.refresh();
      }
    } catch {
      setStatus({ error: "The upload did not work. Please check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label htmlFor="doc-kind" className="block font-medium">
          Which document is this?
        </label>
        <select id="doc-kind" value={key} onChange={(e) => setKey(e.target.value)} className={field}>
          {items.map((i) => (
            <option key={i.key} value={i.key}>
              {i.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="doc-file" className="block font-medium">
          File (a PDF or a clear photo)
        </label>
        <input id="doc-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className={field} />
      </div>
      <button type="submit" className={button} disabled={busy}>
        {busy ? "Uploading…" : "Upload document"}
      </button>
      <Result state={status} />
    </form>
  );
}

export function DemoSignForm({ agreementId, fullName }: { agreementId: string; fullName: string }) {
  const [state, action, pending] = useActionState<PortalActionState, FormData>(demoSignAction, {});
  return (
    <form action={action} className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
      <p className="text-sm font-medium text-amber-900">Demo mode: this stands in for the e-signature service&apos;s signing page. Nothing here is legally binding.</p>
      <input type="hidden" name="agreementId" value={agreementId} />
      <input type="hidden" name="expectedName" value={fullName} />
      <label className="flex items-start gap-2">
        <input type="checkbox" name="agree" className="mt-1.5 h-5 w-5" />
        <span>I have read the agreement and I want to sign it electronically.</span>
      </label>
      <div>
        <label htmlFor="typedName" className="block font-medium">
          Type your full name to sign
        </label>
        <input id="typedName" name="typedName" autoComplete="name" className={field} />
      </div>
      <button type="submit" className={button} disabled={pending}>
        Sign agreement
      </button>
      <Result state={state} />
    </form>
  );
}

export function StopContactForm() {
  const [state, action, pending] = useActionState<PortalActionState, FormData>(stopContactAction, {});
  return (
    <form action={action} className="space-y-3">
      <label className="flex items-start gap-2">
        <input type="checkbox" name="confirm" className="mt-1.5 h-5 w-5" />
        <span>Please stop all letters and emails to me.</span>
      </label>
      <button type="submit" className={quiet} disabled={pending}>
        Stop contact
      </button>
      <Result state={state} />
    </form>
  );
}

export function DemoPayForm({ invoiceId }: { invoiceId: string }) {
  const [state, action, pending] = useActionState<PortalActionState, FormData>(demoPayAction, {});
  return (
    <form action={action} className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
      <p className="text-sm font-medium text-amber-900">Demo mode: this stands in for the online payment page. No money moves.</p>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <button type="submit" className={button} disabled={pending}>
        Pay invoice (demo)
      </button>
      <Result state={state} />
    </form>
  );
}
