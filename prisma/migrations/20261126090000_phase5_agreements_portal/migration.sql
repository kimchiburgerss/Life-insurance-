-- Phase 5: agreements, encrypted document storage, heir portal.
-- CreateEnum
CREATE TYPE "HeirDocumentStatus" AS ENUM ('RECEIVED', 'ACCEPTED', 'NEEDS_REPLACEMENT');

-- AlterEnum
ALTER TYPE "CommunicationChannel" ADD VALUE 'PORTAL_MESSAGE';

-- AlterEnum


ALTER TYPE "NotificationKind" ADD VALUE 'AGREEMENT_SIGNED';
ALTER TYPE "NotificationKind" ADD VALUE 'AGREEMENT_DECLINED';
ALTER TYPE "NotificationKind" ADD VALUE 'DOCUMENT_UPLOADED';
ALTER TYPE "NotificationKind" ADD VALUE 'PORTAL_ACTIVITY';

-- AlterTable
ALTER TABLE "agreements" ADD COLUMN     "checklist" JSONB,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "events" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "feeCapBps" INTEGER,
ADD COLUMN     "personId" TEXT,
ADD COLUMN     "signatureMethod" TEXT,
ADD COLUMN     "signedFileKey" TEXT,
ADD COLUMN     "statusReason" TEXT,
ADD COLUMN     "textContent" TEXT;

-- CreateTable
CREATE TABLE "stored_files" (
    "id" TEXT NOT NULL,
    "caseId" TEXT,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "purgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "heir_documents" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "checklistKey" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "status" "HeirDocumentStatus" NOT NULL DEFAULT 'RECEIVED',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "heir_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_access" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenEnc" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_sessions" (
    "id" TEXT NOT NULL,
    "sessionHash" TEXT NOT NULL,
    "portalAccessId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_limits" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "request_limits_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "stored_files_caseId_idx" ON "stored_files"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "heir_documents_fileId_key" ON "heir_documents"("fileId");

-- CreateIndex
CREATE INDEX "heir_documents_caseId_idx" ON "heir_documents"("caseId");

-- CreateIndex
CREATE INDEX "heir_documents_personId_idx" ON "heir_documents"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "portal_access_tokenHash_key" ON "portal_access"("tokenHash");

-- CreateIndex
CREATE INDEX "portal_access_personId_idx" ON "portal_access"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "portal_sessions_sessionHash_key" ON "portal_sessions"("sessionHash");

-- CreateIndex
CREATE INDEX "agreements_esignEnvelopeId_idx" ON "agreements"("esignEnvelopeId");

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "heir_documents" ADD CONSTRAINT "heir_documents_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "heir_documents" ADD CONSTRAINT "heir_documents_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_access" ADD CONSTRAINT "portal_access_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_access" ADD CONSTRAINT "portal_access_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_portalAccessId_fkey" FOREIGN KEY ("portalAccessId") REFERENCES "portal_access"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Compliance rule 7 for agreements: an agreement can only be APPROVED, SENT or
-- SIGNED with an APPROVED approval of its exact content (PDF + signer hash),
-- and nothing that was approved can change afterwards.
CREATE OR REPLACE FUNCTION agreements_approval_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."status" IN ('APPROVED', 'SENT', 'SIGNED') THEN
    IF NEW."approvalId" IS NULL OR NEW."contentHash" IS NULL OR NOT EXISTS (
      SELECT 1 FROM "approvals" a
       WHERE a."id" = NEW."approvalId"
         AND a."subjectType" = 'AGREEMENT'
         AND a."subjectId" = NEW."id"
         AND a."decision" = 'APPROVED'
         AND a."contentHash" = NEW."contentHash"
    ) THEN
      RAISE EXCEPTION 'Agreement % cannot be % without an approval of its exact content', NEW."id", NEW."status"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."approvalId" IS NOT NULL AND (
       NEW."approvalId" IS DISTINCT FROM OLD."approvalId"
    OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
    OR NEW."pdfFileKey" IS DISTINCT FROM OLD."pdfFileKey"
    OR NEW."textContent" IS DISTINCT FROM OLD."textContent"
    OR NEW."signers"::text IS DISTINCT FROM OLD."signers"::text
    OR NEW."personId" IS DISTINCT FROM OLD."personId"
    OR NEW."feeBps" IS DISTINCT FROM OLD."feeBps"
    OR NEW."propertyValueBeforeFeeCents" IS DISTINCT FROM OLD."propertyValueBeforeFeeCents"
    OR NEW."propertyValueAfterFeeCents" IS DISTINCT FROM OLD."propertyValueAfterFeeCents"
  ) THEN
    RAISE EXCEPTION 'Agreement % was approved and can no longer be edited', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agreements_approval_guard
  BEFORE INSERT OR UPDATE ON "agreements"
  FOR EACH ROW EXECUTE FUNCTION agreements_approval_guard();
