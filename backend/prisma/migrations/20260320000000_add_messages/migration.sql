-- Migration: add Message table for in-app 1-to-1 messaging
-- CreateTable
CREATE TABLE "Message" (
    "id"          TEXT NOT NULL PRIMARY KEY,
    "senderId"    TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "body"        TEXT NOT NULL,
    "sentAt"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt"      DATETIME,
    CONSTRAINT "Message_senderId_fkey"    FOREIGN KEY ("senderId")    REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Message_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Message_senderId_sentAt_idx"    ON "Message" ("senderId",    "sentAt");
CREATE INDEX "Message_recipientId_sentAt_idx" ON "Message" ("recipientId", "sentAt");
