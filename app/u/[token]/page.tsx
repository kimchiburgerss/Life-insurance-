import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { formatPostalAddress, getBusinessProfile } from "@/lib/outreach/settings";
import { isOptOutToken } from "@/lib/outreach/util";
import { optOutAction } from "./actions";

export const metadata: Metadata = { title: { absolute: "Stop letters and emails" }, robots: { index: false, follow: false } };

/**
 * Public opt-out page linked from every letter and email. No login: the
 * unguessable token identifies the message. Shows nothing about the case.
 */
export default async function OptOutPage({ params, searchParams }: PageProps<"/u/[token]">) {
  const { token } = await params;
  const { done } = await searchParams;
  const business = await getBusinessProfile();
  const name = business?.legalName ?? "us";
  const valid = isOptOutToken(token) && (await prisma.communication.count({ where: { optOutToken: token } })) > 0;
  const contact = business ? (
    <p className="text-sm text-slate-700">
      You can also reach {business.contactName} at {business.phone}, {business.email}, or by mail at{" "}
      {formatPostalAddress(business.mailingAddress).join(", ")}.
    </p>
  ) : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 px-4 py-12">
      <h1 className="text-2xl font-semibold">Stop letters and emails from {name}</h1>
      {done === "1" ? (
        <div role="status" className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-emerald-900">
          Done. You will not hear from {name} again. We are sorry for any trouble we caused.
        </div>
      ) : valid ? (
        <form action={optOutAction} className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <p>
            Press the button and {name} will add you to its do-not-contact list. You will not receive any more letters or
            emails from us about this or any other matter.
          </p>
          <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700">
            Stop all letters and emails
          </button>
        </form>
      ) : (
        <p>This link is not valid. To stop hearing from {name}, please contact us directly and we will remove you right away.</p>
      )}
      {contact}
      <p className="text-sm text-slate-600">
        {name} is a private company. We are not part of, or endorsed by, the State of Nevada or any government agency. You can
        always claim unclaimed property yourself, for free, from the Nevada State Treasurer.
      </p>
    </main>
  );
}
