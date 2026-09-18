-- Fly Machines adapter: provider-per-workspace column. Additive only.
-- Every existing workspace stays RAILWAY (default); FLY is stamped at first
-- provision (NEW_WORKSPACE_PROVIDER) or by migrate-on-wake
-- (MIGRATE_ON_WAKE_TO). See docs/FLY_MACHINES_ADAPTER.md.

CREATE TYPE "CloudProvider" AS ENUM ('RAILWAY', 'FLY');

ALTER TABLE "Workspace" ADD COLUMN "provider" "CloudProvider" NOT NULL DEFAULT 'RAILWAY';
