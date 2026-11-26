-- Phase 4: outreach drafts, approvals, delivery events, opt-out.
ALTER TABLE "communications"
  ADD COLUMN "textContent" TEXT,
  ADD COLUMN "recipientEnc" TEXT,
  ADD COLUMN "personalNote" TEXT,
  ADD COLUMN "personalizationRunId" TEXT,
  ADD COLUMN "checklist" JSONB,
  ADD COLUMN "toneCheck" JSONB,
  ADD COLUMN "optOutToken" TEXT,
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "events" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "cancelledReason" TEXT;
CREATE UNIQUE INDEX "communications_optOutToken_key" ON "communications"("optOutToken");
