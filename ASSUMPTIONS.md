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
