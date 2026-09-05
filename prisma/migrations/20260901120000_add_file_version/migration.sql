-- ARTIFACTS PR-1: FileVersion (third family). Additive create-table.
-- Card-source rows extracted from runtime state-sync gzip (shared/deliverables/*).
-- Preview deploy applies this to staging Neon (docs/MIGRATIONS.md).

CREATE TYPE "FileVersionTrigger" AS ENUM ('MISSION', 'EDIT', 'RESTORE', 'SEED');
CREATE TYPE "FileVersionDecision" AS ENUM ('NONE', 'APPROVED', 'REJECTED');

CREATE TABLE "FileVersion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "logicalPath" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "trigger" "FileVersionTrigger" NOT NULL,
    "runId" TEXT,
    "activityLogId" TEXT,
    "decision" "FileVersionDecision" NOT NULL DEFAULT 'NONE',
    "decisionReason" TEXT,

    CONSTRAINT "FileVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FileVersion_workspaceId_logicalPath_version_key" ON "FileVersion"("workspaceId", "logicalPath", "version");
CREATE INDEX "FileVersion_workspaceId_logicalPath_idx" ON "FileVersion"("workspaceId", "logicalPath");
CREATE INDEX "FileVersion_workspaceId_createdAt_idx" ON "FileVersion"("workspaceId", "createdAt");

ALTER TABLE "FileVersion" ADD CONSTRAINT "FileVersion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
