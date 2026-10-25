CREATE TABLE "Campaign" (
 "id" TEXT PRIMARY KEY,
 "title" TEXT NOT NULL,
 "description" TEXT NOT NULL,
 "extraPrice" INTEGER NOT NULL DEFAULT 0 CHECK ("extraPrice" >= 0),
 "validityDays" INTEGER NOT NULL DEFAULT 30 CHECK ("validityDays" BETWEEN 1 AND 365),
 "active" BOOLEAN NOT NULL DEFAULT true,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "Campaign" ("id", "title", "description", "extraPrice", "validityDays")
VALUES ('seafood79_welcome_v1', 'เพิ่มทะเล +79', 'กินทะเลไม่อั้น', 79, 30);
-- Preserve old coupon campaigns without removing any issued coupon or usage history.
INSERT INTO "Campaign" ("id", "title", "description")
SELECT DISTINCT "campaign", 'คูปองเดิม', 'สิทธิพิเศษสมาชิก' FROM "Coupon"
WHERE "campaign" <> 'seafood79_welcome_v1' ON CONFLICT DO NOTHING;
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_campaign_fkey" FOREIGN KEY ("campaign") REFERENCES "Campaign"("id") ON DELETE RESTRICT;
CREATE TABLE "Admin" (
 "id" TEXT PRIMARY KEY DEFAULT 'owner' CHECK ("id" = 'owner'),
 "username" TEXT NOT NULL UNIQUE,
 "passwordHash" TEXT NOT NULL,
 "role" TEXT NOT NULL DEFAULT 'ADMIN' CHECK ("role" = 'ADMIN'),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "AdminSession" (
 "tokenHash" TEXT PRIMARY KEY,
 "adminId" TEXT NOT NULL REFERENCES "Admin"("id") ON DELETE CASCADE,
 "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");
CREATE TABLE "AuditLog" (
 "id" TEXT PRIMARY KEY,
 "actor" TEXT NOT NULL,
 "action" TEXT NOT NULL,
 "memberId" TEXT,
 "details" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AuditLog_memberId_createdAt_idx" ON "AuditLog"("memberId", "createdAt");
