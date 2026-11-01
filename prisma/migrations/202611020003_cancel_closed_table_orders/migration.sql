ALTER TABLE "TableOrder" DROP CONSTRAINT "TableOrder_status_check";
ALTER TABLE "TableOrder" ADD CONSTRAINT "TableOrder_status_check"
  CHECK ("status" IN ('NEW', 'DONE', 'CANCELLED'));

-- Remove outstanding orders from already-closed rounds from the staff queue.
UPDATE "TableOrder" AS o SET "status" = 'CANCELLED'
FROM "DiningTable" AS t
WHERE o."tableId" = t."id" AND o."status" = 'NEW'
  AND o."sessionId" IS DISTINCT FROM t."sessionId";
