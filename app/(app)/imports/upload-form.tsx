"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field } from "@/components/ui";

export function UploadForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; existingBatchId?: string } | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>, allowDuplicate = false) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    if (allowDuplicate) form.set("allowDuplicate", "true");
    const res = await fetch("/api/imports", { method: "POST", body: form });
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string; existingBatchId?: string };
    setPending(false);
    if (!res.ok || !body.id) return setError({ message: body.error ?? "Upload failed.", existingBatchId: body.existingBatchId });
    router.push(`/imports/${body.id}`);
  }

  return (
    <form onSubmit={(e) => onSubmit(e)} className="space-y-4" aria-label="Upload import file">
      {error ? (
        <Alert>
          {error.message}{" "}
          {error.existingBatchId ? (
            <Link className="underline" href={`/imports/${error.existingBatchId}`}>
              View that import
            </Link>
          ) : null}
        </Alert>
      ) : null}
      <div className="space-y-1">
        <label htmlFor="file" className="block text-sm font-medium text-slate-800">
          File (.csv, .tsv, .txt or .xlsx, up to 50 MB)
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".csv,.tsv,.txt,.xlsx"
          required
          className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-2"
        />
      </div>
      <Field
        label="Where did this file come from?"
        id="source"
        placeholder="e.g. NV Treasurer public-records request, Nov 2026"
        hint="Recorded with every property for data-use compliance."
        required
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Uploading…" : "Upload and map columns"}
      </Button>
    </form>
  );
}
