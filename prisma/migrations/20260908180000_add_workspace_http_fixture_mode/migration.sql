-- INFRA-5b: per-workspace HTTP fixture rail (staging rigs only).
-- Control plane refuses this flag when CLAWS_ENV=production even if true.
ALTER TABLE "Workspace" ADD COLUMN "httpFixtureMode" BOOLEAN NOT NULL DEFAULT false;
