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
const mockSendEmail = vi.fn()
const mockWatchDigestMissed = vi.fn()

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
  preferNumericTelegramAllowFrom: (allowFrom: string[] | undefined) =>
    (allowFrom ?? []).filter((v) => /^\d+$/.test(v)),
}))

vi.mock("@/lib/channels/telegram-bot-api", () => ({
  telegramSendMessage: (...a: unknown[]) => mockTelegram(...a),
}))

const mockHasTelegram = vi.fn()
vi.mock("@/lib/digest/digest-eligibility", () => ({
  digestCandidateWhere: () => ({}),
  hasConnectedTelegramForDigest: (...a: unknown[]) => mockHasTelegram(...a),
  parseDigestWorkspaceIdOverride: () => null,
}))

vi.mock("@/lib/email/send-email", () => ({
  sendEmail: (...a: unknown[]) => mockSendEmail(...a),
}))

vi.mock("@/lib/digest/digest-missed", () => ({
  watchDigestMissed: (...a: unknown[]) => mockWatchDigestMissed(...a),
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
    mockSendEmail.mockResolvedValue({ ok: true, attempts: 1, resendId: "re_test_1" })
    mockWatchDigestMissed.mockResolvedValue({ alerted: false })
    mockHasTelegram.mockReturnValue(true)
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
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("emails owner when Telegram is missing and ledgers Resend id", async () => {
    mockHasTelegram.mockReturnValue(false)
    mockFindFirst.mockResolvedValue(null)
    mockFindManyLog.mockResolvedValue([])

    const res = await GET(authReq())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.sent).toBe(1)
    expect(mockTelegram).not.toHaveBeenCalled()
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "daily_digest",
        to: "a@b.c",
      }),
    )
    const sentRow = mockCreate.mock.calls.find(
      (c) => c[0].data.action === "Daily digest sent",
    )
    expect(sentRow).toBeTruthy()
    const meta = JSON.parse(sentRow![0].data.metadata)
    expect(meta.delivered).toBe(true)
    expect(meta.channel).toBe("email")
    expect(meta.resendId).toBe("re_test_1")
  })

  it("falls back to email when Telegram send fails", async () => {
    mockFindFirst.mockResolvedValue(null)
    mockFindManyLog.mockResolvedValue([])
    mockTelegram.mockResolvedValue(false)

    const res = await GET(authReq())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.sent).toBe(1)
    expect(mockTelegram).toHaveBeenCalledTimes(1)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })
})
