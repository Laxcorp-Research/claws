-- Self-host: Docker is a third cloud provider behind deployer.ts.
-- Existing rows stay RAILWAY. Self-host stamps DOCKER at resolve time.
ALTER TYPE "CloudProvider" ADD VALUE IF NOT EXISTS 'DOCKER';
