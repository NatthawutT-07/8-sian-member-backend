BEGIN;
ALTER TABLE "PosSale" ADD COLUMN "transferSatang" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PosSale" DROP CONSTRAINT "PosSale_method_check";
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_method_check" CHECK ("method" IN ('CASH', 'TRANSFER', 'MIXED'));
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_transfer_check" CHECK (("method" <> 'MIXED' AND "transferSatang" = 0) OR ("method" = 'MIXED' AND "transferSatang" > 0 AND "transferSatang" < "totalSatang" AND "receivedSatang" > "transferSatang"));
COMMIT;
