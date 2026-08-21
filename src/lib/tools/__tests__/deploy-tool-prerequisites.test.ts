import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { readFileSync } from "node:fs"
import { join } from "node:path"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

import { evaluateWorkspaceDeployToolPrerequisites } from "@/lib/tools/deploy-tool-prerequisites"

describe("evaluateWorkspaceDeployToolPrerequisites", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("satisfied CONNECTED → proceeds (satisfied:true)", async () => {
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      toolRequirements: [
        {
          slug: "tavily",
          name: "Tavily",
          category: "search",
          connectionType: "API_KEY",
          required: true,
        },
      ],
      clawTemplateId: null,
      clawTemplate: null,
    })
    ;(prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        toolSlug: "tavily",
        status: "CONNECTED",
        connectionType: "API_KEY",
        lastError: null,
        keyHint: "tvly…",
        encryptedCredentials: "enc",
      },
    ])

    const result = await evaluateWorkspaceDeployToolPrerequisites("ws-1")
    expect(result.satisfied).toBe(true)
    expect(result.missingSlugs).toEqual([])
  })

  it("missing required → not satisfied, names the tool", async () => {
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      toolRequirements: [
        {
          slug: "tavily",
          name: "Tavily",
          category: "search",
          connectionType: "API_KEY",
          required: true,
        },
      ],
      clawTemplateId: null,
      clawTemplate: null,
    })
    ;(prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const result = await evaluateWorkspaceDeployToolPrerequisites("ws-1")
    expect(result.satisfied).toBe(false)
    expect(result.missingSlugs).toEqual(["tavily"])
    expect(result.missingLabels).toEqual(["Tavily"])
  })

  it("credentialed key PENDING-unverified → satisfied", async () => {
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      toolRequirements: [
        {
          slug: "tavily",
          name: "Tavily",
          category: "search",
          connectionType: "API_KEY",
          required: true,
        },
      ],
      clawTemplateId: null,
      clawTemplate: null,
    })
    ;(prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        toolSlug: "tavily",
        status: "PENDING",
        connectionType: "API_KEY",
        lastError: "Unverified - will validate on first use",
        keyHint: "tvly…",
        encryptedCredentials: "enc",
      },
    ])

    const result = await evaluateWorkspaceDeployToolPrerequisites("ws-1")
    expect(result.satisfied).toBe(true)
    expect(result.unverifiedCount).toBe(1)
  })

  it("MUTATION source lock: helper uses requiredToolsSatisfied + AI filter (bypass → fail)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/tools/deploy-tool-prerequisites.ts"),
      "utf8",
    )
    expect(src).toContain("requiredToolsSatisfied")
    expect(src).toContain("filterNonAiProviderRequiredEntries")
    expect(src).toContain("resolveWorkspaceToolRequirements")
    // Must project hasCredentials - never invent CONNECTED-only logic.
    expect(src).toContain("hasCredentials")
    expect(src).not.toMatch(/status\s*===\s*["']CONNECTED["']/)
  })
})
