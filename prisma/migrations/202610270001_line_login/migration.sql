ALTER TABLE "Member" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "Member" ADD COLUMN "lineUserId" TEXT;
CREATE UNIQUE INDEX "Member_lineUserId_key" ON "Member"("lineUserId");

CREATE TABLE "LineAuthFlow" (
  "tokenHash" TEXT NOT NULL,
  "stateHash" TEXT,
  "nonce" TEXT,
  "verifier" TEXT,
  "lineUserId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LineAuthFlow_pkey" PRIMARY KEY ("tokenHash")
);
CREATE INDEX "LineAuthFlow_expiresAt_idx" ON "LineAuthFlow"("expiresAt");
