CREATE TABLE "PosReceiptCounter" (
  "businessDate" TEXT NOT NULL PRIMARY KEY,
  "lastNumber" INTEGER NOT NULL CHECK ("lastNumber" > 0)
);
ALTER TABLE "PosSale" ADD COLUMN "receiptNumber" TEXT;
-- createdAt is stored as a UTC timestamp without timezone. Format it in Bangkok.
WITH numbered AS (
  SELECT "id",
    to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok', 'YYMMDDHH24MI') AS prefix,
    row_number() OVER (
      PARTITION BY (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date
      ORDER BY "createdAt", "id"
    ) AS sequence
  FROM "PosSale"
)
UPDATE "PosSale" s SET "receiptNumber" = n.prefix ||
  CASE WHEN n.sequence < 1000 THEN lpad(n.sequence::text, 3, '0') ELSE n.sequence::text END
FROM numbered n WHERE n."id" = s."id";
INSERT INTO "PosReceiptCounter" ("businessDate", "lastNumber")
SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD'), count(*)::integer
FROM "PosSale" GROUP BY 1;
ALTER TABLE "PosSale" ALTER COLUMN "receiptNumber" SET NOT NULL;
CREATE UNIQUE INDEX "PosSale_receiptNumber_key" ON "PosSale"("receiptNumber");
