/**
 * Template renderer (pure). Templates are trusted files; variable VALUES are
 * not (heir names, holder names, AI-written notes), so every value is
 * HTML-escaped and Markdown-escaped before Markdown is converted to HTML, and
 * raw HTML in the Markdown is dropped. URLs and email addresses are validated
 * and inserted as autolinks.
 *
 * Output:
 *  - html: exactly what goes to the provider (Lob letter HTML or email HTML);
 *  - text: the plain-text version (sent as the email text part; used for the
 *    checks and the approval snapshot);
 *  - subject (emails).
 * Compliance footers (email: advertisement notice, postal address, opt-out)
 * are added here, not in the templates, so a template edit cannot remove them.
 */
import { createHash } from "node:crypto";
import { Marked } from "marked";
import type { BusinessProfile, PostalAddress } from "./settings";
import { formatPostalAddress } from "./settings";
import { TEMPLATE_VARIABLES, type OutreachTemplate, type TemplateVariable } from "./templates";

export class RenderError extends Error {}

export type MailRecipient = { kind: "MAIL"; name: string; address: PostalAddress };
export type EmailRecipient = { kind: "EMAIL"; name: string; email: string };
export type Recipient = MailRecipient | EmailRecipient;

export type RenderInput = {
  template: OutreachTemplate;
  faqInsert?: OutreachTemplate | null;
  vars: Record<TemplateVariable, string>;
  business: BusinessProfile;
  recipient: Recipient;
  letterDate: string;
};

export type Rendered = { subject: string | null; html: string; text: string };

const URL_VARS = new Set<TemplateVariable>(["optOutUrl", "claimWebsite", "portalUrl"]);
const EMAIL_VARS = new Set<TemplateVariable>(["businessEmail"]);
/** May be empty (the paragraph/line is then dropped). */
const OPTIONAL_VARS = new Set<TemplateVariable>(["personalNote", "contactTitleLine", "firstLetterDate"]);

const SAFE_URL = /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~\/-]*)?$/;
const SAFE_EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Escape a value so Markdown renders it as literal text. */
export function escapeMarkdownValue(value: string): string {
  return escapeHtml(singleLine(value))
    // "#" is left alone mid-text (it is part of entities like &#39;); a leading
    // "#" (heading) is escaped below.
    .replace(/([\\`*_[\]()+!|~{}])/g, "\\$1")
    .replace(/^([-=>#])/, "\\$1")
    .replace(/^(\d+)\./, "$1\\.");
}

function checkedValue(name: TemplateVariable, raw: string): string {
  const v = singleLine(raw ?? "");
  if (!v && !OPTIONAL_VARS.has(name)) throw new RenderError(`Missing value for {{${name}}}`);
  if (v && URL_VARS.has(name) && !SAFE_URL.test(v)) throw new RenderError(`{{${name}}} is not a safe URL`);
  if (v && EMAIL_VARS.has(name) && !SAFE_EMAIL.test(v)) throw new RenderError(`{{${name}}} is not a valid email address`);
  return v;
}

function substitute(source: string, vars: Record<string, string>, mode: "markdown" | "text"): string {
  const known = new Set<string>(TEMPLATE_VARIABLES);
  return source.replace(/\{\{\s*([^}]*?)\s*\}\}/g, (_, name: string) => {
    if (!known.has(name)) throw new RenderError(`Unknown variable {{${name}}}`);
    const v = checkedValue(name as TemplateVariable, vars[name] ?? "");
    if (mode === "text" || !v) return v;
    if (URL_VARS.has(name as TemplateVariable)) return `<${v}>`;
    if (EMAIL_VARS.has(name as TemplateVariable)) return `<${v}>`;
    return escapeMarkdownValue(v);
  });
}

/** Remove paragraphs left empty by optional variables and tidy blank lines. */
function tidy(markdown: string): string {
  return markdown
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const md = new Marked({ gfm: true, breaks: true, async: false });
md.use({ renderer: { html: () => "" } });

function markdownToHtml(markdown: string): string {
  return md.parse(markdown, { async: false }) as string;
}

/** Plain text from template Markdown: drop emphasis/heading markers. */
function markdownToText(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/<(https?:\/\/[^>]+|[^@\s>]+@[^>\s]+)>/g, "$1");
}

function emailFooter(business: BusinessProfile, optOutUrl: string, privateCompany: string) {
  const address = formatPostalAddress(business.mailingAddress).join(", ");
  const lines = [
    `This email is an offer of a paid service from ${business.legalName}, ${address}.`,
    privateCompany,
    `To stop all emails from us, use this link: ${optOutUrl} — or reply with the word STOP.`,
  ];
  const html =
    `<hr style="border:none;border-top:1px solid #ccc;margin:32px 0 16px">` +
    `<p style="font-size:13px;color:#444;line-height:1.5">${escapeHtml(lines[0]!)}<br>${escapeHtml(lines[1]!)}<br>` +
    `To stop all emails from us, use this link: <a href="${escapeHtml(optOutUrl)}">${escapeHtml(optOutUrl)}</a> — or reply with the word STOP.</p>`;
  return { html, text: `\n\n---\n${lines.join("\n")}` };
}

const LETTER_CSS = `
@page { size: 8.5in 11in; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: Georgia, "Times New Roman", serif; font-size: 11pt; line-height: 1.45; color: #000; }
.page { width: 8.5in; box-sizing: border-box; padding: 0.6in 0.8in 0.6in 0.8in; }
.address-zone { height: 3.2in; }
.letterhead { font-size: 9.5pt; color: #222; margin: 0 0 14pt 0; }
.date { margin: 0 0 14pt 0; }
p { margin: 0 0 10pt 0; }
h2 { font-size: 13pt; margin: 0 0 10pt 0; }
.page-break { page-break-before: always; break-before: page; }
`;

/** Render one message. Pure: same input → same output. */
export function renderMessage(input: RenderInput): Rendered {
  const { template, business, recipient } = input;
  if (template.channel === "INSERT") throw new RenderError("Inserts are rendered as part of a message.");
  if (template.channel !== recipient.kind) throw new RenderError(`A ${template.channel} template needs a ${template.channel} recipient.`);
  const vars = input.vars as Record<string, string>;

  const bodyMd = tidy(substitute(template.body, vars, "markdown"));
  const bodyText = tidy(markdownToText(substitute(template.body, vars, "text")));
  const faqMd = input.faqInsert && template.includesFaqInsert ? tidy(substitute(input.faqInsert.body, vars, "markdown")) : null;
  const faqText = input.faqInsert && template.includesFaqInsert ? tidy(markdownToText(substitute(input.faqInsert.body, vars, "text"))) : null;
  const bodyHtml = markdownToHtml(bodyMd);
  const faqHtml = faqMd ? markdownToHtml(faqMd) : null;

  if (template.channel === "EMAIL") {
    const subject = singleLine(substitute(template.subject ?? "", vars, "text")).slice(0, 200);
    if (!subject) throw new RenderError("Email subject is empty.");
    const footer = emailFooter(business, vars.optOutUrl!, vars.privateCompany!);
    const html =
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;background:#ffffff">` +
      `<div style="max-width:600px;margin:0 auto;padding:24px;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.55;color:#111">` +
      bodyHtml +
      (faqHtml ? `<hr style="border:none;border-top:1px solid #ccc;margin:28px 0">${faqHtml}` : "") +
      footer.html +
      `</div></body></html>`;
    const text = `${bodyText}${faqText ? `\n\n---\n${faqText}` : ""}${footer.text}\n`;
    return { subject, html, text };
  }

  const letterhead = [business.legalName, business.phone, business.email, business.website].filter(Boolean).map((s) => escapeHtml(s!)).join(" · ");
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${LETTER_CSS}</style></head><body>` +
    `<div class="page"><div class="address-zone"></div>` +
    `<p class="letterhead">${letterhead}</p>` +
    `<p class="date">${escapeHtml(input.letterDate)}</p>` +
    bodyHtml +
    `</div>` +
    (faqHtml ? `<div class="page page-break">${faqHtml}</div>` : "") +
    `</body></html>`;
  const text = `${input.letterDate}\n\n${bodyText}${faqText ? `\n\n---\n${faqText}` : ""}\n`;
  return { subject: null, html, text };
}

/**
 * For the approval screen only: show what the envelope window will show. The
 * mail vendor prints the return and recipient addresses in the blank address
 * zone at the top of page 1 (Lob address_placement "top_first_page").
 */
export function letterPreviewHtml(html: string, from: { name: string; address: PostalAddress }, to: MailRecipient): string {
  const block = (name: string, a: PostalAddress) => [name, ...formatPostalAddress(a)].map(escapeHtml).join("<br>");
  const zone =
    `<div class="address-zone" style="position:relative;outline:1px dashed #94a3b8">` +
    `<div style="position:absolute;top:0;left:0;font-size:9pt">${block(from.name, from.address)}</div>` +
    `<div style="position:absolute;top:1.4in;left:0;font-size:11pt">${block(to.name, to.address)}</div>` +
    `<div style="position:absolute;bottom:4px;right:0;font:8pt sans-serif;color:#64748b">Printed by the mail vendor in the envelope window</div>` +
    `</div>`;
  return html.replace(`<div class="address-zone"></div>`, zone);
}

/** Canonical recipient string — part of what is approved. */
export function recipientKey(r: Recipient): string {
  return r.kind === "MAIL"
    ? JSON.stringify(["MAIL", r.name, r.address.line1, r.address.line2 ?? "", r.address.city, r.address.state, r.address.zip])
    : JSON.stringify(["EMAIL", r.name, r.email.toLowerCase()]);
}

/**
 * SHA-256 of everything that is approved: channel, recipient, subject, HTML and
 * text. The send gateway refuses to send unless the approval holds this hash.
 */
export function contentHashOf(input: { channel: string; recipient: Recipient; subject: string | null; html: string; text: string }): string {
  return createHash("sha256")
    .update(JSON.stringify([input.channel, recipientKey(input.recipient), input.subject ?? "", input.html, input.text]))
    .digest("hex");
}

/** Visible text of an HTML document (for verifying required statements in what is actually sent). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|title)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|h\d|li|ul|ol|div|hr|table|tr|td|body|html|head)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}
