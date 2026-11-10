import { afterEach, describe, expect, it, vi } from "vitest"
import { probeAnthropicOutbound, resetAnthropicOutboundCache } from "@/lib/health/anthropic-outbound"

afterEach(() => {
  resetAnthropicOutboundCache()
  vi.unstubAllGlobals()
})

describe("probeAnthropicOutbound", () => {
  it("ok when HEAD returns any HTTP status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404, ok: false }))
    expect(await probeAnthropicOutbound()).toBe("ok")
  })

  it("tls_intercepted when the leaf cannot be verified", async () => {
    const inner = Object.assign(new Error("unable to verify"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" })
    const outer = new TypeError("fetch failed")
    ;(outer as Error & { cause: Error }).cause = inner
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(outer))
    expect(await probeAnthropicOutbound()).toBe("tls_intercepted")
  })

  it("unreachable on ENOTFOUND", async () => {
    const inner = Object.assign(new Error("getaddrinfo"), { code: "ENOTFOUND" })
    const outer = new TypeError("fetch failed")
    ;(outer as Error & { cause: Error }).cause = inner
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(outer))
    expect(await probeAnthropicOutbound()).toBe("unreachable")
  })
})
