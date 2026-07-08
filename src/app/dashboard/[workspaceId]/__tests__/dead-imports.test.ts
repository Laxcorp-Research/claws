import { readFileSync } from "fs"
import { join } from "path"
import { describe, expect, it } from "vitest"

describe("dashboard K4 dead imports", () => {
  it("does not import replaced flat dashboard surfaces", () => {
    const page = readFileSync(join(process.cwd(), "src/app/dashboard/[workspaceId]/page.tsx"), "utf8")
    expect(page).not.toContain("ClawNarrativeRow")
    expect(page).not.toContain("BriefingFooter")
    expect(page).not.toContain("ActivityFeed")
    expect(page).not.toContain("AgentStatusList")
    expect(page).not.toContain("StatCard")
  })
})
