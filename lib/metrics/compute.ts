/**
 * Dashboard numbers (spec 5.11 and 11). Pure helpers plus one loader.
 * Definitions are shown on the page next to each number.
 */
import "server-only";
import { prisma } from "@/lib/db";
import type { CaseStage } from "@/lib/generated/prisma/enums";
import { getUnitCosts, type UnitCosts } from "./costs";
import { breakEvenCasesPerMonth, ratio } from "./math";

export const FUNNEL: { label: string; stage: CaseStage | "IMPORTED" }[] = [
  { label: "Imported", stage: "IMPORTED" },
  { label: "Screened", stage: "SCREENED" },
  { label: "Heir found", stage: "HEIRS_IDENTIFIED" },
  { label: "Contacted", stage: "CONTACTED" },
  { label: "Responded", stage: "RESPONDED" },
  { label: "Signed", stage: "AGREEMENT_SIGNED" },
  { label: "Paid", stage: "PAID_TO_HEIR" },
];

export type Metrics = Awaited<ReturnType<typeof computeMetrics>>;

export async function computeMetrics(now = new Date()) {
  const costs: UnitCosts = await getUnitCosts();
  const [totalCases, stageEvents, invoices, aiCost, letters, lookups, esigns, signedAgreements, firstContacts, inbound, firstCase] = await Promise.all([
    prisma.case.count(),
    prisma.auditLog.findMany({ where: { entityType: "Case", action: { startsWith: "case.stage_changed" } }, select: { entityId: true, after: true } }),
    prisma.invoice.findMany({ where: { status: { in: ["OPEN", "PAID"] } }, select: { caseId: true, status: true, amountCents: true, issuedAt: true, paidAt: true } }),
    prisma.aiRun.aggregate({ _sum: { costMicros: true } }),
    prisma.communication.count({ where: { channel: "MAIL", direction: "OUTBOUND", status: { in: ["SENT", "DELIVERED", "RETURNED"] } } }),
    prisma.auditLog.count({ where: { action: "contact.lookup" } }),
    prisma.agreement.count({ where: { sentAt: { not: null }, esignProvider: { notIn: ["paper"] } } }),
    prisma.agreement.count({ where: { status: "SIGNED" } }),
    prisma.communication.findMany({
      where: { direction: "OUTBOUND", sequenceStep: 1, status: { in: ["SENT", "DELIVERED", "RETURNED"] }, sentAt: { not: null } },
      select: { caseId: true, personId: true, templateId: true, templateVersion: true, sentAt: true },
    }),
    prisma.communication.findMany({ where: { direction: "INBOUND" }, select: { caseId: true, personId: true, createdAt: true } }),
    prisma.case.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);

  // Funnel: cases that ever reached each stage (from the audit log; imported = all cases).
  const reached = new Map<string, Set<string>>();
  for (const e of stageEvents) {
    const stage = (e.after as { stage?: string } | null)?.stage;
    if (!stage) continue;
    if (!reached.has(stage)) reached.set(stage, new Set());
    reached.get(stage)!.add(e.entityId);
  }
  const order: string[] = ["SCREENED", "OWNER_VERIFIED_DECEASED", "HEIRS_RESEARCHING", "HEIRS_IDENTIFIED", "WAITING_PERIOD", "READY_FOR_OUTREACH", "CONTACTED", "RESPONDED", "AGREEMENT_SENT", "AGREEMENT_SIGNED", "CLAIM_PACKET_PREPARED", "CLAIM_FILED", "CLAIM_APPROVED", "PAID_TO_HEIR", "FEE_INVOICED", "FEE_COLLECTED", "CLOSED_WON"];
  // A case that reached a later stage also passed the earlier ones.
  const reachedAtLeast = (stage: string) => {
    const idx = order.indexOf(stage);
    const ids = new Set<string>();
    for (const s of order.slice(idx)) for (const id of reached.get(s) ?? []) ids.add(id);
    return ids.size;
  };
  const funnel = FUNNEL.map((f) => ({ label: f.label, count: f.stage === "IMPORTED" ? totalCases : reachedAtLeast(f.stage) }));
  const funnelWithRates = funnel.map((f, i) => ({ ...f, fromPrevious: i === 0 ? null : ratio(f.count, funnel[i - 1]!.count) }));

  // Revenue.
  const paid = invoices.filter((i) => i.status === "PAID");
  const collectedCents = paid.reduce((s, i) => s + i.amountCents, 0);
  const outstandingCents = invoices.filter((i) => i.status === "OPEN").reduce((s, i) => s + i.amountCents, 0);
  const days = paid.filter((i) => i.issuedAt && i.paidAt).map((i) => (i.paidAt!.getTime() - i.issuedAt!.getTime()) / 86_400_000);
  const avgDaysToPayment = days.length ? days.reduce((a, b) => a + b, 0) / days.length : null;
  const wonCases = reachedAtLeast("CLOSED_WON");
  const revenuePerClosedCents = wonCases ? Math.round(collectedCents / wonCases) : null;

  // Costs.
  const aiCents = Math.round((aiCost._sum.costMicros ?? 0) / 10_000);
  const variableCents = aiCents + letters * costs.perLetterCents + lookups * costs.perDataLookupCents + esigns * costs.perEsignCents;
  const months = firstCase ? Math.max(1, (now.getTime() - firstCase.createdAt.getTime()) / (30.44 * 86_400_000)) : 1;
  const hostingCents = Math.round(costs.monthlyHostingCents * months);
  const workedCases = reachedAtLeast("HEIRS_RESEARCHING");
  const costPerCaseCents = workedCases ? Math.round(variableCents / workedCases) : null;
  const costPerSignedCents = signedAgreements ? Math.round((variableCents + hostingCents) / signedAgreements) : null;
  const variablePerClosedCents = wonCases ? Math.round(variableCents / wonCases) : null;
  const breakEven = breakEvenCasesPerMonth(costs.monthlyHostingCents, revenuePerClosedCents, variablePerClosedCents);

  // Response rate per template (first contacts; a reply = any inbound from that person, or on that case, after the send).
  const byTemplate = new Map<string, { sent: number; replied: number }>();
  for (const fc of firstContacts) {
    const key = `${fc.templateId ?? "unknown"}@${fc.templateVersion ?? "?"}`;
    const t = byTemplate.get(key) ?? { sent: 0, replied: 0 };
    t.sent++;
    if (inbound.some((m) => m.caseId === fc.caseId && (m.personId === fc.personId || m.personId === null) && m.createdAt >= fc.sentAt!)) t.replied++;
    byTemplate.set(key, t);
  }
  const responseRates = [...byTemplate.entries()].map(([template, t]) => ({ template, ...t, rate: ratio(t.replied, t.sent) })).sort((a, b) => b.sent - a.sent);

  return {
    costs,
    missingCosts: (["perLetterCents", "perDataLookupCents", "perEsignCents", "monthlyHostingCents"] as const).filter((k) => costs[k] === 0),
    funnel: funnelWithRates,
    revenue: { collectedCents, outstandingCents, avgDaysToPayment, wonCases, revenuePerClosedCents, paidInvoices: paid.length },
    spend: { aiCents, letters, lookups, esigns, variableCents, hostingCents, months, workedCases, costPerCaseCents, signedAgreements, costPerSignedCents, variablePerClosedCents, breakEven },
    responseRates,
  };
}
