/**
 * Validation shown beside every agreement and re-run at approval and send
 * (spec 5.7: "Validate against JurisdictionRule (fee cap, waiting period,
 * required fields) before allowing send"). Pure.
 */
import type { CaseEligibility } from "@/lib/rules/engine";
import { formatBps } from "@/lib/rules/engine";
import type { ChecklistItem } from "@/lib/outreach/checklist";

export type AgreementFacts = {
  eligibility: CaseEligibility;
  unverifiedRules: string[];
  caseStage: string;
  feeBps: number;
  feeCapBps: number | null;
  amountsExact: boolean;
  missingRequired: string[];
  disclosureInText: boolean;
  signer: { name: string; email: string | null; rejected: boolean; predeceased: boolean; doNotContact: boolean };
  attorneyApproved: boolean;
  mockMode: boolean;
  esignConfigured: { ok: boolean; name: string };
  otherActiveAgreement: boolean;
};

const STAGES = new Set(["RESPONDED", "AGREEMENT_SENT", "AGREEMENT_SIGNED"]);

export function buildAgreementChecklist(f: AgreementFacts): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const add = (key: string, label: string, ok: boolean | "warn", detail: string) =>
    items.push({ key, label, status: ok === "warn" ? "warn" : ok ? "pass" : "fail", detail });
  const e = f.eligibility;
  add(
    "void_period",
    "Signed after the 24-month void period (NRS 120A.740)",
    e.status === "ELIGIBLE",
    e.status === "ELIGIBLE" ? `Agreements may be signed from ${e.eligibleContractDate.toISOString().slice(0, 10)}.` : e.status === "WAITING" ? `Void until ${e.eligibleContractDate.toISOString().slice(0, 10)}.` : e.reason,
  );
  add("rules_verified", "Rules used are verified", f.unverifiedRules.length === 0, f.unverifiedRules.length ? `Not yet verified: ${f.unverifiedRules.join(", ")}.` : "Waiting period, fee cap, disclosure and agreement rules are verified.");
  add("case_stage", "The heir has responded", STAGES.has(f.caseStage), `Case stage: ${f.caseStage}.`);
  add("fee_cap", "Fee within the legal cap", f.feeCapBps !== null && f.feeBps <= f.feeCapBps, f.feeCapBps === null ? "Cap unknown." : `Fee ${formatBps(f.feeBps)}; cap ${formatBps(f.feeCapBps)}.`);
  add("amounts", "Exact property value known (value before and after the fee)", f.amountsExact, f.amountsExact ? "All amounts are exact." : "An amount is missing or only a minimum.");
  add("required_fields", "Every required term is in the agreement", f.missingRequired.length === 0, f.missingRequired.length ? `Missing: ${f.missingRequired.join(", ")}.` : "Property, services, values, fee, delivery date, disclosure and signature block present.");
  add("disclosure", "Free-claim disclosure, word for word", f.disclosureInText, f.disclosureInText ? "Present." : "Missing or altered.");
  add(
    "signer",
    "Signer is a living heir who has not opted out",
    !f.signer.rejected && !f.signer.predeceased && !f.signer.doNotContact,
    f.signer.doNotContact ? "This person asked not to be contacted." : f.signer.rejected ? "Rejected as an heir." : f.signer.predeceased ? "Recorded as deceased." : `${f.signer.name}.`,
  );
  add("signer_email", "Email for electronic signature", f.signer.email ? true : "warn", f.signer.email ? "On file." : "No email — send for paper signature, or ask the heir to add an email in the portal.");
  add("one_agreement", "No other open agreement with this heir", !f.otherActiveAgreement, f.otherActiveAgreement ? "Cancel the other agreement first." : "OK.");
  add(
    "attorney",
    "Agreement text approved by a licensed attorney",
    f.attorneyApproved ? true : f.mockMode ? "warn" : false,
    f.attorneyApproved ? "Attorney-approved version in use." : "DRAFT text — marked on every page. Upload the attorney-approved version in Settings before real use.",
  );
  add("esign", "E-signature service configured", f.esignConfigured.ok ? true : "warn", f.esignConfigured.name);
  return items;
}
