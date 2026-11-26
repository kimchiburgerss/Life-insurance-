/**
 * Agreement template (spec 5.7). The shipped file
 * templates/agreements/recovery-agreement.md is a DRAFT; every page of an
 * agreement made from it carries "DRAFT — must be reviewed by a licensed
 * attorney before use". When the founder uploads the attorney-approved text in
 * Settings and switches it on, that version is used and the marking goes away.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const AGREEMENT_VARIABLES = [
  "agreementDate",
  "businessName",
  "businessAddress",
  "contactName",
  "heirName",
  "heirAddress",
  "ownerName",
  "propertyList",
  "deliveredDates",
  "disclosure",
  "claimWebsite",
  "feePercent",
  "feeAmount",
  "valueBeforeFee",
  "valueAfterFee",
  "feeCapPercent",
  "cancellationDays",
  "governingLaw",
] as const;
export type AgreementVariable = (typeof AGREEMENT_VARIABLES)[number];

/**
 * AGREEMENT_REQUIREMENTS.requiredFields → how a template satisfies each one.
 * The signature block (ownerSignature) is always added by the renderer.
 */
export const REQUIRED_FIELD_CHECKS: Record<string, { label: string; test: (body: string) => boolean }> = {
  propertyDescription: { label: "Description of the property", test: (b) => b.includes("{{propertyList}}") },
  servicesDescription: { label: "Description of our services", test: (b) => /^#{2,3} .*services/im.test(b) },
  ownerSignature: { label: "Signature of the apparent owner / claimant", test: () => true },
  valueBeforeFee: { label: "Value of the property before the fee", test: (b) => b.includes("{{valueBeforeFee}}") },
  valueAfterFee: { label: "Value of the property after the fee", test: (b) => b.includes("{{valueAfterFee}}") },
  feePercent: { label: "Fee percentage", test: (b) => b.includes("{{feePercent}}") },
  dateDeliveredToState: { label: "Date the property was delivered to the State", test: (b) => b.includes("{{deliveredDates}}") },
  freeClaimDisclosure: { label: "Free-claim disclosure", test: (b) => b.includes("{{disclosure}}") },
};

export type AgreementTemplate = { id: string; version: string; title: string; body: string; attorneyApproved: boolean };

const Header = z.object({ id: z.string(), version: z.coerce.string(), title: z.string() });

export function parseAgreementTemplate(source: string): Omit<AgreementTemplate, "attorneyApproved"> {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source.replace(/\r\n/g, "\n"));
  if (!m) throw new Error("Agreement template is missing its --- header ---");
  const fields: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { ...Header.parse(fields), body: m[2]!.trim() };
}

/** Problems that make a template unusable (unknown variables, missing required fields). */
export function validateAgreementTemplate(body: string, requiredFields: string[]): string[] {
  const problems: string[] = [];
  const known = new Set<string>(AGREEMENT_VARIABLES);
  for (const m of body.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)) {
    if (!known.has(m[1]!)) problems.push(`Unknown variable {{${m[1]}}}`);
  }
  for (const f of requiredFields) {
    const check = REQUIRED_FIELD_CHECKS[f];
    if (!check) problems.push(`No check defined for required field "${f}"`);
    else if (!check.test(body)) problems.push(`Missing: ${check.label}`);
  }
  if (/<[a-z!/]/i.test(body)) problems.push("HTML is not allowed in the agreement template");
  return [...new Set(problems)];
}

export function loadDraftAgreementTemplate(): AgreementTemplate {
  const t = parseAgreementTemplate(readFileSync(path.join(process.cwd(), "templates", "agreements", "recovery-agreement.md"), "utf8"));
  return { ...t, attorneyApproved: false };
}

export const DRAFT_NOTICE = "DRAFT — must be reviewed by a licensed attorney before use";
export const DEFAULT_GOVERNING_LAW = "[Governing law and how disputes are handled — to be completed by your attorney.]";
