import Link from "next/link";
import { formatPostalAddress, getBusinessProfile } from "@/lib/outreach/settings";
import { portalView } from "@/lib/portal/service";
import { currentPortal } from "@/lib/portal/session";
import { signOutAction } from "./actions";
import { CallForm, DemoPayForm, DemoSignForm, EmailForm, MessageForm, StopContactForm, UploadForm } from "./portal-forms";
import { formatExactUsd } from "@/lib/outreach/content";

export const dynamic = "force-dynamic";

function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id} className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 id={id} className="mb-3 text-xl font-semibold">
        {title}
      </h2>
      <div className="space-y-3 text-base leading-relaxed">{children}</div>
    </section>
  );
}

const DOC_STATUS: Record<string, { label: string; cls: string }> = {
  RECEIVED: { label: "Received — we will check it", cls: "bg-sky-100 text-sky-900" },
  ACCEPTED: { label: "Checked — thank you", cls: "bg-emerald-100 text-emerald-900" },
  NEEDS_REPLACEMENT: { label: "Please send a new copy", cls: "bg-amber-100 text-amber-900" },
};

export default async function PortalPage({ searchParams }: PageProps<"/portal">) {
  const ctx = await currentPortal();
  const sp = await searchParams;
  if (!ctx) {
    const business = await getBusinessProfile();
    return (
      <div className="space-y-4 pt-8">
        <h1 className="text-2xl font-semibold">{sp.signedOut === "1" ? "You have signed out" : "This link didn't open your page"}</h1>
        <p className="text-lg">
          {sp.signedOut === "1"
            ? "To come back, use the link in our letter again."
            : "The link may have expired or been typed with a mistake. Please use the link in our letter again, or contact us and we will send you a new one."}
        </p>
        {business ? (
          <p className="text-lg">
            {business.contactName}, {business.legalName}: {business.phone} · {business.email}
          </p>
        ) : null}
        <p className="text-base text-slate-700">
          You can always claim unclaimed property yourself, for free, from the Nevada State Treasurer&apos;s Office, Unclaimed Property Division:{" "}
          <a href="https://claims.nevadaunclaimedproperty.gov" className="font-medium underline" rel="noopener noreferrer">
            claims.nevadaunclaimedproperty.gov
          </a>
          .
        </p>
      </div>
    );
  }

  const v = await portalView(ctx);
  const uploadItems = v.checklist.map((i) => ({ key: i.key, label: i.label }));

  return (
    <div className="space-y-5">
      <header className="pt-2">
        <p className="text-sm text-slate-600">
          {v.business?.legalName ?? "Our company"} · reference {v.reference}
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Hello {v.firstName}</h1>
        <p className="mt-2 text-lg leading-relaxed">
          We wrote to you about unclaimed property in the name of <strong>{v.ownerName}</strong>. The State of Nevada is holding it. This page explains your
          choices. Take your time — there is no rush.
        </p>
      </header>

      <section aria-labelledby="free-claim" className="rounded-xl border-2 border-emerald-700 bg-emerald-50 p-5">
        <h2 id="free-claim" className="text-xl font-semibold text-emerald-950">
          You can claim this yourself, for free
        </h2>
        <p className="mt-2 text-base leading-relaxed text-emerald-950">{v.disclosure.text}</p>
        <a
          href={v.disclosure.website}
          className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-emerald-800 px-5 py-2.5 text-base font-semibold text-white hover:bg-emerald-900"
          rel="noopener noreferrer"
        >
          Go to the State&apos;s claim website
        </a>
      </section>

      <Section title="What the State's list shows" id="property">
        <p>{v.propertySummary ? `The list shows ${v.propertySummary}.` : "The details are being confirmed."} {v.amountSentence}</p>
        <p className="text-sm text-slate-600">{v.privateCompany}</p>
      </Section>

      <Section title="Where things stand" id="status">
        <ol className="space-y-2">
          {v.steps.map((s) => (
            <li key={s.label} className="flex items-start gap-3">
              <span
                aria-hidden
                className={`mt-1 inline-block h-4 w-4 shrink-0 rounded-full border-2 ${s.state === "done" ? "border-emerald-700 bg-emerald-700" : s.state === "current" ? "border-emerald-700 bg-white" : "border-slate-300 bg-white"}`}
              />
              <span className={s.state === "todo" ? "text-slate-500" : ""}>
                {s.label}
                <span className="sr-only"> ({s.state === "done" ? "done" : s.state === "current" ? "now" : "later"})</span>
              </span>
            </li>
          ))}
        </ol>
      </Section>

      {v.agreements.length ? (
        <Section title="Your agreement" id="agreement">
          {v.agreements.map((a) => (
            <div key={a.id} className="space-y-3">
              {a.status === "SIGNED" ? (
                <p>
                  You signed the agreement on {a.signedAt}. Thank you.{" "}
                  {a.hasSignedCopy ? (
                    <a className="font-medium underline" href={`/api/portal/agreements/${a.id}?kind=signed`}>
                      Download your signed copy
                    </a>
                  ) : null}
                </p>
              ) : (
                <>
                  <p>
                    Here is the agreement for our help ({a.reference}). Please read it carefully. Signing is your choice — you can still claim the property
                    yourself for free.
                  </p>
                  <p>
                    <a className="font-medium underline" href={`/api/portal/agreements/${a.id}?kind=unsigned`}>
                      Read the agreement (PDF)
                    </a>
                  </p>
                  {a.method === "PAPER" ? (
                    <p>We are mailing you a paper copy to sign. Please sign it and mail it back in the envelope provided.</p>
                  ) : a.demoSigning ? (
                    <DemoSignForm agreementId={a.id} fullName={v.fullName} />
                  ) : (
                    <p>
                      We sent you an email from {a.esignVendor ?? "our e-signature service"} with a link to sign. If you can&apos;t find it, check your spam folder or
                      send us a message below. Prefer paper? Tell us and we will mail it to you.
                    </p>
                  )}
                </>
              )}
            </div>
          ))}
        </Section>
      ) : null}

      {v.claim ? (
        <Section title="Your claim" id="claim">
          {v.claim.status === "APPROVED" ? (
            <p>
              Your claim documents are ready. Next, the claim is filed with the State — you sign the State&apos;s claim form yourself (online at{" "}
              <a className="font-medium underline" href={v.claimSiteUrl} rel="noopener noreferrer">{v.claimSiteUrl.replace("https://", "")}</a>). We will walk you through it.
            </p>
          ) : v.claim.status === "FILED" ? (
            <p>Your claim was filed with the State on {v.claim.filedAt}{v.claim.claimNumber ? ` (claim ID ${v.claim.claimNumber})` : ""}. The State reviews it and pays you directly.</p>
          ) : v.claim.outcome === "APPROVED" ? (
            <p>Good news: the State approved your claim. The State pays you directly.</p>
          ) : v.claim.outcome === "MORE_INFO" ? (
            <p>The State asked for more information{v.claim.outcomeNote ? `: ${v.claim.outcomeNote}` : ""}. We will help you with it — you can upload documents below.</p>
          ) : (
            <p>The State did not approve the claim. We will contact you about what can be done.</p>
          )}
          <p>
            <a className="font-medium underline" href={`/api/portal/packets/${v.claim.packetId}`}>Download your claim documents (PDF)</a>
          </p>
        </Section>
      ) : null}

      {v.invoices.length ? (
        <Section title="Our fee" id="fee">
          {v.invoices.map((i) => (
            <div key={i.id} className="space-y-2">
              <p>
                The State paid you {i.paidToHeirCents != null ? formatExactUsd(i.paidToHeirCents) : "the claim"}. Our fee, as in your agreement, is{" "}
                {i.feeBps != null ? `${i.feeBps / 100}%` : "the agreed percentage"}: <strong>{formatExactUsd(i.amountCents)}</strong>.
              </p>
              {i.status === "PAID" ? (
                <p>Paid on {i.paidAt}. Thank you.</p>
              ) : i.demoPay ? (
                <DemoPayForm invoiceId={i.id} />
              ) : i.payUrl ? (
                <p>
                  <a className="font-medium underline" href={i.payUrl} rel="noopener noreferrer">Pay online</a> (due {i.dueDate}).
                </p>
              ) : (
                <p>We sent you an invoice by mail{i.dueDate ? `, due ${i.dueDate}` : ""}.</p>
              )}
            </div>
          ))}
        </Section>
      ) : null}

      <Section title="Documents for the claim" id="documents">
        <p>
          If you decide to go ahead — with or without us — the State will need some documents. You can send them to us here. They are stored encrypted and used
          only for this claim.
        </p>
        <p className="font-medium">We never need your Social Security number. If a document shows it, please cover it before you take the photo.</p>
        <ul className="list-disc space-y-1 pl-6">
          {v.checklist
            .filter((i) => i.key !== "other")
            .map((i) => (
              <li key={i.key}>
                {i.label}
                {i.condition ? <span className="text-slate-600"> — {i.condition}</span> : null}
              </li>
            ))}
        </ul>
        {v.documents.length ? (
          <div>
            <h3 className="mb-1 font-semibold">What you have sent</h3>
            <ul className="space-y-2">
              {v.documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2">
                  <span>
                    {v.checklist.find((i) => i.key === d.key)?.label ?? d.key}: {d.fileName}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-sm ${DOC_STATUS[d.status]?.cls ?? ""}`}>{DOC_STATUS[d.status]?.label ?? d.status}</span>
                  {d.note ? <span className="w-full text-sm text-amber-900">Note from us: {d.note}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <UploadForm items={uploadItems} />
      </Section>

      <Section title="Talk to us" id="contact">
        <p>
          {v.business ? (
            <>
              A real person — {v.business.contactName} — reads every message. You can also call {v.business.phone}, email {v.business.email}, or write to{" "}
              {formatPostalAddress(v.business.mailingAddress).join(", ")}.
            </>
          ) : (
            "A real person reads every message."
          )}
        </p>
        <MessageForm />
        <hr className="my-4 border-stone-200" />
        <h3 className="font-semibold">Would you like a call?</h3>
        {v.bookingUrl ? (
          <p>
            <a href={v.bookingUrl} className="font-medium underline" rel="noopener noreferrer">
              Pick a time that suits you
            </a>
            , or leave your number below.
          </p>
        ) : null}
        <CallForm />
        {!v.hasEmail ? (
          <>
            <hr className="my-4 border-stone-200" />
            <h3 className="font-semibold">Prefer email?</h3>
            <p>If you would like us to email you (for example, to send an agreement to sign electronically), add your email address.</p>
            <EmailForm />
          </>
        ) : (
          <p className="text-sm text-slate-600">We have your email address on file ({v.emailHint}).</p>
        )}
      </Section>

      <Section title="Don't want to hear from us?" id="stop">
        {v.optedOut ? <p>You asked us not to contact you, and we won&apos;t. You can still use this page if you change your mind.</p> : <StopContactForm />}
      </Section>

      <footer className="space-y-2 pt-2 text-sm text-slate-600">
        <p>{v.privateCompany}</p>
        <form action={signOutAction}>
          <button type="submit" className="underline">
            Sign out of this page
          </button>
        </form>
        <p>
          <Link href={v.disclosure.website} className="underline" rel="noopener noreferrer">
            {v.disclosure.programName}
          </Link>
        </p>
      </footer>
    </div>
  );
}
