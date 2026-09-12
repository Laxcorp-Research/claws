import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest, parseResponse } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const mockPing = vi.fn()
vi.mock("@/lib/openclaw/runtime-autoupdate", () => ({
  pingStaleCandidates: (...args: unknown[]) => mockPing(...args),
}))

import { GET } from "@/app/api/cron/runtime-autoupdate/route"

beforeEach(() => {
  mockPing.mockReset()
  mockPing.mockResolvedValue({ pinged: ["2026.8.1"], skipped: [] })
  vi.stubEnv("CRON_SECRET", "cron-secret")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("GET /api/cron/runtime-autoupdate", () => {
  it("returns 401 without bearer secret", async () => {
    const req = createMockRequest("http://localhost/api/cron/runtime-autoupdate")
    const res = await GET(req)
    expect(res.status).toBe(401)
    expect(mockPing).not.toHaveBeenCalled()
  })

  it("pings stale candidates when authorized", async () => {
    const req = createMockRequest("http://localhost/api/cron/runtime-autoupdate", {
      headers: { authorization: "Bearer cron-secret" },
    })
    const { status, data } = await parseResponse(await GET(req))
    expect(status).toBe(200)
    expect(data.data.pinged).toEqual(["2026.8.1"])
  })
})
