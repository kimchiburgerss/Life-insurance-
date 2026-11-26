# Operations

Day-to-day procedures for running the business with this app. Phase 7 adds deployment, backups and
incident response. **Not legal advice** — where a step depends on the law, ASSUMPTIONS.md says what
to confirm with Nevada counsel.

## Daily routine (15–30 minutes)

1. Open **Today**: approvals waiting, follow-ups due this week, failed sends, cases unlocked overnight.
2. **Approvals**: review each draft (see below). Approve, edit the opening line, or reject with a reason.
3. **Notifications**: opt-outs, returned letters, cases unlocked or blocked overnight.
4. Log every call, email reply or letter you received on its case (**Log a reply or call**).

## Reviewing a letter or email

Open it from **Approvals**. The left side is exactly what will be printed or emailed; the right side is
the compliance checklist. Before you approve, read the whole message and ask:

- Is this the right person? (Name, address, relationship — compare with the case's sources.)
- Is the opening line kind and true? Edit it if anything is guessed. Do not add money, dates or urgency.
- Is every checklist item green? If not, fix the cause (verify a rule, complete Settings, correct the
  address, re-draft) — there is no override for outreach.

Approve only when you would be comfortable with the heir reading it on the worst day of their year.
Reject anything you would not sign personally; the reason is kept with the case.

Follow-ups (day 21 and day 45) arrive in the same queue a few days early. They go out on their date once
approved. Any reply or opt-out cancels them automatically.

## Handling an inbound call from an heir

Heirs call the number in the letter. **Only a person answers** — never use an automated or AI voice
(compliance rule 6). Keep the case open on screen.

**Call script** (adapt in your own words; keep it calm and unhurried):

1. **Greet and identify yourself.** "Thank you for calling. This is [your name] with [business name]."
2. **Find the case.** "May I have the reference number on the letter, or the name of your relative?"
   Search the case reference (e.g. NV-000123) in **Pipeline**.
3. **Acknowledge the loss** if appropriate. "I'm sorry about [name]."
4. **Explain plainly.** "The State of Nevada's public list shows [property] in [name]'s name. We found
   your name through public records."
5. **Say the free option first.** "You can claim this yourself, for free, from the Nevada State
   Treasurer's Unclaimed Property Division at claims.nevadaunclaimedproperty.gov. You don't need us."
6. **Describe the service only if asked or if they want help.** "If you'd like help, we gather the
   paperwork and prepare the claim with you. Our fee is [x]% of what the State pays you, only after you
   receive it. If nothing is paid, you owe nothing. You can take as long as you like to decide."
7. **Never ask for** a Social Security number, bank details or passwords on the phone or by email.
   Documents are sent through their private page (the link is in our letter).
8. **Close.** "Would you like me to send you our agreement to read, or would you rather think about
   it?" If they want no further contact: "Of course — I'll make sure you don't hear from us again."
9. **Log the call** right away: case → **Log a reply or call** → "They called us", a short summary (no
   SSNs), and tick *asked us not to contact them* if they did.

Logging a reply stops all pending follow-ups on the case and moves a contacted case to **Responded**.

Do not pressure, do not promise amounts or timelines, and do not say or imply you work for the State.

## Agreements

1. The heir says they want help (call, email reply, or a message in their portal) → the case is at
   **Responded**. Make sure their mailing address is right (it goes in the agreement); add an email if
   they want to sign electronically (or they can add it in the portal).
2. Case → **Agreements** → pick the heir → **Prepare agreement**. The fee defaults to your Settings fee
   and can't exceed the legal cap. If generation refuses (void period, unknown amount, missing date),
   fix the cause — e.g. ask the Unclaimed Property Division for the exact amount and record it.
3. Read the whole PDF beside its checks. Choose **electronically** (the heir gets an email from Dropbox
   Sign) or **on paper**, tick the box and **Approve and send**.
4. Paper: download the PDF, print two copies, mail them with a stamped return envelope. When the signed
   copy comes back, open the agreement and **Record paper signature** (scan or photo + the date they
   signed). A date before the eligible date is refused (it would be void).
5. When it's signed the case moves to **Agreement signed**; the signed copy is stored with the case.
   If the heir declines or changes their mind, cancel the agreement (an e-sign request is withdrawn).

Before real use: upload your attorney's agreement text in **Settings → Agreements** and switch it on.
Until then every page says DRAFT, and real e-signature requests stay in Dropbox Sign test mode.

## The heir portal and documents

- Every letter includes the heir's private link. If a letter went to the wrong person, **revoke** the link
  on the case page (Heir portal links); the next letter carries a new one.
- Uploaded documents appear on the case under **Documents from heirs**. Open each one (the link expires
  after 30 minutes), then mark it **Looks good** or **Ask for a new copy** with a short note — the heir
  sees the note on their page.
- Messages and call-back requests from the portal arrive as replies on the case (and in Notifications).
  Call back from your own phone; never use automated calls or texts.
- If a document shows a Social Security number, ask the heir for a copy with it covered; we never need it.

## Opt-outs and the do-not-contact list

- **Opt-out link** (in every letter and email) and the email one-click unsubscribe take effect
  immediately: the person is flagged, their email and street address are added to the list, and
  anything pending to them is cancelled. You get a notification.
- **Phone, letter or "STOP" email reply:** log it on the case with *asked us not to contact them*.
- **Someone not in any case** (e.g. a relative calls on behalf of the family): add them on
  **Do not contact** with a reason.
- The list is checked when drafting, approving and sending, on every case. An address entry blocks
  letters to anyone at that address (the household). Removing an entry needs the OWNER and a reason.

## Returned mail

When Lob reports a letter returned to sender, the letter is marked **returned**, pending letters to that
address are cancelled, and you are notified. Re-research the address (people-search, case sources),
save the new address on the heir, and draft a fresh first letter.

## Failed sends

A failed send (provider error) appears on **Today** and **Approvals**. Open it, read the error, and
**Retry sending** (same approved content — no re-approval needed) or cancel it. If the case changed
since approval (opt-out, reply, rule unverified), the gateway refuses to send and says why.

## Before real (non-mock) sending

1. Nevada counsel reviews `templates/outreach/*.md` (and later the agreement). Record the approval in
   **Settings → Counsel approval** (name, date) — it is tied to the template versions; changing a
   template requires a new approval.
2. Resolve the open questions in ASSUMPTIONS.md, especially private-investigator licensing (NRS 648).
3. Lob: create an account, set `LOB_API_KEY` (start with a `test_` key) and a webhook to
   `<PUBLIC_APP_URL>/api/webhooks/lob` with its secret in `LOB_WEBHOOK_SECRET`.
4. Email: create an app password for your business mailbox and set `SMTP_*`. Keep volume low.
5. Set `PUBLIC_APP_URL` to the public HTTPS address (opt-out links must work without logging in).
6. Set `MOCK_MODE=false`, then send one letter to yourself first.
