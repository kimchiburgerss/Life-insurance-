# Security

This file describes the security controls in place after **Phase 4** and what
is still to come. The full security review is Phase 7.

## Controls in place

| Area | Control | Where |
|------|---------|-------|
| Authentication | Email + password (scrypt hash, min 12 chars) **plus mandatory TOTP**. Public sign-up is disabled; operators are created with `npm run user:create` | `lib/auth/server.ts`, `lib/auth/session.ts`, `scripts/create-user.ts` |
| 2FA enforcement | A session whose user hasn't enrolled TOTP can only reach `/setup-2fa`. Backup codes are encrypted at rest. After 5 failed codes the account is locked for 15 minutes | `lib/auth/session.ts`, Better Auth `twoFactor` plugin |
| Brute force | Database-backed rate limit: 5 sign-in / 2FA attempts per IP per minute (`AUTH_ATTEMPTS_PER_MINUTE`) and 100 requests/min on other auth routes | `lib/auth/server.ts` |
| Sessions | 12-hour sessions stored in the database (revocable). httpOnly, SameSite=Lax cookies, `Secure` in production | Better Auth config |
| CSRF | Better Auth rejects auth requests from untrusted origins (`BETTER_AUTH_URL`). Next.js server actions check the Origin header | `lib/auth/server.ts` |
| Authorization | Least-privilege roles (OWNER / RESEARCHER / VIEWER) checked server-side on every page and action through the data-access layer. The proxy only does an optimistic redirect | `lib/auth/permissions.ts`, `lib/auth/session.ts`, `proxy.ts` |
| PII at rest | Heir email, phone and address are AES-256-GCM encrypted per field with versioned ciphertext. Equality lookups use HMAC-SHA256 blind indexes under a **separate** key. SSNs are never stored | `lib/crypto/pii.ts`, `prisma/schema.prisma` (`*Enc`, `*Hash`) |
| Audit | Append-only audit log enforced by a database trigger. PII and secrets are redacted before writing | `lib/audit.ts`, init migration |
| Headers | HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, restrictive `Permissions-Policy`; `X-Powered-By` removed; `robots.txt` disallows indexing | `next.config.ts`, `public/robots.txt` |
| Caching | Cache Components is off, so PII is never put in a shared server cache | `next.config.ts` |
| File uploads | Authenticated route (`import:run` permission, 2FA required); type checked by extension and parsed with maintained parsers (papaparse, read-excel-file); size limit (`IMPORT_MAX_MB`, default 50 MB) and row limit (500,000). The route is excluded from the proxy because the proxy would silently drop body bytes past 10 MB. Raw files are deleted from the database once processed; the same file can't be imported twice by accident (SHA-256 check) | `app/api/imports/route.ts`, `lib/import/*` |
| Dependencies | `npm audit` clean. The `effect` package (pulled in by the Prisma CLI) is pinned to the patched 3.22.5 via `overrides` (ReDoS advisory GHSA-7589-6fvf-x4pw) | `package.json` |
| AI provider | Calls go to the Anthropic API only when `MOCK_MODE=false`. Inputs are minimized per task and SSN/ITIN-like numbers are redacted; contact details are never sent. Anthropic's API data-retention terms apply to what is sent — review them for your agreement | `lib/ai/*` |
| Heir contact details | Stored only after an operator saves them; AES-256-GCM encrypted; the source evidence and audit entries record which fields were provided, never the values | `lib/research/service.ts` |
| Outbound messages | Only `lib/outreach/gateway.ts` can reach the mail/email providers (enforced by a static test); it re-verifies the OWNER's approval of the exact content and re-runs the compliance checklist at send time. Database triggers refuse "sent" rows without a matching approval, edits after approval, and any change to an approval | `lib/outreach/gateway.ts`, `20261126080000_phase4_send_guards` |
| Recipient data in messages | The recipient (name + address/email) is stored AES-256-GCM encrypted with each message; letter/email bodies hold only the heir's name. Approval snapshots hold the text, not the address. The tone check sends the text to the AI with names replaced by "[NAME]" | `lib/outreach/service.ts` |
| Public endpoints | Only three: `/u/<token>` and `POST /api/unsubscribe/<token>` (opt-out; 16-character random token ≈ 79 bits, same response for unknown tokens, reveals nothing about the case) and `POST /api/webhooks/lob` (HMAC-SHA256 signature over timestamp + raw body with `LOB_WEBHOOK_SECRET`, 5-minute freshness window, 256 KB body limit, idempotent per event id). Everything else requires a 2FA session | `app/u`, `app/api/unsubscribe`, `app/api/webhooks/lob`, `proxy.ts` |
| Email sending credentials | SMTP user/password and the Lob key live only in environment variables; Settings shows whether each is configured, never the value | `adapters/email`, `adapters/mail`, `app/(app)/settings` |
| Letter preview | Rendered inside a sandboxed iframe (`sandbox=""`: no scripts, no same-origin access); all variable values are HTML- and Markdown-escaped and template HTML is dropped | `app/(app)/outreach/[id]/page.tsx`, `lib/outreach/render.ts` |
| Containers | Multi-stage image, non-root user, no build tools in the runtime image | `Dockerfile` |
| Secrets | Only in environment variables / the host's secret store. `.env` is git-ignored | `.env.example` |

## Known gaps (planned)

- **TOTP replay window.** The auth library doesn't remember used codes, so one
  code can be reused within its ~30–90 s window. The password requirement,
  lockout and rate limit reduce the risk. Phase 7 will add a used-code check.
- **Encrypted object storage + signed, expiring URLs** for uploaded documents
  (Phase 5, heir portal).
- **Portal rate limiting** (Phase 5) and a **Content-Security-Policy** with nonces (Phase 7). The public opt-out endpoints rely on token entropy rather than a rate limit; a per-IP limit comes with the portal work.
- **PII retention purge** for closed-lost cases, default 180 days (`Person.piiPurgedAt` is ready; job arrives with the background worker).
- **Key rotation** for `PII_ENCRYPTION_KEY` (the `v1:` prefix allows it; tooling in Phase 7).
- **Backups:** nightly `pg_dump` procedure and restore drill (Phase 7, `OPERATIONS.md`).
- `PRIVACY_POLICY_DRAFT.md` (US + Canadian PIPEDA, operator in Ontario) comes in Phase 7 and is marked as needing legal review.

## Operational rules

- Never put real data in a non-production database, and never put the demo
  accounts (`*@example.com`) in production. `npm run db:seed` refuses demo data
  when `NODE_ENV=production`.
- Back up `PII_ENCRYPTION_KEY` and `PII_HMAC_KEY` separately from database
  backups. Without the key, encrypted contact details can't be recovered.

## Reporting a vulnerability

Email the founder directly. Do not open a public issue.
