import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest, parseResponse } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({
  prisma: prismaMock,
}))

vi.mock("@/lib/redis", () => ({
  redis: {
    set: vi.fn().mockResolvedValue("OK"),
    decrby: vi.fn().mockResolvedValue(0),
  },
}))

vi.mock("@/lib/logger", () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

const mockAfter = vi.fn()
vi.mock("next/server", async (orig) => {
  const actual = await orig<typeof import("next/server")>()
  return { ...actual, after: (cb: () => unknown) => mockAfter(cb) }
})

const mockOnCreditsExhausted = vi.fn()
vi.mock("@/lib/credits/exhaustion", () => ({
  onCreditsExhausted: (...args: unknown[]) => mockOnCreditsExhausted(...args),
}))

import { POST } from "@/app/api/internal/metering/report-batch/route"

const SECRET = "test-metering-secret"

beforeEach(() => {
  vi.clearAllMocks()
  process.env.METERING_MASTER_SECRET = SECRET
  mockOnCreditsExhausted.mockResolvedValue(undefined)
  ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: "ws-1", userId: "user-1" },
  ])
})

describe("POST /api/internal/metering/report-batch — exhaustion after()", () => {
  it("schedules onCreditsExhausted via after() when balance hits 0 (not setImmediate)", async () => {
    ;(prismaMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: typeof prismaMock) => Promise<void>) => {
        const tx = {
          creditAccount: {
            findUnique: vi.fn().mockResolvedValue({
              id: "ca-1",
              userId: "user-1",
              balanceCents: 5,
              status: "ACTIVE",
            }),
            update: vi.fn().mockResolvedValue({}),
          },
          creditUsageRecord: {
            createMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
        }
        await fn(tx as never)
      },
    )

    const req = createMockRequest("http://localhost:3000/api/internal/metering/report-batch", {
      method: "POST",
      headers: { "X-Metering-Secret": SECRET },
      body: {
        droppedCount: 0,
        records: [
          {
            workspaceId: "ws-1",
            model: "claude-sonnet-4-6",
            inputTokens: 100,
            outputTokens: 50,
            costCents: 5,
          },
        ],
      },
    })

    const res = await POST(req)
    const { status, data } = await parseResponse(res)

    expect(status).toBe(200)
    expect(data.data.processed).toBe(1)
    expect(mockAfter).toHaveBeenCalledTimes(1)
    expect(mockOnCreditsExhausted).not.toHaveBeenCalled()

    await (mockAfter.mock.calls[0][0] as () => Promise<void>)()
    expect(mockOnCreditsExhausted).toHaveBeenCalledWith("user-1")
  })

  it("does not schedule exhaustion when balance remains positive", async () => {
    ;(prismaMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: typeof prismaMock) => Promise<void>) => {
        const tx = {
          creditAccount: {
            findUnique: vi.fn().mockResolvedValue({
              id: "ca-1",
              userId: "user-1",
              balanceCents: 500,
              status: "ACTIVE",
            }),
            update: vi.fn().mockResolvedValue({}),
          },
          creditUsageRecord: {
            createMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
        }
        await fn(tx as never)
      },
    )

    const req = createMockRequest("http://localhost:3000/api/internal/metering/report-batch", {
      method: "POST",
      headers: { "X-Metering-Secret": SECRET },
      body: {
        droppedCount: 0,
        records: [
          {
            workspaceId: "ws-1",
            model: "claude-sonnet-4-6",
            inputTokens: 10,
            outputTokens: 5,
            costCents: 1,
          },
        ],
      },
    })

    await POST(req)
    expect(mockAfter).not.toHaveBeenCalled()
  })
})
