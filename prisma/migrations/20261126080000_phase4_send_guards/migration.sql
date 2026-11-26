-- Phase 4: notification kinds for outreach, and database-level guards for
-- compliance rule 7 (human approval gate). These back up the application
-- checks: even a buggy code path cannot mark an outbound communication as
-- approved/sent without an APPROVED approval of its exact content, cannot edit
-- a message after it was approved, and cannot alter or delete an approval.

ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'APPROVAL_NEEDED';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'FOLLOW_UP_READY';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'SEND_FAILED';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'MAIL_RETURNED';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'OPTED_OUT';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'REPLY_RECEIVED';

CREATE OR REPLACE FUNCTION communications_approval_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."direction" = 'OUTBOUND'
     AND NEW."status" IN ('APPROVED', 'QUEUED', 'SENT', 'DELIVERED', 'RETURNED') THEN
    IF NEW."approvalId" IS NULL OR NEW."contentHash" IS NULL OR NOT EXISTS (
      SELECT 1 FROM "approvals" a
       WHERE a."id" = NEW."approvalId"
         AND a."subjectType" = 'COMMUNICATION'
         AND a."subjectId" = NEW."id"
         AND a."decision" = 'APPROVED'
         AND a."contentHash" = NEW."contentHash"
    ) THEN
      RAISE EXCEPTION 'Outbound communication % cannot be % without an approval of its exact content', NEW."id", NEW."status"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."approvalId" IS NOT NULL AND (
       NEW."approvalId" IS DISTINCT FROM OLD."approvalId"
    OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
    OR NEW."renderedContent" IS DISTINCT FROM OLD."renderedContent"
    OR NEW."textContent" IS DISTINCT FROM OLD."textContent"
    OR NEW."subject" IS DISTINCT FROM OLD."subject"
    OR NEW."channel" IS DISTINCT FROM OLD."channel"
    OR NEW."personId" IS DISTINCT FROM OLD."personId"
    -- recipientEnc may only be cleared (PII retention purge), never changed.
    OR (NEW."recipientEnc" IS DISTINCT FROM OLD."recipientEnc" AND NEW."recipientEnc" IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Communication % was approved and can no longer be edited', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER communications_approval_guard
  BEFORE INSERT OR UPDATE ON "communications"
  FOR EACH ROW EXECUTE FUNCTION communications_approval_guard();

CREATE OR REPLACE FUNCTION approvals_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Approvals are permanent records and cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  -- Only contentSnapshot may change (PII retention purge); the decision, what
  -- was approved, by whom and when are permanent.
  IF NEW."subjectType" IS DISTINCT FROM OLD."subjectType"
     OR NEW."subjectId" IS DISTINCT FROM OLD."subjectId"
     OR NEW."decision" IS DISTINCT FROM OLD."decision"
     OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
     OR NEW."approvedById" IS DISTINCT FROM OLD."approvedById"
     OR NEW."reason" IS DISTINCT FROM OLD."reason"
     OR NEW."checklist"::text IS DISTINCT FROM OLD."checklist"::text
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Approvals cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER approvals_immutable
  BEFORE UPDATE OR DELETE ON "approvals"
  FOR EACH ROW EXECUTE FUNCTION approvals_immutable();
