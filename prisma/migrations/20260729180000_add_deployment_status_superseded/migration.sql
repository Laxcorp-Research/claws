-- Wave ACK: new DeploymentStatus enum value SUPERSEDED.
-- Marks historical Deployment rows retired by hibernate/replace so force-update
-- and admin counts no longer fan out across wake-cycle zombies.
ALTER TYPE "DeploymentStatus" ADD VALUE 'SUPERSEDED';
