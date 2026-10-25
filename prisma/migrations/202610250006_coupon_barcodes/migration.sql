ALTER TABLE "Coupon" ADD COLUMN "barcodeTokenHash" TEXT, ADD COLUMN "barcodeExpiresAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Coupon_barcodeTokenHash_key" ON "Coupon"("barcodeTokenHash");
