import { beforeEach, describe, expect, it, vi } from "vitest"

const redisEval = vi.fn()
const redisGet = vi.fn()
const redisIncrby = vi.fn()
const redisExpire = vi.fn()

vi.mock("@/lib/redis", () => ({
  redis: {
    eval: (...args: unknown[]) => redisEval(...args),
    get: (...args: unknown[]) => redisGet(...args),
    incrby: (...args: unknown[]) => redisIncrby(...args),
    expire: (...args: unknown[]) => redisExpire(...args),
  },
}))

vi.mock("@/lib/logger", () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import { reserveWindowAtomic } from "@/lib/credits/reserve-window-atomic"

describe("reserveWindowAtomic", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns remainingCents via eval when available", async () => {
    redisEval.mockResolvedValueOnce(300)
    const result = await reserveWindowAtomic({
      balanceKey: "credit:balance:u1",
      reservationsKey: "credit:reservations:u1",
      windowSizeCents: 200,
    })
    expect(result).toEqual({ ok: true, remainingCents: 300, via: "eval" })
    expect(redisIncrby).not.toHaveBeenCalled()
  })

  it("returns INSUFFICIENT_CREDITS via eval when script returns -1", async () => {
    redisEval.mockResolvedValueOnce(-1)
    const result = await reserveWindowAtomic({
      balanceKey: "credit:balance:u1",
      reservationsKey: "credit:reservations:u1",
      windowSizeCents: 200,
    })
    expect(result).toEqual({
      ok: false,
      reason: "INSUFFICIENT_CREDITS",
      via: "eval",
    })
  })

  it("falls back to GET+INCRBY when EVAL throws (staging 500 root cause)", async () => {
    redisEval.mockRejectedValueOnce(new Error("ERR unknown command 'EVAL'"))
    redisGet.mockResolvedValueOnce("500") // balance
    redisGet.mockResolvedValueOnce("0") // reservations
    redisIncrby.mockResolvedValueOnce(200)
    redisExpire.mockResolvedValueOnce(1)

    const result = await reserveWindowAtomic({
      balanceKey: "credit:balance:u1",
      reservationsKey: "credit:reservations:u1",
      windowSizeCents: 200,
    })
    expect(result).toEqual({ ok: true, remainingCents: 300, via: "fallback" })
    expect(redisIncrby).toHaveBeenCalledWith("credit:reservations:u1", 200)
    expect(redisExpire).toHaveBeenCalledWith("credit:reservations:u1", 600)
  })

  it("fallback returns INSUFFICIENT when available < cost", async () => {
    redisEval.mockRejectedValueOnce(new Error("eval down"))
    redisGet.mockResolvedValueOnce("50")
    redisGet.mockResolvedValueOnce("40")

    const result = await reserveWindowAtomic({
      balanceKey: "credit:balance:u1",
      reservationsKey: "credit:reservations:u1",
      windowSizeCents: 200,
    })
    expect(result).toEqual({
      ok: false,
      reason: "INSUFFICIENT_CREDITS",
      via: "fallback",
    })
    expect(redisIncrby).not.toHaveBeenCalled()
  })

  it("MUTATION: reserve-window route must call reserveWindowAtomic (drop → fail)", async () => {
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const src = readFileSync(
      join(process.cwd(), "src/app/api/internal/metering/reserve-window/route.ts"),
      "utf8",
    )
    expect(src).toContain("reserveWindowAtomic")
    expect(src).not.toMatch(/await redis\.eval\(/)
  })
})
