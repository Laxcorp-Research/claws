import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(
  join(process.cwd(), "prisma/migrations/20261110120000_restore_search_vector/migration.sql"),
  "utf8",
)

describe("searchVector migration", () => {
  it("recreates the generated tsvector and GIN index after the drift drop", () => {
    const drop = readFileSync(
      join(process.cwd(), "prisma/migrations/20260620120100_reconcile_schema_history_drift/migration.sql"),
      "utf8",
    )
    expect(drop).toContain('DROP COLUMN IF EXISTS "searchVector"')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "searchVector" tsvector')
    expect(migration).toContain("GENERATED ALWAYS AS (claw_template_search_vector")
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS idx_claw_template_search ON "ClawTemplate" USING gin("searchVector")')
    expect(migration).toContain("GENERATED ALWAYS AS (marketplace_skill_search_vector")
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS idx_marketplace_skill_search")
  })
})
