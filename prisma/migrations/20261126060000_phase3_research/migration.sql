-- Phase 3: research, intestate helper, waiting-period notifications.
ALTER TYPE "RuleType" ADD VALUE 'INTESTATE_SUCCESSION';

CREATE TYPE "NotificationKind" AS ENUM ('CASE_UNLOCKED', 'UNLOCK_BLOCKED', 'IMPORT_FINISHED', 'SYSTEM');

ALTER TABLE "evidence" ADD COLUMN "rawText" TEXT;
ALTER TABLE "cases" ADD COLUMN "tracingAssessment" JSONB;
ALTER TABLE "persons" ADD COLUMN "notes" TEXT;

CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "caseId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");
