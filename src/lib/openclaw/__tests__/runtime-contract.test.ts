import { describe, expect, it } from "vitest"
import {
  deriveRuntimeContract,
  isRuntimeContract,
} from "@/lib/openclaw/runtime-contract"

describe("deriveRuntimeContract (version-keyed emission)", () => {
  it("2026.5.22-18 (KEEP canary stable) derives the 5.22 contract", () => {
    expect(deriveRuntimeContract("2026.5.22-18")).toBe("5.22")
  })

  it("2026.9.4-5 (soak candidate) derives the 9.4 contract", () => {
    expect(deriveRuntimeContract("2026.9.4-5")).toBe("9.4")
  })

  it("bare 2026.9.4 and later upstream date tuples derive 9.4", () => {
    expect(deriveRuntimeContract("2026.9.4")).toBe("9.4")
    expect(deriveRuntimeContract("2026.10.1")).toBe("9.4")
    expect(deriveRuntimeContract("2027.1.2-3")).toBe("9.4")
  })

  it("date-tuple compare, NOT semver: 2026.5.22 < 2026.9.4 despite 22 > 4", () => {
    expect(deriveRuntimeContract("2026.5.22")).toBe("5.22")
    expect(deriveRuntimeContract("2026.9.3")).toBe("5.22")
  })

  it("throws on unparseable versions (moving pointers can never derive a contract)", () => {
    expect(() => deriveRuntimeContract("latest")).toThrow(/unparseable/)
    expect(() => deriveRuntimeContract("candidate")).toThrow(/unparseable/)
    expect(() => deriveRuntimeContract("")).toThrow(/unparseable/)
  })

  it("isRuntimeContract guards the OpenClawVersion.runtimeContract column values", () => {
    expect(isRuntimeContract("5.22")).toBe(true)
    expect(isRuntimeContract("9.4")).toBe(true)
    expect(isRuntimeContract("9.5")).toBe(false)
    expect(isRuntimeContract(null)).toBe(false)
    expect(isRuntimeContract(undefined)).toBe(false)
  })
})
