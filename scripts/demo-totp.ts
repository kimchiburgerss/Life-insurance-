/** Prints the current 6-digit code for the demo accounts (demo secret only). */
import { totp } from "../lib/auth/totp";

const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const secondsLeft = 30 - (Math.floor(Date.now() / 1000) % 30);
console.log(`${totp(DEMO_TOTP_SECRET)}   (valid for ~${secondsLeft}s)`);
