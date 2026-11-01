ALTER TABLE "PosUser" DROP CONSTRAINT "PosUser_role_check";
ALTER TABLE "PosUser" ADD CONSTRAINT "PosUser_role_check" CHECK ("role" IN ('USER', 'CHEF'));
