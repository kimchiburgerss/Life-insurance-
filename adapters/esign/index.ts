import "server-only";
import { DropboxSignProvider } from "./dropbox-sign";
import { MockESignProvider } from "./mock";
import type { ESignProvider } from "./types";

export type { ESignEvent, ESignEventType, ESignProvider, SignatureRequest } from "./types";
export { MockESignProvider };

/** Mock in MOCK_MODE; Dropbox Sign when DROPBOX_SIGN_API_KEY is set; otherwise none (paper signing still works). */
export function getESignProvider(): ESignProvider | null {
  if ((process.env.MOCK_MODE ?? "true") !== "false") return new MockESignProvider();
  const key = process.env.DROPBOX_SIGN_API_KEY;
  return key ? new DropboxSignProvider(key, process.env.DROPBOX_SIGN_TEST_MODE !== "false") : null;
}
