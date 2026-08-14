import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { parseResponse } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/api/auth", () => ({
  getSessionUser: vi.fn(),
}))

import { getSessionUser } from "@/lib/api/auth"
import { GET } from "@/app/api/credits/usage/route"

const WS = "cmtxusage0001nightwatchxx"
const NOW = new Date("2026-08-14T16:30:00.000Z")

function liveRow(i: number) {
  return {
    id: `rec-${i}`,
    creditAccountId: "acct-1",
    workspaceId: WS,
    agentId: null,
    provider: "ANTHROPIC",
    model: "anthropic/claude-haiku-4-5-20251001",
    inputTokens: 10,
    outputTokens: 5,
    costCents: 2,
    balanceAfterCents: 100 - i,
    createdAt: new Date(NOW.getTime() - i * 60_000),
  }
}

describe("GET /api/credits/usage", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    vi.mocked(getSessionUser).mockResolvedValue({
      id: "user-1",
      email: "a@b.com",
      name: "A",
    } as never)
    prismaMock.creditAccount.findUnique.mockResolvedValue({
      id: "acct-1",
      userId: "user-1",
    } as never)
  })

  it("today's live rows produce daily aggregates even when CreditUsageDaily is empty", async () => {
    const rows = [0, 1, 2, 3, 4, 5].map(liveRow)
    prismaMock.creditUsageRecord.findMany
      .mockResolvedValueOnce(rows as never)
      .mockResolvedValueOnce(rows as never)
    prismaMock.workspace.findMany.mockResolvedValue([{ id: WS, name: "Night Watch" }] as never)

    const res = await GET()
    const { status, data } = await parseResponse(res)
    expect(status).toBe(200)
    expect(data.data.records).toHaveLength(6)
    expect(data.data.records[0].workspaceName).toBe("Night Watch")
    expect(data.data.daily.length).toBeGreaterThan(0)
    expect(data.data.daily[0].totalCalls).toBe(6)
    expect(data.data.daily[0].totalCostCents).toBe(12)
  })
})
