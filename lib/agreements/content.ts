/**
 * The facts an agreement states (pure). Rule 3: property, services, value
 * before and after the fee, signed by the claimant; Treasurer guidance: the
 * date delivered to the State; rule 4: the free-claim disclosure.
 */
import type { PropertyCategory } from "@/lib/generated/prisma/enums";
import { displayName } from "@/lib/normalize/name";
import { feeBreakdown, formatBps } from "@/lib/rules/engine";
import { formatExactUsd, formatLetterDate } from "@/lib/outreach/content";
import type { AgreementVariable } from "./template";

export class AgreementContentError extends Error {}

export type AgreementProperty = {
  statePropertyId: string;
  category: PropertyCategory;
  holderName: string | null;
  reportedAmountCents: number | null;
  amountIsMinimum: boolean;
  dateDeliveredToState: Date | null;
};

const CATEGORY: Record<PropertyCategory, string> = {
  LIFE_INSURANCE: "Life insurance payment",
  ANNUITY: "Annuity payment",
  ESTATE: "Payment held for the estate",
  OTHER: "Unclaimed property",
  UNKNOWN: "Unclaimed property",
};

/** Markdown-escape a value for the PDF renderer (no HTML involved). */
export function escapeMd(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/([\\`*_[\]()#+!|~{}<>])/g, "\\$1")
    .replace(/^([-=])/, "\\$1")
    .replace(/^(\d+)\./, "$1\\.");
}

/** Rule 3 needs exact values: every amount must be known and exact. */
export function totalValueCents(properties: AgreementProperty[]): number {
  const unknown = properties.filter((p) => p.reportedAmountCents == null || p.amountIsMinimum);
  if (unknown.length) {
    throw new AgreementContentError(
      `The exact amount is not known for ${unknown.map((p) => p.statePropertyId).join(", ")}. ` +
        "An agreement must state the value before and after the fee — get the amount from the Unclaimed Property Division and record it first.",
    );
  }
  if (properties.some((p) => !p.dateDeliveredToState)) {
    throw new AgreementContentError("Every property needs its delivery date before an agreement can be made (24-month rule).");
  }
  return properties.reduce((s, p) => s + p.reportedAmountCents!, 0);
}

export function propertyListMarkdown(properties: AgreementProperty[]): string {
  return properties
    .map((p) => {
      const holder = p.holderName?.trim() ? `, reported by ${escapeMd(displayName(p.holderName.trim().toUpperCase()))}` : "";
      return `- ${CATEGORY[p.category]}${holder} — State property ID ${escapeMd(p.statePropertyId)} — amount reported ${escapeMd(formatExactUsd(p.reportedAmountCents!))}`;
    })
    .join("\n");
}

export function deliveredDatesText(properties: AgreementProperty[]): string {
  const dates = [...new Set(properties.map((p) => formatLetterDate(p.dateDeliveredToState!)))];
  return dates.length === 1 ? dates[0]! : dates.join("; ");
}

export type AgreementFacts = {
  agreementDate: Date;
  business: { name: string; address: string; contactName: string };
  heir: { name: string; address: string };
  ownerName: string;
  properties: AgreementProperty[];
  disclosure: { text: string; claimWebsite: string };
  feeBps: number;
  feeCapBps: number;
  cancellationDays: number;
  governingLaw: string;
};

export function agreementVariables(f: AgreementFacts): { vars: Record<AgreementVariable, string>; valueBeforeFeeCents: number; valueAfterFeeCents: number; feeCents: number } {
  const total = totalValueCents(f.properties);
  const b = feeBreakdown(total, f.feeBps);
  const raw: Record<AgreementVariable, string> = {
    agreementDate: formatLetterDate(f.agreementDate),
    businessName: f.business.name,
    businessAddress: f.business.address,
    contactName: f.business.contactName,
    heirName: f.heir.name,
    heirAddress: f.heir.address,
    ownerName: f.ownerName,
    propertyList: "",
    deliveredDates: deliveredDatesText(f.properties),
    disclosure: f.disclosure.text,
    claimWebsite: f.disclosure.claimWebsite,
    feePercent: formatBps(f.feeBps),
    feeAmount: formatExactUsd(b.feeCents),
    valueBeforeFee: formatExactUsd(b.valueBeforeFeeCents),
    valueAfterFee: formatExactUsd(b.valueAfterFeeCents),
    feeCapPercent: formatBps(f.feeCapBps),
    cancellationDays: String(f.cancellationDays),
    governingLaw: f.governingLaw,
  };
  const vars = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, escapeMd(v)])) as Record<AgreementVariable, string>;
  vars.propertyList = propertyListMarkdown(f.properties);
  return { vars, valueBeforeFeeCents: b.valueBeforeFeeCents, valueAfterFeeCents: b.valueAfterFeeCents, feeCents: b.feeCents };
}

export function fillTemplate(body: string, vars: Record<AgreementVariable, string>): string {
  return body.replace(/\{\{\s*([^}]*?)\s*\}\}/g, (_, name: string) => {
    const v = vars[name as AgreementVariable];
    if (v === undefined) throw new AgreementContentError(`Unknown variable {{${name}}}`);
    if (!v) throw new AgreementContentError(`Missing value for {{${name}}}`);
    return v;
  });
}

