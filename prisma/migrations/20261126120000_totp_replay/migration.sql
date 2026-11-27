-- Used TOTP codes (replay protection, ASVS 2.8.4). Pruned after 5 minutes.
-- CreateTable
CREATE TABLE "used_totp_codes" (
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "used_totp_codes_pkey" PRIMARY KEY ("userId","codeHash")
);

-- CreateIndex
CREATE INDEX "used_totp_codes_createdAt_idx" ON "used_totp_codes"("createdAt");

