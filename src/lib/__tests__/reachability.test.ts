import { describe, expect, it, vi } from "vitest"
import {
  NO_OUTBOUND_MESSAGE,
  TLS_INTERCEPT_MESSAGE,
  describeReachability,
  reachabilityMessage,
} from "@/lib/net/reachability"
import { ANTHROPIC_REJECTED_KEY, validateApiKey } from "@/lib/api-key-validation"

function cause(code: string): Error {
  const inner = new Error(code)
  ;(inner as Error & { code: string }).code = code
  const outer = new TypeError("fetch failed")
  ;(outer as Error & { cause: Error }).cause = inner
  return outer
}

describe("reachability error codes", () => {
  it("UNABLE_TO_VERIFY_LEAF_SIGNATURE names the corporate proxy", () => {
    expect(describeReachability(cause("UNABLE_TO_VERIFY_LEAF_SIGNATURE"))).toBe("tls_intercepted")
    expect(reachabilityMessage(cause("UNABLE_TO_VERIFY_LEAF_SIGNATURE"), "fallback")).toBe(TLS_INTERCEPT_MESSAGE)
  })

  it("SELF_SIGNED_CERT_IN_CHAIN names the corporate proxy", () => {
    expect(describeReachability(cause("SELF_SIGNED_CERT_IN_CHAIN"))).toBe("tls_intercepted")
    expect(reachabilityMessage(cause("SELF_SIGNED_CERT_IN_CHAIN"), "fallback")).toBe(TLS_INTERCEPT_MESSAGE)
  })

  it("ENOTFOUND says the container has no outbound internet", () => {
    expect(describeReachability(cause("ENOTFOUND"))).toBe("unreachable")
    expect(reachabilityMessage(cause("ENOTFOUND"), "fallback")).toBe(NO_OUTBOUND_MESSAGE)
  })

  it("ECONNREFUSED says the container has no outbound internet", () => {
    expect(describeReachability(cause("ECONNREFUSED"))).toBe("unreachable")
    expect(reachabilityMessage(cause("ECONNREFUSED"), "fallback")).toBe(NO_OUTBOUND_MESSAGE)
  })
})

describe("Anthropic key validation copy", () => {
  it("401 says Anthropic rejected this key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }),
    )
    const result = await validateApiKey("ANTHROPIC", "sk-ant-rejected")
    expect(result).toEqual({ valid: false, error: ANTHROPIC_REJECTED_KEY })
  })

  it("TLS intercept is the error under the key field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(cause("UNABLE_TO_VERIFY_LEAF_SIGNATURE")))
    const result = await validateApiKey("ANTHROPIC", "sk-ant-test")
    expect(result.valid).toBe(false)
    expect(result.error).toBe(TLS_INTERCEPT_MESSAGE)
  })

  it("ENOTFOUND is no outbound internet", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(cause("ENOTFOUND")))
    const result = await validateApiKey("ANTHROPIC", "sk-ant-test")
    expect(result.error).toBe(NO_OUTBOUND_MESSAGE)
  })
})
