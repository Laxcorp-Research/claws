/**
 * Batch D: POST /api/agents persists skillIds (create path data-loss lock).
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockGetSessionUser = vi.fn()
vi.mock("@/lib/api/auth", () => ({ getSessionUser: () => mockGetSessionUser() }))

const mockVerifyOwnership = vi.fn()
vi.mock("@/lib/api/ownership", () => ({
  verifyWorkspaceOwnership: (...args: unknown[]) => mockVerifyOwnership(...args),
}))

import { POST } from "@/app/api/agents/[workspaceId]/route"

describe("POST /api/agents - skillIds on create (Batch D)", () => {
  beforeEach(() => {
    mockGetSessionUser.mockReset()
    mockVerifyOwnership.mockReset()
    mockGetSessionUser.mockResolvedValue({ id: "user-1" })
    mockVerifyOwnership.mockResolvedValue({ error: null })
    ;(prismaMock.agent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(prismaMock.agent.count as ReturnType<typeof vi.fn>).mockResolvedValue(1)
    ;(prismaMock.agent.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(prismaMock.agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "agent-new",
      name: "Researcher",
      role: "WORKER",
    })
    ;(prismaMock.agentSkill.createMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 2 })
  })

  it("createMany AgentSkill rows when skillIds provided", async () => {
    const req = createMockRequest("http://localhost:3000/api/agents/ws-1", {
      method: "POST",
      body: {
        name: "Researcher",
        role: "WORKER",
        skillIds: ["skill-a", "skill-b"],
      },
    })
    const res = await POST(req, { params: Promise.resolve({ workspaceId: "ws-1" }) })
    expect(res.status).toBe(201)
    expect(prismaMock.agentSkill.createMany).toHaveBeenCalledWith({
      data: [
        { agentId: "agent-new", skillId: "skill-a" },
        { agentId: "agent-new", skillId: "skill-b" },
      ],
      skipDuplicates: true,
    })
  })

  it("MUTATION: omit skillIds handling → fail", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/agents/[workspaceId]/route.ts"),
      "utf8",
    )
    expect(src).toContain("body.skillIds")
    expect(src).toContain("agentSkill.createMany")
  })
})
