import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mockReserve = vi.fn()
const mockRedisGet = vi.fn()
const mockRedisSet = vi.fn()
const mockFindUnique = vi.fn()

vi.mock("@/lib/credits/reserve-window-atomic", () => ({
  reserveWindowAtomic: (...args: unknown[]) => mockReserve(...args),
}))

vi.mock("@/lib/redis", () => ({
  redis: {
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  },
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    creditAccount: { findUnique: (...args: unknown[]) => mockFindUnique(...args) },
  },
}))

vi.mock("@/lib/logger", () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import { POST } from "@/app/api/internal/metering/reserve-window/route"

const SECRET = "test-metering-secret"

function makeReq(body: unknown, secret = SECRET) {
  return new NextRequest("http://localhost/api/internal/metering/reserve-window", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Metering-Secret": secret,
    },
    body: JSON.stringify(body),
  })
}

describe("POST /api/internal/metering/reserve-window", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.METERING_MASTER_SECRET = SECRET
    mockRedisGet.mockResolvedValue("500")
  })

  it("returns 401 on bad secret", async () => {
    const res = await POST(makeReq({ userId: "u1", windowSizeCents: 50 }, "wrong"))
    expect(res.status).toBe(401)
  })

  it("returns allowed:true when reserve succeeds (eval path)", async () => {
    mockReserve.mockResolvedValueOnce({
      ok: true,
      remainingCents: 250,
      via: "eval",
    })
    const res = await POST(makeReq({ userId: "u1", windowSizeCents: 200 }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.allowed).toBe(true)
    expect(json.data.remainingCents).toBe(250)
  })

  it("returns allowed:false on INSUFFICIENT_CREDITS (not 500)", async () => {
    mockReserve.mockResolvedValueOnce({
      ok: false,
      reason: "INSUFFICIENT_CREDITS",
      via: "fallback",
    })
    const res = await POST(makeReq({ userId: "u1", windowSizeCents: 200 }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toEqual({
      allowed: false,
      reason: "INSUFFICIENT_CREDITS",
    })
  })

  it("returns 503 (not bare 500) when reserve throws after fallback exhausted", async () => {
    mockReserve.mockRejectedValueOnce(new Error("redis totally down"))
    const res = await POST(makeReq({ userId: "u1", windowSizeCents: 200 }))
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error.code).toBe("REDIS_UNAVAILABLE")
  })
})
