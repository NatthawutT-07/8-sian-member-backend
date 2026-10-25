CREATE TABLE "Member" (
 "id" TEXT NOT NULL,
 "memberNumber" SERIAL NOT NULL,
 "lineUserId" TEXT NOT NULL,
 "firstName" TEXT NOT NULL,
 "lastName" TEXT NOT NULL,
 "phone" TEXT NOT NULL,
 "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
 "privacyVersion" TEXT NOT NULL DEFAULT '2026-10-25',
 "consentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Member_memberNumber_key" ON "Member"("memberNumber");
CREATE UNIQUE INDEX "Member_lineUserId_key" ON "Member"("lineUserId");
