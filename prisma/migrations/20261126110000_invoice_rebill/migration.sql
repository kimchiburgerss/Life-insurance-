-- One live (non-void) invoice per agreement. A voided invoice no longer blocks
-- billing the agreement again, e.g. after a mistyped amount paid to the heir.

-- DropIndex
DROP INDEX "invoices_agreementId_key";

-- CreateIndex
CREATE UNIQUE INDEX "invoices_agreementId_live_key" ON "invoices"("agreementId") WHERE (status <> 'VOID');
