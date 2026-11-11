ALTER TABLE "DiningTable"
  ALTER COLUMN "qrToken" DROP NOT NULL,
  ALTER COLUMN "qrToken" DROP DEFAULT,
  ADD COLUMN "qrDurationHours" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "qrExpiresAt" TIMESTAMP(3);
-- Revoke every legacy permanent QR. Paid rounds remain recorded; staff can
-- confirm zones again to issue the first expiring QR without charging again.
UPDATE "DiningTable" SET "qrToken" = NULL, "qrExpiresAt" = NULL, "orderingEnabled" = FALSE;
