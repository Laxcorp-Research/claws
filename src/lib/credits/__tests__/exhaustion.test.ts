import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { readFileSync } from "fs"
import { join } from "path"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockSyncThenDestroy = vi.fn()
const mockDestroyContainer = vi.fn()
vi.mock("@/lib/openclaw/deployer", () => ({
  syncThenDestroy: (...args: unknown[]) => mockSyncThenDestroy(...args),
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
    mockSyncThenDestroy.mockReset()
    mockSyncThenDestroy.mockResolvedValue(undefined)
    mockDestroyContainer.mockReset()
    mockSend.mockReset()
    mockSend.mockResolvedValue({ id: "em-1" })
    ;(prismaMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (ops: unknown) => {
        if (Array.isArray(ops)) return Promise.all(ops as Promise<unknown>[])
        return undefined
      },
    )
    ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never)
    ;(prismaMock.containerState.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 1,
    })
  })

  it("email copy says stopped (not paused) when claws were taken down", async () => {
    ;(prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-copy",
      email: "copy@example.com",
      name: "Copy",
      apiKeySource: "PLATFORM_CREDIT",
      workspaces: [{ id: "ws-1", apiKeySourceOverride: null }],
      creditAccount: { initialGrantCents: 5000 },
    })
    ;(prismaMock.containerState.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 1,
    })

    await onCreditsExhausted("user-copy")

    const html = (mockSend.mock.calls[0][0] as { html: string }).html
    expect(html).toContain("We've stopped 1 running Claw.")
    expect(html).not.toContain("We've paused")
    expect(html).toContain("https://app.buildclaws.ai/settings?tab=api-keys")
    expect(html).not.toContain("/settings/api-keys")
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ws-1" },
        data: { status: "HIBERNATED" },
      }),
    )
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

  it("calls syncThenDestroy (not raw destroyContainer) for every credit-mode RUNNING workspace", async () => {
    // Mutation: revert exhaustion.ts to destroyContainer → this fails.
    ;(prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      name: "Test",
      apiKeySource: "PLATFORM_CREDIT",
      workspaces: [
        { id: "ws-1", apiKeySourceOverride: null },
        { id: "ws-2", apiKeySourceOverride: null },
      ],
    })
    ;(prismaMock.containerState.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 })

    await onCreditsExhausted("user-1")

    expect(mockSyncThenDestroy).toHaveBeenCalledTimes(2)
    expect(mockSyncThenDestroy).toHaveBeenCalledWith("ws-1")
    expect(mockSyncThenDestroy).toHaveBeenCalledWith("ws-2")
    expect(mockDestroyContainer).not.toHaveBeenCalled()
  })

  it("source mutation guard: exhaustion.ts must import/call syncThenDestroy, not bare destroyContainer", () => {
    // Structural mutation: if someone reverts the destroy path to raw
    // destroyContainer, this fails even if a test mock were swapped.
    const src = readFileSync(join(__dirname, "../exhaustion.ts"), "utf8")
    expect(src).toMatch(/syncThenDestroy/)
    expect(src).toMatch(/from "@\/lib\/openclaw\/deployer"/)
    expect(src).not.toMatch(/import\s*\{[^}]*\bdestroyContainer\b[^}]*\}\s*from\s*"@\/lib\/openclaw\/deployer"/)
    expect(src).not.toMatch(/await destroyContainer\(/)
  })

  it("enforces workspace-override-only PLATFORM_CREDIT when user.apiKeySource is NONE", async () => {
    // Mutation: user-only gate (user.apiKeySource === "PLATFORM_CREDIT") → fail.
    // Matches WIRE-TEST fixture: override on workspace, owner stays NONE.
    ;(prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-wire",
      email: "wire@example.com",
      name: "Wire",
      apiKeySource: "NONE",
      workspaces: [{ id: "ws-wire", apiKeySourceOverride: "PLATFORM_CREDIT" }],
    })
    ;(prismaMock.containerState.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 })

    await onCreditsExhausted("user-wire")

    expect(mockSyncThenDestroy).toHaveBeenCalledTimes(1)
    expect(mockSyncThenDestroy).toHaveBeenCalledWith("ws-wire")
  })

  it("does NOT destroy containers for BYOK / non-credit resolved mode", async () => {
    ;(prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-2",
      email: "byo@example.com",
      name: "BYO User",
      apiKeySource: "USER_OWN_KEY",
      workspaces: [{ id: "ws-3", apiKeySourceOverride: null }],
    })

    await onCreditsExhausted("user-2")

    expect(mockSyncThenDestroy).not.toHaveBeenCalled()
  })

  it("does NOT destroy when user is PLATFORM_CREDIT but workspace override forces USER_OWN_KEY", async () => {
    ;(prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-override-byok",
      email: "mixed@example.com",
      name: "Mixed",
      apiKeySource: "PLATFORM_CREDIT",
      workspaces: [{ id: "ws-byok", apiKeySourceOverride: "USER_OWN_KEY" }],
    })

    await onCreditsExhausted("user-override-byok")

    expect(mockSyncThenDestroy).not.toHaveBeenCalled()
  })

  it("swallows syncThenDestroy errors and continues (does not crash)", async () => {
    ;(prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-3",
      email: "fail@example.com",
      name: "Fail User",
      apiKeySource: "PLATFORM_CREDIT",
      workspaces: [
        { id: "ws-4", apiKeySourceOverride: null },
        { id: "ws-5", apiKeySourceOverride: null },
      ],
    })
    ;(prismaMock.containerState.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 })
    mockSyncThenDestroy
      .mockRejectedValueOnce(new Error("Railway 500"))
      .mockResolvedValueOnce(undefined)

    await expect(onCreditsExhausted("user-3")).resolves.toBeUndefined()
    expect(mockSyncThenDestroy).toHaveBeenCalledTimes(2)
  })

  it("regression: does not write CreditAccount.status (EXHAUSTED + banner feed stay on report-batch)", async () => {
    // Banner reads CreditAccount.status via GET /api/credits/balance.
    // Status flip to EXHAUSTED is owned by report-batch; exhaustion must not
    // invent a second writer.
    ;(prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-reg",
      email: "reg@example.com",
      name: "Reg",
      apiKeySource: "PLATFORM_CREDIT",
      workspaces: [{ id: "ws-reg", apiKeySourceOverride: null }],
      creditAccount: { initialGrantCents: 5000 },
    })
    ;(prismaMock.containerState.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 })

    await onCreditsExhausted("user-reg")

    const update = prismaMock.creditAccount.update as ReturnType<typeof vi.fn>
    expect(update.mock.calls.length).toBe(0)
    const src = readFileSync(join(__dirname, "../exhaustion.ts"), "utf8")
    expect(src).not.toMatch(/creditAccount\.update/)
    expect(src).not.toMatch(/status:\s*["']EXHAUSTED["']/)
    expect(mockSend).toHaveBeenCalledTimes(1)
  })
})

