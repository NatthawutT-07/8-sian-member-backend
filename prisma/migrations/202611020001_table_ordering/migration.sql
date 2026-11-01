ALTER TABLE "PosSale" ADD COLUMN "tableId" TEXT,
  ADD COLUMN "tableNumber" INTEGER, ADD COLUMN "tableSessionId" TEXT;

CREATE TABLE "DiningTable" (
  "id" TEXT NOT NULL, "number" INTEGER NOT NULL, "qrToken" TEXT NOT NULL,
  "sessionId" TEXT, "orderingEnabled" BOOLEAN NOT NULL DEFAULT false, "zones" JSONB NOT NULL DEFAULT '[]',
  "openedAt" TIMESTAMP(3), "openedBy" TEXT, "closedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiningTable_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DiningTable_number_check" CHECK ("number" BETWEEN 1 AND 9999),
  CONSTRAINT "DiningTable_activation_check" CHECK (NOT "orderingEnabled" OR "sessionId" IS NOT NULL),
  CONSTRAINT "DiningTable_zones_check" CHECK (jsonb_typeof("zones") = 'array')
);
CREATE UNIQUE INDEX "DiningTable_number_key" ON "DiningTable"("number");
CREATE UNIQUE INDEX "DiningTable_qrToken_key" ON "DiningTable"("qrToken");
CREATE UNIQUE INDEX "DiningTable_sessionId_key" ON "DiningTable"("sessionId");
CREATE TABLE "OrderingMenuItem" (
  "id" TEXT NOT NULL, "zone" TEXT NOT NULL, "category" TEXT NOT NULL, "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderingMenuItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrderingMenuItem_zone_category_name_key" ON "OrderingMenuItem"("zone", "category", "name");
CREATE TABLE "TableOrder" (
  "id" TEXT NOT NULL, "key" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
  "tableId" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "items" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NEW', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3), CONSTRAINT "TableOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TableOrder_status_check" CHECK ("status" IN ('NEW', 'DONE')),
  CONSTRAINT "TableOrder_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "DiningTable"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TableOrder_key_key" ON "TableOrder"("key");
CREATE INDEX "TableOrder_status_createdAt_idx" ON "TableOrder"("status", "createdAt");
CREATE INDEX "TableOrder_tableId_sessionId_idx" ON "TableOrder"("tableId", "sessionId");
