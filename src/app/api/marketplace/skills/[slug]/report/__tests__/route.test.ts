import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockGetSessionUser = vi.fn()
vi.mock("@/lib/api/auth", () => ({ getSessionUser: () => mockGetSessionUser() }))

import { POST } from "@/app/api/marketplace/skills/[slug]/report/route"

describe("POST /api/marketplace/skills/[slug]/report", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("creates a skill report (parity with template report)", async () => {
    mockGetSessionUser.mockResolvedValue({ id: "user-1" })
    ;(prismaMock.marketplaceSkill.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "skill-1",
    })
    ;(prismaMock.report.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "rep-1" })

    const req = createMockRequest("http://localhost/api/marketplace/skills/foo/report", {
      method: "POST",
      body: { reason: "MALICIOUS", details: "exfil" },
    })
    const res = await POST(req, { params: Promise.resolve({ slug: "foo" }) })
    const json = await res.json()
    expect(res.status).toBe(201)
    expect(json.data.reportId).toBe("rep-1")
    expect(prismaMock.report.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        skillId: "skill-1",
        reporterId: "user-1",
        reason: "MALICIOUS",
      }),
    })
  })

  it("rejects invalid reason", async () => {
    mockGetSessionUser.mockResolvedValue({ id: "user-1" })
    ;(prismaMock.marketplaceSkill.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "skill-1",
    })
    const req = createMockRequest("http://localhost/api/marketplace/skills/foo/report", {
      method: "POST",
      body: { reason: "NOT_A_REASON" },
    })
    const res = await POST(req, { params: Promise.resolve({ slug: "foo" }) })
    expect(res.status).toBe(400)
  })
})
