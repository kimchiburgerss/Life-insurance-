-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'RESEARCHER', 'VIEWER');

-- CreateEnum
CREATE TYPE "CaseStage" AS ENUM ('IMPORTED', 'SCREENED', 'OWNER_VERIFIED_DECEASED', 'HEIRS_RESEARCHING', 'HEIRS_IDENTIFIED', 'WAITING_PERIOD', 'READY_FOR_OUTREACH', 'CONTACTED', 'RESPONDED', 'AGREEMENT_SENT', 'AGREEMENT_SIGNED', 'CLAIM_PACKET_PREPARED', 'CLAIM_FILED', 'CLAIM_APPROVED', 'CLAIM_DENIED', 'MORE_INFO_REQUESTED', 'PAID_TO_HEIR', 'FEE_INVOICED', 'FEE_COLLECTED', 'CLOSED_WON', 'CLOSED_NO_HEIR', 'CLOSED_DECLINED', 'CLOSED_SELF_CLAIMED', 'CLOSED_INELIGIBLE');

-- CreateEnum
CREATE TYPE "PropertyCategory" AS ENUM ('LIFE_INSURANCE', 'ANNUITY', 'ESTATE', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "EvidenceSourceType" AS ENUM ('OBITUARY', 'DEATH_RECORD_INDEX', 'PROBATE_FILING', 'PUBLIC_RECORD', 'PEOPLE_SEARCH_VENDOR', 'USER_UPLOADED_DOCUMENT', 'MANUAL_NOTE');

-- CreateEnum
CREATE TYPE "Relationship" AS ENUM ('NAMED_BENEFICIARY', 'SPOUSE', 'CHILD', 'GRANDCHILD', 'PARENT', 'SIBLING', 'NIECE_NEPHEW', 'GRANDPARENT', 'AUNT_UNCLE', 'COUSIN', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PersonStatus" AS ENUM ('CANDIDATE', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CommunicationChannel" AS ENUM ('MAIL', 'EMAIL', 'INBOUND_PHONE_NOTE');

-- CreateEnum
CREATE TYPE "CommunicationDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "CommunicationStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'QUEUED', 'SENT', 'DELIVERED', 'RETURNED', 'FAILED', 'CANCELLED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "AgreementStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'SIGNED', 'DECLINED', 'CANCELLED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ClaimPacketStatus" AS ENUM ('IN_PROGRESS', 'READY_FOR_REVIEW', 'APPROVED', 'FILED', 'APPROVED_BY_STATE', 'DENIED_BY_STATE', 'MORE_INFO_REQUESTED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE');

-- CreateEnum
CREATE TYPE "RuleType" AS ENUM ('WAITING_PERIOD', 'FEE_CAP', 'DISCLOSURE_TEXT', 'AGREEMENT_REQUIREMENTS', 'CLAIM_REQUIREMENTS');

-- CreateEnum
CREATE TYPE "ApprovalSubjectType" AS ENUM ('COMMUNICATION', 'AGREEMENT', 'CLAIM_PACKET');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM', 'AI', 'HEIR');

-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('SUCCEEDED', 'INVALID_OUTPUT', 'FAILED');

-- CreateEnum
CREATE TYPE "AiAcceptance" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'NOT_APPLICABLE');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "twoFactorEnabled" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two_factor" (
    "id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verified" BOOLEAN DEFAULT true,
    "failedVerificationCount" INTEGER DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "two_factor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "rate_limit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "stateCode" TEXT NOT NULL DEFAULT 'NV',
    "fileName" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "insertedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "columnMapping" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" TEXT NOT NULL,
    "stateCode" TEXT NOT NULL DEFAULT 'NV',
    "statePropertyId" TEXT NOT NULL,
    "ownerNameRaw" TEXT NOT NULL,
    "ownerNameNormalized" TEXT,
    "ownerAddressRaw" TEXT,
    "ownerAddressNormalized" JSONB,
    "holderName" TEXT,
    "propertyTypeCode" TEXT,
    "category" "PropertyCategory" NOT NULL DEFAULT 'UNKNOWN',
    "reportedAmountCents" INTEGER,
    "datePresumedAbandoned" DATE,
    "dateDeliveredToState" DATE,
    "hasDeceasedMarker" BOOLEAN NOT NULL DEFAULT false,
    "holderIsLifeInsurer" BOOLEAN NOT NULL DEFAULT false,
    "rawRecord" JSONB NOT NULL,
    "importBatchId" TEXT,
    "ownerId" TEXT,
    "caseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owners" (
    "id" TEXT NOT NULL,
    "stateCode" TEXT NOT NULL DEFAULT 'NV',
    "fullName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dateOfBirth" DATE,
    "dateOfDeath" DATE,
    "deathVerified" BOOLEAN NOT NULL DEFAULT false,
    "deathVerificationNote" TEXT,
    "lastKnownAddresses" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cases" (
    "id" TEXT NOT NULL,
    "caseNumber" SERIAL NOT NULL,
    "stateCode" TEXT NOT NULL DEFAULT 'NV',
    "ownerId" TEXT NOT NULL,
    "stage" "CaseStage" NOT NULL DEFAULT 'IMPORTED',
    "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "priorityScore" INTEGER,
    "priorityExplanation" TEXT,
    "assignedUserId" TEXT,
    "estimatedValueCents" INTEGER,
    "eligibleContractDate" DATE,
    "notes" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persons" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "relationship" "Relationship" NOT NULL DEFAULT 'UNKNOWN',
    "relationshipConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "PersonStatus" NOT NULL DEFAULT 'CANDIDATE',
    "isPredeceased" BOOLEAN NOT NULL DEFAULT false,
    "parentPersonId" TEXT,
    "dateOfBirth" DATE,
    "dateOfDeath" DATE,
    "emailEnc" TEXT,
    "phoneEnc" TEXT,
    "mailingAddressEnc" TEXT,
    "emailHash" TEXT,
    "sourceEvidenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "doNotContact" BOOLEAN NOT NULL DEFAULT false,
    "piiPurgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "personId" TEXT,
    "sourceType" "EvidenceSourceType" NOT NULL,
    "title" TEXT,
    "url" TEXT,
    "fileKey" TEXT,
    "extractedFacts" JSONB,
    "supportsDeath" BOOLEAN NOT NULL DEFAULT false,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedByUserId" TEXT,
    "addedByAiRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" TEXT NOT NULL,
    "subjectType" "ApprovalSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "contentHash" TEXT NOT NULL,
    "contentSnapshot" TEXT NOT NULL,
    "checklist" JSONB NOT NULL DEFAULT '{}',
    "reason" TEXT,
    "approvedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communications" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "personId" TEXT,
    "channel" "CommunicationChannel" NOT NULL,
    "direction" "CommunicationDirection" NOT NULL,
    "status" "CommunicationStatus" NOT NULL DEFAULT 'DRAFT',
    "templateId" TEXT,
    "templateVersion" TEXT,
    "sequenceStep" INTEGER,
    "subject" TEXT,
    "renderedContent" TEXT,
    "contentHash" TEXT,
    "approvalId" TEXT,
    "providerMessageId" TEXT,
    "deliveryStatus" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreements" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "signers" JSONB NOT NULL,
    "feeBps" INTEGER NOT NULL,
    "propertyValueBeforeFeeCents" INTEGER NOT NULL,
    "propertyValueAfterFeeCents" INTEGER NOT NULL,
    "rulesApplied" JSONB NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "isAttorneyApprovedTemplate" BOOLEAN NOT NULL DEFAULT false,
    "pdfFileKey" TEXT,
    "contentHash" TEXT,
    "approvalId" TEXT,
    "esignProvider" TEXT,
    "esignEnvelopeId" TEXT,
    "status" "AgreementStatus" NOT NULL DEFAULT 'DRAFT',
    "sentAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_packets" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "status" "ClaimPacketStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "assembledPdfKey" TEXT,
    "approvalId" TEXT,
    "filedAt" TIMESTAMP(3),
    "stateClaimNumber" TEXT,
    "outcome" TEXT,
    "outcomeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claim_packets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "stripeCustomerId" TEXT,
    "stripeInvoiceId" TEXT,
    "paymentLinkUrl" TEXT,
    "issuedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "remindersSent" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jurisdiction_rules" (
    "id" TEXT NOT NULL,
    "stateCode" TEXT NOT NULL,
    "ruleType" "RuleType" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "params" JSONB NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sourceCitation" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jurisdiction_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_runs" (
    "id" TEXT NOT NULL,
    "promptName" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "inputRedacted" JSONB NOT NULL,
    "output" JSONB,
    "status" "AiRunStatus" NOT NULL,
    "error" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicros" INTEGER NOT NULL DEFAULT 0,
    "caseId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "acceptance" "AiAcceptance" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "do_not_contact" (
    "id" TEXT NOT NULL,
    "normalizedName" TEXT,
    "emailHash" TEXT,
    "addressHash" TEXT,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "do_not_contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE INDEX "two_factor_secret_idx" ON "two_factor"("secret");

-- CreateIndex
CREATE INDEX "two_factor_userId_idx" ON "two_factor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_key_key" ON "rate_limit"("key");

-- CreateIndex
CREATE INDEX "properties_ownerId_idx" ON "properties"("ownerId");

-- CreateIndex
CREATE INDEX "properties_caseId_idx" ON "properties"("caseId");

-- CreateIndex
CREATE INDEX "properties_category_idx" ON "properties"("category");

-- CreateIndex
CREATE UNIQUE INDEX "properties_stateCode_statePropertyId_key" ON "properties"("stateCode", "statePropertyId");

-- CreateIndex
CREATE INDEX "owners_normalizedName_idx" ON "owners"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "cases_caseNumber_key" ON "cases"("caseNumber");

-- CreateIndex
CREATE INDEX "cases_stage_idx" ON "cases"("stage");

-- CreateIndex
CREATE INDEX "cases_eligibleContractDate_idx" ON "cases"("eligibleContractDate");

-- CreateIndex
CREATE INDEX "cases_ownerId_idx" ON "cases"("ownerId");

-- CreateIndex
CREATE INDEX "persons_caseId_idx" ON "persons"("caseId");

-- CreateIndex
CREATE INDEX "persons_emailHash_idx" ON "persons"("emailHash");

-- CreateIndex
CREATE INDEX "evidence_caseId_idx" ON "evidence"("caseId");

-- CreateIndex
CREATE INDEX "approvals_subjectType_subjectId_idx" ON "approvals"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "communications_caseId_idx" ON "communications"("caseId");

-- CreateIndex
CREATE INDEX "communications_status_scheduledFor_idx" ON "communications"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "agreements_caseId_idx" ON "agreements"("caseId");

-- CreateIndex
CREATE INDEX "claim_packets_caseId_idx" ON "claim_packets"("caseId");

-- CreateIndex
CREATE INDEX "invoices_caseId_idx" ON "invoices"("caseId");

-- CreateIndex
CREATE INDEX "jurisdiction_rules_stateCode_ruleType_effectiveFrom_idx" ON "jurisdiction_rules"("stateCode", "ruleType", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "jurisdiction_rules_stateCode_ruleType_version_key" ON "jurisdiction_rules"("stateCode", "ruleType", "version");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "ai_runs_caseId_idx" ON "ai_runs"("caseId");

-- CreateIndex
CREATE INDEX "ai_runs_promptName_promptVersion_idx" ON "ai_runs"("promptName", "promptVersion");

-- CreateIndex
CREATE INDEX "do_not_contact_emailHash_idx" ON "do_not_contact"("emailHash");

-- CreateIndex
CREATE INDEX "do_not_contact_addressHash_idx" ON "do_not_contact"("addressHash");

-- CreateIndex
CREATE INDEX "do_not_contact_normalizedName_idx" ON "do_not_contact"("normalizedName");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persons" ADD CONSTRAINT "persons_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persons" ADD CONSTRAINT "persons_parentPersonId_fkey" FOREIGN KEY ("parentPersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_packets" ADD CONSTRAINT "claim_packets_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Compliance rule 10: the audit log is append-only ───────────────────────
-- Any UPDATE, DELETE or TRUNCATE on audit_logs raises an error, regardless of
-- which code path (or SQL console) attempts it.
CREATE OR REPLACE FUNCTION audit_logs_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_block_mutation();
