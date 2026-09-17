-- Railway service pool: banked empty services against the 25/day
-- serviceCreate cap. Additive only: ServicePoolState enum + ServicePool
-- inventory table + ServicePoolMeta singleton (low-watermark alert
-- bookkeeping). ServicePool has NO Workspace FK on purpose - inventory
-- rows must survive workspace delete (same rule as RailwayCreateLedger).

CREATE TYPE "ServicePoolState" AS ENUM ('READY', 'ASSIGNED', 'RECYCLING');

CREATE TABLE "ServicePool" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "domain" TEXT,
    "state" "ServicePoolState" NOT NULL DEFAULT 'READY',
    "workspaceId" TEXT,
    "lastError" TEXT,
    "assignedAt" TIMESTAMP(3),
    "recycledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServicePool_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServicePoolMeta" (
    "id" TEXT NOT NULL,
    "highWatermark" INTEGER NOT NULL DEFAULT 0,
    "lowAlertSentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServicePoolMeta_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServicePool_serviceId_key" ON "ServicePool"("serviceId");
CREATE INDEX "ServicePool_state_idx" ON "ServicePool"("state");
CREATE INDEX "ServicePool_workspaceId_idx" ON "ServicePool"("workspaceId");
