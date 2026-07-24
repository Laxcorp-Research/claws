import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

import { loadOnboardingGate } from "@/lib/auth/onboarding-gate"

describe("loadOnboardingGate", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("redirects unauthenticated callers to signin", async () => {
    await expect(loadOnboardingGate(undefined)).resolves.toEqual({
      redirectTo: "/auth/signin",
    })
  })

  it("redirects DB-complete users to /my-claws (stale-cookie escape)", async () => {
    ;(prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      onboardingCompleted: true,
      _count: { apiKeys: 0 },
    })
    await expect(loadOnboardingGate("u1")).resolves.toEqual({
      redirectTo: "/my-claws",
    })
  })

  it("keeps incomplete users on onboarding and reports api-key presence", async () => {
    ;(prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      onboardingCompleted: false,
      _count: { apiKeys: 1 },
    })
    await expect(loadOnboardingGate("u1")).resolves.toEqual({
      redirectTo: null,
      hasApiKey: true,
    })
  })

  it("MUTATION: drop DB-complete redirect → this test fails", async () => {
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const src = readFileSync(join(process.cwd(), "src/lib/auth/onboarding-gate.ts"), "utf8")
    expect(src).toContain('redirectTo: "/my-claws"')
    expect(src).toMatch(/onboardingCompleted === true/)
  })
})
