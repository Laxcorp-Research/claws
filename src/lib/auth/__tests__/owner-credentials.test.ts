import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  },
}))
vi.mock("@/lib/email/send-email", () => ({ sendEmail: vi.fn() }))
vi.mock("@/lib/credits/grant", () => ({ grantStarterCredits: vi.fn() }))
vi.mock("@/lib/openclaw/request-reconcile", () => ({ requestReconcileForUser: vi.fn() }))
vi.mock("@/lib/legal/consent-server", () => ({
  readTosConsentCookieVersion: vi.fn(),
  recordConsent: vi.fn(),
  recordTosConsentIfMissing: vi.fn(),
}))

afterEach(() => {
  delete process.env.CLAWS_PROFILE
  vi.resetModules()
})

describe("self-host credentials provider", () => {
  it("hosted auth has no password provider", async () => {
    delete process.env.CLAWS_PROFILE
    const { authOptions } = await import("@/lib/auth")
    const ids = authOptions.providers.map((provider) => provider.id)
    expect(ids).not.toContain("credentials")
  })

  it("self-host auth adds the owner password provider", async () => {
    vi.resetModules()
    process.env.CLAWS_PROFILE = "self-host"
    const { authOptions } = await import("@/lib/auth")
    const ids = authOptions.providers.map((provider) => provider.id)
    expect(ids).toContain("credentials")
  })
})
