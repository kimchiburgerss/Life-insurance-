import { z } from "zod";

const base64Key32 = z
  .string()
  .refine((v) => Buffer.from(v, "base64").length === 32, {
    message: "must be 32 bytes, base64-encoded (openssl rand -base64 32)",
  });

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  PII_ENCRYPTION_KEY: base64Key32,
  PII_HMAC_KEY: base64Key32,
  /** Version of PII_ENCRYPTION_KEY (1–9); older keys go in PII_PREVIOUS_KEYS during a rotation. */
  PII_KEY_VERSION: z.string().regex(/^[1-9]$/, "must be a whole number from 1 to 9").optional(),
  PII_PREVIOUS_KEYS: z
    .string()
    .regex(/^\s*[1-9]=[A-Za-z0-9+/]+={0,2}\s*(,\s*[1-9]=[A-Za-z0-9+/]+={0,2}\s*)*$/, 'format: "1=<base64>,2=<base64>"')
    .optional(),
  /** When true (the default) every third-party adapter uses its mock. */
  MOCK_MODE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/** Validated environment. Throws a readable error listing every bad variable. */
export function env(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}\nSee .env.example.`);
  }
  cached = parsed.data;
  return cached;
}
