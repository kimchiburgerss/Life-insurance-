/**
 * Compliance rule 6: no AI voice calls, robocalls or cold texts.
 * Enforced structurally — the data model cannot represent an outbound call or
 * SMS, and no telephony/SMS SDK may be installed.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CommunicationChannel } from "@/lib/generated/prisma/enums";

const TELEPHONY_PACKAGES = [
  /^twilio$/,
  /^@twilio\//,
  /^@vonage\//,
  /^vonage$/,
  /^plivo/,
  /^telnyx/,
  /^@signalwire\//,
  /^messagebird/,
  /^@sinch\//,
  /^@bandwidth\//,
  /^bandwidth-sdk/,
  /^@aws-sdk\/client-(sns|pinpoint|connect|chime)/,
  /^elevenlabs/,
  /^@elevenlabs\//,
  /^@vapi-ai\//,
  /^retell-sdk/,
  /^bland/,
];

describe("rule 6 — no outbound calls or texts", () => {
  it("communication channels are only mail, email and inbound phone notes", () => {
    expect(Object.values(CommunicationChannel).sort()).toEqual(["EMAIL", "INBOUND_PHONE_NOTE", "MAIL"]);
  });

  it("no telephony, SMS or synthetic-voice SDK is a dependency", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as Record<string, Record<string, string>>;
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const offenders = deps.filter((d) => TELEPHONY_PACKAGES.some((re) => re.test(d)));
    expect(offenders).toEqual([]);
  });
});
