# Heir Finder: unclaimed life-insurance recovery (Nevada)

An operator console that lets one person do the research, matching, drafting
and case management of a small heir-finding firm. A human stays in the loop for
every outbound contact and every legal document.

> **Status: Phase 4 (Outreach) complete.** See [Build phases](#build-phases).
> Compliance rules and where they are enforced: [COMPLIANCE.md](COMPLIANCE.md).
> Security controls: [SECURITY.md](SECURITY.md). Day-to-day procedures (approvals, calls, opt-outs):
> [OPERATIONS.md](OPERATIONS.md). Research findings and open legal questions: [ASSUMPTIONS.md](ASSUMPTIONS.md).

## Quick start (demo, mock mode)

Requirements: Node 22.12+ and either Docker or a local PostgreSQL 15+.

```bash
cp .env.example .env
# Fill in BETTER_AUTH_SECRET, PII_ENCRYPTION_KEY, PII_HMAC_KEY:
#   openssl rand -base64 32   (run once per variable)
npm install
npm run demo        # starts Postgres via Docker if needed, resets + seeds FAKE data, runs the app
```

Open http://localhost:3000 and sign in with a demo account:

| Role | Email | Password |
|------|-------|----------|
| OWNER | owner@example.com | demo-owner-password |
| RESEARCHER | researcher@example.com | demo-researcher-password |
| VIEWER | viewer@example.com | demo-viewer-password |

The second factor for all three demo accounts uses the published secret
`JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP`. Add it to an authenticator app, or run
`npm run demo:totp` to print the current code.

`npm run demo` **wipes the database in `DATABASE_URL`**. Use it only on a local
database.

### Without Docker

Create the databases yourself (`heirfinder`, plus `heirfinder_test` for the
integration tests), point `DATABASE_URL` at the first, then:

```bash
npm run db:migrate && npm run db:seed && npm run dev
```

### Full stack in containers

```bash
docker compose --profile app up --build   # Postgres + migrations/seed + app on :3000
```

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build / server |
| `npm run lint` · `npm run typecheck` | ESLint · TypeScript (after `next typegen`) |
| `npm test` | Unit and integration tests (Vitest) |
| `npm run test:unit` | Pure logic: dates, rules, state machine, crypto (no database) |
| `npm run test:integration` | Against `*_test` database: audit log, transitions, rules, auth |
| `npm run test:e2e` | Playwright: login + 2FA, enrollment, roles, rule verification (needs a seeded DB) |
| `npm run evals` | AI eval suites in `/evals`: scores the rule-based baseline for free. `EVAL_LIVE=1 npm run evals` scores Claude with the current prompt (needs `ANTHROPIC_API_KEY`; costs money, prints the total) |
| `npm run db:migrate` | Apply migrations (`prisma migrate deploy`) |
| `npm run db:seed` | Seed jurisdiction rules, plus fake demo data unless `SEED_DEMO=false` or production |
| `npm run db:reset` | Drop, re-migrate and re-seed the dev database (destructive) |
| `npm run user:create -- --email … --name "…" --role OWNER` | Create a real operator (prompts for a password; 2FA enrolled at first login) |
| `npm run cases:rescore` | Recompute priority scores, expected values and eligibility for all open cases (also runs nightly) |

## Tech stack and why

| Concern | Choice | Notes |
|---------|--------|-------|
| App | **Next.js 16.4** (App Router), React 19, TypeScript 6, Tailwind 4 | **Cache Components is turned off on purpose.** Every page is behind login and shows PII that must be fresh and must never sit in a shared cache |
| Database | **PostgreSQL** + **Prisma ORM 7.10** (`@prisma/adapter-pg`) | Prisma 8 is still a release candidate, and Better Auth supports Prisma ≤ 7. Config lives in `prisma7.config.ts` (the 7.10 naming) |
| Auth | **Better Auth 1.7** (email + password, `twoFactor` TOTP plugin, Prisma adapter) | Chosen over writing our own: session handling, lockout, rate limiting and backup codes come pre-built and are maintained upstream. 2FA is *mandatory*, enforced in `lib/auth/session.ts` |
| PII encryption | Application-level AES-256-GCM + HMAC blind indexes | Simpler and more portable than `pgcrypto` with Prisma; keys never reach the database |
| Jobs | **pg-boss 12** (Postgres-backed, no Redis) | Imports and nightly re-scoring. The worker runs inside the web process (started from `instrumentation.ts` in production, on first enqueue in dev), so one container is enough. Set `RUN_JOBS=false` on extra web instances |
| File parsing | **papaparse** (CSV/TSV) + **read-excel-file** (XLSX) | The npm `xlsx` package (SheetJS 0.18.5) has unpatched advisories and `exceljs` is unmaintained, so neither is used. Old `.xls` files are rejected (save as `.xlsx`) |
| Tests | Vitest 5 (unit + integration projects), Playwright 1.63 | |
| AI | **Claude Opus 5.5** (`claude-opus-5-5`) via the official `@anthropic-ai/sdk` | Structured outputs validated with Zod (one retry on invalid output), server-side refusal fallbacks on, effort set per task (extraction `low`, summaries `medium`), prompt caching on system prompts. Every call is logged as an `AiRun` with prompt version, input hash, redacted input, tokens and cost. Override the model with `AI_MODEL` |
| Integrations | Adapter interfaces + mocks (mail, email, e-sign, payments, people-search, obituary) | Phases 3–6. `MOCK_MODE=true` by default |

## Project structure

```
app/            Next.js routes: (app)/ operator console, login/, setup-2fa/, api/
components/     Shared UI
lib/
  auth/         Better Auth config, data-access layer, roles, TOTP, provisioning
  case/         Pipeline state machine (pure) + transition service (DB + audit)
  rules/        Jurisdiction rule schemas, engine (pure), repository, seed values
  normalize/    Names (ESTATE OF / DECD / C/O / LAST FIRST), USPS-style addresses, dates, amounts, categories
  match/        Owner matching: Jaro-Winkler, Soundex blocking keys, nicknames, decision thresholds
  import/       Upload → mapping → background processing → review-queue decisions
  screening/    Explainable priority score + expected value; re-scoring
  jobs/         pg-boss queue + worker (imports, nightly re-scoring, waiting-period unlocks)
  ai/           Prompt loader, Claude provider, runPrompt (redact → structured output → AiRun), pricing, acceptance
  research/     Obituary extraction, death-match confidence, NV intestate helper, research service
adapters/       death-records, people-search (interface + mock each; real vendors added when contracted)
prompts/        Versioned AI prompts (front-matter header: name, version, effort)
  crypto/       PII encryption + SSN redaction
  audit.ts      Append-only audit writer (redacts PII)
  dates.ts      UTC calendar-date math for legal deadlines
prisma/         schema, migrations (incl. audit-log trigger), seed
tests/          unit/, integration/, e2e/, helpers/
evals/          AI eval suites (obituary-extraction: 20 fictional obituaries + scorer)
demo/           FICTIONAL sample Nevada export for trying the import flow
scripts/        demo, demo:totp, user:create, evals runner
```

Coming in later phases: `/templates`, mail/email/e-sign/payment adapters, `OPERATIONS.md`,
`PRIVACY_POLICY_DRAFT.md`.

## Importing a Nevada list

1. **Imports → Upload a file.** Say where the file came from (it's recorded for data-use compliance).
2. **Map columns.** Common headers are matched automatically; save the mapping to reuse it for the
   next file with the same layout. Click **Preview** to see exactly how rows will be read.
3. **Start import.** It runs in the background. Properties already imported (same state property ID)
   are skipped. Rows with problems are listed with their row number and reason.
4. **Review queue.** Records that *might* be the same person (nicknames, missing address, small typos)
   wait here. Nothing is merged without a human, and JR/SR pairs are never merged automatically.
5. **Screening queue.** Highest priority first. Screen in what's worth researching, close the rest with
   a reason.

Try it with the fictional `demo/sample-nevada-export.csv` (see `demo/README.md` for what each row tests).

## Researching a case

1. **Death verification & sources:** search the configured death-record sources, or paste an obituary
   (and its link). Click **Extract facts with AI**: the suggestion shows the deceased's details, an
   *Is this our owner?* confidence with reasons, and every named relative with the exact quote it came
   from. Tick the relatives to add, confirm it's the owner, and **Accept** — or reject it.
2. **Family & heirs:** the tree and the *who likely has a claim* table (Nevada rules, research aid only)
   update as you confirm people, mark who died first, and link grandchildren/nieces/nephews to their
   parent. Possible duplicates are listed for you to merge; nothing merges on its own.
3. **Contact details:** run the people-search lookup (confirm the permissible purpose) or type them in.
   They're stored encrypted with a record of where they came from.
4. **Research summary:** ask the AI what's known, what's uncertain and the next best step.
5. **Heirs identified:** the case moves itself to the waiting period (or straight to outreach when the
   24 months are over). The nightly job unlocks it on its date and notifies you — see **Calendar** and
   **Notifications**.

## Outreach (letters and emails)

Nothing is sent until **you (the OWNER) approve that exact message**. Mail is the primary channel;
email only where a lawful address was found. There are no calls or texts — heirs call you.

1. **Once:** fill in **Settings → Business profile** (legal name, a real contact person, postal address,
   phone, email) and the fee you quote (always capped by the legal fee cap). Verify the waiting-period,
   fee-cap and disclosure rules in **Jurisdiction rules** — approval stays blocked until they are.
2. On a case that is **Ready for outreach**, click **Draft letter** (or **Draft email**) next to an heir.
   The draft uses the templates in `templates/outreach/`, an AI-written opening line, the State's
   reported amount exactly, the free-claim disclosure and the private-company statement.
3. Open it from **Approvals**: the letter as it will be printed sits beside the **compliance checklist**
   (void period, verified rules, disclosure, fee within cap, banned terms, amounts, tone check, contact
   details, do-not-contact…). Edit the opening line if you like — the checks run again. **Every item
   must be green** to approve; tick "I have read this whole letter" and **Approve and send**.
4. The case moves to **Contacted**. Day-21 and day-45 follow-ups are drafted for you a few days early;
   each needs its own approval. Any reply you log (**Log a reply or call** on the case) stops them, and
   an opt-out puts the person on the **Do not contact** list for every case.

In mock mode letters and emails go to in-memory mocks. For real sending, set `MOCK_MODE=false`, the Lob
key and webhook secret, your SMTP mailbox (`.env.example`), and record counsel's approval of the
template versions in **Settings** — real sending is blocked until you do.

## Deployment (summary; full guide in Phase 7)

- Any host that runs a Docker image and offers managed Postgres works (Render,
  Fly.io, Railway). Build the `runner` target of the `Dockerfile`. On each
  release, run the `migrate` target with `SEED_DEMO=false`.
- Set `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (your HTTPS URL),
  `PII_ENCRYPTION_KEY`, `PII_HMAC_KEY` and `MOCK_MODE` in the host's secret store; for outreach also
  `PUBLIC_APP_URL`, `LOB_API_KEY`, `LOB_WEBHOOK_SECRET` and `SMTP_*`.
- Health check: `GET /api/health`.
- Create the first operator with `npm run user:create` from a shell that can
  reach the production database. Never seed demo data in production.

## Build phases

1. **Foundation**: done. Repo, Docker, Postgres + Prisma schema for every model, auth with mandatory TOTP and roles, append-only audit log, Nevada jurisdiction rules engine, case state machine with compliance guards, fake seed/demo data, CI.
2. **Ingestion & screening**: done. CSV/XLSX upload (up to 50 MB) with auto-suggested, saveable column mapping and a live preview; name/address/date/amount normalization; de-duplication by state property ID; fuzzy owner grouping with a human review queue; explainable 0–100 priority score with expected value; screening queue with bulk actions; pipeline board with filters and search; case page with rule-checked stage moves and timeline.
3. **Research**: done. Death-record source adapter (demo source; licensed vendors plug in), evidence with citations, AI obituary extraction (suggestion → human accept) with an "is this our owner?" confidence breakdown, family tree, Nevada intestate helper (research aid), heir candidates with duplicate review, people-search adapter with permissible-purpose confirmation and encrypted contact storage, AI research summaries and tracing-difficulty estimates (feed the score), AI cost per case, waiting-period auto-advance, nightly unlock job with notifications, calendar.
4. **Outreach**: done. Markdown letter/email templates (first contact, day-21, day-45, public-records FAQ insert) that must contain every required element; safe renderer; AI personal note + AI tone check (with eval set) + banned-terms lint + exact-amount check + reading level; compliance checklist; approval queue with side-by-side preview, edit and reject; single send gateway (Lob letters, SMTP email, mocks) backed by database triggers; auto-move to Contacted; follow-up scheduler; reply/opt-out stop rules; do-not-contact list across cases; one-click unsubscribe; Lob delivery webhooks; Settings (business profile, fee, counsel sign-off, service status); Today view shows approvals and follow-ups due.
5. Agreements & portal: agreement generation with validation, e-sign adapter, heir portal with document upload.
6. Claims & billing: claim packet builder, document-review AI, Stripe invoicing, revenue metrics.
7. Hardening: security review, accessibility pass, full E2E suite, deployment guide, `OPERATIONS.md`.

## Upgrading Better Auth

The auth tables in `prisma/schema.prisma` (`User`, `Session`, `Account`,
`Verification`, `TwoFactor`, `RateLimit`) are maintained by hand to match
Better Auth's schema. After upgrading, compare them with the library's release
notes and add a migration if fields changed.
