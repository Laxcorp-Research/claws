-- AlterTable
-- Tool customization PR-1: per-workspace requirement set (nullable for legacy dual-read).
ALTER TABLE "Workspace" ADD COLUMN "toolRequirements" JSONB;
