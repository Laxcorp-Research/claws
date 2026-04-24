import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockDestroyContainer = vi.fn()
vi.mock("@/lib/openclaw/deployer", () => ({
  destroyContainer: (...args: unknown[]) => mockDestroyContainer(...args),
}))

vi.mock("@/lib/resend", () => ({
  getResend: () => ({
    emails: { send: vi.fn().mockResolvedValue({ id: "em-1" }) },
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
