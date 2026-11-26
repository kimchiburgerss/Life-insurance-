# Compliance rules → code → tests

The ten hard rules from the build spec, where each one is enforced, and the
test that proves it. "Planned" means the feature it governs doesn't exist yet;
the rule will be enforced in the phase that builds that feature, and this file
will be updated then. (Table updated for Phase 4: outreach.)

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

| # | Rule | Status (Phase 4) | Enforced in | Tests |
|---|------|------------------|-------------|-------|
| 1 | **24-month void period** (NRS 120A.740) | **Enforced** for pipeline stages and outreach. Agreement generation/e-sign gate: Phase 5 | `lib/rules/engine.ts` (`computeEligibleContractDate`, `computeCaseEligibility`); guards on `READY_FOR_OUTREACH`, `CONTACTED`, `AGREEMENT_SENT` in `lib/case/stateMachine.ts` (hard block `VOID_PERIOD_NOT_ELAPSED`); outreach drafting refuses a waiting case and the checklist item `void_period` (no override) is re-checked at approval and again at send time (`lib/outreach/service.ts`, `lib/outreach/gateway.ts`) | `tests/unit/rules.test.ts`, `tests/unit/stateMachine.test.ts`, `tests/integration/transitions.test.ts`, `tests/integration/outreach.test.ts` ("no outreach during the 24-month void period"), `tests/unit/outreach.test.ts` (checklist) |
| 2 | **Fee cap** (10%; 20% if delivered ≥ 5 years before signing) | Calculation **enforced**; letters quote the lower of the configured fee and the case cap, and the checklist blocks a quote above the cap or an unknown cap. Agreement generator refusal: Phase 5 | `lib/rules/engine.ts` (`feeCapBpsForProperty`, `feeCapBpsForCase` uses the *lowest* property cap, `assertFeeWithinCap`); `lib/outreach/service.ts` (`quotedFeeBps`), checklist item `fee` | `tests/unit/rules.test.ts`, `tests/integration/rules-repository.test.ts`, `tests/unit/outreach.test.ts` ("blocks approval when fee fails") |
| 3 | **Agreement content** (in writing, property + services, owner signature, value before/after fee) | Requirements stored + value math **done**; validation before send: Phase 5 | `AGREEMENT_REQUIREMENTS` rule; `feeBreakdown()` (fee rounds down in the heir's favour); `Agreement` model stores before/after values and `rulesApplied` | `tests/unit/rules.test.ts` ("Rule 3") |
| 4 | **Free-claim disclosure** | **Enforced for letters and emails**; agreements: Phase 5 | Every template must contain `{{disclosure}}` (template validation refuses to load one that doesn't); the renderer inserts the active `DISCLOSURE_TEXT` rule verbatim; checklist item `disclosure` verifies the exact text is in BOTH the HTML that is sent and the text version; the FAQ insert repeats the claim website | `tests/unit/outreach.test.ts` ("contains every required element", "renders with the disclosure … verbatim"), `tests/integration/outreach.test.ts` |
| 5 | **No government impersonation** | **Enforced** | Banned-terms lint (`lib/outreach/lint.ts`: official, notice-style wording, government bodies as sender, seals/approval claims) runs on every draft and blocks approval; the only exemptions are the two exact required statements; every message carries "We are a private company. We are not part of, or endorsed by, the State of Nevada or any government agency." (39 U.S.C. 3001(h)); letters use plain HTML with no images, seals or logos | `tests/unit/outreach.test.ts` ("banned-terms lint", "letters … use no images or seals", "flags a government word that is NOT inside the exact required statement") |
| 6 | **No AI voice, robocalls or cold texts** | **Enforced structurally** | `CommunicationChannel` enum is only `MAIL`, `EMAIL`, `INBOUND_PHONE_NOTE`, so an outbound call or SMS can't be represented. No telephony/SMS SDK is installed. The lint also blocks wording that promises outbound calls or texts ("we will call you", "text us"); heirs call a real person, whose notes are logged as inbound | `tests/unit/no-voice-or-sms.test.ts`, `tests/unit/outreach.test.ts` |
| 7 | **Human approval gate** | **Enforced for letters and emails** (agreements: Phase 5) | Only the OWNER approves, after ticking "I have read this whole letter", and only the exact content shown: the approval stores who, when, the SHA-256 of channel + recipient + subject + HTML + text, the text snapshot and the checklist (`approveCommunication`). **`lib/outreach/gateway.ts` is the only code that can send**; it re-verifies the approval (same item, APPROVED, approver still holds the permission, hash recomputed from the stored content) and re-runs the checklist at send time. Postgres triggers (`20261126080000_phase4_send_guards`) refuse any row marked APPROVED/QUEUED/SENT/DELIVERED/RETURNED without a matching approval, refuse edits after approval, and make approvals immutable. Follow-ups each need their own approval | `tests/unit/no-send-without-approval.test.ts` (static: only the gateway imports a provider, calls send, or sets SENT), `tests/integration/outreach.test.ts` ("rule 7: nothing is sent without an approval of the exact content" — 6 scenarios incl. borrowed/rejected approvals and DB-level refusal), `tests/e2e/outreach.spec.ts` |
| 8 | **Grief-appropriate tone** | **Enforced** | AI tone check (`prompts/outreach-tone-check.md`, scores ≥ 4/5 for respectful, pressure-free and plain) runs on every draft and every edit, on the text with names removed; its result is tied to the content hash. Banned-phrase lint blocks pressure (deadlines, "act now", threats of loss) and exaggeration ("up to", "windfall"); amounts are stated exactly as reported ("at least" for ranges, "not shown" when unknown) and any other dollar figure blocks approval; reading level and length are shown (target grade 8) | `tests/unit/outreach.test.ts`, `tests/integration/outreach.test.ts` ("an edit that adds pressure wording turns the checklist red"), `evals/outreach-tone-check` (14 cases) |
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

## Phase 3: research and AI safeguards

| Safeguard | Why | Where | Tests |
|-----------|-----|-------|-------|
| **AI output is a suggestion until a human accepts it.** Obituary extractions, research summaries and tracing estimates are stored as `AiRun` rows with `acceptance = PENDING`; nothing reaches the case (people, death confirmation, score) until an operator accepts. Decisions are audited (`ai.suggestion_accepted/rejected`) | Build spec §6 | `lib/ai/run.ts`, `lib/ai/acceptance.ts`, `lib/research/service.ts` | `tests/integration/research.test.ts` |
| **Minimal, redacted AI input.** Extraction sends only the obituary text; summaries send research facts but no contact details (only "has address: yes/no"). SSN- and ITIN-like numbers are redacted from every AI input and from stored evidence text and notes | Build spec §4, §6 | `lib/ai/run.ts` (`redactInput`), `lib/crypto/pii.ts`, `lib/research/service.ts` | `tests/unit/ai.test.ts`, `tests/integration/research.test.ts` |
| **Every AI call is logged** with prompt name + version, model actually used (fallback included), input hash, redacted input, output, tokens and cost; invalid output is retried once and recorded | Build spec §6 | `lib/ai/run.ts`, `lib/ai/pricing.ts` | `tests/unit/ai.test.ts` |
| **Death needs a cited source** (rule unchanged) and accepting an extraction asks the operator to confirm the obituary is the owner, with a confidence breakdown (name, place, age/birth date, timing) | Build spec 5.3 | `lib/research/death.ts` | `tests/unit/research.test.ts` |
| **Relatives must be quoted.** Each extracted relative carries the exact phrase it came from; quotes not found verbatim are flagged and get lower confidence | Guards against invented heirs | `lib/research/obituary.ts` (`quoteAppears`) | `tests/unit/research.test.ts` |
| **People are never auto-merged.** Possible duplicates are listed; only identical name + relationship links a second source automatically | Build spec 5.4 | `lib/research/service.ts` | `tests/integration/research.test.ts` |
| **Intestate helper is labeled "research aid, not legal advice"** and driven by an unverified `INTESTATE_SUCCESSION` rule (NRS 134 / NRS 123.250) | Build spec 5.4 | `lib/research/intestate.ts`, `lib/rules/jurisdictions.ts` | `tests/unit/research.test.ts` |
| **Data-use limits for people search (rule 9).** Every lookup needs an explicit permissible-purpose confirmation; the purpose (from `PEOPLE_SEARCH_PERMISSIBLE_PURPOSE`) is audited. Results are not stored unless the operator saves one; saved contact details are encrypted and the evidence/audit record lists only which fields were provided | GLBA/DPPA vendor terms | `lib/research/service.ts`, `adapters/people-search` | `tests/integration/research.test.ts` |
| **No scraping.** Death records come from configured adapters (demo source now; licensed vendors such as obituary data feeds or the NTIS Limited Access DMF later) or from text the operator pastes with its link | Rule 9 | `adapters/death-records` | — |
| **Waiting-period automation never forces a move.** Auto-advance and the nightly unlock use the normal guarded transition as a SYSTEM actor; blocked unlocks (e.g. unverified rule) become notifications | Rule 1 | `lib/case/waiting.ts` | `tests/integration/research.test.ts` |

## Phase 4: outreach safeguards

| Safeguard | Why | Where | Tests |
|-----------|-----|-------|-------|
| **Every message says what spec 5.6 requires**: who we are, how we found them (public records), the property as reported, the free claim with the State's website, our fee (only after recovery; nothing if nothing is paid), a real person's phone/email, and the private-company line. Templates missing any element refuse to load | Spec 5.6, rules 4–5 | `lib/outreach/templates.ts` (`REQUIRED_ELEMENTS`), `templates/outreach/*.md` | `tests/unit/outreach.test.ts` |
| **Values can't inject content.** Names, holder names and AI notes are HTML- and Markdown-escaped; raw HTML in templates is dropped; URLs are validated | A crafted name must not add links or text to a letter | `lib/outreach/render.ts` | `tests/unit/outreach.test.ts` ("renderer safety") |
| **Do-not-contact across all cases.** Opt-outs (link, reply STOP, phone) flag the person, add keyed hashes of their email and street address (whole household) to the list, and cancel anything pending to them. Drafting, approval and sending all check the list | Spec 5.6 | `lib/outreach/dnc.ts`, `recordOptOut` in `lib/outreach/service.ts` | `tests/integration/outreach.test.ts` ("do-not-contact and opt-out") |
| **CAN-SPAM for email**: accurate From (the founder's mailbox) and subject, "offer of a paid service" notice, the business's postal address, an opt-out link plus "reply STOP", RFC 8058 one-click `List-Unsubscribe` headers; opt-outs take effect immediately | 15 U.S.C. 7704 | `lib/outreach/render.ts` (footer), `lib/outreach/gateway.ts` (headers), `app/api/unsubscribe/[token]`, `app/u/[token]` | `tests/unit/outreach.test.ts`, `tests/integration/outreach.test.ts` |
| **Stop rules.** Any logged reply cancels the case's pending follow-ups and moves a contacted case to RESPONDED; a returned letter cancels pending letters to that address; an opt-out cancels everything to that person | Spec 5.6 | `logInbound`, `applyLobEvent`, `recordOptOut` | `tests/integration/outreach.test.ts` |
| **Personal notes are AI suggestions** accepted only when the OWNER approves the message (or rejected with it); the AI gets the deceased's name and a relationship word, never contact details, and is told not to mention money, deadlines or invented facts | Build spec §6 | `prompts/outreach-personalization.md`, `lib/outreach/ai.ts` | `tests/integration/outreach.test.ts` |
| **Counsel sign-off is recorded per template version**; real (non-mock) sending is blocked until the OWNER records it, and any template version change requires a new approval | Founder checklist #5 | Settings → Counsel approval, checklist item `counsel` | `tests/unit/outreach.test.ts` |
| **Lob webhooks are signature-verified** (HMAC-SHA256 of timestamp + body, 5-minute freshness) before anything is read; events are idempotent and only move status forward | Public endpoint | `lib/outreach/webhooks.ts`, `app/api/webhooks/lob` | `tests/unit/outreach.test.ts`, `tests/integration/outreach.test.ts` |

## Other controls in place

- TOTP 2FA is mandatory for every operator. The data-access layer
  (`lib/auth/session.ts`) sends any session without 2FA to `/setup-2fa`.
  Tests: `tests/integration/auth.test.ts` and `tests/e2e/auth.spec.ts`.
- Least-privilege roles (`lib/auth/permissions.ts`). Only the OWNER can approve,
  override, change rules or read the audit log. A RESEARCHER can move cases
  through research stages only. A VIEWER is read-only. Tests:
  `tests/unit/stateMachine.test.ts` and `tests/integration/transitions.test.ts`.
