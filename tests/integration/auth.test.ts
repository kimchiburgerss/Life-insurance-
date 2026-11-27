import { afterAll, describe, expect, it } from "vitest";
import { auth } from "@/lib/auth/server";
import { totp } from "@/lib/auth/totp";
import { prisma } from "@/lib/db";
import { makeUser } from "../helpers/factories";

afterAll(() => prisma.$disconnect());

const BASE = "http://localhost:3000/api/auth";
let ipCounter = 0;

function post(path: string, body: unknown, cookie?: string) {
  return auth.handler(
    new Request(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        // A distinct client IP per call so the auth rate limiter doesn't interfere.
        "x-forwarded-for": `10.0.0.${++ipCounter}`,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

function cookiesFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

describe("operator authentication with mandatory TOTP", () => {
  it("password alone does not create a session for an enrolled operator", async () => {
    const { user, password } = await makeUser("OWNER");
    const res = await post("/sign-in/email", { email: user.email, password });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.twoFactorRedirect).toBe(true);
    expect(body.token ?? null).toBeNull();
  });

  it("password + correct TOTP signs in; the session reports 2FA enabled and the role", async () => {
    const { user, password, totpSecretBase32 } = await makeUser("RESEARCHER");
    const first = await post("/sign-in/email", { email: user.email, password });
    const twoFactorCookie = cookiesFrom(first);
    const verify = await post("/two-factor/verify-totp", { code: totp(totpSecretBase32!) }, twoFactorCookie);
    expect(verify.status).toBe(200);
    const sessionCookie = cookiesFrom(verify);
    const session = await auth.api.getSession({ headers: new Headers({ cookie: sessionCookie }) });
    expect(session?.user.email).toBe(user.email);
    expect(session?.user.twoFactorEnabled).toBe(true);
    expect(session?.user.role).toBe("RESEARCHER");
  });

  it("a TOTP code works once: replaying it for another sign-in is refused; a wrong code doesn't burn the right one", async () => {
    const { user, password, totpSecretBase32 } = await makeUser("OWNER");
    const code = totp(totpSecretBase32!);
    const signIn = async () => cookiesFrom(await post("/sign-in/email", { email: user.email, password }));

    // A failed attempt with a wrong code first, then the right code still works.
    const pending = await signIn();
    expect((await post("/two-factor/verify-totp", { code: code === "000000" ? "111111" : "000000" }, pending)).status).toBeGreaterThanOrEqual(400);
    expect((await post("/two-factor/verify-totp", { code }, pending)).status).toBe(200);

    // The same code again, for a fresh sign-in, inside its validity window.
    const replay = await post("/two-factor/verify-totp", { code }, await signIn());
    expect(replay.status).toBe(401);
    expect((await replay.json()).code).toBe("TOTP_CODE_REUSED");

    // The next code is accepted.
    const next = totp(totpSecretBase32!, Date.now() + 30_000);
    expect((await post("/two-factor/verify-totp", { code: next }, await signIn())).status).toBe(200);
  });

  it("rejects a wrong TOTP code", async () => {
    const { user, password } = await makeUser("OWNER");
    const first = await post("/sign-in/email", { email: user.email, password });
    const verify = await post("/two-factor/verify-totp", { code: "000000" }, cookiesFrom(first));
    expect(verify.status).toBeGreaterThanOrEqual(400);
  });

  it("rejects a wrong password", async () => {
    const { user } = await makeUser("OWNER");
    const res = await post("/sign-in/email", { email: user.email, password: "definitely-wrong-password" });
    expect(res.status).toBe(401);
  });

  it("public sign-up is disabled", async () => {
    const res = await post("/sign-up/email", {
      email: "intruder@example.com",
      name: "Intruder",
      password: "a-long-enough-password",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.user.count({ where: { email: "intruder@example.com" } })).toBe(0);
  });

  it("role cannot be set by the client", async () => {
    const { user, password } = await makeUser("VIEWER", { totp: false });
    const signIn = await post("/sign-in/email", { email: user.email, password });
    const res = await post("/update-user", { role: "OWNER" }, cookiesFrom(signIn));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe("VIEWER");
  });

  it("an operator without TOTP gets a session that reports 2FA as not enabled (the DAL then forces /setup-2fa)", async () => {
    const { user, password } = await makeUser("OWNER", { totp: false });
    const signIn = await post("/sign-in/email", { email: user.email, password });
    const session = await auth.api.getSession({ headers: new Headers({ cookie: cookiesFrom(signIn) }) });
    expect(session?.user.twoFactorEnabled).toBe(false);
  });
});
