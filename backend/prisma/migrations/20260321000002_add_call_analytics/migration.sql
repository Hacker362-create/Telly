-- CreateTable
CREATE TABLE "CallAnalytics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "callId" TEXT NOT NULL,
    "callerId" TEXT NOT NULL,
    "calleeId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "dataBytes" INTEGER NOT NULL,
    "avgLatencyMs" REAL NOT NULL,
    "packetLossPct" REAL NOT NULL,
    "networkType" TEXT NOT NULL,
    "iceRestartCount" INTEGER NOT NULL DEFAULT 0,
    "relayUsed" BOOLEAN NOT NULL DEFAULT false,
    "reconnectionEvents" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CallAnalytics_callerId_fkey" FOREIGN KEY ("callerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CallAnalytics_calleeId_fkey" FOREIGN KEY ("calleeId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CallAnalytics_callId_key" ON "CallAnalytics"("callId");

-- CreateIndex
CREATE INDEX "CallAnalytics_callerId_endedAt_idx" ON "CallAnalytics"("callerId", "endedAt");

-- CreateIndex
CREATE INDEX "CallAnalytics_calleeId_endedAt_idx" ON "CallAnalytics"("calleeId", "endedAt");

-- CreateIndex
CREATE INDEX "CallAnalytics_endedAt_idx" ON "CallAnalytics"("endedAt");
