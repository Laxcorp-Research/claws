import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { createMockRequest } from "@/test/helpers/mock-request"

const mockRequireAdmin = vi.fn()
const mockGetBatches = vi.fn()
const mockGetProcessing = vi.fn()
const mockRelease = vi.fn()

vi.mock("@/lib/api/admin", () => ({
  requireAdmin: () => mockRequireAdmin(),
}))
vi.mock("@/lib/marketplace/payouts", () => ({
  getReleasablePayoutBatches: () => mockGetBatches(),
  getProcessingPayoutBatches: () => mockGetProcessing(),
  releaseEligiblePayouts: () => mockRelease(),
}))
vi.mock("@/lib/security/audit-log", () => ({
  logAdminAction: vi.fn(),
}))

import { GET } from "@/app/api/admin/payouts/release/route"

const CRON_SECRET = "test-cron-secret"

describe("GET /api/admin/payouts/release — cron auth (D1/vercel.json)", () => {
  let prevCronSecret: string | undefined

  beforeEach(() => {
    mockRequireAdmin.mockReset()
    mockGetBatches.mockReset()
    mockGetProcessing.mockReset()
    mockRelease.mockReset()
    mockGetBatches.mockResolvedValue([])
    mockGetProcessing.mockResolvedValue([])
    mockRelease.mockResolvedValue({ released: 0, totalAmount: 0 })
    prevCronSecret = process.env.CRON_SECRET
    process.env.CRON_SECRET = CRON_SECRET
  })

  afterEach(() => {
    if (prevCronSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = prevCronSecret
  })

  it("accepts Bearer CRON_SECRET without requireAdmin (vercel cron / D1 scheduler)", async () => {
    const req = createMockRequest("http://localhost:3000/api/admin/payouts/release", {
      method: "GET",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(mockRequireAdmin).not.toHaveBeenCalled()
    expect(mockRelease).toHaveBeenCalledTimes(1)
    expect(mockGetBatches).toHaveBeenCalledTimes(1)
    expect(mockGetProcessing).toHaveBeenCalledTimes(1)
  })

  it("MUTATION: dropping cron auth gate would 403 the scheduler", async () => {
    // Lock the isCron short-circuit — without it, Bearer CRON_SECRET falls through to requireAdmin.
    const source = GET.toString()
    expect(source).toContain("isCron")
    expect(source).toContain("CRON_SECRET")

    mockRequireAdmin.mockRejectedValue(new Error("FORBIDDEN"))
    const req = createMockRequest("http://localhost:3000/api/admin/payouts/release", {
      method: "GET",
      headers: { authorization: "Bearer wrong-secret" },
    })
    const res = await GET(req)
    expect(res.status).toBe(403)
  })
})
