import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockRedisSet = vi.fn()
vi.mock("@/lib/redis", () => ({ redis: { set: (...args: unknown[]) => mockRedisSet(...args) } }))

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { grantStarterCredits } from "@/lib/credits/grant"
import { STARTER_CREDIT_CENTS } from "@/lib/credits/constants"

type Mock = ReturnType<typeof vi.fn>

const FRESH_USER = {
  id: "user-fresh",
  email: "newperson@example.com",
  emailVerifiedForCredits: true,
  creditAccount: null,
}

describe("grantStarterCredits", () => {
  const savedEnv = process.env.CLAWS_STARTER_CREDIT_CENTS

  beforeEach(() => {
    mockRedisSet.mockReset().mockResolvedValue("OK")
    // Exercise the default (constant) path, not an env override.
    delete process.env.CLAWS_STARTER_CREDIT_CENTS
  })

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.CLAWS_STARTER_CREDIT_CENTS
    else process.env.CLAWS_STARTER_CREDIT_CENTS = savedEnv
  })

  it("grants a fresh signup exactly $50 (5000 cents) into balance and initial grant", async () => {
    ;(prismaMock.user.findUnique as Mock).mockResolvedValue(FRESH_USER)
    ;(prismaMock.creditAccount.findFirst as Mock).mockResolvedValue(null)
    ;(prismaMock.creditAccount.count as Mock).mockResolvedValue(0)
    ;(prismaMock.creditAccount.create as Mock).mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      id: "ca-new",
      ...data,
    }))
    ;(prismaMock.user.update as Mock).mockResolvedValue({})

    await grantStarterCredits("user-fresh", "signup")

    expect(prismaMock.creditAccount.create).toHaveBeenCalledTimes(1)
    const data = (prismaMock.creditAccount.create as Mock).mock.calls[0][0].data
    // Literal 5000 assertion catches a wrong-constant mutation; the constant
    // assertion documents the single source of truth.
    expect(data.balanceCents).toBe(5000)
    expect(data.initialGrantCents).toBe(5000)
    expect(data.balanceCents).toBe(STARTER_CREDIT_CENTS)
    expect(mockRedisSet).toHaveBeenCalledWith("credit:balance:user-fresh", "5000")
  })

  it("does NOT re-grant a user who already has a CreditAccount (one-time guard)", async () => {
    ;(prismaMock.user.findUnique as Mock).mockResolvedValue({
      id: "user-existing",
      email: "existing@example.com",
      emailVerifiedForCredits: true,
      // Legacy $25 account — must be left untouched, never topped up or re-granted.
      creditAccount: { id: "ca-existing", balanceCents: 2500, initialGrantCents: 2500, status: "ACTIVE" },
    })

    const result = await grantStarterCredits("user-existing", "signup")

    expect(result).toBeNull()
    expect(prismaMock.creditAccount.create).not.toHaveBeenCalled()
    expect(prismaMock.user.update).not.toHaveBeenCalled()
    expect(mockRedisSet).not.toHaveBeenCalled()
  })

  it("does NOT grant when email is not yet verified for credits", async () => {
    ;(prismaMock.user.findUnique as Mock).mockResolvedValue({
      ...FRESH_USER,
      emailVerifiedForCredits: false,
    })

    const result = await grantStarterCredits("user-fresh", "signup")

    expect(result).toBeNull()
    expect(prismaMock.creditAccount.create).not.toHaveBeenCalled()
  })
})
