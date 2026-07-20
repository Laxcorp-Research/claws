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

import { getSessionUser } from "@/lib/api/auth"
import { POST } from "../route"

const params = () => Promise.resolve({ slug: "paid-skill" })

const skillPaid = {
  id: "skill-1",
  slug: "paid-skill",
  isPublished: true,
  isFree: false,
  price: 19,
  trustTier: "SCANNED",
  reviewStatus: "APPROVED",
}

const skillFree = {
  id: "skill-2",
  slug: "free-skill",
  isPublished: true,
  isFree: true,
  price: 0,
  trustTier: "OFFICIAL",
  reviewStatus: "APPROVED",
}

const workspace = {
  id: "ws-1",
  userId: "user-1",
  status: "RUNNING",
  containerName: "c1",
  containerId: null,
  agents: [{ id: "a1", name: "A", agentSlug: "a" }],
}

describe("POST /api/marketplace/skills/[slug]/install — paid entitlement (Batch A / A2)", () => {
  beforeEach(() => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: "user-1", email: "u@test.com" } as never)
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

  it("allows paid install when MarketplaceSale exists for buyer", async () => {
    prismaMock.marketplaceSkill.findUnique.mockResolvedValue(skillPaid as never)
    prismaMock.workspace.findUnique.mockResolvedValue(workspace as never)
    prismaMock.skillInstall.findUnique.mockResolvedValue(null)
    prismaMock.marketplaceSale.findFirst.mockResolvedValue({ id: "sale-1" } as never)
    prismaMock.skillInstall.create.mockResolvedValue({ id: "inst-1" } as never)
    prismaMock.marketplaceSkill.update.mockResolvedValue(skillPaid as never)

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

  it("allows free install without purchase row", async () => {
    prismaMock.marketplaceSkill.findUnique.mockResolvedValue(skillFree as never)
    prismaMock.workspace.findUnique.mockResolvedValue(workspace as never)
    prismaMock.skillInstall.findUnique.mockResolvedValue(null)
    prismaMock.skillInstall.create.mockResolvedValue({ id: "inst-2" } as never)
    prismaMock.marketplaceSkill.update.mockResolvedValue(skillFree as never)

    const res = await POST(
      createMockRequest("http://localhost/api/marketplace/skills/free-skill/install", {
        method: "POST",
        body: { workspaceId: "ws-1" },
      }),
      { params: Promise.resolve({ slug: "free-skill" }) },
    )
    const { status } = await parseResponse(res)
    expect(status).toBe(201)
    expect(prismaMock.marketplaceSale.findFirst).not.toHaveBeenCalled()
  })

  it("MUTATION: removing entitlement check would allow paid install — lock via findFirst call", async () => {
    prismaMock.marketplaceSkill.findUnique.mockResolvedValue(skillPaid as never)
    prismaMock.workspace.findUnique.mockResolvedValue(workspace as never)
    prismaMock.skillInstall.findUnique.mockResolvedValue(null)
    prismaMock.marketplaceSale.findFirst.mockResolvedValue(null)

    await POST(
      createMockRequest("http://localhost/api/marketplace/skills/paid-skill/install", {
        method: "POST",
        body: { workspaceId: "ws-1" },
      }),
      { params: params() },
    )
    expect(prismaMock.marketplaceSale.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { skillId: "skill-1", buyerId: "user-1" },
      }),
    )
  })
})
