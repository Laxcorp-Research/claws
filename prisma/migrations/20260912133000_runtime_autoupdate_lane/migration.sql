-- RUNTIME-9.4 PR-3: autoupdate lane columns + supersede six orphan candidates
-- that never became isStable (historical soak failures, not the 9.4 row).
ALTER TABLE "OpenClawVersion" ADD COLUMN "supersededAt" TIMESTAMP(3);
ALTER TABLE "OpenClawVersion" ADD COLUMN "soakGreenAt" TIMESTAMP(3);
ALTER TABLE "OpenClawVersion" ADD COLUMN "lastStalePingAt" TIMESTAMP(3);
ALTER TABLE "OpenClawVersion" ADD COLUMN "lastSoakAlertAt" TIMESTAMP(3);

UPDATE "OpenClawVersion"
SET "supersededAt" = CURRENT_TIMESTAMP
WHERE "isStable" = false
  AND "version" IN (
    '2026.6.10',
    '2026.6.11',
    '2026.7.1',
    '2026.7.1-2',
    '2026.8.1',
    '2026.9.2'
  );
