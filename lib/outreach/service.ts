/**
 * Outreach drafts and decisions (spec 5.6). Flow:
 *
 *   createDraft ─▶ PENDING_APPROVAL ─(OWNER approves exact content)─▶ APPROVED
 *        │                 │ edit note → re-render + re-check              │
 *        │                 └─(reject)─▶ REJECTED                           ▼
 *        │                                                lib/outreach/gateway.ts
 *        └ AI personal note + tone check + lint + checklist        (the ONLY sender)
 *
 * Nothing in this file sends anything. Approval records who approved, when,
 * the exact content (hash + snapshot) and the checklist at that moment (rule 7).
 */
import "server-only";
import { writeAudit, type Actor as AuditActor } from "@/lib/audit";
import { can, ForbiddenError } from "@/lib/auth/permissions";
import { decideAiRun } from "@/lib/ai/acceptance";
import { aiMockMode, runPrompt } from "@/lib/ai/run";
import { evaluateEligibility, transitionCase } from "@/lib/case/transitions";
import { decryptPii, encryptPii } from "@/lib/crypto/pii";
import { prisma, type DbClient } from "@/lib/db";
import { dateInNevada, formatNevadaDate, toDateOnly, todayIn } from "@/lib/dates";
import { caseRef } from "@/lib/format";
import type { CommunicationChannel, Role } from "@/lib/generated/prisma/enums";
import { notifyCase } from "@/lib/notifications";
import { normalizeAddress } from "@/lib/normalize/address";
import { feeCapBpsForCase } from "@/lib/rules/engine";
import { getActiveRule } from "@/lib/rules/repository";
import { emailProviderStatus } from "@/adapters/email/status";
import { mailProviderStatus } from "@/adapters/mail/status";
import {
  deceasedWasRecipients,
  mockPersonalization,
  mockToneCheck,
  PersonalizationOutput,
  ToneCheckOutput,
  type PersonalizationInput,
  type ToneCheckInput,
} from "./ai";
import { buildChecklist, checklistPasses, type ChecklistFacts, type ChecklistItem } from "./checklist";
import { amountStatement, feeSentence, formatLetterDate, privateCompanyStatement, propertySummary } from "./content";
import { addDoNotContact, addressHashOf, checkDoNotContact, emailHashOf } from "./dnc";
import { lintOutreach, readability } from "./lint";
import { contentHashOf, htmlToText, renderMessage, type Recipient } from "./render";
import { formatPostalAddress, getBusinessProfile, getOutreachSettings, publicAppUrl, type BusinessProfile } from "./settings";
import { FAQ_INSERT_ID, getTemplate, templateFor, type TemplateVariable } from "./templates";
import { newOptOutToken } from "./util";
import { ensurePortalAccess } from "@/lib/portal/access";

export class OutreachError extends Error {}

export type OutreachActor = { id: string; role: Role };

const PENDING_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED"] as const;
const DONE_STATUSES = ["SENT", "DELIVERED", "RETURNED"] as const;

function audit(actor: OutreachActor | "system"): AuditActor {
  return actor === "system" ? { type: "SYSTEM", id: "outreach" } : { type: "USER", id: actor.id, role: actor.role };
}

function requireDraftRights(actor: OutreachActor) {
  if (!can(actor.role, "case:write")) throw new ForbiddenError("Your role cannot prepare outreach.");
}

// ─── Recipients ─────────────────────────────────────────────────────────────

export function encryptRecipient(r: Recipient): string {
  return encryptPii(JSON.stringify(r));
}

export function decryptRecipient(enc: string | null): Recipient | null {
  if (!enc) return null;
  return JSON.parse(decryptPii(enc)) as Recipient;
}

type PersonForRecipient = { fullName: string; mailingAddressEnc: string | null; emailEnc: string | null };

/** The recipient snapshot for a channel, or a readable problem. */
export function recipientFor(person: PersonForRecipient, channel: "MAIL" | "EMAIL"): { recipient: Recipient | null; problem: string | null } {
  if (channel === "EMAIL") {
    const email = person.emailEnc ? decryptPii(person.emailEnc) : null;
    if (!email) return { recipient: null, problem: "No email address on file for this person." };
    return { recipient: { kind: "EMAIL", name: person.fullName, email }, problem: null };
  }
  const raw = person.mailingAddressEnc ? decryptPii(person.mailingAddressEnc) : null;
  if (!raw) return { recipient: null, problem: "No mailing address on file for this person." };
  const a = normalizeAddress({ kind: "single", value: raw });
  if (!a.line1 || !a.city || !a.state || !a.zip5) {
    return { recipient: null, problem: "The address could not be split into street, city, state and ZIP. Edit it as \"street, city, ST 12345\"." };
  }
  return {
    recipient: {
      kind: "MAIL",
      name: person.fullName,
      address: { line1: a.line1, line2: a.line2 ?? "", city: a.city, state: a.state, zip: a.zip4 ? `${a.zip5}-${a.zip4}` : a.zip5 },
    },
    problem: null,
  };
}

// ─── Draft composition ──────────────────────────────────────────────────────

type DraftMeta = {
  quotedFeeBps: number;
  letterDate: string;
  personalizationRunId: string | null;
  disclosureRuleVersion: number;
};

type StoredChecklist = { meta: DraftMeta; items: ChecklistItem[]; evaluatedAt: string };
type StoredTone = { contentHash: string; aiRunId: string; output: ToneCheckOutput };

async function loadCaseFacts(db: DbClient, caseId: string, today: Date) {
  const c = await db.case.findUniqueOrThrow({
    where: { id: caseId },
    include: {
      owner: true,
      properties: { select: { category: true, holderName: true, reportedAmountCents: true, amountIsMinimum: true, dateDeliveredToState: true } },
    },
  });
  const [disclosure, feeRule, waitingRule] = await Promise.all([
    getActiveRule(db, c.stateCode, "DISCLOSURE_TEXT", today),
    getActiveRule(db, c.stateCode, "FEE_CAP", today),
    getActiveRule(db, c.stateCode, "WAITING_PERIOD", today),
  ]);
  return { c, disclosure, feeRule, waitingRule, feeCapBps: feeCapBpsForCase(c.properties, today, feeRule.params) };
}

function buildVars(input: {
  c: Awaited<ReturnType<typeof loadCaseFacts>>["c"];
  disclosureText: string;
  claimWebsite: string;
  business: BusinessProfile;
  heirName: string;
  personalNote: string;
  quotedFeeBps: number;
  optOutToken: string;
  portalUrl: string;
  firstLetterDate: string;
}): Record<TemplateVariable, string> {
  const { c, business } = input;
  return {
    heirName: input.heirName,
    ownerName: c.owner.fullName,
    personalNote: input.personalNote,
    propertySummary: propertySummary(c.properties),
    amountSentence: amountStatement(c.properties).sentence,
    feeSentence: feeSentence(input.quotedFeeBps),
    disclosure: input.disclosureText,
    privateCompany: privateCompanyStatement(c.stateCode),
    claimWebsite: input.claimWebsite,
    contactName: business.contactName,
    contactTitleLine: business.contactTitle ? `, ${business.contactTitle}` : "",
    businessName: business.legalName,
    businessPhone: business.phone,
    businessEmail: business.email,
    caseRef: caseRef(c.caseNumber, c.stateCode),
    optOutUrl: `${publicAppUrl()}/u/${input.optOutToken}`,
    portalUrl: input.portalUrl,
    firstLetterDate: input.firstLetterDate,
  };
}

/** Tone check on the text with names replaced — the classifier doesn't need them. */
async function runToneCheck(db: DbClient, args: { caseId: string; commId: string; channel: "MAIL" | "EMAIL"; subject: string | null; text: string; required: string[]; names: string[] }) {
  let text = args.text;
  let subject = args.subject;
  for (const n of args.names.filter(Boolean)) {
    text = text.split(n).join("[NAME]");
    subject = subject?.split(n).join("[NAME]") ?? null;
  }
  const input: ToneCheckInput = { channel: args.channel, subject, text, requiredStatements: args.required };
  const run = await runPrompt({
    promptName: "outreach-tone-check",
    schema: ToneCheckOutput,
    input,
    mock: mockToneCheck,
    caseId: args.caseId,
    entityType: "Communication",
    entityId: args.commId,
    db,
  });
  // A classifier result, not a suggestion to accept.
  await db.aiRun.update({ where: { id: run.runId }, data: { acceptance: "NOT_APPLICABLE" } });
  return run;
}

type ComposeArgs = {
  caseId: string;
  personId: string;
  channel: "MAIL" | "EMAIL";
  step: number;
  personalNote: string | null; // null → ask the AI
  existing?: { id: string; optOutToken: string; quotedFeeBps: number; letterDate: string; personalizationRunId: string | null };
  scheduledFor?: Date | null;
  createdById: string | null;
};

async function compose(db: DbClient, args: ComposeArgs) {
  const today = todayIn();
  const [{ c, disclosure, feeCapBps }, person, business, settings] = await Promise.all([
    loadCaseFacts(db, args.caseId, today),
    db.person.findUniqueOrThrow({ where: { id: args.personId } }),
    getBusinessProfile(db),
    getOutreachSettings(db),
  ]);
  if (person.caseId !== args.caseId) throw new OutreachError("That person is not part of this case.");
  if (!business) throw new OutreachError("Fill in the business profile in Settings before drafting outreach (letters must say who you are and how to reach you).");
  if (c.properties.length === 0) throw new OutreachError("This case has no properties to describe.");
  const { recipient, problem } = recipientFor(person, args.channel);
  if (!recipient) throw new OutreachError(problem!);

  let firstLetterDate = "";
  if (args.step > 1) {
    const first = await db.communication.findFirst({
      where: { caseId: args.caseId, personId: args.personId, channel: args.channel, direction: "OUTBOUND", sequenceStep: 1, status: { in: [...DONE_STATUSES] } },
      orderBy: { sentAt: "asc" },
    });
    if (!first?.sentAt) throw new OutreachError("A follow-up needs a first letter that was sent.");
    firstLetterDate = formatLetterDate(dateInNevada(first.sentAt));
  }

  const quotedFeeBps = args.existing?.quotedFeeBps ?? Math.min(settings.feeBps, feeCapBps ?? settings.feeBps);
  const scheduled = args.scheduledFor ? toDateOnly(args.scheduledFor) : null;
  const letterDate = args.existing?.letterDate ?? formatLetterDate(scheduled && scheduled > today ? scheduled : today);
  const optOutToken = args.existing?.optOutToken ?? newOptOutToken();
  const commId = args.existing?.id;

  let personalNote = args.personalNote;
  let personalizationRunId = args.existing?.personalizationRunId ?? null;
  if (personalNote === null) {
    const input: PersonalizationInput = {
      ownerName: c.owner.fullName,
      deceasedWasRecipients: deceasedWasRecipients(person.relationship),
      ownerDeathYear: c.owner.dateOfDeath ? c.owner.dateOfDeath.getUTCFullYear() : null,
      step: args.step,
      channel: args.channel,
    };
    const run = await runPrompt({
      promptName: "outreach-personalization",
      schema: PersonalizationOutput,
      input,
      mock: mockPersonalization,
      caseId: args.caseId,
      entityType: "Person",
      entityId: person.id,
      db,
    });
    personalNote = run.output.personalNote.trim();
    personalizationRunId = run.runId;
  }

  const template = templateFor(args.channel, args.step);
  const portal = await ensurePortalAccess(db, { caseId: args.caseId, personId: args.personId, createdById: args.createdById });
  const vars = buildVars({
    c,
    disclosureText: disclosure.params.text,
    claimWebsite: disclosure.params.claimWebsite,
    business,
    heirName: person.fullName,
    personalNote: personalNote.slice(0, 600),
    quotedFeeBps,
    optOutToken,
    portalUrl: portal.url,
    firstLetterDate,
  });
  const rendered = renderMessage({
    template,
    faqInsert: template.includesFaqInsert ? getTemplate(FAQ_INSERT_ID) : null,
    vars,
    business,
    recipient,
    letterDate,
  });
  const contentHash = contentHashOf({ channel: args.channel, recipient, ...rendered });
  return {
    c,
    person,
    template,
    recipient,
    rendered,
    contentHash,
    personalNote,
    personalizationRunId,
    optOutToken,
    meta: { quotedFeeBps, letterDate, personalizationRunId, disclosureRuleVersion: disclosure.version } satisfies DraftMeta,
    required: [disclosure.params.text, vars.privateCompany],
    commId,
  };
}

async function persistChecks(db: DbClient, commId: string) {
  const comm = await db.communication.findUniqueOrThrow({ where: { id: commId } });
  const { items } = await evaluateCommunication(db, comm);
  const stored = comm.checklist as StoredChecklist | null;
  await db.communication.update({
    where: { id: commId },
    data: { checklist: { meta: stored!.meta, items, evaluatedAt: new Date().toISOString() } as never },
  });
  return items;
}

/** Create a first-contact draft (step 1) for one heir on one channel. */
export async function createDraft(actor: OutreachActor, input: { caseId: string; personId: string; channel: "MAIL" | "EMAIL" }) {
  requireDraftRights(actor);
  return createDraftInternal({ ...input, step: 1, actor });
}

async function createDraftInternal(input: { caseId: string; personId: string; channel: "MAIL" | "EMAIL"; step: number; actor: OutreachActor | "system"; scheduledFor?: Date | null }) {
  const today = todayIn();
  const { eligibility } = await evaluateEligibility(prisma, input.caseId, today);
  if (eligibility.status === "WAITING") {
    throw new OutreachError(`NRS 120A.740: no outreach until ${eligibility.eligibleContractDate.toISOString().slice(0, 10)} (${eligibility.daysRemaining} days).`);
  }
  const person = await prisma.person.findUniqueOrThrow({ where: { id: input.personId } });
  if (person.doNotContact) throw new OutreachError("This person asked not to be contacted.");
  if (person.status === "REJECTED" || person.isPredeceased) throw new OutreachError("This person is not a living heir candidate.");
  const { recipient, problem } = recipientFor(person, input.channel);
  if (!recipient) throw new OutreachError(problem!);
  const dnc = await checkDoNotContact(prisma, {
    normalizedName: person.normalizedName,
    emailHash: recipient.kind === "EMAIL" ? emailHashOf(recipient.email) : null,
    addressHash: recipient.kind === "MAIL" ? addressHashOf(recipient.address) : null,
  });
  if (dnc.blocked) throw new OutreachError(dnc.reason!);
  const dup = await prisma.communication.findFirst({
    where: {
      caseId: input.caseId,
      personId: input.personId,
      channel: input.channel,
      direction: "OUTBOUND",
      sequenceStep: input.step,
      status: { in: [...PENDING_STATUSES, "QUEUED", ...DONE_STATUSES] },
    },
    select: { id: true, status: true },
  });
  if (dup) throw new OutreachError(`There is already a ${input.channel === "MAIL" ? "letter" : "email"} for this step (${dup.status.toLowerCase().replace(/_/g, " ")}).`);

  const draft = await compose(prisma, {
    caseId: input.caseId,
    personId: input.personId,
    channel: input.channel,
    step: input.step,
    personalNote: null,
    scheduledFor: input.scheduledFor ?? null,
    createdById: input.actor === "system" ? null : input.actor.id,
  });
  const comm = await prisma.communication.create({
    data: {
      caseId: input.caseId,
      personId: input.personId,
      channel: input.channel as CommunicationChannel,
      direction: "OUTBOUND",
      status: "PENDING_APPROVAL",
      templateId: draft.template.id,
      templateVersion: draft.template.version,
      sequenceStep: input.step,
      subject: draft.rendered.subject,
      renderedContent: draft.rendered.html,
      textContent: draft.rendered.text,
      recipientEnc: encryptRecipient(draft.recipient),
      personalNote: draft.personalNote,
      personalizationRunId: draft.personalizationRunId,
      optOutToken: draft.optOutToken,
      contentHash: draft.contentHash,
      scheduledFor: input.scheduledFor ?? null,
      checklist: { meta: draft.meta, items: [], evaluatedAt: new Date().toISOString() } as never,
      createdById: input.actor === "system" ? null : input.actor.id,
    },
  });
  const tone = await runToneCheck(prisma, {
    caseId: input.caseId,
    commId: comm.id,
    channel: input.channel,
    subject: draft.rendered.subject,
    text: draft.rendered.text,
    required: draft.required,
    names: [draft.person.fullName, draft.c.owner.fullName],
  });
  await prisma.communication.update({
    where: { id: comm.id },
    data: { toneCheck: { contentHash: draft.contentHash, aiRunId: tone.runId, output: tone.output } satisfies StoredTone as never },
  });
  const items = await persistChecks(prisma, comm.id);
  await writeAudit(prisma, {
    actor: audit(input.actor),
    action: "communication.drafted",
    entityType: "Communication",
    entityId: comm.id,
    after: {
      caseId: input.caseId,
      personId: input.personId,
      channel: input.channel,
      step: input.step,
      template: `${draft.template.id}@${draft.template.version}`,
      contentHash: draft.contentHash,
      checklistPasses: checklistPasses(items),
    },
  });
  await notifyCase(prisma, {
    caseId: input.caseId,
    kind: input.step === 1 ? "APPROVAL_NEEDED" : "FOLLOW_UP_READY",
    title: `${input.step === 1 ? "Outreach" : "Follow-up"} ${input.channel === "MAIL" ? "letter" : "email"} waiting for approval`,
    body: `${caseRef(draft.c.caseNumber, draft.c.stateCode)} — to ${draft.person.fullName}`,
  });
  return comm;
}

/** Follow-up drafts (day 21 / day 45) are created by the scheduler — each still needs an approval. */
export async function createFollowUpDraft(input: { caseId: string; personId: string; channel: "MAIL" | "EMAIL"; step: number; scheduledFor: Date }) {
  return createDraftInternal({ ...input, actor: "system" });
}

/** Edit the personal note of a pending draft. Content changes → new hash, new tone check, new checklist. */
export async function updateDraftNote(actor: OutreachActor, commId: string, personalNote: string) {
  requireDraftRights(actor);
  const note = personalNote.replace(/\s+/g, " ").trim();
  if (note.length > 600) throw new OutreachError("Keep the personal note under 600 characters.");
  const comm = await prisma.communication.findUniqueOrThrow({ where: { id: commId } });
  if (comm.status !== "PENDING_APPROVAL" && comm.status !== "DRAFT") throw new OutreachError("Only drafts waiting for approval can be edited.");
  if (!comm.personId || (comm.channel !== "MAIL" && comm.channel !== "EMAIL")) throw new OutreachError("This message cannot be edited.");
  const meta = (comm.checklist as StoredChecklist).meta;
  const draft = await compose(prisma, {
    caseId: comm.caseId,
    personId: comm.personId,
    channel: comm.channel,
    step: comm.sequenceStep ?? 1,
    personalNote: note,
    existing: { id: comm.id, optOutToken: comm.optOutToken!, quotedFeeBps: meta.quotedFeeBps, letterDate: meta.letterDate, personalizationRunId: comm.personalizationRunId },
    createdById: actor.id,
  });
  const tone = await runToneCheck(prisma, {
    caseId: comm.caseId,
    commId: comm.id,
    channel: comm.channel,
    subject: draft.rendered.subject,
    text: draft.rendered.text,
    required: draft.required,
    names: [draft.person.fullName, draft.c.owner.fullName],
  });
  await prisma.communication.update({
    where: { id: comm.id },
    data: {
      subject: draft.rendered.subject,
      renderedContent: draft.rendered.html,
      textContent: draft.rendered.text,
      recipientEnc: encryptRecipient(draft.recipient),
      personalNote: note,
      contentHash: draft.contentHash,
      toneCheck: { contentHash: draft.contentHash, aiRunId: tone.runId, output: tone.output } satisfies StoredTone as never,
    },
  });
  await persistChecks(prisma, comm.id);
  await writeAudit(prisma, {
    actor: audit(actor),
    action: "communication.edited",
    entityType: "Communication",
    entityId: comm.id,
    before: { contentHash: comm.contentHash },
    after: { contentHash: draft.contentHash, field: "personalNote" },
  });
}

// ─── Evaluation (checklist facts) ───────────────────────────────────────────

type CommRow = Awaited<ReturnType<typeof prisma.communication.findUniqueOrThrow>>;

/** Recompute every checklist item for a communication from current facts. */
export async function evaluateCommunication(db: DbClient, comm: CommRow): Promise<{ items: ChecklistItem[]; recipient: Recipient | null }> {
  if (comm.direction !== "OUTBOUND" || (comm.channel !== "MAIL" && comm.channel !== "EMAIL") || !comm.personId) {
    throw new OutreachError("Only outbound letters and emails have a compliance checklist.");
  }
  const today = todayIn();
  const step = comm.sequenceStep ?? 1;
  const stored = comm.checklist as StoredChecklist | null;
  const meta = stored?.meta ?? null;
  const [{ c, disclosure, feeRule, waitingRule, feeCapBps }, { eligibility }, person, business, settings] = await Promise.all([
    loadCaseFacts(db, comm.caseId, today),
    evaluateEligibility(db, comm.caseId, today),
    db.person.findUniqueOrThrow({ where: { id: comm.personId } }),
    getBusinessProfile(db),
    getOutreachSettings(db),
  ]);
  const recipient = decryptRecipient(comm.recipientEnc);
  const current = recipientFor(person, comm.channel);
  const html = comm.renderedContent ?? "";
  const text = comm.textContent ?? "";
  const htmlText = htmlToText(html).replace(/\s+/g, " ");
  const flatText = text.replace(/\s+/g, " ");
  const disclosureText = disclosure.params.text;
  const privateCompany = privateCompanyStatement(c.stateCode);
  const required = [disclosureText, privateCompany];
  const body = text.split("\n\n---\n")[0] ?? text;

  // Recipient: the snapshot must still match the person's current contact details.
  let recipientProblem: string | null = null;
  if (!recipient) recipientProblem = "No recipient recorded.";
  else if (!current.recipient) recipientProblem = current.problem;
  else if (JSON.stringify(current.recipient) !== JSON.stringify(recipient)) recipientProblem = "The heir's contact details changed after this draft was made. Cancel it and draft again.";

  const dnc = person.doNotContact
    ? { blocked: true, reason: "This person asked not to be contacted." }
    : await checkDoNotContact(db, {
        normalizedName: person.normalizedName,
        emailHash: recipient?.kind === "EMAIL" ? emailHashOf(recipient.email) : null,
        addressHash: recipient?.kind === "MAIL" ? addressHashOf(recipient.address) : null,
      });

  // Sequence rules.
  let sequence = { ok: true, detail: "OK." };
  if (step === 1) {
    const other = await db.communication.findFirst({
      where: {
        id: { not: comm.id },
        caseId: comm.caseId,
        personId: comm.personId,
        channel: comm.channel,
        direction: "OUTBOUND",
        sequenceStep: 1,
        status: { in: [...PENDING_STATUSES, "QUEUED", ...DONE_STATUSES] },
      },
      select: { status: true },
    });
    if (other) sequence = { ok: false, detail: `Another first ${comm.channel === "MAIL" ? "letter" : "email"} to this person exists (${other.status.toLowerCase()}).` };
    else sequence = { ok: true, detail: "This is the first contact on this channel." };
  } else {
    const prev = await db.communication.findFirst({
      where: { caseId: comm.caseId, personId: comm.personId, channel: comm.channel, direction: "OUTBOUND", sequenceStep: step - 1, status: { in: [...DONE_STATUSES] } },
      orderBy: { sentAt: "desc" },
    });
    const first = await db.communication.findFirst({
      where: { caseId: comm.caseId, personId: comm.personId, channel: comm.channel, direction: "OUTBOUND", sequenceStep: 1, status: { in: [...DONE_STATUSES] } },
      orderBy: { sentAt: "asc" },
    });
    const replies = first?.sentAt ? await db.communication.count({ where: { caseId: comm.caseId, direction: "INBOUND", createdAt: { gte: first.sentAt } } }) : 0;
    if (!prev) sequence = { ok: false, detail: `Step ${step - 1} was not sent.` };
    else if (replies > 0) sequence = { ok: false, detail: "Someone replied on this case — follow-ups stop." };
    else if (prev.status === "RETURNED") sequence = { ok: false, detail: "The previous letter was returned as undeliverable." };
    else sequence = { ok: true, detail: `Step ${step - 1} sent ${formatNevadaDate(prev.sentAt)}; no reply yet.` };
  }

  const counselApproval = settings.counselApproval;
  const neededTemplates = [comm.templateId ?? "", ...(comm.templateId && getTemplateSafe(comm.templateId)?.includesFaqInsert ? [FAQ_INSERT_ID] : [])];
  const counselOk = Boolean(
    counselApproval && comm.templateId && neededTemplates.every((id) => counselApproval.templateVersions[id] === (id === comm.templateId ? comm.templateVersion : getTemplateSafe(id)?.version)),
  );
  const providerStatus = comm.channel === "MAIL" ? mailProviderStatus() : emailProviderStatus();
  const postalLine = business ? formatPostalAddress(business.mailingAddress).join(", ") : null;
  const tone = comm.toneCheck as StoredTone | null;
  const unverified = [waitingRule, feeRule, disclosure].filter((r) => !r.verified).map((r) => r.ruleType);

  const facts: ChecklistFacts = {
    channel: comm.channel,
    step,
    mockMode: aiMockMode(),
    caseStage: c.stage,
    eligibility,
    unverifiedRules: unverified,
    disclosure: { text: disclosureText, inHtml: htmlText.includes(disclosureText), inText: flatText.includes(disclosureText) },
    privateCompany: { inHtml: htmlText.includes(privateCompany), inText: flatText.includes(privateCompany) },
    fee: {
      quotedBps: meta && flatText.includes(feeSentence(meta.quotedFeeBps)) ? meta.quotedFeeBps : null,
      capBps: feeCapBps,
    },
    lint: lintOutreach(`${comm.subject ?? ""}\n${text}`, { requiredStatements: required, allowedAmountsCents: amountStatement(c.properties).allowedAmountsCents }),
    readability: readability(body, required),
    bodyWords: (body.match(/\S+/g) ?? []).length,
    tone: { output: tone?.output ?? null, forCurrentContent: Boolean(tone && tone.contentHash === comm.contentHash) },
    recipient: { problem: recipientProblem, heirRejected: person.status === "REJECTED", heirPredeceased: person.isPredeceased },
    doNotContact: { blocked: dnc.blocked, reason: dnc.reason },
    businessProfileComplete: Boolean(business),
    emailFooter:
      comm.channel === "EMAIL"
        ? { hasOptOutLink: Boolean(comm.optOutToken && html.includes(`/u/${comm.optOutToken}`) && text.includes(`/u/${comm.optOutToken}`)), hasPostalAddress: Boolean(postalLine && flatText.includes(postalLine)) }
        : null,
    counsel: {
      approved: counselOk,
      detail: counselOk
        ? `Approved by ${counselApproval!.approvedBy} on ${counselApproval!.approvedOn}.`
        : aiMockMode()
          ? "Not yet recorded — fine for demo mode; real sending is blocked until counsel approves these template versions (Settings)."
          : "Counsel has not approved this template version (Settings). Real sending is blocked.",
    },
    providerConfigured: providerStatus,
    sequence,
  };
  return { items: buildChecklist(facts), recipient };
}

function getTemplateSafe(id: string) {
  try {
    return getTemplate(id);
  } catch {
    return null;
  }
}

// ─── Decisions ──────────────────────────────────────────────────────────────

/**
 * OWNER approves the EXACT content they reviewed (`contentHash` from the
 * screen). The checklist is recomputed inside the transaction; any red item
 * blocks. Returns the approval; sending is the gateway's job.
 */
export async function approveCommunication(actor: OutreachActor, commId: string, input: { contentHash: string; confirmed: boolean; ipAddress?: string }) {
  if (!can(actor.role, "approval:decide")) throw new ForbiddenError("Only the OWNER can approve outbound messages.");
  if (!input.confirmed) throw new OutreachError("Tick the box to confirm you read the whole message.");
  return prisma.$transaction(async (tx) => {
    const comm = await tx.communication.findUniqueOrThrow({ where: { id: commId } });
    if (comm.status !== "PENDING_APPROVAL") throw new OutreachError(`This message is ${comm.status.toLowerCase().replace(/_/g, " ")}, not waiting for approval.`);
    if (!comm.contentHash || comm.contentHash !== input.contentHash) {
      throw new OutreachError("The message changed after you opened it. Review the new version before approving.");
    }
    const { items } = await evaluateCommunication(tx, comm);
    const failing = items.filter((i) => i.status === "fail");
    if (failing.length) throw new OutreachError(`Not every checklist item is green: ${failing.map((i) => i.label).join("; ")}.`);
    const approval = await tx.approval.create({
      data: {
        subjectType: "COMMUNICATION",
        subjectId: comm.id,
        decision: "APPROVED",
        contentHash: comm.contentHash,
        contentSnapshot: `${comm.subject ? `Subject: ${comm.subject}\n\n` : ""}${comm.textContent ?? ""}`,
        checklist: items as never,
        approvedById: actor.id,
      },
    });
    const now = new Date();
    const updated = await tx.communication.updateMany({
      where: { id: comm.id, status: "PENDING_APPROVAL", contentHash: comm.contentHash },
      data: { status: "APPROVED", approvalId: approval.id, scheduledFor: comm.scheduledFor && comm.scheduledFor > now ? comm.scheduledFor : now },
    });
    if (updated.count !== 1) throw new OutreachError("The message was changed by someone else. Reload and try again.");
    if (comm.personalizationRunId) {
      const run = await tx.aiRun.findUnique({ where: { id: comm.personalizationRunId }, select: { acceptance: true } });
      if (run?.acceptance === "PENDING") {
        await decideAiRun(tx, { aiRunId: comm.personalizationRunId, decision: "ACCEPTED", actor, note: "Personal note approved as part of the message." });
      }
    }
    await writeAudit(tx, {
      actor: audit(actor),
      action: "communication.approved",
      entityType: "Communication",
      entityId: comm.id,
      after: { approvalId: approval.id, contentHash: comm.contentHash, channel: comm.channel, step: comm.sequenceStep, template: `${comm.templateId}@${comm.templateVersion}` },
      ipAddress: input.ipAddress,
    });
    return approval;
  });
}

export async function rejectCommunication(actor: OutreachActor, commId: string, reason: string, ipAddress?: string) {
  if (!can(actor.role, "approval:decide")) throw new ForbiddenError("Only the OWNER can reject outbound messages.");
  const why = reason.trim();
  if (why.length < 5) throw new OutreachError("Say briefly why it is rejected.");
  await prisma.$transaction(async (tx) => {
    const comm = await tx.communication.findUniqueOrThrow({ where: { id: commId } });
    if (comm.status !== "PENDING_APPROVAL" && comm.status !== "DRAFT") throw new OutreachError("Only drafts waiting for approval can be rejected.");
    const approval = await tx.approval.create({
      data: {
        subjectType: "COMMUNICATION",
        subjectId: comm.id,
        decision: "REJECTED",
        contentHash: comm.contentHash ?? "",
        contentSnapshot: `${comm.subject ? `Subject: ${comm.subject}\n\n` : ""}${comm.textContent ?? ""}`,
        reason: why,
        approvedById: actor.id,
      },
    });
    await tx.communication.update({ where: { id: comm.id }, data: { status: "REJECTED", cancelledReason: why } });
    if (comm.personalizationRunId) {
      const run = await tx.aiRun.findUnique({ where: { id: comm.personalizationRunId }, select: { acceptance: true } });
      if (run?.acceptance === "PENDING") await decideAiRun(tx, { aiRunId: comm.personalizationRunId, decision: "REJECTED", actor, note: why });
    }
    await writeAudit(tx, {
      actor: audit(actor),
      action: "communication.rejected",
      entityType: "Communication",
      entityId: comm.id,
      after: { approvalId: approval.id, contentHash: comm.contentHash },
      reason: why,
      ipAddress,
    });
  });
}

/** Cancel a message that has not gone out (draft, waiting, or approved-but-scheduled). */
export async function cancelCommunication(actor: OutreachActor | "system", commId: string, reason: string, db: DbClient = prisma) {
  if (actor !== "system") requireDraftRights(actor);
  const updated = await db.communication.updateMany({
    where: { id: commId, status: { in: [...PENDING_STATUSES, "FAILED"] } },
    data: { status: "CANCELLED", cancelledReason: reason.slice(0, 300) },
  });
  if (updated.count !== 1) throw new OutreachError("Only messages that have not been sent can be cancelled.");
  await writeAudit(db, { actor: audit(actor), action: "communication.cancelled", entityType: "Communication", entityId: commId, reason });
}

/** Cancel every not-yet-sent outbound message matching `where` (follow-up stop rule). */
async function cancelPending(db: DbClient, where: object, reason: string): Promise<number> {
  const pending = await db.communication.findMany({
    where: { ...where, direction: "OUTBOUND", status: { in: [...PENDING_STATUSES] } },
    select: { id: true },
  });
  for (const p of pending) await cancelCommunication("system", p.id, reason, db);
  return pending.length;
}

// ─── Inbound replies and opt-outs ───────────────────────────────────────────

/**
 * Record anything an heir sent us (reply, call note, portal message). Any
 * reply stops the case's pending follow-ups (and anything pending to that
 * person), and a contacted case moves to RESPONDED.
 */
export async function recordInbound(input: {
  caseId: string;
  personId: string | null;
  channel: "MAIL" | "EMAIL" | "INBOUND_PHONE_NOTE" | "PORTAL_MESSAGE";
  summary: string;
  createdById: string | null;
  auditActor: AuditActor;
  advanceToResponded: boolean;
}) {
  const comm = await prisma.$transaction(async (tx) => {
    const created = await tx.communication.create({
      data: {
        caseId: input.caseId,
        personId: input.personId,
        channel: input.channel,
        direction: "INBOUND",
        status: "RECEIVED",
        textContent: input.summary.slice(0, 5000),
        createdById: input.createdById,
      },
    });
    const followUps = await cancelPending(tx, { caseId: input.caseId, sequenceStep: { gt: 1 } }, "Heir replied — follow-ups stopped automatically.");
    const own = input.personId ? await cancelPending(tx, { caseId: input.caseId, personId: input.personId }, "This person replied.") : 0;
    await writeAudit(tx, {
      actor: input.auditActor,
      action: "communication.inbound_logged",
      entityType: "Communication",
      entityId: created.id,
      after: { caseId: input.caseId, personId: input.personId, channel: input.channel, cancelledFollowUps: followUps + own },
    });
    return created;
  });
  if (input.advanceToResponded) {
    const c = await prisma.case.findUniqueOrThrow({ where: { id: input.caseId }, select: { stage: true } });
    if (c.stage === "CONTACTED") {
      await transitionCase({ caseId: input.caseId, to: "RESPONDED", actor: { type: "SYSTEM", id: "outreach" }, reason: "Heir replied." }).catch(() => undefined);
    }
  }
  return comm;
}

/** Operator logs a reply, call or letter (calls/texts are handled by a human; rule 6). */
export async function logInbound(
  actor: OutreachActor,
  input: { caseId: string; personId: string | null; channel: "MAIL" | "EMAIL" | "INBOUND_PHONE_NOTE"; summary: string; optOut: boolean },
) {
  requireDraftRights(actor);
  const summary = input.summary.trim();
  if (summary.length < 3) throw new OutreachError("Add a short note of what they said.");
  if (input.personId) {
    const p = await prisma.person.findUniqueOrThrow({ where: { id: input.personId }, select: { caseId: true } });
    if (p.caseId !== input.caseId) throw new OutreachError("That person is not part of this case.");
  }
  const comm = await recordInbound({ ...input, summary, createdById: actor.id, auditActor: audit(actor), advanceToResponded: !input.optOut });
  if (input.optOut && input.personId) await recordOptOut({ personId: input.personId, source: "operator", actor });
  return comm;
}

/**
 * Opt-out: flag the person, add them (email/address hashes) to the
 * do-not-contact list for every case, and cancel anything pending to them.
 */
export async function recordOptOut(input: { personId: string; source: "link" | "operator"; actor?: OutreachActor; ipAddress?: string }) {
  return prisma.$transaction(async (tx) => {
    const person = await tx.person.findUniqueOrThrow({ where: { id: input.personId } });
    const already = person.doNotContact;
    await tx.person.update({ where: { id: person.id }, data: { doNotContact: true } });
    const email = person.emailEnc ? decryptPii(person.emailEnc) : null;
    const address = person.mailingAddressEnc ? decryptPii(person.mailingAddressEnc) : null;
    const actor: AuditActor = input.actor ? audit(input.actor) : { type: "HEIR", id: person.id };
    if (email) await addDoNotContact(tx, actor, { name: person.fullName, email, reason: input.source === "link" ? "Opted out using the link in our message" : "Asked us to stop (logged by operator)", createdById: input.actor?.id });
    if (address && addressHashOf(address)) await addDoNotContact(tx, actor, { name: person.fullName, address, reason: input.source === "link" ? "Opted out using the link in our message" : "Asked us to stop (logged by operator)", createdById: input.actor?.id });
    if (!email && !(address && addressHashOf(address))) await addDoNotContact(tx, actor, { name: person.fullName, reason: "Asked us to stop", createdById: input.actor?.id });
    const cancelled = await cancelPending(tx, { personId: person.id }, "Opted out.");
    await writeAudit(tx, {
      actor,
      action: "person.opted_out",
      entityType: "Person",
      entityId: person.id,
      after: { caseId: person.caseId, source: input.source, cancelledMessages: cancelled, alreadyOptedOut: already },
      ipAddress: input.ipAddress,
    });
    if (!already) {
      await notifyCase(tx, { caseId: person.caseId, kind: "OPTED_OUT", title: `${person.fullName} asked not to be contacted`, body: `Source: ${input.source === "link" ? "opt-out link" : "operator"}.` });
    }
    return { cancelled };
  });
}

/** Public opt-out link (no login). Unknown tokens reveal nothing. */
export async function optOutByToken(token: string, ipAddress?: string): Promise<boolean> {
  const comm = await prisma.communication.findUnique({ where: { optOutToken: token }, select: { personId: true } });
  if (!comm?.personId) return false;
  await recordOptOut({ personId: comm.personId, source: "link", ipAddress });
  return true;
}

export async function retryCommunication(actor: OutreachActor, commId: string) {
  if (!can(actor.role, "approval:decide")) throw new ForbiddenError("Only the OWNER can retry sending.");
  const updated = await prisma.communication.updateMany({ where: { id: commId, status: "FAILED", approvalId: { not: null } }, data: { status: "APPROVED", scheduledFor: new Date() } });
  if (updated.count !== 1) throw new OutreachError("Only failed messages that were approved can be retried.");
  await writeAudit(prisma, { actor: audit(actor), action: "communication.retry_requested", entityType: "Communication", entityId: commId });
}

// ─── Read helpers for screens ───────────────────────────────────────────────

export function storedChecklist(comm: { checklist: unknown }): StoredChecklist | null {
  return (comm.checklist as StoredChecklist | null) ?? null;
}

export function storedTone(comm: { toneCheck: unknown }): StoredTone | null {
  return (comm.toneCheck as StoredTone | null) ?? null;
}

