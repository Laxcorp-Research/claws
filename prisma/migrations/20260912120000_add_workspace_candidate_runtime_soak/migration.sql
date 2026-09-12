-- RUNTIME-9.4 PR-2: per-workspace candidate image soak flag.
-- Deployer honors this only for staging clones; KEEP canary and production
-- CLAWS_ENV always stay on the isStable pin.
ALTER TABLE "Workspace" ADD COLUMN "candidateRuntimeSoak" BOOLEAN NOT NULL DEFAULT false;
