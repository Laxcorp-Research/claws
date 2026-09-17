// Signup consent gate (NextAuth): new users are BLOCKED without the consent
// cookie; consent is stored with version + timestamp at user creation;
// existing users are never blocked (grandfathered) but get a lazy row when
// they arrive with the cookie. MUTATION: removing the signIn gate or the
// createUser consent write fails these.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { TOS_CONSENT_COOKIE, TOS_VERSION } from "@/lib/legal/consent"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockCookieGet = vi.fn()
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => mockCookieGet(name) }),
}))

vi.mock("@/lib/email/send-email", () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock("@/lib/credits/grant", () => ({
  grantStarterCredits: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/openclaw/request-reconcile", () => ({
  requestReconcileForUser: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { authOptions } from "@/lib/auth"

type MockFn = ReturnType<typeof vi.fn>

function cookiePresent(version = TOS_VERSION) {
  mockCookieGet.mockImplementation((name: string) =>
    name === TOS_CONSENT_COOKIE ? { name, value: version } : undefined,
  )
}

function cookieAbsent() {
  mockCookieGet.mockReturnValue(undefined)
}

const signIn = authOptions.callbacks!.signIn!
const createUser = authOptions.events!.createUser!

beforeEach(() => {
  vi.clearAllMocks()
  cookieAbsent()
  ;(prismaMock.consentRecord.create as MockFn).mockResolvedValue({})
  ;(prismaMock.consentRecord.findFirst as MockFn).mockResolvedValue(null)
  ;(prismaMock.user.update as MockFn).mockResolvedValue({})
})

describe("signIn callback - signup consent gate", () => {
  it("NEW user + no consent cookie -> redirected to ConsentRequired (signup blocked)", async () => {
    ;(prismaMock.user.findUnique as MockFn).mockResolvedValue(null)
    const result = await signIn({
      user: { id: "gh-1", email: "new@example.com" },
      account: { provider: "github", providerAccountId: "x", type: "oauth" },
    } as never)
    expect(result).toBe("/auth/signin?error=ConsentRequired")
  })

  it("NEW user + consent cookie -> allowed", async () => {
    ;(prismaMock.user.findUnique as MockFn).mockResolvedValue(null)
    cookiePresent()
    const result = await signIn({
      user: { id: "gh-1", email: "new@example.com" },
      account: { provider: "github", providerAccountId: "x", type: "oauth" },
    } as never)
    expect(result).toBe(true)
  })

  it("magic-link SEND stage for a new address is blocked without the cookie", async () => {
    ;(prismaMock.user.findUnique as MockFn).mockResolvedValue(null)
    const result = await signIn({
      user: { id: "new@example.com", email: "new@example.com" },
      account: { provider: "email", providerAccountId: "new@example.com", type: "email" },
      email: { verificationRequest: true },
    } as never)
    expect(result).toBe("/auth/signin?error=ConsentRequired")
  })

  it("magic-link CLICK stage passes without a cookie (send was already gated; link may open in another browser)", async () => {
    ;(prismaMock.user.findUnique as MockFn).mockResolvedValue(null)
    const result = await signIn({
      user: { id: "new@example.com", email: "new@example.com" },
      account: { provider: "email", providerAccountId: "new@example.com", type: "email" },
    } as never)
    expect(result).toBe(true)
  })

  it("EXISTING user without cookie signs in freely (grandfathered - no lockout)", async () => {
    ;(prismaMock.user.findUnique as MockFn).mockResolvedValue({ id: "user-1" })
    const result = await signIn({
      user: { id: "user-1", email: "old@example.com" },
      account: { provider: "google", providerAccountId: "y", type: "oauth" },
    } as never)
    expect(result).toBe(true)
    expect(prismaMock.consentRecord.create).not.toHaveBeenCalled()
  })

  it("EXISTING user arriving with the cookie gets a lazy consent row once per version", async () => {
    ;(prismaMock.user.findUnique as MockFn).mockResolvedValue({ id: "user-1" })
    cookiePresent()
    await signIn({
      user: { id: "user-1", email: "old@example.com" },
      account: { provider: "google", providerAccountId: "y", type: "oauth" },
    } as never)
    expect(prismaMock.consentRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        kind: "TOS_PRIVACY",
        version: TOS_VERSION,
        source: "signin-lazy",
      }),
    })

    // Second arrival with an existing row for the version: no duplicate.
    ;(prismaMock.consentRecord.create as MockFn).mockClear()
    ;(prismaMock.consentRecord.findFirst as MockFn).mockResolvedValue({ id: "cr-1" })
    await signIn({
      user: { id: "user-1", email: "old@example.com" },
      account: { provider: "google", providerAccountId: "y", type: "oauth" },
    } as never)
    expect(prismaMock.consentRecord.create).not.toHaveBeenCalled()
  })
})

describe("createUser event - consent storage", () => {
  it("writes the TOS_PRIVACY row with the cookie's version + timestamp semantics", async () => {
    cookiePresent()
    await createUser({ user: { id: "user-new", email: "new@example.com" } } as never)
    expect(prismaMock.consentRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-new",
        kind: "TOS_PRIVACY",
        version: TOS_VERSION,
        source: "signup",
        metadata: JSON.stringify({ cookiePresent: true }),
      }),
    })
  })

  it("cookie-less creation (magic link opened elsewhere) falls back to the current TOS_VERSION and notes it", async () => {
    cookieAbsent()
    await createUser({ user: { id: "user-new", email: "new@example.com" } } as never)
    expect(prismaMock.consentRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-new",
        kind: "TOS_PRIVACY",
        version: TOS_VERSION,
        metadata: JSON.stringify({ cookiePresent: false }),
      }),
    })
  })

  it("a consent-write DB failure never breaks user creation (evidence, not control flow)", async () => {
    cookiePresent()
    ;(prismaMock.consentRecord.create as MockFn).mockRejectedValue(new Error("db down"))
    await expect(
      createUser({ user: { id: "user-new", email: "new@example.com" } } as never),
    ).resolves.toBeUndefined()
  })
})
