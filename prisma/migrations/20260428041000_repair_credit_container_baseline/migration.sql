-- Repair schema-history gap from commit 6221870.
--
-- These objects were added to prisma/schema.prisma and reached live databases via
-- db push, but no committed CREATE migration exists. This migration is
-- intentionally idempotent: it creates missing baseline objects for fresh
-- migration replays while remaining a no-op on prod/staging where they already
-- exist.

DO $$
BEGIN
  CREATE TYPE "CreditStatus" AS ENUM ('ACTIVE', 'EXHAUSTED', 'SUSPENDED', 'CONVERTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ContainerPhase" AS ENUM ('RUNNING', 'WARM', 'HIBERNATED', 'WAKING', 'STOPPED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "WorkspaceApiKey" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "provider" "ApiProvider" NOT NULL,
  "encryptedKey" TEXT NOT NULL,
  "keyHint" TEXT NOT NULL,
  "isValid" BOOLEAN NOT NULL DEFAULT false,
  "lastValidatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkspaceApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceApiKey_workspaceId_provider_key" ON "WorkspaceApiKey"("workspaceId", "provider");
CREATE INDEX IF NOT EXISTS "WorkspaceApiKey_workspaceId_idx" ON "WorkspaceApiKey"("workspaceId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'WorkspaceApiKey_workspaceId_fkey'
  ) THEN
    ALTER TABLE "WorkspaceApiKey"
      ADD CONSTRAINT "WorkspaceApiKey_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "CreditAccount" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "initialGrantCents" INTEGER NOT NULL DEFAULT 5000,
  "balanceCents" INTEGER NOT NULL DEFAULT 5000,
  "totalConsumedCents" INTEGER NOT NULL DEFAULT 0,
  "status" "CreditStatus" NOT NULL DEFAULT 'ACTIVE',
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "exhaustedAt" TIMESTAMP(3),
  "grantFingerprint" TEXT,
  "ipAtGrant" TEXT,
  "flaggedForReview" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CreditAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CreditAccount_userId_key" ON "CreditAccount"("userId");
CREATE INDEX IF NOT EXISTS "CreditAccount_userId_idx" ON "CreditAccount"("userId");
CREATE INDEX IF NOT EXISTS "CreditAccount_status_idx" ON "CreditAccount"("status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CreditAccount_userId_fkey'
  ) THEN
    ALTER TABLE "CreditAccount"
      ADD CONSTRAINT "CreditAccount_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "CreditUsageRecord" (
  "id" TEXT NOT NULL,
  "creditAccountId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "agentId" TEXT,
  "provider" "ApiProvider" NOT NULL,
  "model" TEXT NOT NULL,
  "inputTokens" INTEGER NOT NULL,
  "outputTokens" INTEGER NOT NULL,
  "costCents" INTEGER NOT NULL,
  "balanceAfterCents" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CreditUsageRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CreditUsageRecord_creditAccountId_idx" ON "CreditUsageRecord"("creditAccountId");
CREATE INDEX IF NOT EXISTS "CreditUsageRecord_workspaceId_idx" ON "CreditUsageRecord"("workspaceId");
CREATE INDEX IF NOT EXISTS "CreditUsageRecord_createdAt_idx" ON "CreditUsageRecord"("createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CreditUsageRecord_creditAccountId_fkey'
  ) THEN
    ALTER TABLE "CreditUsageRecord"
      ADD CONSTRAINT "CreditUsageRecord_creditAccountId_fkey"
      FOREIGN KEY ("creditAccountId") REFERENCES "CreditAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "CreditUsageDaily" (
  "id" TEXT NOT NULL,
  "creditAccountId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "provider" "ApiProvider" NOT NULL,
  "model" TEXT NOT NULL,
  "totalCalls" INTEGER NOT NULL,
  "totalInputTokens" INTEGER NOT NULL,
  "totalOutputTokens" INTEGER NOT NULL,
  "totalCostCents" INTEGER NOT NULL,

  CONSTRAINT "CreditUsageDaily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CreditUsageDaily_creditAccountId_workspaceId_date_provider__key" ON "CreditUsageDaily"("creditAccountId", "workspaceId", "date", "provider", "model");
CREATE INDEX IF NOT EXISTS "CreditUsageDaily_creditAccountId_idx" ON "CreditUsageDaily"("creditAccountId");
CREATE INDEX IF NOT EXISTS "CreditUsageDaily_date_idx" ON "CreditUsageDaily"("date");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CreditUsageDaily_creditAccountId_fkey'
  ) THEN
    ALTER TABLE "CreditUsageDaily"
      ADD CONSTRAINT "CreditUsageDaily_creditAccountId_fkey"
      FOREIGN KEY ("creditAccountId") REFERENCES "CreditAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ContainerState" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "containerPhase" "ContainerPhase" NOT NULL DEFAULT 'STOPPED',
  "lastActiveAt" TIMESTAMP(3),
  "hibernatedAt" TIMESTAMP(3),
  "wakeRequestedAt" TIMESTAMP(3),
  "nextHeartbeatAt" TIMESTAMP(3),
  "heartbeatInterval" INTEGER,
  "heartbeatCronExpressions" TEXT,
  "hasActiveChannels" BOOLEAN NOT NULL DEFAULT false,
  "lastChannelMessageAt" TIMESTAMP(3),
  "activeMinutesToday" INTEGER NOT NULL DEFAULT 0,
  "lastResetDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastWakeDurationMs" INTEGER,
  "avgWakeDurationMs" INTEGER,
  "savedVolumeId" TEXT,
  "savedContainerConfig" TEXT,
  "runtimeStateSnapshot" BYTEA,
  "runtimeStateUpdatedAt" TIMESTAMP(3),
  "runtimeStateSizeBytes" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContainerState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ContainerState_workspaceId_key" ON "ContainerState"("workspaceId");
CREATE INDEX IF NOT EXISTS "ContainerState_containerPhase_idx" ON "ContainerState"("containerPhase");
CREATE INDEX IF NOT EXISTS "ContainerState_nextHeartbeatAt_idx" ON "ContainerState"("nextHeartbeatAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ContainerState_workspaceId_fkey'
  ) THEN
    ALTER TABLE "ContainerState"
      ADD CONSTRAINT "ContainerState_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
