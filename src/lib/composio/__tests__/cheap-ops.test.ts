// PR #5 — cheap-ops registry + classifier tests.
//
// Guards two kinds of regression:
//   (1) Registry coverage: every OAUTH_COMPOSIO toolkit shipped in
//       src/data/tool-catalog.ts must have either a CHEAP_OPS entry or
//       be in UNSUPPORTED_TOOLKITS. If a new OAuth toolkit is added in
//       a future PR and its Test button is not wired, this test fails
//       with a clear message pointing at the unregistered toolkit slug.
//   (2) Classifier behavior: the regex-based bucket assignment that the
//       route keys DB transitions off. In particular, provider_401 must
//       be detected in both thrown-SDK-error-payload form (Composio's
//       default on whoami-style ops) and resolved-{successful:false} form
//       (Composio's default on list/fetch-style ops) because both shapes
//       were observed live on 2026-04-21 in 500-validate-cheap-ops.mjs.

import { describe, it, expect } from "vitest"
import {
  CHEAP_OPS,
  UNSUPPORTED_TOOLKITS,
  UNSUPPORTED_TOOLKIT_TOOLTIP,
  classifyByMessage,
  classifyProbeResult,
  extractErrorPayload,
  isTestSupportedToolkit,
  type ProbeCategory,
} from "@/lib/composio/cheap-ops"
import { OAUTH_TOOLS } from "@/data/tool-catalog"

describe("CHEAP_OPS registry coverage", () => {
  it("every OAUTH_COMPOSIO catalog entry is either in CHEAP_OPS or UNSUPPORTED_TOOLKITS", () => {
    const misses: string[] = []
    for (const tool of OAUTH_TOOLS) {
      const toolkitSlug = tool.composioToolkitId ?? tool.slug
      const inRegistry = Object.prototype.hasOwnProperty.call(CHEAP_OPS, toolkitSlug)
      const inUnsupported = UNSUPPORTED_TOOLKITS.includes(toolkitSlug)
      if (!inRegistry && !inUnsupported) {
        misses.push(`${tool.slug} (toolkit: ${toolkitSlug})`)
      }
    }
    expect(
      misses,
      `Unregistered OAuth toolkits — add to CHEAP_OPS or UNSUPPORTED_TOOLKITS in src/lib/composio/cheap-ops.ts:\n  ${misses.join("\n  ")}`,
    ).toEqual([])
  })

  it("every CHEAP_OPS entry has the correct shape", () => {
    for (const [slug, entry] of Object.entries(CHEAP_OPS)) {
      expect(entry.op, `op missing for ${slug}`).toMatch(/^[A-Z][A-Z0-9_]+$/)
      expect(typeof entry.args, `args not an object for ${slug}`).toBe("object")
    }
  })

  it("asana is in UNSUPPORTED_TOOLKITS (sentinel — GH #41)", () => {
    expect(UNSUPPORTED_TOOLKITS).toContain("asana")
    expect(CHEAP_OPS["asana" as keyof typeof CHEAP_OPS]).toBeUndefined()
  })

  it("UNSUPPORTED_TOOLKIT_TOOLTIP uses 'not yet' phrasing, not 'not available'", () => {
    // "not yet" implies we're closing the gap (GH #41 tracks the fix);
    // "not available" implies permanent exclusion. UX decision locked in.
    expect(UNSUPPORTED_TOOLKIT_TOOLTIP).toMatch(/not yet/i)
    expect(UNSUPPORTED_TOOLKIT_TOOLTIP).not.toMatch(/not available/i)
  })
})

describe("isTestSupportedToolkit", () => {
  it("returns true for toolkits in CHEAP_OPS", () => {
    expect(isTestSupportedToolkit("gmail")).toBe(true)
    expect(isTestSupportedToolkit("hubspot")).toBe(true)
    expect(isTestSupportedToolkit("kit")).toBe(true)
  })

  it("returns false for UNSUPPORTED_TOOLKITS", () => {
    expect(isTestSupportedToolkit("asana")).toBe(false)
  })

  it("returns false for unknown toolkits", () => {
    expect(isTestSupportedToolkit("some_dynamic_toolkit")).toBe(false)
  })
})

describe("classifyByMessage", () => {
  type Case = { msg: string; expected: ProbeCategory }
  const cases: Case[] = [
    // Provider-401 variants — the one case where we flip DB to EXPIRED.
    { msg: "HTTP 401: Request had invalid authentication credentials.", expected: "provider_401" },
    { msg: "401 Unauthorized", expected: "provider_401" },
    { msg: "token has expired", expected: "provider_401" },
    { msg: "token was revoked", expected: "provider_401" },
    { msg: "invalid_grant", expected: "provider_401" },
    { msg: "invalid credentials", expected: "provider_401" },
    // Provider-403 (forbidden) — also flips DB to EXPIRED.
    { msg: "403 Forbidden", expected: "provider_403" },
    { msg: "forbidden: insufficient scope", expected: "provider_403" },
    // Composio-side rejections (observed during 500-validate probe).
    { msg: "toolkit mismatch for connected account", expected: "toolkit_mismatch" },
    { msg: "no connected account for this toolkit", expected: "toolkit_mismatch" },
    { msg: "No connected account found for toolkit hubspot", expected: "toolkit_mismatch" },
    // Registry-drift categories — code bugs, not connection failures.
    { msg: "tool not found", expected: "op_not_found" },
    { msg: "Unknown tool: FOO", expected: "op_not_found" },
    { msg: "Toolkit version not specified", expected: "version_broken" },
    { msg: "invalid version", expected: "version_broken" },
    { msg: "Invalid arguments: missing required property `limit`", expected: "invalid_args" },
    { msg: "Validation error: property must be string", expected: "invalid_args" },
  ]
  for (const c of cases) {
    it(`classifies "${c.msg.slice(0, 48)}…" as ${c.expected}`, () => {
      expect(classifyByMessage(c.msg)).toBe(c.expected)
    })
  }

  it("returns null for unclassifiable strings", () => {
    expect(classifyByMessage("something completely unexpected")).toBeNull()
    expect(classifyByMessage("")).toBeNull()
  })
})

describe("extractErrorPayload", () => {
  it("pulls message + status + nested cause", () => {
    const err = {
      message: "Error executing the tool GMAIL_GET_PROFILE",
      status: 401,
      cause: { error: "HTTP 401: Request had invalid authentication credentials" },
    }
    const payload = extractErrorPayload(err)
    expect(payload).toContain("msg=Error executing the tool GMAIL_GET_PROFILE")
    expect(payload).toContain("status=401")
    expect(payload).toContain("invalid authentication credentials")
  })

  it("handles bare Error instances", () => {
    const err = new Error("PROBE_TIMEOUT")
    expect(extractErrorPayload(err)).toContain("msg=PROBE_TIMEOUT")
  })

  it("gracefully handles non-object inputs", () => {
    expect(extractErrorPayload("string error")).toBe("string error")
    expect(extractErrorPayload(42)).toBe("42")
    expect(extractErrorPayload(null)).toBe("null")
  })

  it("doesn't throw on unstringifiable values (circular refs)", () => {
    const circular: Record<string, unknown> = { message: "x" }
    circular.self = circular
    const payload = extractErrorPayload({ message: "outer", cause: circular })
    expect(payload).toContain("msg=outer")
    expect(payload).toContain("cause=<unstringifiable>")
  })
})

describe("classifyProbeResult", () => {
  it("timeout sentinel always returns category='timeout'", () => {
    expect(classifyProbeResult({ timedOut: true })).toEqual({
      category: "timeout",
      message: "Probe exceeded 5s budget",
    })
  })

  it("resolved success (Composio returned successful:true) is 'working'", () => {
    const result = classifyProbeResult({
      resolved: { successful: true, data: {}, error: null },
    })
    expect(result.category).toBe("working")
  })

  it("resolved failure with 401 in error string is 'provider_401'", () => {
    const result = classifyProbeResult({
      resolved: {
        successful: false,
        error: "HTTP 401: Request had invalid authentication credentials.",
      },
    })
    expect(result.category).toBe("provider_401")
  })

  it("SDK throw with 401 in nested payload is 'provider_401' (matches 500-validate probe behavior)", () => {
    // This is the exact shape the 500-validate probe observed for
    // GMAIL_GET_PROFILE against a revoked token: SDK throws, the wrapped
    // error carries Google's 401 text in a nested field. Our classifier
    // must dig it out.
    const err = {
      message: "Error executing the tool GMAIL_GET_PROFILE",
      cause: {
        error: "HTTP 401: Request had invalid authentication credentials.",
      },
    }
    const result = classifyProbeResult({ threw: err })
    expect(result.category).toBe("provider_401")
  })

  it("SDK throw with toolkit-mismatch in payload is 'toolkit_mismatch'", () => {
    // Observed for the 15 cross-toolkit probes in 500-validate-cheap-ops.mjs.
    const err = {
      message: "Error executing the tool SHOPIFY_GET_SHOP_DETAILS",
      response: {
        error: "No connected account found for toolkit shopify",
      },
    }
    const result = classifyProbeResult({ threw: err })
    expect(result.category).toBe("toolkit_mismatch")
  })

  it("unclassifiable result falls back to 'unknown' (DB untouched)", () => {
    const result = classifyProbeResult({
      resolved: { successful: false, error: "completely new error shape" },
    })
    expect(result.category).toBe("unknown")
  })

  it("unclassifiable thrown error also falls back to 'unknown'", () => {
    const result = classifyProbeResult({ threw: new Error("something weird") })
    expect(result.category).toBe("unknown")
  })
})
