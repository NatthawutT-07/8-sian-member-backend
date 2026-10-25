BEGIN;
ALTER TABLE "Campaign" ADD COLUMN "prerequisiteCampaignId" TEXT;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_prerequisiteCampaignId_fkey"
  FOREIGN KEY ("prerequisiteCampaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_not_own_prerequisite"
  CHECK ("prerequisiteCampaignId" IS NULL OR "prerequisiteCampaignId" <> "id");
CREATE INDEX "Campaign_prerequisiteCampaignId_idx" ON "Campaign"("prerequisiteCampaignId");
-- Configure the existing second-visit offer without recreating coupons or usage records.
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM "Campaign" WHERE "title" = 'มารอบที่ 2 รับส่วนลด 20 บาท') > 1 THEN
    RAISE EXCEPTION 'Multiple second-visit campaigns found; identify the intended campaign before migrating';
  END IF;
END $$;
UPDATE "Campaign"
SET "prerequisiteCampaignId" = 'seafood79_welcome_v1'
WHERE "title" = 'มารอบที่ 2 รับส่วนลด 20 บาท'
  AND "id" <> 'seafood79_welcome_v1'
  AND EXISTS (SELECT 1 FROM "Campaign" WHERE "id" = 'seafood79_welcome_v1');
-- Discard previously opened barcodes for unused second-visit coupons.
UPDATE "Coupon" SET "barcodeTokenHash" = NULL, "barcodeExpiresAt" = NULL
WHERE "usedAt" IS NULL AND "campaign" IN
  (SELECT "id" FROM "Campaign" WHERE "prerequisiteCampaignId" IS NOT NULL);
COMMIT;
