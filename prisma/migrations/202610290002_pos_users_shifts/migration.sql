CREATE TABLE "PosUser" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "username" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'USER' CHECK ("role" = 'USER'),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PosUser_username_key" ON "PosUser"("username");
CREATE TABLE "PosSession" (
  "tokenHash" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "PosUser"("id") ON DELETE CASCADE,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "PosSession_expiresAt_idx" ON "PosSession"("expiresAt");
CREATE TABLE "PosShift" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "activeSlot" TEXT,
  "businessDate" TEXT NOT NULL,
  "openedBy" TEXT NOT NULL,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "openingCashSatang" INTEGER NOT NULL CHECK ("openingCashSatang" >= 0),
  "closedBy" TEXT,
  "closedAt" TIMESTAMP(3),
  "countedCashSatang" INTEGER,
  "expectedCashSatang" INTEGER,
  "cashDifferenceSatang" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "PosShift_state_check" CHECK (
    ("closedAt" IS NULL AND "activeSlot" = 'STORE' AND "closedBy" IS NULL AND "countedCashSatang" IS NULL)
    OR ("closedAt" IS NOT NULL AND "activeSlot" IS NULL AND "closedBy" IS NOT NULL AND "countedCashSatang" >= 0 AND "expectedCashSatang" IS NOT NULL AND "cashDifferenceSatang" = "countedCashSatang" - "expectedCashSatang")
  )
);
CREATE UNIQUE INDEX "PosShift_activeSlot_key" ON "PosShift"("activeSlot");
CREATE INDEX "PosShift_businessDate_idx" ON "PosShift"("businessDate");
ALTER TABLE "PosSale" ADD COLUMN "shiftId" TEXT REFERENCES "PosShift"("id") ON DELETE RESTRICT;
CREATE INDEX "PosSale_shiftId_idx" ON "PosSale"("shiftId");
-- Legacy owner sessions cannot authorize POS after this migration; PosSession starts empty.
