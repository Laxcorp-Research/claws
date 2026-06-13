import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockDestroyContainer = vi.fn()
vi.mock("@/lib/openclaw/deployer", () => ({
  destroyContainer: (...args: unknown[]) => mockDestroyContainer(...args),
}))

const mockSend = vi.hoisted(() => vi.fn())
vi.mock("@/lib/resend", () => ({
  getResend: () => ({
    emails: { send: mockSend },
  }),
}))

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { onCreditsExhausted } from "@/lib/credits/exhaustion"

describe("onCreditsExhausted", () => {
  beforeEach(() => {
    mockDestroyContainer.mockReset()
    mockDestroyContainer.mockResolvedValue(undefined)
    mockSend.mockReset()
    mockSend.mockResolvedValue({ id: "em-1" })
  })

  it("emails the amount the user was ACTUALLY granted, not a hardcoded value", async () => {
    // Legacy account granted the old $25 (2500c). The email must say $25.00,
    // proving the copy is sourced dynamically and won't misreport for the
    // existing users who never received the new $50 grant.
    ;(prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-legacy",
      email: "legacy@example.com",
      name: "Legacy",
      apiKeySource: "PLATFORM_CREDIT",
      workspaces: [],
      creditAccount: { initialGrantCents: 2500 },
    })

    await onCreditsExhausted("user-legacy")

    expect(mockSend).toHaveBeenCalledTimes(1)
    const html = (mockSend.mock.calls[0][0] as { html: string }).html
    expect(html).toContain("$25.00")
    expect(html).not.toContain("$50.00")
  })

  it("destroys every RUNNING workspace for PLATFORM_CREDIT users", async () => {
    ;(prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      name: "Test",
      apiKeySource: "PLATFORM_CREDIT",
      workspaces: [
        { id: "ws-1" },
        { id: "ws-2" },
      ],
    })
    ;(prismaMock.containerState.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 })

    await onCreditsExhausted("user-1")

    expect(mockDestroyContainer).toHaveBeenCalledTimes(2)
    expect(mockDestroyContainer).toHaveBeenCalledWith("ws-1")
    expect(mockDestroyContainer).toHaveBeenCalledWith("ws-2")
  })

  it("does NOT destroy containers for non-platform-credit users (they bring their own key)", async () => {
    ;(prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-2",
      email: "byo@example.com",
      name: "BYO User",
      apiKeySource: "USER_ANTHROPIC_KEY",
      workspaces: [{ id: "ws-3" }],
    })

    await onCreditsExhausted("user-2")

    expect(mockDestroyContainer).not.toHaveBeenCalled()
  })

  it("swallows destroyContainer errors and continues (does not crash)", async () => {
    ;(prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-3",
      email: "fail@example.com",
      name: "Fail User",
      apiKeySource: "PLATFORM_CREDIT",
      workspaces: [{ id: "ws-4" }, { id: "ws-5" }],
    })
    ;(prismaMock.containerState.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 })
    mockDestroyContainer
      .mockRejectedValueOnce(new Error("Railway 500"))
      .mockResolvedValueOnce(undefined)

    await expect(onCreditsExhausted("user-3")).resolves.toBeUndefined()
    expect(mockDestroyContainer).toHaveBeenCalledTimes(2)
  })
})
