import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { createMockRequest, parseResponse } from "@/test/helpers/mock-request"

const mockMark = vi.fn()
vi.mock("@/lib/openclaw/runtime-autoupdate", () => ({
  markSoakGreen: (...args: unknown[]) => mockMark(...args),
}))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { POST } from "@/app/api/internal/runtime/soak-signal/route"

beforeEach(() => {
  mockMark.mockReset()
  mockMark.mockResolvedValue({
    bump: "date-tuple",
    autoPromoted: false,
    founderAckRequired: true,
  })
  vi.stubEnv("VERSION_PIPELINE_SECRET", "pipe-secret")
  vi.stubEnv("CRON_SECRET", "cron-secret")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("POST /api/internal/runtime/soak-signal", () => {
  it("returns 401 without secret", async () => {
    const req = createMockRequest("http://localhost/api/internal/runtime/soak-signal", {
      method: "POST",
      body: { version: "2026.9.4", green: true },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it("records soak green for 9.4 without auto-promote", async () => {
    const req = createMockRequest("http://localhost/api/internal/runtime/soak-signal", {
      method: "POST",
      headers: { "X-Pipeline-Secret": "pipe-secret" },
      body: { version: "2026.9.4", green: true },
    })
    const { status, data } = await parseResponse(await POST(req))
    expect(status).toBe(200)
    expect(data.data.autoPromoted).toBe(false)
    expect(data.data.founderAckRequired).toBe(true)
    expect(mockMark).toHaveBeenCalledWith("2026.9.4")
  })

  it("rejects green:false", async () => {
    const req = createMockRequest("http://localhost/api/internal/runtime/soak-signal", {
      method: "POST",
      headers: { authorization: "Bearer cron-secret" },
      body: { version: "2026.9.4", green: false },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(mockMark).not.toHaveBeenCalled()
  })
})
