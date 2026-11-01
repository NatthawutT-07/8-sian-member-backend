CREATE TABLE "PosProduct" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "barcode" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "priceSatang" INTEGER NOT NULL CHECK ("priceSatang" >= 0),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PosProduct_barcode_key" ON "PosProduct"("barcode");
CREATE TABLE "PosSale" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "key" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "items" JSONB NOT NULL,
  "totalSatang" INTEGER NOT NULL CHECK ("totalSatang" >= 0),
  "method" TEXT NOT NULL CHECK ("method" IN ('CASH', 'TRANSFER')),
  "receivedSatang" INTEGER NOT NULL,
  "changeSatang" INTEGER NOT NULL,
  "memberId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PosSale_payment_check" CHECK ("receivedSatang" >= "totalSatang" AND "changeSatang" = "receivedSatang" - "totalSatang" AND ("method" <> 'TRANSFER' OR "changeSatang" = 0))
);
CREATE UNIQUE INDEX "PosSale_key_key" ON "PosSale"("key");
CREATE INDEX "PosSale_createdAt_idx" ON "PosSale"("createdAt");
