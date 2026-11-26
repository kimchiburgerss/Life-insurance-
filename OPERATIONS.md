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

## Building and filing a claim

The heir is the claimant: they complete and sign the State's claim form. We prepare everything else,
check it, and keep the case moving. The checklist comes from the Nevada `CLAIM_REQUIREMENTS` rule
(verify it in **Jurisdiction rules** — the form numbers and thresholds are from the Treasurer's
published guidance and ship unverified).

1. **Start the packet** (case → Claim → *Start claim packet*) once the agreement is signed.
2. **Answer the estate questions.** Ask the heir (or their attorney):
   - Was the owner's estate probated, or is the whole estate small enough for an affidavit? (Nevada
     small-estate thresholds per the Treasurer's guidance: $25,000, or $100,000 when the claimant is the
     surviving spouse.) Small estate → UP-45 (UP-47 for a spouse). Probate → certified letters from the court.
   - Was there a will or trust? No → affidavit of heirship (UP-40). Yes → a copy of the will or trust.
   - Are there other heirs who must release their share to this claimant? Yes → a release (UP-43) from each.
   Leave a question on *Not confirmed yet* rather than guessing — the documents it controls stay
   visible as *undecided* and the packet can't be assembled until you answer.
3. **Collect documents.** Ask the heir to upload them on their page, or upload what they mail or email
   you (*Upload for the heir*). For each one: open it, optionally **Check with AI**, then **Accept** or
   **Ask for a new copy** (with a note the heir will see). Check especially: the owner's name and date of
   death match the case; affidavits are signed and notarized; the claimant's ID is current and their
   name matches.
4. If a required document truly isn't needed (e.g. the State told you so), mark it **Not needed** with
   the reason; **Waive** is for the OWNER and is logged.
5. **Assemble packet PDF**, read every page (cover letter, then each document, labelled at the
   bottom), tick the box and **Approve packet**. If anything changes after that, start a new packet.
6. **Filing.** Online: sit with the heir (phone or video) while they complete and sign the claim at
   claims.nevadaunclaimedproperty.gov and upload the packet's documents; note the claim ID the site
   gives. On paper: the heir signs the claim form (notarized for claims of $500 or more), and you mail
   it with the printed packet to the Unclaimed Property Division (address on the cover letter) by a
   trackable service. Then **Record the filing**. The case moves to **Claim filed**.
7. **The State's decision.** When the heir or the State tells you, **Record the State's decision**:
   - *Approved* → case **Claim approved**. The State pays the heir directly.
   - *More information needed* → note exactly what they asked for. Start a new packet with the extra
     documents, approve it, and record the new filing; the case returns to **Claim filed**.
   - *Denied* → note the reason. Decide with the heir whether to fix and refile (start a new packet;
     approving it moves the case back to **Claim packet prepared**) or close the case as **Closed
     ineligible** with the reason.

## Fee invoices and getting paid

1. **Only after the heir has the money.** When the heir (or the State) confirms the payment, open the
   case → **Billing**, pick the agreement, enter the amount the State paid, the date, and how you know
   (e.g. "Heir emailed a photo of the State's check stub"). The case moves to **Paid to heir** and a
   draft invoice is prepared: the agreement's percentage of that amount, rounded down to the cent.
2. **Approve the invoice** (Approvals, or the invoice page). Check the name, the email, the amount and
   the text. Choose:
   - **Stripe** — the heir receives an email with a secure payment page (card or bank). Needs an email
     address on file.
   - **Manual** — you send the invoice yourself (letter or email) and record the payment when it
     arrives.
   The case moves to **Fee invoiced**.
3. **Reminders** go out automatically on days 7, 14 and 30 after sending (Stripe re-sends the same
   invoice). For manual invoices you get a notification instead — send a short, kind note yourself.
   Never add late fees or pressure, and never call or text about the fee unless the heir asked you to.
4. **Paid.** Stripe payments are recorded automatically from the webhook. For checks or bank transfers,
   **Mark as paid** with the date and a note. When nothing is left open the case moves to **Fee
   collected**.
5. **Close the case**: case page → move to **Closed won**.
6. **Mistakes and disputes.** If the amount paid was entered wrongly, or the heir disputes it and they
   are right, **Void** the invoice (an open Stripe invoice is withdrawn) and record the payment again
   with the corrected figures; a new invoice is prepared for approval. A paid invoice can't be voided —
   refund in Stripe and note it on the case.
7. **Metrics**: keep your unit costs current in **Settings → Your costs** (per letter, per lookup, per
   e-signature, monthly hosting) so cost per case and break-even are real numbers.

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
7. Stripe: set `STRIPE_SECRET_KEY` (start with a test key; a restricted key is better) and add a webhook
   endpoint `<PUBLIC_APP_URL>/api/webhooks/stripe` for the `invoice.paid`, `invoice.voided`,
   `invoice.marked_uncollectible` and `invoice.payment_failed` events; put its signing secret in
   `STRIPE_WEBHOOK_SECRET`. Turn off Stripe's own invoice reminder emails (the app sends the 7/14/30-day
   reminders itself). Send one test invoice to yourself first.
8. Verify the `CLAIM_REQUIREMENTS` rule against the Treasurer's current claim instructions (forms
   UP-40/43/45/47, thresholds, notarization) and mark it verified in **Jurisdiction rules**.
