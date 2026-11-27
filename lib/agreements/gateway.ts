/**
 * THE ONLY PLACE AN AGREEMENT LEAVES THE SYSTEM (compliance rule 7) and the
 * only module that talks to the e-signature provider.
 *
 * dispatchAgreement() sends one agreement, and only if it is APPROVED with an
 * approval for THIS agreement by a user who still holds approval:decide, the
 * hash recomputed from the stored PDF bytes + signer matches, and the
 * checklist re-run now has no red item. A database trigger
 * (20261126090000_phase5_agreements_portal) refuses APPROVED/SENT/SIGNED
 * without a matching approval and any change after approval.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { writeAudit } from "@/lib/audit";
import { can, ForbiddenError } from "@/lib/auth/permissions";
import { evaluateEligibility, transitionCase } from "@/lib/case/transitions";
import { prisma } from "@/lib/db";
import { dateInNevada, todayIn } from "@/lib/dates";
import type { Role } from "@/lib/generated/prisma/enums";
import { notifyCase } from "@/lib/notifications";
import { readFile, saveFile } from "@/lib/files/storage";
import { getBusinessProfile } from "@/lib/outreach/settings";
import { getESignProvider, MockESignProvider, type ESignEvent } from "@/adapters/esign";
import { advanceOnSigned, agreementHash, agreementReference, evaluateAgreement, signerOf, type AgreementActor } from "./service";

export class AgreementSendRefused extends Error {
  constructor(message: string) {
    super(`Not sent: ${message}`);
    this.name = "AgreementSendRefused";
  }
}

type Event = { at: string; type: string; detail?: string; eventId?: string };
const appendEvent = (events: unknown, e: Omit<Event, "at">): Event[] =>
  [...((Array.isArray(events) ? events : []) as Event[]), { at: new Date().toISOString(), ...e }].slice(-100);

const GATEWAY = { type: "SYSTEM" as const, id: "agreement-gateway" };

export async function dispatchAgreement(id: string): Promise<{ status: "SENT"; method: "ESIGN" | "PAPER" } | { status: "ALREADY_CLAIMED" } | { status: "FAILED"; reason: string }> {
  const a = await prisma.agreement.findUnique({ where: { id } });
  if (!a) throw new AgreementSendRefused("agreement not found.");
  if (a.status !== "APPROVED") throw new AgreementSendRefused(`status is ${a.status}, not APPROVED.`);
  if (!a.approvalId || !a.contentHash || !a.pdfFileKey) throw new AgreementSendRefused("there is no approval record.");
  const approval = await prisma.approval.findUnique({ where: { id: a.approvalId }, include: { approvedBy: { select: { role: true } } } });
  if (!approval || approval.subjectType !== "AGREEMENT" || approval.subjectId !== a.id) throw new AgreementSendRefused("the approval is for a different item.");
  if (approval.decision !== "APPROVED") throw new AgreementSendRefused("the agreement was not approved.");
  if (!can((approval.approvedBy.role ?? "VIEWER") as Role, "approval:decide")) throw new AgreementSendRefused("the approver is not allowed to approve agreements.");
  const file = await readFile(a.pdfFileKey);
  const signer = signerOf(a);
  if (!file || approval.contentHash !== a.contentHash || agreementHash(file.meta.sha256, signer) !== a.contentHash) {
    throw new AgreementSendRefused("the PDF does not match what was approved.");
  }
  const failing = (await evaluateAgreement(prisma, a)).filter((i) => i.status === "fail");
  if (failing.length) {
    const reason = failing.map((i) => `${i.label}: ${i.detail}`).join(" ");
    await prisma.agreement.update({ where: { id }, data: { events: appendEvent(a.events, { type: "blocked_at_send", detail: reason.slice(0, 500) }) as never } });
    await writeAudit(prisma, { actor: GATEWAY, action: "agreement.blocked_at_send", entityType: "Agreement", entityId: id, reason: reason.slice(0, 1000) });
    return { status: "FAILED", reason };
  }

  // Claim: one dispatcher only (envelope id doubles as a lock while sending).
  const lock = `pending:${randomUUID()}`;
  const claimed = await prisma.agreement.updateMany({ where: { id, status: "APPROVED", esignEnvelopeId: null }, data: { esignEnvelopeId: lock } });
  if (claimed.count !== 1) return { status: "ALREADY_CLAIMED" };

  const method = a.signatureMethod === "ESIGN" ? "ESIGN" : "PAPER";
  try {
    let envelope: string;
    let provider: string;
    let detail: string;
    if (method === "ESIGN") {
      const esign = getESignProvider();
      if (!esign) throw new Error("No e-signature service is configured.");
      if (!signer.email) throw new Error("The signer has no email address.");
      const business = await getBusinessProfile();
      const ref = agreementReference(a);
      const r = await esign.send({
        agreementId: a.id,
        title: `Recovery agreement ${ref}`,
        subject: `Please review: recovery agreement from ${business?.legalName ?? "us"}`,
        message:
          `Here is the agreement we discussed. Please read it carefully. You can still claim the property yourself, for free, from the Nevada State Treasurer — see section 3. ` +
          `Questions? Call ${business?.contactName ?? "us"} at ${business?.phone ?? ""}.`,
        signer: { name: signer.name, email: signer.email },
        pdf: file.bytes,
        fileName: file.meta.fileName,
      });
      envelope = r.requestId;
      provider = esign.id;
      detail = r.detail;
    } else {
      envelope = `paper:${a.id}`;
      provider = "paper";
      detail = "Approved for paper signature: print, mail, and record the signed copy when it comes back.";
    }
    await prisma.agreement.update({
      where: { id },
      data: { status: "SENT", sentAt: new Date(), esignProvider: provider, esignEnvelopeId: envelope, events: appendEvent(a.events, { type: "sent", detail }) as never },
    });
    await writeAudit(prisma, {
      actor: GATEWAY,
      action: "agreement.sent",
      entityType: "Agreement",
      entityId: id,
      after: { caseId: a.caseId, approvalId: approval.id, approvedById: approval.approvedById, contentHash: a.contentHash, method, provider, envelope },
    });
    const c = await prisma.case.findUniqueOrThrow({ where: { id: a.caseId }, select: { stage: true } });
    if (c.stage === "RESPONDED") {
      await transitionCase({ caseId: a.caseId, to: "AGREEMENT_SENT", actor: GATEWAY, reason: "Approved agreement sent." }).catch(async (e) => {
        await notifyCase(prisma, { caseId: a.caseId, kind: "SYSTEM", title: "Agreement sent, but the case could not move to Agreement sent", body: e instanceof Error ? e.message.slice(0, 300) : String(e) });
      });
    }
    return { status: "SENT", method };
  } catch (e) {
    const detail = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await prisma.agreement.update({ where: { id }, data: { esignEnvelopeId: null, events: appendEvent(a.events, { type: "send_failed", detail }) as never } });
    await writeAudit(prisma, { actor: GATEWAY, action: "agreement.send_failed", entityType: "Agreement", entityId: id, reason: detail });
    await notifyCase(prisma, { caseId: a.caseId, kind: "SEND_FAILED", title: "Agreement failed to send", body: detail.slice(0, 300) });
    return { status: "FAILED", reason: detail };
  }
}

/** Cancel an agreement that is not signed (and withdraw the e-sign request). */
export async function cancelAgreement(actor: AgreementActor, id: string, reason: string) {
  if (!can(actor.role, "case:write")) throw new ForbiddenError("Your role cannot cancel agreements.");
  const a = await prisma.agreement.findUniqueOrThrow({ where: { id } });
  if (!["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT"].includes(a.status)) throw new AgreementSendRefused("only unsigned agreements can be cancelled.");
  if (a.status === "SENT" && a.esignProvider && a.esignProvider !== "paper" && a.esignEnvelopeId) {
    const esign = getESignProvider();
    if (esign) await esign.cancel(a.esignEnvelopeId);
  }
  await prisma.agreement.update({ where: { id }, data: { status: "CANCELLED", statusReason: reason.slice(0, 300), events: appendEvent(a.events, { type: "cancelled", detail: reason.slice(0, 300) }) as never } });
  await writeAudit(prisma, { actor: { type: "USER", id: actor.id, role: actor.role }, action: "agreement.cancelled", entityType: "Agreement", entityId: id, reason });
}

/**
 * Apply a verified e-sign event (webhook or the demo signer). Idempotent per
 * event id; status only moves forward. On completion the signed PDF is fetched
 * and stored encrypted.
 */
export async function applyESignEvent(ev: ESignEvent): Promise<{ handled: boolean; duplicate?: boolean }> {
  const a = await prisma.agreement.findFirst({ where: { esignEnvelopeId: ev.requestId } });
  if (!a) return { handled: false };
  const events = (Array.isArray(a.events) ? a.events : []) as Event[];
  if (events.some((e) => e.eventId === ev.eventId)) return { handled: true, duplicate: true };
  const withEvent = appendEvent(a.events, { type: ev.type.toLowerCase(), detail: ev.detail, eventId: ev.eventId });

  if ((ev.type === "ALL_SIGNED" || ev.type === "DOWNLOADABLE") && a.status === "SENT") {
    const signedOn = dateInNevada(ev.occurredAt); // the void period is counted in Nevada days
    const { eligibility } = await evaluateEligibility(prisma, a.caseId, todayIn());
    if (eligibility.status !== "ELIGIBLE" || signedOn < eligibility.eligibleContractDate) {
      // Cannot happen if sending was gated, but never treat a void signature as valid.
      await prisma.agreement.update({ where: { id: a.id }, data: { status: "VOIDED", statusReason: "Signed before the end of the 24-month period (NRS 120A.740).", events: withEvent as never } });
      await notifyCase(prisma, { caseId: a.caseId, kind: "SYSTEM", title: "A signature arrived during the void period — agreement voided" });
      return { handled: true };
    }
    let signedFileKey: string | null = null;
    try {
      const esign = getESignProvider();
      if (esign) {
        const bytes = await esign.downloadSigned(ev.requestId);
        const f = await saveFile(prisma, { caseId: a.caseId, kind: "AGREEMENT_SIGNED", fileName: `${agreementReference(a)} Signed Recovery Agreement.pdf`, contentType: "application/pdf", bytes, uploadedBy: `SYSTEM:${esign.id}` });
        signedFileKey = f.id;
      }
    } catch (e) {
      withEvent.push({ at: new Date().toISOString(), type: "signed_copy_download_failed", detail: e instanceof Error ? e.message.slice(0, 300) : String(e) });
    }
    await prisma.agreement.update({ where: { id: a.id }, data: { status: "SIGNED", signedAt: ev.occurredAt, signedFileKey, events: withEvent as never } });
    await writeAudit(prisma, { actor: { type: "SYSTEM", id: "esign-webhook" }, action: "agreement.signed", entityType: "Agreement", entityId: a.id, after: { requestId: ev.requestId, signedAt: ev.occurredAt.toISOString(), signedFileKey } });
    await advanceOnSigned(a.caseId);
    return { handled: true };
  }
  if (ev.type === "DECLINED" && a.status === "SENT") {
    await prisma.agreement.update({ where: { id: a.id }, data: { status: "DECLINED", statusReason: "Declined by the signer.", events: withEvent as never } });
    await writeAudit(prisma, { actor: { type: "SYSTEM", id: "esign-webhook" }, action: "agreement.declined", entityType: "Agreement", entityId: a.id });
    await notifyCase(prisma, { caseId: a.caseId, kind: "AGREEMENT_DECLINED", title: "The heir declined the agreement" });
    return { handled: true };
  }
  if (ev.type === "BOUNCED") {
    await notifyCase(prisma, { caseId: a.caseId, kind: "SEND_FAILED", title: "The e-signature email bounced", body: "Check the heir's email address, or switch to paper." });
  }
  await prisma.agreement.update({ where: { id: a.id }, data: { events: withEvent as never } });
  return { handled: true };
}

/** DEMO ONLY (MOCK_MODE): the heir "signs" in the portal, standing in for the e-sign vendor's page. */
export async function simulateMockSignature(agreementId: string, personId: string): Promise<void> {
  if ((process.env.MOCK_MODE ?? "true") === "false") throw new ForbiddenError("Demo signing is only available in mock mode.");
  const a = await prisma.agreement.findUniqueOrThrow({ where: { id: agreementId } });
  if (a.personId !== personId || a.status !== "SENT" || a.esignProvider !== "mock-esign" || !a.esignEnvelopeId) {
    throw new AgreementSendRefused("this agreement is not waiting for your signature.");
  }
  const now = new Date();
  MockESignProvider.markSigned(a.esignEnvelopeId, now);
  await applyESignEvent({ eventId: `mock-${a.id}-signed`, type: "ALL_SIGNED", requestId: a.esignEnvelopeId, occurredAt: now, detail: "Signed in the demo portal" });
}
