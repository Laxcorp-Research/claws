import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

import { loadOnboardingGate } from "@/lib/auth/onboarding-gate"

describe("loadOnboardingGate (v2 revisit)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("redirects unauthenticated callers to signin", async () => {
    await expect(loadOnboardingGate(undefined)).resolves.toEqual({
      redirectTo: "/auth/signin",
    })
  })

  it("DB-complete users stay on /onboarding in revisit mode (no redirect)", async () => {
    ;(prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      onboardingCompleted: true,
    })
    await expect(loadOnboardingGate("u1")).resolves.toEqual({
      redirectTo: null,
      mode: "revisit",
    })
  })

  it("incomplete users get gate mode", async () => {
    ;(prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      onboardingCompleted: false,
    })
    await expect(loadOnboardingGate("u1")).resolves.toEqual({
      redirectTo: null,
      mode: "gate",
    })
  })

  it("MUTATION: must not redirect completed users to /my-claws", async () => {
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const src = readFileSync(join(process.cwd(), "src/lib/auth/onboarding-gate.ts"), "utf8")
    expect(src).not.toContain('redirectTo: "/my-claws"')
    expect(src).toContain('"revisit"')
    expect(src).toMatch(/onboardingCompleted === true \? "revisit"/)
  })
})
