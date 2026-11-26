/*
  Warnings:

  - Added the required column `fileSha256` to the `import_batches` table without a default value. This is not possible if the table is not empty.
  - Added the required column `fileType` to the `import_batches` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "DatePrecision" AS ENUM ('DAY', 'MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('PENDING', 'MERGED', 'REJECTED');

-- AlterTable
ALTER TABLE "cases" ADD COLUMN     "expectedValueCents" INTEGER,
ADD COLUMN     "priorityFactors" JSONB,
ADD COLUMN     "scoredAt" TIMESTAMP(3),
ADD COLUMN     "successProbability" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "import_batches" ADD COLUMN     "columnMappingId" TEXT,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "failureMessage" TEXT,
ADD COLUMN     "fileData" BYTEA,
ADD COLUMN     "fileSha256" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN     "fileType" TEXT NOT NULL DEFAULT 'csv',
ADD COLUMN     "flaggedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "groupedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "headers" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "newCaseCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "newOwnerCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "previewRows" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "reviewCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED';

-- AlterTable
ALTER TABLE "owners" ADD COLUMN     "matchKeys" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "dateDeliveredPrecision" "DatePrecision",
ADD COLUMN     "nameFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "ownerNameParsed" JSONB,
ADD COLUMN     "sourceRowNumber" INTEGER;

-- CreateTable
CREATE TABLE "column_mappings" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stateCode" TEXT NOT NULL DEFAULT 'NV',
    "mapping" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "column_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_match_candidates" (
    "id" TEXT NOT NULL,
    "newOwnerId" TEXT NOT NULL,
    "existingOwnerId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "reasons" JSONB NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'PENDING',
    "importBatchId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "owner_match_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "column_mappings_name_key" ON "column_mappings"("name");

-- CreateIndex
CREATE INDEX "owner_match_candidates_status_idx" ON "owner_match_candidates"("status");

-- CreateIndex
CREATE UNIQUE INDEX "owner_match_candidates_newOwnerId_existingOwnerId_key" ON "owner_match_candidates"("newOwnerId", "existingOwnerId");

-- CreateIndex
CREATE INDEX "cases_stage_priorityScore_idx" ON "cases"("stage", "priorityScore");

-- CreateIndex
CREATE INDEX "import_batches_fileSha256_idx" ON "import_batches"("fileSha256");

-- CreateIndex
CREATE INDEX "owners_matchKeys_idx" ON "owners" USING GIN ("matchKeys");

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_columnMappingId_fkey" FOREIGN KEY ("columnMappingId") REFERENCES "column_mappings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_match_candidates" ADD CONSTRAINT "owner_match_candidates_newOwnerId_fkey" FOREIGN KEY ("newOwnerId") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_match_candidates" ADD CONSTRAINT "owner_match_candidates_existingOwnerId_fkey" FOREIGN KEY ("existingOwnerId") REFERENCES "owners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_match_candidates" ADD CONSTRAINT "owner_match_candidates_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfilled rows from Phase 1 keep the placeholder values; new rows must set them.
ALTER TABLE "import_batches" ALTER COLUMN "fileSha256" DROP DEFAULT;
ALTER TABLE "import_batches" ALTER COLUMN "fileType" DROP DEFAULT;
-- Phase 1 batches were fully processed.
UPDATE "import_batches" SET "status" = 'COMPLETED' WHERE "status" = 'UPLOADED';
