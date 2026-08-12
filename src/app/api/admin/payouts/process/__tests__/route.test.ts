import { beforeEach, describe, expect, it, vi } from "vitest"
import { createMockRequest } from "@/test/helpers/mock-request"

const mockRequireAdmin = vi.fn()
const mockMarkProcessing = vi.fn()
const mockFindMany = vi.fn()
const mockAuditCreate = vi.fn()

vi.mock("@/lib/api/admin", () => ({
  requireAdmin: () => mockRequireAdmin(),
}))
vi.mock("@/lib/marketplace/payouts", () => ({
  markPayoutProcessing: (...args: unknown[]) => mockMarkProcessing(...args),
}))
vi.mock("@/lib/security/audit-log", () => ({
  logAdminAction: vi.fn(),
}))
vi.mock("@/lib/db", () => ({
  prisma: {
    marketplaceSale: { findMany: (...args: unknown[]) => mockFindMany(...args) },
    auditLog: { create: (...args: unknown[]) => mockAuditCreate(...args) },
  },
}))

import { POST } from "@/app/api/admin/payouts/process/route"

describe("POST /api/admin/payouts/process", () => {
  beforeEach(() => {
    mockRequireAdmin.mockReset()
    mockMarkProcessing.mockReset()
    mockFindMany.mockReset()
    mockAuditCreate.mockReset()
    mockRequireAdmin.mockResolvedValue({ id: "admin1", email: "a@test.com" })
  })

  it("marks PROCESSING and writes PAYOUT_MARKED_PROCESSING audit", async () => {
    mockMarkProcessing.mockResolvedValue("batch_abc")
    const req = createMockRequest("http://localhost/api/admin/payouts/process", {
      method: "POST",
      body: { saleIds: ["s1", "s2"] },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockMarkProcessing).toHaveBeenCalledWith(["s1", "s2"])
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "PAYOUT_MARKED_PROCESSING",
          resourceId: "batch_abc",
        }),
      }),
    )
  })

  it("returns 400 on illegal transition (e.g. skip from non-RELEASABLE)", async () => {
    mockMarkProcessing.mockRejectedValue(
      new Error("PAYOUT_ILLEGAL_TRANSITION: markProcessing requires RELEASABLE"),
    )
    const req = createMockRequest("http://localhost/api/admin/payouts/process", {
      method: "POST",
      body: { saleIds: ["s1"] },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
