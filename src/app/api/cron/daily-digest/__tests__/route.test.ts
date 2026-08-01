// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockFindManyWs = vi.fn()
const mockFindManyLog = vi.fn()
const mockFindFirst = vi.fn()
const mockCreate = vi.fn()
const mockAggregate = vi.fn()
const mockAgentFindMany = vi.fn()
const mockGroupBy = vi.fn()
const mockTelegram = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    workspace: { findMany: (...a: unknown[]) => mockFindManyWs(...a) },
    activityLog: {
      findMany: (...a: unknown[]) => mockFindManyLog(...a),
      findFirst: (...a: unknown[]) => mockFindFirst(...a),
      create: (...a: unknown[]) => mockCreate(...a),
      groupBy: (...a: unknown[]) => mockGroupBy(...a),
    },
    creditUsageRecord: { aggregate: (...a: unknown[]) => mockAggregate(...a) },
    agent: { findMany: (...a: unknown[]) => mockAgentFindMany(...a) },
  },
}))

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/encryption", () => ({
  decrypt: (s: string) => s,
}))

vi.mock("@/lib/openclaw/channel-config", () => ({
  parseChannelConfigBlob: () => ({
    telegram: { botToken: "tok", allowFrom: ["123"] },
  }),
}))

vi.mock("@/lib/channels/telegram-bot-api", () => ({
  telegramSendMessage: (...a: unknown[]) => mockTelegram(...a),
}))

vi.mock("@/lib/digest/digest-eligibility", () => ({
  digestCandidateWhere: () => ({}),
  hasConnectedTelegramForDigest: () => true,
  parseDigestWorkspaceIdOverride: () => null,
}))

import { GET } from "@/app/api/cron/daily-digest/route"

function authReq() {
  return new Request("http://localhost/api/cron/daily-digest", {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  }) as unknown as import("next/server").NextRequest
}

describe("daily-digest idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = "test-cron-secret"
    mockFindManyWs.mockResolvedValue([
      {
        id: "ws-1",
        name: "Fixture",
        channelConfigEncrypted: "blob",
        apiKeySourceOverride: null,
        user: { email: "a@b.c", apiKeySource: "USER_OWN_KEY" },
        containerState: { lastSyncIncompleteAt: null, containerPhase: "RUNNING" },
      },
    ])
    mockAggregate.mockResolvedValue({ _sum: { costCents: 0 } })
    mockAgentFindMany.mockResolvedValue([])
    mockGroupBy.mockResolvedValue([])
    mockTelegram.mockResolvedValue(true)
    mockCreate.mockResolvedValue({ id: "log-1" })
  })

  it("second same-day call no-ops send when delivered digest already exists", async () => {
    mockFindFirst.mockResolvedValue({ id: "prior-digest" })

    const res = await GET(authReq())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.skipped).toBe(1)
    expect(json.data.sent).toBe(0)
    expect(mockTelegram).not.toHaveBeenCalled()
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          detail: "already-sent-today",
          action: "Daily digest skipped",
        }),
      }),
    )
  })

  it("first call sends when no prior delivered digest today", async () => {
    mockFindFirst.mockResolvedValue(null)
    mockFindManyLog.mockResolvedValue([])

    const res = await GET(authReq())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.sent).toBe(1)
    expect(mockTelegram).toHaveBeenCalledTimes(1)
  })
})
