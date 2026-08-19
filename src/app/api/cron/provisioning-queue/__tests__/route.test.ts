import { describe, expect, it, vi, beforeEach } from "vitest"
import { createMockRequest } from "@/test/helpers/mock-request"

const mockDrain = vi.fn()
vi.mock("@/lib/railway/governor", () => ({
  drainProvisioningQueueHead: (...args: unknown[]) => mockDrain(...args),
}))

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server")
  return { ...actual, after: vi.fn((fn: () => void) => fn) }
})

import { GET } from "@/app/api/cron/provisioning-queue/route"

describe("GET /api/cron/provisioning-queue", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = "cron-secret"
    mockDrain.mockResolvedValue({
      started: 0,
      skippedIneligible: 0,
      skippedNoBudget: 1,
      empty: false,
    })
  })

  it("401 without bearer", async () => {
    const req = createMockRequest("http://localhost/api/cron/provisioning-queue")
    const res = await GET(req)
    expect(res.status).toBe(401)
    expect(mockDrain).not.toHaveBeenCalled()
  })

  it("drains FIFO head via after() and returns 200", async () => {
    const req = createMockRequest("http://localhost/api/cron/provisioning-queue", {
      headers: { authorization: "Bearer cron-secret" },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(mockDrain).toHaveBeenCalledTimes(1)
  })
})
