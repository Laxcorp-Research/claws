ALTER TABLE "Workspace"
ADD COLUMN "mcpSessionHealthStatus" TEXT,
ADD COLUMN "mcpSessionCheckedAt" TIMESTAMP(3),
ADD COLUMN "mcpSessionLastError" TEXT;
