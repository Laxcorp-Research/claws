-- Wave ACK: Railway deploy governor.
-- Additive: WorkspaceStatus.PROVISIONING_QUEUED + create ledger + FIFO queue
-- + singleton hold state. Ledger has no Workspace FK so budget survives delete.
-- Do not use the new enum value in this same transaction (PG ADD VALUE rule).

ALTER TYPE "WorkspaceStatus" ADD VALUE 'PROVISIONING_QUEUED';

CREATE TABLE "RailwayCreateLedger" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workspaceId" TEXT NOT NULL,
    "serviceId" TEXT,

    CONSTRAINT "RailwayCreateLedger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProvisioningQueue" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "enqueuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "etaAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "ProvisioningQueue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RailwayGovernorState" (
    "id" TEXT NOT NULL,
    "quotaHoldUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RailwayGovernorState_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RailwayCreateLedger_createdAt_idx" ON "RailwayCreateLedger"("createdAt");
CREATE INDEX "RailwayCreateLedger_workspaceId_idx" ON "RailwayCreateLedger"("workspaceId");
CREATE UNIQUE INDEX "ProvisioningQueue_workspaceId_key" ON "ProvisioningQueue"("workspaceId");
CREATE INDEX "ProvisioningQueue_enqueuedAt_idx" ON "ProvisioningQueue"("enqueuedAt");

ALTER TABLE "ProvisioningQueue" ADD CONSTRAINT "ProvisioningQueue_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
