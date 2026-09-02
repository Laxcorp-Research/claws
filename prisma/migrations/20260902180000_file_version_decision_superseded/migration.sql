-- Additive enum value. A newer mission FileVersion of the same path
-- supersedes older pending (NONE) versions. Preview deploy applies this
-- to staging Neon (docs/MIGRATIONS.md).

ALTER TYPE "FileVersionDecision" ADD VALUE 'SUPERSEDED';
