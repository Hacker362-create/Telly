-- Migration: add Voicemail table for voicemail feature
-- CreateTable
CREATE TABLE "Voicemail" (
    "id"            TEXT NOT NULL PRIMARY KEY,
    "callerId"      TEXT NOT NULL,
    "recipientId"   TEXT NOT NULL,
    "audioUrl"      TEXT NOT NULL,
    "durationSec"   INTEGER NOT NULL,
    "transcription" TEXT,
    "leftAt"        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "listenedAt"    DATETIME,
    CONSTRAINT "Voicemail_callerId_fkey"    FOREIGN KEY ("callerId")    REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Voicemail_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Voicemail_recipientId_leftAt_idx" ON "Voicemail" ("recipientId", "leftAt");
CREATE INDEX "Voicemail_callerId_leftAt_idx"    ON "Voicemail" ("callerId",    "leftAt");
