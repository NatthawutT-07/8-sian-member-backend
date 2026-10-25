ALTER TABLE "Member" ADD COLUMN "birthDate" DATE;
ALTER TABLE "Member" DROP COLUMN "phoneVerifiedAt";
DROP TABLE "SmsThrottle";
