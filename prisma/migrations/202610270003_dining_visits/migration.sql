ALTER TABLE "Member" ADD COLUMN "loyaltyQrHash" TEXT;
ALTER TABLE "Member" ADD COLUMN "loyaltyQrExpiresAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Member_loyaltyQrHash_key" ON "Member"("loyaltyQrHash");
CREATE TABLE "DiningVisit" (
  "id" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "receiptNumber" TEXT NOT NULL,
  "recordedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiningVisit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DiningVisit_receiptNumber_key" ON "DiningVisit"("receiptNumber");
CREATE INDEX "DiningVisit_memberId_createdAt_idx" ON "DiningVisit"("memberId", "createdAt");
ALTER TABLE "DiningVisit" ADD CONSTRAINT "DiningVisit_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
