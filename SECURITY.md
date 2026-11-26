# Security

This file describes the security controls in place after **Phase 1** and what
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
| Containers | Multi-stage image, non-root user, no build tools in the runtime image | `Dockerfile` |
| Secrets | Only in environment variables / the host's secret store. `.env` is git-ignored | `.env.example` |

## Known gaps (planned)

- **TOTP replay window.** The auth library doesn't remember used codes, so one
  code can be reused within its ~30–90 s window. The password requirement,
  lockout and rate limit reduce the risk. Phase 7 will add a used-code check.
- **Encrypted object storage + signed, expiring URLs** for uploaded documents
  (Phase 5, heir portal).
- **Portal rate limiting** (Phase 5) and a **Content-Security-Policy** with nonces (Phase 7).
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
