/**
 * THE MISSING HANDSHAKE - credit-proxy.mjs emits a specific JSON body +
 * X-Metering-Secret header. This test constructs that payload byte-exact
 * (via buildProxyUsageRecord / buildProxyReportBatchBody, mirrored from
 * container/credit-proxy.mjs) and asserts the route durable-writes + debits.
 *
 * Mutation: restore a pre-proxy expectation (e.g. body without `provider` /
 * `timestamp`, or Authorization instead of X-Metering-Secret) → this test fails.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest, parseResponse } from "@/test/helpers/mock-request"
import {
  buildProxyReportBatchBody,
  buildProxyUsageRecord,
  METERING_SECRET_HEADER,
} from "@/lib/credits/proxy-metering-payload"

vi.mock("@/lib/db", () => ({
  prisma: prismaMock,
}))

const redisSet = vi.fn().mockResolvedValue("OK")
const redisDecrby = vi.fn().mockResolvedValue(0)
vi.mock("@/lib/redis", () => ({
  redis: {
    set: (...args: unknown[]) => redisSet(...args),
    decrby: (...args: unknown[]) => redisDecrby(...args),
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

vi.mock("@/lib/credits/exhaustion", () => ({
  onCreditsExhausted: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from "@/app/api/internal/metering/report-batch/route"

const SECRET = "test-metering-secret-handshake"

beforeEach(() => {
  vi.clearAllMocks()
  process.env.METERING_MASTER_SECRET = SECRET
  ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: "ws-wire", userId: "user-wire" },
  ])
})

describe("report-batch ↔ credit-proxy handshake", () => {
  it("byte-exact proxy payload → CreditUsageRecord createMany + balance debit", async () => {
    const update = vi.fn().mockResolvedValue({})
    const createMany = vi.fn().mockResolvedValue({ count: 1 })

    ;(prismaMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: unknown) => Promise<void>) => {
        const tx = {
          creditAccount: {
            findUnique: vi.fn().mockResolvedValue({
              id: "ca-wire",
              userId: "user-wire",
              balanceCents: 500,
              totalConsumedCents: 0,
              status: "ACTIVE",
            }),
            update,
          },
          creditUsageRecord: {
            findFirst: vi.fn().mockResolvedValue(null),
            createMany,
          },
          activityLog: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({ id: "al-1" }),
          },
        }
        await fn(tx)
      },
    )

    // Exact constructor path used by credit-proxy.mjs reporter.add + flush.
    const record = buildProxyUsageRecord({
      workspaceId: "ws-wire",
      agentId: null,
      model: "claude-haiku-4-5",
      inputTokens: 120,
      outputTokens: 40,
      costCents: 3,
      timestamp: "2026-07-18T10:55:15.487Z",
    })
    const body = buildProxyReportBatchBody([record], 0)
    // Byte-exact: JSON.stringify of the proxy body (field names + nesting).
    const wire = JSON.stringify(body)
    expect(wire).toContain('"provider":"ANTHROPIC"')
    expect(wire).toContain('"timestamp":')
    expect(wire).toContain('"droppedCount":0')
    expect(wire).toContain('"records":[')

    const req = createMockRequest("http://localhost:3000/api/internal/metering/report-batch", {
      method: "POST",
      headers: { [METERING_SECRET_HEADER]: SECRET },
      body: JSON.parse(wire) as Record<string, unknown>,
    })

    const res = await POST(req)
    const { status, data } = await parseResponse(res)

    expect(status).toBe(200)
    expect(data.data.processed).toBe(1)

    expect(update).toHaveBeenCalledWith({
      where: { userId: "user-wire" },
      data: expect.objectContaining({
        balanceCents: 497,
        totalConsumedCents: { increment: 3 },
        status: "ACTIVE",
      }),
    })

    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          creditAccountId: "ca-wire",
          workspaceId: "ws-wire",
          agentId: null,
          provider: "ANTHROPIC",
          model: "claude-haiku-4-5",
          inputTokens: 120,
          outputTokens: 40,
          costCents: 3,
          balanceAfterCents: 497,
        }),
      ],
    })

    expect(redisSet).toHaveBeenCalledWith("credit:balance:user-wire", "497")
    expect(redisDecrby).toHaveBeenCalledWith("credit:reservations:user-wire", 3)
  })

  it("mutation: pre-proxy body (no provider/timestamp) is rejected - handshake must stay exact", async () => {
    const req = createMockRequest("http://localhost:3000/api/internal/metering/report-batch", {
      method: "POST",
      headers: { [METERING_SECRET_HEADER]: SECRET },
      body: {
        droppedCount: 0,
        records: [
          {
            workspaceId: "ws-wire",
            model: "claude-sonnet-4-6",
            inputTokens: 10,
            outputTokens: 5,
            costCents: 1,
            // deliberately omit provider + timestamp (old platform-only shape)
          },
        ],
      },
    })

    const res = await POST(req)
    const { status } = await parseResponse(res)
    expect(status).toBe(400)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it("mutation: Authorization Bearer is NOT the proxy header - 401", async () => {
    const record = buildProxyUsageRecord({
      workspaceId: "ws-wire",
      model: "claude-haiku-4-5",
      inputTokens: 1,
      outputTokens: 1,
      costCents: 1,
    })
    const req = createMockRequest("http://localhost:3000/api/internal/metering/report-batch", {
      method: "POST",
      headers: { Authorization: `Bearer ${SECRET}` },
      body: buildProxyReportBatchBody([record]),
    })
    const res = await POST(req)
    expect((await parseResponse(res)).status).toBe(401)
  })

  it("returns 503 when durable write processes nothing so proxy requeues (not silent drop)", async () => {
    ;(prismaMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: unknown) => Promise<void>) => {
        const tx = {
          creditAccount: {
            findUnique: vi.fn().mockResolvedValue(null),
            update: vi.fn(),
          },
          creditUsageRecord: { createMany: vi.fn() },
        }
        await fn(tx)
      },
    )

    const record = buildProxyUsageRecord({
      workspaceId: "ws-wire",
      model: "claude-haiku-4-5",
      inputTokens: 1,
      outputTokens: 1,
      costCents: 1,
    })
    const req = createMockRequest("http://localhost:3000/api/internal/metering/report-batch", {
      method: "POST",
      headers: { [METERING_SECRET_HEADER]: SECRET },
      body: buildProxyReportBatchBody([record]),
    })

    const res = await POST(req)
    expect((await parseResponse(res)).status).toBe(503)
  })
})
