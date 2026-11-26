# Compliance rules → code → tests

The ten hard rules from the build spec, where each one is enforced, and the
test that proves it. "Planned" means the feature it governs doesn't exist yet;
the rule will be enforced in the phase that builds that feature, and this file
will be updated then.

> **Not legal advice.** Rule *values* (24 months, 10%/20%, disclosure wording)
> come from our reading of NRS 120A.740 and the Nevada Treasurer's published
> heir-finder guidance. They are stored as data in `jurisdiction_rules` and ship
> **unverified**. The founder (ideally with Nevada counsel) must verify each one
> in **Jurisdiction rules** before relying on it. While a rule is unverified,
> outreach is blocked unless the OWNER overrides with a written, logged reason.

## How enforcement works

- **Rules are data, logic is code.** `lib/rules/schemas.ts` validates every rule's
  parameters, `lib/rules/repository.ts` loads the rule in effect on a given
  date, and `lib/rules/engine.ts` holds the pure calculations.
- **One door for stage changes.** `lib/case/transitions.ts → transitionCase()`
  is the only code that changes `Case.stage`. It checks the edge
  (`ALLOWED_TRANSITIONS`), runs compliance guards (`lib/case/stateMachine.ts`),
  checks role permissions, applies the change with optimistic concurrency, and
  writes the audit entry in the same transaction.
- **Blocks are hard or overridable.** A hard block can never be bypassed. An
  overridable block, used for checks a computer can't settle on its own, needs
  an OWNER, a written reason of at least 10 characters, and is logged as
  `case.stage_changed.override`.

| # | Rule | Status (Phase 1) | Enforced in | Tests |
|---|------|------------------|-------------|-------|
| 1 | **24-month void period** (NRS 120A.740) | **Enforced** for pipeline stages. Agreement generation/e-sign gate: Phase 5 | `lib/rules/engine.ts` (`computeEligibleContractDate`, `computeCaseEligibility`); guards on `READY_FOR_OUTREACH`, `CONTACTED`, `AGREEMENT_SENT` in `lib/case/stateMachine.ts` (hard block `VOID_PERIOD_NOT_ELAPSED`); `Case.eligibleContractDate` stored on every transition | `tests/unit/rules.test.ts` (leap years, month ends, anniversary day), `tests/unit/stateMachine.test.ts`, `tests/integration/transitions.test.ts` ("blocks outreach during the void period, even for the OWNER with an override") |
| 2 | **Fee cap** (10%; 20% if delivered ≥ 5 years before signing) | Calculation **enforced**; agreement generator refusal: Phase 5 | `lib/rules/engine.ts` (`feeCapBpsForProperty`, `feeCapBpsForCase` uses the *lowest* property cap, `assertFeeWithinCap`); values in `jurisdiction_rules` (`FEE_CAP`) | `tests/unit/rules.test.ts` ("Rule 2 — fee cap tiers"), `tests/integration/rules-repository.test.ts` (effective-date versioning, malformed rule refused) |
| 3 | **Agreement content** (in writing, property + services, owner signature, value before/after fee) | Requirements stored + value math **done**; validation before send: Phase 5 | `AGREEMENT_REQUIREMENTS` rule; `feeBreakdown()` (fee rounds down in the heir's favour); `Agreement` model stores before/after values and `rulesApplied` | `tests/unit/rules.test.ts` ("Rule 3") |
| 4 | **Free-claim disclosure** | Text stored as a rule; template enforcement: Phase 4/5 | `DISCLOSURE_TEXT` rule (program name, claim website, wording) | Planned: template lint test (Phase 4) |
| 5 | **No government impersonation** | Planned: Phase 4 | Banned-terms lint on templates | Planned (Phase 4) |
| 6 | **No AI voice, robocalls or cold texts** | **Enforced structurally** | `CommunicationChannel` enum is only `MAIL`, `EMAIL`, `INBOUND_PHONE_NOTE`, so an outbound call or SMS can't be represented. No telephony/SMS SDK is installed | `tests/unit/no-voice-or-sms.test.ts` |
| 7 | **Human approval gate** | Data model + stage guards **enforced**; send gateway + "no code path sends without approval" test: Phase 4 | `Approval` model (approver, time, SHA-256 `contentHash`, `contentSnapshot`); `CONTACTED` requires an approved, sent outbound item and `AGREEMENT_SENT` an approved, sent agreement (both hard blocks) | `tests/unit/stateMachine.test.ts`, `tests/integration/transitions.test.ts` ("CONTACTED is impossible without an approved, sent letter") |
| 8 | **Grief-appropriate tone** | Planned: Phase 4 | LLM tone classifier + banned-phrase list before the approval screen | Planned (Phase 4) |
| 9 | **Data-use limits** | **Enforced for imports**; vendor adapters: Phase 3 | No scraper exists: data enters only as an operator's file upload, and every upload records *where the file came from* (`ImportBatch.source`, required). Each property keeps its raw source row and import batch. People-search will go through an adapter that records the source of every lookup. PII encrypted (`lib/crypto/pii.ts`) | `tests/unit/pii-and-audit.test.ts`, `tests/integration/import.test.ts` |
| 10 | **Audit trail** (append-only) | **Enforced** | Postgres trigger in `prisma/migrations/20261126000000_init/migration.sql` rejects `UPDATE`/`DELETE`/`TRUNCATE` on `audit_logs`; `lib/audit.ts` redacts PII before writing. Logged: stage changes (incl. bulk screening), rule verification, user creation, uploads, queued/completed imports, cases created or extended by an import, owner merges and rejected matches | `tests/integration/audit-log.test.ts`, `tests/integration/transitions.test.ts`, `tests/integration/import.test.ts` |

## Interpretation choices (founder: please confirm)

1. **The first eligible signing day is the day after the 24-month anniversary.**
   The statute voids agreements made during the period *ending* 24 months after
   delivery, so signing on the anniversary itself is treated as inside the void
   period. Setting `firstEligibleDayOffset` to `0` changes this.
2. **Leap-day anniversaries roll forward.** For property delivered on Feb 29,
   the anniversary falls on Mar 1 in non-leap years. This is the later, safer
   date. The 5-year fee tier uses the same rule.
3. **One fee rate per case, capped at the lowest property cap.** If a case mixes
   properties held under and over 5 years, the whole agreement uses 10%.
4. **An unknown delivery date blocks outreach.** The OWNER may override with a
   reason, but the better fix is to get the date from the Division and record it.
5. **"Today" means today in Nevada** (America/Los_Angeles), not UTC.

## Phase 2: ingestion and screening safeguards

| Safeguard | Why | Where | Tests |
|-----------|-----|-------|-------|
| **Partial dates are pushed to the end of the period.** A year-only delivery date ("2019") becomes Dec 31, 2019; a month-only date becomes the month's last day. The property is flagged `DATE_APPROXIMATE` | A later delivery date always means a longer void period (rule 1) and a lower fee tier (rule 2), so the guess can never make us early or overcharge | `lib/normalize/values.ts` (`parseDateCell`) | `tests/unit/normalize.test.ts`, `tests/integration/import.test.ts` |
| **A "report date" column needs explicit confirmation** before it can be used as the delivery date | The 24-month rule runs from delivery to the state, not from the holder's report | `app/(app)/imports/actions.ts` (`startImport`) | E2E mapping flow |
| **Missing delivery dates stay missing** (flag `DELIVERY_DATE_MISSING`), so the case's eligibility is UNKNOWN and outreach stays blocked | Never infer a legal date | `lib/import/row.ts`, `lib/rules/engine.ts` | `tests/integration/import.test.ts` |
| **No automatic merge on weak evidence.** Auto-grouping requires the same street address, or an exact name in the same ZIP. Nicknames, typos, missing addresses → review queue. Conflicting JR/SR or middle initials are never auto-merged | Merging two different people would send outreach to the wrong family (spec 5.1, 5.4) | `lib/match/owner.ts` (`scoreOwnerMatch`) | `tests/unit/match.test.ts`, `tests/integration/import.test.ts` |
| **A merge can't silently lose work.** A provisional case that already has evidence, heirs or communications (or is past SCREENED) is refused and must be merged by hand | Protects research and the audit trail | `lib/import/review.ts` | `tests/integration/import.test.ts` |
| **Amount ranges keep the lower bound** ("$50–$100" → $50, marked "≥"); "under $X" counts as unknown | Expected value and future letters never overstate the amount (rule 8: no exaggerated amounts) | `lib/normalize/values.ts` (`parseAmountCell`) | `tests/unit/normalize.test.ts` |
| **Expected value uses the legal fee cap** at the earliest date an agreement could be signed (10% vs 20% tier) | Projections never assume a fee above the cap (rule 2) | `lib/screening/score.ts` | `tests/unit/score.test.ts` |
| **Bulk screening uses the same guarded transition service** as single moves | No shortcut around the state machine | `app/(app)/cases/actions.ts` (`bulkScreen`) | E2E screening flow |

The priority score and success probability are business heuristics, not legal rules. Their weights are
listed in `lib/screening/score.ts` and should be recalibrated with real outcomes (Phase 7 metrics).

## Other controls in place

- TOTP 2FA is mandatory for every operator. The data-access layer
  (`lib/auth/session.ts`) sends any session without 2FA to `/setup-2fa`.
  Tests: `tests/integration/auth.test.ts` and `tests/e2e/auth.spec.ts`.
- Least-privilege roles (`lib/auth/permissions.ts`). Only the OWNER can approve,
  override, change rules or read the audit log. A RESEARCHER can move cases
  through research stages only. A VIEWER is read-only. Tests:
  `tests/unit/stateMachine.test.ts` and `tests/integration/transitions.test.ts`.
