# Heir Finder: unclaimed life-insurance recovery (Nevada)

An operator console that lets one person do the research, matching, drafting
and case management of a small heir-finding firm. A human stays in the loop for
every outbound contact and every legal document.

> **Status: Phase 1 (Foundation) complete.** See [Build phases](#build-phases).
> Compliance rules and where they are enforced: [COMPLIANCE.md](COMPLIANCE.md).
> Security controls: [SECURITY.md](SECURITY.md).

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
| `npm run evals` | AI eval suites in `/evals` (first suite arrives in Phase 3) |
| `npm run db:migrate` | Apply migrations (`prisma migrate deploy`) |
| `npm run db:seed` | Seed jurisdiction rules, plus fake demo data unless `SEED_DEMO=false` or production |
| `npm run db:reset` | Drop, re-migrate and re-seed the dev database (destructive) |
| `npm run user:create -- --email … --name "…" --role OWNER` | Create a real operator (prompts for a password; 2FA enrolled at first login) |

## Tech stack and why

| Concern | Choice | Notes |
|---------|--------|-------|
| App | **Next.js 16.4** (App Router), React 19, TypeScript 6, Tailwind 4 | **Cache Components is turned off on purpose.** Every page is behind login and shows PII that must be fresh and must never sit in a shared cache |
| Database | **PostgreSQL** + **Prisma ORM 7.10** (`@prisma/adapter-pg`) | Prisma 8 is still a release candidate, and Better Auth supports Prisma ≤ 7. Config lives in `prisma7.config.ts` (the 7.10 naming) |
| Auth | **Better Auth 1.7** (email + password, `twoFactor` TOTP plugin, Prisma adapter) | Chosen over writing our own: session handling, lockout, rate limiting and backup codes come pre-built and are maintained upstream. 2FA is *mandatory*, enforced in `lib/auth/session.ts` |
| PII encryption | Application-level AES-256-GCM + HMAC blind indexes | Simpler and more portable than `pgcrypto` with Prisma; keys never reach the database |
| Jobs | **pg-boss** (Postgres-backed, no Redis) | Installed; first jobs (waiting-period unlocks, follow-ups) arrive in Phases 3–4 |
| Tests | Vitest 5 (unit + integration projects), Playwright 1.63 | |
| AI | Anthropic Claude via the official SDK | Phase 3 |
| Integrations | Adapter interfaces + mocks (mail, email, e-sign, payments, people-search, obituary) | Phases 3–6. `MOCK_MODE=true` by default |

## Project structure

```
app/            Next.js routes: (app)/ operator console, login/, setup-2fa/, api/
components/     Shared UI
lib/
  auth/         Better Auth config, data-access layer, roles, TOTP, provisioning
  case/         Pipeline state machine (pure) + transition service (DB + audit)
  rules/        Jurisdiction rule schemas, engine (pure), repository, seed values
  crypto/       PII encryption + SSN redaction
  audit.ts      Append-only audit writer (redacts PII)
  dates.ts      UTC calendar-date math for legal deadlines
prisma/         schema, migrations (incl. audit-log trigger), seed
tests/          unit/, integration/, e2e/, helpers/
evals/          AI evaluation fixtures (Phase 3+)
scripts/        demo, demo:totp, user:create, evals runner
```

Coming in later phases: `/adapters`, `/prompts`, `/templates`, `OPERATIONS.md`,
`PRIVACY_POLICY_DRAFT.md`.

## Deployment (summary; full guide in Phase 7)

- Any host that runs a Docker image and offers managed Postgres works (Render,
  Fly.io, Railway). Build the `runner` target of the `Dockerfile`. On each
  release, run the `migrate` target with `SEED_DEMO=false`.
- Set `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (your HTTPS URL),
  `PII_ENCRYPTION_KEY`, `PII_HMAC_KEY` and `MOCK_MODE` in the host's secret store.
- Health check: `GET /api/health`.
- Create the first operator with `npm run user:create` from a shell that can
  reach the production database. Never seed demo data in production.

## Build phases

1. **Foundation**: done. Repo, Docker, Postgres + Prisma schema for every model, auth with mandatory TOTP and roles, append-only audit log, Nevada jurisdiction rules engine, case state machine with compliance guards, fake seed/demo data, CI.
2. Ingestion & screening: CSV/XLSX upload + mapping UI, normalization, grouping review queue, priority scoring, pipeline Kanban.
3. Research: death verification, obituary extraction with evals, family tree, heir candidates, research summaries, waiting-period manager.
4. Outreach: templates, AI personalization, tone/lint checks, approval queue, mail/email adapters, follow-ups, do-not-contact.
5. Agreements & portal: agreement generation with validation, e-sign adapter, heir portal with document upload.
6. Claims & billing: claim packet builder, document-review AI, Stripe invoicing, revenue metrics.
7. Hardening: security review, accessibility pass, full E2E suite, deployment guide, `OPERATIONS.md`.

## Upgrading Better Auth

The auth tables in `prisma/schema.prisma` (`User`, `Session`, `Account`,
`Verification`, `TwoFactor`, `RateLimit`) are maintained by hand to match
Better Auth's schema. After upgrading, compare them with the library's release
notes and add a migration if fields changed.
