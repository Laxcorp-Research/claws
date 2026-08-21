import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = process.cwd()

describe("buyer-independence after unpublish", () => {
  it("MUTATION: generator/deploy must not gate on listing isPublished", () => {
    const generator = readFileSync(join(ROOT, "src/lib/openclaw/generator.ts"), "utf8")
    const deployer = readFileSync(join(ROOT, "src/lib/openclaw/deployer.ts"), "utf8")
    const cloud = readFileSync(
      join(ROOT, "src/app/api/deploy/[workspaceId]/cloud/route.ts"),
      "utf8",
    )
    const redeploy = readFileSync(
      join(ROOT, "src/app/api/deploy/[workspaceId]/redeploy/route.ts"),
      "utf8",
    )
    for (const src of [generator, deployer, cloud, redeploy]) {
      expect(src).not.toMatch(/isPubliclyListable/)
      expect(src).not.toMatch(/listingState/)
    }
    expect(generator).not.toMatch(/isPublished/)
    expect(deployer).not.toMatch(/isPublished/)
    expect(cloud).not.toMatch(/isPublished/)
    expect(redeploy).not.toMatch(/isPublished/)
  })

  it("workspace snapshot copy is independent of live listing (createWorkspaceFromTemplate)", () => {
    const fromTemplate = readFileSync(
      join(ROOT, "src/lib/workspace-from-template.ts"),
      "utf8",
    )
    expect(fromTemplate).toContain("Verbatim copy of snapshot.tools")
    expect(fromTemplate).toMatch(/JSON\.parse\(raw\)/)
    expect(fromTemplate).not.toMatch(/isPubliclyListable/)
  })
})
