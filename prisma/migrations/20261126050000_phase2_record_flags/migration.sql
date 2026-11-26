-- Generalize name flags into record flags (rename keeps existing values).
ALTER TABLE "properties" RENAME COLUMN "nameFlags" TO "flags";

-- Amount ranges / "over $X": reportedAmountCents holds the lower bound.
ALTER TABLE "properties" ADD COLUMN "amountIsMinimum" BOOLEAN NOT NULL DEFAULT false;

-- Owner merged into another owner by a reviewer.
ALTER TABLE "owners" ADD COLUMN "mergedIntoId" TEXT;
