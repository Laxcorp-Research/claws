import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createMockRequest } from "@/test/helpers/mock-request"

const mockSendOwnerAlert = vi.hoisted(() => vi.fn())
vi.mock("@/lib/alerts/owner-alert", () => ({
  sendOwnerAlert: (...args: unknown[]) => mockSendOwnerAlert(...args),
}))

import { GET } from "@/app/api/cron/owner-plane-ping/route"

const SECRET = "test-cron-secret"

function makeReq(opts: { auth?: string; confirm?: string } = {}) {
  const url = new URL("http://localhost:3000/api/cron/owner-plane-ping")
  if (opts.confirm !== undefined) url.searchParams.set("confirm", opts.confirm)
  const headers: Record<string, string> = {}
  if (opts.auth !== undefined) headers.authorization = opts.auth
  return createMockRequest(url.toString(), { method: "GET", headers })
}

describe("GET /api/cron/owner-plane-ping", () => {
  beforeEach(() => {
    mockSendOwnerAlert.mockReset()
    mockSendOwnerAlert.mockResolvedValue({
      sent: true,
      channel: "both",
      telegramSent: true,
      emailSent: true,
      telegramMessageId: 109,
    })
    vi.stubEnv("CRON_SECRET", SECRET)
    vi.stubEnv("FOUNDER_TELEGRAM_CHAT_ID", "1227037949")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("rejects missing auth", async () => {
    const res = await GET(makeReq({ confirm: "owner-plane-test" }))
    expect(res.status).toBe(401)
    expect(mockSendOwnerAlert).not.toHaveBeenCalled()
  })

  it("rejects without confirm=owner-plane-test (MUTATION: fire on any GET → fail)", async () => {
    const res = await GET(makeReq({ auth: `Bearer ${SECRET}` }))
    expect(res.status).toBe(400)
    expect(mockSendOwnerAlert).not.toHaveBeenCalled()
  })

  it("sends owner-plane-test and returns telegramMessageId", async () => {
    const res = await GET(
      makeReq({ auth: `Bearer ${SECRET}`, confirm: "owner-plane-test" }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { telegramMessageId: number; chatId: string; channel: string }
    }
    expect(mockSendOwnerAlert).toHaveBeenCalledWith(
      expect.objectContaining({ alertKey: "owner-plane-test" }),
    )
    expect(body.data.telegramMessageId).toBe(109)
    expect(body.data.chatId).toBe("1227037949")
    expect(body.data.channel).toBe("both")
  })
})
