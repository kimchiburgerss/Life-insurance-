import type { Role } from "@/lib/generated/prisma/enums";
import type { CaseStage } from "@/lib/generated/prisma/enums";

/**
 * Least-privilege permission map. OWNER is the founder. RESEARCHER can do
 * research work but cannot approve outbound items, override compliance
 * blocks, or change rules. VIEWER is read-only.
 */
export const PERMISSIONS = {
  "case:read": ["OWNER", "RESEARCHER", "VIEWER"],
  "case:write": ["OWNER", "RESEARCHER"],
  "case:transition:research": ["OWNER", "RESEARCHER"],
  "import:run": ["OWNER", "RESEARCHER"],
  "owners:merge": ["OWNER", "RESEARCHER"],
  "case:transition:any": ["OWNER"],
  "compliance:override": ["OWNER"],
  "approval:decide": ["OWNER"],
  "rules:manage": ["OWNER"],
  "users:manage": ["OWNER"],
  "audit:read": ["OWNER"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** Stages a RESEARCHER may move a case into. Everything else needs OWNER. */
const RESEARCH_STAGES: ReadonlySet<CaseStage> = new Set([
  "SCREENED",
  "OWNER_VERIFIED_DECEASED",
  "HEIRS_RESEARCHING",
  "HEIRS_IDENTIFIED",
  "WAITING_PERIOD",
  "CLOSED_NO_HEIR",
  "CLOSED_INELIGIBLE",
]);

export function canTransitionTo(role: Role, to: CaseStage): boolean {
  if (can(role, "case:transition:any")) return true;
  return can(role, "case:transition:research") && RESEARCH_STAGES.has(to);
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}
