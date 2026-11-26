import { describe, expect, it } from "vitest";
import { canTransitionTo } from "@/lib/auth/permissions";
import { parseDateOnly } from "@/lib/dates";
import {
  ALLOWED_TRANSITIONS,
  checkTransition,
  isAllowedTransition,
  stageAfterResearch,
  STAGES,
  TERMINAL_STAGES,
  type GuardContext,
} from "@/lib/case/stateMachine";

const today = parseDateOnly("2026-11-26");

function ctx(overrides: Partial<GuardContext> = {}): GuardContext {
  return {
    today,
    eligibility: { status: "ELIGIBLE", eligibleContractDate: parseDateOnly("2026-01-01") },
    waitingPeriodRuleVerified: true,
    deathEvidenceCount: 1,
    qualifiedHeirCount: 1,
    approvedOutboundSentCount: 1,
    inboundReplyCount: 1,
    sentAgreementCount: 1,
    signedAgreementCount: 1,
    approvedClaimPacketCount: 1,
    invoiceCount: 1,
    paidInvoiceCount: 1,
    ...overrides,
  };
}

const waiting: GuardContext["eligibility"] = {
  status: "WAITING",
  eligibleContractDate: parseDateOnly("2027-03-01"),
  daysRemaining: 95,
};
const unknown: GuardContext["eligibility"] = {
  status: "UNKNOWN",
  reason: "Date delivered to the state is unknown.",
  missingPropertyIds: ["p1"],
};

describe("transition graph", () => {
  it("defines every stage", () => {
    expect(Object.keys(ALLOWED_TRANSITIONS).sort()).toEqual([...STAGES].sort());
  });

  it("terminal stages have no exits", () => {
    for (const s of TERMINAL_STAGES) expect(ALLOWED_TRANSITIONS[s]).toEqual([]);
  });

  it("every non-terminal stage can reach CLOSED_WON or a closed stage", () => {
    for (const start of STAGES) {
      const seen = new Set<string>([start]);
      const queue: string[] = [start];
      while (queue.length) {
        const s = queue.shift()! as (typeof STAGES)[number];
        for (const n of ALLOWED_TRANSITIONS[s]) {
          if (!seen.has(n)) {
            seen.add(n);
            queue.push(n);
          }
        }
      }
      expect([...seen].some((s) => s.startsWith("CLOSED_")), start).toBe(true);
    }
  });

  it("the happy path is a chain of allowed edges", () => {
    const happy = [
      "IMPORTED", "SCREENED", "OWNER_VERIFIED_DECEASED", "HEIRS_RESEARCHING", "HEIRS_IDENTIFIED",
      "WAITING_PERIOD", "READY_FOR_OUTREACH", "CONTACTED", "RESPONDED", "AGREEMENT_SENT",
      "AGREEMENT_SIGNED", "CLAIM_PACKET_PREPARED", "CLAIM_FILED", "CLAIM_APPROVED", "PAID_TO_HEIR",
      "FEE_INVOICED", "FEE_COLLECTED", "CLOSED_WON",
    ] as const;
    for (let i = 0; i < happy.length - 1; i++) {
      expect(isAllowedTransition(happy[i]!, happy[i + 1]!), `${happy[i]} → ${happy[i + 1]}`).toBe(true);
    }
  });

  it("rejects skipping stages and leaving terminal stages", () => {
    expect(checkTransition("IMPORTED", "READY_FOR_OUTREACH", ctx())).toMatchObject({ ok: false, reason: "NOT_ALLOWED" });
    expect(checkTransition("HEIRS_IDENTIFIED", "AGREEMENT_SENT", ctx())).toMatchObject({ ok: false, reason: "NOT_ALLOWED" });
    expect(checkTransition("CLOSED_WON", "IMPORTED", ctx())).toMatchObject({ ok: false, reason: "NOT_ALLOWED" });
    // NOT_ALLOWED cannot be overridden.
    expect(checkTransition("IMPORTED", "CLOSED_WON", ctx(), true).ok).toBe(false);
  });

  it("supports the claim loop (more info → refile, denied → rework)", () => {
    expect(checkTransition("CLAIM_FILED", "MORE_INFO_REQUESTED", ctx()).ok).toBe(true);
    expect(checkTransition("MORE_INFO_REQUESTED", "CLAIM_FILED", ctx()).ok).toBe(true);
    expect(checkTransition("CLAIM_DENIED", "CLAIM_PACKET_PREPARED", ctx()).ok).toBe(true);
  });
});

describe("compliance guards", () => {
  it("requires a cited death source to mark the owner deceased", () => {
    const r = checkTransition("SCREENED", "OWNER_VERIFIED_DECEASED", ctx({ deathEvidenceCount: 0 }), true);
    expect(r).toMatchObject({ ok: false, reason: "BLOCKED" });
    expect(r.blocks[0]?.code).toBe("NO_DEATH_EVIDENCE");
  });

  it("requires a qualified heir", () => {
    const r = checkTransition("HEIRS_RESEARCHING", "HEIRS_IDENTIFIED", ctx({ qualifiedHeirCount: 0 }));
    expect(r.blocks[0]?.code).toBe("NO_QUALIFIED_HEIR");
  });

  it("blocks outreach during the void period — even with an override", () => {
    for (const override of [false, true]) {
      const r = checkTransition("WAITING_PERIOD", "READY_FOR_OUTREACH", ctx({ eligibility: waiting }), override);
      expect(r.ok).toBe(false);
      expect(r.blocks.map((b) => b.code)).toContain("VOID_PERIOD_NOT_ELAPSED");
    }
  });

  it("blocks sending an agreement during the void period — even with an override", () => {
    const r = checkTransition("RESPONDED", "AGREEMENT_SENT", ctx({ eligibility: waiting }), true);
    expect(r.ok).toBe(false);
    expect(r.blocks.map((b) => b.code)).toContain("VOID_PERIOD_NOT_ELAPSED");
  });

  it("an unknown delivery date blocks outreach but can be overridden with a reason", () => {
    const blocked = checkTransition("WAITING_PERIOD", "READY_FOR_OUTREACH", ctx({ eligibility: unknown }));
    expect(blocked.ok).toBe(false);
    expect(blocked.blocks[0]).toMatchObject({ code: "DELIVERY_DATE_UNKNOWN", overridable: true });
    const overridden = checkTransition("WAITING_PERIOD", "READY_FOR_OUTREACH", ctx({ eligibility: unknown }), true);
    expect(overridden.ok).toBe(true);
    if (overridden.ok) expect(overridden.overridden.map((b) => b.code)).toEqual(["DELIVERY_DATE_UNKNOWN"]);
  });

  it("an unverified waiting-period rule blocks outreach (overridable)", () => {
    const r = checkTransition("WAITING_PERIOD", "READY_FOR_OUTREACH", ctx({ waitingPeriodRuleVerified: false }));
    expect(r.blocks.map((b) => b.code)).toEqual(["RULE_UNVERIFIED"]);
    expect(checkTransition("WAITING_PERIOD", "READY_FOR_OUTREACH", ctx({ waitingPeriodRuleVerified: false }), true).ok).toBe(true);
  });

  it("research is allowed during the void period", () => {
    const c = ctx({ eligibility: waiting });
    expect(checkTransition("SCREENED", "OWNER_VERIFIED_DECEASED", c).ok).toBe(true);
    expect(checkTransition("HEIRS_RESEARCHING", "HEIRS_IDENTIFIED", c).ok).toBe(true);
    expect(checkTransition("HEIRS_IDENTIFIED", "WAITING_PERIOD", c).ok).toBe(true);
  });

  it("cannot park an already-eligible case in WAITING_PERIOD", () => {
    expect(checkTransition("HEIRS_IDENTIFIED", "WAITING_PERIOD", ctx()).blocks[0]?.code).toBe("VOID_PERIOD_ALREADY_ELAPSED");
  });

  it("CONTACTED requires an approved, sent outbound item (not overridable)", () => {
    const r = checkTransition("READY_FOR_OUTREACH", "CONTACTED", ctx({ approvedOutboundSentCount: 0 }), true);
    expect(r.ok).toBe(false);
    expect(r.blocks.map((b) => b.code)).toContain("NO_APPROVED_OUTREACH_SENT");
  });

  it("AGREEMENT_SENT requires an approved sent agreement; SIGNED requires a signature", () => {
    expect(checkTransition("RESPONDED", "AGREEMENT_SENT", ctx({ sentAgreementCount: 0 }), true).ok).toBe(false);
    expect(checkTransition("AGREEMENT_SENT", "AGREEMENT_SIGNED", ctx({ signedAgreementCount: 0 }), true).ok).toBe(false);
  });

  it("claim filing and billing need their records", () => {
    expect(checkTransition("CLAIM_PACKET_PREPARED", "CLAIM_FILED", ctx({ approvedClaimPacketCount: 0 })).ok).toBe(false);
    expect(checkTransition("PAID_TO_HEIR", "FEE_INVOICED", ctx({ invoiceCount: 0 })).ok).toBe(false);
    expect(checkTransition("FEE_INVOICED", "FEE_COLLECTED", ctx({ paidInvoiceCount: 0 })).ok).toBe(false);
  });

  it("stageAfterResearch picks WAITING_PERIOD vs READY_FOR_OUTREACH", () => {
    expect(stageAfterResearch(ctx().eligibility)).toBe("READY_FOR_OUTREACH");
    expect(stageAfterResearch(waiting)).toBe("WAITING_PERIOD");
    expect(stageAfterResearch(unknown)).toBe("WAITING_PERIOD");
  });
});

describe("role permissions on transitions", () => {
  it("researchers can do research stages but not outreach or agreements", () => {
    expect(canTransitionTo("RESEARCHER", "HEIRS_IDENTIFIED")).toBe(true);
    expect(canTransitionTo("RESEARCHER", "WAITING_PERIOD")).toBe(true);
    expect(canTransitionTo("RESEARCHER", "READY_FOR_OUTREACH")).toBe(false);
    expect(canTransitionTo("RESEARCHER", "AGREEMENT_SENT")).toBe(false);
  });

  it("viewers cannot transition; owners can", () => {
    expect(canTransitionTo("VIEWER", "SCREENED")).toBe(false);
    expect(canTransitionTo("OWNER", "CLOSED_WON")).toBe(true);
  });
});
