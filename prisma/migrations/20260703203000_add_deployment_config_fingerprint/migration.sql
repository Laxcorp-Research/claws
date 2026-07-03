-- Add nullable deployment config fingerprint fields for drift detection.
ALTER TABLE "Deployment" ADD COLUMN "configHash" VARCHAR(64);
ALTER TABLE "Deployment" ADD COLUMN "configSnapshotGzip" BYTEA;
