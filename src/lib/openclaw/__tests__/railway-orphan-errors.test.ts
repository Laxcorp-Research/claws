import { describe, expect, it } from "vitest"
import {
  isMissingRailwayServiceError,
  isOrphanRailwayServiceError,
} from "@/lib/openclaw/deployer"

describe("Railway orphan error classification (P4)", () => {
  it("404 / not-found is missing + orphan", () => {
    expect(isMissingRailwayServiceError(new Error("Service not found"))).toBe(true)
    expect(isOrphanRailwayServiceError(new Error("Service not found"))).toBe(true)
  })

  it("NotAuthorized is orphan but NOT missing-service", () => {
    expect(isMissingRailwayServiceError(new Error("NotAuthorized"))).toBe(false)
    expect(isOrphanRailwayServiceError(new Error("NotAuthorized"))).toBe(true)
  })

  it("unrelated errors are neither", () => {
    expect(isOrphanRailwayServiceError(new Error("rate limited"))).toBe(false)
  })
})
