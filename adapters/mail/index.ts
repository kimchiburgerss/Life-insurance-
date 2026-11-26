import "server-only";
import { LobMailProvider } from "./lob";
import { MockMailProvider } from "./mock";
import type { MailProvider } from "./types";

export type { LetterRequest, LetterResult, MailAddress, MailProvider } from "./types";

/** Mock in MOCK_MODE; Lob when LOB_API_KEY is set; otherwise none (sending is blocked). */
export function getMailProvider(): MailProvider | null {
  if ((process.env.MOCK_MODE ?? "true") !== "false") return new MockMailProvider();
  const key = process.env.LOB_API_KEY;
  return key ? new LobMailProvider(key) : null;
}
