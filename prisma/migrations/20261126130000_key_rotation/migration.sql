-- Key rotation (npm run keys:rotate): approved messages keep their recipient
-- frozen, except that the rotation script may re-encrypt it under a new key
-- version. The plaintext (and so the approved content hash) is unchanged.

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
    -- recipientEnc may only be cleared (PII retention purge), or re-encrypted
    -- under a NEW key version by the key-rotation script, which sets
    -- heirfinder.key_rotation for its transaction. Never otherwise changed.
    OR (NEW."recipientEnc" IS DISTINCT FROM OLD."recipientEnc" AND NEW."recipientEnc" IS NOT NULL AND NOT (
          COALESCE(current_setting('heirfinder.key_rotation', true), '') = 'on'
          AND OLD."recipientEnc" IS NOT NULL
          AND split_part(NEW."recipientEnc", ':', 1) <> split_part(OLD."recipientEnc", ':', 1)
        ))
  ) THEN
    RAISE EXCEPTION 'Communication % was approved and can no longer be edited', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
