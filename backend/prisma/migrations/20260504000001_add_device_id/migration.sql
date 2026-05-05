-- AlterTable: add deviceId to User for basic fraud prevention
ALTER TABLE "User" ADD COLUMN "deviceId" TEXT;

-- CreateIndex on deviceId
CREATE UNIQUE INDEX "User_deviceId_key" ON "User"("deviceId");
