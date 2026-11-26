"use server";

import { revalidatePath } from "next/cache";
import { AiOutputError } from "@/lib/ai/run";
import { AiRefusedError } from "@/lib/ai/provider";
import { AiDecisionError } from "@/lib/ai/acceptance";
import { ForbiddenError } from "@/lib/auth/permissions";
import { requireOperator } from "@/lib/auth/session";
import type { EvidenceSourceType } from "@/lib/generated/prisma/enums";
import type { DeathRecordResult } from "@/adapters/death-records";
import type { PeopleSearchMatch } from "@/adapters/people-search";
import * as research from "@/lib/research/service";

export type ActionState = { ok?: string; error?: string };

const EVIDENCE_TYPES: EvidenceSourceType[] = ["OBITUARY", "DEATH_RECORD_INDEX", "PROBATE_FILING", "PUBLIC_RECORD", "USER_UPLOADED_DOCUMENT", "MANUAL_NOTE"];

/** Turn expected failures into a message; anything else is a real bug and is re-thrown. */
async function attempt(caseId: string, fn: () => Promise<string>): Promise<ActionState> {
  try {
    const ok = await fn();
    revalidatePath(`/cases/${caseId}`);
    return { ok };
  } catch (e) {
    if (
      e instanceof research.ResearchError ||
      e instanceof ForbiddenError ||
      e instanceof AiOutputError ||
      e instanceof AiRefusedError ||
      e instanceof AiDecisionError
    ) {
      return { error: e.message };
    }
    if (e instanceof Error && e.name === "ZodError") return { error: "Some fields are missing or invalid." };
    throw e;
  }
}

async function actor() {
  const op = await requireOperator("case:read");
  return { id: op.id, role: op.role };
}

export async function addEvidenceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await actor();
  const caseId = String(fd.get("caseId"));
  const sourceType = EVIDENCE_TYPES.find((t) => t === fd.get("sourceType")) ?? "MANUAL_NOTE";
  return attempt(caseId, async () => {
    await research.addEvidence(a, {
      caseId,
      sourceType,
      title: String(fd.get("title") ?? ""),
      url: String(fd.get("url") ?? "") || null,
      rawText: String(fd.get("rawText") ?? "") || null,
      supportsDeath: fd.get("supportsDeath") === "on",
    });
    return "Source added.";
  });
}

export type SearchState = ActionState & { results?: (Omit<DeathRecordResult, "retrievedAt"> & { retrievedAt: string })[] };

export async function searchSourcesAction(_: SearchState, fd: FormData): Promise<SearchState> {
  const a = await actor();
  const caseId = String(fd.get("caseId"));
  try {
    const results = await research.searchDeathRecords(a, caseId);
    return {
      ok: results.length ? `${results.length} result(s). Add the ones that match.` : "No results from the configured sources. Paste a source by hand below.",
      results: results.map((r) => ({ ...r, retrievedAt: r.retrievedAt.toISOString() })),
    };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
}

export async function extractAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await actor();
  const caseId = String(fd.get("caseId"));
  return attempt(caseId, async () => {
    await research.extractObituary(a, String(fd.get("evidenceId")));
    return "Facts extracted — review the suggestion below before accepting.";
  });
}

export async function acceptExtractionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await actor();
  const caseId = String(fd.get("caseId"));
  return attempt(caseId, async () => {
    const r = await research.acceptObituaryExtraction(a, {
      aiRunId: String(fd.get("aiRunId")),
      confirmsOwnerDeath: fd.get("confirmsOwnerDeath") === "on",
      relativeIndexes: fd.getAll("relative").map(Number).filter((n) => Number.isInteger(n)),
      note: String(fd.get("note") ?? "") || undefined,
    });
    return `Accepted. ${r.created.length} new heir candidate(s), ${r.linked.length} linked to existing people.`;
  });
}

export async function rejectSuggestionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await actor();
  const caseId = String(fd.get("caseId"));
  return attempt(caseId, async () => {
    await research.rejectAiSuggestion(a, String(fd.get("aiRunId")), String(fd.get("note") ?? "") || undefined);
    return "Suggestion rejected.";
  });
}

export async function savePersonAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await actor();
  const caseId = String(fd.get("caseId"));
  const personId = String(fd.get("personId") ?? "") || null;
  return attempt(caseId, async () => {
    await research.savePerson(a, caseId, personId, {
      fullName: String(fd.get("fullName") ?? ""),
      relationship: String(fd.get("relationship")) as never,
      isPredeceased: fd.get("isPredeceased") === "on",
      parentPersonId: String(fd.get("parentPersonId") ?? "") || null,
      relationshipConfidence: Number(fd.get("confidence") ?? 0.5),
      status: String(fd.get("status") ?? "CANDIDATE") as never,
      notes: String(fd.get("notes") ?? "") || null,
    });
    return personId ? "Saved." : "Person added.";
  });
}

export async function mergePersonsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await actor();
  const caseId = String(fd.get("caseId"));
  return attempt(caseId, async () => {
    await research.mergePersons(a, caseId, String(fd.get("keepId")), String(fd.get("removeId")));
    return "Merged.";
  });
}

export type LookupState = ActionState & { provider?: string; matches?: PeopleSearchMatch[] };

export async function lookupContactAction(_: LookupState, fd: FormData): Promise<LookupState> {
  const a = await actor();
  try {
    const r = await research.lookupContact(a, String(fd.get("personId")), fd.get("purpose") === "on");
    return { ok: `${r.matches.length} possible match(es) from ${r.provider}. Save only the one that is clearly this person.`, ...r };
  } catch (e) {
    if (e instanceof research.ResearchError || e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
}

export async function saveContactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await actor();
  const caseId = String(fd.get("caseId"));
  return attempt(caseId, async () => {
    await research.saveContact(a, String(fd.get("personId")), {
      address: String(fd.get("address") ?? "") || null,
      phone: String(fd.get("phone") ?? "") || null,
      email: String(fd.get("email") ?? ""),
      source: fd.get("source") === "VENDOR" ? "VENDOR" : "MANUAL",
      sourceDetail: String(fd.get("sourceDetail") ?? ""),
      vendorRecordId: String(fd.get("vendorRecordId") ?? "") || null,
    });
    return "Contact details saved (encrypted).";
  });
}

export async function summarizeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await actor();
  const caseId = String(fd.get("caseId"));
  return attempt(caseId, async () => {
    await research.generateResearchSummary(a, caseId);
    return "Summary generated.";
  });
}

export async function acceptSummaryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await actor();
  const caseId = String(fd.get("caseId"));
  return attempt(caseId, async () => {
    await research.acceptSummary(a, String(fd.get("aiRunId")));
    return "Summary accepted.";
  });
}

export async function estimateTracingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await actor();
  const caseId = String(fd.get("caseId"));
  return attempt(caseId, async () => {
    await research.estimateTracing(a, caseId);
    return "Estimate ready — accept it to include it in the score.";
  });
}

export async function acceptTracingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await actor();
  const caseId = String(fd.get("caseId"));
  return attempt(caseId, async () => {
    await research.acceptTracingEstimate(a, String(fd.get("aiRunId")));
    return "Estimate accepted and the score updated.";
  });
}
