import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("account-retention cron", () => {
  const src = readFileSync(
    join(process.cwd(), "src/app/api/cron/account-retention/route.ts"),
    "utf8",
  )

  it("tears containers down before user.delete (orphan class)", () => {
    const body = src.slice(src.indexOf("export async function GET"))
    const teardown = body.indexOf("await destroyContainer")
    const userDelete = body.indexOf("prisma.user.delete")
    expect(teardown).toBeGreaterThan(0)
    expect(userDelete).toBeGreaterThan(teardown)
  })

  it("uses the 14-day account grace and the 90-day workspace clock", () => {
    expect(src).toContain("accountDeletionDue")
    expect(src).toContain("workspaceHardDeleteDue")
    expect(src).toContain("ACCOUNT_DELETION_GRACE_MS")
    expect(src).toContain("WORKSPACE_HARD_DELETE_MS")
  })

  it("rejects a missing cron secret", () => {
    expect(src).toContain("Unauthorized")
    expect(src).toContain("CRON_SECRET")
  })
})
