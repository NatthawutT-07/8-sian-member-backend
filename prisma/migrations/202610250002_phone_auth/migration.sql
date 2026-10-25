-- Preserve existing members. Stop rather than alter data if phone numbers repeat.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "Member" GROUP BY "phone" HAVING COUNT(*) > 1) THEN
  RAISE EXCEPTION 'Duplicate member phone numbers: resolve duplicates before applying phone auth migration';
 END IF;
END $$;
ALTER TABLE "Member" DROP COLUMN "lineUserId";
ALTER TABLE "Member" ADD COLUMN "passwordHash" TEXT, ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Member_phone_key" ON "Member"("phone");
CREATE TABLE "Session" (
 "tokenHash" TEXT PRIMARY KEY,
 "memberId" TEXT NOT NULL REFERENCES "Member"("id") ON DELETE CASCADE,
 "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE TABLE "SmsThrottle" (
 "phone" TEXT PRIMARY KEY,
 "nextSendAt" TIMESTAMP(3) NOT NULL DEFAULT '1970-01-01',
 "day" TEXT NOT NULL,
 "sendCount" INTEGER NOT NULL DEFAULT 0
);
