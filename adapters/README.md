# Adapters

Every third-party integration sits behind an interface with a **mock** implementation, so the whole app
runs with `MOCK_MODE=true` and no paid accounts. Real implementations are added once the founder has
signed the vendor's terms (permissible use, data licensing).

| Adapter | Interface | Mock | Real candidates (founder decides) |
|---------|-----------|------|-----------------------------------|
| `death-records/` | `DeathRecordSource.search()` | Fictional demo obituaries | Licensed obituary data (e.g. Berwyn Group), NTIS Limited Access Death Master File (requires certification under 15 CFR 1110) |
| `people-search/` | `PeopleSearchProvider.lookup()` | Fictional contact details | Licensed skip-tracing vendors with GLBA/DPPA permissible-use terms (e.g. TLOxp, Accurint, idiCORE) |
| `mail/` | `MailProvider.sendLetter()` | Records the letter in memory; nothing is printed | **Lob** (`LOB_API_KEY`): HTML letter, First-Class, `use_type: marketing`, idempotency key = message id, delivery webhooks |
| `email/` | `EmailProvider.send()` | Records the email in memory; nothing is sent | **SMTP from your own business mailbox** (`SMTP_*`). Transactional ESPs (Postmark, SendGrid, Resend) prohibit unsolicited outreach, so they are not used |
| `esign/` | `ESignProvider.send()`, `downloadSigned()`, `cancel()` | Keeps requests in memory; the heir signs on a demo form in the portal (not binding) | **Dropbox Sign** (`DROPBOX_SIGN_API_KEY`): non-embedded signing (the heir gets an email), text tags place the signature/date fields, callbacks verified by event hash. BoldSign's API is cheaper per request and would fit the same interface |
| payments | Phase 6 | | |

**E-signature providers may only be used by `lib/agreements/gateway.ts`. Mail and email providers may only be used by `lib/outreach/gateway.ts`** (the approval-checking send
gateway). `tests/unit/no-send-without-approval.test.ts` fails if any other module imports them. Screens use
`adapters/<x>/status.ts`, which reports configuration without being able to send.

Rules for every real adapter: no scraping of sites whose terms forbid it, record the source of every
result, and use results only to locate heirs for the specific case (COMPLIANCE.md rule 9).
