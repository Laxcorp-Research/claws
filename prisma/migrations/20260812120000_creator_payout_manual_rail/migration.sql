-- PR-9 MANUAL-RAIL: encrypted creator payout details + sale transfer ref / clawback link.

CREATE TYPE "PayoutMethod" AS ENUM ('BANK', 'WISE', 'PAYPAL');

ALTER TABLE "CreatorProfile"
  ADD COLUMN IF NOT EXISTS "payoutDetailsEncrypted" TEXT,
  ADD COLUMN IF NOT EXISTS "payoutMethod" "PayoutMethod",
  ADD COLUMN IF NOT EXISTS "payoutDetailsUpdatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "payoutDetailsHint" TEXT;

ALTER TABLE "MarketplaceSale"
  ADD COLUMN IF NOT EXISTS "payoutTransferRef" TEXT,
  ADD COLUMN IF NOT EXISTS "adjustmentOfSaleId" TEXT;

CREATE INDEX IF NOT EXISTS "MarketplaceSale_payoutBatchId_idx" ON "MarketplaceSale"("payoutBatchId");
CREATE INDEX IF NOT EXISTS "MarketplaceSale_adjustmentOfSaleId_idx" ON "MarketplaceSale"("adjustmentOfSaleId");

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PAYOUT_DETAILS_VIEWED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PAYOUT_MARKED_PROCESSING';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PAYOUT_MARKED_PAID';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PAYOUT_CLAWBACK_ADJUSTMENT';
