CREATE TABLE "OrderingCategory" (
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "OrderingCategory_pkey" PRIMARY KEY ("name")
);
