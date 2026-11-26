-- Phase 6: claim packets, invoices, approval guards.
-- AlterEnum
ALTER TYPE "ApprovalSubjectType" ADD VALUE 'INVOICE';

-- AlterEnum


ALTER TYPE "NotificationKind" ADD VALUE 'CLAIM_UPDATE';
ALTER TYPE "NotificationKind" ADD VALUE 'INVOICE_PAID';

-- AlterTable
ALTER TABLE "claim_packets" ADD COLUMN     "assembledFrom" JSONB,
ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "coverLetterText" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "events" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "facts" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "filedMethod" TEXT,
ADD COLUMN     "outcomeNote" TEXT,
ADD COLUMN     "personId" TEXT;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "agreementId" TEXT,
ADD COLUMN     "amountPaidToHeirCents" INTEGER,
ADD COLUMN     "approvalId" TEXT,
ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "dueDate" DATE,
ADD COLUMN     "events" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "feeBps" INTEGER,
ADD COLUMN     "paidToHeirAt" DATE,
ADD COLUMN     "paymentEvidence" TEXT,
ADD COLUMN     "personId" TEXT,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "statusReason" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "invoices_agreementId_key" ON "invoices"("agreementId");

-- CreateIndex
CREATE INDEX "invoices_stripeInvoiceId_idx" ON "invoices"("stripeInvoiceId");

-- AddForeignKey
ALTER TABLE "claim_packets" ADD CONSTRAINT "claim_packets_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A claim packet can only be APPROVED / FILED / decided with an APPROVED
-- approval of its exact assembled PDF, and nothing approved can change.
CREATE OR REPLACE FUNCTION claim_packets_approval_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."status" IN ('APPROVED', 'FILED', 'APPROVED_BY_STATE', 'DENIED_BY_STATE', 'MORE_INFO_REQUESTED') THEN
    IF NEW."approvalId" IS NULL OR NEW."contentHash" IS NULL OR NOT EXISTS (
      SELECT 1 FROM "approvals" a
       WHERE a."id" = NEW."approvalId" AND a."subjectType" = 'CLAIM_PACKET' AND a."subjectId" = NEW."id"
         AND a."decision" = 'APPROVED' AND a."contentHash" = NEW."contentHash"
    ) THEN
      RAISE EXCEPTION 'Claim packet % cannot be % without an approval of its exact content', NEW."id", NEW."status"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."approvalId" IS NOT NULL AND (
       NEW."approvalId" IS DISTINCT FROM OLD."approvalId"
    OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
    OR NEW."assembledPdfKey" IS DISTINCT FROM OLD."assembledPdfKey"
    OR NEW."assembledFrom"::text IS DISTINCT FROM OLD."assembledFrom"::text
    OR NEW."personId" IS DISTINCT FROM OLD."personId"
  ) THEN
    RAISE EXCEPTION 'Claim packet % was approved and can no longer be changed', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER claim_packets_approval_guard
  BEFORE INSERT OR UPDATE ON "claim_packets"
  FOR EACH ROW EXECUTE FUNCTION claim_packets_approval_guard();

-- An invoice can only be OPEN (sent) or PAID with an APPROVED approval of its
-- exact recipient + amount, and the approved terms can't change.
CREATE OR REPLACE FUNCTION invoices_approval_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."status" IN ('OPEN', 'PAID') THEN
    IF NEW."approvalId" IS NULL OR NEW."contentHash" IS NULL OR NOT EXISTS (
      SELECT 1 FROM "approvals" a
       WHERE a."id" = NEW."approvalId" AND a."subjectType" = 'INVOICE' AND a."subjectId" = NEW."id"
         AND a."decision" = 'APPROVED' AND a."contentHash" = NEW."contentHash"
    ) THEN
      RAISE EXCEPTION 'Invoice % cannot be % without an approval of its exact amount', NEW."id", NEW."status"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."approvalId" IS NOT NULL AND (
       NEW."approvalId" IS DISTINCT FROM OLD."approvalId"
    OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
    OR NEW."amountCents" IS DISTINCT FROM OLD."amountCents"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."feeBps" IS DISTINCT FROM OLD."feeBps"
    OR NEW."amountPaidToHeirCents" IS DISTINCT FROM OLD."amountPaidToHeirCents"
    OR NEW."personId" IS DISTINCT FROM OLD."personId"
    OR NEW."agreementId" IS DISTINCT FROM OLD."agreementId"
  ) THEN
    RAISE EXCEPTION 'Invoice % was approved and its amount can no longer be changed', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoices_approval_guard
  BEFORE INSERT OR UPDATE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION invoices_approval_guard();
