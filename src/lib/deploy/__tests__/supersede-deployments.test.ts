import { beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

import { supersedePriorDeployments } from "@/lib/deploy/supersede-deployments"

describe("supersedePriorDeployments", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prismaMock.deployment.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 2 })
  })

  it("marks COMPLETED rows SUPERSEDED for workspace", async () => {
    const n = await supersedePriorDeployments("ws-1")
    expect(n).toBe(2)
    expect(prismaMock.deployment.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", status: "COMPLETED" },
      data: { status: "SUPERSEDED" },
    })
  })

  it("excludes the new deployment id on replace", async () => {
    await supersedePriorDeployments("ws-1", "dep-new")
    expect(prismaMock.deployment.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", status: "COMPLETED", id: { not: "dep-new" } },
      data: { status: "SUPERSEDED" },
    })
  })

  it("MUTATION: hibernate path must call supersedePriorDeployments", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/hibernation/manager.ts"), "utf8")
    expect(src).toContain("supersedePriorDeployments(workspaceId)")
  })

  it("MUTATION: deployToCloud replace path must supersede prior COMPLETED", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/openclaw/deployer.ts"), "utf8")
    expect(src).toContain("supersedePriorDeployments(workspaceId, deployment.id)")
  })
})
