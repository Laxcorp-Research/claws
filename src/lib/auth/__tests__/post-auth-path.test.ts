import { describe, expect, it } from "vitest"
import {
  isAllowedDuringOnboarding,
  resolvePostAuthPath,
} from "@/lib/auth/post-auth-path"

describe("resolvePostAuthPath (Batch B - shown-once)", () => {
  it("redirects first sign-in (!onboardingCompleted) to /onboarding", () => {
    expect(resolvePostAuthPath(false)).toBe("/onboarding")
    expect(resolvePostAuthPath(undefined)).toBe("/onboarding")
    expect(resolvePostAuthPath(false, "/my-claws")).toBe("/onboarding")
  })

  it("MUTATION never-redirect: completed users must NOT go to onboarding", () => {
    expect(resolvePostAuthPath(true)).toBe("/my-claws")
    expect(resolvePostAuthPath(true)).not.toBe("/onboarding")
  })

  it("MUTATION always-redirect: incomplete must go to onboarding even with callback", () => {
    expect(resolvePostAuthPath(false, "/dashboard/ws-1")).toBe("/onboarding")
  })

  it("honors safe callback when completed", () => {
    expect(resolvePostAuthPath(true, "/settings?tab=api-keys")).toBe(
      "/settings?tab=api-keys",
    )
  })

  it("rejects open redirects when completed", () => {
    expect(resolvePostAuthPath(true, "https://evil.com")).toBe("/my-claws")
    expect(resolvePostAuthPath(true, "//evil.com")).toBe("/my-claws")
  })
})

describe("isAllowedDuringOnboarding", () => {
  it("allows onboarding + settings (API key CTA)", () => {
    expect(isAllowedDuringOnboarding("/onboarding")).toBe(true)
    expect(isAllowedDuringOnboarding("/settings")).toBe(true)
    expect(isAllowedDuringOnboarding("/settings/")).toBe(true)
  })

  it("blocks my-claws / builder until complete", () => {
    expect(isAllowedDuringOnboarding("/my-claws")).toBe(false)
    expect(isAllowedDuringOnboarding("/builder/ws-1")).toBe(false)
  })
})
