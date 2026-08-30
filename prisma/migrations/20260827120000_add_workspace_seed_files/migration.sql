-- AlterTable
-- INFRA-2: per-workspace copy of template snapshot files[] (nullable for legacy dual-read).
ALTER TABLE "Workspace" ADD COLUMN "seedFiles" JSONB;
