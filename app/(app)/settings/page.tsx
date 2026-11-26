import type { Metadata } from "next";
import { Alert, Badge, Card } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requireOperator } from "@/lib/auth/session";
import { getBusinessProfile, getOutreachSettings, publicAppUrl } from "@/lib/outreach/settings";
import { currentTemplateVersions } from "@/lib/outreach/templates";
import { emailProviderStatus } from "@/adapters/email/status";
import { mailProviderStatus } from "@/adapters/mail/status";
import { BusinessForm, ClearCounselForm, CounselForm, OutreachForm } from "./settings-forms";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const operator = await requireOperator("case:read");
  const owner = can(operator.role, "rules:manage");
  const [business, settings] = await Promise.all([getBusinessProfile(), getOutreachSettings()]);
  const versions = currentTemplateVersions();
  const counsel = settings.counselApproval;
  const counselCurrent = Boolean(counsel && Object.entries(versions).every(([id, v]) => counsel.templateVersions[id] === v));
  const mail = mailProviderStatus();
  const email = emailProviderStatus();
  const mock = (process.env.MOCK_MODE ?? "true") !== "false";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        {!owner ? <p className="text-sm text-slate-600">Read-only: only the owner can change settings.</p> : null}
      </div>

      <Card title="Business profile">
        {!business ? <Alert tone="warning">Not set yet. Drafting letters is blocked until it is.</Alert> : null}
        <div className="mt-3">
          <BusinessForm initial={business} disabled={!owner} />
        </div>
      </Card>

      <Card title="Outreach">
        <OutreachForm feePercent={settings.feeBps / 100} sendingPaused={settings.sendingPaused} disabled={!owner} />
        <p className="mt-3 text-sm text-slate-600">
          Follow-ups: drafted automatically {settings.followUpLeadDays} days before day {settings.followUpDays.join(" and day ")} after the first
          message; each one needs its own approval. Any reply or opt-out stops them.
        </p>
      </Card>

      <Card title="Counsel approval of templates">
        {counselCurrent ? (
          <Alert tone="info">
            Approved by {counsel!.approvedBy} on {counsel!.approvedOn} for the current template versions.
          </Alert>
        ) : (
          <Alert tone="warning">
            {counsel ? "A template changed since counsel's approval. " : "Not recorded. "}
            {mock ? "Demo mode can send to the mock services, but real sending is blocked until this is recorded." : "Real sending is blocked until this is recorded."}
          </Alert>
        )}
        <div className="mt-3 space-y-4">
          <CounselForm versions={versions} disabled={!owner} />
          {owner && counsel ? <ClearCounselForm /> : null}
        </div>
      </Card>

      <Card title="Sending services">
        <dl className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-2">
            <dt className="w-32 text-slate-600">Letters</dt>
            <dd>
              <Badge tone={mail.ok ? "good" : "bad"}>{mail.ok ? "ready" : "not configured"}</Badge> {mail.name}
            </dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="w-32 text-slate-600">Email</dt>
            <dd>
              <Badge tone={email.ok ? "good" : "bad"}>{email.ok ? "ready" : "not configured"}</Badge> {email.name}
            </dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="w-32 text-slate-600">Lob webhook</dt>
            <dd>
              {process.env.LOB_WEBHOOK_SECRET ? <Badge tone="good">secret set</Badge> : <Badge tone="warn">no secret</Badge>} {publicAppUrl()}/api/webhooks/lob
            </dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="w-32 text-slate-600">Opt-out links</dt>
            <dd>{publicAppUrl()}/u/… (set PUBLIC_APP_URL to your public address)</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-slate-600">Keys are set as environment variables on the server (see .env.example); they are never shown here.</p>
      </Card>
    </div>
  );
}
