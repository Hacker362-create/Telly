-- AlterTable: add free-tier daily usage tracking to User
ALTER TABLE "User" ADD COLUMN "dailyMinutesUsed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lastResetDate" DATETIME;
