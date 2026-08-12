import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest, parseResponse } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/api/auth", () => ({
  getSessionUser: vi.fn(),
}))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const mockBridge = vi.fn()
vi.mock("@/lib/marketplace/skill-bridge", () => ({
  bridgeMarketplaceSkillToSkill: (...args: unknown[]) => mockBridge(...args),
}))

import { getSessionUser } from "@/lib/api/auth"
import { POST } from "../route"

const params = () => Promise.resolve({ slug: "paid-skill" })

const skillPaid = {
  id: "skill-1",
  slug: "paid-skill",
  name: "Paid",
  description: "d",
  category: "utilities",
  skillMd: "# x",
  emoji: null,
  requiredBins: [],
  requiredEnvVars: ["FOO_KEY"],
  isPublished: true,
  isFree: false,
  price: 19,
  trustTier: "SCANNED",
  reviewStatus: "APPROVED",
}

const skillFree = {
  ...skillPaid,
  id: "skill-2",
  slug: "free-skill",
  isFree: true,
  price: 0,
  trustTier: "OFFICIAL",
}

const workspace = {
  id: "ws-1",
  userId: "user-1",
  status: "STOPPED",
  agents: [
    { id: "orch-1", name: "Orch", agentSlug: "orch", role: "ORCHESTRATOR" },
    { id: "w-1", name: "Worker", agentSlug: "worker", role: "WORKER" },
  ],
}

function mockTxHappyPath() {
  ;(prismaMock.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock),
  )
  prismaMock.agentSkill.createMany.mockResolvedValue({ count: 1 } as never)
  prismaMock.skillInstall.create.mockResolvedValue({ id: "inst-1" } as never)
  prismaMock.marketplaceSkill.update.mockResolvedValue(skillPaid as never)
}

describe("POST /api/marketplace/skills/[slug]/install — REDEPLOY-CARRIES (PR-8)", () => {
  beforeEach(() => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: "user-1", email: "u@test.com" } as never)
    mockBridge.mockResolvedValue({ id: "lib-skill-1", slug: "paid-skill" })
  })

  it("rejects paid install without MarketplaceSale purchase row", async () => {
    prismaMock.marketplaceSkill.findUnique.mockResolvedValue(skillPaid as never)
    prismaMock.workspace.findUnique.mockResolvedValue(workspace as never)
    prismaMock.skillInstall.findUnique.mockResolvedValue(null)
    prismaMock.marketplaceSale.findFirst.mockResolvedValue(null)

    const res = await POST(
      createMockRequest("http://localhost/api/marketplace/skills/paid-skill/install", {
        method: "POST",
        body: { workspaceId: "ws-1" },
      }),
      { params: params() },
    )
    const { status, data } = await parseResponse(res)
    expect(status).toBe(403)
    expect(data.error.code).toBe("PURCHASE_REQUIRED")
  })

  it("install→AgentSkill attach defaults to orchestrator + appliesOnNextRedeploy", async () => {
    prismaMock.marketplaceSkill.findUnique.mockResolvedValue(skillFree as never)
    prismaMock.workspace.findUnique.mockResolvedValue(workspace as never)
    prismaMock.skillInstall.findUnique.mockResolvedValue(null)
    mockTxHappyPath()

    const res = await POST(
      createMockRequest("http://localhost/api/marketplace/skills/free-skill/install", {
        method: "POST",
        body: { workspaceId: "ws-1" },
      }),
      { params: Promise.resolve({ slug: "free-skill" }) },
    )
    const { status, data } = await parseResponse(res)
    expect(status).toBe(201)
    expect(data.data.appliesOnNextRedeploy).toBe(true)
    expect(data.data.agentIds).toEqual(["orch-1"])
    expect(mockBridge).toHaveBeenCalled()
    expect(prismaMock.agentSkill.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [{ agentId: "orch-1", skillId: "lib-skill-1" }],
      }),
    )
  })

  it("agent-picker attach matrix: explicit worker id wins over orchestrator default", async () => {
    prismaMock.marketplaceSkill.findUnique.mockResolvedValue(skillFree as never)
    prismaMock.workspace.findUnique.mockResolvedValue(workspace as never)
    prismaMock.skillInstall.findUnique.mockResolvedValue(null)
    mockTxHappyPath()

    const res = await POST(
      createMockRequest("http://localhost/api/marketplace/skills/free-skill/install", {
        method: "POST",
        body: { workspaceId: "ws-1", agentIds: ["w-1"] },
      }),
      { params: Promise.resolve({ slug: "free-skill" }) },
    )
    const { status, data } = await parseResponse(res)
    expect(status).toBe(201)
    expect(data.data.agentIds).toEqual(["w-1"])
  })

  it("allows paid install when MarketplaceSale exists for buyer", async () => {
    prismaMock.marketplaceSkill.findUnique.mockResolvedValue(skillPaid as never)
    prismaMock.workspace.findUnique.mockResolvedValue(workspace as never)
    prismaMock.skillInstall.findUnique.mockResolvedValue(null)
    prismaMock.marketplaceSale.findFirst.mockResolvedValue({ id: "sale-1" } as never)
    mockTxHappyPath()

    const res = await POST(
      createMockRequest("http://localhost/api/marketplace/skills/paid-skill/install", {
        method: "POST",
        body: { workspaceId: "ws-1" },
      }),
      { params: params() },
    )
    const { status } = await parseResponse(res)
    expect(status).toBe(201)
  })

  it("MUTATION: sever AgentSkill attach → createMany must be called (emission depends on it)", async () => {
    prismaMock.marketplaceSkill.findUnique.mockResolvedValue(skillFree as never)
    prismaMock.workspace.findUnique.mockResolvedValue(workspace as never)
    prismaMock.skillInstall.findUnique.mockResolvedValue(null)
    mockTxHappyPath()

    await POST(
      createMockRequest("http://localhost/api/marketplace/skills/free-skill/install", {
        method: "POST",
        body: { workspaceId: "ws-1" },
      }),
      { params: Promise.resolve({ slug: "free-skill" }) },
    )
    expect(prismaMock.agentSkill.createMany).toHaveBeenCalled()
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const src = readFileSync(
      join(process.cwd(), "src/app/api/marketplace/skills/[slug]/install/route.ts"),
      "utf8",
    )
    expect(src).toContain("agentSkill.createMany")
    expect(src).toContain("appliesOnNextRedeploy")
    expect(src).not.toContain("TODO: Hot-add skill to running container")
  })
})
