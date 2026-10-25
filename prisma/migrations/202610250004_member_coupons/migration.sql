CREATE TABLE "Coupon" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "memberId" TEXT NOT NULL REFERENCES "Member"("id") ON DELETE CASCADE,
 "campaign" TEXT NOT NULL,
 "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 "usedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "Coupon_memberId_campaign_key" ON "Coupon"("memberId", "campaign");
CREATE INDEX "Coupon_memberId_usedAt_expiresAt_idx" ON "Coupon"("memberId", "usedAt", "expiresAt");
