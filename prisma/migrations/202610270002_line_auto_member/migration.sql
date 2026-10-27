ALTER TABLE "Member" ADD COLUMN "lineDisplayName" TEXT;
ALTER TABLE "LineAuthFlow" ADD COLUMN "displayName" TEXT;
ALTER TABLE "LineAuthFlow" ADD COLUMN "linkExisting" BOOLEAN NOT NULL DEFAULT false;
