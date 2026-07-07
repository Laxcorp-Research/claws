import { readFileSync } from "fs"
import { join } from "path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(
  join(process.cwd(), "prisma/migrations/20260707170000_add_activity_log_channel_id/migration.sql"),
  "utf8",
)

describe("K2 ActivityLog channelId migration", () => {
  it("adds only the channelId column, three composite indexes, and metadata backfill", () => {
    expect(migration).toContain('ALTER TABLE "ActivityLog" ADD COLUMN "channelId" TEXT;')
    expect(migration).toContain('SET "channelId" = metadata::jsonb->>\'channelId\'')
    expect(migration).toContain("metadata::jsonb ? 'channelId'")
    expect(migration).toContain('"ActivityLog_workspaceId_channelId_timestamp_idx"')
    expect(migration).toContain('"ActivityLog_workspaceId_agentSlug_timestamp_idx"')
    expect(migration).toContain('"ActivityLog_workspaceId_actionType_timestamp_idx"')
    expect(migration).not.toContain("DROP")
  })
})
