import { describe, expect, it, vi } from "vitest"
import { completeOnboardingAfterFirstWorkspace } from "@/lib/auth/complete-onboarding"

describe("completeOnboardingAfterFirstWorkspace", () => {
  it("sets onboardingCompleted when workspace count is 1 (first workspace)", async () => {
    const tx = {
      workspace: { count: vi.fn().mockResolvedValue(1) },
      user: { update: vi.fn().mockResolvedValue({}) },
    }
    const isFirst = await completeOnboardingAfterFirstWorkspace(tx, "user-1")
    expect(isFirst).toBe(true)
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { onboardingCompleted: true },
    })
  })

  it("does not update when user already has other workspaces", async () => {
    const tx = {
      workspace: { count: vi.fn().mockResolvedValue(2) },
      user: { update: vi.fn().mockResolvedValue({}) },
    }
    const isFirst = await completeOnboardingAfterFirstWorkspace(tx, "user-1")
    expect(isFirst).toBe(false)
    expect(tx.user.update).not.toHaveBeenCalled()
  })

  it("MUTATION: removing the count===1 gate would mark every create complete", async () => {
    // Source guard: helper must require count === 1 before updating.
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const src = readFileSync(
      join(process.cwd(), "src/lib/auth/complete-onboarding.ts"),
      "utf8",
    )
    expect(src).toMatch(/count !== 1/)
    expect(src).toContain("onboardingCompleted: true")
  })
})
