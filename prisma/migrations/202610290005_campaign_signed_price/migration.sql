-- Match the existing API and member UI: negative baht = discount, positive = surcharge.
ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_extraPrice_check";
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_extraPrice_check"
  CHECK ("extraPrice" BETWEEN -100000 AND 100000);
