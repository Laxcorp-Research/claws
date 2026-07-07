ALTER TABLE "ActivityLog" ADD COLUMN "channelId" TEXT;

UPDATE "ActivityLog"
SET "channelId" = metadata::jsonb->>'channelId'
WHERE metadata IS NOT NULL
  AND metadata::jsonb ? 'channelId';

CREATE INDEX "ActivityLog_workspaceId_channelId_timestamp_idx" ON "ActivityLog"("workspaceId", "channelId", "timestamp");
CREATE INDEX "ActivityLog_workspaceId_agentSlug_timestamp_idx" ON "ActivityLog"("workspaceId", "agentSlug", "timestamp");
CREATE INDEX "ActivityLog_workspaceId_actionType_timestamp_idx" ON "ActivityLog"("workspaceId", "actionType", "timestamp");
