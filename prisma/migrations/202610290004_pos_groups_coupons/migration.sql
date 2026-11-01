ALTER TABLE "PosProduct" ADD COLUMN "group" TEXT NOT NULL DEFAULT 'MAIN';
ALTER TABLE "PosProduct" DROP CONSTRAINT "PosProduct_priceSatang_check";
ALTER TABLE "PosProduct" ADD CONSTRAINT "PosProduct_group_price_check" CHECK (
  ("group" IN ('MAIN', 'PROMOTION') AND "priceSatang" >= 0)
  OR ("group" = 'DISCOUNT' AND "priceSatang" < 0)
);
ALTER TABLE "Campaign" ADD COLUMN "posDiscountSatang" INTEGER NOT NULL DEFAULT 0 CHECK ("posDiscountSatang" >= 0);
ALTER TABLE "Campaign" ADD COLUMN "posMinSubtotalSatang" INTEGER NOT NULL DEFAULT 0 CHECK ("posMinSubtotalSatang" >= 0);
ALTER TABLE "PosSale" ADD COLUMN "subtotalSatang" INTEGER;
ALTER TABLE "PosSale" ADD COLUMN "discountSatang" INTEGER NOT NULL DEFAULT 0 CHECK ("discountSatang" >= 0);
ALTER TABLE "PosSale" ADD COLUMN "couponId" TEXT REFERENCES "Coupon"("id") ON DELETE RESTRICT;
ALTER TABLE "PosSale" ADD COLUMN "couponTitle" TEXT;
UPDATE "PosSale" SET "subtotalSatang" = "totalSatang";
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_discount_check" CHECK ("subtotalSatang" IS NULL OR "totalSatang" = "subtotalSatang" - "discountSatang");
CREATE UNIQUE INDEX "PosSale_couponId_key" ON "PosSale"("couponId");
CREATE TABLE "PosCouponReservation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "couponId" TEXT NOT NULL REFERENCES "Coupon"("id") ON DELETE CASCADE,
  "billKey" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "barcodeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PosCouponReservation_couponId_key" ON "PosCouponReservation"("couponId");
CREATE UNIQUE INDEX "PosCouponReservation_billKey_key" ON "PosCouponReservation"("billKey");
CREATE INDEX "PosCouponReservation_expiresAt_idx" ON "PosCouponReservation"("expiresAt");
