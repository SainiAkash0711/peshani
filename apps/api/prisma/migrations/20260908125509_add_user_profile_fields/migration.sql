-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "address" JSONB,
ADD COLUMN     "dateOfBirth" DATE,
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "phone" TEXT;
