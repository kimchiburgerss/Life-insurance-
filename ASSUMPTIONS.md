# Research findings, decisions and open questions

What the build assumes about the law, the State's process and vendors, where each assumption came
from, and what the founder still has to confirm. **Not legal advice** — confirm everything marked
"verify" with the Nevada Unclaimed Property Division and Nevada counsel. Every rule value lives in
`jurisdiction_rules` and ships unverified until you mark it verified in the app.

## The State's process (Nevada Unclaimed Property)

| Topic | What we found | Status | Where it's used |
|-------|---------------|--------|-----------------|
| 24-month void period | NRS 120A.740: an agreement is void if made between presumption of abandonment and 24 months after delivery to the Administrator. The Treasurer's Heir Finder FAQ (Feb 2022) repeats it. | Verify text & effective date | `WAITING_PERIOD` rule, state machine |
| Fee cap | 10% of total value if delivered < 5 years before signing; 20% if ≥ 5 years (SB 71, 2021). Some third-party summaries still quote a flat 10%. | Verify | `FEE_CAP` rule |
| Who the State pays | The Treasurer's Office deals directly with the owner/heir; checks are payable only to the claimant; the State is not a party to finder agreements and won't deduct or pay finder fees. **So the heir is paid and we invoice the heir afterwards** (matches the spec's billing flow). | Found (FAQ) — verify | `CLAIM_REQUIREMENTS` v2, Phase 6 billing |
| Power of attorney | Not accepted for claims — the heir signs the claim form. | Found (FAQ) — verify | `CLAIM_REQUIREMENTS` v2 |
| Notarization | Required on the claimant's signature for claims of $500 and over. | Found (FAQ) — verify | `CLAIM_REQUIREMENTS` v2 |
| Heirs of a deceased owner | Death certificate + proof of relationship; small-estate affidavit when the estate is within the limit (NRS 146.080: $25,000; $100,000 for a surviving spouse, as understood), otherwise letters of administration (probate). | Verify current amounts | `CLAIM_REQUIREMENTS` v2 |
| Finder registration / licensing | The Heir Finder FAQ says there is **no registration** with Unclaimed Property, but the Treasurer's general FAQ cites **NRS 648.012**: the State may require people who help owners claim property to be **licensed private investigators**. | **Open — ask the Nevada Private Investigators Licensing Board and counsel** | Founder checklist |
| Agreement contents | In writing; nature of the property and services; signed by the apparent owner; value before and after the fee; (Treasurer guidance) date delivered to the Administrator. | Verify | `AGREEMENT_REQUIREMENTS` rule (Phase 5) |
| Public claim site | The Treasurer links to claims.nevadaunclaimedproperty.gov; press releases also mention claimitnevada.org / nvup.gov. | Verify the preferred URL | `DISCLOSURE_TEXT` rule |

The official sites (leg.state.nv.us, nevadatreasurer.gov) could not be fetched from the build sandbox,
so the findings above come from search excerpts of those documents. That is why they ship unverified.

## Outreach (Phase 4)

| Topic | Decision | Why |
|-------|----------|-----|
| **Email provider** | Send from the founder's own business mailbox over **SMTP** (Google Workspace / Microsoft 365 / any SMTP host). Mock by default. | Transactional email services forbid unsolicited outreach: Resend's acceptable-use policy bans cold outreach outright, and Postmark and SendGrid are widely reported to prohibit it. Low-volume, one-to-one letters from a real mailbox are the honest fit — keep volume low and follow your mail host's terms. |
| **Email law** | Every outreach email is treated as **commercial** under CAN-SPAM: accurate From/subject, a clear statement that it is an offer of a paid service, the business's **physical postal address**, and a working opt-out (link + "reply STOP") honored immediately (the law allows 10 business days). | FTC CAN-SPAM compliance guide |
| **Physical mail** | **Lob** letters API: HTML letter, `use_type: "marketing"` (it solicits a paid service), `mail_type: "usps_first_class"` (undeliverable mail is returned, so we learn the address is bad), address printed through the envelope window. Mock by default. | Lob API reference (required fields: to, from, file, color, use_type) |
| **No government look-alike** | Every letter and email says **"We are a private company. We are not part of, or endorsed by, the State of Nevada or any government agency."** Templates are linted for banned terms (official notice, seal, government, department, final notice, etc.). | 39 U.S.C. 3001(h) (Deceptive Mailings Prevention Act): solicitations that could be read as government-connected need a conspicuous disclaimer; spec rule 5 |
| **Free-claim disclosure** | Every first letter/email and the agreement include the `DISCLOSURE_TEXT` rule text verbatim. | Spec rule 4 |
| **Amounts** | Only the reported amount (or "not disclosed"); ranges use the lower bound; no rounding up. | Spec rule 8 |
| **Follow-ups** | Day 21 and day 45 drafts are created automatically but **each one still needs an approval**; any reply or opt-out cancels the rest. | Spec 5.6 + rule 7 |
| **Templates** | Ship marked as needing counsel review; real (non-mock) sending is blocked until the OWNER records that counsel approved the current template versions. | Founder checklist #5 |

## Before Phase 5 (agreements, e-sign, heir portal) — assumptions to confirm

These are the defaults Phase 5 will build on unless you say otherwise:

| # | Assumption | Default in the build |
|---|------------|----------------------|
| 1 | **Agreement text** | A plain-English draft marked "DRAFT — must be reviewed by a licensed Nevada attorney before use", generated from a template with every `AGREEMENT_REQUIREMENTS` field (property, services, value before and after the fee, fee %, date delivered to the State, free-claim disclosure, signatures). Your attorney's approved version replaces it; sending real agreements is blocked until counsel approval is recorded, like the letters. |
| 2 | **Who signs** | The heir(s) who will be the claimant(s). Several heirs → one agreement per heir, each for their share. |
| 3 | **Fee** | One rate per case, never above the lowest property cap at the signing date; quoted in the letter and fixed in the agreement. |
| 4 | **E-signature vendor** | Dropbox Sign behind an `ESignProvider` adapter (mock by default). Alternatives: DocuSign, BoldSign. |
| 5 | **Documents from heirs** | Uploaded through a minimal portal (magic link, no password), stored encrypted with expiring links; never by email; never SSNs. |
| 6 | **State pays the heir** | We invoice the heir after the State pays them (the State won't pay finders — see above). |
| 7 | **Licensing** | Still open (NRS 648). The app does not decide this; resolve it before real sending. |

## Phase 5 decisions (agreements and portal)

| Topic | Decision | Why / source |
|-------|----------|--------------|
| E-signature validity | Agreements include an e-signature consent clause and offer paper at no cost | Nevada's UETA (NRS 719) gives e-signatures legal effect only between parties who agreed to transact electronically — confirm with counsel |
| E-sign vendor | Dropbox Sign (non-embedded: the heir gets an email), mock by default, test mode until switched off | Spec suggestion; free test mode. BoldSign's API is cheaper per request and fits the same adapter |
| Cancellation | 10 days after signing by default (Settings), written notice, nothing owed | Heir-friendly default; your attorney sets the final term |
| Governing law | Placeholder "[to be completed by your attorney]" in the DRAFT | Spec 5.7 |
| Business signature | The business profile contact's typed "/s/" signature, adopted when the OWNER approves | Keeps signing to one step for the heir; confirm with counsel |
| Documents | Encrypted in Postgres behind a storage interface; signed 30-minute download links | Spec §7; no extra service for a solo founder |
| Portal access | The link in the letter is the credential (≈99-bit token, expires, revocable); uploads are never shown back | Spec 5.10 ("secure magic-link page") with data minimization |

## Before Phase 6 (claims & billing) — assumptions to confirm

| # | Assumption | Default in the build |
|---|------------|----------------------|
| 1 | **Claim form** | We prepare the Nevada claim for the heir to sign (they are the claimant); the packet's checklist comes from `CLAIM_REQUIREMENTS` v2 (claimant ID, death certificate, relationship proof, small-estate affidavit or letters, agreement copy for our file, notarization ≥ $500). The official claim form itself is filled in the State's portal or on its PDF by the heir — the app tracks it as a checklist item. |
| 2 | **Filing** | The heir (or we, on their behalf where the State allows) files through claims.nevadaunclaimedproperty.gov; the app records filing date, State claim number and outcome. |
| 3 | **Document review AI** | Claude checks uploaded documents for completeness and name/date consistency against the case (suggestions only, human accepts). |
| 4 | **Invoicing** | Stripe invoice to the heir for the agreed fee after they confirm receipt (or the State confirms payment), with reminders at 7/14/30 days; the fee is computed from the amount actually paid, never above the agreement's percentage. |
| 5 | **Revenue metrics** | Collected, outstanding, average days to payment, cost per case. |

## Phase 6 decisions (claims and billing)

| Topic | Decision |
|-------|----------|
| Who files | The **heir is the claimant** and completes and signs the State's claim form (online at claims.nevadaunclaimedproperty.gov, or on paper). We prepare and check the supporting documents, assemble them behind a cover letter, and record the filing. The app never signs or files in the heir's name. |
| Which documents | `CLAIM_REQUIREMENTS` v3, from the Treasurer's claim instructions (UP-9) and deceased-owner fact sheet (UP-23) as quoted in search results: claim form, claimant photo ID, certified death certificate, proof of relationship; **small estate** (whole estate ≤ $25,000, or ≤ $100,000 for a surviving spouse) → small-estate affidavit **UP-45** (spouse: **UP-47**); **no will** → affidavit of heirship **UP-40**; **will** → copy of the will or trust; **probate** → certified court documents; **other heirs** → release **UP-43** from each; notarization for claims of $500 or more. **Unverified**: nevadatreasurer.gov could not be reached from the build environment, so these come from search-result excerpts. The rule ships unverified with a note; check the current forms before relying on it. |
| Mailing address | Unclaimed Property Division, 555 E. Washington Ave., Suite 5200, Las Vegas, NV 89101 (stored in the rule's `filing` parameters, used on the cover letter). **Unverified** — confirm before mailing. |
| Undecided facts | A document that depends on an unanswered question (estate size, will, spouse, other heirs) is shown as *undecided* and blocks assembly — never silently dropped. |
| AI document review | Operator-triggered, one document at a time, PDF/JPEG/PNG/WebP up to 20 MB (HEIC isn't supported by the API: ask for a JPEG or PDF). Results are suggestions; the app adds its own name/date/notarization checks against the case. Demo mode returns a canned review. |
| Packet format | One PDF: cover letter (same renderer as agreements), then each accepted document in checklist order, each page labelled "Enclosure n: …". Photos become full pages. Encrypted or broken PDFs are refused with a request for a new copy. |
| When to bill | Only after the OWNER records the amount the State actually paid the heir, the date and how they know. No automatic billing from the claim approval alone. |
| Fee | Agreement percentage × amount paid to the heir, **rounded down** to the cent, checked against the agreement's cap. Not the reported amount (the State may pay more or less, e.g. with interest or after deductions). |
| Invoicing | Stripe Invoicing, `send_invoice`, due in 30 days; Stripe emails the heir a hosted payment page. Reminders on days 7, 14 and 30 are sent by this app (re-sending the same approved invoice) so every reminder is logged; turn off Stripe's own reminder emails in the Stripe dashboard's invoice settings to avoid doubles. Without Stripe (or by choice) an invoice can be approved as **manual** and marked paid by hand. A wrong invoice is voided and replaced (one live invoice per agreement). |
| Metrics | Funnel from the audit log's stage changes; revenue from paid and open invoices; AI cost from logged AI runs; letters, lookups and e-signatures × the unit costs you enter in Settings (0 until you do, and listed as missing); break-even = monthly fixed cost ÷ margin per closed case. |

## Before Phase 7 (hardening) — assumptions to confirm

| # | Assumption | Default in the build |
|---|------------|----------------------|
| 1 | **Security review** | A structured self-review against OWASP ASVS level 2 (auth, sessions, access control, input handling, files, webhooks, secrets, logging), with fixes: nonce-based Content-Security-Policy, TOTP used-code check (no replay), PII retention purge job, encryption-key rotation script, restricted Stripe key guidance. No external penetration test (recommended before scale; founder's choice). |
| 2 | **Accessibility** | WCAG 2.2 AA for the heir portal and the operator console: automated axe-core checks in the E2E suite on every main page, plus a manual keyboard and screen-reader pass (focus order, labels, contrast, error messages, 200% zoom, mobile width). |
| 3 | **Full E2E suite** | Add the paths not yet covered end to end: opt-out and unsubscribe, returned mail, paper agreement, more-info re-filing, invoice void and re-bill, researcher/viewer permissions, the heir portal at phone width, and the large-text option. Runs in CI against the production build. |
| 4 | **Deployment guide** | Host-neutral Docker guide with **Render** as the worked example (one web service + managed Postgres with daily backups/point-in-time recovery), custom domain with HTTPS, secrets in the host's store, migrations as a release step, webhooks (Lob, Dropbox Sign, Stripe), health check, and **a single app instance** (the background worker runs inside it). Tell me if you prefer Fly.io, Railway or a VPS. |
| 5 | **OPERATIONS.md additions** | Backups (nightly `pg_dump` kept off-site + a quarterly restore drill), key backup and rotation, adding/removing operators, monitoring and alerts, incident response and breach notification (Nevada NRS 603A; PIPEDA breach reporting since the operator is in Ontario), and a pre-launch checklist. |
| 6 | **Data retention** | Contact details of heirs on closed-lost cases purged after 180 days; closed-won case records and invoices kept 7 years (tax/accounting); uploaded documents and claim packets deleted 2 years after the case closes. Founder and counsel to confirm. |
| 7 | **Privacy policy** | `PRIVACY_POLICY_DRAFT.md` for the heir portal and letters (US + PIPEDA), clearly marked as needing legal review. |

## Imports

| Topic | Decision |
|-------|----------|
| Which owners become cases | New uploads default to **only life-insurance, annuity and estate records, life-insurer holders, or names marked deceased/estate** (`caseFilter: RELEVANT`). Every row is still imported and grouped; other owners simply have no case. Choose "every owner" per upload if you want them all screened. |

## Still for the founder to decide

1. Licensing under NRS 648 (above).
2. Mail and email accounts: create a Lob account (test + live keys) and decide which mailbox sends email.
3. Attorney-approved letter, email and agreement text. Letters/emails: record it in Settings → Counsel approval (tied to template versions).
4. People-search and death-data vendors (see `adapters/README.md`).

## Sources

- Nevada Treasurer — Unclaimed Property FAQ: http://www.nevadatreasurer.gov/Unclaimed_Property/FAQ/
- Nevada Treasurer — Heir Finder FAQ (Feb 2022): https://www.nevadatreasurer.gov/uploadedFiles/treasurernvgov/content/Unclaimed_Property/Heir%20Finder%20FAQ's%202.2022.pdf
- NRS 120A.740: https://nevada.public.law/statutes/nrs_120a.740 · SB 71 (2021): https://archive.leg.state.nv.us/Session/81st2021/Bills/SB/SB71_EN.pdf
- NRS Chapter 134 (intestate succession): https://www.leg.state.nv.us/NRS/NRS-134.html
- FTC CAN-SPAM compliance guide: https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
- 39 U.S.C. 3001: https://www.govinfo.gov/content/pkg/USCODE-2023-title39/html/USCODE-2023-title39-partIV-chap30-sec3001.htm
- Resend acceptable use policy: https://resend.com/legal/acceptable-use · Postmark message types: https://postmarkapp.com/support/article/1082-what-types-of-messages-are-a-good-fit-for-postmark
- Lob API reference: https://docs.lob.com/ · Lob letters guide: https://help.lob.com/print-and-mail/designing-mail-creatives/mail-piece-design-specs/letters
- Nevada Treasurer — Claim instruction sheet (UP-9): https://www.nevadatreasurer.gov/uploadedFiles/treasurer.nv.gov/content/Unclaimed_Property/Forms/Claimant/UP-9_Claim_Instruction_Sheet.pdf
- Nevada Treasurer — Deceased owner claims fact sheet (UP-23): https://www.nevadatreasurer.gov/uploadedFiles/treasurer.nv.gov/content/Unclaimed_Property/Forms/Claimant/UP-23_Fact_Sheet_Deceased_Owner_Claims.pdf
- Nevada Treasurer — Unclaimed property claims contact: https://www.nevadatreasurer.gov/Contact/UP_Claims
- Stripe — Invoicing integration quickstart: https://docs.stripe.com/invoicing/integration/quickstart · Sending invoices: https://docs.stripe.com/billing/invoices/sending
- Stripe — Webhook signatures: https://docs.stripe.com/webhooks
